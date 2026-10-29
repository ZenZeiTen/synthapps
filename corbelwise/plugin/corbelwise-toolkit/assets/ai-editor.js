/**
 * Corbelwise writing assistant: a sidebar in the post editor. No build step; uses the script globals
 * WordPress provides. Every result is shown as a preview first and only changes the post when the
 * author clicks Insert, Replace or Use.
 */
( function ( wp, config ) {
	'use strict';

	var el = wp.element.createElement;
	var useState = wp.element.useState;
	var RawHTML = wp.element.RawHTML;
	var __ = wp.i18n.__;
	var c = wp.components;
	var editorApi = ( wp.editor && wp.editor.PluginSidebar ) ? wp.editor : wp.editPost;
	var PluginSidebar = editorApi.PluginSidebar;
	var PluginSidebarMoreMenuItem = editorApi.PluginSidebarMoreMenuItem;
	var NAME = 'cwtk-ai';

	var icon = el(
		'svg',
		{ width: 24, height: 24, viewBox: '0 0 24 24', 'aria-hidden': true },
		el( 'path', { d: 'M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3zm6 10l.9 2.1L21 16l-2.1.9L18 19l-.9-2.1L15 16l2.1-.9L18 13zM6 15l.7 1.6L8.3 17.3l-1.6.7L6 19.6l-.7-1.6-1.6-.7 1.6-.7L6 15z', fill: 'currentColor' } )
	);

	function plainText( html ) {
		// DOMParser builds an inert document: nothing in it loads or runs.
		var doc = new window.DOMParser().parseFromString( html || '', 'text/html' );
		return ( doc.body.textContent || '' ).replace( /\s+/g, ' ' ).trim();
	}

	function toBlocks( html ) {
		return wp.blocks.rawHandler( { HTML: html } );
	}

	function request( data ) {
		return wp.apiFetch( { path: '/cwtk/v1/write', method: 'POST', data: data } );
	}

	function useRunner() {
		var busyState = useState( '' );
		var errorState = useState( '' );
		return {
			busy: busyState[ 0 ],
			error: errorState[ 0 ],
			run: function ( key, data, onDone ) {
				busyState[ 1 ]( key );
				errorState[ 1 ]( '' );
				request( data ).then( function ( response ) {
					busyState[ 1 ]( '' );
					onDone( response.result );
				} ).catch( function ( err ) {
					busyState[ 1 ]( '' );
					errorState[ 1 ]( ( err && err.message ) || __( 'The request failed. Please try again.', 'corbelwise-toolkit' ) );
				} );
			},
		};
	}

	function RunButton( props ) {
		return el( c.Button, {
			variant: props.secondary ? 'secondary' : 'primary',
			isBusy: props.busy,
			disabled: props.disabled || props.busy,
			onClick: props.onClick,
			__next40pxDefaultSize: true,
		}, props.busy ? __( 'Working…', 'corbelwise-toolkit' ) : props.label );
	}

	function Preview( props ) {
		if ( ! props.html ) {
			return null;
		}
		return el( 'div', { className: 'cwtk-ai-preview' },
			el( 'div', { className: 'cwtk-ai-preview__body' }, el( RawHTML, null, props.html ) ),
			el( 'div', { className: 'cwtk-ai-preview__actions' }, props.actions )
		);
	}

	function DraftPanel( props ) {
		var runner = props.runner;
		var briefState = useState( '' );
		var resultState = useState( '' );
		var title = wp.data.useSelect( function ( select ) {
			return select( 'core/editor' ).getEditedPostAttribute( 'title' );
		}, [] );
		var isEmpty = wp.data.useSelect( function ( select ) {
			return select( 'core/editor' ).isEditedPostEmpty();
		}, [] );
		var blockEditor = wp.data.useDispatch( 'core/block-editor' );

		return el( c.PanelBody, { title: __( 'Write a draft', 'corbelwise-toolkit' ), initialOpen: true },
			el( c.TextareaControl, {
				label: __( 'What should the page say?', 'corbelwise-toolkit' ),
				help: __( 'A few lines are enough: the topic, who it is for and the main points.', 'corbelwise-toolkit' ),
				value: briefState[ 0 ],
				rows: 5,
				onChange: briefState[ 1 ],
			} ),
			el( RunButton, {
				label: __( 'Write draft', 'corbelwise-toolkit' ),
				busy: runner.busy === 'draft',
				disabled: ! briefState[ 0 ].trim() || !! runner.busy,
				onClick: function () {
					runner.run( 'draft', { task: 'draft', text: briefState[ 0 ], title: title || '' }, resultState[ 1 ] );
				},
			} ),
			el( Preview, {
				html: resultState[ 0 ],
				actions: [
					el( c.Button, {
						key: 'insert',
						variant: 'primary',
						onClick: function () {
							var blocks = toBlocks( resultState[ 0 ] );
							if ( isEmpty ) {
								blockEditor.resetBlocks( blocks );
							} else {
								blockEditor.insertBlocks( blocks );
							}
							resultState[ 1 ]( '' );
						},
					}, isEmpty ? __( 'Use this draft', 'corbelwise-toolkit' ) : __( 'Insert at the end', 'corbelwise-toolkit' ) ),
					el( c.Button, { key: 'discard', variant: 'tertiary', onClick: function () { resultState[ 1 ]( '' ); } }, __( 'Discard', 'corbelwise-toolkit' ) ),
				],
			} )
		);
	}

	function RewritePanel( props ) {
		var runner = props.runner;
		var taskState = useState( 'improve' );
		var noteState = useState( '' );
		var resultState = useState( null );
		var selection = wp.data.useSelect( function ( select ) {
			var store = select( 'core/block-editor' );
			var ids = store.getSelectedBlockClientIds();
			return { ids: ids, blocks: store.getBlocksByClientId( ids ).filter( Boolean ) };
		}, [] );
		var blockEditor = wp.data.useDispatch( 'core/block-editor' );
		var html = selection.blocks.map( function ( block ) {
			return wp.blocks.getBlockContent( block );
		} ).join( '\n' );
		var hasText = plainText( html ).length > 0;

		return el( c.PanelBody, { title: __( 'Rewrite the selected blocks', 'corbelwise-toolkit' ), initialOpen: true },
			! hasText && el( 'p', { className: 'cwtk-ai-hint' }, __( 'Select one or more paragraphs, headings or lists in the editor.', 'corbelwise-toolkit' ) ),
			el( c.SelectControl, {
				label: __( 'How', 'corbelwise-toolkit' ),
				value: taskState[ 0 ],
				options: [
					{ value: 'improve', label: __( 'Make it clearer', 'corbelwise-toolkit' ) },
					{ value: 'shorten', label: __( 'Make it shorter', 'corbelwise-toolkit' ) },
					{ value: 'expand', label: __( 'Make it longer', 'corbelwise-toolkit' ) },
					{ value: 'fix', label: __( 'Fix spelling and grammar', 'corbelwise-toolkit' ) },
					{ value: 'friendly', label: __( 'Friendlier tone', 'corbelwise-toolkit' ) },
					{ value: 'formal', label: __( 'More formal tone', 'corbelwise-toolkit' ) },
				],
				onChange: taskState[ 1 ],
				__nextHasNoMarginBottom: true,
			} ),
			el( c.TextControl, {
				label: __( 'Extra instruction (optional)', 'corbelwise-toolkit' ),
				value: noteState[ 0 ],
				onChange: noteState[ 1 ],
			} ),
			el( RunButton, {
				label: __( 'Rewrite', 'corbelwise-toolkit' ),
				busy: runner.busy === 'rewrite',
				disabled: ! hasText || !! runner.busy,
				onClick: function () {
					var ids = selection.ids.slice();
					runner.run( 'rewrite', { task: taskState[ 0 ], text: html, instruction: noteState[ 0 ] }, function ( result ) {
						resultState[ 1 ]( { html: result, ids: ids } );
					} );
				},
			} ),
			el( Preview, {
				html: resultState[ 0 ] && resultState[ 0 ].html,
				actions: [
					el( c.Button, {
						key: 'replace',
						variant: 'primary',
						onClick: function () {
							blockEditor.replaceBlocks( resultState[ 0 ].ids, toBlocks( resultState[ 0 ].html ) );
							resultState[ 1 ]( null );
						},
					}, __( 'Replace', 'corbelwise-toolkit' ) ),
					el( c.Button, { key: 'discard', variant: 'tertiary', onClick: function () { resultState[ 1 ]( null ); } }, __( 'Discard', 'corbelwise-toolkit' ) ),
				],
			} )
		);
	}

	function DetailsPanel( props ) {
		var runner = props.runner;
		var excerptState = useState( '' );
		var metaState = useState( '' );
		var titlesState = useState( [] );
		var post = wp.data.useSelect( function ( select ) {
			var editor = select( 'core/editor' );
			return { title: editor.getEditedPostAttribute( 'title' ) || '', content: editor.getEditedPostContent() };
		}, [] );
		var editPost = wp.data.useDispatch( 'core/editor' ).editPost;
		var text = plainText( post.content );
		var ready = text.length > 40;

		function actionButton( value, apply ) {
			return el( c.Button, { variant: 'secondary', onClick: apply }, value );
		}

		return el( c.PanelBody, { title: __( 'Excerpt, description and title', 'corbelwise-toolkit' ), initialOpen: false },
			! ready && el( 'p', { className: 'cwtk-ai-hint' }, __( 'Write some content first.', 'corbelwise-toolkit' ) ),
			el( 'div', { className: 'cwtk-ai-row' },
				el( RunButton, {
					secondary: true,
					label: __( 'Write an excerpt', 'corbelwise-toolkit' ),
					busy: runner.busy === 'summarize',
					disabled: ! ready || !! runner.busy,
					onClick: function () {
						runner.run( 'summarize', { task: 'summarize', text: text, title: post.title }, excerptState[ 1 ] );
					},
				} )
			),
			excerptState[ 0 ] && el( 'div', { className: 'cwtk-ai-preview' },
				el( 'p', null, excerptState[ 0 ] ),
				actionButton( __( 'Use as excerpt', 'corbelwise-toolkit' ), function () {
					editPost( { excerpt: excerptState[ 0 ] } );
					excerptState[ 1 ]( '' );
				} )
			),
			config && config.seo && el( 'div', { className: 'cwtk-ai-row' },
				el( RunButton, {
					secondary: true,
					label: __( 'Write a search description', 'corbelwise-toolkit' ),
					busy: runner.busy === 'meta',
					disabled: ! ready || !! runner.busy,
					onClick: function () {
						runner.run( 'meta', { task: 'meta', text: text, title: post.title }, metaState[ 1 ] );
					},
				} )
			),
			metaState[ 0 ] && el( 'div', { className: 'cwtk-ai-preview' },
				el( 'p', null, metaState[ 0 ] ),
				actionButton( __( 'Use as search description', 'corbelwise-toolkit' ), function () {
					var meta = {};
					meta[ config.seoKey ] = metaState[ 0 ];
					editPost( { meta: meta } );
					metaState[ 1 ]( '' );
				} )
			),
			el( 'div', { className: 'cwtk-ai-row' },
				el( RunButton, {
					secondary: true,
					label: __( 'Suggest titles', 'corbelwise-toolkit' ),
					busy: runner.busy === 'titles',
					disabled: ! ready || !! runner.busy,
					onClick: function () {
						runner.run( 'titles', { task: 'titles', text: text, title: post.title }, function ( result ) {
							titlesState[ 1 ]( Array.isArray( result ) ? result : [] );
						} );
					},
				} )
			),
			titlesState[ 0 ].length > 0 && el( 'ul', { className: 'cwtk-ai-titles' },
				titlesState[ 0 ].map( function ( title, i ) {
					return el( 'li', { key: i },
						el( c.Button, {
							variant: 'link',
							onClick: function () {
								editPost( { title: title } );
								titlesState[ 1 ]( [] );
							},
						}, title )
					);
				} )
			)
		);
	}

	function Sidebar() {
		var runner = useRunner();
		return el( wp.element.Fragment, null,
			el( PluginSidebarMoreMenuItem, { target: NAME, icon: icon }, __( 'Writing assistant', 'corbelwise-toolkit' ) ),
			el( PluginSidebar, { name: NAME, title: __( 'Writing assistant', 'corbelwise-toolkit' ), icon: icon },
				runner.error && el( c.Notice, { status: 'error', isDismissible: false, className: 'cwtk-ai-error' }, runner.error ),
				el( DraftPanel, { runner: runner } ),
				el( RewritePanel, { runner: runner } ),
				el( DetailsPanel, { runner: runner } ),
				el( 'p', { className: 'cwtk-ai-footnote' }, __( 'Powered by Claude. Always read AI-written text before you publish it.', 'corbelwise-toolkit' ) )
			)
		);
	}

	wp.plugins.registerPlugin( NAME, { render: Sidebar, icon: icon } );
} )( window.wp, window.cwtkAi );

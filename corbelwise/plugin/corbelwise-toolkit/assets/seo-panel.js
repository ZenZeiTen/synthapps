/**
 * "Search description" panel in the post editor's document settings. No build step: uses the
 * script globals WordPress provides.
 */
( function ( wp ) {
	'use strict';

	var el = wp.element.createElement;
	var __ = wp.i18n.__;
	var sprintf = wp.i18n.sprintf;
	var PluginDocumentSettingPanel = ( wp.editor && wp.editor.PluginDocumentSettingPanel ) || wp.editPost.PluginDocumentSettingPanel;
	var KEY = '_cwtk_description';

	function Panel() {
		var meta = wp.data.useSelect( function ( select ) {
			return select( 'core/editor' ).getEditedPostAttribute( 'meta' ) || {};
		}, [] );
		var editPost = wp.data.useDispatch( 'core/editor' ).editPost;

		if ( ! Object.prototype.hasOwnProperty.call( meta, KEY ) ) {
			return null;
		}
		var value = meta[ KEY ] || '';
		var length = value.length;
		var help = length > 160
			? sprintf( __( '%d characters. Search engines usually show about 155, so the end may be cut off.', 'corbelwise-toolkit' ), length )
			: sprintf( __( '%d characters. Aim for 120 to 155.', 'corbelwise-toolkit' ), length );

		return el(
			PluginDocumentSettingPanel,
			{ name: 'cwtk-seo', title: __( 'Search description', 'corbelwise-toolkit' ) },
			el( wp.components.TextareaControl, {
				label: __( 'Shown under the title in search results and in shared links. Leave empty to use the excerpt.', 'corbelwise-toolkit' ),
				value: value,
				rows: 4,
				help: help,
				onChange: function ( next ) {
					var update = {};
					update[ KEY ] = next;
					editPost( { meta: update } );
				},
			} )
		);
	}

	wp.plugins.registerPlugin( 'cwtk-seo', { render: Panel } );
} )( window.wp );

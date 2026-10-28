/**
 * "ContextChat button" block. Written without a build step; the front end is rendered by PHP.
 */
( function ( blocks, element, blockEditor, components, i18n ) {
	'use strict';

	var el = element.createElement;
	var __ = i18n.__;
	var agents = ( window.contextchatBlock && window.contextchatBlock.agents ) || [];

	blocks.registerBlockType( 'contextchat/button', {
		apiVersion: 2,
		title: __( 'ContextChat button', 'contextchat' ),
		description: __( 'A chat button for WhatsApp that sends the page context with the message.', 'contextchat' ),
		category: 'widgets',
		icon: 'format-chat',
		keywords: [ 'whatsapp', 'chat', 'contact' ],
		attributes: {
			text: { type: 'string', default: __( 'Chat on WhatsApp', 'contextchat' ) },
			agent: { type: 'string', default: '' },
			message: { type: 'string', default: '' },
		},
		edit: function ( props ) {
			var a = props.attributes;
			var blockProps = blockEditor.useBlockProps();
			return el(
				'div',
				blockProps,
				el(
					blockEditor.InspectorControls,
					null,
					el(
						components.PanelBody,
						{ title: __( 'Chat settings', 'contextchat' ) },
						el( components.SelectControl, {
							label: __( 'Agent', 'contextchat' ),
							value: a.agent,
							options: [ { value: '', label: __( 'Follow context rules', 'contextchat' ) } ].concat( agents ),
							onChange: function ( v ) {
								props.setAttributes( { agent: v } );
							},
						} ),
						el( components.TextareaControl, {
							label: __( 'Message', 'contextchat' ),
							help: __( 'Leave empty to use your context rules. Placeholders such as {page_title} work here.', 'contextchat' ),
							value: a.message,
							onChange: function ( v ) {
								props.setAttributes( { message: v } );
							},
						} )
					)
				),
				el(
					'span',
					{ className: 'ctxc-inline' },
					el( blockEditor.RichText, {
						tagName: 'span',
						value: a.text,
						allowedFormats: [],
						placeholder: __( 'Button text', 'contextchat' ),
						onChange: function ( v ) {
							props.setAttributes( { text: v } );
						},
					} )
				)
			);
		},
		save: function () {
			return null;
		},
	} );
}( window.wp.blocks, window.wp.element, window.wp.blockEditor, window.wp.components, window.wp.i18n ) );

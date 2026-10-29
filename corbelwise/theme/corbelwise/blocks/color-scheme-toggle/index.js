/**
 * Editor preview of the light/dark switch. The block is rendered on the server (render.php),
 * so it saves nothing.
 */
( function ( wp ) {
	var el = wp.element.createElement;

	wp.blocks.registerBlockType( 'corbelwise/color-scheme-toggle', {
		edit: function () {
			var props = wp.blockEditor.useBlockProps( { className: 'corbelwise-scheme-toggle' } );
			return el(
				'span',
				props,
				el(
					'svg',
					{ className: 'corbelwise-scheme-toggle__moon', width: 20, height: 20, viewBox: '0 0 24 24', 'aria-hidden': 'true' },
					el( 'path', { d: 'M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' } )
				)
			);
		},
		save: function () {
			return null;
		},
	} );
} )( window.wp );

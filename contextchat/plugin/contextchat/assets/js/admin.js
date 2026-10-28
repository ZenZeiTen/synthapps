/**
 * ContextChat settings screen: tabs, repeaters, avatar picker, placeholder chips and previews.
 */
( function () {
	'use strict';

	var data = window.contextchatAdmin || { samples: {}, i18n: {} };
	var engine = window.ContextChat;
	var form = document.querySelector( '.ctxc-form' );
	if ( ! form ) {
		return;
	}
	document.documentElement.classList.add( 'js' );

	/* Tabs, remembered in the address so a save returns to the same tab. */
	var tabs = document.querySelectorAll( '.ctxc-tabs .nav-tab' );
	function showTab( id ) {
		var found = false;
		tabs.forEach( function ( t ) {
			var on = t.getAttribute( 'data-tab' ) === id;
			found = found || on;
			t.classList.toggle( 'nav-tab-active', on );
			t.setAttribute( 'aria-selected', on ? 'true' : 'false' );
		} );
		if ( ! found ) {
			return showTab( 'general' );
		}
		document.querySelectorAll( '.ctxc-tab' ).forEach( function ( s ) {
			s.classList.toggle( 'is-active', s.getAttribute( 'data-tab' ) === id );
		} );
		var ref = form.querySelector( 'input[name="_wp_http_referer"]' );
		if ( ref ) {
			ref.value = ref.value.replace( /#.*$/, '' ) + '#ctxc-tab-' + id;
		}
	}
	tabs.forEach( function ( t ) {
		t.addEventListener( 'click', function ( e ) {
			e.preventDefault();
			showTab( t.getAttribute( 'data-tab' ) );
			history.replaceState( null, '', '#ctxc-tab-' + t.getAttribute( 'data-tab' ) );
		} );
	} );
	var tabFromHash = function () {
		showTab( ( location.hash || '' ).replace( '#ctxc-tab-', '' ) || 'general' );
	};
	window.addEventListener( 'hashchange', tabFromHash );
	tabFromHash();

	/* Template previews. */
	function updatePreview( wrap ) {
		var input = wrap.querySelector( '.ctxc-template-input' );
		var out = wrap.querySelector( '.ctxc-preview-text' );
		if ( input && out && engine ) {
			out.textContent = engine.render( input.value, data.samples ) || '—';
		}
	}
	function bindTemplate( wrap ) {
		var input = wrap.querySelector( '.ctxc-template-input' );
		input.addEventListener( 'input', function () {
			updatePreview( wrap );
		} );
		wrap.querySelectorAll( '.ctxc-chip' ).forEach( function ( chip ) {
			chip.addEventListener( 'click', function () {
				var token = chip.getAttribute( 'data-insert' );
				var start = input.selectionStart != null ? input.selectionStart : input.value.length;
				var end = input.selectionEnd != null ? input.selectionEnd : input.value.length;
				input.value = input.value.slice( 0, start ) + token + input.value.slice( end );
				input.focus();
				input.setSelectionRange( start + token.length, start + token.length );
				updatePreview( wrap );
			} );
		} );
		updatePreview( wrap );
	}

	/* Rule value field only matters for some rule types. */
	function bindRuleType( row ) {
		var select = row.querySelector( '.ctxc-rule-type' );
		var value = row.querySelector( '.ctxc-rule-value' );
		if ( ! select || ! value ) {
			return;
		}
		var update = function () {
			var needs = [ 'url_contains', 'page', 'post_type', 'category', 'product_category' ].indexOf( select.value ) > -1;
			value.classList.toggle( 'is-disabled', ! needs );
			value.querySelector( 'input' ).disabled = ! needs;
		};
		select.addEventListener( 'change', update );
		update();
	}

	/* Avatar picker using the media library. */
	function bindAvatar( row ) {
		var btn = row.querySelector( '.ctxc-avatar-btn' );
		var input = row.querySelector( '.ctxc-avatar-url' );
		if ( ! btn || ! input ) {
			return;
		}
		var paint = function () {
			btn.style.backgroundImage = input.value ? 'url("' + encodeURI( input.value ) + '")' : '';
			btn.classList.toggle( 'has-image', !! input.value );
		};
		btn.addEventListener( 'click', function () {
			if ( ! window.wp || ! wp.media ) {
				var url = window.prompt( data.i18n.chooseAvatar, input.value );
				if ( url !== null ) {
					input.value = url.trim();
					paint();
				}
				return;
			}
			var frame = wp.media( { title: data.i18n.chooseAvatar, button: { text: data.i18n.useImage }, library: { type: 'image' }, multiple: false } );
			frame.on( 'select', function () {
				var att = frame.state().get( 'selection' ).first().toJSON();
				var size = att.sizes && ( att.sizes.thumbnail || att.sizes.medium );
				input.value = size ? size.url : att.url;
				paint();
			} );
			frame.open();
		} );
		btn.addEventListener( 'contextmenu', function ( e ) {
			if ( input.value ) {
				e.preventDefault();
				input.value = '';
				paint();
			}
		} );
		paint();
	}

	function bindRow( row ) {
		row.querySelectorAll( '.ctxc-template' ).forEach( bindTemplate );
		bindRuleType( row );
		bindAvatar( row );
		var remove = row.querySelector( '.ctxc-remove' );
		if ( remove ) {
			remove.addEventListener( 'click', function () {
				if ( window.confirm( data.i18n.confirmRemove ) ) {
					row.remove();
				}
			} );
		}
	}

	var counter = Date.now();
	document.querySelectorAll( '.ctxc-repeater' ).forEach( function ( rep ) {
		var rows = rep.querySelector( '.ctxc-rows' );
		var tpl = rep.querySelector( 'template' );
		rows.querySelectorAll( '.ctxc-row' ).forEach( bindRow );
		rep.querySelector( '.ctxc-add' ).addEventListener( 'click', function () {
			// A unique index; PHP keeps the order the fields appear in, so indexes need not be sequential.
			var index = String( counter++ );
			var row = tpl.content.firstElementChild.cloneNode( true );
			[ row ].concat( Array.from( row.querySelectorAll( '[name], [id], [for]' ) ) ).forEach( function ( node ) {
				[ 'name', 'id', 'for' ].forEach( function ( attr ) {
					var v = node.getAttribute( attr );
					if ( v && v.indexOf( '__i__' ) > -1 ) {
						node.setAttribute( attr, v.split( '__i__' ).join( index ) );
					}
				} );
			} );
			rows.appendChild( row );
			bindRow( row );
			var first = row.querySelector( 'input[type="text"], input[type="tel"]' );
			if ( first ) {
				first.focus();
			}
		} );
		if ( window.jQuery && jQuery.fn.sortable ) {
			jQuery( rows ).sortable( { handle: '.ctxc-handle', placeholder: 'ctxc-row-placeholder', axis: 'y' } );
		}
	} );

	document.querySelectorAll( '.ctxc-tab > .ctxc-template, .form-table .ctxc-template' ).forEach( function ( wrap ) {
		if ( ! wrap.closest( '.ctxc-row' ) ) {
			bindTemplate( wrap );
		}
	} );

	/* Launcher preview on the Appearance tab. */
	var stage = document.querySelector( '.ctxc-preview-stage' );
	if ( stage ) {
		var launcher = stage.querySelector( '.ctxc-launcher' );
		var label = stage.querySelector( '.ctxc-launcher-label' );
		var field = function ( key ) {
			return form.querySelector( '[data-key="' + key + '"]' );
		};
		var paintLauncher = function () {
			var size = Math.max( 40, Math.min( 96, parseInt( field( 'size' ).value, 10 ) || 60 ) );
			var x = Math.min( 60, parseInt( field( 'offset_x' ).value, 10 ) || 0 );
			var y = Math.min( 60, parseInt( field( 'offset_y' ).value, 10 ) || 0 );
			var text = field( 'label' ).value.trim();
			var showLabel = text && field( 'label_display' ).value !== 'never';
			stage.style.setProperty( '--ctxc-color', field( 'color' ).value );
			stage.style.setProperty( '--ctxc-icon', field( 'icon_color' ).value );
			stage.style.setProperty( '--ctxc-size', size + 'px' );
			launcher.style.bottom = y + 'px';
			launcher.style.left = field( 'position' ).value === 'left' ? x + 'px' : 'auto';
			launcher.style.right = field( 'position' ).value === 'left' ? 'auto' : x + 'px';
			launcher.style.width = showLabel ? 'auto' : size + 'px';
			launcher.style.padding = showLabel ? '' : '0';
			label.textContent = text;
			label.style.display = showLabel ? '' : 'none';
		};
		[ 'size', 'offset_x', 'offset_y', 'label', 'label_display', 'position', 'color', 'icon_color' ].forEach( function ( key ) {
			var el = field( key );
			if ( el ) {
				el.addEventListener( 'input', paintLauncher );
				el.addEventListener( 'change', paintLauncher );
			}
		} );
		paintLauncher();
	}
}() );

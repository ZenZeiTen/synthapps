/**
 * ZenZeiTen Bastion admin: the live attack feed and confirmations.
 */
( function () {
	'use strict';

	var cfg = window.zbstAdmin || {};
	var i18n = cfg.i18n || {};

	// Ask before destructive actions.
	document.querySelectorAll( 'form[data-zbst-confirm]' ).forEach( function ( form ) {
		form.addEventListener( 'submit', function ( e ) {
			var text = i18n[ form.getAttribute( 'data-zbst-confirm' ) ];
			if ( text && ! window.confirm( text ) ) {
				e.preventDefault();
			}
		} );
	} );

	var feed = document.querySelector( '.zbst-feed tbody' );
	if ( ! feed || ! cfg.live ) {
		return;
	}

	var MAX_ROWS = 100;
	var lastId = 0;
	var paused = false;
	var timer = null;
	var toggle = document.querySelector( '.zbst-toggle' );
	var state = toggle ? toggle.querySelector( '.zbst-state' ) : null;

	function cell( row, text, cls ) {
		var td = document.createElement( 'td' );
		if ( cls ) {
			td.className = cls;
		}
		td.textContent = text;
		row.appendChild( td );
		return td;
	}

	function render( ev, fresh ) {
		var tr = document.createElement( 'tr' );
		tr.className = 'zbst-sev-' + ev.severity + ( fresh ? ' zbst-new' : '' );
		tr.setAttribute( 'data-id', ev.id );
		cell( tr, ev.time );

		var ipCell = cell( tr, '' );
		if ( ev.ip ) {
			var code = document.createElement( 'code' );
			code.textContent = ev.ip;
			ipCell.appendChild( code );
			if ( cfg.blockUrl ) {
				var a = document.createElement( 'a' );
				a.href = cfg.blockUrl + '&ip=' + encodeURIComponent( ev.ip );
				a.className = 'zbst-block-link';
				a.textContent = i18n.block || 'Block';
				ipCell.appendChild( document.createTextNode( ' ' ) );
				ipCell.appendChild( a );
			}
		}

		var typeCell = cell( tr, '' );
		var badge = document.createElement( 'span' );
		badge.className = 'zbst-badge zbst-badge-' + ev.severity;
		badge.textContent = ev.level;
		typeCell.appendChild( badge );
		typeCell.appendChild( document.createTextNode( ' ' + ev.type + ( 'blocked' === ev.action || 'locked' === ev.action ? ' ✓' : '' ) ) );

		cell( tr, ev.request, 'zbst-request' );
		cell( tr, ev.details );
		return tr;
	}

	function empty() {
		if ( ! feed.querySelector( 'tr[data-id]' ) && ! feed.querySelector( '.zbst-empty' ) ) {
			var tr = document.createElement( 'tr' );
			tr.className = 'zbst-empty';
			var td = cell( tr, i18n.empty || '' );
			td.colSpan = 5;
			feed.appendChild( tr );
		}
	}

	function add( events, fresh ) {
		if ( ! events.length ) {
			return;
		}
		var placeholder = feed.querySelector( '.zbst-empty' );
		if ( placeholder ) {
			placeholder.remove();
		}
		events.forEach( function ( ev ) {
			if ( ev.id <= lastId ) {
				return;
			}
			lastId = ev.id;
			feed.insertBefore( render( ev, fresh ), feed.firstChild );
		} );
		while ( feed.children.length > MAX_ROWS ) {
			feed.removeChild( feed.lastChild );
		}
	}

	function update( data ) {
		add( data.events || [], true );
		var counters = data.counters || {};
		Object.keys( counters ).forEach( function ( key ) {
			var el = document.querySelector( '[data-counter="' + key + '"]' );
			if ( el ) {
				el.textContent = Number( counters[ key ] ).toLocaleString();
			}
		} );
		var hours = data.hours || [];
		var bars = document.querySelectorAll( '.zbst-bar span' );
		var max = Math.max.apply( null, hours.concat( [ 1 ] ) );
		if ( bars.length === hours.length ) {
			hours.forEach( function ( n, i ) {
				bars[ i ].style.height = Math.round( ( 100 * n ) / max ) + '%';
			} );
		}
	}

	function setState( text, cls ) {
		if ( state ) {
			state.textContent = text;
		}
		if ( toggle ) {
			toggle.classList.remove( 'is-live', 'is-paused', 'is-offline' );
			toggle.classList.add( cls );
		}
	}

	function schedule() {
		window.clearTimeout( timer );
		timer = window.setTimeout( poll, cfg.interval || 4000 );
	}

	function poll() {
		if ( paused || document.hidden ) {
			schedule();
			return;
		}
		var url = cfg.live + ( cfg.live.indexOf( '?' ) === -1 ? '?' : '&' ) + 'after=' + lastId;
		window.fetch( url, { headers: { 'X-WP-Nonce': cfg.nonce }, credentials: 'same-origin', cache: 'no-store' } )
			.then( function ( r ) {
				if ( ! r.ok ) {
					throw new Error( 'HTTP ' + r.status );
				}
				return r.json();
			} )
			.then( function ( data ) {
				update( data );
				setState( i18n.live || 'Live', 'is-live' );
			} )
			.catch( function () {
				setState( i18n.offline || 'Offline', 'is-offline' );
			} )
			.then( schedule );
	}

	if ( toggle ) {
		toggle.addEventListener( 'click', function () {
			paused = ! paused;
			toggle.setAttribute( 'aria-pressed', paused ? 'true' : 'false' );
			setState( paused ? i18n.paused || 'Paused' : i18n.live || 'Live', paused ? 'is-paused' : 'is-live' );
			if ( ! paused ) {
				poll();
			}
		} );
	}

	var initial = document.querySelector( '.zbst-initial' );
	try {
		add( initial ? JSON.parse( initial.textContent ) : [], false );
	} catch ( e ) {}
	empty();
	setState( i18n.live || 'Live', 'is-live' );
	schedule();
}() );

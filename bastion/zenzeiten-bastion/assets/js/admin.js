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
	// Addresses shown without an owner yet: address -> times asked. Asked for a few times, then left.
	var MAX_ASKS = 3;
	var wanted = {};
	var regions = null;
	try {
		regions = new Intl.DisplayNames( [ document.documentElement.lang || 'en' ], { type: 'region' } );
	} catch ( e ) {}
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

	// "Telkom Indonesia · Indonesia" from an owner and a two-letter country code.
	function netText( net ) {
		var country = net.country || '';
		if ( country && regions ) {
			try {
				country = regions.of( country ) || country;
			} catch ( e ) {}
		}
		return [ net.owner || '', country ].filter( Boolean ).join( ' · ' );
	}

	function showNet( ipCell, net ) {
		var text = netText( net );
		if ( ! text || ipCell.querySelector( '.zbst-net' ) ) {
			return;
		}
		var small = document.createElement( 'small' );
		small.className = 'zbst-net';
		small.textContent = text;
		ipCell.appendChild( small );
	}

	// Fill in the rows of addresses whose owner arrived after they were drawn.
	function applyNetworks( networks ) {
		Object.keys( networks || {} ).forEach( function ( ip ) {
			delete wanted[ ip ];
			if ( ! networks[ ip ] ) {
				return;
			}
			feed.querySelectorAll( 'tr[data-id]' ).forEach( function ( tr ) {
				if ( tr.getAttribute( 'data-ip' ) === ip ) {
					showNet( tr.children[ 1 ], networks[ ip ] );
				}
			} );
		} );
	}

	function render( ev, fresh ) {
		var tr = document.createElement( 'tr' );
		tr.className = 'zbst-sev-' + ev.severity + ( fresh ? ' zbst-new' : '' );
		tr.setAttribute( 'data-id', ev.id );
		tr.setAttribute( 'data-ip', ev.ip || '' );
		cell( tr, ev.time );

		var ipCell = cell( tr, '' );
		if ( ev.ip ) {
			var code = document.createElement( 'code' );
			code.textContent = ev.ip;
			ipCell.appendChild( code );
			ipCell.appendChild( document.createTextNode( ' ' ) );
			if ( ev.own ) {
				// Blocking your own address would lock you out, so no link is offered.
				var own = document.createElement( 'span' );
				own.className = 'zbst-own';
				own.textContent = i18n.own || '(your address)';
				ipCell.appendChild( own );
			} else if ( cfg.blockUrl ) {
				var a = document.createElement( 'a' );
				a.href = cfg.blockUrl + '&ip=' + encodeURIComponent( ev.ip );
				a.className = 'zbst-block-link';
				a.textContent = i18n.block || 'Block this IP';
				ipCell.appendChild( a );
			}
			if ( ev.net ) {
				showNet( ipCell, ev.net );
			} else if ( false === ev.net && ! ( ev.ip in wanted ) ) {
				wanted[ ev.ip ] = 0;
			}
		}

		var typeCell = cell( tr, '' );
		var badge = document.createElement( 'span' );
		badge.className = 'zbst-badge zbst-badge-' + ev.severity;
		badge.textContent = ev.level;
		typeCell.appendChild( badge );
		typeCell.appendChild( document.createTextNode( ' ' + ev.type ) );

		var outcome = cell( tr, '' );
		var mark = document.createElement( 'span' );
		mark.className = 'zbst-outcome zbst-outcome-' + ( ev.result || 'logged' );
		mark.textContent = ev.outcome || '';
		outcome.appendChild( mark );

		cell( tr, ev.request, 'zbst-request' );
		cell( tr, ev.details );
		return tr;
	}

	function empty() {
		if ( ! feed.querySelector( 'tr[data-id]' ) && ! feed.querySelector( '.zbst-empty' ) ) {
			var tr = document.createElement( 'tr' );
			tr.className = 'zbst-empty';
			var td = cell( tr, i18n.empty || '' );
			td.colSpan = 6;
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
		applyNetworks( data.networks );
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
		var ask = Object.keys( wanted ).slice( 0, 10 );
		ask.forEach( function ( ip ) {
			if ( ++wanted[ ip ] >= MAX_ASKS ) {
				delete wanted[ ip ];
			}
		} );
		if ( ask.length ) {
			url += '&nets=' + encodeURIComponent( ask.join( ',' ) );
		}
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

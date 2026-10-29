/**
 * Visitor Guard tracker.
 *
 * Records the pageview, time on page, scroll depth, interactions and clicks, and reports the
 * browser signals the fraud engine uses. No dependencies, no cookies; an optional random ID in
 * localStorage recognizes returning visitors.
 */
( function () {
	'use strict';

	var cfg = window.vsenConfig;
	if ( ! cfg || ! cfg.endpoint || ! window.JSON || window.VisitorSentinel ) {
		return;
	}

	var w = window;
	var d = document;
	var nav = navigator;
	var SESSION_TIMEOUT = 30 * 60 * 1000;
	var DOWNLOAD = /\.(pdf|zip|rar|7z|gz|tgz|tar|dmg|exe|msi|apk|docx?|xlsx?|pptx?|csv|txt|rtf|odt|ods|odp|epub|mp3|mp4|m4a|mov|avi|wav|webm)(?:[?#]|$)/i;

	var started = false;
	var loadedAt = now();
	var pageview = null;
	var token = null;
	var sessionKey = null;
	var interactions = 0;
	var lastInteraction = 0;
	var maxScroll = 0;
	var visibleMs = 0;
	var visibleSince = d.hidden ? 0 : loadedAt;
	var beats = 0;
	var beatTimer = null;
	var hoverFrame = null;
	var adSelector = ( cfg.adSelectors || [] ).join( ',' );

	function now() {
		return Date.now ? Date.now() : new Date().getTime();
	}

	// ---------------------------------------------------------------------------------------
	// Storage (all access guarded: private modes and blocked storage throw).
	// ---------------------------------------------------------------------------------------

	function storeGet( key ) {
		if ( ! cfg.storage ) {
			return null;
		}
		try {
			return w.localStorage.getItem( key );
		} catch ( e ) {
			return null;
		}
	}

	function storeSet( key, value ) {
		if ( ! cfg.storage ) {
			return;
		}
		try {
			w.localStorage.setItem( key, value );
		} catch ( e ) {}
	}

	function storeRemove( key ) {
		try {
			w.localStorage.removeItem( key );
		} catch ( e ) {}
	}

	function randomId() {
		var bytes = new Uint8Array( 16 );
		var out = '';
		var i;
		if ( w.crypto && w.crypto.getRandomValues ) {
			w.crypto.getRandomValues( bytes );
		} else {
			for ( i = 0; i < 16; i++ ) {
				bytes[ i ] = Math.floor( Math.random() * 256 );
			}
		}
		for ( i = 0; i < 16; i++ ) {
			out += ( bytes[ i ] < 16 ? '0' : '' ) + bytes[ i ].toString( 16 );
		}
		return out;
	}

	function visitorId() {
		if ( ! cfg.storage ) {
			return '';
		}
		var id = storeGet( 'vsen_vid' );
		if ( ! id || ! /^[a-f0-9]{32}$/.test( id ) ) {
			id = randomId();
			storeSet( 'vsen_vid', id );
		}
		return id;
	}

	function readSession() {
		var raw = storeGet( 'vsen_sid' );
		if ( ! raw ) {
			return '';
		}
		var parts = raw.split( '|' );
		if ( 2 !== parts.length || ! /^[a-f0-9]{32}$/.test( parts[ 0 ] ) || now() - parseInt( parts[ 1 ], 10 ) > SESSION_TIMEOUT ) {
			return '';
		}
		return parts[ 0 ];
	}

	function touchSession() {
		if ( sessionKey ) {
			storeSet( 'vsen_sid', sessionKey + '|' + now() );
		}
	}

	// ---------------------------------------------------------------------------------------
	// Ad protection flag.
	// ---------------------------------------------------------------------------------------

	function applyFlag( flagged ) {
		if ( ! cfg.protect ) {
			return;
		}
		var root = d.documentElement;
		if ( flagged ) {
			root.classList.add( 'vsen-flagged' );
			try {
				w.localStorage.setItem( 'vsen_f', String( now() + cfg.flagDays * 86400000 ) );
			} catch ( e ) {}
		} else {
			root.classList.remove( 'vsen-flagged' );
			storeRemove( 'vsen_f' );
		}
	}

	// ---------------------------------------------------------------------------------------
	// Transport.
	// ---------------------------------------------------------------------------------------

	/**
	 * Post a payload. mode 'beacon' survives page unload and returns nothing; 'keepalive' also
	 * survives unload but returns the reply; anything else is a plain request.
	 */
	function send( payload, mode ) {
		var body = JSON.stringify( payload );
		if ( 'beacon' === mode && nav.sendBeacon ) {
			try {
				if ( nav.sendBeacon( cfg.endpoint, new Blob( [ body ], { type: 'text/plain' } ) ) ) {
					return null;
				}
			} catch ( e ) {}
		}
		if ( ! w.fetch ) {
			return null;
		}
		return w
			.fetch( cfg.endpoint, {
				method: 'POST',
				body: body,
				headers: { 'Content-Type': 'text/plain' },
				credentials: 'same-origin',
				keepalive: 'fetch' !== mode,
			} )
			.then( function ( r ) {
				return r.ok ? r.json() : null;
			} )
			.catch( function () {
				return null;
			} );
	}

	// ---------------------------------------------------------------------------------------
	// Engagement.
	// ---------------------------------------------------------------------------------------

	function interacted() {
		var t = now();
		// Count bursts, not every mousemove: one interaction per 400 ms at most.
		if ( t - lastInteraction > 400 ) {
			interactions++;
			lastInteraction = t;
		}
	}

	function measureScroll() {
		var doc = d.documentElement;
		var body = d.body;
		var height = Math.max( doc.scrollHeight, body ? body.scrollHeight : 0 ) - w.innerHeight;
		var top = w.pageYOffset || doc.scrollTop || 0;
		var pct = height > 0 ? Math.round( ( 100 * top ) / height ) : 100;
		if ( pct > maxScroll ) {
			maxScroll = Math.min( 100, pct );
		}
	}

	function onScroll() {
		measureScroll();
		interacted();
	}

	function activeMs() {
		return visibleMs + ( visibleSince ? now() - visibleSince : 0 );
	}

	function sendEngagement( mode ) {
		if ( ! pageview ) {
			return;
		}
		touchSession();
		send(
			{
				e: 'eng',
				pv: pageview,
				t: token,
				tt: now() - loadedAt,
				at: activeMs(),
				sc: maxScroll,
				it: interactions,
			},
			mode
		);
	}

	function scheduleBeat() {
		clearTimeout( beatTimer );
		if ( beats >= 20 || d.hidden ) {
			return;
		}
		var delay = 0 === beats ? 15000 : 1 === beats ? 30000 : 60000;
		beatTimer = setTimeout( function () {
			beats++;
			sendEngagement( 'fetch' );
			scheduleBeat();
		}, delay );
	}

	function onVisibility() {
		if ( d.hidden ) {
			if ( visibleSince ) {
				visibleMs += now() - visibleSince;
				visibleSince = 0;
			}
			clearTimeout( beatTimer );
			sendEngagement( 'beacon' );
		} else {
			visibleSince = now();
			scheduleBeat();
		}
	}

	// ---------------------------------------------------------------------------------------
	// Clicks.
	// ---------------------------------------------------------------------------------------

	function closest( el, selector ) {
		if ( ! selector ) {
			return null;
		}
		while ( el && 1 === el.nodeType ) {
			try {
				if ( ( el.matches || el.msMatchesSelector ).call( el, selector ) ) {
					return el;
				}
			} catch ( e ) {
				return null;
			}
			el = el.parentNode;
		}
		return null;
	}

	function adNetwork( el ) {
		if ( el.getAttribute( 'data-vsen-network' ) ) {
			return el.getAttribute( 'data-vsen-network' );
		}
		if ( closest( el, 'ins.adsbygoogle' ) || el.querySelector( 'ins.adsbygoogle' ) ) {
			return 'adsense';
		}
		if ( /^div-gpt-ad/.test( el.id || '' ) || el.querySelector( '[id^="div-gpt-ad"]' ) ) {
			return 'google_ad_manager';
		}
		return 'site';
	}

	function adLabel( el ) {
		return (
			el.getAttribute( 'data-vsen-ad' ) ||
			el.getAttribute( 'data-ad-slot' ) ||
			el.id ||
			( 'string' === typeof el.className ? el.className.split( /\s+/ )[ 0 ] : '' ) ||
			el.tagName.toLowerCase()
		).slice( 0, 120 );
	}

	function sendClick( data ) {
		data.e = 'click';
		data.pv = pageview;
		data.t = token;
		data.s = sessionKey || readSession();
		data.ms = now() - loadedAt;
		data.it = interactions;
		data.wd = nav.webdriver ? 1 : 0;
		touchSession();
		// Ad clicks wait for the reply, which says whether to hide ads from now on.
		var reply = send( data, 'ad' === data.k ? 'keepalive' : 'beacon' );
		if ( reply && reply.then ) {
			reply.then( function ( r ) {
				if ( r && 'f' in r ) {
					applyFlag( !! r.f );
				}
			} );
		}
	}

	function onClick( event ) {
		var target = event.target;
		var ad = closest( target, adSelector );
		if ( ad ) {
			var link = closest( target, 'a[href]' );
			sendClick( {
				k: 'ad',
				h: link ? link.href : '',
				l: adLabel( ad ),
				n: adNetwork( ad ),
				tr: false === event.isTrusted ? 0 : 1,
				xy: event.clientX || event.clientY || event.screenX || event.screenY ? 1 : 0,
			} );
			return;
		}
		var tracked = closest( target, '[data-vsen-track]' );
		if ( tracked ) {
			var trackedLink = closest( target, 'a[href]' );
			sendClick( {
				k: 'trk',
				l: tracked.getAttribute( 'data-vsen-track' ),
				h: trackedLink ? trackedLink.href : '',
			} );
			return;
		}
		var a = closest( target, 'a[href]' );
		if ( ! a || ! /^https?:/i.test( a.href ) ) {
			return;
		}
		if ( cfg.downloads && ( DOWNLOAD.test( a.pathname || '' ) || a.hasAttribute( 'download' ) ) ) {
			sendClick( { k: 'dl', h: a.href, l: ( a.textContent || '' ).trim().slice( 0, 120 ) } );
		} else if ( cfg.outbound && a.hostname && a.hostname.replace( /^www\./, '' ) !== w.location.hostname.replace( /^www\./, '' ) ) {
			sendClick( { k: 'out', h: a.href, l: ( a.textContent || '' ).trim().slice( 0, 120 ) } );
		}
	}

	// Clicks inside ad iframes (AdSense and others) never reach this page. The window losing
	// focus while the pointer is over an ad iframe is the standard sign of such a click.
	function onOver( event ) {
		var el = event.target;
		hoverFrame = el && 'IFRAME' === el.tagName ? closest( el, adSelector ) : null;
	}

	function onBlur() {
		if ( ! hoverFrame ) {
			return;
		}
		var ad = hoverFrame;
		hoverFrame = null;
		sendClick( { k: 'ad', l: adLabel( ad ), n: adNetwork( ad ), tr: 1, ifr: 1 } );
	}

	// ---------------------------------------------------------------------------------------
	// Start.
	// ---------------------------------------------------------------------------------------

	function start() {
		if ( started ) {
			return;
		}
		started = true;

		var listen = function ( target, type, fn ) {
			target.addEventListener( type, fn, { passive: true, capture: true } );
		};
		listen( d, 'pointerdown', interacted );
		listen( d, 'keydown', interacted );
		listen( d, 'touchstart', interacted );
		listen( d, 'mousemove', interacted );
		listen( w, 'scroll', onScroll );
		listen( d, 'click', onClick );
		listen( d, 'mouseover', onOver );
		w.addEventListener( 'blur', onBlur );
		d.addEventListener( 'visibilitychange', onVisibility );
		w.addEventListener( 'pagehide', function () {
			sendEngagement( 'beacon' );
		} );

		sessionKey = readSession() || null;
		var screenObj = w.screen || {};
		var reply = send(
			{
				e: 'pv',
				u: w.location.href,
				r: d.referrer,
				ti: d.title,
				v: visitorId(),
				s: sessionKey || '',
				sw: screenObj.width || 0,
				sh: screenObj.height || 0,
				wd: nav.webdriver ? 1 : 0,
			},
			'fetch'
		);
		if ( reply && reply.then ) {
			reply.then( function ( r ) {
				if ( ! r || ! r.ok ) {
					return;
				}
				pageview = r.pv;
				token = r.t;
				sessionKey = r.s;
				touchSession();
				applyFlag( !! r.f );
				// A short page is fully seen without scrolling; that is not an interaction.
				measureScroll();
				scheduleBeat();
			} );
		}
	}

	function hasConsent() {
		if ( 'function' === typeof w.wp_has_consent ) {
			return !! w.wp_has_consent( 'statistics' );
		}
		return '1' === storeGet( 'vsen_consent' ) || true === w.vsenConsent;
	}

	w.VisitorSentinel = {
		/**
		 * Grant or withdraw consent (for cookie banners without the WP Consent API).
		 *
		 * @param {boolean} granted
		 */
		consent: function ( granted ) {
			w.vsenConsent = !! granted;
			if ( granted ) {
				storeSet( 'vsen_consent', '1' );
				start();
			} else {
				storeRemove( 'vsen_consent' );
			}
		},
		/**
		 * Record a custom tracked event, e.g. VisitorSentinel.track('signup-button').
		 *
		 * @param {string} label
		 */
		track: function ( label ) {
			if ( started ) {
				sendClick( { k: 'trk', l: String( label ).slice( 0, 120 ) } );
			}
		},
	};

	if ( cfg.dnt && ( '1' === nav.doNotTrack || '1' === w.doNotTrack || true === nav.globalPrivacyControl ) ) {
		return;
	}

	if ( cfg.consent && ! hasConsent() ) {
		d.addEventListener( 'wp_listen_for_consent_change', function ( event ) {
			if ( event.detail && 'allow' === event.detail.statistics ) {
				start();
			}
		} );
		return;
	}

	start();
} )();

/**
 * ContextChat front-end script.
 *
 * The page already has working links built on the server. This script improves them with
 * what only the browser knows (campaign tags, referrer, the visitor's clock), applies opening
 * hours, runs the chat panel and counts clicks. The template rules match class-template.php;
 * both are tested against tests/fixtures/templates.json.
 */
( function ( root, factory ) {
	'use strict';
	var api = factory( root );
	if ( typeof module === 'object' && module.exports ) {
		module.exports = api;
	}
	if ( root ) {
		root.ContextChat = api;
		api.boot();
	}
}( typeof window !== 'undefined' ? window : null, function ( win ) {
	'use strict';

	var MAX_LENGTH = 1500;
	var WEEKDAYS = [ 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat' ];
	var PHP_SPACE = /^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g;
	var TRACKING = /^(utm_[a-z]+|gclid|fbclid|msclkid|ttclid)$/i;

	function phpTrim( s ) {
		return String( s ).replace( PHP_SPACE, '' );
	}

	/* ---------- Templates (same rules as ContextChat_Template) ---------- */

	function tidy( text ) {
		text = String( text )
			.replace( /\r\n|\r/g, '\n' )
			.replace( /\(\s*\)|\[\s*\]|"\s*"|“\s*”/g, '' )
			.replace( /[ \t]+/g, ' ' )
			.replace( / +([,.!?;:])/g, '$1' )
			.replace( /([,;:])(?=[,;:.!?])/g, '' )
			.replace( /^ +| +$/gm, '' )
			.replace( /\n{3,}/g, '\n\n' );
		text = phpTrim( text );

		var chars = Array.from( text );
		if ( chars.length > MAX_LENGTH ) {
			text = chars.slice( 0, MAX_LENGTH - 1 ).join( '' ).replace( /[ \t\n\r\0\x0B]+$/, '' ) + '…';
		}
		return text;
	}

	function render( template, vars ) {
		vars = vars || {};
		var text = String( template || '' ).replace( /\{([a-z0-9_]+)(?:\|([^{}]*))?\}/gi, function ( all, key, fallback ) {
			key = key.toLowerCase();
			var value = Object.prototype.hasOwnProperty.call( vars, key ) && vars[ key ] != null ? phpTrim( vars[ key ] ) : '';
			if ( value === '' && fallback !== undefined ) {
				value = phpTrim( fallback );
			}
			return value;
		} );
		return tidy( text );
	}

	/* ---------- Opening hours ---------- */

	function minutes( hhmm ) {
		var m = /^(\d{2}):(\d{2})$/.exec( hhmm || '' );
		return m ? parseInt( m[ 1 ], 10 ) * 60 + parseInt( m[ 2 ], 10 ) : 0;
	}

	/** Weekday (0 = Sunday) and minutes past midnight in the site's time zone. */
	function zonedParts( date, tz, offset ) {
		if ( tz && typeof Intl !== 'undefined' && Intl.DateTimeFormat ) {
			try {
				var parts = {};
				new Intl.DateTimeFormat( 'en-US', {
					timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
				} ).formatToParts( date ).forEach( function ( p ) {
					parts[ p.type ] = p.value;
				} );
				var day = WEEKDAYS.indexOf( parts.weekday );
				if ( day > -1 ) {
					return { day: day, minutes: ( parseInt( parts.hour, 10 ) % 24 ) * 60 + parseInt( parts.minute, 10 ) };
				}
			} catch ( e ) { /* Unknown zone: use the fixed offset below. */ }
		}
		var t = new Date( date.getTime() + ( offset || 0 ) * 60000 );
		return { day: t.getUTCDay(), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
	}

	/** Are we inside the weekly schedule? A closing time before the opening time runs past midnight. */
	function isOpen( hours, date ) {
		if ( ! hours || ! hours.enabled ) {
			return true;
		}
		var now = zonedParts( date || new Date(), hours.tz, hours.offset );
		var days = hours.days || [];
		var today = days[ now.day ];
		var yesterday = days[ ( now.day + 6 ) % 7 ];

		if ( today && today.on ) {
			var s = minutes( today.start ), e = minutes( today.end );
			if ( s === e || ( s < e ? now.minutes >= s && now.minutes < e : now.minutes >= s ) ) {
				return true;
			}
		}
		if ( yesterday && yesterday.on ) {
			var ys = minutes( yesterday.start ), ye = minutes( yesterday.end );
			if ( ye < ys && now.minutes < ye ) {
				return true;
			}
		}
		return false;
	}

	/* ---------- Visitor context ---------- */

	function clientVars( href, referrer, date ) {
		var vars = {};
		var url;
		try {
			url = new URL( href );
		} catch ( e ) {
			return vars;
		}
		[ 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content' ].forEach( function ( k ) {
			var v = url.searchParams.get( k );
			if ( v ) {
				vars[ k ] = v.slice( 0, 100 );
			}
		} );
		if ( referrer ) {
			try {
				var ref = new URL( referrer );
				if ( ref.hostname && ref.hostname !== url.hostname ) {
					vars.referrer = ref.hostname.replace( /^www\./, '' );
				}
			} catch ( e ) { /* Ignore an unreadable referrer. */ }
		}
		var clean = new URL( url.href );
		Array.from( clean.searchParams.keys() ).forEach( function ( k ) {
			if ( TRACKING.test( k ) ) {
				clean.searchParams.delete( k );
			}
		} );
		clean.hash = '';
		vars.current_url = clean.href;
		date = date || new Date();
		try {
			vars.date = date.toLocaleDateString();
			vars.time = date.toLocaleTimeString( [], { hour: '2-digit', minute: '2-digit' } );
		} catch ( e ) { /* Old browsers: leave date and time empty. */ }
		return vars;
	}

	function isMobile() {
		if ( ! win ) {
			return false;
		}
		var ua = win.navigator && win.navigator.userAgent || '';
		return /Android|iPhone|iPad|iPod|Mobile|Silk|Opera Mini/i.test( ua ) ||
			( !! win.matchMedia && win.matchMedia( '(pointer: coarse) and (max-width: 1024px)' ).matches );
	}

	function link( phone, text, target, mobile ) {
		var t = text ? encodeURIComponent( text ) : '';
		if ( ! mobile && target === 'web' ) {
			return 'https://web.whatsapp.com/send?phone=' + phone + ( t ? '&text=' + t : '' );
		}
		return 'https://wa.me/' + phone + ( t ? '?text=' + t : '' );
	}

	/* ---------- Page behaviour ---------- */

	var cfg, vars, open, mobile, rootEl, panel, launcher, composer, edited = false, activeTemplate, activeSource, activeRule;

	function agentById( id ) {
		for ( var i = 0; i < cfg.agents.length; i++ ) {
			if ( cfg.agents[ i ].id === id ) {
				return cfg.agents[ i ];
			}
		}
		return null;
	}

	function online( agent ) {
		return !! agent && ( agent.always || open );
	}

	/** The message for an agent. The offline note is added only when sending, never in the composer. */
	function messageFor( template, agent, forComposer ) {
		var text = render( template, Object.assign( {}, vars, { agent_name: agent ? agent.name : '' } ) );
		if ( ! forComposer && agent && ! online( agent ) && cfg.offline.suffix ) {
			text = tidy( text + '\n\n' + cfg.offline.suffix );
		}
		return text;
	}

	function track( agentId, source, rule ) {
		var detail = {
			agent: agentId || '',
			source: source || 'float',
			rule: rule || '',
			path: win.location.pathname,
			post: cfg.post || 0,
			device: mobile ? 'mobile' : 'desktop',
		};

		try {
			win.document.dispatchEvent( new CustomEvent( 'contextchat:click', { detail: detail } ) );
		} catch ( e ) { /* CustomEvent unsupported. */ }

		if ( cfg.datalayer ) {
			var event = { contextchat_agent: detail.agent, contextchat_source: detail.source, contextchat_rule: detail.rule, page_path: detail.path };
			if ( Array.isArray( win.dataLayer ) ) {
				win.dataLayer.push( Object.assign( { event: 'contextchat_click' }, event ) );
			}
			if ( typeof win.gtag === 'function' ) {
				win.gtag( 'event', 'contextchat_click', event );
			}
		}

		if ( ! cfg.analytics || ! cfg.rest ) {
			return;
		}
		var body = JSON.stringify( detail );
		try {
			if ( win.navigator.sendBeacon && win.navigator.sendBeacon( cfg.rest, new Blob( [ body ], { type: 'application/json' } ) ) ) {
				return;
			}
		} catch ( e ) { /* Fall back to fetch. */ }
		if ( win.fetch ) {
			win.fetch( cfg.rest, { method: 'POST', body: body, keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'application/json' } } ).catch( function () {} );
		}
	}

	function currentText( agent ) {
		if ( composer && edited ) {
			var text = tidy( composer.value );
			if ( agent && ! online( agent ) && cfg.offline.suffix && text.indexOf( phpTrim( cfg.offline.suffix ) ) === -1 ) {
				text = tidy( text + '\n\n' + cfg.offline.suffix );
			}
			return text;
		}
		return messageFor( activeTemplate, agent );
	}

	function refreshPanelLinks() {
		if ( ! panel ) {
			return;
		}
		Array.prototype.forEach.call( panel.querySelectorAll( '.ctxc-agent' ), function ( a ) {
			var agent = agentById( a.getAttribute( 'data-ctxc-agent' ) );
			if ( agent ) {
				a.href = link( agent.phone, currentText( agent ), cfg.target, mobile );
			}
		} );
	}

	/** Grow the composer with its text, up to a limit, so the whole message is readable. */
	function fitComposer() {
		composer.style.height = 'auto';
		composer.style.height = Math.min( composer.scrollHeight + 2, 200 ) + 'px';
	}

	function setComposer( template ) {
		activeTemplate = template;
		edited = false;
		if ( composer ) {
			var first = panel.querySelector( '.ctxc-agents li:not([hidden]) .ctxc-agent' );
			composer.value = messageFor( template, first ? agentById( first.getAttribute( 'data-ctxc-agent' ) ) : null, true );
			if ( ! panel.hidden ) {
				fitComposer();
			}
		}
		refreshPanelLinks();
	}

	function openPanel( template, source, rule, onlyIds ) {
		activeSource = source || 'float';
		activeRule = rule || '';
		Array.prototype.forEach.call( panel.querySelectorAll( '.ctxc-agents li' ), function ( li ) {
			var a = li.querySelector( '.ctxc-agent' );
			li.hidden = !! ( onlyIds && onlyIds.length && onlyIds.indexOf( a.getAttribute( 'data-ctxc-agent' ) ) === -1 );
		} );
		setComposer( template );
		panel.hidden = false;
		rootEl.classList.add( 'is-open' );
		if ( composer ) {
			fitComposer();
		}
		launcher.setAttribute( 'aria-expanded', 'true' );
		var focusTarget = composer || panel.querySelector( '.ctxc-agents li:not([hidden]) .ctxc-agent' );
		if ( focusTarget ) {
			focusTarget.focus( { preventScroll: true } );
		}
	}

	function closePanel( returnFocus ) {
		if ( ! panel || panel.hidden ) {
			return;
		}
		panel.hidden = true;
		rootEl.classList.remove( 'is-open' );
		launcher.setAttribute( 'aria-expanded', 'false' );
		if ( returnFocus ) {
			launcher.focus();
		}
	}

	function panelAgentIds() {
		return Array.prototype.map.call( panel.querySelectorAll( '.ctxc-agent' ), function ( a ) {
			return a.getAttribute( 'data-ctxc-agent' );
		} );
	}

	function setupFloat( doc ) {
		rootEl = doc.getElementById( 'contextchat' );
		if ( ! rootEl ) {
			return;
		}
		launcher = rootEl.querySelector( '.ctxc-launcher' );
		panel = rootEl.querySelector( '.ctxc-panel' );
		composer = rootEl.querySelector( '.ctxc-composer' );
		var template = rootEl.getAttribute( 'data-ctxc-template' ) || '';
		var rule = rootEl.getAttribute( 'data-ctxc-rule' ) || '';
		activeTemplate = template;

		var anyOnline = cfg.agents.some( online );
		if ( ! anyOnline && cfg.offline.behavior === 'hide' ) {
			rootEl.hidden = true;
			return;
		}

		if ( panel ) {
			var offlineNote = panel.querySelector( '.ctxc-offline' );
			if ( offlineNote && cfg.hours.enabled && ! open ) {
				offlineNote.hidden = false;
			}
			Array.prototype.forEach.call( panel.querySelectorAll( '.ctxc-agent' ), function ( a ) {
				var agent = agentById( a.getAttribute( 'data-ctxc-agent' ) );
				var status = a.querySelector( '.ctxc-agent-status' );
				var isOnline = online( agent );
				a.classList.toggle( 'is-offline', ! isOnline );
				if ( status && cfg.hours.enabled ) {
					status.textContent = isOnline ? cfg.i18n.online : cfg.i18n.offline;
					status.hidden = false;
				}
				a.addEventListener( 'click', function () {
					a.href = link( agent.phone, currentText( agent ), cfg.target, mobile );
					track( agent.id, activeSource, activeRule );
					closePanel( false );
				} );
			} );
			if ( composer ) {
				composer.addEventListener( 'input', function () {
					edited = true;
					fitComposer();
					refreshPanelLinks();
				} );
			}
			panel.querySelector( '.ctxc-close' ).addEventListener( 'click', function () {
				closePanel( true );
			} );
			doc.addEventListener( 'keydown', function ( e ) {
				if ( e.key === 'Escape' ) {
					closePanel( true );
				}
			} );
			doc.addEventListener( 'click', function ( e ) {
				if ( ! rootEl.contains( e.target ) && ! ( e.target.closest && e.target.closest( '[data-ctxc-inline]' ) ) ) {
					closePanel( false );
				}
			} );
			setComposer( template );
		}

		launcher.addEventListener( 'click', function ( e ) {
			if ( panel ) {
				e.preventDefault();
				if ( panel.hidden ) {
					openPanel( template, 'float', rule, null );
				} else {
					closePanel( false );
				}
				return;
			}
			var agent = agentById( launcher.getAttribute( 'data-ctxc-agent' ) ) || cfg.agents[ 0 ];
			launcher.href = link( agent.phone, messageFor( template, agent ), cfg.target, mobile );
			track( agent.id, 'float', rule );
		} );

		var reveal = function () {
			rootEl.classList.remove( 'ctxc--wait' );
			rootEl.classList.add( 'is-ready' );
		};
		if ( cfg.delay > 0 ) {
			win.setTimeout( reveal, cfg.delay * 1000 );
		} else {
			reveal();
		}
	}

	function setupInline( doc ) {
		Array.prototype.forEach.call( doc.querySelectorAll( '[data-ctxc-inline]' ), function ( btn ) {
			var template = btn.getAttribute( 'data-ctxc-template' ) || '';
			var ids = ( btn.getAttribute( 'data-ctxc-agents' ) || '' ).split( ',' ).filter( Boolean );
			var source = btn.getAttribute( 'data-ctxc-source' ) || 'shortcode';
			var rule = btn.getAttribute( 'data-ctxc-rule' ) || '';

			btn.addEventListener( 'click', function ( e ) {
				var floatVisible = panel && rootEl && ! rootEl.hidden && win.getComputedStyle( rootEl ).display !== 'none';
				if ( floatVisible && ids.length > 1 ) {
					var shared = ids.filter( function ( id ) {
						return panelAgentIds().indexOf( id ) > -1;
					} );
					if ( shared.length ) {
						e.preventDefault();
						e.stopPropagation();
						openPanel( template, source, rule, shared );
						return;
					}
				}
				var agent = agentById( ids[ 0 ] ) || cfg.agents[ 0 ];
				if ( agent ) {
					btn.href = link( agent.phone, messageFor( template, agent ), cfg.target, mobile );
					track( agent.id, source, rule );
				}
			} );
		} );
	}

	function start() {
		var doc = win.document;
		var el = doc.getElementById( 'contextchat-config' );
		if ( ! el ) {
			return;
		}
		try {
			cfg = JSON.parse( el.textContent );
		} catch ( e ) {
			return;
		}
		cfg.agents = cfg.agents || [];
		cfg.offline = cfg.offline || {};
		cfg.hours = cfg.hours || {};
		cfg.i18n = cfg.i18n || {};
		vars = Object.assign( {}, cfg.vars || {}, clientVars( win.location.href, doc.referrer ) );
		open = isOpen( cfg.hours, new Date() );
		mobile = isMobile();

		setupFloat( doc );
		setupInline( doc );
	}

	function boot() {
		if ( ! win || ! win.document ) {
			return;
		}
		if ( win.document.readyState === 'loading' ) {
			win.document.addEventListener( 'DOMContentLoaded', start );
		} else {
			start();
		}
	}

	return {
		render: render,
		tidy: tidy,
		isOpen: isOpen,
		zonedParts: zonedParts,
		clientVars: clientVars,
		link: link,
		boot: boot,
	};
} ) );

/**
 * ContextChat SI chat (design plan section 14). Loaded only when a visitor first opens the panel
 * and the SI chat is on; contextchat.js then calls ContextChatSI.mount().
 *
 * Everything the server sends is written with textContent, never as HTML. The conversation ID
 * and token live in sessionStorage for this tab only; no cookies. If the chat cannot start, the
 * 1.1 panel (message box and agents) comes back.
 */
( function ( win ) {
	'use strict';

	var STORE = 'ctxc-si';
	var MAX = 1000;

	function el( tag, cls, text ) {
		var node = win.document.createElement( tag );
		if ( cls ) {
			node.className = cls;
		}
		if ( text !== undefined && text !== null ) {
			node.textContent = text;
		}
		return node;
	}

	function rupiah( n ) {
		return 'Rp ' + String( Math.round( Number( n ) || 0 ) ).replace( /\B(?=(\d{3})+(?!\d))/g, '.' );
	}

	function format( s ) {
		var args = Array.prototype.slice.call( arguments, 1 );
		var i = 0;
		return String( s ).replace( /%(\d+\$)?[sd]/g, function ( m, pos ) {
			var v = pos ? args[ parseInt( pos, 10 ) - 1 ] : args[ i++ ];
			return v === undefined ? '' : String( v );
		} );
	}

	function readSession() {
		try {
			var v = JSON.parse( win.sessionStorage.getItem( STORE ) || 'null' );
			return v && v.id && v.token ? v : null;
		} catch ( e ) {
			return null;
		}
	}

	function writeSession( v ) {
		try {
			if ( v ) {
				win.sessionStorage.setItem( STORE, JSON.stringify( v ) );
			} else {
				win.sessionStorage.removeItem( STORE );
			}
		} catch ( e ) {}
	}

	function mount( panel, si, host ) {
		if ( panel.querySelector( '.ctxc-si' ) ) {
			return panel.querySelector( '.ctxc-si' ).ctxcFocus;
		}
		var t = si.i18n || {};
		var body = panel.querySelector( '.ctxc-body' );
		var title = panel.querySelector( '.ctxc-title' );
		var subtitle = panel.querySelector( '.ctxc-subtitle' );
		var saved = { title: title ? title.textContent : '', subtitle: subtitle ? subtitle.textContent : null };
		var session = readSession();
		var busy = false;
		var idleTimer = null;
		var idleDone = false;

		// Layout.
		var root = el( 'div', 'ctxc-si' );
		var log = el( 'div', 'ctxc-si-log' );
		log.setAttribute( 'role', 'log' );
		log.setAttribute( 'aria-live', 'polite' );
		log.setAttribute( 'aria-label', t.log || 'Chat' );
		log.tabIndex = 0;
		var form = el( 'form', 'ctxc-si-form' );
		form.setAttribute( 'novalidate', '' );
		var label = el( 'label', 'ctxc-si-sr', t.label );
		label.htmlFor = 'ctxc-si-input';
		var input = el( 'textarea', 'ctxc-si-input' );
		input.id = 'ctxc-si-input';
		input.rows = 1;
		input.maxLength = MAX;
		input.placeholder = t.placeholder || '';
		input.setAttribute( 'autocomplete', 'off' );
		var count = el( 'span', 'ctxc-si-count', '0/' + MAX );
		count.setAttribute( 'aria-hidden', 'true' );
		var send = el( 'button', 'ctxc-si-send' );
		send.type = 'submit';
		send.setAttribute( 'aria-label', t.send || 'Send' );
		send.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" fill="currentColor"/></svg>';
		form.appendChild( label );
		form.appendChild( input );
		form.appendChild( count );
		form.appendChild( send );
		root.appendChild( log );
		root.appendChild( form );
		body.hidden = true;
		body.parentNode.insertBefore( root, body.nextSibling );
		if ( title && si.title ) {
			title.textContent = si.title;
		}
		if ( subtitle && si.subtitle ) {
			subtitle.textContent = si.subtitle;
		} else if ( ! subtitle && si.subtitle && title ) {
			subtitle = el( 'p', 'ctxc-subtitle ctxc-si-added', si.subtitle );
			title.parentNode.appendChild( subtitle );
		}

		function fallback() {
			// The SI chat is not available: give the visitor the 1.1 panel back.
			writeSession( null );
			clearTimeout( idleTimer );
			root.remove();
			body.hidden = false;
			if ( title ) {
				title.textContent = saved.title;
			}
			if ( subtitle ) {
				if ( subtitle.classList.contains( 'ctxc-si-added' ) ) {
					subtitle.remove();
				} else if ( saved.subtitle !== null ) {
					subtitle.textContent = saved.subtitle;
				}
			}
		}

		function scroll() {
			log.scrollTop = log.scrollHeight;
		}

		function linkify( node, text ) {
			// Only links the server allowed through (the site itself and wa.me) are made clickable.
			var parts = String( text ).split( /(https?:\/\/[^\s]+)/ );
			parts.forEach( function ( part, i ) {
				if ( i % 2 === 1 ) {
					var url = part.replace( /[.,;:!?)]+$/, '' );
					var rest = part.slice( url.length );
					var hostOk = false;
					try {
						var h = new URL( url ).hostname.replace( /^www\./, '' );
						hostOk = h === 'wa.me' || h === String( si.host || '' ).replace( /^www\./, '' );
					} catch ( e ) {}
					if ( hostOk ) {
						var a = el( 'a', null, url );
						a.href = url;
						a.target = '_blank';
						a.rel = 'noopener noreferrer';
						node.appendChild( a );
						node.appendChild( win.document.createTextNode( rest ) );
						return;
					}
				}
				node.appendChild( win.document.createTextNode( part ) );
			} );
		}

		function say( role, text ) {
			if ( ! text ) {
				return null;
			}
			var row = el( 'div', 'ctxc-si-msg is-' + role );
			var bubble = el( 'p', 'ctxc-si-bubble' );
			if ( role === 'visitor' ) {
				bubble.textContent = text;
			} else {
				linkify( bubble, text );
			}
			var sr = el( 'span', 'ctxc-si-sr', ( role === 'visitor' ? t.you : t.assistant ) + ': ' );
			bubble.insertBefore( sr, bubble.firstChild );
			row.appendChild( bubble );
			log.appendChild( row );
			scroll();
			return row;
		}

		function notice( text, url ) {
			if ( text && ! log.querySelector( '.ctxc-si-notice' ) ) {
				var p = el( 'p', 'ctxc-si-notice', text );
				if ( url && /^https?:\/\//i.test( url ) ) {
					var a = el( 'a', '', t.privacy || 'Privacy policy' );
					a.href = url;
					a.target = '_blank';
					a.rel = 'noopener noreferrer';
					p.appendChild( win.document.createTextNode( ' ' ) );
					p.appendChild( a );
				}
				log.insertBefore( p, log.firstChild );
			}
		}

		var typing = null;
		function setTyping( on ) {
			if ( on && ! typing ) {
				typing = el( 'div', 'ctxc-si-typing' );
				typing.appendChild( el( 'span', 'ctxc-si-dot' ) );
				typing.appendChild( el( 'span', 'ctxc-si-dot' ) );
				typing.appendChild( el( 'span', 'ctxc-si-dot' ) );
				typing.appendChild( el( 'span', 'ctxc-si-sr', t.typing ) );
				log.appendChild( typing );
				scroll();
			} else if ( ! on && typing ) {
				typing.remove();
				typing = null;
			}
		}

		function quoteCard( q ) {
			var L = q.labels || {};
			var card = el( 'section', 'ctxc-si-card ctxc-si-quote' );
			var head = el( 'p', 'ctxc-si-card-title', L.title );
			head.appendChild( el( 'span', 'ctxc-si-ref', q.reference ) );
			card.appendChild( head );
			var list = el( 'dl', 'ctxc-si-lines' );
			function row( label, detail, amount, cls ) {
				var dt = el( 'dt', cls || '', label );
				if ( detail ) {
					dt.appendChild( el( 'span', 'ctxc-si-detail', detail ) );
				}
				list.appendChild( dt );
				list.appendChild( el( 'dd', cls || '', amount ) );
			}
			( q.lines || [] ).forEach( function ( line ) {
				row( line.label, line.qty + ' ' + line.unit + ' × ' + rupiah( line.unit_price ), rupiah( line.amount ) );
			} );
			if ( q.express_surcharge ) {
				row( L.express, '', '+' + rupiah( q.express_surcharge ) );
			}
			if ( q.discount ) {
				row( L.discount + ( q.discount_percent ? ' (' + q.discount_percent + '%)' : '' ), '', '−' + rupiah( q.discount ) );
			}
			row( L.total, '', rupiah( q.total ), 'ctxc-si-total' );
			if ( q.deposit ) {
				row( L.deposit, '', rupiah( q.deposit ) );
			}
			card.appendChild( list );
			if ( q.status === 'needs_team' && L.team ) {
				card.appendChild( el( 'p', 'ctxc-si-team', L.team ) );
			}
			card.appendChild( el( 'p', 'ctxc-si-note', L.note + ' ' + format( L.valid, q.valid_days ) + '.' ) );
			log.appendChild( card );
			scroll();
			startIdle();
		}

		function handoffCard( h ) {
			var old = log.querySelector( '.ctxc-si-handoff' );
			if ( old ) {
				old.remove();
			}
			var L = h.labels || {};
			var card = el( 'section', 'ctxc-si-card ctxc-si-handoff' );
			card.appendChild( el( 'p', 'ctxc-si-card-title', L.title ) );
			if ( h.agent ) {
				card.appendChild( el( 'p', 'ctxc-si-agent', h.agent ) );
			}
			var id = 'ctxc-si-summary-' + Date.now();
			var lab = el( 'label', 'ctxc-si-edit-label', L.edit );
			lab.htmlFor = id;
			var text = el( 'textarea', 'ctxc-si-summary' );
			text.id = id;
			text.rows = 6;
			text.value = h.text;
			var buttons = el( 'div', 'ctxc-si-buttons' );
			var wa = null;
			if ( h.phone ) {
				wa = el( 'a', 'ctxc-si-btn ctxc-si-wa', L.whatsapp );
				wa.target = '_blank';
				wa.rel = 'noopener noreferrer';
				buttons.appendChild( wa );
			}
			var mail = null;
			if ( h.email ) {
				mail = el( 'a', 'ctxc-si-btn ctxc-si-mail', L.email );
				buttons.appendChild( mail );
			}
			var edited = false;
			function refresh() {
				var body = text.value;
				if ( wa ) {
					wa.href = host.link( h.phone, body );
				}
				if ( mail ) {
					// The email version greets the team; use it unless the visitor edited the text.
					var mailBody = edited ? body : ( h.email_text || body );
					mail.href = 'mailto:' + h.email + '?subject=' + encodeURIComponent( h.subject || '' ) + '&body=' + encodeURIComponent( mailBody.replace( /\n/g, '\r\n' ) );
				}
			}
			text.addEventListener( 'input', function () {
				edited = true;
				refresh();
			} );
			function logClick( channel ) {
				if ( ! session ) {
					return;
				}
				api( 'handoff', { conversation_id: session.id, token: session.token, channel: channel, text: channel === 'email' && ! edited ? '' : text.value }, true );
			}
			if ( wa ) {
				wa.addEventListener( 'click', function () {
					refresh();
					logClick( 'whatsapp' );
				} );
			}
			if ( mail ) {
				mail.addEventListener( 'click', function () {
					refresh();
					logClick( 'email' );
				} );
			}
			refresh();
			card.appendChild( lab );
			card.appendChild( text );
			card.appendChild( buttons );
			if ( h.hours_note && ! host.online() ) {
				card.appendChild( el( 'p', 'ctxc-si-hours', h.hours_note ) );
			}
			log.appendChild( card );
			scroll();
		}

		function startIdle() {
			if ( idleDone || ! si.idle ) {
				return;
			}
			clearTimeout( idleTimer );
			idleTimer = setTimeout( function () {
				idleDone = true;
				if ( ! session ) {
					return;
				}
				api( 'idle', { conversation_id: session.id, token: session.token } ).then( function ( r ) {
					if ( r.ok && r.json && r.json.handoff ) {
						say( 'assistant', r.json.reply );
						handoffCard( r.json.handoff );
					}
				} );
			}, si.idle );
		}

		function api( route, data, beacon ) {
			var url = si.api + route;
			var opts = { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( data ) };
			if ( beacon ) {
				opts.keepalive = true;
			}
			return win.fetch( url, opts ).then( function ( res ) {
				return res.json().catch( function () {
					return null;
				} ).then( function ( json ) {
					return { ok: res.ok, status: res.status, json: json };
				} );
			} ).catch( function () {
				return { ok: false, status: 0, json: null };
			} );
		}

		function render( json ) {
			if ( ! json ) {
				return;
			}
			say( 'assistant', json.reply );
			if ( json.quote ) {
				quoteCard( json.quote );
			}
			if ( json.handoff ) {
				handoffCard( json.handoff );
			}
		}

		function begin() {
			return api( 'start', { lang: si.lang, page: win.location.href, rule: host.rule(), device: host.mobile ? 'mobile' : 'desktop' } ).then( function ( r ) {
				if ( r.status === 201 && r.json ) {
					session = { id: r.json.conversation_id, token: r.json.token, ref: r.json.reference };
					writeSession( session );
					notice( r.json.notice, r.json.privacy_url );
					say( 'assistant', r.json.greeting );
					return true;
				}
				if ( r.status === 429 && r.json ) {
					say( 'assistant', r.json.reply );
					if ( r.json.handoff ) {
						handoffCard( r.json.handoff );
					}
					return false;
				}
				fallback();
				return false;
			} );
		}

		function resume() {
			return api( 'resume', { conversation_id: session.id, token: session.token } ).then( function ( r ) {
				if ( ! r.ok || ! r.json ) {
					session = null;
					writeSession( null );
					return begin();
				}
				notice( r.json.notice, r.json.privacy_url );
				( r.json.messages || [] ).forEach( function ( m ) {
					say( m.role, m.text );
				} );
				if ( r.json.quote ) {
					idleDone = true; // Offered at most once; do not restart the timer on reload.
					quoteCard( r.json.quote );
				}
				if ( r.json.handoff ) {
					handoffCard( r.json.handoff );
				}
				return true;
			} );
		}

		var ready = session ? resume() : begin();

		function submit() {
			var text = input.value.trim();
			if ( ! text || busy ) {
				return;
			}
			busy = true;
			send.disabled = true;
			clearTimeout( idleTimer );
			say( 'visitor', text );
			input.value = '';
			count.textContent = '0/' + MAX;
			setTyping( true );
			ready.then( function ( ok ) {
				if ( ! ok || ! session ) {
					return { ok: false, status: 0, json: null };
				}
				return api( 'message', { conversation_id: session.id, token: session.token, text: text } );
			} ).then( function ( r ) {
				setTyping( false );
				if ( r.status === 404 ) {
					fallback();
					return;
				}
				if ( r.status === 403 ) {
					// The conversation is gone (expired or deleted): start a new one.
					session = null;
					writeSession( null );
					ready = begin();
				}
				if ( r.json && r.json.reply ) {
					render( r.json );
				} else {
					say( 'error', t.error );
				}
			} ).then( function () {
				busy = false;
				send.disabled = false;
				input.focus();
			} );
		}

		form.addEventListener( 'submit', function ( e ) {
			e.preventDefault();
			submit();
		} );
		input.addEventListener( 'keydown', function ( e ) {
			if ( e.key === 'Enter' && ! e.shiftKey && ! e.isComposing ) {
				e.preventDefault();
				submit();
			}
		} );
		input.addEventListener( 'input', function () {
			count.textContent = input.value.length + '/' + MAX;
			input.style.height = 'auto';
			input.style.height = Math.min( input.scrollHeight, 120 ) + 'px';
			if ( log.querySelector( '.ctxc-si-quote' ) ) {
				startIdle(); // Typing resets the silence timer.
			}
		} );

		// No files: pasted or dropped files are refused here, and links to them on the server.
		function refuseFiles() {
			say( 'assistant', t.upload );
		}
		input.addEventListener( 'paste', function ( e ) {
			var cd = e.clipboardData;
			var hasFile = cd && ( ( cd.files && cd.files.length ) || Array.prototype.some.call( cd.items || [], function ( it ) {
				return it.kind === 'file';
			} ) );
			if ( hasFile ) {
				e.preventDefault();
				refuseFiles();
			}
		} );
		[ 'dragover', 'drop' ].forEach( function ( type ) {
			root.addEventListener( type, function ( e ) {
				var dt = e.dataTransfer;
				if ( dt && Array.prototype.indexOf.call( dt.types || [], 'Files' ) > -1 ) {
					e.preventDefault();
					if ( type === 'drop' ) {
						refuseFiles();
					}
				}
			} );
		} );

		root.ctxcFocus = function () {
			input.focus( { preventScroll: true } );
		};
		root.ctxcFocus();
		return root.ctxcFocus;
	}

	win.ContextChatSI = { mount: mount, rupiah: rupiah };
}( window ) );

/**
 * Corbelwise visitor chat. Vanilla JavaScript, no dependencies. Every text from the server is inserted
 * as text, never as HTML; web addresses in replies become links.
 */
( function () {
	'use strict';

	var STORE = 'cwtk-chat';
	var URL_PATTERN = /(https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?])/g;

	function make( tag, className, text ) {
		var node = document.createElement( tag );
		if ( className ) {
			node.className = className;
		}
		if ( text ) {
			node.textContent = text;
		}
		return node;
	}

	function load() {
		try {
			var saved = JSON.parse( window.sessionStorage.getItem( STORE ) || 'null' );
			return saved && Array.isArray( saved.history ) ? saved : { history: [], open: false };
		} catch ( e ) {
			return { history: [], open: false };
		}
	}

	function save( state ) {
		try {
			window.sessionStorage.setItem( STORE, JSON.stringify( { history: state.history.slice( -20 ), open: state.open } ) );
		} catch ( e ) {
			// Storage can be blocked; the conversation then lasts for this page only.
		}
	}

	// Append text to a node, turning web addresses into links.
	function appendRich( node, text ) {
		var last = 0;
		text.replace( URL_PATTERN, function ( url, _m, offset ) {
			if ( offset > last ) {
				node.appendChild( document.createTextNode( text.slice( last, offset ) ) );
			}
			var link = make( 'a', '', url );
			link.href = url;
			if ( url.indexOf( window.location.origin ) !== 0 ) {
				link.target = '_blank';
				link.rel = 'noopener noreferrer';
			}
			node.appendChild( link );
			last = offset + url.length;
			return url;
		} );
		if ( last < text.length ) {
			node.appendChild( document.createTextNode( text.slice( last ) ) );
		}
	}

	function Chat( root, config ) {
		var labels = config.labels || {};
		var floating = config.mode === 'floating';
		var state = load();
		var busy = false;
		var uid = 'cwtk-chat-' + Math.random().toString( 36 ).slice( 2, 8 );

		var panel = make( 'div', 'cwtk-chat__panel' );
		panel.id = uid;
		panel.setAttribute( 'role', floating ? 'dialog' : 'region' );
		panel.setAttribute( 'aria-labelledby', uid + '-title' );

		var header = make( 'div', 'cwtk-chat__header' );
		var title = make( 'h2', 'cwtk-chat__title', config.title || labels.open );
		title.id = uid + '-title';
		header.appendChild( title );

		var log = make( 'div', 'cwtk-chat__log' );
		log.setAttribute( 'role', 'log' );
		log.setAttribute( 'aria-live', 'polite' );

		var form = make( 'form', 'cwtk-chat__form' );
		var input = make( 'textarea', 'cwtk-chat__input' );
		input.rows = 1;
		input.maxLength = config.max || 600;
		input.placeholder = labels.placeholder || '';
		input.setAttribute( 'aria-label', labels.placeholder || '' );
		var send = make( 'button', 'cwtk-chat__send', labels.send );
		send.type = 'submit';
		form.appendChild( input );
		form.appendChild( send );

		panel.appendChild( header );
		panel.appendChild( log );
		panel.appendChild( form );
		if ( config.note ) {
			panel.appendChild( make( 'p', 'cwtk-chat__note', config.note ) );
		}

		var launcher = null;
		if ( floating ) {
			var close = make( 'button', 'cwtk-chat__close' );
			close.type = 'button';
			close.setAttribute( 'aria-label', labels.close || 'Close' );
			close.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
			close.addEventListener( 'click', function () {
				setOpen( false, true );
			} );
			header.appendChild( close );

			launcher = make( 'button', 'cwtk-chat__launcher' );
			launcher.type = 'button';
			launcher.setAttribute( 'aria-expanded', 'false' );
			launcher.setAttribute( 'aria-controls', uid );
			launcher.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6c-.6.5-1.3.1-1.3-.6V16A2.5 2.5 0 0 1 4 13.5v-8Z" fill="currentColor"/></svg>';
			launcher.appendChild( make( 'span', 'cwtk-chat__sr', labels.open ) );
			launcher.addEventListener( 'click', function () {
				setOpen( panel.hidden );
			} );
			root.appendChild( launcher );
			panel.hidden = true;
		}
		root.appendChild( panel );

		function bubble( role, text, extraClass ) {
			var item = make( 'div', 'cwtk-chat__msg cwtk-chat__msg--' + role + ( extraClass ? ' ' + extraClass : '' ) );
			item.appendChild( make( 'span', 'cwtk-chat__sr', ( role === 'user' ? labels.you : labels.assistant ) + ': ' ) );
			var body = make( 'div', 'cwtk-chat__text' );
			appendRich( body, text );
			item.appendChild( body );
			log.appendChild( item );
			log.scrollTop = log.scrollHeight;
			return item;
		}

		function render() {
			log.textContent = '';
			if ( config.greeting ) {
				bubble( 'assistant', config.greeting, 'cwtk-chat__msg--greeting' );
			}
			state.history.forEach( function ( m ) {
				bubble( m.role, m.content );
			} );
		}

		function setOpen( open, returnFocus ) {
			if ( ! floating ) {
				return;
			}
			panel.hidden = ! open;
			launcher.setAttribute( 'aria-expanded', open ? 'true' : 'false' );
			root.classList.toggle( 'is-open', open );
			state.open = open;
			save( state );
			if ( open ) {
				log.scrollTop = log.scrollHeight;
				input.focus();
			} else if ( returnFocus ) {
				launcher.focus();
			}
		}

		// The API needs a conversation that starts with the visitor.
		function outgoing() {
			var recent = state.history.slice( -11 );
			while ( recent.length && recent[ 0 ].role !== 'user' ) {
				recent.shift();
			}
			return recent;
		}

		function ask( question ) {
			busy = true;
			send.disabled = true;
			state.history.push( { role: 'user', content: question } );
			save( state );
			bubble( 'user', question );
			var waiting = bubble( 'assistant', labels.thinking, 'is-waiting' );

			window.fetch( config.endpoint, {
				method: 'POST',
				credentials: 'omit',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { token: config.token, page: window.location.href, messages: outgoing() } ),
			} ).then( function ( response ) {
				return response.json().catch( function () {
					return {};
				} ).then( function ( data ) {
					return { ok: response.ok, data: data };
				} );
			} ).then( function ( result ) {
				log.removeChild( waiting );
				if ( result.ok && result.data && typeof result.data.reply === 'string' ) {
					state.history.push( { role: 'assistant', content: result.data.reply } );
					save( state );
					bubble( 'assistant', result.data.reply );
				} else {
					// Forget the unanswered question so the next request still alternates turns.
					state.history.pop();
					save( state );
					bubble( 'assistant', ( result.data && result.data.message ) || labels.error, 'is-error' );
				}
			} ).catch( function () {
				log.removeChild( waiting );
				state.history.pop();
				save( state );
				bubble( 'assistant', labels.error, 'is-error' );
			} ).then( function () {
				busy = false;
				send.disabled = false;
			} );
		}

		form.addEventListener( 'submit', function ( event ) {
			event.preventDefault();
			var question = input.value.trim();
			if ( ! question || busy ) {
				return;
			}
			if ( question.length > ( config.max || 600 ) ) {
				bubble( 'assistant', labels.tooLong, 'is-error' );
				return;
			}
			input.value = '';
			input.style.height = '';
			ask( question );
		} );

		input.addEventListener( 'keydown', function ( event ) {
			if ( event.key === 'Enter' && ! event.shiftKey && ! event.isComposing ) {
				event.preventDefault();
				form.requestSubmit ? form.requestSubmit() : send.click();
			}
		} );

		input.addEventListener( 'input', function () {
			input.style.height = '';
			input.style.height = Math.min( input.scrollHeight, 140 ) + 'px';
		} );

		panel.addEventListener( 'keydown', function ( event ) {
			if ( event.key === 'Escape' && floating ) {
				setOpen( false, true );
			}
		} );

		render();
		if ( floating && state.open ) {
			panel.hidden = false;
			launcher.setAttribute( 'aria-expanded', 'true' );
			root.classList.add( 'is-open' );
		}
	}

	function init() {
		var roots = document.querySelectorAll( '[data-cwtk-chat]' );
		for ( var i = 0; i < roots.length; i++ ) {
			try {
				new Chat( roots[ i ], JSON.parse( roots[ i ].getAttribute( 'data-cwtk-chat' ) ) );
			} catch ( e ) {
				// A broken configuration leaves the page as it is.
			}
		}
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', init );
	} else {
		init();
	}
} )();

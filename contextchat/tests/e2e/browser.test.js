// End-to-end tests in a real browser against a live WordPress site.
// Run through tests/e2e/run.sh, which builds the site and starts the server.
const test = require( 'node:test' );
const assert = require( 'node:assert/strict' );
const path = require( 'node:path' );
const { execFileSync } = require( 'node:child_process' );
const http = require( 'node:http' );
const { chromium } = require( 'playwright' );

const BASE = process.env.CTXC_BASE || 'http://127.0.0.1:8899';
const SITE = process.env.CTXC_SITE;
const SHOTS = process.env.CTXC_SHOTS || '';

function option( action, name, value ) {
	const args = [ path.join( __dirname, 'option.php' ), SITE, action, name ];
	if ( value !== undefined ) {
		args.push( JSON.stringify( value ) );
	}
	const out = execFileSync( 'php', args ).toString().trim();
	return action === 'get' ? JSON.parse( out ) : null;
}

// A stand-in for the Claude Messages API. It records each request and answers as the model
// that was asked for, so the tests can see which model ContextChat routed to.
const MOCK_KEY = 'sk-ant-api03-e2eTestKey-0123456789abcdef';
const mockRequests = [];
// Scripted replies for the chat tests: each entry is a function( body ) returning the response body,
// or { status, data } for an error. When the script is empty the mock answers with a greeting.
const mockScript = [];
let mockServer;
function startMock() {
	mockServer = http.createServer( ( req, res ) => {
		let raw = '';
		req.on( 'data', ( chunk ) => ( raw += chunk ) );
		req.on( 'end', () => {
			const body = JSON.parse( raw || '{}' );
			mockRequests.push( { headers: req.headers, body } );
			res.setHeader( 'content-type', 'application/json' );
			if ( req.headers[ 'x-api-key' ] !== MOCK_KEY ) {
				res.statusCode = 401;
				res.end( JSON.stringify( { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } ) );
				return;
			}
			if ( mockScript.length ) {
				const out = mockScript.shift()( body );
				res.statusCode = out.status || 200;
				res.end( JSON.stringify( out.data || out ) );
				return;
			}
			const name = body.model.includes( 'sonnet' ) ? 'Sonnet' : 'Haiku';
			res.end( JSON.stringify( {
				id: 'msg_test', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn',
				content: [ { type: 'thinking', thinking: '' }, { type: 'text', text: 'Halo dari ' + name + ', Kak.' } ],
				usage: { input_tokens: 40, output_tokens: 12 },
			} ) );
		} );
	} );
	return new Promise( ( resolve ) => mockServer.listen( 0, '127.0.0.1', resolve ) );
}

function chatCheck( id ) {
	return JSON.parse( execFileSync( 'php', [ path.join( __dirname, 'chat-check.php' ), SITE, id ] ).toString() );
}

function mockText( text ) {
	return ( body ) => ( {
		id: 'msg_t', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn',
		content: [ { type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text } ],
		usage: { input_tokens: 300, output_tokens: 40, cache_read_input_tokens: 4000 },
	} );
}

function mockTools( calls ) {
	return ( body ) => ( {
		id: 'msg_t', type: 'message', role: 'assistant', model: body.model, stop_reason: 'tool_use',
		content: [ { type: 'thinking', thinking: '', signature: 's' } ].concat( calls.map( ( c, i ) => ( { type: 'tool_use', id: 'toolu_' + i, name: c[ 0 ], input: c[ 1 ] } ) ) ),
		usage: { input_tokens: 300, output_tokens: 60, cache_creation_input_tokens: 4000 },
	} );
}

async function chatApi( route, body, method = 'POST', headers = {} ) {
	const url = BASE + '/wp-json/contextchat/v1/chat/' + route + ( method === 'GET' ? '?' + new URLSearchParams( body ) : '' );
	const res = await fetch( url, { method, headers: Object.assign( { 'Content-Type': 'application/json' }, headers ), body: method === 'GET' ? undefined : JSON.stringify( body ) } );
	return { status: res.status, json: await res.json(), cache: res.headers.get( 'cache-control' ) };
}

function settings( changes ) {
	execFileSync( 'php', [ path.join( __dirname, 'set-settings.php' ), SITE, JSON.stringify( changes ) ] );
}

let browser;
let opened = [];
// Script errors raised from ContextChat's files fail the run. The npm build of WordPress leaves
// out many core scripts (Playground fetches them on demand), so core errors are only counted.
const pageErrors = [];
let coreErrors = 0;

async function newPage( options = {} ) {
	const context = await browser.newContext( { viewport: { width: 1280, height: 800 }, ...options } );
	// Never really leave for WhatsApp: record where we would have gone instead.
	await context.route( /^https:\/\/(wa\.me|web\.whatsapp\.com)\//, ( route ) => {
		opened.push( route.request().url() );
		route.fulfill( { status: 200, contentType: 'text/plain', body: 'whatsapp' } );
	} );
	const page = await context.newPage();
	page.on( 'pageerror', ( err ) => {
		if ( /\/plugins\/contextchat\//.test( String( err.stack ) ) ) {
			pageErrors.push( { url: page.url(), message: err.message, stack: err.stack } );
		} else {
			coreErrors++;
		}
	} );
	return page;
}

async function shot( page, name, selector ) {
	if ( ! SHOTS ) {
		return;
	}
	// Let entrance animations finish; the launcher's pulse may keep running.
	await page.waitForFunction( () => document.getAnimations().every( ( a ) => a.playState !== 'running' || a.animationName === 'ctxc-pulse' ) );
	const file = path.join( SHOTS, name + '.png' );
	// Admin screens: only the plugin's own area, since the test build lacks core admin styles.
	await ( selector ? page.locator( selector ).screenshot( { path: file } ) : page.screenshot( { path: file } ) );
}

async function login( page ) {
	await page.goto( BASE + '/wp-login.php' );
	await page.fill( '#user_login', 'admin' );
	await page.fill( '#user_pass', 'password' );
	await page.click( '#wp-submit' );
	await page.waitForURL( /wp-admin/ );
}

function textOf( url ) {
	return new URL( url ).searchParams.get( 'text' );
}

test.before( async () => {
	browser = await chromium.launch();
	await startMock();
	option( 'set', 'ctxc_e2e_si_url', 'http://127.0.0.1:' + mockServer.address().port + '/v1/messages' );
} );

test.after( async () => {
	await browser.close();
	mockServer.close();
	option( 'delete', 'ctxc_e2e_si_url' );
	console.log( `Script errors from incomplete core files in the test build (ignored): ${ coreErrors }` );
} );

test.afterEach( () => {
	assert.deepEqual( pageErrors.splice( 0 ), [], 'no script errors from ContextChat' );
} );

test.beforeEach( () => {
	opened = [];
} );

test( 'visa page: the rule picks the visa message and routes to the visa desk', async () => {
	const page = await newPage();
	await page.goto( BASE + '/visa-translation/' );
	const launcher = page.locator( '#contextchat .ctxc-launcher' );
	await launcher.waitFor();
	assert.equal( await launcher.getAttribute( 'aria-expanded' ), 'false' );

	await launcher.click();
	const panel = page.locator( '#ctxc-panel' );
	await panel.waitFor();
	assert.equal( await launcher.getAttribute( 'aria-expanded' ), 'true' );
	assert.equal( await page.locator( '#ctxc-panel .ctxc-agents li:not([hidden])' ).count(), 1 );
	assert.match( await page.locator( '.ctxc-agent-name' ).first().textContent(), /Budi/ );

	const composer = page.locator( '#ctxc-composer' );
	assert.equal(
		await composer.inputValue(),
		'Hi Budi Santoso! I need a sworn translation for a visa application. Page: ' + BASE + '/visa-translation/'
	);
	assert.equal( await page.evaluate( () => document.activeElement.id ), 'ctxc-composer' );
	await shot( page, 'desktop-panel-visa' );

	const beacon = page.waitForRequest( ( r ) => r.url().includes( '/wp-json/contextchat/v1/click' ) );
	const popup = page.context().waitForEvent( 'page' );
	await page.locator( '.ctxc-agent' ).first().click();
	const req = await beacon;
	await popup;
	const body = JSON.parse( req.postData() );
	assert.deepEqual( { agent: body.agent, source: body.source, rule: body.rule, device: body.device }, { agent: 'budi', source: 'float', rule: 'visa', device: 'desktop' } );

	assert.equal( opened.length, 1 );
	assert.ok( opened[ 0 ].startsWith( 'https://web.whatsapp.com/send?phone=6281333334444&text=' ), opened[ 0 ] );
	assert.match( textOf( opened[ 0 ] ), /visa application/ );
	await page.context().close();
} );

test( 'the visitor can edit the message before sending', async () => {
	const page = await newPage();
	await page.goto( BASE + '/visa-translation/' );
	await page.locator( '.ctxc-launcher' ).click();
	// What the visitor types is sent as typed: spacing before punctuation and emoticons included.
	const typed = 'Hello, I need 3 documents (a passport, 2 diplomas) translated by Friday :) Is that possible ?';
	await page.locator( '#ctxc-composer' ).fill( typed );
	const popup = page.context().waitForEvent( 'page' );
	await page.locator( '.ctxc-agent' ).first().click();
	await popup;
	assert.equal( textOf( opened[ 0 ] ), typed );
	await page.context().close();
} );

test( 'contact page: default message, both agents, and a shortcode for one agent', async () => {
	const page = await newPage();
	await page.goto( BASE + '/contact/' );
	await page.locator( '.ctxc-launcher' ).click();
	assert.equal( await page.locator( '#ctxc-panel .ctxc-agents li:not([hidden])' ).count(), 2 );
	assert.equal( await page.locator( '#ctxc-composer' ).inputValue(), 'Hi! I have a question about "Contact" (' + BASE + '/contact/).' );

	await page.keyboard.press( 'Escape' );
	assert.equal( await page.locator( '#ctxc-panel' ).isHidden(), true );
	assert.equal( await page.evaluate( () => document.activeElement.classList.contains( 'ctxc-launcher' ) ), true );

	const inline = page.locator( 'a.ctxc-inline' );
	assert.equal( await inline.textContent(), 'Message Rina' );
	const popup = page.context().waitForEvent( 'page' );
	await inline.click();
	await popup;
	assert.ok( opened[ 0 ].includes( 'phone=6281211112222' ), opened[ 0 ] );
	assert.equal( textOf( opened[ 0 ] ), 'Hi! I have a question about "Contact" (' + BASE + '/contact/).' );
	await page.context().close();
} );

test( 'a message set on the page uses campaign tags from the address', async () => {
	const page = await newPage();
	await page.goto( BASE + '/interpreting/?utm_source=instagram&utm_campaign=autumn' );
	await page.locator( '.ctxc-launcher' ).click();
	assert.equal( await page.locator( '#ctxc-composer' ).inputValue(), 'Hello! I need an interpreter. I found you via instagram.' );
	await page.goto( BASE + '/interpreting/' );
	await page.locator( '.ctxc-launcher' ).click();
	assert.equal( await page.locator( '#ctxc-composer' ).inputValue(), 'Hello! I need an interpreter. I found you via your website.' );
	await page.context().close();
} );

test( 'a page can hide the button', async () => {
	const page = await newPage();
	await page.goto( BASE + '/checkout/' );
	assert.equal( await page.locator( '#contextchat' ).count(), 0 );
	await page.context().close();
} );

test( 'product page: product button carries name, price and SKU and opens the panel', async () => {
	const page = await newPage();
	await page.goto( BASE + '/product/certified-translation/' );
	const btn = page.locator( '.ctxc-product a.ctxc-inline' );
	await btn.waitFor();
	const expected = "Hi! I'd like to order Certified Translation – 1 page (Rp150.000, SKU TR-001). " + BASE + '/product/certified-translation/';
	assert.equal( textOf( await btn.getAttribute( 'href' ) ), expected );

	await btn.click();
	await page.locator( '#ctxc-panel' ).waitFor();
	assert.equal( await page.locator( '#ctxc-composer' ).inputValue(), expected );
	await shot( page, 'desktop-product' );

	const beacon = page.waitForRequest( ( r ) => r.url().includes( '/contextchat/v1/click' ) );
	const popup = page.context().waitForEvent( 'page' );
	await page.locator( '.ctxc-agent' ).nth( 1 ).click();
	const body = JSON.parse( ( await beacon ).postData() );
	await popup;
	assert.equal( body.source, 'product' );
	assert.equal( body.rule, 'legal' );
	await page.context().close();
} );

test( 'phones: icon-only button, bottom sheet, and wa.me links', async () => {
	const page = await newPage( { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' } );
	await page.goto( BASE + '/contact/' );
	assert.equal( await page.locator( '.ctxc-launcher-label' ).isVisible(), false );
	await shot( page, 'mobile-closed' );
	await page.locator( '.ctxc-launcher' ).tap();
	await page.waitForFunction( () => document.getElementById( 'ctxc-panel' ).getAnimations().every( ( a ) => a.playState === 'finished' ) );
	const box = await page.locator( '#ctxc-panel' ).boundingBox();
	assert.equal( Math.round( box.width ), 390 );
	assert.equal( Math.round( box.y + box.height ), 844 );
	await shot( page, 'mobile-panel' );
	const popup = page.context().waitForEvent( 'page' );
	await page.locator( '.ctxc-agent' ).first().tap();
	await popup;
	assert.ok( opened[ 0 ].startsWith( 'https://wa.me/6281211112222?text=' ), opened[ 0 ] );
	await page.context().close();
} );

test( 'opening hours: offline agents, the offline note, and the offline suffix', async () => {
	const closed = Array.from( { length: 7 }, () => ( { on: false, start: '09:00', end: '17:00' } ) );
	settings( { hours_enabled: true, hours: closed, offline_suffix: '(Sent outside business hours.)' } );
	try {
		const page = await newPage();
		await page.goto( BASE + '/contact/' );
		await page.locator( '.ctxc-launcher' ).click();
		assert.equal( await page.locator( '.ctxc-offline' ).isVisible(), true );
		const agents = page.locator( '.ctxc-agent' );
		assert.equal( await agents.nth( 0 ).getAttribute( 'class' ), 'ctxc-agent is-offline' );
		assert.equal( await agents.nth( 1 ).getAttribute( 'class' ), 'ctxc-agent' );
		assert.ok( ! ( await page.locator( '#ctxc-composer' ).inputValue() ).includes( 'business hours' ), 'the offline note is not shown in the composer' );
		await shot( page, 'desktop-offline' );

		const popup = page.context().waitForEvent( 'page' );
		await agents.nth( 0 ).click();
		await popup;
		assert.ok( textOf( opened[ 0 ] ).endsWith( '\n\n(Sent outside business hours.)' ), textOf( opened[ 0 ] ) );
		await page.context().close();

		// With nobody marked "always available", everyone is offline and the button hides.
		settings( {
			offline_behavior: 'hide',
			agents: [
				{ id: 'rina', name: 'Rina Kartika', role: 'Quotes & orders', phone: '+6281211112222' },
				{ id: 'budi', name: 'Budi Santoso', role: 'Visa document desk', phone: '+6281333334444' },
			],
		} );
		const page2 = await newPage();
		await page2.goto( BASE + '/contact/' );
		assert.equal( await page2.locator( '#contextchat' ).isHidden(), true );
		await page2.context().close();
	} finally {
		settings( {
			hours_enabled: false,
			offline_behavior: 'note',
			offline_suffix: '',
			agents: [
				{ id: 'rina', name: 'Rina Kartika', role: 'Quotes & orders', phone: '+6281211112222' },
				{ id: 'budi', name: 'Budi Santoso', role: 'Visa document desk', phone: '+6281333334444', always: true },
			],
		} );
	}
} );

test( 'direct mode skips the panel', async () => {
	settings( { mode: 'direct' } );
	try {
		const page = await newPage();
		await page.goto( BASE + '/contact/' );
		assert.equal( await page.locator( '#ctxc-panel' ).count(), 0 );
		const popup = page.context().waitForEvent( 'page' );
		await page.locator( '.ctxc-launcher' ).click();
		await popup;
		assert.equal( opened.length, 1 );
		await page.context().close();
	} finally {
		settings( { mode: 'widget' } );
	}
} );

test( 'a delayed button arrives on time, with or without the script', async () => {
	settings( { delay: 3 } );
	try {
		for ( const javaScriptEnabled of [ true, false ] ) {
			const page = await newPage( { javaScriptEnabled } );
			await page.goto( BASE + '/contact/' );
			const launcher = page.locator( '#contextchat .ctxc-launcher' );
			assert.equal( await launcher.isVisible(), false, 'hidden at first, script ' + ( javaScriptEnabled ? 'on' : 'off' ) );
			await launcher.waitFor( { state: 'visible', timeout: 8000 } );
			assert.match( await launcher.getAttribute( 'href' ), /^https:\/\/wa\.me\/6281211112222\?text=/ );
			await page.context().close();
		}
	} finally {
		settings( { delay: 0 } );
	}
} );

test( 'opening hours: the button hides when the agents it offers are all offline', async () => {
	// Budi is always available, but the visa rule is the only place he is offered; Rina is offline.
	const closed = Array.from( { length: 7 }, () => ( { on: false, start: '09:00', end: '17:00' } ) );
	settings( { hours_enabled: true, hours: closed, offline_behavior: 'hide' } );
	try {
		const page = await newPage();
		await page.goto( BASE + '/visa-translation/' );
		assert.equal( await page.locator( '#contextchat' ).isVisible(), true, 'the visa desk is available' );
		await page.context().close();

		settings( { mode: 'direct' } );
		const page2 = await newPage();
		await page2.goto( BASE + '/contact/' );
		assert.equal( await page2.locator( '#contextchat' ).isHidden(), true, 'direct mode leads to Rina, who is offline' );
		await page2.context().close();
	} finally {
		settings( { hours_enabled: false, offline_behavior: 'note', mode: 'widget' } );
	}
} );

test( 'Indonesian: front-end and block editor strings are translated', async () => {
	const info = JSON.parse( execFileSync( 'php', [ path.join( __dirname, 'set-language.php' ), SITE, 'id_ID' ] ).toString() );
	try {
		assert.equal( info.locale, 'id_ID' );
		assert.deepEqual( info.block[ 'ContextChat button' ], [ 'Tombol ContextChat' ] );

		const page = await newPage();
		await page.goto( BASE + '/contact/' );
		await page.locator( '.ctxc-launcher' ).click();
		assert.equal( await page.locator( '.ctxc-close' ).getAttribute( 'aria-label' ), 'Tutup jendela chat' );
		assert.equal( await page.locator( '.ctxc-composer-label' ).textContent(), 'Pesan Anda' );
		assert.equal( await page.locator( '.ctxc-agents' ).getAttribute( 'aria-label' ), 'Pilih yang ingin Anda hubungi' );
		await page.context().close();

		// The settings screen: placeholder tooltips and the photo button are translated too.
		const admin = await newPage();
		await login( admin );
		await admin.goto( BASE + '/wp-admin/admin.php?page=contextchat#ctxc-tab-routing' );
		assert.equal( await admin.locator( '#ctxc-tab-general .ctxc-chip[data-insert="{page_title}"]' ).getAttribute( 'title' ), 'Judul halaman' );
		assert.equal( await admin.locator( '.ctxc-agent-row .ctxc-avatar-remove' ).first().textContent(), 'Hapus foto' );
		await admin.context().close();
	} finally {
		execFileSync( 'php', [ path.join( __dirname, 'set-language.php' ), SITE, '' ] );
	}
} );

test( 'admin: settings save through the form and analytics count the clicks', async () => {
	const page = await newPage();
	await login( page );

	await page.goto( BASE + '/wp-admin/admin.php?page=contextchat#ctxc-tab-appearance' );
	await page.fill( '#ctxc-label', 'Ask us anything' );
	await page.click( '#submit' );
	await page.waitForURL( /settings-updated=true/ );
	assert.equal( await page.locator( '.ctxc-tab[data-tab="appearance"]' ).isVisible(), true, 'returns to the same tab' );

	// Saving the form must keep agents and rules exactly as they were.
	const front = await newPage();
	await front.goto( BASE + '/visa-translation/' );
	assert.equal( await front.locator( '.ctxc-launcher-label' ).textContent(), 'Ask us anything' );
	await front.locator( '.ctxc-launcher' ).click();
	assert.match( await front.locator( '#ctxc-composer' ).inputValue(), /^Hi Budi Santoso! I need a sworn translation/ );
	await front.context().close();

	await page.goto( BASE + '/wp-admin/admin.php?page=contextchat#ctxc-tab-routing' );
	await page.locator( '.ctxc-repeater[data-repeater="rules"] .ctxc-add' ).click();
	const rows = page.locator( '.ctxc-repeater[data-repeater="rules"] .ctxc-row' );
	assert.equal( await rows.count(), 3 );
	await shot( page, 'admin-routing', '.ctxc-admin' );

	// Every field keeps its own ID, however many rows are added.
	await page.locator( '.ctxc-repeater[data-repeater="rules"] .ctxc-add' ).click();
	const ids = await page.locator( '.ctxc-form [id]' ).evaluateAll( ( nodes ) => nodes.map( ( n ) => n.id ) );
	assert.equal( new Set( ids ).size, ids.length, 'no duplicate IDs: ' + ids.filter( ( id, i ) => ids.indexOf( id ) !== i ).join( ', ' ) );

	// Tabs work from the keyboard.
	await page.locator( '#ctxc-tablink-routing' ).focus();
	await page.keyboard.press( 'ArrowRight' );
	assert.equal( await page.locator( '#ctxc-tablink-appearance' ).getAttribute( 'aria-selected' ), 'true' );
	assert.equal( await page.locator( '#ctxc-tab-appearance' ).isVisible(), true );

	// A new agent without a number, left behind on another tab: saving leads back to it.
	await page.locator( '#ctxc-tablink-routing' ).click();
	await page.locator( '.ctxc-repeater[data-repeater="agents"] .ctxc-add' ).click();
	await page.locator( '#ctxc-tablink-general' ).click();
	assert.equal( await page.locator( '#ctxc-tab-routing' ).isVisible(), false );
	await page.click( '#submit' );
	assert.equal( await page.locator( '#ctxc-tab-routing' ).isVisible(), true, 'the tab with the empty required field opens' );
	assert.doesNotMatch( page.url(), /settings-updated/ );

	// A photo can be taken off again with a button.
	const newAgent = page.locator( '.ctxc-agent-row' ).last();
	assert.equal( await newAgent.locator( '.ctxc-avatar-remove' ).isHidden(), true );
	if ( ! ( await page.evaluate( () => !! ( window.wp && window.wp.media ) ) ) ) {
		// The test build has no media library, so the picker asks for an address instead.
		page.once( 'dialog', ( dialog ) => dialog.accept( BASE + '/photo.jpg' ) );
		await newAgent.locator( '.ctxc-avatar-btn' ).click();
		assert.equal( await newAgent.locator( '.ctxc-avatar-url' ).inputValue(), BASE + '/photo.jpg' );
		await newAgent.locator( '.ctxc-avatar-remove' ).click();
		assert.equal( await newAgent.locator( '.ctxc-avatar-url' ).inputValue(), '' );
		assert.equal( await newAgent.locator( '.ctxc-avatar-remove' ).isHidden(), true );
	}

	await page.goto( BASE + '/wp-admin/admin.php?page=contextchat-analytics&range=7' );
	const total = Number( ( await page.locator( '.ctxc-card-value' ).first().textContent() ).replace( /\D/g, '' ) );
	assert.ok( total >= 4, 'clicks from the earlier tests were counted, got ' + total );
	assert.match( await page.locator( '.ctxc-panel-box' ).nth( 1 ).textContent(), /visa-translation/ );
	await shot( page, 'admin-analytics', '.ctxc-admin' );
	await page.context().close();

	settings( { label: 'Chat with us' } );
} );

test( 'click endpoint validates input and limits bursts', async () => {
	const post = ( data ) => fetch( BASE + '/wp-json/contextchat/v1/click', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( data ) } );
	assert.equal( ( await post( { source: 'evil' } ) ).status, 400 );
	assert.equal( ( await post( { device: 'toaster' } ) ).status, 400 );
	const statuses = [];
	for ( let i = 0; i < 25; i++ ) {
		statuses.push( ( await post( { source: 'shortcode', path: '/burst/' } ) ).status );
	}
	assert.ok( statuses.includes( 429 ), 'rate limit applied: ' + statuses.join( ',' ) );
} );

test( 'SI tab: the API key is stored encrypted and the models route automatically', async () => {
	const page = await newPage();
	await login( page );
	const tab = BASE + '/wp-admin/admin.php?page=contextchat#ctxc-tab-si';
	await page.goto( tab );
	assert.match( await page.locator( '.ctxc-si-key-status' ).textContent(), /No key yet/ );
	assert.equal( await page.locator( '#ctxc-si-test-run' ).isDisabled(), true, 'no test without a key' );

	// Only administrators can run the test.
	const anon = await fetch( BASE + '/wp-json/contextchat/v1/admin/si-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"prompt":"hi"}' } );
	assert.equal( anon.status, 401 );

	// Something that is not a key is refused and nothing is stored.
	await page.fill( '#ctxc-si_api_key', 'hello' );
	await page.click( '#submit' );
	await page.waitForURL( /settings-updated=true/ );
	assert.match( await page.locator( '.notice-error, .error' ).first().textContent(), /does not look like an Anthropic API key/ );
	assert.equal( option( 'get', 'contextchat_si_key' ), null );

	await page.fill( '#ctxc-si_api_key', MOCK_KEY );
	await page.click( '#submit' );
	await page.waitForURL( /settings-updated=true/ );
	assert.equal( await page.locator( '#ctxc-tab-si' ).isVisible(), true, 'returns to the SI tab' );
	assert.match( await page.locator( '.ctxc-si-key-status' ).textContent(), /A key is saved, encrypted/ );
	assert.equal( ( await page.content() ).includes( 'e2eTestKey' ), false, 'the key is never printed back' );
	assert.equal( await page.inputValue( '#ctxc-si_api_key' ), '' );
	const stored = option( 'get', 'contextchat_si_key' );
	assert.ok( stored && stored.box, 'an encrypted key is stored' );
	assert.equal( JSON.stringify( stored ).includes( 'e2eTestKey' ), false, 'the stored key is encrypted' );
	assert.equal( JSON.stringify( option( 'get', 'contextchat_settings' ) ).includes( 'e2eTestKey' ), false, 'the key is not in the main settings' );
	await shot( page, 'admin-si', '.ctxc-admin' );

	// Automatic routing, normal turn: the fast model answers.
	mockRequests.length = 0;
	await page.click( '#ctxc-si-test-run' );
	await page.locator( '.ctxc-si-test-ok' ).waitFor();
	assert.match( await page.locator( '.ctxc-si-test-ok' ).textContent(), /claude-haiku-5-5/ );
	assert.equal( await page.locator( '.ctxc-si-test-reply' ).textContent(), 'Halo dari Haiku, Kak.' );
	assert.equal( mockRequests.length, 1 );
	const sent = mockRequests[ 0 ];
	assert.equal( sent.headers[ 'x-api-key' ], MOCK_KEY );
	assert.equal( sent.headers[ 'anthropic-version' ], '2026-10-21' );
	assert.deepEqual( { model: sent.body.model, effort: sent.body.output_config.effort, max: sent.body.max_tokens }, { model: 'claude-haiku-5-5', effort: 'low', max: 1024 } );
	assert.equal( sent.body.messages[ 0 ].content, 'Hello! What is a sworn translation?' );

	// A reply that fails a check is written again by the stronger model.
	mockRequests.length = 0;
	await page.check( '#ctxc-si-test-reject' );
	await page.click( '#ctxc-si-test-run' );
	await page.locator( '.ctxc-si-test-ok' ).waitFor();
	assert.match( await page.locator( '.ctxc-si-test-ok' ).textContent(), /claude-sonnet-5-5/ );
	assert.deepEqual( mockRequests.map( ( r ) => r.body.model ), [ 'claude-haiku-5-5', 'claude-sonnet-5-5' ] );
	assert.equal( mockRequests[ 1 ].headers[ 'anthropic-beta' ], 'server-side-fallback-2026-07-01' );
	assert.match( mockRequests[ 1 ].body.system, /rejected by an automatic check/ );
	assert.equal( await page.locator( '.ctxc-si-test-attempt' ).count(), 2 );
	await shot( page, 'admin-si-test', '.ctxc-si-test' );

	// Settings save: fast model only, and a daily cap that is already used up.
	await page.goto( tab );
	await page.selectOption( '#ctxc-si_routing', 'worker_only' );
	await page.fill( '#ctxc-si_daily_cap_usd', '0.10' );
	await page.click( '#submit' );
	await page.waitForURL( /settings-updated=true/ );
	const saved = option( 'get', 'contextchat_settings' );
	assert.deepEqual( { routing: saved.si_routing, cap: saved.si_daily_cap_cents }, { routing: 'worker_only', cap: 10 } );
	assert.ok( option( 'get', 'contextchat_si_key' ).box, 'saving other fields keeps the key' );

	mockRequests.length = 0;
	await page.check( '#ctxc-si-test-reject' );
	await page.click( '#ctxc-si-test-run' );
	await page.locator( '.ctxc-si-test-failed' ).waitFor();
	assert.match( await page.locator( '.ctxc-si-test-failed' ).textContent(), /failed a check/ );
	assert.equal( mockRequests.length, 1, 'fast model only: no second model' );

	const today = option( 'get', 'contextchat_si_usage' ).day;
	option( 'set', 'contextchat_si_usage', { day: today, micro_usd: 100000, calls: 1 } );
	mockRequests.length = 0;
	await page.uncheck( '#ctxc-si-test-reject' );
	await page.click( '#ctxc-si-test-run' );
	await page.locator( '.ctxc-si-test-failed' ).waitFor();
	assert.match( await page.locator( '.ctxc-si-test-failed' ).textContent(), /daily spending cap reached/ );
	assert.equal( mockRequests.length, 0, 'nothing is sent once the cap is reached' );

	// Removing the key.
	await page.goto( tab );
	await page.check( 'input[name="contextchat_settings[si_api_key_remove]"]' );
	await page.click( '#submit' );
	await page.waitForURL( /settings-updated=true/ );
	assert.equal( option( 'get', 'contextchat_si_key' ), null );
	assert.match( await page.locator( '.ctxc-si-key-status' ).textContent(), /No key yet/ );
	await page.context().close();

	settings( { si_routing: 'auto', si_daily_cap_cents: 1000 } );
	option( 'delete', 'contextchat_si_usage' );
} );

test( 'Knowledge and Voice tabs: the bundled entries load, edits save, and the bundle can be restored', async () => {
	const page = await newPage();
	await login( page );
	await page.goto( BASE + '/wp-admin/admin.php?page=contextchat#ctxc-tab-knowledge' );
	assert.equal( await page.locator( '#ctxc-tab-knowledge .ctxc-rows .ctxc-knowledge-row' ).count(), 26 );
	assert.match( await page.locator( '.ctxc-knowledge-status' ).textContent(), /bundled entries.*26 entries, about [\d,]+ tokens/s );

	// Edit one entry, remove another, add a new one.
	await page.fill( '#ctxc-kn-0-title', 'Tentang kami' );
	page.once( 'dialog', ( d ) => d.accept() );
	await page.locator( '#ctxc-tab-knowledge .ctxc-knowledge-row' ).nth( 1 ).locator( '.ctxc-remove' ).click();
	await page.click( '#ctxc-tab-knowledge .ctxc-add' );
	const added = page.locator( '#ctxc-tab-knowledge .ctxc-knowledge-row' ).last();
	await added.locator( 'input[name$="[title]"]' ).fill( 'Parkir' );
	await added.locator( 'textarea[name$="[body]"]' ).fill( 'Parkir <b>gratis</b> di gedung.' );

	// Voice: a staff name to block and an edited fixed reply.
	await page.click( '#ctxc-tablink-voice' );
	await page.fill( '#ctxc-voice-names', 'Nama Contoh\nNama Contoh\nOrang Lain' );
	await page.fill( 'textarea[name="contextchat_si_voice[templates][busy][id]"]', 'Maaf, Kak, sedang sibuk.' );
	await page.click( '#submit' );
	await page.waitForURL( /settings-updated=true/ );

	const kn = option( 'get', 'contextchat_si_knowledge' );
	assert.equal( kn.entries.length, 26 );
	assert.equal( kn.entries[ 0 ].title, 'Tentang kami' );
	assert.equal( kn.entries[ 1 ].id, 'tersumpah', 'the second entry was removed' );
	assert.equal( kn.entries[ 25 ].body, 'Parkir gratis di gedung.', 'markup is removed' );
	const voice = option( 'get', 'contextchat_si_voice' );
	assert.deepEqual( voice.names, [ 'Nama Contoh', 'Orang Lain' ] );
	assert.equal( voice.templates.busy.id, 'Maaf, Kak, sedang sibuk.' );
	assert.equal( voice.templates.busy.en, undefined, 'unchanged replies are not stored' );
	assert.deepEqual( voice.examples, [], 'unchanged examples are not stored' );

	// Restore both bundles.
	await page.goto( BASE + '/wp-admin/admin.php?page=contextchat#ctxc-tab-knowledge' );
	assert.match( await page.locator( '.ctxc-knowledge-status' ).textContent(), /your saved entries/ );
	await page.check( 'input[name="contextchat_si_knowledge[reset]"]' );
	await page.click( '#ctxc-tablink-voice' );
	await page.check( 'input[name="contextchat_si_voice[reset]"]' );
	await page.click( '#submit' );
	await page.waitForURL( /settings-updated=true/ );
	assert.deepEqual( option( 'get', 'contextchat_si_knowledge' ), [], 'the bundle is used again' );
	assert.deepEqual( option( 'get', 'contextchat_si_voice' ), [] );
	await page.close();
} );

test( 'SI chat endpoints: start, quote, blocked uploads and IDs, idle offer, handoff, resume, cap', async () => {
	// Off by default: the endpoints refuse.
	assert.equal( ( await chatApi( 'start', { lang: 'id' } ) ).status, 404 );

	const page = await newPage();
	await login( page );
	await page.goto( BASE + '/wp-admin/admin.php?page=contextchat#ctxc-tab-si' );
	await page.fill( '#ctxc-si_api_key', MOCK_KEY );
	await page.check( '#ctxc-si_enabled' );
	await page.fill( '#ctxc-si_business_name', 'Nusalexia' );
	await page.fill( '#ctxc-si_handoff_email', 'info@nusalexia.co.id' );
	await page.click( '#submit' );
	await page.waitForURL( /settings-updated=true/ );
	assert.equal( option( 'get', 'contextchat_settings' ).si_enabled, true );

	const start = await chatApi( 'start', { lang: 'id', page: BASE + '/kontak/?nik=3201234567890001#x', device: 'desktop' } );
	assert.equal( start.status, 201 );
	const { conversation_id: id, token } = start.json;
	assert.match( id, /^[0-9A-HJKMNP-TV-Z]{26}$/ );
	assert.match( token, /^[0-9a-f]{64}$/ );
	assert.match( start.json.reference, /^CC-\d{8}-[2-9A-HJKMNP-TV-Z]{4}$/ );
	assert.match( start.json.greeting, /asisten SI Nusalexia/ );
	assert.match( start.json.notice, /Kecerdasan Sintesis/ );
	assert.equal( chatCheck( id ).conversation.token_hash, undefined, 'the helper hides the hash' );
	assert.equal( start.cache, 'no-store, private' );
	assert.equal( chatCheck( id ).conversation.page_url, '/kontak/', 'only the path is kept' );

	// Too fast for a person: refused without asking the model.
	mockRequests.length = 0;
	const fast = await chatApi( 'message', { conversation_id: id, token, text: 'Halo' } );
	assert.equal( fast.status, 429 );
	assert.equal( mockRequests.length, 0 );
	await new Promise( ( r ) => setTimeout( r, 1600 ) );

	// A quote turn: tool calls, then a reply with the quote's total; the card comes with it.
	mockScript.push(
		mockTools( [
			[ 'record_intake', { service: 'translation', fields: { document_types: [ 'ijazah', 'transkrip' ], source_lang: 'id', target_lang: 'en', documents_count: 2, pages_count: 3, sworn: true, destination: 'Australia' } } ],
			[ 'get_quote', { package: 'sworn', source_lang: 'id', target_lang: 'en', pages: 3, documents: 2, destination_country: 'Australia', legalisation: 'auto' } ],
		] ),
		mockText( 'Untuk terjemahan tersumpah ijazah dan transkrip ke bahasa Inggris dengan apostille, estimasinya Rp 1.775.000, Kak. Rinciannya ada di kartu di bawah. Tenggatnya kapan ya, Kak?' )
	);
	const quoted = await chatApi( 'message', { conversation_id: id, token, text: 'Saya mau terjemahkan ijazah dan transkrip ke bahasa Inggris, 2 dokumen 3 halaman, tersumpah, untuk kuliah di Australia' } );
	assert.equal( quoted.status, 200 );
	assert.match( quoted.json.reply, /Rp 1\.775\.000/ );
	assert.equal( quoted.json.quote.total, 1775000 );
	assert.equal( quoted.json.quote.deposit, 887500 );
	assert.deepEqual( quoted.json.quote.lines.map( ( l ) => l.amount ), [ 375000, 1400000 ] );
	assert.match( quoted.json.quote.labels.note, /Estimasi/ );
	assert.equal( quoted.json.handoff, null );
	assert.equal( mockRequests.length, 2 );
	const first = mockRequests[ 0 ].body;
	assert.equal( first.model, 'claude-haiku-5-5' );
	assert.equal( first.system[ 0 ].cache_control.type, 'ephemeral' );
	assert.match( first.system[ 1 ].text, /^STATE: service=unknown/ );
	assert.deepEqual( first.tools.map( ( t ) => t.name ), [ 'record_intake', 'get_quote', 'lookup_knowledge', 'request_handoff' ] );
	assert.equal( first.messages.at( -1 ).role, 'user' );
	assert.equal( mockRequests[ 1 ].body.messages.at( -1 ).content[ 1 ].type, 'tool_result' );
	let saved = chatCheck( id );
	assert.equal( saved.conversation.status, 'quoted' );
	assert.equal( saved.conversation.service, 'translation' );
	assert.equal( saved.quotes[ 0 ].total, '1775000' );
	assert.ok( Number( saved.conversation.cost_micro_usd ) > 0 );

	// A file link and an ID number never reach the model and are not stored.
	mockRequests.length = 0;
	const upload = await chatApi( 'message', { conversation_id: id, token, text: 'Ini filenya https://drive.google.com/file/d/abc/view' } );
	assert.equal( upload.json.blocked, 'upload' );
	assert.match( upload.json.reply, /tidak bisa dikirim lewat chat ini/ );
	assert.match( upload.json.handoff.text, /Ref: EST-/ );
	const nik = await chatApi( 'message', { conversation_id: id, token, text: 'NIK saya 3201234567890001' } );
	assert.equal( nik.json.blocked, 'pii' );
	assert.equal( mockRequests.length, 0 );
	saved = chatCheck( id );
	assert.equal( JSON.stringify( saved.messages ).includes( '3201234567890001' ), false );
	assert.equal( JSON.stringify( saved.messages ).includes( 'drive.google.com' ), false );
	assert.ok( saved.events.includes( 'blocked_upload:upload,file_host' ) );
	assert.ok( saved.events.includes( 'blocked_pii:pii,nik' ) );

	// Idle after a quote: the handoff is offered once.
	const idle = await chatApi( 'idle', { conversation_id: id, token } );
	assert.match( idle.json.reply, /ringkasannya sudah saya siapkan/ );
	assert.match( idle.json.handoff.text, /Estimasi: Rp 1\.775\.000 \(DP 50%: Rp 887\.500\)/ );
	assert.equal( idle.json.handoff.email, 'info@nusalexia.co.id' );
	assert.equal( ( await chatApi( 'idle', { conversation_id: id, token } ) ).json.handoff, null, 'only once' );

	// Handoff: the visitor's edited text goes into the link.
	const wa = await chatApi( 'handoff', { conversation_id: id, token, channel: 'whatsapp', text: 'Halo, saya dari chat website. Ref: EST-X' } );
	assert.match( wa.json.url, /^https:\/\/(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\// );
	assert.match( decodeURIComponent( wa.json.url ), /Ref: EST-X/ );
	const mail = await chatApi( 'handoff', { conversation_id: id, token, channel: 'email' } );
	assert.match( mail.json.url, /^mailto:info@nusalexia\.co\.id\?subject=%5BNusalexia%5D%20Terjemahan%20Tersumpah%20-%20EST-/ );
	saved = chatCheck( id );
	assert.equal( saved.conversation.status, 'handed_off' );
	assert.ok( saved.events.includes( 'handoff_clicked:whatsapp' ) );

	// Resume in the same tab.
	const resumed = await chatApi( 'resume', { conversation_id: id, token } );
	assert.equal( ( await chatApi( 'resume', { conversation_id: id, token }, 'GET' ) ).status, 404, 'no token in addresses' );
	assert.equal( resumed.json.quote.total, 1775000 );
	assert.deepEqual( resumed.json.messages.map( ( m ) => m.role ).slice( 0, 3 ), [ 'assistant', 'visitor', 'assistant' ] );

	// Bad tokens and other sites are refused.
	assert.equal( ( await chatApi( 'message', { conversation_id: id, token: 'f'.repeat( 64 ), text: 'Halo' } ) ).status, 403 );
	assert.equal( ( await chatApi( 'message', { conversation_id: id, token, text: 'Halo' }, 'POST', { Origin: 'https://evil.example' } ) ).status, 403 );
	assert.equal( ( await chatApi( 'message', { conversation_id: id, token, text: 'x'.repeat( 5000 ) } ) ).status, 413 );

	// At the daily cap: the fixed reply and the card, without calling the model.
	const usage = option( 'get', 'contextchat_si_usage' );
	option( 'set', 'contextchat_si_usage', Object.assign( {}, usage, { micro_usd: 999000000 } ) );
	mockRequests.length = 0;
	const capped = await chatApi( 'message', { conversation_id: id, token, text: 'Halo lagi' } );
	assert.match( capped.json.reply, /tidak tersedia/ );
	assert.equal( capped.json.handoff.reason, 'busy' );
	assert.equal( mockRequests.length, 0 );
	option( 'set', 'contextchat_si_usage', usage );

	// Turn it off again for the other tests.
	await page.goto( BASE + '/wp-admin/admin.php?page=contextchat#ctxc-tab-si' );
	await page.uncheck( '#ctxc-si_enabled' );
	await page.check( 'input[name="contextchat_settings[si_api_key_remove]"]' );
	await page.click( '#submit' );
	await page.waitForURL( /settings-updated=true/ );
	assert.equal( ( await chatApi( 'start', { lang: 'id' } ) ).status, 404 );
	await page.close();
} );

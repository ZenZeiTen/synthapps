// End-to-end tests in a real browser against a live WordPress site.
// Run through tests/e2e/run.sh, which builds the site and starts the server.
const test = require( 'node:test' );
const assert = require( 'node:assert/strict' );
const path = require( 'node:path' );
const { execFileSync } = require( 'node:child_process' );
const { chromium } = require( 'playwright' );

const BASE = process.env.CTXC_BASE || 'http://127.0.0.1:8899';
const SITE = process.env.CTXC_SITE;
const SHOTS = process.env.CTXC_SHOTS || '';

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

function textOf( url ) {
	return new URL( url ).searchParams.get( 'text' );
}

test.before( async () => {
	browser = await chromium.launch();
} );

test.after( async () => {
	await browser.close();
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
	await page.locator( '#ctxc-composer' ).fill( 'Hello, I need 3 documents translated by Friday.' );
	const popup = page.context().waitForEvent( 'page' );
	await page.locator( '.ctxc-agent' ).first().click();
	await popup;
	assert.equal( textOf( opened[ 0 ] ), 'Hello, I need 3 documents translated by Friday.' );
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

test( 'admin: settings save through the form and analytics count the clicks', async () => {
	const page = await newPage();
	await page.goto( BASE + '/wp-login.php' );
	await page.fill( '#user_login', 'admin' );
	await page.fill( '#user_pass', 'password' );
	await page.click( '#wp-submit' );
	await page.waitForURL( /wp-admin/ );

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

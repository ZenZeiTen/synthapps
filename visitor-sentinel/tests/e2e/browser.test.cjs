/**
 * Browser end-to-end test: real tracker.js in Chromium, real PHP endpoint, SQLite storage.
 *
 *   node tests/e2e/browser.test.cjs
 *
 * Scenario 1 behaves like a person (no webdriver flag, real mouse, scrolling, waiting).
 * Scenario 2 is an automated browser that clicks an ad by script at once. The plugin should
 * keep scenario 1 clean, score scenario 2 as fraud, block the IP and hide the ads.
 */
'use strict';

const { chromium } = require( 'playwright' );
const { spawn } = require( 'child_process' );
const fs = require( 'fs' );
const os = require( 'os' );
const path = require( 'path' );
const assert = require( 'assert' );

const PORT = 8765 + Math.floor( Math.random() * 1000 );
const BASE = `http://127.0.0.1:${ PORT }`;
const DB = path.join( fs.mkdtempSync( path.join( os.tmpdir(), 'vsen-e2e-' ) ), 'e2e.sqlite' );
const HUMAN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );

async function state() {
	const res = await fetch( `${ BASE }/state` );
	return res.json();
}

async function waitFor( fn, what, timeout = 8000 ) {
	const end = Date.now() + timeout;
	for ( ;; ) {
		const s = await state();
		if ( fn( s ) ) {
			return s;
		}
		if ( Date.now() > end ) {
			throw new Error( 'Timed out waiting for ' + what + '\n' + JSON.stringify( s, null, 1 ).slice( 0, 3000 ) );
		}
		await sleep( 150 );
	}
}

function center( box ) {
	return [ box.x + box.width / 2, box.y + box.height / 2 ];
}

( async () => {
	const server = spawn( 'php', [ '-S', `127.0.0.1:${ PORT }`, path.join( __dirname, 'server.php' ) ], {
		env: { ...process.env, VSEN_E2E_DB: DB },
		stdio: [ 'ignore', 'ignore', 'pipe' ],
	} );
	let serverLog = '';
	server.stderr.on( 'data', ( d ) => ( serverLog += d ) );
	for ( let i = 0; i < 50; i++ ) {
		try {
			await fetch( `${ BASE }/state` );
			break;
		} catch ( e ) {
			await sleep( 100 );
		}
	}

	const browser = await chromium.launch();
	let failed = false;
	try {
		// ---------------------------------------------------------------- Scenario 1: a person.
		const human = await browser.newContext( { userAgent: HUMAN_UA, viewport: { width: 1280, height: 800 } } );
		await human.addInitScript( () => {
			Object.defineProperty( Navigator.prototype, 'webdriver', { get: () => false } );
			// Keep the test on this page: the tracker sees the click (capture phase) before this runs.
			document.addEventListener( 'click', ( e ) => {
				if ( e.target.closest && e.target.closest( '#outbound, #download' ) ) {
					e.preventDefault();
				}
			} );
		} );
		const page = await human.newPage();
		await page.goto( `${ BASE }/page?gclid=E2EHUMANCLICK01&utm_source=google&utm_medium=cpc&utm_campaign=brand` );
		let s = await waitFor( ( st ) => st.pageviews.length === 1, 'the pageview' );

		await page.mouse.move( 200, 200 );
		await page.mouse.move( 400, 300, { steps: 8 } );
		await page.mouse.wheel( 0, 1200 );
		await sleep( 300 );
		await page.mouse.wheel( 0, 3000 );
		await sleep( 1200 );
		await page.evaluate( () => window.scrollTo( 0, 0 ) );

		const [ adX, adY ] = center( await page.locator( '#ad-link' ).boundingBox() );
		await page.mouse.move( adX - 30, adY, { steps: 5 } );
		await page.mouse.click( adX, adY );
		await page.locator( '#signup' ).click();
		await page.locator( '#outbound' ).click();
		await page.locator( '#download' ).click();

		// Hover the ad iframe, then click into it: the page only sees its window lose focus.
		const [ fx, fy ] = center( await page.locator( '#ad-iframe' ).boundingBox() );
		await page.mouse.move( fx, fy, { steps: 5 } );
		await sleep( 200 );
		await page.mouse.click( fx, fy );

		s = await waitFor( ( st ) => st.clicks.length >= 6, 'six clicks' );

		// Leave the page: the tracker sends final engagement by beacon.
		await page.evaluate( () => {
			Object.defineProperty( document, 'hidden', { value: true, configurable: true } );
			document.dispatchEvent( new Event( 'visibilitychange' ) );
		} );
		s = await waitFor( ( st ) => Number( st.pageviews[ 0 ].time_on_page ) >= 2, 'engagement' );

		const byType = ( type ) => s.clicks.filter( ( c ) => c.click_type === type );
		assert.strictEqual( s.visitors.length, 1 );
		assert.strictEqual( Number( s.visitors[ 0 ].is_bot ), 0, 'person is not a bot' );
		assert.strictEqual( s.visitors[ 0 ].ip, '127.0.0.1' );
		assert.strictEqual( s.sessions[ 0 ].utm_campaign, 'brand' );
		assert.strictEqual( Number( s.sessions[ 0 ].is_paid ), 1 );
		assert.ok( Number( s.pageviews[ 0 ].max_scroll ) >= 90, 'scroll depth recorded: ' + s.pageviews[ 0 ].max_scroll );
		assert.ok( Number( s.pageviews[ 0 ].interactions ) >= 3, 'interactions recorded: ' + s.pageviews[ 0 ].interactions );

		const landing = byType( 'ad_landing' );
		assert.strictEqual( landing.length, 1, 'one paid landing' );
		assert.strictEqual( Number( landing[ 0 ].server_seen ), 1, 'server saw the landing' );
		assert.strictEqual( Number( landing[ 0 ].js_confirmed ), 1, 'browser confirmed it' );

		const ads = byType( 'ad_click' );
		assert.strictEqual( ads.length, 2, 'link ad and iframe ad: ' + JSON.stringify( ads.map( ( a ) => a.label ) ) );
		const linkAd = ads.find( ( a ) => a.label === 'sidebar' );
		const frameAd = ads.find( ( a ) => a.label === 'iframe-unit' );
		assert.ok( linkAd && frameAd, 'both ad clicks labelled' );
		assert.ok( JSON.parse( frameAd.signals ).ifr === 1, 'iframe click detected through window blur' );
		assert.strictEqual( JSON.parse( linkAd.signals ).tr, 1, 'trusted click' );
		assert.ok( Number( linkAd.time_to_click ) > 800 );
		assert.deepStrictEqual( byType( 'tracked' ).map( ( c ) => c.label ), [ 'signup' ] );
		assert.strictEqual( byType( 'outbound' )[ 0 ].target, 'https://partner.example.org/offer' );
		assert.ok( byType( 'download' )[ 0 ].target.endsWith( '/files/brochure.pdf' ) );

		await fetch( `${ BASE }/finalize` );
		s = await state();
		for ( const c of s.clicks.filter( ( c ) => [ 'ad_landing', 'ad_click' ].includes( c.click_type ) ) ) {
			assert.strictEqual( Number( c.status ), 0, `person's ${ c.click_type } ${ c.label } is clean, got score ${ c.fraud_score } (${ c.fraud_reasons })` );
		}
		assert.strictEqual( s.blocklist.length, 0 );
		console.log( '  ok    person: pageview, engagement, scroll, link/iframe ad clicks, outbound, download, tracked, all clean' );
		await human.close();

		// ------------------------------------------------------- Scenario 2: an automated clicker.
		const bot = await browser.newContext();
		const botPage = await bot.newPage();
		await botPage.goto( `${ BASE }/page?gclid=E2EBOTCLICK0002` );
		await waitFor( ( st ) => st.visitors.length === 2, 'the bot visitor' );
		const reply = botPage.waitForResponse( ( r ) => r.url().endsWith( '/collect' ) && r.request().postData().includes( '"k":"ad"' ) );
		await botPage.evaluate( () => document.querySelector( '#ad-link' ).click() );
		await reply;

		s = await state();
		const botVisitor = s.visitors[ 1 ];
		assert.strictEqual( Number( botVisitor.is_bot ), 1, 'webdriver browser is a bot' );
		const botClick = s.clicks.find( ( c ) => c.click_type === 'ad_click' && Number( c.visitor_id ) === Number( botVisitor.id ) );
		assert.strictEqual( Number( botClick.status ), 2, `scripted click is fraud (${ botClick.fraud_score }: ${ botClick.fraud_reasons })` );
		for ( const rule of [ 'headless', 'untrusted_event', 'fast_click', 'no_interaction' ] ) {
			assert.ok( botClick.fraud_reasons.includes( rule ), 'reason ' + rule + ' in ' + botClick.fraud_reasons );
		}
		assert.strictEqual( s.blocklist.length, 1, 'IP auto-blocked' );

		await botPage.waitForFunction( () => document.documentElement.classList.contains( 'vsen-flagged' ) );
		assert.strictEqual( await botPage.locator( '#ad-link' ).isVisible(), false, 'ads hidden after the block' );

		await botPage.reload();
		assert.strictEqual( await botPage.evaluate( () => document.documentElement.classList.contains( 'vsen-flagged' ) ), true, 'flag applied before the tracker runs on the next page' );
		assert.strictEqual( await botPage.locator( '#ad-link' ).isVisible(), false );
		console.log( '  ok    automated clicker: bot, scripted fraud click, auto-block, ads hidden on this and the next page' );
		await bot.close();
	} catch ( e ) {
		failed = true;
		console.error( '  FAIL ', e.message );
	} finally {
		await browser.close();
		server.kill();
		if ( /PHP notice in e2e|Fatal/.test( serverLog ) ) {
			failed = true;
			console.error( serverLog );
		}
	}
	console.log( failed ? '\nbrowser test failed' : '\nbrowser test passed' );
	process.exit( failed ? 1 : 0 );
} )();

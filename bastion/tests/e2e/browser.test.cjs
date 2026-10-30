/**
 * Browser end-to-end test: the real dashboard and admin.js in Chromium, polling the real live
 * endpoint, while attacks hit the real Guard on a PHP server with SQLite storage.
 *
 *   node tests/e2e/browser.test.cjs
 *
 * Checks that attacks appear in the live feed within seconds without a reload, that a repeat
 * attacker is blocked automatically and the counters update, that pausing stops updates, and
 * that attacker-controlled text cannot run script in the dashboard.
 */
'use strict';

const { chromium } = require( 'playwright' );
const { spawn } = require( 'child_process' );
const fs = require( 'fs' );
const os = require( 'os' );
const path = require( 'path' );
const assert = require( 'assert' );

const PORT = 8766 + Math.floor( Math.random() * 1000 );
const BASE = `http://127.0.0.1:${ PORT }`;
const DB = path.join( fs.mkdtempSync( path.join( os.tmpdir(), 'zbst-e2e-' ) ), 'e2e.sqlite' );

const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );

function hit( ip, pathAndQuery, headers = {} ) {
	return fetch( BASE + pathAndQuery, { headers: { 'X-Test-IP': ip, 'User-Agent': 'Mozilla/5.0 Test', ...headers } } );
}

( async () => {
	const server = spawn( 'php', [ '-S', `127.0.0.1:${ PORT }`, path.join( __dirname, 'server.php' ) ], {
		env: { ...process.env, ZBST_E2E_DB: DB },
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
	const page = await browser.newPage();
	const pageErrors = [];
	page.on( 'pageerror', ( e ) => pageErrors.push( e.message ) );
	page.on( 'dialog', ( d ) => d.dismiss() );

	try {
		await page.goto( `${ BASE }/admin` );
		await page.waitForSelector( '.zbst-feed .zbst-empty' );
		assert.strictEqual( await page.textContent( '[data-counter="active"]' ), '0' );

		// A normal visitor passes; an attack is refused.
		assert.strictEqual( ( await hit( '198.51.100.7', '/shop/?s=shoes' ) ).status, 200 );
		assert.strictEqual( ( await hit( '198.51.100.7', '/shop/?id=1%20UNION%20SELECT%20user_pass%20FROM%20wp_users' ) ).status, 403 );

		// It shows up in the open dashboard without a reload.
		await page.waitForSelector( '.zbst-feed tr[data-id] >> text=198.51.100.7', { timeout: 10000 } );
		const row = await page.textContent( '.zbst-feed tr[data-id]' );
		assert.ok( row.includes( 'Firewall rule' ) && row.includes( 'Critical' ), row );
		assert.ok( row.includes( 'UNION SELECT' ), 'the request is shown: ' + row );

		// A second attack crosses the threshold: the address is blocked automatically.
		assert.strictEqual( ( await hit( '198.51.100.7', '/?q=%27%20AND%20SLEEP(5)--' ) ).status, 403 );
		assert.strictEqual( ( await hit( '198.51.100.7', '/shop/?s=shoes' ) ).status, 403, 'blocked address refused on a normal page' );
		assert.strictEqual( ( await hit( '198.51.100.8', '/shop/?s=shoes' ) ).status, 200, 'other visitors unaffected' );
		await page.waitForFunction( () => document.querySelector( '[data-counter="active"]' ).textContent === '1', null, { timeout: 10000 } );
		await page.waitForSelector( '.zbst-feed tr[data-id] >> text=Automatic block', { timeout: 10000 } );
		const state = await ( await fetch( `${ BASE }/state` ) ).json();
		assert.strictEqual( state.blocks.length, 1 );
		assert.strictEqual( state.blocks[ 0 ].ip, '198.51.100.7' );
		assert.ok( Number( state.blocks[ 0 ].hits ) >= 1 );

		// Attacker-controlled text is shown as text, never run.
		await hit( '198.51.100.9', '/?x=%3Cimg%20src%3Dx%20onerror%3Dwindow.__pwned%3D1%3E', { 'User-Agent': '<img src=x onerror=window.__pwned2=1>' } );
		await page.waitForSelector( '.zbst-feed tr[data-id] >> text=198.51.100.9', { timeout: 10000 } );
		await sleep( 300 );
		assert.strictEqual( await page.evaluate( () => window.__pwned || window.__pwned2 || 0 ), 0 );
		assert.strictEqual( await page.locator( '.zbst-feed img' ).count(), 0 );

		// Paused: nothing new appears. Resumed: it catches up.
		await page.click( '.zbst-toggle' );
		await page.waitForFunction( () => document.querySelector( '.zbst-state' ).textContent === 'Paused' );
		await hit( '198.51.100.10', '/.env' );
		await sleep( 2500 );
		assert.strictEqual( await page.locator( '.zbst-feed tr[data-id] >> text=198.51.100.10' ).count(), 0, 'paused feed stayed still' );
		await page.click( '.zbst-toggle' );
		await page.waitForSelector( '.zbst-feed tr[data-id] >> text=198.51.100.10', { timeout: 10000 } );

		// Block links lead to the block form for that address.
		const href = await page.getAttribute( '.zbst-feed tr[data-id] .zbst-block-link', 'href' );
		assert.ok( href.includes( 'ip=198.51.100.10' ), href );

		// Reloading shows the history from the server-rendered data.
		await page.reload();
		await page.waitForSelector( '.zbst-feed tr[data-id] >> text=198.51.100.7' );
		assert.strictEqual( await page.textContent( '[data-counter="active"]' ), '1' );

		assert.deepStrictEqual( pageErrors, [] );
		assert.ok( ! serverLog.includes( 'PHP notice' ), serverLog );
		console.log( 'Browser end-to-end test passed' );
	} catch ( e ) {
		console.error( e );
		console.error( serverLog.slice( -3000 ) );
		await page.screenshot( { path: path.join( os.tmpdir(), 'zbst-e2e-failure.png' ), fullPage: true } ).catch( () => {} );
		process.exitCode = 1;
	} finally {
		await browser.close();
		server.kill();
	}
} )();

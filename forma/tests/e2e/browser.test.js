// Browser tests against a live WordPress site with the Forma theme and toolkit.
// Run through tests/run-wordpress-tests.sh, which builds the site and starts the server.
'use strict';

const test = require( 'node:test' );
const assert = require( 'node:assert/strict' );
const fs = require( 'node:fs' );
const path = require( 'node:path' );
const { execFileSync } = require( 'node:child_process' );
const { chromium } = require( 'playwright' );

const BASE = process.env.FORMA_BASE || 'http://127.0.0.1:8890';
const SITE = process.env.FORMA_SITE;
const SHOTS = process.env.FORMA_SHOTS || '';
const AXE = fs.readFileSync( require.resolve( 'axe-core/axe.min.js' ), 'utf8' );

const PAGES = {
	home: '/',
	about: '/about/',
	services: '/services/',
	pricing: '/pricing/',
	contact: '/contact/',
	journal: '/journal/',
	post: '/a-year-of-lessons-from-our-clients/',
	search: '/?s=projects',
	notFound: '/no-such-page/',
};

function configure( changes ) {
	execFileSync( 'php', [ path.join( __dirname, 'configure.php' ), SITE, typeof changes === 'string' ? changes : JSON.stringify( changes ) ] );
}

let browser;
// Script errors from the theme's or the toolkit's files fail the run. The npm build of WordPress
// leaves out some core scripts (the navigation block's view module, comment-reply), so errors
// from core files are not counted.
const ourErrors = [];

async function newPage( options = {} ) {
	const context = await browser.newContext( { viewport: { width: 1280, height: 900 }, ...options } );
	const page = await context.newPage();
	page.on( 'pageerror', ( err ) => {
		if ( /zenzeiten-forma/.test( String( err.stack ) ) ) {
			ourErrors.push( `${ page.url() }: ${ err.message }` );
		}
	} );
	page.on( 'console', ( msg ) => {
		if ( msg.type() === 'error' && /zenzeiten-forma/.test( msg.location().url || '' ) ) {
			ourErrors.push( `${ page.url() }: ${ msg.text() }` );
		}
	} );
	return page;
}

async function shot( page, name, fullPage = true, selector = '' ) {
	if ( ! SHOTS ) {
		return;
	}
	const file = path.join( SHOTS, name + '.png' );
	// Admin screens: only the settings area, since the test build lacks core admin styles.
	await ( selector ? page.locator( selector ).screenshot( { path: file } ) : page.screenshot( { path: file, fullPage } ) );
}

async function axe( page ) {
	await page.addScriptTag( { content: AXE } );
	return page.evaluate( async () => {
		const result = await window.axe.run( document, { resultTypes: [ 'violations' ] } );
		return result.violations
			.filter( ( v ) => v.impact === 'serious' || v.impact === 'critical' )
			.map( ( v ) => `${ v.id } (${ v.impact }): ${ v.nodes.slice( 0, 3 ).map( ( n ) => n.target.join( ' ' ) ).join( ' | ' ) }` );
	} );
}

test.before( async () => {
	configure( 'reset' );
	browser = await chromium.launch();
} );

test.after( async () => {
	await browser.close();
	configure( 'reset' );
	assert.deepEqual( ourErrors, [], 'no script errors from the theme or the toolkit' );
} );

test( 'every page renders at desktop and phone width without overflow', async () => {
	for ( const [ name, url ] of Object.entries( PAGES ) ) {
		for ( const width of [ 1280, 390 ] ) {
			const page = await newPage( { viewport: { width, height: 900 } } );
			const response = await page.goto( BASE + url );
			assert.equal( response.status(), name === 'notFound' ? 404 : 200, `${ name } status` );
			const facts = await page.evaluate( () => ( {
				overflow: document.documentElement.scrollWidth - window.innerWidth,
				h1: document.querySelectorAll( 'h1' ).length,
				main: document.querySelectorAll( 'main' ).length,
				cta: ( () => {
					const el = document.querySelector( '.zzforma-header-cta' );
					return el ? getComputedStyle( el ).display : 'missing';
				} )(),
			} ) );
			assert.ok( facts.overflow <= 0, `${ name } at ${ width }px scrolls sideways by ${ facts.overflow }px` );
			assert.equal( facts.h1, 1, `${ name } has one h1` );
			assert.equal( facts.main, 1, `${ name } has one main landmark` );
			assert.equal( facts.cta, width < 600 ? 'none' : 'block', `${ name } header button at ${ width }px` );
			if ( name === 'home' || name === 'post' ) {
				await shot( page, `${ name }-${ width }` );
			}
			await page.context().close();
		}
	}
} );

test( 'no serious accessibility problems in light and dark mode', async () => {
	for ( const scheme of [ 'light', 'dark' ] ) {
		for ( const name of [ 'home', 'pricing', 'post', 'contact', 'notFound' ] ) {
			const page = await newPage( { colorScheme: scheme } );
			await page.goto( BASE + PAGES[ name ] );
			const violations = await axe( page );
			assert.deepEqual( violations, [], `${ name } (${ scheme })` );
			await page.context().close();
		}
	}
} );

test( 'dark mode follows the device and the switch, and remembers the choice', async () => {
	const page = await newPage( { colorScheme: 'dark' } );
	await page.goto( BASE + '/' );
	const background = () => page.evaluate( () => getComputedStyle( document.body ).backgroundColor );
	assert.equal( await page.getAttribute( 'html', 'data-color-scheme' ), 'auto' );
	assert.equal( await background(), 'rgb(17, 17, 16)', 'dark base colour from the device setting' );
	const toggle = page.locator( 'button.zzforma-scheme-toggle' );
	assert.equal( await toggle.getAttribute( 'aria-pressed' ), 'true' );
	await shot( page, 'home-dark', false );

	await toggle.click();
	assert.equal( await page.getAttribute( 'html', 'data-color-scheme' ), 'light' );
	assert.equal( await toggle.getAttribute( 'aria-pressed' ), 'false' );
	assert.equal( await background(), 'rgb(251, 250, 247)', 'light base colour' );
	await page.reload();
	assert.equal( await page.getAttribute( 'html', 'data-color-scheme' ), 'light', 'choice kept after reload' );
	assert.equal( await background(), 'rgb(251, 250, 247)' );
	await page.context().close();

	configure( { theme: { color_scheme: 'light' } } );
	const light = await newPage( { colorScheme: 'dark' } );
	await light.goto( BASE + '/' );
	assert.equal( await light.getAttribute( 'html', 'data-color-scheme' ), null, 'always-light mode ignores the device' );
	assert.equal( await light.locator( 'button.zzforma-scheme-toggle' ).count(), 0, 'no switch' );
	await light.context().close();
	configure( { theme: { color_scheme: 'toggle' } } );
} );

test( 'announcement bar shows, closes and stays closed', async () => {
	configure( { toolkit: { modules: { announcement: true }, announcement: { message: 'Holiday hours: closed on <strong>24 December</strong>.', link_url: BASE + '/contact/', link_text: 'Details', dismissible: true } } } );
	const page = await newPage();
	await page.goto( BASE + '/' );
	const bar = page.locator( '#zzft-announcement' );
	assert.ok( await bar.isVisible() );
	assert.match( await bar.innerText(), /Holiday hours: closed on 24 December\./ );
	await shot( page, 'announcement', false );
	await page.getByRole( 'button', { name: 'Close announcement' } ).click();
	assert.equal( await bar.count(), 0 );
	await page.reload();
	assert.equal( await page.locator( '#zzft-announcement' ).count(), 0, 'stays closed' );
	await page.context().close();
	configure( { toolkit: { modules: { announcement: false } } } );
} );

test( 'visitor chat answers, links pages, closes with Escape and survives navigation', async () => {
	configure( { toolkit: { modules: { ai: true }, ai: { api_key: 'sk-ant-test-1234', chat_enabled: true, chat_placement: 'floating', chat_model: 'claude-haiku-5-5' } } } );
	const page = await newPage();
	await page.goto( BASE + '/services/' );
	const launcher = page.locator( '.zzft-chat__launcher' );
	assert.equal( await launcher.getAttribute( 'aria-expanded' ), 'false' );
	await launcher.click();
	const dialog = page.getByRole( 'dialog', { name: 'Ask us anything' } );
	assert.ok( await dialog.isVisible() );
	assert.ok( await page.evaluate( () => document.activeElement.classList.contains( 'zzft-chat__input' ) ), 'focus in the input' );
	await page.locator( '.zzft-chat__input' ).fill( 'When are you open?' );
	await page.keyboard.press( 'Enter' );
	const reply = page.locator( '.zzft-chat__msg--assistant:not(.zzft-chat__msg--greeting):not(.is-waiting)' ).last();
	await reply.waitFor();
	assert.match( await reply.innerText(), /Monday to Friday/ );
	assert.equal( await reply.locator( 'a' ).getAttribute( 'href' ), BASE + '/contact/' );
	await shot( page, 'chat-open', false );

	await page.keyboard.press( 'Escape' );
	assert.ok( await dialog.isHidden() );
	assert.ok( await page.evaluate( () => document.activeElement.classList.contains( 'zzft-chat__launcher' ) ), 'focus back on the launcher' );

	await launcher.click();
	await page.goto( BASE + '/pricing/' );
	assert.ok( await page.getByRole( 'dialog', { name: 'Ask us anything' } ).isVisible(), 'stays open on the next page' );
	assert.equal( await page.locator( '.zzft-chat__msg--user' ).count(), 1, 'conversation kept' );

	await page.locator( '.zzft-chat__input' ).fill( 'TRIGGER-500' );
	await page.locator( '.zzft-chat__send' ).click();
	await page.locator( '.zzft-chat__msg.is-error' ).waitFor();
	assert.match( await page.locator( '.zzft-chat__msg.is-error' ).innerText(), /could not answer/ );
	const violations = await axe( page );
	assert.deepEqual( violations, [], 'chat is accessible' );
	await page.context().close();
	configure( { toolkit: { modules: { ai: false } } } );
} );

test( 'admin screens render and settings save through the Settings API', async () => {
	const cookies = JSON.parse( execFileSync( 'php', [ path.join( __dirname, 'auth-cookies.php' ), SITE, BASE ] ).toString() );
	const page = await newPage( { viewport: { width: 1280, height: 1000 } } );
	await page.context().addCookies( cookies );

	await page.goto( BASE + '/wp-admin/themes.php?page=zzforma' );
	assert.ok( await page.locator( '.zzforma-admin h1' ).isVisible(), 'Appearance → Forma' );
	await shot( page, 'admin-forma', true, '.wrap' );

	await page.goto( BASE + '/wp-admin/admin.php?page=zzft' );
	assert.equal( await page.locator( '.zzft-module' ).count(), 6, 'six modules' );
	await page.locator( 'input[name="zzft_settings[modules][announcement]"]' ).check();
	await page.locator( 'input[name="zzft_settings[modules][ai]"]' ).check();
	await page.locator( '#submit' ).click();
	await page.waitForURL( /settings-updated=true/ );
	assert.ok( await page.locator( 'input[name="zzft_settings[modules][announcement]"]' ).isChecked(), 'saved' );
	await shot( page, 'admin-modules', true, '.wrap' );

	for ( const tab of [ 'performance', 'security', 'seo', 'business', 'announcement', 'ai', 'advanced' ] ) {
		await page.goto( `${ BASE }/wp-admin/admin.php?page=zzft&tab=${ tab }` );
		assert.equal( await page.locator( `input[name="zzft_settings[_tab]"][value="${ tab }"]` ).count(), 1, `${ tab } tab` );
		if ( tab === 'ai' ) {
			await page.locator( '#zzft-ai-api_key' ).fill( 'sk-ant-admin-test-5678' );
			await page.locator( '#submit' ).click();
			await page.waitForURL( /settings-updated=true/ );
			assert.match( await page.locator( '#zzft-ai-api_key' ).getAttribute( 'placeholder' ), /ends in 5678/, 'key saved, not shown' );
			assert.equal( await page.locator( '#zzft-ai-api_key' ).inputValue(), '', 'key never printed back' );
			await shot( page, 'admin-ai', true, '.wrap' );
		}
	}
	await page.context().close();
	configure( 'reset' );
} );

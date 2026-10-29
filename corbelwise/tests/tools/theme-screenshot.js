// Render the theme's screenshot.png (1200 × 900, the size WordPress recommends) from the home page
// of a running test site.
//
//   node tests/tools/theme-screenshot.js http://127.0.0.1:8890
'use strict';

const path = require( 'node:path' );
const { chromium } = require( 'playwright' );

( async () => {
	const browser = await chromium.launch();
	const page = await browser.newPage( { viewport: { width: 1200, height: 900 }, colorScheme: 'light' } );
	await page.goto( process.argv[ 2 ] + '/', { waitUntil: 'networkidle' } );
	await page.evaluate( () => document.fonts.ready );
	await page.screenshot( { path: path.join( __dirname, '../../theme/corbelwise/screenshot.png' ) } );
	await browser.close();
} )();

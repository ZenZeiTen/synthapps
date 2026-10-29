/**
 * Validate block markup the way the WordPress 6.5 editor does, without a browser.
 *
 * Reads a JSON object { name: markup } (from dump-markup.php) and parses each entry with the
 * @wordpress/blocks and @wordpress/block-library versions that shipped in WordPress 6.5. Any block
 * the editor would flag as "This block contains unexpected or invalid content", and any unknown
 * block, fails the run.
 *
 *   node tests/tools/validate-blocks.js markup.json
 */
'use strict';

const fs = require( 'node:fs' );
const { JSDOM } = require( 'jsdom' );

const dom = new JSDOM( '<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true } );
for ( const key of [ 'window', 'document', 'navigator', 'Node', 'HTMLElement', 'Element', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'DOMParser', 'CustomEvent', 'Event', 'KeyboardEvent', 'FocusEvent', 'MouseEvent' ] ) {
	if ( ! ( key in global ) || key === 'window' || key === 'document' || key === 'navigator' ) {
		Object.defineProperty( global, key, { value: key === 'window' ? dom.window : dom.window[ key ], configurable: true, writable: true } );
	}
}
global.window.matchMedia = global.window.matchMedia || ( () => ( { matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} } ) );

const messages = [];
for ( const level of [ 'log', 'info', 'warn', 'error' ] ) {
	console[ level ] = ( ...args ) => messages.push( args.map( String ).join( ' ' ) );
}

const blocks = require( '@wordpress/blocks' );
const { registerCoreBlocks } = require( '@wordpress/block-library' );
registerCoreBlocks();

// Server-rendered blocks from the theme and the toolkit: they save nothing.
for ( const name of [ 'corbelwise/color-scheme-toggle' ] ) {
	blocks.registerBlockType( name, { apiVersion: 3, title: name, category: 'theme', edit: () => null, save: () => null } );
}

const input = JSON.parse( fs.readFileSync( process.argv[ 2 ], 'utf8' ) );
const problems = [];
let count = 0;

function walk( list, source, trail ) {
	for ( const block of list ) {
		count++;
		const where = `${ source } › ${ trail.concat( block.name ).join( ' › ' ) }`;
		if ( block.name === 'core/missing' || ! blocks.getBlockType( block.name ) ) {
			problems.push( `${ where }: unknown block ${ block.attributes && block.attributes.originalName }` );
		} else if ( block.isValid === false ) {
			// Each issue is a printf-style message plus its arguments; keep the readable string parts.
			const issues = ( block.validationIssues || [] ).map( ( i ) => ( i.args || [ String( i ) ] ).filter( ( a ) => typeof a === 'string' ).slice( 1 ).join( ' | ' ) );
			problems.push( `${ where }: invalid\n      ${ issues.join( '\n      ' ) }` );
		}
		walk( block.innerBlocks || [], source, trail.concat( block.name ) );
	}
}

for ( const [ name, markup ] of Object.entries( input ) ) {
	walk( blocks.parse( markup ), name, [] );
}

if ( problems.length ) {
	process.stdout.write( `${ problems.length } problem(s) in ${ count } blocks:\n  ${ problems.join( '\n  ' ) }\n` );
	process.exit( 1 );
}
process.stdout.write( `All ${ count } blocks in ${ Object.keys( input ).length } patterns, templates and parts are valid.\n` );

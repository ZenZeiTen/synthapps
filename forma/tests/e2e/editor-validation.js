// Validate every Forma pattern, template and template part inside the real block editor of the
// WordPress site under test, so markup is checked against that WordPress version's blocks.
// Used by tests/wordpress-smoke.sh.
//
//   FORMA_BASE=http://127.0.0.1:8089 FORMA_COOKIES='[...]' node tests/e2e/editor-validation.js
'use strict';

const { chromium } = require( 'playwright' );

( async () => {
	const base = process.env.FORMA_BASE;
	const browser = await chromium.launch();
	const context = await browser.newContext();
	await context.addCookies( JSON.parse( process.env.FORMA_COOKIES ) );
	const page = await context.newPage();
	await page.goto( `${ base }/wp-admin/post-new.php?post_type=page`, { waitUntil: 'domcontentloaded' } );
	await page.waitForFunction( () => window.wp && window.wp.blocks && window.wp.blocks.getBlockTypes().length > 50 && window.wp.apiFetch, null, { timeout: 60000 } );

	const report = await page.evaluate( async () => {
		const { blocks, apiFetch } = window.wp;
		const sources = {};
		const patterns = await apiFetch( { path: '/wp/v2/block-patterns/patterns' } );
		for ( const pattern of patterns ) {
			if ( pattern.name.startsWith( 'zenzeiten-forma/' ) ) {
				sources[ 'pattern ' + pattern.name ] = pattern.content;
			}
		}
		for ( const type of [ 'templates', 'template-parts' ] ) {
			const items = await apiFetch( { path: `/wp/v2/${ type }?context=edit&per_page=100` } );
			for ( const item of items ) {
				if ( item.theme === 'zenzeiten-forma' ) {
					sources[ `${ type } ${ item.slug }` ] = item.content.raw;
				}
			}
		}
		const problems = [];
		let count = 0;
		const walk = ( list, where ) => {
			for ( const block of list ) {
				count++;
				if ( block.name === 'core/missing' || ! blocks.getBlockType( block.name ) ) {
					problems.push( `${ where }: unknown block ${ block.attributes && block.attributes.originalName }` );
				} else if ( block.isValid === false ) {
					const issues = ( block.validationIssues || [] ).map( ( i ) => ( i.args || [] ).filter( ( a ) => typeof a === 'string' ).slice( 1 ).join( ' | ' ) );
					problems.push( `${ where } › ${ block.name }: ${ issues.join( '; ' ) }` );
				}
				walk( block.innerBlocks || [], where );
			}
		};
		for ( const [ name, markup ] of Object.entries( sources ) ) {
			walk( blocks.parse( markup ), name );
		}
		return { sources: Object.keys( sources ).length, count, problems };
	} );

	await browser.close();
	if ( report.sources < 40 ) {
		console.error( `Only ${ report.sources } patterns, templates and parts found.` );
		process.exit( 1 );
	}
	if ( report.problems.length ) {
		console.error( `${ report.problems.length } invalid block(s):\n  ${ report.problems.join( '\n  ' ) }` );
		process.exit( 1 );
	}
	console.log( `Editor validation: all ${ report.count } blocks in ${ report.sources } patterns, templates and parts are valid.` );
} )().catch( ( error ) => {
	console.error( error );
	process.exit( 1 );
} );

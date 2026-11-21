// The browser copy of the price engine runs the same vectors as the PHP engine.
const test = require( 'node:test' );
const assert = require( 'node:assert/strict' );
const path = require( 'node:path' );
const fs = require( 'node:fs' );

const price = require( path.join( __dirname, '../../plugin/contextchat/assets/js/price-engine.js' ) );
const table = JSON.parse( fs.readFileSync( path.join( __dirname, '../../plugin/contextchat/data/price-table.nusalexia.json' ), 'utf8' ) );
const cases = JSON.parse( fs.readFileSync( path.join( __dirname, '../fixtures/prices.json' ), 'utf8' ) );

for ( const c of cases ) {
	test( `price: ${ c.name }`, () => {
		const result = price.quote( table, c.input );
		const got = {};
		for ( const key of Object.keys( c.expected ) ) {
			got[ key ] = key in result ? result[ key ] : null;
		}
		assert.deepEqual( got, c.expected );
	} );
}

test( 'price: amounts are written the way the site writes them', () => {
	assert.equal( price.rupiah( 1775000 ), 'Rp 1.775.000' );
	assert.equal( price.rupiah( 50000 ), 'Rp 50.000' );
	assert.equal( price.rupiah( 7930125 ), 'Rp 7.930.125' );
} );

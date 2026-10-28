// Tests for the browser engine. Run: node --test tests/js/
const test = require( 'node:test' );
const assert = require( 'node:assert/strict' );
const path = require( 'node:path' );
const fs = require( 'node:fs' );

const engine = require( path.join( __dirname, '../../plugin/contextchat/assets/js/contextchat.js' ) );
const cases = JSON.parse( fs.readFileSync( path.join( __dirname, '../fixtures/templates.json' ), 'utf8' ) );

for ( const c of cases ) {
	test( `template: ${ c.name }`, () => {
		assert.equal( engine.render( c.template, c.vars ), c.expected );
	} );
}

test( 'template: long messages are cut to 1500 characters, counting emoji as one', () => {
	const out = engine.render( '👋 '.repeat( 900 ), {} );
	assert.equal( Array.from( out ).length, 1500 );
	assert.ok( out.endsWith( '…' ) );
} );

// Weekdays Monday–Friday 09:00–17:00, Saturday 22:00–02:00 (runs past midnight), Sunday closed.
const days = [
	{ on: false, start: '09:00', end: '17:00' },
	{ on: true, start: '09:00', end: '17:00' },
	{ on: true, start: '09:00', end: '17:00' },
	{ on: true, start: '09:00', end: '17:00' },
	{ on: true, start: '09:00', end: '17:00' },
	{ on: true, start: '09:00', end: '17:00' },
	{ on: true, start: '22:00', end: '02:00' },
];
const jakarta = { enabled: true, days, tz: 'Asia/Jakarta', offset: 420 };

// 2026-10-28 is a Wednesday. Jakarta is UTC+7 all year.
const at = ( iso ) => new Date( iso );

test( 'hours: open on a weekday afternoon in the site time zone', () => {
	assert.equal( engine.isOpen( jakarta, at( '2026-10-28T07:00:00Z' ) ), true ); // 14:00 WIB
} );

test( 'hours: closed in the evening even though it is daytime in UTC', () => {
	assert.equal( engine.isOpen( jakarta, at( '2026-10-28T11:30:00Z' ) ), false ); // 18:30 WIB
} );

test( 'hours: opening time is inclusive, closing time exclusive', () => {
	assert.equal( engine.isOpen( jakarta, at( '2026-10-28T02:00:00Z' ) ), true ); // 09:00
	assert.equal( engine.isOpen( jakarta, at( '2026-10-28T10:00:00Z' ) ), false ); // 17:00
} );

test( 'hours: a schedule past midnight stays open into the next day', () => {
	assert.equal( engine.isOpen( jakarta, at( '2026-10-31T16:00:00Z' ) ), true ); // Sat 23:00
	assert.equal( engine.isOpen( jakarta, at( '2026-10-31T18:30:00Z' ) ), true ); // Sun 01:30
	assert.equal( engine.isOpen( jakarta, at( '2026-10-31T19:30:00Z' ) ), false ); // Sun 02:30
} );

test( 'hours: closed day', () => {
	assert.equal( engine.isOpen( jakarta, at( '2026-11-01T05:00:00Z' ) ), false ); // Sun 12:00
} );

test( 'hours: fixed offset is used when there is no named zone', () => {
	const fixed = { enabled: true, days, tz: '', offset: 420 };
	assert.equal( engine.isOpen( fixed, at( '2026-10-28T07:00:00Z' ) ), true );
	assert.equal( engine.isOpen( fixed, at( '2026-10-28T11:30:00Z' ) ), false );
} );

test( 'hours: an unknown zone falls back to the offset', () => {
	const bad = { enabled: true, days, tz: 'Mars/Olympus', offset: 420 };
	assert.equal( engine.isOpen( bad, at( '2026-10-28T07:00:00Z' ) ), true );
} );

test( 'hours: daylight saving is followed for named zones', () => {
	const ny = { enabled: true, days, tz: 'America/New_York', offset: -300 };
	// 2026-07-01 is a Wednesday; 13:30 UTC is 09:30 in New York (UTC-4 in summer).
	assert.equal( engine.isOpen( ny, at( '2026-07-01T13:30:00Z' ) ), true );
	// 2026-12-02 is a Wednesday; 13:30 UTC is 08:30 in New York (UTC-5 in winter).
	assert.equal( engine.isOpen( ny, at( '2026-12-02T13:30:00Z' ) ), false );
} );

test( 'hours: same start and end means open all day', () => {
	const allDay = { enabled: true, tz: 'UTC', offset: 0, days: days.map( () => ( { on: true, start: '00:00', end: '00:00' } ) ) };
	assert.equal( engine.isOpen( allDay, at( '2026-10-28T23:59:00Z' ) ), true );
} );

test( 'hours: disabled schedule is always open', () => {
	assert.equal( engine.isOpen( { enabled: false, days: [] }, new Date() ), true );
} );

test( 'visitor context: campaign tags, referrer and a clean current address', () => {
	const vars = engine.clientVars(
		'https://example.com/visa/?utm_source=instagram&utm_campaign=visa-season&lang=id&fbclid=abc#top',
		'https://www.google.com/search?q=visa',
		new Date( '2026-10-28T07:00:00Z' )
	);
	assert.equal( vars.utm_source, 'instagram' );
	assert.equal( vars.utm_campaign, 'visa-season' );
	assert.equal( vars.referrer, 'google.com' );
	assert.equal( vars.current_url, 'https://example.com/visa/?lang=id' );
	assert.ok( vars.date && vars.time );
} );

test( 'visitor context: internal referrers are not reported', () => {
	const vars = engine.clientVars( 'https://example.com/a/', 'https://example.com/b/' );
	assert.equal( vars.referrer, undefined );
} );

test( 'links: phones use wa.me, desktop can use WhatsApp Web', () => {
	assert.equal( engine.link( '62812', 'Hi & bye?', 'web', true ), 'https://wa.me/62812?text=Hi%20%26%20bye%3F' );
	assert.equal( engine.link( '62812', 'Hi', 'web', false ), 'https://web.whatsapp.com/send?phone=62812&text=Hi' );
	assert.equal( engine.link( '62812', 'Hi', 'app', false ), 'https://wa.me/62812?text=Hi' );
	assert.equal( engine.link( '62812', '', 'app', false ), 'https://wa.me/62812' );
} );

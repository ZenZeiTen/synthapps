#!/usr/bin/env node
// Package the plugin as an installable zip: dist/contextchat-<version>.zip
// Upload it under Plugins → Add New → Upload Plugin.
//
// Plain Node with no dependencies, so `npm run build` works the same on Windows, macOS and
// Linux. Paths inside the zip always use forward slashes, which WordPress needs to unpack it.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const ROOT = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );
const PLUGIN = join( ROOT, 'plugin', 'contextchat' );
const SKIP = new Set( [ '.DS_Store', 'Thumbs.db', 'desktop.ini' ] );

const header = readFileSync( join( PLUGIN, 'contextchat.php' ), 'utf8' );
const version = ( /^ \* Version:\s*(\S+)/m.exec( header ) || [] )[ 1 ];
if ( ! version ) {
	console.error( 'No "Version:" line in plugin/contextchat/contextchat.php.' );
	process.exit( 1 );
}

/** Every file and folder under dir, in a fixed order, as zip paths starting with "contextchat/". */
function walk( dir, out = [] ) {
	for ( const name of readdirSync( dir ).sort() ) {
		if ( SKIP.has( name ) ) {
			continue;
		}
		const full = join( dir, name );
		const path = 'contextchat/' + relative( PLUGIN, full ).split( /[\\/]/ ).join( '/' );
		if ( statSync( full ).isDirectory() ) {
			out.push( { path: path + '/', full: null } );
			walk( full, out );
		} else {
			out.push( { path, full } );
		}
	}
	return out;
}

const CRC_TABLE = Array.from( { length: 256 }, ( _, n ) => {
	let c = n;
	for ( let k = 0; k < 8; k++ ) {
		c = c & 1 ? 0xedb88320 ^ ( c >>> 1 ) : c >>> 1;
	}
	return c >>> 0;
} );

function crc32( buf ) {
	let c = 0xffffffff;
	for ( const byte of buf ) {
		c = CRC_TABLE[ ( c ^ byte ) & 0xff ] ^ ( c >>> 8 );
	}
	return ( c ^ 0xffffffff ) >>> 0;
}

/** Date and time in the MS-DOS format zip files use. */
function dosTime( date ) {
	const time = ( date.getHours() << 11 ) | ( date.getMinutes() << 5 ) | ( date.getSeconds() >> 1 );
	const day = ( ( Math.max( date.getFullYear(), 1980 ) - 1980 ) << 9 ) | ( ( date.getMonth() + 1 ) << 5 ) | date.getDate();
	return { time, day };
}

const entries = [ { path: 'contextchat/', full: null }, ...walk( PLUGIN ) ];
const locals = [];
const centrals = [];
let offset = 0;

for ( const entry of entries ) {
	const name = Buffer.from( entry.path, 'utf8' );
	const data = entry.full ? readFileSync( entry.full ) : Buffer.alloc( 0 );
	const packed = entry.full ? deflateRawSync( data, { level: 9 } ) : data;
	const method = entry.full ? 8 : 0;
	const crc = crc32( data );
	const { time, day } = dosTime( entry.full ? statSync( entry.full ).mtime : new Date() );

	const local = Buffer.alloc( 30 );
	local.writeUInt32LE( 0x04034b50, 0 );
	local.writeUInt16LE( 20, 4 ); // version needed to extract
	local.writeUInt16LE( 0x0800, 6 ); // file names are UTF-8
	local.writeUInt16LE( method, 8 );
	local.writeUInt16LE( time, 10 );
	local.writeUInt16LE( day, 12 );
	local.writeUInt32LE( crc, 14 );
	local.writeUInt32LE( packed.length, 18 );
	local.writeUInt32LE( data.length, 22 );
	local.writeUInt16LE( name.length, 26 );
	local.writeUInt16LE( 0, 28 );
	locals.push( local, name, packed );

	const central = Buffer.alloc( 46 );
	central.writeUInt32LE( 0x02014b50, 0 );
	central.writeUInt16LE( ( 3 << 8 ) | 20, 4 ); // made by: Unix, so permissions below apply
	central.writeUInt16LE( 20, 6 );
	central.writeUInt16LE( 0x0800, 8 );
	central.writeUInt16LE( method, 10 );
	central.writeUInt16LE( time, 12 );
	central.writeUInt16LE( day, 14 );
	central.writeUInt32LE( crc, 16 );
	central.writeUInt32LE( packed.length, 20 );
	central.writeUInt32LE( data.length, 24 );
	central.writeUInt16LE( name.length, 28 );
	central.writeUInt32LE( ( ( entry.full ? 0o100644 : 0o40755 ) << 16 ) >>> 0, 38 ); // rw-r--r-- files, rwxr-xr-x folders
	central.writeUInt32LE( offset, 42 );
	centrals.push( central, name );

	offset += local.length + name.length + packed.length;
}

const directory = Buffer.concat( centrals );
const end = Buffer.alloc( 22 );
end.writeUInt32LE( 0x06054b50, 0 );
end.writeUInt16LE( entries.length, 8 );
end.writeUInt16LE( entries.length, 10 );
end.writeUInt32LE( directory.length, 12 );
end.writeUInt32LE( offset, 16 );

const zip = Buffer.concat( [ ...locals, directory, end ] );
const out = join( ROOT, 'dist', `contextchat-${ version }.zip` );
mkdirSync( dirname( out ), { recursive: true } );
writeFileSync( out, zip );

const files = entries.filter( ( e ) => e.full ).length;
console.log( `ContextChat ${ version }: ${ files } files, ${ ( zip.length / 1024 ).toFixed( 0 ) } KB` );
console.log( `SHA-256 ${ createHash( 'sha256' ).update( zip ).digest( 'hex' ) }` );
console.log( out );

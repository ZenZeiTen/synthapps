<?php
/**
 * Merge JSON into the ContextChat settings, through the same sanitiser the settings screen uses.
 *
 *   php tests/e2e/set-settings.php <site-dir> '{"hours_enabled":true}'
 */

$_SERVER['HTTP_HOST']   = 'localhost';
$_SERVER['REQUEST_URI'] = '/';
require rtrim( $argv[1], '/' ) . '/wp-load.php';

$changes = json_decode( $argv[2], true );
if ( ! is_array( $changes ) ) {
	fwrite( STDERR, "Second argument must be a JSON object.\n" );
	exit( 1 );
}

update_option( ContextChat_Settings::OPTION, array_merge( ContextChat_Settings::get(), $changes ) );
echo wp_json_encode( ContextChat_Settings::get() ) . "\n";

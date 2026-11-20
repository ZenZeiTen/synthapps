<?php
/**
 * Read, write or delete a WordPress option in the test site.
 *
 *   php tests/e2e/option.php <site-dir> get <name>
 *   php tests/e2e/option.php <site-dir> set <name> '<json>'
 *   php tests/e2e/option.php <site-dir> delete <name>
 *
 * "get" prints the raw stored value as JSON, read straight from the options table.
 */

$_SERVER['HTTP_HOST']   = 'localhost';
$_SERVER['REQUEST_URI'] = '/';
require rtrim( $argv[1], '/' ) . '/wp-load.php';

global $wpdb;
$name = $argv[3];
switch ( $argv[2] ) {
	case 'get':
		$raw = $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", $name ) ); // phpcs:ignore
		echo wp_json_encode( null === $raw ? null : maybe_unserialize( $raw ) ) . "\n";
		break;
	case 'set':
		update_option( $name, json_decode( $argv[4], true ) );
		break;
	case 'delete':
		delete_option( $name );
		break;
}

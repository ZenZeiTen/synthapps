<?php
/**
 * Run the plugin's uninstall routine and check it leaves nothing behind.
 *
 *   php tests/e2e/uninstall-check.php <site-dir>
 */

$_SERVER['HTTP_HOST']   = 'localhost';
$_SERVER['REQUEST_URI'] = '/';
require rtrim( $argv[1], '/' ) . '/wp-load.php';

global $wpdb;
$table = $wpdb->prefix . 'contextchat_clicks';

$before = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table}" ); // phpcs:ignore
if ( ! get_option( 'contextchat_settings' ) || $before < 1 ) {
	fwrite( STDERR, "Expected settings and recorded clicks before uninstalling.\n" );
	exit( 1 );
}

define( 'WP_UNINSTALL_PLUGIN', 'contextchat/contextchat.php' );
include WP_PLUGIN_DIR . '/contextchat/uninstall.php';
wp_cache_flush();

$left = array();
// Read the table directly: get_option() would return the registered default.
if ( $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->options} WHERE option_name LIKE %s", 'contextchat%' ) ) ) { // phpcs:ignore
	$left[] = 'options';
}
if ( $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->postmeta} WHERE meta_key IN (%s, %s)", '_contextchat_hide', '_contextchat_message' ) ) ) { // phpcs:ignore
	$left[] = 'post meta';
}
$wpdb->suppress_errors( true );
if ( null !== $wpdb->get_var( "SELECT COUNT(*) FROM {$table}" ) ) { // phpcs:ignore -- null means the table is gone.
	$left[] = 'clicks table';
}

if ( $left ) {
	fwrite( STDERR, 'Uninstall left behind: ' . implode( ', ', $left ) . "\n" );
	exit( 1 );
}
echo "ok - uninstall removed settings, post meta and the clicks table ({$before} clicks)\n";

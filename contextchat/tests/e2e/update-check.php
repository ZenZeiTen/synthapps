<?php
/**
 * Check that WordPress never offers another plugin as an update to ContextChat.
 *
 *   php tests/e2e/update-check.php <site-dir>
 *
 * WordPress.org could host an unrelated plugin in a folder named contextchat. The test site
 * cannot reach WordPress.org, so this stores such an offer the way WordPress caches it, then
 * reads the updates list the Plugins screen shows.
 */

$_SERVER['HTTP_HOST']   = 'localhost';
$_SERVER['REQUEST_URI'] = '/';
require rtrim( $argv[1], '/' ) . '/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';
require_once ABSPATH . 'wp-admin/includes/update.php';

if ( ! is_plugin_active( 'contextchat/contextchat.php' ) ) {
	fwrite( STDERR, "ContextChat is not active.\n" );
	exit( 1 );
}

$offer = (object) array(
	'slug'        => 'contextchat',
	'plugin'      => 'contextchat/contextchat.php',
	'new_version' => '9.9.9',
	'package'     => 'https://downloads.wordpress.org/plugin/contextchat.9.9.9.zip',
);
set_site_transient(
	'update_plugins',
	(object) array(
		'last_checked' => time(),
		'checked'      => array( 'contextchat/contextchat.php' => CONTEXTCHAT_VERSION ),
		'response'     => array( 'contextchat/contextchat.php' => $offer ),
		'no_update'    => array(),
		'translations' => array(),
	)
);

$updates = get_plugin_updates();
if ( isset( $updates['contextchat/contextchat.php'] ) ) {
	fwrite( STDERR, "WordPress offers an update for ContextChat from another plugin.\n" );
	exit( 1 );
}
echo "No update offered for ContextChat.\n";

<?php
/**
 * Runs when the plugin is deleted (not when it is deactivated).
 *
 * Data is kept unless the site owner ticked "Delete all toolkit settings and data when the plugin
 * is deleted" under Corbelwise → Advanced, so deleting the plugin to reinstall it loses nothing.
 *
 * @package Corbelwise\Toolkit
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

$cwtk_settings = get_option( 'cwtk_settings', array() );
if ( empty( $cwtk_settings['advanced']['delete_data'] ) ) {
	return;
}

delete_option( 'cwtk_settings' );
delete_option( 'cwtk_ai_usage' );
delete_post_meta_by_key( '_cwtk_description' );

global $wpdb;
// Rate-limit, login and notice transients. They expire on their own; this removes them at once.
$cwtk_names = $wpdb->get_col( "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE '%cwtk%'" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
foreach ( $cwtk_names as $cwtk_name ) {
	if ( 0 === strpos( $cwtk_name, '_transient_cwtk_' ) ) {
		delete_transient( substr( $cwtk_name, strlen( '_transient_' ) ) );
	}
}

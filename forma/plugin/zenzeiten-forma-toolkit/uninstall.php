<?php
/**
 * Runs when the plugin is deleted (not when it is deactivated).
 *
 * Data is kept unless the site owner ticked "Delete all toolkit settings and data when the plugin
 * is deleted" under Forma → Advanced, so deleting the plugin to reinstall it loses nothing.
 *
 * @package ZenZeiTen\FormaToolkit
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

$zzft_settings = get_option( 'zzft_settings', array() );
if ( empty( $zzft_settings['advanced']['delete_data'] ) ) {
	return;
}

delete_option( 'zzft_settings' );
delete_option( 'zzft_ai_usage' );
delete_post_meta_by_key( '_zzft_description' );

global $wpdb;
// Rate-limit, login and notice transients. They expire on their own; this removes them at once.
$zzft_names = $wpdb->get_col( "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE '%zzft%'" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
foreach ( $zzft_names as $zzft_name ) {
	if ( 0 === strpos( $zzft_name, '_transient_zzft_' ) ) {
		delete_transient( substr( $zzft_name, strlen( '_transient_' ) ) );
	}
}

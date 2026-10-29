<?php
/**
 * Uninstall: removes tables and options only when the site owner asked for it in Settings.
 *
 * @package VisitorSentinel
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

$vsen_settings = get_option( 'vsen_settings', array() );
if ( empty( $vsen_settings['delete_on_uninstall'] ) ) {
	return;
}

global $wpdb;
foreach ( array( 'visitors', 'sessions', 'pageviews', 'clicks', 'blocklist' ) as $vsen_table ) {
	$wpdb->query( 'DROP TABLE IF EXISTS ' . $wpdb->prefix . 'vsen_' . $vsen_table ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared,WordPress.DB.DirectDatabaseQuery.SchemaChange -- fixed table names.
}
foreach ( array( 'vsen_settings', 'vsen_secret', 'vsen_db_version', 'vsen_block_index', 'vsen_alert_cursor' ) as $vsen_option ) {
	delete_option( $vsen_option );
}
wp_clear_scheduled_hook( 'vsen_hourly' );

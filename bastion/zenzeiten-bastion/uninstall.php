<?php
/**
 * Uninstall: removes tables, options and backups only when the site owner asked for it in Settings.
 *
 * @package ZenZeiTenBastion
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

$zbst_settings = get_option( 'zbst_settings', array() );
if ( empty( $zbst_settings['delete_on_uninstall'] ) ) {
	return;
}

global $wpdb;
foreach ( array( 'events', 'blocks' ) as $zbst_table ) {
	$wpdb->query( 'DROP TABLE IF EXISTS ' . $wpdb->prefix . 'zbst_' . $zbst_table ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared,WordPress.DB.DirectDatabaseQuery.SchemaChange -- fixed table names.
}

$zbst_key = get_option( 'zbst_backup_key' );
if ( is_string( $zbst_key ) && preg_match( '/^[a-z0-9]{16}$/', $zbst_key ) ) {
	$zbst_uploads = wp_upload_dir( null, false );
	$zbst_dir     = trailingslashit( $zbst_uploads['basedir'] ) . 'zbst-backups-' . $zbst_key;
	foreach ( array_merge( (array) glob( $zbst_dir . '/*' ), array( $zbst_dir . '/.htaccess' ) ) as $zbst_file ) {
		if ( is_file( $zbst_file ) ) {
			wp_delete_file( $zbst_file );
		}
	}
	if ( is_dir( $zbst_dir ) ) {
		rmdir( $zbst_dir ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_rmdir -- our own folder, now empty.
	}
}

foreach ( array( 'zbst_settings', 'zbst_db_version', 'zbst_block_index', 'zbst_admin_ips', 'zbst_admins', 'zbst_alert_queue', 'zbst_alert_last', 'zbst_last_backup', 'zbst_backup_key' ) as $zbst_option ) {
	delete_option( $zbst_option );
}
wp_clear_scheduled_hook( 'zbst_hourly' );
wp_clear_scheduled_hook( 'zbst_backup' );
wp_clear_scheduled_hook( 'zbst_flush_alerts' );

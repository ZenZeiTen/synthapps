<?php
/**
 * Remove everything ContextChat stored when the plugin is deleted.
 *
 * @package ContextChat
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

/**
 * Remove the plugin's data from the current site.
 */
function contextchat_uninstall_site() {
	global $wpdb;

	delete_option( 'contextchat_settings' );
	delete_option( 'contextchat_db_version' );
	wp_clear_scheduled_hook( 'contextchat_prune' );
	delete_post_meta_by_key( '_contextchat_hide' );
	delete_post_meta_by_key( '_contextchat_message' );

	$wpdb->query( 'DROP TABLE IF EXISTS ' . $wpdb->prefix . 'contextchat_clicks' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQL.NotPrepared -- fixed table name.
}

if ( is_multisite() ) {
	// Each site of a network has its own settings and clicks table.
	$contextchat_sites = get_sites(
		array(
			'fields' => 'ids',
			'number' => 0,
		)
	);
	foreach ( $contextchat_sites as $contextchat_site ) {
		switch_to_blog( $contextchat_site );
		contextchat_uninstall_site();
		restore_current_blog();
	}
} else {
	contextchat_uninstall_site();
}

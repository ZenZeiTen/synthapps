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
	delete_option( 'contextchat_si_key' );
	delete_option( 'contextchat_si_usage' );
	delete_option( 'contextchat_si_db_version' );
	delete_option( 'contextchat_si_salt' );
	delete_option( 'contextchat_si_knowledge' );
	delete_option( 'contextchat_si_voice' );
	delete_option( 'contextchat_si_prices' );
	delete_option( 'contextchat_si_apostille' );
	$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s", $wpdb->esc_like( 'contextchat_si_lock_' ) . '%' ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
	wp_clear_scheduled_hook( 'contextchat_prune' );
	delete_post_meta_by_key( '_contextchat_hide' );
	delete_post_meta_by_key( '_contextchat_message' );

	foreach ( array( 'clicks', 'conversations', 'messages', 'quotes', 'events' ) as $contextchat_table ) {
		$wpdb->query( 'DROP TABLE IF EXISTS ' . $wpdb->prefix . 'contextchat_' . $contextchat_table ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQL.NotPrepared -- fixed table names.
	}
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

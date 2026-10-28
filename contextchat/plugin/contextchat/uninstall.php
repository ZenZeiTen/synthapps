<?php
/**
 * Remove everything ContextChat stored when the plugin is deleted.
 *
 * @package ContextChat
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

global $wpdb;

delete_option( 'contextchat_settings' );
delete_option( 'contextchat_db_version' );
wp_clear_scheduled_hook( 'contextchat_prune' );
delete_post_meta_by_key( '_contextchat_hide' );
delete_post_meta_by_key( '_contextchat_message' );

$wpdb->query( 'DROP TABLE IF EXISTS ' . $wpdb->prefix . 'contextchat_clicks' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQL.NotPrepared -- fixed table name.

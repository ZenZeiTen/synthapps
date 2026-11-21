<?php
/**
 * Print the events that belong to no conversation (deletion records, refused starts) as JSON.
 *
 *   php tests/e2e/events-check.php <site-dir>
 */

$_SERVER['HTTP_HOST']   = 'localhost';
$_SERVER['REQUEST_URI'] = '/';
require rtrim( $argv[1], '/' ) . '/wp-load.php';

global $wpdb;
echo wp_json_encode( $wpdb->get_col( "SELECT CONCAT(type, ':', detail) FROM {$wpdb->prefix}contextchat_events WHERE conversation_id IS NULL ORDER BY id" ) ) . "\n"; // phpcs:ignore

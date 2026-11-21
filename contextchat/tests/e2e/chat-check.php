<?php
/**
 * Print a chat conversation from the test site as JSON: the row (without the token hash), its
 * messages, quotes and events.
 *
 *   php tests/e2e/chat-check.php <site-dir> <conversation-id>
 */

$_SERVER['HTTP_HOST']   = 'localhost';
$_SERVER['REQUEST_URI'] = '/';
require rtrim( $argv[1], '/' ) . '/wp-load.php';

global $wpdb;
$id   = $argv[2];
$p    = $wpdb->prefix . 'contextchat_';
$conv = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$p}conversations WHERE id = %s", $id ), ARRAY_A ); // phpcs:ignore
if ( $conv ) {
	unset( $conv['token_hash'] );
	$conv['state'] = json_decode( $conv['intake_json'], true );
	unset( $conv['intake_json'] );
}
echo wp_json_encode(
	array(
		'conversation' => $conv,
		'messages'     => $wpdb->get_results( $wpdb->prepare( "SELECT role, content, model FROM {$p}messages WHERE conversation_id = %s ORDER BY id", $id ), ARRAY_A ), // phpcs:ignore
		'quotes'       => $wpdb->get_results( $wpdb->prepare( "SELECT reference, total FROM {$p}quotes WHERE conversation_id = %s ORDER BY id", $id ), ARRAY_A ), // phpcs:ignore
		'events'       => $wpdb->get_col( $wpdb->prepare( "SELECT CONCAT(type, ':', detail) FROM {$p}events WHERE conversation_id = %s ORDER BY id", $id ) ), // phpcs:ignore
	)
) . "\n";

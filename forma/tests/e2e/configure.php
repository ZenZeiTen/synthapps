<?php
/**
 * Change theme and toolkit settings for a browser test, through the same sanitizers the settings
 * screens use.
 *
 *   php tests/e2e/configure.php <site-dir> '{"theme":{...},"toolkit":{"modules":{...},"ai":{...}}}'
 *   php tests/e2e/configure.php <site-dir> reset
 */

$site = rtrim( $argv[1], '/' );
$_SERVER['HTTP_HOST']   = 'localhost';
$_SERVER['REQUEST_URI'] = '/';
require $site . '/wp-load.php';

use ZenZeiTen\FormaToolkit\Plugin;
use ZenZeiTen\FormaToolkit\Settings;

if ( 'reset' === $argv[2] ) {
	delete_option( 'zzforma_options' );
	delete_option( Settings::OPTION );
	delete_option( 'zzft_ai_usage' );
	global $wpdb;
	$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '%transient%zzft%'" );
	exit;
}

$changes = json_decode( $argv[2], true );
if ( isset( $changes['theme'] ) ) {
	update_option( 'zzforma_options', zzforma_sanitize_options( array_merge( get_option( 'zzforma_options', array() ) ?: array(), $changes['theme'] ) ) );
}
if ( isset( $changes['toolkit'] ) ) {
	$settings = Plugin::instance()->settings();
	foreach ( $changes['toolkit'] as $tab => $values ) {
		$input = array( '_tab' => $tab );
		if ( 'modules' === $tab ) {
			$input['modules'] = array_merge( array_map( array( $settings, 'is_enabled' ), array_combine( array_keys( $settings->modules() ), array_keys( $settings->modules() ) ) ), $values );
		} else {
			$current = array();
			foreach ( array_keys( $settings->fields( $tab ) ) as $key ) {
				$current[ $key ] = $settings->get( $tab, $key );
			}
			unset( $current['api_key'] );
			$input[ $tab ] = array_merge( $current, $values );
		}
		update_option( Settings::OPTION, $settings->sanitize( $input ) );
		$settings->flush();
	}
}

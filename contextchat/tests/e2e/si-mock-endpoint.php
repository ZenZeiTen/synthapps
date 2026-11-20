<?php
/**
 * Plugin Name: ContextChat SI test endpoint (tests only)
 * Description: Points ContextChat's Claude API client at a local mock server named in the ctxc_e2e_si_url option. Never install this on a real site.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

add_filter(
	'contextchat_si_api_url',
	static function ( $url ) {
		$mock = get_option( 'ctxc_e2e_si_url' );
		return $mock ? $mock : $url;
	}
);

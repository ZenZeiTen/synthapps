<?php
/**
 * Unit tests for the pure classes: IP, User_Agent, Fraud_Engine, Settings.
 *
 * @package VisitorSentinel
 */

// phpcs:disable

use VisitorSentinel\Fraud_Engine;
use VisitorSentinel\IP;
use VisitorSentinel\Settings;
use VisitorSentinel\User_Agent;

function test_ip_normalize() {
	check_same( '203.0.113.5', IP::normalize( ' 203.0.113.5 ' ) );
	check_same( '203.0.113.5', IP::normalize( '203.0.113.5:8080' ) );
	check_same( '203.0.113.5', IP::normalize( '::ffff:203.0.113.5' ) );
	check_same( '2001:db8::1', IP::normalize( '[2001:DB8:0::1]:443' ) );
	check_same( 'fe80::1', IP::normalize( 'fe80::1%eth0' ) );
	check_same( '', IP::normalize( '999.1.1.1' ) );
	check_same( '', IP::normalize( 'not an ip' ) );
	check_same( '', IP::normalize( '' ) );
}

function test_ip_ranges() {
	check( IP::in_range( '192.168.1.77', '192.168.1.0/24' ) );
	check( ! IP::in_range( '192.168.2.1', '192.168.1.0/24' ) );
	check( IP::in_range( '10.1.2.3', '10.0.0.0/8' ) );
	check( IP::in_range( '2001:db8:abcd::5', '2001:db8::/32' ) );
	check( ! IP::in_range( '2001:db9::5', '2001:db8::/32' ) );
	check( ! IP::in_range( '192.168.1.1', '2001:db8::/32' ), 'v4 never matches a v6 range' );
	check( IP::in_range( '172.70.1.1', '172.64.0.0/13' ) );
	check( IP::in_range( '1.2.3.4', '1.2.3.4' ) );
	check( IP::in_range( '1.2.3.4', '0.0.0.0/0' ) );
	check_same( null, IP::parse_range( '1.2.3.4/33' ) );
	check_same( null, IP::parse_range( '1.2.3.4/x' ) );
	check_same( '192.168.1.0/24', IP::parse_range( '192.168.1.99/24' )['canonical'] );
}

function test_ip_parse_list() {
	$list = IP::parse_list( "10.0.0.0/8 # office\n203.0.113.5, 198.51.100.0/24; garbage\n\n2001:db8::/32\n10.0.0.0/8" );
	check_same( array( '10.0.0.0/8', '203.0.113.5', '198.51.100.0/24', '2001:db8::/32' ), $list );
}

function test_ip_anonymize() {
	check_same( '203.0.113.0', IP::anonymize( '203.0.113.77' ) );
	check_same( '2001:db8:abcd::', IP::anonymize( '2001:db8:abcd:1234::99' ) );
}

function test_ip_resolve_ignores_untrusted_header() {
	$server = array(
		'REMOTE_ADDR'          => '198.51.100.20',
		'HTTP_X_FORWARDED_FOR' => '1.1.1.1',
	);
	check_same( '198.51.100.20', IP::resolve( $server, array(), 'X-Forwarded-For' ), 'no trusted proxies' );
	check_same( '198.51.100.20', IP::resolve( $server, array( '10.0.0.0/8' ), 'X-Forwarded-For' ), 'remote is not a trusted proxy' );
}

function test_ip_resolve_walks_forwarded_chain_from_the_right() {
	// A client spoofs 1.1.1.1 by sending its own header; the proxy appends the real address.
	$server = array(
		'REMOTE_ADDR'          => '10.0.0.5',
		'HTTP_X_FORWARDED_FOR' => '1.1.1.1, 203.0.113.9, 10.0.0.4',
	);
	check_same( '203.0.113.9', IP::resolve( $server, array( '10.0.0.0/8' ), 'X-Forwarded-For' ) );
	$cf = array(
		'REMOTE_ADDR'           => '172.70.1.1',
		'HTTP_CF_CONNECTING_IP' => '2001:db8::77',
	);
	check_same( '2001:db8::77', IP::resolve( $cf, Settings::CLOUDFLARE_RANGES, 'CF-Connecting-IP' ) );
}

function test_ip_google_ads_format() {
	check_same( '203.0.113.5', IP::to_google_ads( '203.0.113.5' ) );
	check_same( '203.0.113.*', IP::to_google_ads( '203.0.113.0/24' ) );
	check_same( '10.1.*.*', IP::to_google_ads( '10.1.0.0/16' ) );
	check_same( '', IP::to_google_ads( '10.1.0.0/20' ) );
	check_same( '2001:db8::1', IP::to_google_ads( '2001:db8::1' ) );
	check_same( '', IP::to_google_ads( '2001:db8::/48' ) );
}

function test_user_agent_parsing() {
	$chrome = User_Agent::parse( 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' );
	check_same( array( 'Chrome', 'Windows', 'desktop', false ), array( $chrome['browser'], $chrome['os'], $chrome['device'], $chrome['is_bot'] ) );

	$iphone = User_Agent::parse( 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' );
	check_same( array( 'Safari', 'iOS', 'mobile' ), array( $iphone['browser'], $iphone['os'], $iphone['device'] ) );

	$ipad = User_Agent::parse( 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' );
	check_same( 'tablet', $ipad['device'] );

	$android = User_Agent::parse( 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' );
	check_same( array( 'Chrome', 'Android', 'mobile' ), array( $android['browser'], $android['os'], $android['device'] ) );

	$edge = User_Agent::parse( 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0' );
	check_same( array( 'Edge', 'macOS' ), array( $edge['browser'], $edge['os'] ) );

	$cubot = User_Agent::parse( 'Mozilla/5.0 (Linux; Android 10; CUBOT X19) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36' );
	check_same( false, $cubot['is_bot'], 'Cubot is a phone' );
}

function test_user_agent_bots() {
	$google = User_Agent::parse( 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' );
	check( $google['is_bot'] && $google['good_bot'] && 'bot' === $google['device'] );

	$adsbot = User_Agent::parse( 'AdsBot-Google (+http://www.google.com/adsbot.html)' );
	check( $adsbot['good_bot'] );

	foreach ( array( 'curl/8.4.0', 'python-requests/2.31', 'Go-http-client/1.1', 'Scrapy/2.11', '' ) as $ua ) {
		$p = User_Agent::parse( $ua );
		check( $p['is_bot'] && ! $p['good_bot'], 'bot: ' . $ua );
	}

	$headless = User_Agent::parse( 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36' );
	check( $headless['headless'] && $headless['is_bot'] );
}

function test_fraud_engine_clean_human() {
	$engine = new Fraud_Engine( Settings::defaults() );
	$r      = $engine->evaluate(
		array(
			'type'              => 'ad_landing',
			'ip_clicks_1h'      => 1,
			'ip_clicks_24h'     => 1,
			'dwell'             => 45,
			'interactions'      => 12,
			'session_pageviews' => 3,
		)
	);
	check_same( 0, $r['score'] );
	check_same( Fraud_Engine::STATUS_CLEAN, $r['status'] );
}

function test_fraud_engine_thresholds() {
	$engine = new Fraud_Engine( Settings::defaults() );
	check_same( array(), $engine->evaluate( array( 'ip_clicks_1h' => 3 ) )['reasons'], 'three clicks an hour is the limit, not over it' );
	check_same( 30, $engine->evaluate( array( 'ip_clicks_1h' => 4 ) )['score'] );
	check_same( 38, $engine->evaluate( array( 'ip_clicks_1h' => 5 ) )['score'] );
	check_same( 54, $engine->evaluate( array( 'ip_clicks_1h' => 50 ) )['score'], 'burst bonus is capped' );
	check_same( 25, $engine->evaluate( array( 'ip_clicks_24h' => 11 ) )['score'] );
}

function test_fraud_engine_bot_and_script_click() {
	$engine = new Fraud_Engine( Settings::defaults() );
	$r      = $engine->evaluate(
		array(
			'type'          => 'ad_click',
			'trusted'       => 0,
			'time_to_click' => 120,
			'interactions'  => 0,
		)
	);
	check_same( 90, $r['score'] );
	check_same( Fraud_Engine::STATUS_FRAUD, $r['status'] );
	check_same( 'untrusted_event', $r['reasons'][0], 'strongest reason first' );
	check_same( 100, $engine->evaluate( array( 'bot' => true, 'headless' => true ) )['score'], 'capped at 100' );
}

function test_fraud_engine_sensitivity_and_allowlist() {
	$facts = array( 'type' => 'ad_click', 'time_to_click' => 100, 'interactions' => 0 );
	check_same( 34, ( new Fraud_Engine( array( 'fraud_sensitivity' => 'low' ) ) )->evaluate( $facts )['score'] );
	check_same( 45, ( new Fraud_Engine( array( 'fraud_sensitivity' => 'medium' ) ) )->evaluate( $facts )['score'] );
	check_same( 56, ( new Fraud_Engine( array( 'fraud_sensitivity' => 'high' ) ) )->evaluate( $facts )['score'] );
	$r = ( new Fraud_Engine( array() ) )->evaluate( array( 'allowlisted' => true, 'bot' => true ) );
	check_same( array( 0, array( 'allowlisted' ) ), array( $r['score'], $r['reasons'] ) );
}

function test_fraud_engine_zero_engagement_and_iframe() {
	$engine = new Fraud_Engine( Settings::defaults() );
	check_same( array( 'zero_engagement' ), $engine->evaluate( array( 'type' => 'ad_landing', 'dwell' => 1, 'interactions' => 0, 'session_pageviews' => 1 ) )['reasons'] );
	check_same( array(), $engine->evaluate( array( 'type' => 'ad_landing', 'dwell' => -1, 'interactions' => -1 ) )['reasons'], 'unknown dwell is not held against the click' );
	check_same( array(), $engine->evaluate( array( 'type' => 'ad_landing', 'dwell' => 1, 'interactions' => 0, 'session_pageviews' => 2 ) )['reasons'], 'a second page means engagement' );
	check_same( array(), $engine->evaluate( array( 'type' => 'ad_click', 'iframe' => true, 'interactions' => 0, 'time_to_click' => 5000 ) )['reasons'], 'iframe clicks carry no interaction data' );
}

function test_settings_sanitize() {
	$out = Settings::sanitize(
		array(
			'tracking_enabled'     => '1',
			'exclude_roles'        => array( 'administrator', 'nonexistent' ),
			'ip_mode'              => 'evil',
			'proxy_header'         => 'X-Evil',
			'trusted_proxies'      => "10.0.0.0/8\nnope",
			'ad_selectors'         => ".ad-slot\n</style><script>\nbody{x}\n#ok",
			'burst_threshold'      => '500',
			'auto_block_threshold' => '5',
			'alert_email'          => 'not-an-email',
			'protection_action'    => 'block_site',
		)
	);
	check_same( 1, $out['tracking_enabled'] );
	check_same( 0, $out['respect_dnt'], 'unchecked boxes save as 0' );
	check_same( array( 'administrator' ), $out['exclude_roles'] );
	check_same( 'full', $out['ip_mode'] );
	check_same( '', $out['proxy_header'] );
	check_same( '10.0.0.0/8', $out['trusted_proxies'] );
	check_same( ".ad-slot\n#ok", $out['ad_selectors'], 'selectors that could break out of CSS are dropped' );
	check_same( 100, $out['burst_threshold'] );
	check_same( 40, $out['auto_block_threshold'] );
	check_same( '', $out['alert_email'] );
	check_same( 'block_site', $out['protection_action'] );
}

function test_admin_helpers() {
	check_same( "'=HYPERLINK(1)", VisitorSentinel\Admin\Admin::csv_cell( '=HYPERLINK(1)' ) );
	check_same( '-5', VisitorSentinel\Admin\Admin::csv_cell( '-5' ), 'negative numbers stay numbers' );
	check_same( "\u{1F1EE}\u{1F1E9}", VisitorSentinel\Admin\Admin::flag( 'ID' ) );
	check_same( '', VisitorSentinel\Admin\Admin::flag( 'xx' ) );
	check_same( '3m 20s', VisitorSentinel\Admin\Admin::duration( 200 ) );
}

function test_wporg_update_offer_is_dropped() {
	VisitorSentinel\Plugin::instance()->boot();
	$transient = (object) array(
		'response'  => array(
			'zenzeiten-visitor-guard/zenzeiten-visitor-guard.php' => (object) array( 'new_version' => '3.0.3' ),
			'akismet/akismet.php'                   => (object) array( 'new_version' => '5.4' ),
		),
		'no_update' => array( 'zenzeiten-visitor-guard/zenzeiten-visitor-guard.php' => (object) array( 'new_version' => '3.0.3' ) ),
	);
	$out = apply_filters( 'site_transient_update_plugins', $transient );
	check_same( array( 'akismet/akismet.php' ), array_keys( $out->response ), 'only the same-named plugin is dropped' );
	check_same( array(), $out->no_update );
	check_same( false, apply_filters( 'site_transient_update_plugins', false ), 'a missing transient stays missing' );
	check( false !== strpos( file_get_contents( VSEN_FILE ), "\n * Update URI:        false\n" ), 'header opts out of WordPress.org updates' );
	check( in_array( array( 'VisitorSentinel\\Cron', 'schedule' ), WP_Stub::$filters['init'], true ), 'cron is rescheduled after a switch from the old folder' );
}

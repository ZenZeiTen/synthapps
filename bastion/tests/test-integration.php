<?php
/**
 * Integration tests: the real classes on the SQLite database.
 *
 * @package ZenZeiTenBastion
 */

// phpcs:disable

use ZenZeiTenBastion\Alerts;
use ZenZeiTenBastion\Backup;
use ZenZeiTenBastion\Blocklist;
use ZenZeiTenBastion\Cron;
use ZenZeiTenBastion\Guard;
use ZenZeiTenBastion\Hardening;
use ZenZeiTenBastion\Log;
use ZenZeiTenBastion\Settings;

function zbst_admin_user() {
	return (object) array( 'ID' => 1, 'user_login' => 'admin', 'roles' => array( 'administrator' ) );
}

function zbst_events( $type = '' ) {
	return Log::query( $type ? array( 'type' => $type ) : array(), 1000, 0 );
}

// ---------------------------------------------------------------------------------------------
// Firewall on live requests.
// ---------------------------------------------------------------------------------------------

function test_attack_request_is_blocked_and_logged() {
	zbst_request( '198.51.100.7', array( 'id' => "1 UNION SELECT user_pass FROM wp_users" ) );
	check_same( 403, zbst_run_guard() );
	$events = zbst_events( 'firewall' );
	check_same( 1, count( $events ) );
	check_same( 'sqli-union', $events[0]['rule'] );
	check_same( 'blocked', $events[0]['action'] );
	check_same( '198.51.100.7', $events[0]['ip'] );
	check_same( '10', (string) $events[0]['score'] );

	zbst_request( '198.51.100.7', array( 's' => 'blue shoes' ) );
	check_same( 0, zbst_run_guard(), 'a normal request from the same address still passes' );
}

function test_log_only_mode_records_without_blocking() {
	update_option( Settings::OPTION, array_merge( Settings::all(), array( 'firewall_mode' => 'log' ) ) );
	Settings::flush();
	zbst_request( '198.51.100.7', array( 'q' => '<script>alert(1)</script>' ) );
	check_same( 0, zbst_run_guard() );
	check_same( 'logged', zbst_events( 'firewall' )[0]['action'] );
}

function test_editors_are_not_inspected() {
	WP_Stub::$user = (object) array( 'ID' => 2, 'roles' => array( 'editor' ) );
	zbst_request( '198.51.100.7', array(), array(), array( 'content' => '<script src="https://widget.example/x.js"></script>' ) );
	check_same( 0, zbst_run_guard() );
	check_same( 0, count( zbst_events() ) );
}

function test_json_body_and_uploads_are_inspected() {
	zbst_request( '198.51.100.8', array(), array( 'REQUEST_METHOD' => 'POST' ) );
	$_FILES = array( 'file' => array( 'name' => 'avatar.php', 'tmp_name' => '/tmp/x', 'size' => 10 ) );
	check_same( 403, zbst_run_guard() );
	check_same( 'upload-script', zbst_events( 'firewall' )[0]['rule'] );
}

function test_scanner_and_probe_requests() {
	zbst_request( '198.51.100.9', array(), array( 'REQUEST_URI' => '/.env' ) );
	check_same( 403, zbst_run_guard() );
	zbst_request( '198.51.100.9', array(), array( 'HTTP_USER_AGENT' => 'Mozilla/5.0 (compatible; Nuclei - Open-source project (github.com/projectdiscovery/nuclei))' ) );
	check_same( 403, zbst_run_guard() );
	$rules = array_column( zbst_events( 'firewall' ), 'rule' );
	sort( $rules );
	check_same( array( 'scanner-ua', 'sensitive-file' ), $rules );
}

// ---------------------------------------------------------------------------------------------
// Automatic detection and blocking.
// ---------------------------------------------------------------------------------------------

function test_repeated_attacks_get_the_address_blocked() {
	$ip = '198.51.100.20';
	// Default threshold 20; a critical rule scores 10.
	zbst_request( $ip, array( 'id' => "1' AND SLEEP(5)--" ) );
	check_same( 403, zbst_run_guard() );
	check( null === Blocklist::match( $ip ), 'one attack is not enough to block' );

	zbst_request( $ip, array( 'id' => "1 UNION SELECT 1" ) );
	check_same( 403, zbst_run_guard() );
	check_same( $ip, Blocklist::match( $ip ) );

	$blocks = Blocklist::active();
	check_same( 1, count( $blocks ) );
	check_same( 'auto', $blocks[0]['source'] );
	$minutes = ( strtotime( $blocks[0]['expires_at'] . ' UTC' ) - time() ) / 60;
	check( $minutes > 58 && $minutes <= 60, 'first offence blocks for one hour' );
	check_same( 1, count( zbst_events( 'auto_block' ) ) );

	// Now every request from the address is refused, even harmless ones, and counted.
	zbst_request( $ip, array( 's' => 'hello' ) );
	check_same( 403, zbst_run_guard() );
	zbst_request( $ip );
	check_same( 403, zbst_run_guard() );
	check_same( '2', (string) Blocklist::active()[0]['hits'] );
	check_same( 1, count( zbst_events( 'blocked' ) ), 'blocked hits are logged at most every five minutes' );

	// Other addresses are unaffected.
	zbst_request( '198.51.100.21', array( 's' => 'hello' ) );
	check_same( 0, zbst_run_guard() );
}

function test_repeat_offenders_are_blocked_longer() {
	$ip    = '198.51.100.30';
	$hours = array();
	foreach ( array( 1, 2, 3, 4, 5 ) as $round ) {
		$block = Blocklist::add( $ip, 'auto', 'test' );
		$hours[] = (int) round( ( strtotime( $block['expires_at'] . ' UTC' ) - time() ) / 3600 );
		check_same( $round, $block['offenses'] );
		Blocklist::remove( $ip );
	}
	check_same( array( 1, 24, 168, 720, 720 ), $hours );
	check( null === Blocklist::match( $ip ) );
	// Forgetting resets the history.
	global $wpdb;
	$id = (int) $wpdb->get_var( "SELECT id FROM wp_zbst_blocks WHERE ip = '{$ip}'" );
	Blocklist::forget( $id );
	check_same( 1, Blocklist::add( $ip, 'auto', 'again' )['offenses'] );
}

function test_permanent_and_range_blocks() {
	Blocklist::add( '192.0.2.0/24', 'manual', 'bad network', 0 );
	check_same( '192.0.2.0/24', Blocklist::match( '192.0.2.77' ) );
	check( null === Blocklist::match( '192.0.3.1' ) );
	check( null === Blocklist::active()[0]['expires_at'] );
	Blocklist::add( '2001:db8::/32', 'manual', 'v6', 0 );
	check_same( '2001:db8::/32', Blocklist::match( '2001:db8:1::9' ) );
	check( Blocklist::remove( '192.0.2.0/24' ) );
	check( null === Blocklist::match( '192.0.2.77' ) );
}

function test_expired_blocks_stop_matching() {
	global $wpdb;
	Blocklist::add( '198.51.100.40', 'auto', 'old' );
	$wpdb->query( "UPDATE wp_zbst_blocks SET expires_at = '" . gmdate( 'Y-m-d H:i:s', time() - 60 ) . "'" );
	Blocklist::rebuild_index();
	check( null === Blocklist::match( '198.51.100.40' ) );
	check_same( 0, Blocklist::count_active() );
}

function test_allowlist_and_admin_addresses_are_never_auto_blocked() {
	update_option( Settings::OPTION, array_merge( Settings::all(), array( 'allowlist' => '203.0.113.0/24' ) ) );
	Settings::flush();
	check( null === Blocklist::add( '203.0.113.5', 'manual', 'x', 0 ) );
	zbst_request( '203.0.113.5', array( 'id' => '1 UNION SELECT 1' ) );
	check_same( 0, zbst_run_guard(), 'allowlisted addresses are not inspected' );
	check( null === Blocklist::match( '127.0.0.1' ) && null === Blocklist::add( '127.0.0.1', 'manual', 'x', 0 ) );

	Blocklist::remember_admin_ip( '198.51.100.50' );
	for ( $i = 0; $i < 5; $i++ ) {
		zbst_request( '198.51.100.50', array( 'id' => '1 UNION SELECT ' . $i ) );
		check_same( 403, zbst_run_guard(), 'the attack request itself is still refused' );
	}
	check( null === Blocklist::match( '198.51.100.50' ), 'an administrator address is spared from automatic blocks' );

	update_option( Settings::OPTION, array_merge( Settings::all(), array( 'protect_admin_ips' => 0 ) ) );
	Settings::flush();
	zbst_request( '198.51.100.50', array( 'id' => '1 UNION SELECT 9' ) );
	zbst_run_guard();
	check_same( '198.51.100.50', Blocklist::match( '198.51.100.50' ) );
}

function test_auto_block_can_be_switched_off() {
	update_option( Settings::OPTION, array_merge( Settings::all(), array( 'auto_block' => 0 ) ) );
	Settings::flush();
	for ( $i = 0; $i < 5; $i++ ) {
		zbst_request( '198.51.100.60', array( 'id' => '1 UNION SELECT ' . $i ) );
		zbst_run_guard();
	}
	check( null === Blocklist::match( '198.51.100.60' ) );
}

function test_old_events_do_not_count_toward_the_score() {
	global $wpdb;
	zbst_request( '198.51.100.70', array( 'id' => '1 UNION SELECT 1' ) );
	zbst_run_guard();
	$wpdb->query( "UPDATE wp_zbst_events SET created_at = '" . gmdate( 'Y-m-d H:i:s', time() - 2 * 3600 ) . "'" );
	zbst_request( '198.51.100.70', array( 'id' => '1 UNION SELECT 2' ) );
	zbst_run_guard();
	check( null === Blocklist::match( '198.51.100.70' ) );
	check_same( 10, Log::score( '198.51.100.70', 60 ) );
}

// ---------------------------------------------------------------------------------------------
// Login protection and hardening.
// ---------------------------------------------------------------------------------------------

function test_brute_force_locks_the_address_out() {
	$ip = '198.51.100.80';
	zbst_request( $ip, array(), array( 'REQUEST_URI' => '/wp-login.php', 'REQUEST_METHOD' => 'POST' ) );
	for ( $i = 1; $i <= 4; $i++ ) {
		Hardening::login_failed( 'admin' );
		check( null === Blocklist::match( $ip ), "not locked after {$i} failures" );
	}
	Hardening::login_failed( 'administrator' );
	check_same( $ip, Blocklist::match( $ip ) );
	$block = Blocklist::active()[0];
	check_same( 'login', $block['source'] );
	$minutes = (int) round( ( strtotime( $block['expires_at'] . ' UTC' ) - time() ) / 60 );
	check_same( 60, $minutes );
	check_same( 5, count( zbst_events( 'login_failed' ) ) );
	check_same( 'administrator', zbst_events( 'login_failed' )[0]['username'] );
	zbst_request( $ip, array(), array( 'REQUEST_URI' => '/wp-login.php' ) );
	check_same( 403, zbst_run_guard(), 'the login page is refused while locked out' );
}

function test_admin_login_remembers_address() {
	zbst_request( '198.51.100.90' );
	$user = new class() {
		public function has_cap( $cap ) { return true; }
	};
	Hardening::login_ok( 'admin', $user );
	check( Blocklist::is_admin_ip( '198.51.100.90' ) );
	check_same( 1, count( zbst_events( 'login_ok' ) ) );
}

function test_generic_login_errors() {
	$msg = Hardening::login_errors( '<strong>Error:</strong> The password you entered for the username <strong>admin</strong> is incorrect.' );
	check( false === strpos( $msg, 'admin' ) );
	update_option( Settings::OPTION, array_merge( Settings::all(), array( 'generic_login_errors' => 0 ) ) );
	Settings::flush();
	check( false !== strpos( Hardening::login_errors( 'for the username <strong>admin</strong>' ), 'admin' ) );
}

function test_user_enumeration_is_stopped() {
	zbst_request( '198.51.100.100', array( 'author' => '1' ) );
	$stopped = null;
	try {
		Hardening::template_redirect();
	} catch ( Zbst_Stop $e ) {
		$stopped = $e;
	}
	check( $stopped && 302 === $stopped->status && 'https://example.com/' === $stopped->getMessage() );
	check_same( 1, count( zbst_events( 'enumeration' ) ) );

	$result = Hardening::rest_users( null, null, new WP_REST_Request( array(), '/wp/v2/users' ) );
	check( $result instanceof WP_Error );
	check( null === Hardening::rest_users( null, null, new WP_REST_Request( array(), '/wp/v2/posts' ) ) );
	WP_Stub::$user = zbst_admin_user();
	check( null === Hardening::rest_users( null, null, new WP_REST_Request( array(), '/wp/v2/users' ) ) );
}

function test_xmlrpc_hardening() {
	check_same( false, Hardening::xmlrpc_enabled( true ) );
	check( ! isset( Hardening::xmlrpc_methods( array( 'system.multicall' => 'x', 'pingback.ping' => 'y' ) )['system.multicall'] ) );
	update_option( Settings::OPTION, array_merge( Settings::all(), array( 'xmlrpc' => 'allow' ) ) );
	Settings::flush();
	check_same( true, Hardening::xmlrpc_enabled( true ) );
}

function test_404_flood_scores_the_address() {
	update_option( Settings::OPTION, array_merge( Settings::all(), array( 'not_found_limit' => 5 ) ) );
	Settings::flush();
	WP_Stub::$is_404 = true;
	zbst_request( '198.51.100.110' );
	for ( $i = 0; $i < 12; $i++ ) {
		Hardening::template_redirect();
	}
	check_same( 1, count( zbst_events( 'not_found' ) ), 'one event per flood, not per request' );
}

function test_rate_limit() {
	update_option( Settings::OPTION, array_merge( Settings::all(), array( 'rate_limit' => 3 ) ) );
	Settings::flush();
	$codes = array();
	for ( $i = 0; $i < 5; $i++ ) {
		zbst_request( '198.51.100.120' );
		$codes[] = zbst_run_guard();
	}
	check_same( array( 0, 0, 0, 429, 429 ), $codes );
	check_same( 1, count( zbst_events( 'rate_limit' ) ) );
	zbst_request( '198.51.100.121' );
	check_same( 0, zbst_run_guard() );
}

// ---------------------------------------------------------------------------------------------
// Alerts and monitoring.
// ---------------------------------------------------------------------------------------------

function test_block_alerts_are_batched() {
	Guard::auto_block( '198.51.100.130', 'auto', 'one', null );
	check_same( 1, count( WP_Stub::$mail ) );
	check( false !== strpos( WP_Stub::$mail[0]['body'], '198.51.100.130' ) );
	check_same( 'owner@example.com', WP_Stub::$mail[0]['to'] );
	Guard::auto_block( '198.51.100.131', 'auto', 'two', null );
	Guard::auto_block( '198.51.100.132', 'auto', 'three', null );
	check_same( 1, count( WP_Stub::$mail ), 'no second email within fifteen minutes' );
	update_option( Alerts::LAST, time() - 3600 );
	Cron::hourly();
	check_same( 2, count( WP_Stub::$mail ) );
	check( false !== strpos( WP_Stub::$mail[1]['body'], '198.51.100.131' ) && false !== strpos( WP_Stub::$mail[1]['body'], '198.51.100.132' ) );
}

function test_new_administrator_is_detected() {
	WP_Stub::$users = array( zbst_admin_user() );
	check_same( array(), Cron::watch_admins(), 'the first check only records' );
	WP_Stub::$users[] = (object) array( 'ID' => 7, 'user_login' => 'wp_support_x', 'roles' => array( 'administrator' ) );
	check_same( array( 'wp_support_x' ), Cron::watch_admins() );
	check_same( 1, count( zbst_events( 'admin_change' ) ) );
	check( false !== strpos( end( WP_Stub::$mail )['body'], 'wp_support_x' ) );
	check_same( array(), Cron::watch_admins() );
}

function test_live_feed_returns_new_events_only() {
	zbst_request( '198.51.100.140', array( 'id' => '1 UNION SELECT 1' ) );
	zbst_run_guard();
	WP_Stub::$user = zbst_admin_user();
	$admin = new ZenZeiTenBastion\Admin\Admin();
	$data  = $admin->live( new WP_REST_Request( array( 'after' => 0 ) ) )->get_data();
	check_same( 1, count( $data['events'] ) );
	check_same( '198.51.100.140', $data['events'][0]['ip'] );
	check_same( 1, $data['counters']['blocked'] );
	check_same( 24, count( $data['hours'] ) );
	check_same( 1, array_sum( $data['hours'] ) );
	$last = $data['events'][0]['id'];
	check_same( array(), $admin->live( new WP_REST_Request( array( 'after' => $last ) ) )->get_data()['events'] );
	WP_Stub::$user = null;
	zbst_request( '198.51.100.141', array( 'q' => '<script>x</script>' ) );
	zbst_run_guard();
	$next = $admin->live( new WP_REST_Request( array( 'after' => $last ) ) )->get_data()['events'];
	check_same( 1, count( $next ) );
	check_same( '198.51.100.141', $next[0]['ip'] );
}

function test_log_pruning() {
	global $wpdb;
	zbst_request( '198.51.100.150', array( 'id' => '1 UNION SELECT 1' ) );
	zbst_run_guard();
	$wpdb->query( "UPDATE wp_zbst_events SET created_at = '2000-01-01 00:00:00'" );
	Log::add( array( 'type' => 'backup', 'details' => 'recent' ) );
	check_same( 1, Log::prune( 30 ) );
	check_same( 1, Log::count( array() ) );
}

function test_cron_schedule_follows_settings() {
	Cron::schedule();
	check_same( 'hourly', wp_get_schedule( 'zbst_hourly' ) );
	check_same( 'daily', wp_get_schedule( 'zbst_backup' ) );
	update_option( Settings::OPTION, array_merge( Settings::all(), array( 'backup_schedule' => 'weekly' ) ) );
	Settings::flush();
	Cron::schedule();
	check_same( 'weekly', wp_get_schedule( 'zbst_backup' ) );
	update_option( Settings::OPTION, array_merge( Settings::all(), array( 'backup_schedule' => 'off' ) ) );
	Settings::flush();
	Cron::schedule();
	check_same( false, wp_get_schedule( 'zbst_backup' ) );
}

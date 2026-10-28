<?php
/**
 * Integration tests: the collect endpoint, server-side landing capture, fraud scoring,
 * blocking, cron, alerts and reports, against the real schema on SQLite.
 *
 * @package VisitorSentinel
 */

// phpcs:disable

use VisitorSentinel\Cron;
use VisitorSentinel\Fraud_Engine;
use VisitorSentinel\Protection;
use VisitorSentinel\Repository;
use VisitorSentinel\Request_Context;
use VisitorSentinel\Tracker;

const VSEN_VID  = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const VSEN_VID2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function vsen_db() {
	return $GLOBALS['wpdb'];
}

function vsen_count( $table, $where = '1=1' ) {
	return (int) vsen_db()->get_var( 'SELECT COUNT(*) FROM wp_vsen_' . $table . ' WHERE ' . $where );
}

function vsen_pv( $url, $vid = VSEN_VID, $session = '', array $extra = array(), array $server = array() ) {
	return vsen_collect( array_merge( array( 'e' => 'pv', 'u' => $url, 'r' => 'https://www.google.com/', 'ti' => 'Landing', 'v' => $vid, 's' => $session, 'sw' => 1920, 'sh' => 1080, 'wd' => 0 ), $extra ), $server );
}

function test_pageview_creates_visitor_session_and_pageview() {
	list( $status, $data ) = vsen_pv( 'https://example.com/pricing/?utm_source=newsletter&utm_campaign=october' );
	check_same( 200, $status );
	check( $data['ok'] && $data['pv'] > 0 && 24 === strlen( $data['t'] ) && preg_match( '/^[a-f0-9]{32}$/', $data['s'] ) );
	check_same( 0, $data['f'] );

	$visitor = vsen_db()->get_row( 'SELECT * FROM wp_vsen_visitors' );
	check_same( '203.0.113.10', $visitor->ip );
	check_same( 64, strlen( $visitor->ip_hash ) );
	check_same( array( 'Chrome', 'Windows', 'desktop', 0 ), array( $visitor->browser, $visitor->os, $visitor->device, (int) $visitor->is_bot ) );
	check_same( array( 1, 1 ), array( (int) $visitor->sessions, (int) $visitor->pageviews ) );

	$session = vsen_db()->get_row( 'SELECT * FROM wp_vsen_sessions' );
	check_same( array( 'www.google.com', 'newsletter', 'october', 0 ), array( $session->referrer_host, $session->utm_source, $session->utm_campaign, (int) $session->is_paid ) );

	$pv = vsen_db()->get_row( 'SELECT * FROM wp_vsen_pageviews' );
	check_same( array( '/pricing/', 'Landing' ), array( $pv->path, $pv->title ) );
	check_same( 0, vsen_count( 'clicks' ), 'utm without a paid medium is not an ad click' );
}

function test_session_continues_and_expires() {
	list( , $first ) = vsen_pv( 'https://example.com/' );
	list( , $second ) = vsen_pv( 'https://example.com/about/', VSEN_VID, $first['s'] );
	check_same( $first['s'], $second['s'] );
	check_same( 1, vsen_count( 'sessions' ) );
	check_same( 2, (int) vsen_db()->get_var( 'SELECT pageviews FROM wp_vsen_sessions' ) );

	vsen_db()->query( "UPDATE wp_vsen_sessions SET last_activity = '2000-01-01 00:00:00'" );
	list( , $third ) = vsen_pv( 'https://example.com/contact/', VSEN_VID, $first['s'] );
	check( $third['s'] !== $first['s'], 'an idle session is not resumed' );
	check_same( 2, vsen_count( 'sessions' ) );
	check_same( 2, (int) vsen_db()->get_var( 'SELECT sessions FROM wp_vsen_visitors' ) );
}

function test_session_key_of_another_visitor_is_ignored() {
	list( , $mine ) = vsen_pv( 'https://example.com/' );
	list( , $theirs ) = vsen_pv( 'https://example.com/', VSEN_VID2, $mine['s'] );
	check( $theirs['s'] !== $mine['s'] );
}

function test_visitor_without_storage_is_recognized_by_ip_and_browser() {
	vsen_test_reset( array( 'use_storage' => 0 ) );
	list( , $a ) = vsen_pv( 'https://example.com/', VSEN_VID, '' );
	list( , $b ) = vsen_pv( 'https://example.com/two/', VSEN_VID2, '' );
	check_same( 1, vsen_count( 'visitors' ), 'browser IDs are ignored when storage is off' );
	check_same( $a['s'], $b['s'], 'latest active session is reused' );
}

function test_rejects_bad_requests() {
	check_same( 400, vsen_pv( 'https://evil.example.net/' )[0], 'foreign host' );
	check_same( 400, vsen_pv( 'javascript:alert(1)' )[0], 'non-http URL' );
	check_same( 200, vsen_pv( 'https://www.example.com/' )[0], 'www is the same site' );
	$response = ( new Tracker() )->collect( new WP_REST_Request( 'not json' ) );
	check_same( 400, $response->get_status() );
	$response = ( new Tracker() )->collect( new WP_REST_Request( str_repeat( 'x', 9000 ) ) );
	check_same( 400, $response->get_status() );
	check_same( 400, vsen_collect( array( 'e' => 'nope' ) )[0] );
	check_same( 'no-store, max-age=0', $response->headers['Cache-Control'] );
}

function test_engagement_requires_token_and_only_grows() {
	list( , $pv ) = vsen_pv( 'https://example.com/' );
	check_same( 403, vsen_collect( array( 'e' => 'eng', 'pv' => $pv['pv'], 't' => str_repeat( '0', 24 ), 'tt' => 5000 ) )[0] );
	check_same( 403, vsen_collect( array( 'e' => 'eng', 'pv' => $pv['pv'] + 1, 't' => $pv['t'], 'tt' => 5000 ) )[0], 'token is bound to its pageview' );

	check_same( 200, vsen_collect( array( 'e' => 'eng', 'pv' => $pv['pv'], 't' => $pv['t'], 'tt' => 42000, 'at' => 30000, 'sc' => 80, 'it' => 9 ) )[0] );
	vsen_collect( array( 'e' => 'eng', 'pv' => $pv['pv'], 't' => $pv['t'], 'tt' => 1000, 'at' => 1000, 'sc' => 10, 'it' => 1 ) );
	$row = vsen_db()->get_row( 'SELECT * FROM wp_vsen_pageviews' );
	check_same( array( 42, 30, 80, 9 ), array( (int) $row->time_on_page, (int) $row->active_time, (int) $row->max_scroll, (int) $row->interactions ) );
}

function test_human_paid_visit_is_clean() {
	vsen_visit( array( 'gclid' => 'Cj0KCQjwHUMAN123' ) );
	check_same( 1, vsen_count( 'clicks' ) );
	$server_row = vsen_db()->get_row( 'SELECT * FROM wp_vsen_clicks' );
	check_same( array( 1, 0, 0 ), array( (int) $server_row->server_seen, (int) $server_row->js_confirmed, (int) $server_row->visitor_id ) );

	list( , $pv ) = vsen_pv( 'https://example.com/landing/?gclid=Cj0KCQjwHUMAN123' );
	check_same( 1, vsen_count( 'clicks' ), 'the browser confirms the server row instead of adding one' );
	$click = vsen_db()->get_row( 'SELECT * FROM wp_vsen_clicks' );
	check_same( array( 'ad_landing', 'google_ads', 1, 1 ), array( $click->click_type, $click->network, (int) $click->server_seen, (int) $click->js_confirmed ) );
	check( (int) $click->visitor_id > 0 && (int) $click->session_id > 0 );
	check_same( 1, (int) vsen_db()->get_var( 'SELECT is_paid FROM wp_vsen_sessions' ) );

	vsen_collect( array( 'e' => 'eng', 'pv' => $pv['pv'], 't' => $pv['t'], 'tt' => 65000, 'at' => 60000, 'sc' => 70, 'it' => 25 ) );
	( new VisitorSentinel\Fraud_Service() )->evaluate( (int) $click->id, true );
	$click = vsen_db()->get_row( 'SELECT * FROM wp_vsen_clicks' );
	check_same( array( 0, Fraud_Engine::STATUS_CLEAN, 1 ), array( (int) $click->fraud_score, (int) $click->status, (int) $click->finalized ) );

	vsen_pv( 'https://example.com/landing/?gclid=Cj0KCQjwHUMAN123', VSEN_VID );
	check_same( 1, vsen_count( 'clicks' ), 'reloading the landing page is not another click' );
}

function test_landing_without_javascript_becomes_fraud_and_is_blocked() {
	$curl = array( 'HTTP_USER_AGENT' => 'curl/8.4.0', 'HTTP_ACCEPT_LANGUAGE' => '', 'REMOTE_ADDR' => '198.51.100.66' );
	for ( $i = 1; $i <= 5; $i++ ) {
		vsen_visit( array( 'gclid' => 'BOTCLICK' . str_repeat( (string) $i, 8 ) ), $curl );
	}
	check_same( 5, vsen_count( 'clicks' ) );
	vsen_db()->query( "UPDATE wp_vsen_clicks SET created_at = '" . Repository::now( -1200 ) . "'" );

	check_same( 5, Cron::finalize_clicks() );
	$last = vsen_db()->get_row( 'SELECT * FROM wp_vsen_clicks ORDER BY id DESC LIMIT 1' );
	check_same( Fraud_Engine::STATUS_FRAUD, (int) $last->status );
	check_same( 100, (int) $last->fraud_score );
	foreach ( array( 'bot_ua', 'no_js', 'ip_burst', 'missing_headers' ) as $rule ) {
		check( false !== strpos( $last->fraud_reasons, $rule ), 'reason ' . $rule . ' in ' . $last->fraud_reasons );
	}
	check( (int) $last->visitor_id > 0, 'a visitor is created for clients that never ran JavaScript' );
	check_same( 1, vsen_count( 'visitors', 'is_bot = 1' ) );

	check_same( 1, vsen_count( 'blocklist' ) );
	$block = vsen_db()->get_row( 'SELECT * FROM wp_vsen_blocklist' );
	check_same( array( 'auto', '198.51.100.66', 'hash' ), array( $block->source, $block->ip_range, $block->match_type ) );
	check( null !== $block->expires_at, 'automatic blocks expire' );

	$_SERVER = array( 'REMOTE_ADDR' => '198.51.100.66' );
	Request_Context::reset();
	check( Protection::is_blocked( Request_Context::current() ) );
	$_SERVER = array( 'REMOTE_ADDR' => '198.51.100.67' );
	Request_Context::reset();
	check( ! Protection::is_blocked( Request_Context::current() ) );

	list( , $pv ) = vsen_pv( 'https://example.com/', VSEN_VID2, '', array(), $curl );
	check_same( 1, $pv['f'], 'the tracker tells a blocked visitor to hide ads' );
}

function test_good_bots_are_never_auto_blocked() {
	$googlebot = array( 'HTTP_USER_AGENT' => 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'REMOTE_ADDR' => '66.249.66.1' );
	for ( $i = 1; $i <= 6; $i++ ) {
		vsen_visit( array( 'gclid' => 'GBOTCLICK' . str_repeat( (string) $i, 8 ) ), $googlebot );
	}
	vsen_db()->query( "UPDATE wp_vsen_clicks SET created_at = '" . Repository::now( -1200 ) . "'" );
	Cron::finalize_clicks();
	check_same( 6, vsen_count( 'clicks', 'status = 2' ), 'still scored as fraud' );
	check_same( 0, vsen_count( 'blocklist' ) );
}

function test_click_id_replayed_from_another_ip() {
	vsen_pv( 'https://example.com/landing/?gclid=SHAREDCLICK123' );
	list( , $other ) = vsen_pv( 'https://example.com/landing/?gclid=SHAREDCLICK123', VSEN_VID2, '', array(), array( 'REMOTE_ADDR' => '192.0.2.44' ) );
	check_same( 2, vsen_count( 'clicks' ) );
	$replay = vsen_db()->get_row( 'SELECT * FROM wp_vsen_clicks ORDER BY id DESC LIMIT 1' );
	check( false !== strpos( $replay->fraud_reasons, 'click_id_replay' ) );
	$first = vsen_db()->get_row( 'SELECT * FROM wp_vsen_clicks ORDER BY id ASC LIMIT 1' );
	check_same( '', $first->fraud_reasons, 'the original click stays clean' );
}

function test_fbclid_counts_only_with_paid_medium() {
	vsen_pv( 'https://example.com/?fbclid=IwAR0organic123' );
	check_same( 0, vsen_count( 'clicks' ) );
	vsen_pv( 'https://example.com/?fbclid=IwAR0paid12345&utm_source=facebook&utm_medium=paid_social', VSEN_VID2 );
	check_same( 1, vsen_count( 'clicks' ) );
	check_same( 'meta', vsen_db()->get_var( 'SELECT network FROM wp_vsen_clicks' ) );
}

function test_utm_paid_landing_without_click_id() {
	vsen_pv( 'https://example.com/offer/?utm_source=bing&utm_medium=cpc' );
	$click = vsen_db()->get_row( 'SELECT * FROM wp_vsen_clicks' );
	check_same( array( 'ad_landing', 'microsoft', 'utm' ), array( $click->click_type, $click->network, $click->label ) );
}

function test_scripted_onsite_ad_click_is_fraud() {
	list( , $pv ) = vsen_pv( 'https://example.com/blog/post/' );
	list( $status, $reply ) = vsen_collect( array( 'e' => 'click', 'k' => 'ad', 'pv' => $pv['pv'], 't' => $pv['t'], 'l' => 'sidebar', 'n' => 'adsense', 'ms' => 150, 'it' => 0, 'tr' => 0, 'xy' => 0 ) );
	check_same( 200, $status );
	$click = vsen_db()->get_row( 'SELECT * FROM wp_vsen_clicks' );
	check_same( array( 'ad_click', 'adsense', 'sidebar', 150 ), array( $click->click_type, $click->network, $click->label, (int) $click->time_to_click ) );
	check_same( 90, (int) $click->fraud_score );
	check_same( Fraud_Engine::STATUS_FRAUD, (int) $click->status );
	check_same( 1, $reply['f'], 'auto-blocked at 90, so ads hide from now on' );
	check_same( 90, (int) vsen_db()->get_var( 'SELECT fraud_score FROM wp_vsen_visitors' ) );
}

function test_human_onsite_ad_click_and_repeat() {
	list( , $pv ) = vsen_pv( 'https://example.com/blog/post/' );
	$click = array( 'e' => 'click', 'k' => 'ad', 'pv' => $pv['pv'], 't' => $pv['t'], 'l' => 'header', 'n' => 'site', 'ms' => 14000, 'it' => 30, 'tr' => 1, 'xy' => 1 );
	vsen_collect( $click );
	check_same( 0, (int) vsen_db()->get_var( 'SELECT fraud_score FROM wp_vsen_clicks' ) );
	vsen_collect( $click );
	check_same( 30, (int) vsen_db()->get_var( 'SELECT fraud_score FROM wp_vsen_clicks ORDER BY id DESC LIMIT 1' ), 'same ad again within 10 minutes' );
}

function test_activity_clicks_are_recorded_but_not_scored() {
	list( , $pv ) = vsen_pv( 'https://example.com/' );
	vsen_collect( array( 'e' => 'click', 'k' => 'out', 'pv' => $pv['pv'], 't' => $pv['t'], 'h' => 'https://partner.example.org/x', 'l' => 'Partner' ) );
	vsen_collect( array( 'e' => 'click', 'k' => 'dl', 'pv' => $pv['pv'], 't' => $pv['t'], 'h' => 'https://example.com/brochure.pdf' ) );
	vsen_collect( array( 'e' => 'click', 'k' => 'trk', 's' => $pv['s'], 'l' => 'signup' ) );
	check_same( 3, vsen_count( 'clicks' ) );
	check_same( 3, vsen_count( 'clicks', 'finalized = 1 AND fraud_score = 0' ) );
	check_same( 3, (int) vsen_db()->get_var( 'SELECT clicks FROM wp_vsen_visitors' ) );
	check_same( 1, vsen_count( 'clicks', "click_type = 'tracked' AND session_id > 0" ), 'a click before the pageview reply attaches by session key' );

	vsen_test_reset( array( 'track_outbound' => 0 ) );
	list( , $pv ) = vsen_pv( 'https://example.com/' );
	vsen_collect( array( 'e' => 'click', 'k' => 'out', 'pv' => $pv['pv'], 't' => $pv['t'], 'h' => 'https://partner.example.org/x' ) );
	check_same( 0, vsen_count( 'clicks' ) );
}

function test_session_key_from_another_ip_is_not_attached() {
	list( , $pv ) = vsen_pv( 'https://example.com/' );
	vsen_collect( array( 'e' => 'click', 'k' => 'trk', 's' => $pv['s'], 'l' => 'x' ), array( 'REMOTE_ADDR' => '192.0.2.99' ) );
	check_same( 0, (int) vsen_db()->get_var( 'SELECT session_id FROM wp_vsen_clicks' ) );
}

function test_allowlisted_ip_is_never_scored() {
	vsen_test_reset( array( 'allowlist' => '203.0.113.0/24' ) );
	list( , $pv ) = vsen_pv( 'https://example.com/' );
	vsen_collect( array( 'e' => 'click', 'k' => 'ad', 'pv' => $pv['pv'], 't' => $pv['t'], 'ms' => 10, 'it' => 0, 'tr' => 0 ) );
	$click = vsen_db()->get_row( 'SELECT * FROM wp_vsen_clicks' );
	check_same( array( 0, 'allowlisted' ), array( (int) $click->fraud_score, $click->fraud_reasons ) );
	check_same( 0, vsen_count( 'blocklist' ) );
}

function test_suspicious_network_and_webdriver() {
	vsen_test_reset( array( 'suspicious_networks' => '203.0.113.0/24' ) );
	list( , $pv ) = vsen_pv( 'https://example.com/?gclid=NETWORKCLICK1', VSEN_VID, '', array( 'wd' => 1 ) );
	$click = vsen_db()->get_row( 'SELECT * FROM wp_vsen_clicks' );
	check( false !== strpos( $click->fraud_reasons, 'suspicious_network' ) && false !== strpos( $click->fraud_reasons, 'headless' ) );
	check_same( 1, (int) vsen_db()->get_var( 'SELECT is_bot FROM wp_vsen_visitors' ), 'webdriver browsers count as bots' );
}

function test_ip_privacy_modes() {
	vsen_test_reset( array( 'ip_mode' => 'mask' ) );
	vsen_pv( 'https://example.com/?gclid=MASKEDCLICK1' );
	check_same( '203.0.113.0', vsen_db()->get_var( 'SELECT ip FROM wp_vsen_visitors' ) );
	check_same( '203.0.113.0', vsen_db()->get_var( 'SELECT ip FROM wp_vsen_clicks' ) );
	$click = vsen_db()->get_row( 'SELECT * FROM wp_vsen_clicks' );
	Protection::block_hash( $click->ip_hash, $click->ip, 'test', 'manual', 0, 7 );
	check_same( '203.0.113.0/24', vsen_db()->get_var( 'SELECT ip_range FROM wp_vsen_blocklist' ), 'masked IPs are shown as the range they stand for' );
	check( Protection::is_blocked( Request_Context::current() ), 'blocking still matches the exact address by hash' );

	vsen_test_reset( array( 'ip_mode' => 'none' ) );
	vsen_pv( 'https://example.com/' );
	$visitor = vsen_db()->get_row( 'SELECT * FROM wp_vsen_visitors' );
	check_same( '', $visitor->ip );
	check_same( 64, strlen( $visitor->ip_hash ) );
	check( false === strpos( implode( '|', (array) $visitor ), '203.0.113' ), 'the address is stored nowhere' );
}

function test_do_not_track_is_respected() {
	check_same( false, vsen_pv( 'https://example.com/', VSEN_VID, '', array(), array( 'HTTP_DNT' => '1' ) )[1]['ok'] );
	check_same( false, vsen_pv( 'https://example.com/', VSEN_VID, '', array(), array( 'HTTP_SEC_GPC' => '1' ) )[1]['ok'] );
	check_same( 0, vsen_count( 'visitors' ) );
	vsen_test_reset( array( 'respect_dnt' => 0 ) );
	check_same( true, vsen_pv( 'https://example.com/', VSEN_VID, '', array(), array( 'HTTP_DNT' => '1' ) )[1]['ok'] );
}

function test_consent_mode_skips_server_capture() {
	vsen_test_reset( array( 'require_consent' => 1 ) );
	vsen_visit( array( 'gclid' => 'CONSENTCLICK1' ) );
	check_same( 0, vsen_count( 'clicks' ) );
}

function test_excluded_roles_are_not_tracked() {
	WP_Stub::$user = (object) array( 'ID' => 1, 'roles' => array( 'administrator' ) );
	check_same( false, vsen_pv( 'https://example.com/' )[1]['ok'] );
	WP_Stub::$user = (object) array( 'ID' => 2, 'roles' => array( 'subscriber' ) );
	check_same( true, vsen_pv( 'https://example.com/' )[1]['ok'] );
	check_same( 2, (int) vsen_db()->get_var( 'SELECT user_id FROM wp_vsen_visitors' ) );
}

function test_rate_limit() {
	add_filter( 'vsen_rate_limit', function () { return 5; } );
	for ( $i = 0; $i < 5; $i++ ) {
		check_same( 200, vsen_pv( 'https://example.com/' )[0] );
	}
	check_same( 429, vsen_pv( 'https://example.com/' )[0] );
	check( Tracker::was_rate_limited( Request_Context::current()->ip_hash ) );
	check_same( 200, vsen_pv( 'https://example.com/', VSEN_VID, '', array(), array( 'REMOTE_ADDR' => '192.0.2.1' ) )[0], 'other IPs are unaffected' );
}

function test_trusted_proxy_and_cloudflare() {
	vsen_test_reset( array( 'trust_cloudflare' => 1 ) );
	vsen_pv( 'https://example.com/', VSEN_VID, '', array(), array( 'REMOTE_ADDR' => '172.70.1.1', 'HTTP_CF_CONNECTING_IP' => '192.0.2.200', 'HTTP_CF_IPCOUNTRY' => 'ID' ) );
	$v = vsen_db()->get_row( 'SELECT * FROM wp_vsen_visitors' );
	check_same( array( '192.0.2.200', 'ID' ), array( $v->ip, $v->country ) );

	vsen_test_reset( array( 'trust_cloudflare' => 1 ) );
	vsen_pv( 'https://example.com/', VSEN_VID, '', array(), array( 'REMOTE_ADDR' => '198.51.100.9', 'HTTP_CF_CONNECTING_IP' => '192.0.2.200', 'HTTP_CF_IPCOUNTRY' => 'ID' ) );
	$v = vsen_db()->get_row( 'SELECT * FROM wp_vsen_visitors' );
	check_same( array( '198.51.100.9', '' ), array( $v->ip, $v->country ), 'headers from outside Cloudflare are ignored' );
}

function test_manual_blocks_ranges_and_expiry() {
	check_same( true, Protection::block_manual( '192.0.2.0/24', 'abuse', 0 ) );
	check( is_string( Protection::block_manual( 'nonsense', '', 0 ) ) );
	$_SERVER = array( 'REMOTE_ADDR' => '192.0.2.77' );
	Request_Context::reset();
	check( Protection::is_blocked( Request_Context::current() ) );

	Protection::block_manual( '203.0.113.10', 'single', 1 );
	check_same( 2, vsen_count( 'blocklist' ) );
	vsen_db()->query( "UPDATE wp_vsen_blocklist SET expires_at = '2000-01-01 00:00:00' WHERE match_type = 'hash'" );
	Cron::run();
	check_same( 1, vsen_count( 'blocklist' ), 'expired blocks are removed by cron' );
	$_SERVER = array( 'REMOTE_ADDR' => '203.0.113.10' );
	Request_Context::reset();
	check( ! Protection::is_blocked( Request_Context::current() ) );

	$id = (int) vsen_db()->get_var( 'SELECT id FROM wp_vsen_blocklist' );
	Protection::unblock( $id );
	check_same( 0, vsen_count( 'blocklist' ) );
}

function test_unblocked_ip_is_not_reblocked_by_rescoring() {
	list( , $pv ) = vsen_pv( 'https://example.com/' );
	vsen_collect( array( 'e' => 'click', 'k' => 'ad', 'pv' => $pv['pv'], 't' => $pv['t'], 'ms' => 10, 'it' => 0, 'tr' => 0 ) );
	check_same( 1, vsen_count( 'blocklist' ) );
	$click = vsen_db()->get_row( 'SELECT * FROM wp_vsen_clicks' );
	Protection::unblock_hash( $click->ip_hash );
	( new VisitorSentinel\Fraud_Service() )->evaluate( (int) $click->id, true );
	check_same( 0, vsen_count( 'blocklist' ) );
}

function test_reviewed_clicks_keep_the_admin_verdict() {
	list( , $pv ) = vsen_pv( 'https://example.com/' );
	vsen_collect( array( 'e' => 'click', 'k' => 'ad', 'pv' => $pv['pv'], 't' => $pv['t'], 'ms' => 10, 'it' => 0, 'tr' => 0 ) );
	$id = (int) vsen_db()->get_var( 'SELECT id FROM wp_vsen_clicks' );
	Repository::instance()->update_click( $id, array( 'reviewed' => 1, 'status' => 0 ) );
	check_same( null, ( new VisitorSentinel\Fraud_Service() )->evaluate( $id, true ) );
	check_same( 0, (int) vsen_db()->get_var( 'SELECT status FROM wp_vsen_clicks' ) );
	Repository::instance()->refresh_visitor_score( (int) vsen_db()->get_var( 'SELECT visitor_id FROM wp_vsen_clicks' ) );
	check_same( 0, (int) vsen_db()->get_var( 'SELECT fraud_score FROM wp_vsen_visitors' ), 'a click marked valid no longer counts against the visitor' );
}

function test_alert_digest() {
	VisitorSentinel\Alerts::send_digest();
	check_same( 0, count( WP_Stub::$mail ), 'first run sets the cursor and reports no history' );
	list( , $pv ) = vsen_pv( 'https://example.com/' );
	vsen_collect( array( 'e' => 'click', 'k' => 'ad', 'pv' => $pv['pv'], 't' => $pv['t'], 'ms' => 10, 'it' => 0, 'tr' => 0 ) );
	update_option( 'admin_email', 'owner@example.com' );
	check( VisitorSentinel\Alerts::send_digest() );
	check_same( 'owner@example.com', WP_Stub::$mail[0]['to'] );
	check( false !== strpos( WP_Stub::$mail[0]['body'], 'Click was generated by script' ) );
	check( ! VisitorSentinel\Alerts::send_digest(), 'nothing new, no second email' );
}

function test_retention_purges_old_data() {
	vsen_pv( 'https://example.com/?gclid=OLDCLICK1234' );
	foreach ( array( 'visitors' => 'last_seen', 'sessions' => 'last_activity', 'pageviews' => 'created_at', 'clicks' => 'created_at' ) as $table => $col ) {
		vsen_db()->query( "UPDATE wp_vsen_{$table} SET {$col} = '2000-01-01 00:00:00'" );
	}
	vsen_pv( 'https://example.com/', VSEN_VID2, '', array(), array( 'REMOTE_ADDR' => '192.0.2.5' ) );
	Cron::apply_retention();
	check_same( array( 1, 1, 1, 0 ), array( vsen_count( 'visitors' ), vsen_count( 'sessions' ), vsen_count( 'pageviews' ), vsen_count( 'clicks' ) ) );
}

function test_reports_and_lists() {
	list( , $a ) = vsen_pv( 'https://example.com/?gclid=REPORTCLICK1&utm_source=google&utm_medium=cpc&utm_campaign=brand' );
	vsen_pv( 'https://example.com/pricing/', VSEN_VID, $a['s'] );
	vsen_collect( array( 'e' => 'click', 'k' => 'ad', 'pv' => $a['pv'], 't' => $a['t'], 'ms' => 10, 'it' => 0, 'tr' => 0 ) );
	vsen_pv( 'https://example.com/', VSEN_VID2, '', array(), array( 'REMOTE_ADDR' => '192.0.2.5', 'HTTP_USER_AGENT' => 'curl/8.0' ) );

	$repo    = Repository::instance();
	$from    = Repository::now( -DAY_IN_SECONDS );
	$to      = Repository::now( 60 );
	$summary = $repo->summary( $from, $to );
	check_same( 1, $summary['visitors'], 'bots are left out of traffic numbers' );
	check_same( 2, $summary['pageviews'] );
	check_same( 1, $summary['paid_clicks'] );
	check_same( 1, $summary['onsite_ads'] );
	check_same( 1, $summary['fraud'] );
	check_same( 50.0, $summary['fraud_rate'] );
	check_same( 0.0, $summary['bounce_rate'] );
	check_same( 1, $summary['blocked'] );

	$pages = $repo->breakdown( 'pages', $from, $to );
	check_same( 2, count( $pages ) );
	check_same( 'google', $repo->breakdown( 'campaigns', $from, $to )[0]->label );
	check_same( 'brand', $repo->breakdown( 'campaigns', $from, $to )[0]->title );
	check_same( 'desktop', $repo->breakdown( 'devices', $from, $to )[0]->label );
	check_same( 2, count( $repo->breakdown( 'networks', $from, $to ) ) );
	check_same( array(), $repo->breakdown( 'nonsense', $from, $to ) );

	$series = $repo->hourly_series( $from );
	check_same( 2, array_sum( $series['pageviews'] ) );
	check_same( 2, array_sum( $series['ads'] ) );
	check_same( 1, array_sum( $series['fraud'] ) );

	check_same( 1, $repo->live_count() );
	check_same( 1, count( $repo->live_sessions() ) );

	$visitors = $repo->list_visitors( array( 'filter' => 'all', 'search' => '', 'orderby' => 'last_seen', 'order' => 'desc', 'limit' => 10, 'offset' => 0 ) );
	check_same( 2, $visitors['total'] );
	$search = $repo->list_visitors( array( 'filter' => 'all', 'search' => '192.0.2.5', 'orderby' => 'nonsense; DROP TABLE x', 'order' => 'x', 'limit' => 10, 'offset' => 0 ) );
	check_same( 1, $search['total'], 'search by IP; unknown sort column falls back safely' );
	check_same( array( 'all' => 2, 'humans' => 1, 'bots' => 1, 'suspicious' => 1 ), $repo->visitor_view_counts() );

	$clicks = $repo->list_clicks( array( 'filter' => 'fraud', 'limit' => 10, 'offset' => 0 ) );
	check_same( 1, $clicks['total'] );
	check_same( 'Chrome', $clicks['rows'][0]->browser, 'visitor columns are joined in' );
	$counts = $repo->click_view_counts();
	check_same( array( 2, 1, 1, 1 ), array( $counts['all'], $counts['fraud'], $counts['landing'], $counts['onsite'] ) );

	check_same( 2, count( $repo->export_rows( 'visitors' ) ) );
	check_same( 2, count( $repo->export_rows( 'clicks' ) ) );
	check( isset( $repo->export_rows( 'clicks' )[0]['fraud_reasons'] ) );

	$repo->truncate_tracking();
	check_same( 0, vsen_count( 'visitors' ) + vsen_count( 'clicks' ) );
	check_same( 1, vsen_count( 'blocklist' ), 'deleting tracking data keeps the blocklist' );
}

function test_installer_schema_matches_repository_columns() {
	// Every column the code writes must exist; SQLite raises on unknown columns, so the tests
	// above already prove it for the paths they cover. Check the index lines parse, too.
	$schema = VisitorSentinel\Installer::schema( Repository::instance(), 'DEFAULT CHARSET=utf8mb4' );
	check_same( 5, count( $schema ) );
	foreach ( $schema as $sql ) {
		check( false !== strpos( $sql, 'PRIMARY KEY  (id)' ), 'dbDelta needs two spaces after PRIMARY KEY' );
	}
}

function test_session_duration_uses_measured_page_time() {
	list( , $pv ) = vsen_pv( 'https://example.com/' );
	vsen_collect( array( 'e' => 'eng', 'pv' => $pv['pv'], 't' => $pv['t'], 'tt' => 95000 ) );
	check_same( 95, (int) vsen_db()->get_var( 'SELECT duration FROM wp_vsen_sessions' ) );
}

function test_auto_block_when_a_later_score_crosses_the_threshold() {
	// A client without JavaScript first scores 75 (bot, missing headers): fraudulent but below
	// the auto-block threshold of 80. At the final check "no JavaScript" lifts it to 100.
	vsen_visit( array( 'gclid' => 'CROSSINGCLICK1' ), array( 'HTTP_USER_AGENT' => 'curl/8.4.0', 'HTTP_ACCEPT_LANGUAGE' => '' ) );
	check_same( 75, (int) vsen_db()->get_var( 'SELECT fraud_score FROM wp_vsen_clicks' ) );
	check_same( 0, vsen_count( 'blocklist' ) );
	vsen_db()->query( "UPDATE wp_vsen_clicks SET created_at = '" . Repository::now( -1200 ) . "'" );
	Cron::finalize_clicks();
	check_same( 100, (int) vsen_db()->get_var( 'SELECT fraud_score FROM wp_vsen_clicks' ) );
	check_same( 1, vsen_count( 'blocklist' ), 'blocked once the score crosses the threshold' );
}

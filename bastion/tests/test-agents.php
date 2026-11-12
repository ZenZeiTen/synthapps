<?php
/**
 * Agent identity, the long score window, the traps and the fixes bundled with 1.1.0.
 *
 * Addresses come from the documentation ranges: zbst_seed_agent_lists() stores 192.0.2.0/24 as
 * Google, 198.51.100.0/24 as OpenAI and 2001:db8::/32 as Anthropic. Nothing touches the network.
 *
 * @package ZenZeiTenBastion
 */

// phpcs:disable

use ZenZeiTenBastion\Admin\Admin;
use ZenZeiTenBastion\Agents;
use ZenZeiTenBastion\Blocklist;
use ZenZeiTenBastion\CLI;
use ZenZeiTenBastion\Cron;
use ZenZeiTenBastion\Firewall;
use ZenZeiTenBastion\Guard;
use ZenZeiTenBastion\Hardening;
use ZenZeiTenBastion\Log;
use ZenZeiTenBastion\Settings;

const ZBST_UA_GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const ZBST_UA_GPTBOT    = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.3; +https://openai.com/gptbot';
const ZBST_UA_CHATGPT   = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot';
const ZBST_UA_CLAUDEBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)';

/**
 * A request from an agent: address, user-agent, and optionally a path and more server values.
 */
function zbst_agent_request( $ip, $ua, $uri = '/page/', array $server = array(), array $post = array() ) {
	zbst_request( $ip, array(), array_merge( array( 'HTTP_USER_AGENT' => $ua, 'REQUEST_URI' => $uri ), $server ), $post );
}

/**
 * Total score an address has in the log.
 */
function zbst_points( $ip ) {
	return Log::score( $ip, 100000 );
}

// ---------------------------------------------------------------------------------------------
// Verdicts.
// ---------------------------------------------------------------------------------------------

function test_agent_verified_googlebot_not_scored() {
	zbst_seed_agent_lists();
	zbst_agent_request( '192.0.2.7', ZBST_UA_GOOGLEBOT );
	check_same( 0, zbst_run_guard() );
	check_same( 0, count( zbst_events() ), 'a verified request writes nothing' );
	check_same( 'verified', Agents::verdict() );
}

function test_agent_spoof_logged_in_log_mode() {
	zbst_seed_agent_lists( 1 );
	zbst_agent_request( '203.0.113.9', ZBST_UA_GPTBOT );
	check_same( 0, zbst_run_guard(), 'the module ships in Log-only mode' );
	$events = zbst_events( 'agent_spoof' );
	check_same( 1, count( $events ) );
	check_same( '5', (string) $events[0]['score'] );
	check_same( (string) Log::SEVERITY_HIGH, (string) $events[0]['severity'] );
	check_same( 'openai-gptbot', $events[0]['rule'] );
	check_same( 'logged', $events[0]['action'] );
	check_same( 'verdict=spoofed claimed=GPTBot list_age=1d', $events[0]['details'] );
}

function test_agent_spoof_denied_in_protect_mode() {
	zbst_seed_agent_lists();
	zbst_set( array( 'agent_mode' => 'protect' ) );
	zbst_agent_request( '203.0.113.9', ZBST_UA_GPTBOT );
	check_same( 403, zbst_run_guard() );
	check_same( 'blocked', zbst_events( 'agent_spoof' )[0]['action'] );
}

function test_agent_spoof_row_throttled() {
	zbst_seed_agent_lists();
	zbst_set( array( 'agent_mode' => 'protect' ) );
	$codes = array();
	for ( $i = 0; $i < 5; $i++ ) {
		zbst_agent_request( '203.0.113.9', ZBST_UA_GPTBOT, '/page-' . $i . '/' );
		$codes[] = zbst_run_guard();
	}
	check_same( array( 403, 403, 403, 403, 403 ), $codes, 'every request is refused' );
	check_same( 1, count( zbst_events( 'agent_spoof' ) ), 'one row per address per 10 minutes' );
	check_same( 5, zbst_points( '203.0.113.9' ) );
}

function test_agent_stale_list_gives_unknown() {
	zbst_seed_agent_lists( 4 );
	zbst_set( array( 'agent_mode' => 'protect' ) );
	zbst_agent_request( '203.0.113.9', ZBST_UA_GPTBOT );
	check_same( 0, zbst_run_guard(), 'a stale list fails open' );
	check_same( 'unknown', Agents::verdict() );
	check_same( 0, count( zbst_events() ) );
	// The same goes for a real crawler: stale means unknown, not verified.
	zbst_agent_request( '198.51.100.9', ZBST_UA_GPTBOT );
	check_same( 'unknown', Agents::verdict() );
}

function test_agent_ipv6_verified() {
	zbst_seed_agent_lists();
	zbst_agent_request( '2001:db8::5', ZBST_UA_CLAUDEBOT );
	check_same( 0, zbst_run_guard() );
	check_same( 'verified', Agents::verdict() );
	check_same( 0, count( zbst_events() ) );
	// An IPv4 address is never matched against an IPv6 prefix.
	zbst_agent_request( '203.0.113.9', ZBST_UA_CLAUDEBOT );
	check_same( 'spoofed', Agents::verdict() );
}

function test_agent_verdicts_for_other_claims() {
	zbst_seed_agent_lists();
	$none = Agents::identify( '203.0.113.9', 'Mozilla/5.0 (X11; Linux x86_64) Chrome/126.0 Safari/537.36' );
	check_same( 'none', $none['verdict'] );
	check_same( 'none', Agents::identify( '203.0.113.9', '' )['verdict'] );
	// No list stored for Bing in these tests, and no list published for Claude-Agent.
	check_same( 'unknown', Agents::identify( '203.0.113.9', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)' )['verdict'] );
	$agent = Agents::identify( '203.0.113.9', 'Mozilla/5.0 (compatible; Claude-Agent/1.0)' );
	check_same( 'unknown', $agent['verdict'] );
	check_same( 'anthropic-agent', $agent['id'] );
	// Tokens match without regard to case, and the more specific agent wins.
	check_same( 'google-googlebot', Agents::identify( '192.0.2.1', 'googlebot-image/1.0' )['id'] );
	check_same( 'google-special', Agents::identify( '192.0.2.1', 'AdsBot-Google (+http://www.google.com/adsbot.html)' )['id'] );
	check_same( 'openai-chatgpt-user', Agents::identify( '198.51.100.1', ZBST_UA_CHATGPT )['id'] );
	check( Agents::identify( '198.51.100.1', ZBST_UA_CHATGPT )['fetcher'] );
	// Google-Extended is a robots.txt token, not a user-agent.
	check_same( 'none', Agents::identify( '192.0.2.1', 'Google-Extended' )['verdict'] );
}

function test_agent_module_off_does_nothing() {
	zbst_seed_agent_lists();
	zbst_set( array( 'agent_mode' => 'off', 'agent_traps' => 1 ) );
	zbst_agent_request( '203.0.113.9', ZBST_UA_GPTBOT );
	check_same( 0, zbst_run_guard() );
	check_same( 'none', Agents::verdict() );
	check_same( 0, count( zbst_events() ) );
	check( false === get_option( Agents::TRAPS_OPTION ), 'no trap is created while the module is off' );
}

function test_agent_staff_and_admin_addresses_are_skipped() {
	zbst_seed_agent_lists();
	zbst_set( array( 'agent_mode' => 'protect' ) );
	WP_Stub::$user = (object) array( 'ID' => 2, 'roles' => array( 'editor' ) );
	zbst_agent_request( '203.0.113.9', ZBST_UA_GPTBOT );
	check_same( 0, zbst_run_guard(), 'a logged-in editor testing a user-agent is not refused' );
	WP_Stub::$user = null;
	Blocklist::remember_admin_ip( '203.0.113.9' );
	check_same( 0, zbst_run_guard(), 'an address an administrator signed in from is not refused' );
	check_same( 0, count( zbst_events() ) );
}

function test_agent_check_runs_before_translations() {
	zbst_seed_agent_lists();
	zbst_set( array( 'agent_mode' => 'protect', 'agent_traps' => 1 ) );
	$trap = Agents::traps();
	WP_Stub::$early = true;
	WP_Stub::$current_user_lookups = 0;
	zbst_agent_request( '203.0.113.9', ZBST_UA_GPTBOT );
	check_same( 403, zbst_run_guard() );
	zbst_agent_request( '192.0.2.7', ZBST_UA_GOOGLEBOT, '/wp-admin/' );
	check_same( 403, zbst_run_guard() );
	zbst_agent_request( '203.0.113.30', 'curl/8.5.0', $trap['path'] . '/' );
	check_same( 403, zbst_run_guard() );
	zbst_agent_request( '192.0.2.8', ZBST_UA_GOOGLEBOT );
	check_same( 0, zbst_run_guard() );
	check_same( 0, WP_Stub::$current_user_lookups, 'the agent check never settles the current user' );
	check_same( 3, count( zbst_events() ) );
}

// ---------------------------------------------------------------------------------------------
// Behaviour of verified agents.
// ---------------------------------------------------------------------------------------------

function test_agent_abuse_login_and_admin() {
	zbst_seed_agent_lists();
	zbst_agent_request( '192.0.2.7', ZBST_UA_GOOGLEBOT, '/wp-login.php', array(), array( 'log' => 'admin', 'pwd' => 'x' ) );
	check_same( 0, zbst_run_guard(), 'Log-only mode records without refusing' );
	$events = zbst_events( 'agent_abuse' );
	check_same( 1, count( $events ) );
	check_same( '3', (string) $events[0]['score'] );
	check_same( 'google-googlebot', $events[0]['rule'] );
	check_same( 'verdict=verified claimed=Googlebot list_age=0d reason=login', $events[0]['details'] );

	zbst_set( array( 'agent_mode' => 'protect' ) );
	zbst_agent_request( '192.0.2.8', ZBST_UA_GOOGLEBOT, '/wp-admin/options.php' );
	check_same( 403, zbst_run_guard() );
	zbst_agent_request( '192.0.2.8', ZBST_UA_GOOGLEBOT, '/xmlrpc.php', array(), array( 'x' => '1' ) );
	check_same( 403, zbst_run_guard() );
	// Reading the login page, and the calls a rendered page makes, are normal.
	zbst_agent_request( '192.0.2.9', ZBST_UA_GOOGLEBOT, '/wp-login.php' );
	check_same( 0, zbst_run_guard() );
	zbst_agent_request( '192.0.2.9', ZBST_UA_GOOGLEBOT, '/wp-admin/admin-ajax.php', array(), array( 'action' => 'load_more' ) );
	check_same( 0, zbst_run_guard() );
	check_same( 0, zbst_points( '192.0.2.9' ) );
}

function test_agent_crawl_ceiling() {
	zbst_seed_agent_lists();
	zbst_set( array( 'agent_mode' => 'protect', 'agent_crawl_ceiling' => 3 ) );
	$codes = array();
	for ( $i = 0; $i < 6; $i++ ) {
		zbst_agent_request( '192.0.2.7', ZBST_UA_GOOGLEBOT, '/post-' . $i . '/' );
		$codes[] = zbst_run_guard();
	}
	check_same( array( 0, 0, 0, 429, 429, 429 ), $codes );
	check_same( 1, count( zbst_events( 'agent_abuse' ) ), 'one event per flood, not per request' );
	check_same( 3, zbst_points( '192.0.2.7' ) );
	check( false !== strpos( zbst_events( 'agent_abuse' )[0]['details'], 'reason=ceiling limit=3' ) );
	// Another address of the same crawler has its own count; 0 switches the ceiling off.
	zbst_agent_request( '192.0.2.8', ZBST_UA_GOOGLEBOT );
	check_same( 0, zbst_run_guard() );
	zbst_set( array( 'agent_crawl_ceiling' => 0 ) );
	zbst_agent_request( '192.0.2.7', ZBST_UA_GOOGLEBOT );
	check_same( 0, zbst_run_guard() );
}

function test_verified_agent_always_gets_robots_txt() {
	zbst_seed_agent_lists();
	zbst_set( array( 'agent_mode' => 'protect', 'agent_crawl_ceiling' => 1 ) );
	zbst_agent_request( '2001:db8::5', ZBST_UA_CLAUDEBOT );
	check_same( 0, zbst_run_guard() );
	zbst_agent_request( '2001:db8::5', ZBST_UA_CLAUDEBOT, '/robots.txt' );
	check_same( 0, zbst_run_guard(), 'over the ceiling, robots.txt is still served' );
	zbst_agent_request( '2001:db8::5', ZBST_UA_CLAUDEBOT, '/post/' );
	check_same( 429, zbst_run_guard() );

	// Even from a blocked address.
	Blocklist::add( '2001:db8::5', 'manual', 'test', 0 );
	zbst_agent_request( '2001:db8::5', ZBST_UA_CLAUDEBOT, '/post/' );
	check_same( 403, zbst_run_guard() );
	zbst_agent_request( '2001:db8::5', ZBST_UA_CLAUDEBOT, '/robots.txt' );
	check_same( 0, zbst_run_guard() );
	// A blocked address that only claims to be a crawler stays blocked.
	Blocklist::add( '203.0.113.50', 'manual', 'test', 0 );
	zbst_agent_request( '203.0.113.50', ZBST_UA_CLAUDEBOT, '/robots.txt' );
	check_same( 403, zbst_run_guard() );
	zbst_agent_request( '203.0.113.50', 'Mozilla/5.0', '/robots.txt' );
	check_same( 403, zbst_run_guard() );
}

function test_verified_agent_no_404_flood() {
	zbst_seed_agent_lists();
	WP_Stub::$is_404 = true;
	zbst_agent_request( '192.0.2.7', ZBST_UA_GOOGLEBOT, '/old-post/' );
	for ( $i = 0; $i < 41; $i++ ) {
		Hardening::template_redirect();
	}
	check_same( 0, count( zbst_events( 'not_found' ) ), 'a verified crawler following old links is not a scan' );
	// The same flood from an address that only claims to be Googlebot still counts.
	zbst_agent_request( '203.0.113.9', ZBST_UA_GOOGLEBOT, '/old-post/' );
	for ( $i = 0; $i < 41; $i++ ) {
		Hardening::template_redirect();
	}
	check_same( 1, count( zbst_events( 'not_found' ) ) );
}

function test_verified_agent_is_spared_the_rate_limit() {
	zbst_seed_agent_lists();
	zbst_set( array( 'rate_limit' => 2 ) );
	$codes = array();
	for ( $i = 0; $i < 4; $i++ ) {
		zbst_agent_request( '192.0.2.7', ZBST_UA_GOOGLEBOT );
		$codes[] = zbst_run_guard();
	}
	check_same( array( 0, 0, 0, 0 ), $codes );
	check_same( 0, count( zbst_events( 'rate_limit' ) ) );
}

function test_agent_and_firewall_never_score_one_request_twice() {
	zbst_seed_agent_lists();
	// Firewall in Protect mode, agents in Log-only mode: the firewall logs and refuses.
	zbst_agent_request( '203.0.113.9', ZBST_UA_GPTBOT, '/.env' );
	check_same( 403, zbst_run_guard() );
	check_same( 1, count( zbst_events() ) );
	check_same( 'firewall', zbst_events()[0]['type'] );
	check_same( 5, zbst_points( '203.0.113.9' ) );

	// Firewall in Log-only mode, agents in Protect mode: the firewall logs, the agent check refuses.
	zbst_set( array( 'firewall_mode' => 'log', 'agent_mode' => 'protect' ) );
	zbst_agent_request( '203.0.113.10', ZBST_UA_GPTBOT, '/.env' );
	check_same( 403, zbst_run_guard() );
	check_same( 1, count( Log::query( array( 'ip' => '203.0.113.10' ), 10, 0 ) ) );
	check_same( 5, zbst_points( '203.0.113.10' ) );

	// Both in Log-only mode: one firewall event, the request passes.
	zbst_set( array( 'agent_mode' => 'log' ) );
	zbst_agent_request( '203.0.113.11', ZBST_UA_GPTBOT, '/.env' );
	check_same( 0, zbst_run_guard() );
	$events = Log::query( array( 'ip' => '203.0.113.11' ), 10, 0 );
	check_same( 1, count( $events ) );
	check_same( 'firewall', $events[0]['type'] );
}

// ---------------------------------------------------------------------------------------------
// Traps.
// ---------------------------------------------------------------------------------------------

function test_agent_trap_url_scores_critical() {
	zbst_set( array( 'agent_traps' => 1 ) );
	$trap = Agents::traps();
	check( 1 === preg_match( '#^/zbst-[0-9a-f]{12}$#', $trap['path'] ) );
	zbst_agent_request( '203.0.113.30', 'python-requests/2.32.0', $trap['path'] . '/' );
	check_same( 404, zbst_run_guard(), 'Log-only mode answers the trap with a plain 404' );
	$events = zbst_events( 'agent_trap' );
	check_same( 1, count( $events ) );
	check_same( '10', (string) $events[0]['score'] );
	check_same( 'trap-url', $events[0]['rule'] );
	check_same( 'verdict=none trap=url', $events[0]['details'] );

	// A second visit reaches the threshold of 20: the address is blocked.
	zbst_agent_request( '203.0.113.30', 'python-requests/2.32.0', $trap['path'] );
	check_same( 404, zbst_run_guard() );
	check_same( '203.0.113.30', Blocklist::match( '203.0.113.30' ) );

	zbst_set( array( 'agent_mode' => 'protect' ) );
	zbst_agent_request( '203.0.113.31', 'python-requests/2.32.0', $trap['path'] . '/?page=2' );
	check_same( 403, zbst_run_guard() );
	// Other paths that merely look alike are not the trap.
	zbst_agent_request( '203.0.113.32', 'python-requests/2.32.0', $trap['path'] . 'x/' );
	check_same( 0, zbst_run_guard() );
	zbst_agent_request( '203.0.113.32', 'python-requests/2.32.0', '/zbst-000000000000/' );
	check_same( 0, zbst_run_guard() );
}

function test_agent_trap_user_fetcher_info_only() {
	zbst_seed_agent_lists();
	zbst_set( array( 'agent_mode' => 'protect', 'agent_traps' => 1 ) );
	$trap = Agents::traps();
	zbst_agent_request( '198.51.100.40', ZBST_UA_CHATGPT, $trap['path'] . '/' );
	check_same( 404, zbst_run_guard(), 'a fetcher acting for a person is not refused' );
	$events = zbst_events( 'agent_trap' );
	check_same( 1, count( $events ) );
	check_same( '0', (string) $events[0]['score'] );
	check_same( (string) Log::SEVERITY_LOW, (string) $events[0]['severity'] );
	check_same( 'openai-chatgpt-user', $events[0]['rule'] );
	// A crawler that should follow robots.txt gets no such allowance, verified or not.
	zbst_agent_request( '198.51.100.41', ZBST_UA_GPTBOT, $trap['path'] . '/' );
	check_same( 403, zbst_run_guard() );
	check_same( 10, zbst_points( '198.51.100.41' ) );
	// Nor does an address that only claims to be a fetcher.
	zbst_agent_request( '203.0.113.42', ZBST_UA_CHATGPT, $trap['path'] . '/' );
	check_same( 403, zbst_run_guard() );
	check_same( 10, zbst_points( '203.0.113.42' ) );
}

function test_agent_prefetch_not_scored() {
	zbst_set( array( 'agent_mode' => 'protect', 'agent_traps' => 1 ) );
	$trap = Agents::traps();
	foreach ( array( 'HTTP_SEC_PURPOSE' => 'prefetch;prerender', 'HTTP_PURPOSE' => 'prefetch' ) as $header => $value ) {
		zbst_agent_request( '203.0.113.30', 'Mozilla/5.0 Chrome/126.0', $trap['path'] . '/', array( $header => $value ) );
		check_same( 404, zbst_run_guard() );
	}
	check_same( 0, count( zbst_events() ) );
}

function test_agent_fake_key_in_authorization() {
	zbst_set( array( 'agent_traps' => 1 ) );
	$key = Agents::traps()['key'];
	check( 1 === preg_match( '/^zbst_live_[0-9a-f]{24}$/', $key ) );
	zbst_agent_request( '203.0.113.30', 'curl/8.5.0', '/wp-json/wp/v2/posts', array( 'HTTP_AUTHORIZATION' => 'Bearer ' . $key ) );
	check_same( 0, zbst_run_guard(), 'Log-only mode lets the request carry on' );
	$events = zbst_events( 'agent_trap' );
	check_same( 1, count( $events ) );
	check_same( '10', (string) $events[0]['score'] );
	check_same( 'trap-key', $events[0]['rule'] );

	// The same key in the query, a form, a cookie or a JSON-style address is caught too.
	zbst_set( array( 'agent_mode' => 'protect' ) );
	zbst_request( '203.0.113.31', array( 'api_key' => $key ) );
	check_same( 403, zbst_run_guard() );
	zbst_request( '203.0.113.32', array(), array(), array( 'token' => array( 'value' => $key ) ) );
	check_same( 403, zbst_run_guard() );
	zbst_request( '203.0.113.33' );
	$_COOKIE = array( 'session' => $key );
	check_same( 403, zbst_run_guard() );
	$_COOKIE = array();
	zbst_request( '203.0.113.34', array(), array( 'REQUEST_URI' => '/api/' . rawurlencode( $key ) . '/items' ) );
	check_same( 403, zbst_run_guard() );
	// A different key of the same shape is nobody's business.
	zbst_request( '203.0.113.35', array( 'api_key' => 'zbst_live_' . str_repeat( '0', 24 ) ) );
	check_same( 0, zbst_run_guard() );
}

function test_traps_are_off_by_default_and_skip_staff() {
	$path = '/zbst-0123456789ab';
	update_option( Agents::TRAPS_OPTION, array( 'path' => $path, 'key' => 'zbst_live_' . str_repeat( 'a', 24 ), 'created' => time() ) );
	zbst_agent_request( '203.0.113.30', 'curl/8.5.0', $path . '/' );
	check_same( 0, zbst_run_guard(), 'with the traps off the path is an ordinary missing page' );
	check_same( '', Agents::robots_txt( '' ) );

	zbst_set( array( 'agent_mode' => 'protect', 'agent_traps' => 1 ) );
	WP_Stub::$user = (object) array( 'ID' => 1, 'roles' => array( 'administrator' ) );
	check_same( 0, zbst_run_guard(), 'a logged-in user who opens the trap is not scored' );
	check_same( 0, count( zbst_events() ) );
}

function test_trap_markup_and_robots_txt() {
	zbst_set( array( 'agent_traps' => 1 ) );
	$trap   = Agents::traps();
	$robots = Agents::robots_txt( "User-agent: *\nDisallow: /wp-admin/\n\nSitemap: https://example.com/wp-sitemap.xml\n" );
	check( false !== strpos( $robots, "\n\nUser-agent: *\nDisallow: " . $trap['path'] . "/\n" ), $robots );
	check( 0 === strpos( $robots, "User-agent: *\nDisallow: /wp-admin/" ), 'the rules before it are kept' );

	ob_start();
	Agents::footer_link();
	Agents::head_comment();
	$html = ob_get_clean();
	check( false !== strpos( $html, 'href="https://example.com' . $trap['path'] . '/"' ), $html );
	foreach ( array( 'rel="nofollow"', 'aria-hidden="true"', 'tabindex="-1"', 'class="no-prefetch"', 'display:none' ) as $attribute ) {
		check( false !== strpos( $html, $attribute ), 'the hidden link lacks ' . $attribute );
	}
	check( false !== strpos( $html, '<!-- ' ) && false !== strpos( $html, $trap['key'] . ' -->' ), 'the fake key sits in an HTML comment' );
	check_same( array( '/cart/*', $trap['path'] . '/*' ), Agents::exclude_paths( array( '/cart/*' ) ) );

	// A site in a folder: the robots.txt rule names the full path.
	WP_Stub::$home = 'https://example.com/blog';
	check( false !== strpos( Agents::robots_txt( '' ), 'Disallow: /blog' . $trap['path'] . '/' ) );
	WP_Stub::$home = 'https://example.com';

	$new = Agents::regenerate_traps();
	check( $new['path'] !== $trap['path'] && $new['key'] !== $trap['key'], 'Regenerate replaces both values' );
	check_same( $new, Agents::traps() );
}

function test_saving_settings_creates_the_traps() {
	ZenZeiTenBastion\Plugin::instance()->boot();
	check( false === get_option( Agents::TRAPS_OPTION ) );
	update_option( Settings::OPTION, Settings::sanitize( array( 'agent_traps' => '1' ) ) );
	do_action( 'update_option_' . Settings::OPTION );
	check( is_array( get_option( Agents::TRAPS_OPTION ) ), 'the trap is created in the administrator\'s request' );
}

// ---------------------------------------------------------------------------------------------
// The long score window.
// ---------------------------------------------------------------------------------------------

function test_long_window_blocks_slow_git_scanner() {
	global $wpdb;
	$ip = '203.0.113.60';
	// Three probes, 9, 6 and 3 hours ago: never more than 5 points inside any 60 minutes.
	foreach ( array( 9, 6, 3 ) as $hours ) {
		zbst_request( $ip, array(), array( 'REQUEST_URI' => '/.git/config' ) );
		check_same( 403, zbst_run_guard() );
		$wpdb->query( "UPDATE wp_zbst_events SET created_at = '" . gmdate( 'Y-m-d H:i:s', time() - $hours * 3600 ) . "' WHERE id = (SELECT MAX(id) FROM wp_zbst_events)" );
		check( null === Blocklist::match( $ip ), 'not blocked after the probe ' . $hours . ' hours ago' );
	}
	check_same( 5, Log::score( $ip, 60 ) + 5, 'the short window holds nothing yet' );
	zbst_request( $ip, array(), array( 'REQUEST_URI' => '/.git/config' ) );
	check_same( 403, zbst_run_guard() );
	check_same( $ip, Blocklist::match( $ip ), 'blocked on the fourth probe' );
	check_same( 'Threat score 20 in 1440 minutes (high and critical only)', Blocklist::active()[0]['reason'] );
	$minutes = ( strtotime( Blocklist::active()[0]['expires_at'] . ' UTC' ) - time() ) / 60;
	check( $minutes > 58 && $minutes <= 60, 'escalation applies: the first block lasts an hour' );
}

function test_long_window_can_be_switched_off() {
	global $wpdb;
	zbst_set( array( 'score_window_long' => 0 ) );
	$ip = '203.0.113.61';
	for ( $i = 0; $i < 4; $i++ ) {
		zbst_request( $ip, array(), array( 'REQUEST_URI' => '/.git/config' ) );
		zbst_run_guard();
		$wpdb->query( "UPDATE wp_zbst_events SET created_at = '" . gmdate( 'Y-m-d H:i:s', time() - ( $i + 2 ) * 3600 ) . "' WHERE id = (SELECT MAX(id) FROM wp_zbst_events)" );
	}
	zbst_request( $ip, array(), array( 'REQUEST_URI' => '/.git/config' ) );
	zbst_run_guard();
	check( null === Blocklist::match( $ip ) );
}

function test_long_window_ignores_failed_logins() {
	global $wpdb;
	$ip = '203.0.113.62';
	// Ten failed logins, two hours apart: 10 x 2 = 20 points, all of medium severity.
	for ( $i = 9; $i >= 0; $i-- ) {
		zbst_request( $ip, array(), array( 'REQUEST_URI' => '/wp-login.php' ) );
		Hardening::login_failed( 'owner' );
		$wpdb->query( "UPDATE wp_zbst_events SET created_at = '" . gmdate( 'Y-m-d H:i:s', time() - $i * 2 * 3600 ) . "' WHERE id = (SELECT MAX(id) FROM wp_zbst_events)" );
	}
	check_same( 20, Log::score( $ip, 1440 ) );
	check_same( 0, Log::score_min( $ip, 1440, Log::SEVERITY_HIGH ) );
	// A medium event goes through Guard::report(), which checks both windows.
	zbst_request( $ip, array( 'author' => '1' ) );
	try {
		Hardening::template_redirect();
	} catch ( Zbst_Stop $e ) {
	}
	check_same( 23, Log::score( $ip, 1440 ) );
	check( null === Blocklist::match( $ip ), 'a day of mistyped passwords is not a block' );
}

function test_events_without_points_do_not_block() {
	zbst_set( array( 'score_threshold' => 5 ) );
	check( null === Guard::report( array( 'type' => 'blocked', 'severity' => Log::SEVERITY_LOW, 'ip' => '203.0.113.63' ) ) );
	check( null === Guard::report( array( 'type' => 'agent_trap', 'severity' => Log::SEVERITY_CRITICAL, 'score' => 0, 'ip' => '203.0.113.63' ) ) );
	check_same( 2, count( zbst_events() ), 'both are still logged' );
	check( is_array( Guard::report( array( 'type' => 'firewall', 'severity' => Log::SEVERITY_HIGH, 'ip' => '203.0.113.63' ) ) ) );
}

// ---------------------------------------------------------------------------------------------
// Fixes bundled with 1.1.0.
// ---------------------------------------------------------------------------------------------

function test_sensitive_file_bare_git() {
	foreach ( array( '/.git', '/.git/', '/.git/config', '/blog/.svn', '/.hg/store', '/.GIT/HEAD' ) as $path ) {
		$m = Firewall::inspect( array( 'path' => $path ) );
		check( $m && 'sensitive-file' === $m['rule'], "missed probe {$path}" );
	}
	foreach ( array( '/.github/', '/.github/workflows/ci.yml', '/.gitignore', '/.gitattributes', '/my.git-notes/', '/digit/', '/.hgtags-guide/' ) as $path ) {
		check( null === Firewall::inspect( array( 'path' => $path ) ), "false alarm on {$path}" );
	}
}

function test_cloudflare_autoblock_capped() {
	$ip = '2a06:98c0:3600::103';
	// A repeat offender would normally get a day; a Cloudflare address gets an hour each time.
	foreach ( array( 1, 2 ) as $offence ) {
		$block = Guard::auto_block( $ip, 'auto', 'test', null );
		check_same( $offence, $block['offenses'] );
		$minutes = ( strtotime( $block['expires_at'] . ' UTC' ) - time() ) / 60;
		check( $minutes > 58 && $minutes <= 60, 'offence ' . $offence . ' lasts ' . $minutes . ' minutes' );
		Blocklist::remove( $ip );
	}
	check_same( $ip, get_option( Guard::CLOUDFLARE_OPTION )['ip'], 'the owner is told once' );
	// A login lockout longer than an hour is capped too.
	$block   = Guard::auto_block( '104.16.0.9', 'login', 'test', 240 );
	$minutes = ( strtotime( $block['expires_at'] . ' UTC' ) - time() ) / 60;
	check( $minutes > 58 && $minutes <= 60 );

	// Manual blocks are not changed.
	$block = Blocklist::add( '104.16.0.10', 'manual', 'test', 0 );
	check_same( null, $block['expires_at'] );

	// A site that says it is behind Cloudflare sees visitors' own addresses: no cap.
	zbst_set( array( 'trust_cloudflare' => 1 ) );
	delete_option( Guard::CLOUDFLARE_OPTION );
	Guard::auto_block( '2a06:98c0:3600::104', 'auto', 'test', null );
	$block   = Guard::auto_block( '2a06:98c0:3600::105', 'login', 'test', 240 );
	$minutes = ( strtotime( $block['expires_at'] . ' UTC' ) - time() ) / 60;
	check( $minutes > 238 );
	check( false === get_option( Guard::CLOUDFLARE_OPTION ) );
	// And other addresses escalate as before.
	zbst_set( array( 'trust_cloudflare' => 0 ) );
	Guard::auto_block( '203.0.113.70', 'auto', 'test', null );
	Blocklist::remove( '203.0.113.70' );
	$block   = Guard::auto_block( '203.0.113.70', 'auto', 'test', null );
	$minutes = ( strtotime( $block['expires_at'] . ' UTC' ) - time() ) / 60;
	check( $minutes > 1438 );
}

function test_firewall_flatten_keeps_its_results() {
	$input = array( 'a' => '1', 'b' => array( 'c' => 2, 'd' => array( 'e' => true, 'f' => null ) ), 7 => 'x' );
	check_same( array( 'a', '1', 'b', 'c', '2', 'd', 'e', '1', 'f', '7', 'x' ), Firewall::flatten( $input ) );
	check_same( array( 'text' ), Firewall::flatten( 'text' ) );
	check_same( array(), Firewall::flatten( null ) );
	$deep = 'x';
	for ( $i = 0; $i < 12; $i++ ) {
		$deep = array( 'k' . $i => $deep );
	}
	check( ! in_array( 'x', Firewall::flatten( $deep ), true ), 'nesting beyond eight levels is ignored' );
}

// ---------------------------------------------------------------------------------------------
// Address lists and the daily refresh.
// ---------------------------------------------------------------------------------------------

function zbst_list_json( array $prefixes ) {
	$out = array();
	foreach ( $prefixes as $prefix ) {
		$out[] = array( ( false === strpos( $prefix, ':' ) ? 'ipv4Prefix' : 'ipv6Prefix' ) => $prefix );
	}
	return json_encode( array( 'creationTime' => '2026-11-12T15:45:54.000000', 'prefixes' => $out ) );
}

function zbst_can_all_lists( $json ) {
	foreach ( Agents::registry() as $agent ) {
		foreach ( $agent['urls'] as $url ) {
			WP_Stub::$http[ $url ] = array( 200, $json );
		}
	}
}

function test_parse_list() {
	$list = Agents::parse_list( zbst_list_json( array( '66.249.64.0/27', '2001:4860:4801:10::/64', '66.249.64.0/27', '34.162.230.222/32', 'nonsense', '0.0.0.0/0', '::/0' ) ) );
	check_same( array( '66.249.64.0/27', '2001:4860:4801:10::/64', '34.162.230.222' ), $list['prefixes'], 'valid prefixes once each; ranges as wide as the internet are dropped' );
	check_same( '2026-11-12T15:45:54.000000', $list['creation_time'] );
	foreach ( array( '', 'not json', '[]', '{"prefixes":"x"}', '{"prefixes":[]}', '{"prefixes":[{"ipv4Prefix":"999.1.1.1/8"}]}', '<html>302 Found</html>' ) as $bad ) {
		check( null === Agents::parse_list( $bad ), 'accepted ' . $bad );
	}
}

function test_refresh_stores_every_list() {
	zbst_can_all_lists( zbst_list_json( array( '192.0.2.0/24', '2001:db8:1::/48' ) ) );
	$results = Agents::refresh();
	check_same( 11, count( $results ), 'every agent with a published list' );
	check_same( array( true ), array_values( array_unique( array_column( $results, 'ok' ) ) ) );
	check_same( 12, count( WP_Stub::$requests ), 'Google\'s fetchers have two lists' );
	check_same( 'ZenZeiTen-Bastion/' . ZBST_VERSION, WP_Stub::$requests[0][1]['user-agent'] );
	check_same( 10, WP_Stub::$requests[0][1]['timeout'] );
	check_same( 2097152, WP_Stub::$requests[0][1]['limit_response_size'] );
	$lists = get_option( Agents::LISTS_OPTION );
	check_same( array( '192.0.2.0/24', '2001:db8:1::/48' ), $lists['google-fetchers']['prefixes'], 'the two lists are merged without repeats' );
	check_same( 2, $lists['microsoft-bingbot']['count'] );
	check( ! isset( $lists['anthropic-agent'] ), 'no list is published for Claude-Agent' );
	check_same( 0, count( zbst_events() ) );

	zbst_agent_request( '192.0.2.9', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)' );
	check_same( 'verified', Agents::verdict(), 'verdicts use the new lists at once' );
	foreach ( Agents::status() as $row ) {
		check_same( 'anthropic-agent' === $row['id'] ? 'none' : 'fresh', $row['status'], $row['id'] );
	}
}

function test_refresh_rejects_bad_list() {
	zbst_seed_agent_lists( 1 );
	$url = 'https://openai.com/gptbot.json';
	zbst_can_all_lists( zbst_list_json( array( '192.0.2.0/24' ) ) );
	foreach ( array( array( 200, '' ), array( 200, '{"prefixes":[' ), array( 200, '{"creationTime":"x","prefixes":[]}' ), array( 404, 'Not found' ), new WP_Error( 'http_request_failed', 'timed out' ) ) as $n => $bad ) {
		WP_Stub::$http[ $url ] = $bad;
		$failed = array_values( array_filter( Agents::refresh(), function ( $row ) { return ! $row['ok']; } ) );
		check_same( array( 'openai-gptbot' ), array_column( $failed, 'id' ) );
		$list = get_option( Agents::LISTS_OPTION )['openai-gptbot'];
		check_same( array( '198.51.100.0/24' ), $list['prefixes'], 'the previous copy is kept' );
		check( $list['fetched_at'] < time() - 80000, 'and keeps its age, so it goes stale after three days' );
		check_same( $n + 1, count( zbst_events( 'agent_list' ) ) );
	}
	$event = zbst_events( 'agent_list' )[1];
	check_same( '0', (string) $event['score'] );
	check_same( 'openai-gptbot', $event['rule'] );
	check_same( '', $event['ip'] );
	check( false !== strpos( $event['details'], $url ) && false !== strpos( $event['details'], 'HTTP 404' ), $event['details'] );
	check( false !== strpos( zbst_events( 'agent_list' )[0]['details'], 'timed out' ) );
	$status = array_column( Agents::status(), 'status', 'id' );
	check_same( 'failed', $status['openai-gptbot'] );
	check_same( 'fresh', $status['openai-searchbot'] );
	// The kept copy still works while it is fresh.
	zbst_agent_request( '198.51.100.9', ZBST_UA_GPTBOT );
	check_same( 'verified', Agents::verdict() );

	// A list that was never fetched and fails has nothing to judge with.
	delete_option( Agents::LISTS_OPTION );
	Agents::reset();
	Agents::refresh();
	check_same( 'unknown', Agents::verdict() );
	check_same( array(), get_option( Agents::LISTS_OPTION )['openai-gptbot']['prefixes'] );
}

function test_refresh_cron_job() {
	Cron::schedule();
	check_same( 'daily', wp_get_schedule( Cron::AGENTS ) );
	check( wp_next_scheduled( Cron::AGENTS ) <= time() + 60, 'the first refresh runs within minutes' );
	zbst_can_all_lists( zbst_list_json( array( '192.0.2.0/24' ) ) );
	zbst_set( array( 'agent_mode' => 'off' ) );
	Agents::cron_refresh();
	check_same( 0, count( WP_Stub::$requests ), 'no requests while the module is off' );
	zbst_set( array( 'agent_mode' => 'log' ) );
	Agents::cron_refresh();
	check_same( 12, count( WP_Stub::$requests ) );
	Cron::unschedule();
	check( false === wp_next_scheduled( Cron::AGENTS ) );
}

// ---------------------------------------------------------------------------------------------
// Settings and WP-CLI.
// ---------------------------------------------------------------------------------------------

function test_settings_sanitize_agent_keys() {
	$d = Settings::defaults();
	check_same( array( 'log', 0, 120, 1440, 20 ), array( $d['agent_mode'], $d['agent_traps'], $d['agent_crawl_ceiling'], $d['score_window_long'], $d['score_threshold_long'] ) );
	$s = Settings::sanitize(
		array(
			'agent_mode'           => 'aggressive',
			'agent_traps'          => 'yes',
			'agent_crawl_ceiling'  => '99999',
			'score_window_long'    => '5',
			'score_threshold_long' => '1',
		)
	);
	check_same( 'log', $s['agent_mode'], 'an unknown mode falls back to the default' );
	check_same( 1, $s['agent_traps'] );
	check_same( 10000, $s['agent_crawl_ceiling'] );
	check_same( 60, $s['score_window_long'] );
	check_same( 5, $s['score_threshold_long'] );

	$s = Settings::sanitize( array( 'agent_mode' => 'protect', 'agent_crawl_ceiling' => '-3', 'score_window_long' => '0', 'score_threshold_long' => '5000' ) );
	check_same( array( 'protect', 0, 0, 0, 1000 ), array( $s['agent_mode'], $s['agent_traps'], $s['agent_crawl_ceiling'], $s['score_window_long'], $s['score_threshold_long'] ) );
	check_same( 10080, Settings::sanitize( array( 'score_window_long' => '999999' ) )['score_window_long'] );
	// The long window never reaches back further than the log is kept.
	check_same( 4320, Settings::sanitize( array( 'score_window_long' => '10080', 'log_retention_days' => '3' ) )['score_window_long'] );
	check_same( 'off', Settings::sanitize( array( 'agent_mode' => 'off' ) )['agent_mode'] );
}

function test_cli_agents_commands() {
	zbst_seed_agent_lists( 1 );
	$cli = new CLI();
	WP_CLI::$out = array();
	$cli->status();
	check( in_array( 'Agent mode:         log', WP_CLI::$out, true ), implode( "\n", WP_CLI::$out ) );

	WP_CLI::$out = array();
	$cli->agents( array( 'status' ), array() );
	check_same( count( Agents::registry() ), count( WP_CLI::$out ) );
	check( 0 === strpos( WP_CLI::$out[3], 'google-googlebot | Googlebot, GoogleOther | 1 | ' ) && false !== strpos( WP_CLI::$out[3], ' UTC | 1 | fresh' ), WP_CLI::$out[3] );

	WP_CLI::$out = array();
	$cli->agents( array( 'check', '203.0.113.9' ), array( 'ua' => ZBST_UA_GPTBOT ) );
	check_same( 'Verdict:  spoofed', WP_CLI::$out[0] );
	check_same( 'Agent:    openai-gptbot (claims GPTBot)', WP_CLI::$out[1] );
	$cli->agents( array( 'check', '192.0.2.7' ), array( 'ua' => ZBST_UA_GOOGLEBOT ) );
	check_same( 'Verdict:  verified', WP_CLI::$out[3] );
	check_same( 0, count( zbst_events() ), 'check writes nothing' );

	WP_CLI::$out = array();
	$cli->agents( array( 'traps' ), array() );
	$before = WP_CLI::$out;
	check_same( 'Traps:    off', $before[0] );
	check( 1 === preg_match( '#^Trap URL: https://example\.com/zbst-[0-9a-f]{12}/$#', $before[1] ), $before[1] );
	WP_CLI::$out = array();
	$cli->agents( array( 'traps' ), array( 'regenerate' => true ) );
	check( WP_CLI::$out[1] !== $before[1] && WP_CLI::$out[2] !== $before[2] );

	WP_CLI::$out = array();
	zbst_can_all_lists( zbst_list_json( array( '192.0.2.0/24' ) ) );
	$cli->agents( array( 'refresh' ), array() );
	check_same( 'Success: Agent lists refreshed.', end( WP_CLI::$out ) );
	WP_Stub::$http = array();
	foreach ( array( array( 'refresh' ), array( 'check', 'not-an-ip' ), array( 'nonsense' ), array() ) as $args ) {
		$failed = false;
		try {
			$cli->agents( $args, array() );
		} catch ( RuntimeException $e ) {
			$failed = 0 === strpos( $e->getMessage(), 'WP_CLI::error' );
		}
		check( $failed, 'no error for: ' . implode( ' ', $args ) );
	}
}

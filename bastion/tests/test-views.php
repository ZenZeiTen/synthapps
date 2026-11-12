<?php
/**
 * Render every admin screen with data. Any PHP notice or warning in a view fails the test.
 *
 * @package ZenZeiTenBastion
 */

// phpcs:disable

use ZenZeiTenBastion\Admin\Admin;
use ZenZeiTenBastion\Backup;
use ZenZeiTenBastion\Blocklist;
use ZenZeiTenBastion\Hardening;

function zbst_seed_views() {
	zbst_request( '198.51.100.7', array( 'q' => '"><script>alert(document.cookie)</script>' ) );
	zbst_run_guard();
	zbst_request( '198.51.100.7', array( 'id' => '1 UNION SELECT 1' ) );
	zbst_run_guard();
	zbst_request( '198.51.100.8', array(), array( 'HTTP_USER_AGENT' => '<b>sqlmap</b>/1.0' ) );
	zbst_run_guard();
	zbst_request( '198.51.100.9' );
	Hardening::login_failed( '<img src=x onerror=alert(1)>' );
	Blocklist::add( '192.0.2.0/24', 'manual', 'Reason with <tags>', 0 );
	$GLOBALS['wpdb']->pdo->exec( 'CREATE TABLE wp_options (option_id INTEGER PRIMARY KEY, option_name TEXT)' );
	Backup::create( 'manual' );
	WP_Stub::$user = (object) array( 'ID' => 1, 'roles' => array( 'administrator' ) );
}

function zbst_render( callable $fn ) {
	ob_start();
	try {
		$fn();
	} finally {
		$html = ob_get_clean();
	}
	return $html;
}

function zbst_no_raw_attack_markup( $html ) {
	check( false === strpos( $html, '<script>alert' ), 'unescaped script in page' );
	check( false === strpos( $html, '<img src=x' ), 'unescaped img in page' );
	check( false === strpos( $html, '<b>sqlmap' ), 'unescaped user agent in page' );
	check( false === strpos( $html, 'Reason with <tags>' ), 'unescaped reason in page' );
}

function test_view_dashboard() {
	zbst_seed_views();
	$html = zbst_render( array( new Admin(), 'page_dashboard' ) );
	check( false !== strpos( $html, 'zbst-wrap' ) );
	check( false !== strpos( $html, 'zbst-feed' ) );
	check( 24 === substr_count( $html, 'class="zbst-bar"' ) );
	check( false !== strpos( $html, '198.51.100.7' ) );
	// The feed's initial data is JSON inside a script tag; markup must be escaped there too.
	check( false === strpos( $html, '</script><script>' ) );
	zbst_no_raw_attack_markup( $html );
}

function test_view_events() {
	zbst_seed_views();
	$html = zbst_render( array( new Admin(), 'page_events' ) );
	check( false !== strpos( $html, 'sqli-union' ) );
	zbst_no_raw_attack_markup( $html );
	$_GET = array( 'type' => 'login_failed', 'ip' => '198.51.100.9', 'severity' => '2', 'paged' => '1' );
	$html = zbst_render( array( new Admin(), 'page_events' ) );
	check( false !== strpos( $html, '1 event' ) );
	zbst_no_raw_attack_markup( $html );
}

function test_view_blocks() {
	zbst_seed_views();
	$_GET = array( 'ip' => '"><script>alert(1)</script>' );
	$html = zbst_render( array( new Admin(), 'page_blocks' ) );
	check( false !== strpos( $html, '192.0.2.0/24' ) );
	check( false !== strpos( $html, 'Permanent' ) );
	zbst_no_raw_attack_markup( $html );
}

function test_view_backups() {
	zbst_seed_views();
	$html = zbst_render( array( new Admin(), 'page_backups' ) );
	check( false !== strpos( $html, 'zbst_restore' ) );
	check( false !== strpos( $html, Backup::all()[0]['id'] ) );
	check( false !== strpos( $html, 'wp bastion restore latest' ) );
}

function test_view_settings() {
	zbst_seed_views();
	$html = zbst_render( array( new Admin(), 'page_settings' ) );
	check( false !== strpos( $html, 'name="zbst[firewall_mode]"' ) );
	check_same( count( ZenZeiTenBastion\Firewall::rules() ), substr_count( $html, 'name="zbst[enabled_rules][]" value="' ) - 1 );
	check( false !== strpos( $html, 'Bastion sees it: 198.51.100.9' ), 'shows the administrator their own address' );
}

function test_view_settings_agents_section() {
	zbst_seed_views();
	zbst_seed_agent_lists( 1 );
	$lists = get_option( ZenZeiTenBastion\Agents::LISTS_OPTION );
	$lists['openai-gptbot']['error'] = 'https://openai.com/gptbot.json (HTTP 500 <b>)';
	update_option( ZenZeiTenBastion\Agents::LISTS_OPTION, $lists );
	ZenZeiTenBastion\Agents::reset();
	$html = zbst_render( array( new Admin(), 'page_settings' ) );
	foreach ( array( 'agent_mode', 'agent_traps', 'agent_crawl_ceiling', 'score_window_long', 'score_threshold_long' ) as $key ) {
		check( false !== strpos( $html, 'name="zbst[' . $key . ']"' ), 'no field for ' . $key );
	}
	check( false !== strpos( $html, 'name="zbst[agent_mode]" value="log"  checked' ), 'ships in Log-only mode' );
	check_same( count( ZenZeiTenBastion\Agents::registry() ), substr_count( $html, '<td><span class="zbst-badge' ), 'one row per agent' );
	check( false !== strpos( $html, 'google-googlebot' ) && false !== strpos( $html, 'Fresh' ) && false !== strpos( $html, 'Last refresh failed' ) && false !== strpos( $html, 'No list published' ) );
	check( false !== strpos( $html, 'HTTP 500 &lt;b&gt;' ) && false === strpos( $html, '500 <b>' ), 'the failure text is escaped' );
	check( false !== strpos( $html, 'form="zbst-refresh-agents"' ) && false !== strpos( $html, 'id="zbst-refresh-agents"' ) && false !== strpos( $html, 'value="zbst_refresh_agents"' ) );
	check( false === strpos( $html, 'form="zbst-regenerate-traps"' ), 'no Regenerate button while the traps are off' );
	check( false === get_option( ZenZeiTenBastion\Agents::TRAPS_OPTION ), 'viewing the screen creates no trap' );
	// Forms cannot be nested: the button forms come after the settings form closes.
	check( strpos( $html, 'id="zbst-refresh-agents"' ) > strrpos( $html, 'Save settings' ) );

	zbst_set( array( 'agent_traps' => 1 ) );
	$html = zbst_render( array( new Admin(), 'page_settings' ) );
	$trap = ZenZeiTenBastion\Agents::traps();
	check( false !== strpos( $html, 'form="zbst-regenerate-traps"' ) );
	check( false !== strpos( $html, 'Disallow: ' . $trap['path'] . '/' ) && false !== strpos( $html, $trap['key'] ) );
}

function test_agent_buttons() {
	WP_Stub::$user = (object) array( 'ID' => 1, 'roles' => array( 'administrator' ) );
	zbst_set( array( 'agent_traps' => 1 ) );
	$before = ZenZeiTenBastion\Agents::traps();
	try {
		( new Admin() )->handle_regenerate_traps();
	} catch ( Zbst_Stop $e ) {
	}
	check( ZenZeiTenBastion\Agents::traps()['path'] !== $before['path'] );

	// Refresh with one list failing: the notice names it.
	foreach ( ZenZeiTenBastion\Agents::registry() as $agent ) {
		foreach ( $agent['urls'] as $url ) {
			WP_Stub::$http[ $url ] = array( 200, '{"prefixes":[{"ipv4Prefix":"192.0.2.0/24"}]}' );
		}
	}
	WP_Stub::$http['https://www.bing.com/toolbox/bingbot.json'] = array( 503, '' );
	try {
		( new Admin() )->handle_refresh_agents();
	} catch ( Zbst_Stop $e ) {
	}
	$notice = get_transient( 'zbst_notice_1' );
	check_same( 'error', $notice[0] );
	check( false !== strpos( $notice[1], 'microsoft-bingbot' ) && false === strpos( $notice[1], 'openai' ), $notice[1] );
	check_same( 1, get_option( ZenZeiTenBastion\Agents::LISTS_OPTION )['openai-gptbot']['count'] );
}

function test_cloudflare_notice() {
	WP_Stub::$user = (object) array( 'ID' => 1, 'roles' => array( 'administrator' ) );
	check_same( '', zbst_render( array( new Admin(), 'cloudflare_notice' ) ), 'no notice without such a block' );
	ZenZeiTenBastion\Guard::auto_block( '2a06:98c0:3600::103', 'auto', 'test', null );
	$html = zbst_render( array( new Admin(), 'cloudflare_notice' ) );
	check( false !== strpos( $html, '2a06:98c0:3600::103' ) && false !== strpos( $html, 'Your address as Bastion sees it' ) && false !== strpos( $html, 'zbst_dismiss_cloudflare' ) );
	WP_Stub::$user = (object) array( 'ID' => 5, 'roles' => array( 'subscriber' ) );
	check_same( '', zbst_render( array( new Admin(), 'cloudflare_notice' ) ), 'hidden from users without the capability' );
	WP_Stub::$user = (object) array( 'ID' => 1, 'roles' => array( 'administrator' ) );
	try {
		( new Admin() )->handle_dismiss_cloudflare();
	} catch ( Zbst_Stop $e ) {
	}
	check_same( '', zbst_render( array( new Admin(), 'cloudflare_notice' ) ), 'gone after it is dismissed' );
	ZenZeiTenBastion\Guard::auto_block( '104.16.0.9', 'auto', 'test', null );
	check_same( '', zbst_render( array( new Admin(), 'cloudflare_notice' ) ), 'and shown only once' );
}

function test_screens_check_the_capability() {
	WP_Stub::$user = (object) array( 'ID' => 5, 'roles' => array( 'subscriber' ) );
	foreach ( array( 'page_dashboard', 'page_events', 'page_blocks', 'page_backups', 'page_settings', 'handle_restore', 'handle_backup_now', 'handle_download', 'handle_save_settings', 'handle_block', 'handle_refresh_agents', 'handle_regenerate_traps', 'handle_dismiss_cloudflare' ) as $method ) {
		$denied = false;
		try {
			zbst_render( array( new Admin(), $method ) );
		} catch ( RuntimeException $e ) {
			$denied = 0 === strpos( $e->getMessage(), 'wp_die' );
		}
		check( $denied, "{$method} did not check the capability" );
	}
}

function test_admin_cannot_block_own_address() {
	WP_Stub::$user = (object) array( 'ID' => 1, 'roles' => array( 'administrator' ) );
	$_REQUEST      = array( 'ip' => '203.0.113.0/24', 'minutes' => '0' );
	try {
		( new Admin() )->handle_block();
	} catch ( Zbst_Stop $e ) {
	}
	check( null === Blocklist::match( '203.0.113.10' ) );
	$_REQUEST = array( 'ip' => '198.51.100.200', 'minutes' => '60' );
	try {
		( new Admin() )->handle_block();
	} catch ( Zbst_Stop $e ) {
	}
	check_same( '198.51.100.200', Blocklist::match( '198.51.100.200' ) );
	$_REQUEST = array();
}

function test_settings_form_round_trip() {
	WP_Stub::$user = (object) array( 'ID' => 1, 'roles' => array( 'administrator' ) );
	$_POST         = array(
		'zbst' => array(
			'firewall_mode'      => 'log',
			'enabled_rules'      => array( '', 'sqli-union', 'xss-script' ),
			'login_max_failures' => '3',
			'backup_schedule'    => 'weekly',
			'auto_block'         => '1',
		),
	);
	try {
		( new Admin() )->handle_save_settings();
	} catch ( Zbst_Stop $e ) {
	}
	$s = ZenZeiTenBastion\Settings::all();
	check_same( 'log', $s['firewall_mode'] );
	check_same( 3, $s['login_max_failures'] );
	check_same( 0, $s['alerts_enabled'], 'unticked boxes save as off' );
	check( ! in_array( 'xss-script', $s['disabled_rules'], true ) && in_array( 'rce-php', $s['disabled_rules'], true ) );
	$_POST = array();
}

function test_error_notice_shows_escaped_details() {
	WP_Stub::$user = (object) array( 'ID' => 1, 'roles' => array( 'administrator' ) );
	$html          = zbst_render( array( new Admin(), 'error_notice' ) );
	check_same( '', $html, 'no notice without an error' );
	update_option(
		ZenZeiTenBastion\Guard::ERROR_OPTION,
		array( 'time' => time(), 'message' => 'Error: <script>x</script> in /a.php:1', 'url' => '/?q=<b>', 'version' => ZBST_VERSION, 'php' => PHP_VERSION )
	);
	$html = zbst_render( array( new Admin(), 'error_notice' ) );
	check( false !== strpos( $html, 'skipped a security check' ) );
	check( false !== strpos( $html, '&lt;script&gt;' ) && false === strpos( $html, '<script>x' ) && false === strpos( $html, '<b>' ) );
	check( false !== strpos( $html, 'zbst_clear_error' ) );
	WP_Stub::$user = (object) array( 'ID' => 5, 'roles' => array( 'subscriber' ) );
	check_same( '', zbst_render( array( new Admin(), 'error_notice' ) ), 'hidden from users without the capability' );
}

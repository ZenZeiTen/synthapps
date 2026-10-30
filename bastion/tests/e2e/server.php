<?php
/**
 * Router for PHP's built-in server: the real Guard in front of every request, the real dashboard
 * with admin.js, and the real live-monitor endpoint, stored in a SQLite file.
 *
 *   ZBST_E2E_DB=/tmp/e2e.sqlite php -S 127.0.0.1:8766 tests/e2e/server.php
 *
 * A request's client address comes from the X-Test-IP header, so one test can play several
 * visitors.
 *
 * @package ZenZeiTenBastion
 */

// phpcs:disable

$zbst_server = $_SERVER;
$zbst_get    = $_GET;

require dirname( __DIR__ ) . '/bootstrap.php';
restore_error_handler();
set_error_handler(
	function ( $severity, $message, $file, $line ) {
		error_log( "PHP notice in e2e: {$message} at {$file}:{$line}" );
		http_response_code( 500 );
		exit( 'php-error' );
	}
);

use ZenZeiTenBastion\Admin\Admin;
use ZenZeiTenBastion\Blocklist;
use ZenZeiTenBastion\Installer;
use ZenZeiTenBastion\Request;
use ZenZeiTenBastion\Settings;

$db_file         = getenv( 'ZBST_E2E_DB' );
$fresh           = ! file_exists( $db_file );
$GLOBALS['wpdb'] = new Fake_Wpdb( 'sqlite:' . $db_file );
// Options and transients persist next to the database so blocks and counters survive between requests.
$state_file = $db_file . '.state';
if ( file_exists( $state_file ) ) {
	list( WP_Stub::$options, WP_Stub::$transients ) = unserialize( file_get_contents( $state_file ) );
}
WP_Stub::$uploads = dirname( $db_file ) . '/uploads';
if ( $fresh ) {
	Installer::install();
}
Settings::flush();
Blocklist::reset();
register_shutdown_function(
	function () use ( $state_file ) {
		file_put_contents( $state_file, serialize( array( WP_Stub::$options, WP_Stub::$transients ) ) );
	}
);

$_SERVER = $zbst_server;
$_GET    = $zbst_get;
if ( ! empty( $_SERVER['HTTP_X_TEST_IP'] ) ) {
	$_SERVER['REMOTE_ADDR'] = $_SERVER['HTTP_X_TEST_IP'];
}
Request::reset();
WP_Stub::$home = 'http://' . $_SERVER['HTTP_HOST'];
$path          = parse_url( $_SERVER['REQUEST_URI'], PHP_URL_PATH );
$plugin        = dirname( __DIR__, 2 ) . '/zenzeiten-bastion';

if ( 0 === strpos( $path, '/asset/' ) ) {
	$file = $plugin . '/assets/' . basename( dirname( $path ) ) . '/' . basename( $path );
	header( 'Content-Type: ' . ( '.js' === substr( $file, -3 ) ? 'application/javascript' : 'text/css' ) );
	readfile( $file );
	exit;
}

if ( '/state' === $path ) {
	header( 'Content-Type: application/json' );
	echo json_encode(
		array(
			'blocks' => Blocklist::active(),
			'events' => (int) $GLOBALS['wpdb']->get_var( 'SELECT COUNT(*) FROM wp_zbst_events' ),
		)
	);
	exit;
}

$admin = new Admin();

if ( '/admin' === $path ) {
	WP_Stub::$user = (object) array( 'ID' => 1, 'roles' => array( 'administrator' ) );
	$config        = array(
		'live'     => '/wp-json/zenzeiten-bastion/v1/live',
		'nonce'    => 'nonce',
		'interval' => 700,
		'i18n'     => array( 'paused' => 'Paused', 'live' => 'Live', 'offline' => 'Connection lost', 'empty' => 'No events yet.', 'block' => 'Block' ),
		'blockUrl' => '/admin-blocks?x=1',
	);
	header( 'Content-Type: text/html; charset=utf-8' );
	echo '<!doctype html><html><head><meta charset="utf-8"><title>Bastion</title><link rel="stylesheet" href="/asset/css/admin.css"></head><body>';
	$admin->page_dashboard();
	echo '<script>window.zbstAdmin=' . json_encode( $config ) . ';</script><script src="/asset/js/admin.js"></script></body></html>';
	exit;
}

if ( '/wp-json/zenzeiten-bastion/v1/live' === $path ) {
	if ( 'nonce' !== ( $_SERVER['HTTP_X_WP_NONCE'] ?? '' ) ) {
		http_response_code( 401 );
		exit;
	}
	WP_Stub::$user = (object) array( 'ID' => 1, 'roles' => array( 'administrator' ) );
	$response      = $admin->live( new WP_REST_Request( array( 'after' => (int) ( $_GET['after'] ?? 0 ) ) ) );
	header( 'Content-Type: application/json' );
	echo json_encode( $response->get_data() );
	exit;
}

// Any other path is a public page, with the guard in front as on a real site.
add_action(
	'zbst_deny',
	function ( $status ) {
		http_response_code( $status );
		echo 'denied';
		exit;
	}
);
ZenZeiTenBastion\Guard::early();
header( 'Content-Type: text/html; charset=utf-8' );
echo '<!doctype html><title>Shop</title><h1>Welcome</h1>';

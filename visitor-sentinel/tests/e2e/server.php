<?php
/**
 * Router for PHP's built-in server: serves a test page with the real tracker.js and sends its
 * beacons to the real Tracker::collect(), stored in a SQLite file.
 *
 *   VSEN_E2E_DB=/tmp/e2e.sqlite php -S 127.0.0.1:8765 tests/e2e/server.php
 *
 * @package VisitorSentinel
 */

// phpcs:disable

$vsen_request_server = $_SERVER;
$vsen_get            = $_GET;
$vsen_body           = file_get_contents( 'php://input' );

require dirname( __DIR__ ) . '/bootstrap.php';
restore_error_handler();
set_error_handler(
	function ( $severity, $message, $file, $line ) {
		error_log( "PHP notice in e2e: {$message} at {$file}:{$line}" );
		http_response_code( 500 );
		exit( 'php-error' );
	}
);

$db_file      = getenv( 'VSEN_E2E_DB' );
$fresh        = ! file_exists( $db_file );
$GLOBALS['wpdb'] = new Fake_Wpdb( 'sqlite:' . $db_file );
VisitorSentinel\Repository::reset();
if ( $fresh ) {
	$GLOBALS['wpdb']->create_from_dbdelta( VisitorSentinel\Installer::schema( VisitorSentinel\Repository::instance(), '' ) );
}
// Options persist next to the database so blocks and settings survive between requests.
$options_file = $db_file . '.options';
WP_Stub::$options = file_exists( $options_file ) ? unserialize( file_get_contents( $options_file ) ) : array(
	'vsen_secret'   => str_repeat( 'e', 64 ),
	'vsen_settings' => VisitorSentinel\Settings::defaults(),
);
WP_Stub::$home = 'http://' . $vsen_request_server['HTTP_HOST'];
register_shutdown_function(
	function () use ( $options_file ) {
		file_put_contents( $options_file, serialize( WP_Stub::$options ) );
	}
);

$_SERVER = $vsen_request_server;
$_GET    = $vsen_get;
$path    = parse_url( $_SERVER['REQUEST_URI'], PHP_URL_PATH );

if ( '/tracker.js' === $path ) {
	header( 'Content-Type: application/javascript' );
	readfile( dirname( __DIR__, 2 ) . '/visitor-sentinel/assets/js/tracker.js' );
	exit;
}

if ( '/collect' === $path ) {
	$response = ( new VisitorSentinel\Tracker() )->collect( new WP_REST_Request( $vsen_body ) );
	http_response_code( $response->get_status() );
	header( 'Content-Type: application/json' );
	echo json_encode( $response->get_data() );
	exit;
}

if ( '/state' === $path ) {
	header( 'Content-Type: application/json' );
	$out = array();
	foreach ( array( 'visitors', 'sessions', 'pageviews', 'clicks', 'blocklist' ) as $table ) {
		$out[ $table ] = $GLOBALS['wpdb']->get_results( "SELECT * FROM wp_vsen_{$table} ORDER BY id", ARRAY_A );
	}
	echo json_encode( $out );
	exit;
}

if ( '/finalize' === $path ) {
	$GLOBALS['wpdb']->query( "UPDATE wp_vsen_clicks SET created_at = '" . VisitorSentinel\Repository::now( -1200 ) . "' WHERE finalized = 0" );
	echo (int) VisitorSentinel\Cron::finalize_clicks();
	exit;
}

if ( '/page' === $path || '/page/' === $path ) {
	// What template_redirect does on a real site.
	( new VisitorSentinel\Tracker() )->capture_landing();
	$config = array(
		'endpoint'    => '/collect',
		'storage'     => true,
		'dnt'         => true,
		'consent'     => false,
		'outbound'    => true,
		'downloads'   => true,
		'adSelectors' => VisitorSentinel\Settings::ad_selectors(),
		'protect'     => true,
		'flagDays'    => 7,
	);
	$protect = new VisitorSentinel\Protection();
	header( 'Content-Type: text/html; charset=utf-8' );
	?><!doctype html>
<html><head><meta charset="utf-8"><title>E2E landing</title>
<?php $protect->print_head(); ?>
<style>body{font:16px sans-serif;margin:0} .spacer{height:2400px;background:linear-gradient(#fff,#eef)} .vsen-ad-slot,.frame-ad{width:300px;height:120px;margin:20px;border:1px solid #999}</style>
</head><body>
<h1>Landing page</h1>
<div class="vsen-ad-slot" data-vsen-ad="sidebar"><a id="ad-link" href="#ad-target">Sponsored link</a></div>
<div class="frame-ad" data-vsen-ad="iframe-unit" id="frame-ad"><iframe id="ad-iframe" title="ad" width="300" height="120" srcdoc="<a href='#'>Iframe ad</a>"></iframe></div>
<p><a id="outbound" href="https://partner.example.org/offer">Partner</a>
<a id="download" href="/files/brochure.pdf">Brochure</a>
<button id="signup" data-vsen-track="signup">Sign up</button></p>
<div class="spacer"></div>
<p id="bottom">Bottom</p>
<script>window.vsenConfig=<?php echo json_encode( $config ); ?>;</script>
<script src="/tracker.js" defer></script>
</body></html>
	<?php
	exit;
}

http_response_code( 404 );
echo 'not found';

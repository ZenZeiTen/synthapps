<?php
/**
 * Unit tests for the parts of ContextChat that do not need WordPress.
 *
 * Run: php tests/php/unit.php
 */

define( 'ABSPATH', __DIR__ . '/' );

$plugin = dirname( __DIR__, 2 ) . '/plugin/contextchat';
require $plugin . '/includes/class-template.php';
require $plugin . '/includes/class-context.php';
require $plugin . '/includes/class-updates.php';
require $plugin . '/includes/class-analytics.php';
require $plugin . '/includes/si/class-si-pricing.php';
require $plugin . '/includes/si/class-si-router.php';
require $plugin . '/includes/si/class-si-secrets.php';
require $plugin . '/includes/si/class-countries.php';
require $plugin . '/includes/si/class-price-engine.php';
require $plugin . '/includes/class-installer.php';
require $plugin . '/includes/si/class-guard.php';
require $plugin . '/includes/si/class-validator.php';

// Just enough of WordPress's hook and plugin API for ContextChat_Updates.
define( 'CONTEXTCHAT_FILE', $plugin . '/contextchat.php' );
$filters = array();
function add_filter( $hook, $callback ) {
	$GLOBALS['filters'][ $hook ][] = $callback;
}
function apply_filters( $hook, $value ) {
	foreach ( isset( $GLOBALS['filters'][ $hook ] ) ? $GLOBALS['filters'][ $hook ] : array() as $callback ) {
		$value = call_user_func( $callback, $value );
	}
	return $value;
}
function plugin_basename( $file ) {
	return basename( dirname( $file ) ) . '/' . basename( $file );
}

$failures = 0;
$count    = 0;

function check( $name, $actual, $expected ) {
	global $failures, $count;
	$count++;
	if ( $actual === $expected ) {
		echo "ok   - {$name}\n";
		return;
	}
	$failures++;
	echo "FAIL - {$name}\n      expected: " . var_export( $expected, true ) . "\n      actual:   " . var_export( $actual, true ) . "\n";
}

// Templates: the same cases the browser script is tested against.
$cases = json_decode( file_get_contents( dirname( __DIR__ ) . '/fixtures/templates.json' ), true );
foreach ( $cases as $case ) {
	check( 'template: ' . $case['name'], ContextChat_Template::render( $case['template'], $case['vars'] ), $case['expected'] );
}

$long = ContextChat_Template::render( str_repeat( 'ab ', 600 ), array() );
check( 'template: long messages are cut to the limit', mb_strlen( $long ), ContextChat_Template::MAX_LENGTH );
check( 'template: cut messages end with an ellipsis', mb_substr( $long, -1 ), '…' );

check( 'template: text a visitor typed keeps its punctuation', ContextChat_Template::tidy( "Thanks :)  ( )\r\n\r\n\r\n\r\nBye , now " ), "Thanks :) ( )\n\nBye , now" );
check( 'template: a value cannot smuggle in the empty-placeholder mark', ContextChat_Template::render( 'A ({x}) B', array( 'x' => "\0" ) ), 'A B' );

// Phone numbers.
$phones = array(
	array( '+62 812-3456-7890', '', '6281234567890' ),
	array( '0062 812 3456 7890', '', '6281234567890' ),
	array( '0812 3456 7890', '62', '6281234567890' ),
	array( '0812 3456 7890', '', '' ),
	array( '+44 (0)20 7946 0958', '', '442079460958' ),
	array( '(415) 555-0123', '1', '4155550123' ),
	array( 'call me', '', '' ),
	array( '123', '', '' ),
	array( '+1234567890123456', '', '' ),
	array( '+62 812 3456 7890', '1', '6281234567890' ),
);
foreach ( $phones as $p ) {
	check( "phone: '{$p[0]}' with country '{$p[1]}'", ContextChat_Template::normalize_phone( $p[0], $p[1] ), $p[2] );
}

// Links.
check( 'link: wa.me with text', ContextChat_Template::link( '6281234567890', 'Hi & bye?' ), 'https://wa.me/6281234567890?text=Hi%20%26%20bye%3F' );
check( 'link: wa.me without text', ContextChat_Template::link( '6281234567890', '' ), 'https://wa.me/6281234567890' );
check( 'link: WhatsApp Web', ContextChat_Template::link( '6281234567890', 'Hi', true ), 'https://web.whatsapp.com/send?phone=6281234567890&text=Hi' );
check( 'link: line breaks are encoded', ContextChat_Template::link( '1', "a\nb" ), 'https://wa.me/1?text=a%0Ab' );

// Rule matching.
$env = array(
	'path'             => '/services/visa-translation/?ref=x',
	'id'               => 42,
	'slug'             => 'visa-translation',
	'post_type'        => 'page',
	'categories'       => array(),
	'product_category' => array(),
	'product'          => false,
	'front_page'       => false,
	'search'           => false,
);
$rule = function ( $type, $value ) {
	return array( 'type' => $type, 'value' => $value );
};
check( 'rule: address contains', ContextChat_Context::rule_matches( $rule( 'url_contains', '/visa' ), $env ), true );
check( 'rule: address contains, any of a list', ContextChat_Context::rule_matches( $rule( 'url_contains', 'passport, VISA' ), $env ), true );
check( 'rule: address does not contain', ContextChat_Context::rule_matches( $rule( 'url_contains', '/contact' ), $env ), false );
check( 'rule: page by ID', ContextChat_Context::rule_matches( $rule( 'page', '7, 42' ), $env ), true );
check( 'rule: page by slug', ContextChat_Context::rule_matches( $rule( 'page', 'visa-translation' ), $env ), true );
check( 'rule: other page', ContextChat_Context::rule_matches( $rule( 'page', '43' ), $env ), false );
check( 'rule: post type', ContextChat_Context::rule_matches( $rule( 'post_type', 'post, page' ), $env ), true );
check( 'rule: product page needs a product', ContextChat_Context::rule_matches( $rule( 'product', '' ), $env ), false );
check( 'rule: front page', ContextChat_Context::rule_matches( $rule( 'front_page', '' ), array_merge( $env, array( 'front_page' => true ) ) ), true );
check( 'rule: product category', ContextChat_Context::rule_matches( $rule( 'product_category', 'legal' ), array_merge( $env, array( 'product_category' => array( 'legal', 'visa' ) ) ) ), true );
check( 'rule: post category', ContextChat_Context::rule_matches( $rule( 'category', 'news' ), array_merge( $env, array( 'categories' => array( 'tips' ) ) ) ), false );
check( 'rule: unknown type never matches', ContextChat_Context::rule_matches( $rule( 'nope', 'x' ), $env ), false );

$rules = array(
	array( 'id' => 'r1', 'type' => 'url_contains', 'value' => '/contact' ),
	array( 'id' => 'r2', 'type' => 'post_type', 'value' => 'page' ),
	array( 'id' => 'r3', 'type' => 'url_contains', 'value' => '/visa' ),
);
check( 'rules: first match wins', ContextChat_Context::first_match( $rules, $env )['id'], 'r2' );
check( 'rules: no match', ContextChat_Context::first_match( array( $rules[0] ), $env ), null );

// Analytics: clicks are stored in UTC and counted on the day they fall on in the site time zone.
$slot = function ( $day, $hour, $quarter, $n = 1 ) {
	return array( 'd' => $day, 'h' => (string) $hour, 'q' => (string) $quarter, 'n' => (string) $n );
};
check(
	'analytics: Jakarta (UTC+7), a click at 17:00 UTC belongs to the next local day',
	ContextChat_Analytics::daily_counts(
		array( $slot( '2026-11-11', 16, 3 ), $slot( '2026-11-11', 17, 0, 2 ), $slot( '2026-11-12', 2, 0 ), $slot( '2026-11-09', 16, 3, 9 ) ),
		3,
		new DateTimeZone( 'Asia/Jakarta' ),
		strtotime( '2026-11-12 03:00:00 UTC' )
	),
	array( '2026-11-10' => 0, '2026-11-11' => 1, '2026-11-12' => 3 )
);
check(
	'analytics: Kathmandu (UTC+5:45), quarter-hour offsets land on the right day',
	ContextChat_Analytics::daily_counts(
		array( $slot( '2026-11-11', 18, 0 ), $slot( '2026-11-11', 18, 1, 4 ) ),
		2,
		new DateTimeZone( 'Asia/Kathmandu' ),
		strtotime( '2026-11-12 03:00:00 UTC' )
	),
	array( '2026-11-11' => 1, '2026-11-12' => 4 )
);
check(
	'analytics: New York, the 25-hour day when daylight saving ends keeps its last hour',
	ContextChat_Analytics::daily_counts(
		array( $slot( '2026-11-01', 3, 3 ), $slot( '2026-11-01', 4, 0, 2 ), $slot( '2026-11-02', 4, 3, 5 ), $slot( '2026-11-02', 5, 0, 7 ) ),
		3,
		new DateTimeZone( 'America/New_York' ),
		strtotime( '2026-11-03 12:00:00 UTC' )
	),
	array( '2026-11-01' => 7, '2026-11-02' => 7, '2026-11-03' => 0 )
);
check(
	'analytics: UTC, days without clicks are listed with zero, oldest first',
	ContextChat_Analytics::daily_counts( array( $slot( '2026-11-12', 0, 0 ) ), 3, new DateTimeZone( 'UTC' ), strtotime( '2026-11-12 23:59:00 UTC' ) ),
	array( '2026-11-10' => 0, '2026-11-11' => 0, '2026-11-12' => 1 )
);

// SI pricing: dollars per million tokens are micro-dollars per token.
$prices = ContextChat_SI_Pricing::table();
check( 'pricing: Haiku 5.5, 1,000 in and 200 out', ContextChat_SI_Pricing::cost_micro_usd( 'claude-haiku-5-5', array( 'input_tokens' => 1000, 'output_tokens' => 200 ), $prices ), 200 );
check( 'pricing: Sonnet 5.5 with cache reads and writes', ContextChat_SI_Pricing::cost_micro_usd( 'claude-sonnet-5-5', array( 'input_tokens' => 100, 'output_tokens' => 50, 'cache_read_input_tokens' => 1000, 'cache_creation_input_tokens' => 400 ), $prices ), 200 + 500 + 100 + 1000 );
check( 'pricing: Haiku 5.5 above 100,000 prompt tokens uses the higher rate', ContextChat_SI_Pricing::cost_micro_usd( 'claude-haiku-5-5', array( 'input_tokens' => 100001, 'output_tokens' => 10 ), $prices ), 50026 );
check( 'pricing: an unknown model is priced like the most expensive one', ContextChat_SI_Pricing::cost_micro_usd( 'claude-new-9', array( 'input_tokens' => 10, 'output_tokens' => 10 ), $prices ), 480 );
check( 'pricing: fractions round up', ContextChat_SI_Pricing::cost_micro_usd( 'claude-haiku-5-5', array( 'input_tokens' => 3 ), $prices ), 1 );
check( 'pricing: missing usage costs nothing', ContextChat_SI_Pricing::cost_micro_usd( 'claude-haiku-5-5', array(), $prices ), 0 );

// SI routing, with a scripted fake API.
class Fake_SI_Client {
	public $script; public $sent = array();
	public function __construct( array $script ) { $this->script = $script; }
	public function send( array $body, array $betas = array() ) {
		$this->sent[] = array( 'body' => $body, 'betas' => $betas );
		$next = array_shift( $this->script );
		return is_callable( $next ) ? $next( $body ) : $next;
	}
}
class Fake_SI_Meter {
	public $spent = 0;
	public function spent_today() { return $this->spent; }
	public function add( $m ) { $this->spent += $m; }
}
function si_ok( $text, $stop = 'end_turn', $model = null ) {
	return function ( $body ) use ( $text, $stop, $model ) {
		return array( 'status' => 200, 'error_type' => '', 'error_code' => '', 'retry_after' => 0, 'data' => array(
			'model' => $model ? $model : $body['model'], 'stop_reason' => $stop,
			'content' => array( array( 'type' => 'thinking', 'thinking' => '' ), array( 'type' => 'text', 'text' => $text ) ),
			'usage' => array( 'input_tokens' => 1000, 'output_tokens' => 100 ),
		) );
	};
}
function si_err( $status, $type, $code = '', $retry_after = 0 ) {
	return array( 'status' => $status, 'error_type' => $type, 'error_code' => $code, 'retry_after' => $retry_after, 'data' => array( 'type' => 'error', 'error' => array( 'type' => $type ) ) );
}
$si_run = function ( array $script, array $config = array(), $accept = null, $meter = null ) {
	$client = new Fake_SI_Client( $script );
	$meter  = $meter ? $meter : new Fake_SI_Meter();
	$pauses = array();
	$router = new ContextChat_SI_Router( $client, $config, $meter, function ( $s ) use ( &$pauses ) { $pauses[] = $s; } );
	$result = $router->route( array( 'system' => 'Be brief.', 'messages' => array( array( 'role' => 'user', 'content' => 'Hi' ) ) ), $accept );
	return array( $result, $client, $meter, $pauses );
};
$models = function ( $client ) { return array_map( function ( $s ) { return $s['body']['model']; }, $client->sent ); };

list( $r, $c, $m ) = $si_run( array( si_ok( 'Halo, Kak.' ) ) );
check( 'routing: the fast model answers a normal turn', array( $r['ok'], $r['model'], $r['text'], $models( $c ) ), array( true, 'claude-haiku-5-5', 'Halo, Kak.', array( 'claude-haiku-5-5' ) ) );
check( 'routing: the request carries effort and max_tokens, no sampling settings', array( $c->sent[0]['body']['output_config'], $c->sent[0]['body']['max_tokens'], isset( $c->sent[0]['body']['temperature'] ) ), array( array( 'effort' => 'low' ), 1024, false ) );
check( 'routing: the fast model gets no fallback beta', array( isset( $c->sent[0]['body']['fallbacks'] ), $c->sent[0]['betas'] ), array( false, array() ) );
check( 'routing: cost goes to the daily meter', array( $r['cost_micro_usd'], $m->spent ), array( 150, 150 ) );

list( $r, $c ) = $si_run( array( si_ok( 'Pasti diterima!' ), si_ok( 'Tergantung instansinya, Kak.' ) ), array(), function ( $text ) { return false !== strpos( $text, 'Pasti' ) ? 'promise' : true; } );
check( 'routing: a reply that fails a check goes to the stronger model', array( $r['ok'], $r['error'], $r['model'], $models( $c ) ), array( true, '', 'claude-sonnet-5-5', array( 'claude-haiku-5-5', 'claude-sonnet-5-5' ) ) );
check( 'routing: the stronger model is told why the draft was rejected', false !== strpos( $c->sent[1]['body']['system'], '(promise)' ), true );
check( 'routing: the stronger model asks for server-side refusal fallbacks', array( $c->sent[1]['body']['fallbacks'], $c->sent[1]['betas'] ), array( 'default', array( 'server-side-fallback-2026-07-01' ) ) );
check( 'routing: both attempts are reported', array_map( function ( $a ) { return $a['outcome']; }, $r['attempts'] ), array( 'rejected', 'ok' ) );

list( $r, $c ) = $si_run( array( si_ok( 'x' ), si_ok( 'y' ) ), array(), function () { return 'promise'; } );
check( 'routing: when both replies fail the check, the turn fails', array( $r['ok'], $r['error'], count( $c->sent ) ), array( false, 'rejected', 2 ) );

list( $r, $c ) = $si_run( array( si_ok( '', 'refusal' ), si_ok( 'OK' ) ) );
check( 'routing: a refusal goes to the stronger model', array( $r['ok'], $models( $c ) ), array( true, array( 'claude-haiku-5-5', 'claude-sonnet-5-5' ) ) );

list( $r, $c ) = $si_run( array( si_ok( '', 'max_tokens' ), si_ok( 'OK' ) ) );
check( 'routing: a reply cut off before any text goes to the stronger model', array( $r['ok'], $r['attempts'][0]['outcome'] ), array( true, 'truncated' ) );

list( $r, $c ) = $si_run( array( si_ok( '' ), si_ok( 'OK' ) ) );
check( 'routing: a finished but empty reply goes to the stronger model', array( $r['ok'], $r['attempts'][0]['outcome'], $r['model'] ), array( true, 'empty', 'claude-sonnet-5-5' ) );

list( $r, $c ) = $si_run( array( si_ok( 'Partial but usable', 'max_tokens' ) ) );
check( 'routing: a long reply cut off with text is kept', array( $r['ok'], count( $c->sent ) ), array( true, 1 ) );

list( $r, $c ) = $si_run( array( si_err( 404, 'not_found_error' ), si_ok( 'OK' ) ) );
check( 'routing: a fast model that does not exist falls through to the stronger one', array( $r['ok'], $r['model'] ), array( true, 'claude-sonnet-5-5' ) );

list( $r, $c, $m, $pauses ) = $si_run( array( si_err( 529, 'overloaded_error' ), si_ok( 'OK' ) ) );
check( 'routing: overloaded is retried once on the same model after 2 s', array( $r['ok'], $models( $c ), $pauses ), array( true, array( 'claude-haiku-5-5', 'claude-haiku-5-5' ), array( 2 ) ) );

list( $r, $c, $m, $pauses ) = $si_run( array( si_err( 429, 'rate_limit_error', '', 9 ), si_err( 500, 'api_error' ) ) );
check( 'routing: still failing after the retry stops with "unavailable", no model switch', array( $r['ok'], $r['error'], count( $c->sent ), $pauses ), array( false, 'unavailable', 2, array( 5 ) ) );

list( $r, $c, $m ) = $si_run( array( array( 'status' => 0, 'error_type' => 'transport_error', 'error_code' => 'http_request_failed', 'retry_after' => 0, 'data' => array() ), si_ok( 'OK' ) ) );
check( 'routing: a timeout is retried once', array( $r['ok'], count( $c->sent ) ), array( true, 2 ) );
check( 'routing: a timeout counts a full-length reply toward the cap', $m->spent > 1024 * 0.5 && $m->spent < 1024 * 0.5 + 1000, true );

list( $r, $c ) = $si_run( array( si_err( 429, 'rate_limit_error', 'enforced_spend_limit_reached' ) ) );
check( 'routing: the account spend limit is not retried', array( $r['error'], count( $c->sent ) ), array( 'spend_limit', 1 ) );

list( $r, $c ) = $si_run( array( si_err( 401, 'authentication_error' ) ) );
check( 'routing: a refused key stops at once', array( $r['error'], count( $c->sent ) ), array( 'auth_error', 1 ) );

list( $r, $c ) = $si_run( array( si_err( 400, 'invalid_request_error' ) ) );
check( 'routing: an invalid request is not sent to another model', array( $r['error'], count( $c->sent ) ), array( 'invalid_request', 1 ) );

$full = new Fake_SI_Meter(); $full->spent = 10000000;
list( $r, $c ) = $si_run( array( si_ok( 'never' ) ), array(), null, $full );
check( 'routing: at the daily cap nothing is sent', array( $r['error'], count( $c->sent ) ), array( 'cap_reached', 0 ) );

$near = new Fake_SI_Meter(); $near->spent = 9999900;
list( $r, $c ) = $si_run( array( si_ok( 'x' ), si_ok( 'never' ) ), array(), function () { return 'promise'; }, $near );
check( 'routing: the cap is checked again before the stronger model', array( $r['error'], count( $c->sent ) ), array( 'cap_reached', 1 ) );

list( $r, $c ) = $si_run( array( si_ok( 'x' ) ), array( 'mode' => 'worker_only' ), function () { return 'promise'; } );
check( 'routing: "fast model only" never asks the stronger model', array( $r['ok'], count( $c->sent ) ), array( false, 1 ) );

list( $r, $c ) = $si_run( array( si_ok( 'OK' ) ), array( 'mode' => 'executor_only' ) );
check( 'routing: "stronger model only" goes straight to it', $models( $c ), array( 'claude-sonnet-5-5' ) );

list( $r, $c ) = $si_run( array( si_ok( 'x' ) ), array( 'executor' => 'claude-haiku-5-5' ), function () { return 'promise'; } );
check( 'routing: the same model is not asked twice when both settings name it', count( $c->sent ), 1 );

list( $r, $c, $m ) = $si_run( array( si_ok( 'OK', 'end_turn', 'claude-opus-5-5' ) ), array( 'mode' => 'executor_only' ) );
check( 'routing: cost follows the model that actually served the reply', $m->spent, 1000 * 4 + 100 * 20 );

// SI key encryption.
$secret = 'a-long-unique-auth-key-for-tests-0123456789';
$box    = ContextChat_SI_Secrets::encrypt( 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz', $secret );
check( 'secrets: the stored form does not contain the key', false === strpos( $box, 'abcdefghijklmnop' ) && false === strpos( base64_decode( $box ), 'abcdefghijklmnop' ), true );
check( 'secrets: the key decrypts with the same secret', ContextChat_SI_Secrets::decrypt( $box, $secret ), 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz' );
check( 'secrets: a different secret cannot read it', ContextChat_SI_Secrets::decrypt( $box, $secret . 'x' ), '' );
check( 'secrets: encrypting twice gives different text (fresh nonce)', $box !== ContextChat_SI_Secrets::encrypt( 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz', $secret ), true );
check( 'secrets: damaged data reads as no key', ContextChat_SI_Secrets::decrypt( 'not base64!', $secret ), '' );
check( 'secrets: key format', array(
	ContextChat_SI_Secrets::looks_valid( 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz' ),
	ContextChat_SI_Secrets::looks_valid( 'sk-ant-admin01-abcdefghijklmnopqrstuvwxyz' ),
	ContextChat_SI_Secrets::looks_valid( 'sk-ant-api03 abcdefghijklmnop' ),
	ContextChat_SI_Secrets::looks_valid( 'hello' ),
), array( true, false, false, false ) );

// Updates: WordPress.org must not offer a same-named plugin as an update to this one.
ContextChat_Updates::init();
$transient = (object) array(
	'response'  => array(
		'contextchat/contextchat.php' => (object) array( 'new_version' => '9.9.9' ),
		'akismet/akismet.php'         => (object) array( 'new_version' => '5.4' ),
	),
	'no_update' => array( 'contextchat/contextchat.php' => (object) array( 'new_version' => '9.9.9' ) ),
);
$out = apply_filters( 'site_transient_update_plugins', $transient );
check( 'updates: only the same-named plugin is dropped from offers', array_keys( $out->response ), array( 'akismet/akismet.php' ) );
check( 'updates: the same-named plugin is dropped from no_update', $out->no_update, array() );
check( 'updates: a missing transient stays missing', apply_filters( 'site_transient_update_plugins', false ), false );
check( 'updates: header opts out of WordPress.org updates', false !== strpos( file_get_contents( CONTEXTCHAT_FILE ), "\n * Update URI:        false\n" ), true );

// Price engine: the shared vectors (design plan section 7.5) must match exactly.
$countries = new ContextChat_Countries();
$engine    = new ContextChat_Price_Engine( ContextChat_Price_Engine::seed(), $countries, function ( $ymd ) {
	return 'EST-' . $ymd . '-TEST';
} );
foreach ( json_decode( file_get_contents( dirname( __DIR__ ) . '/fixtures/prices.json' ), true ) as $case ) {
	$result = $engine->quote( $case['input'], '2026-11-21' );
	$got    = array();
	foreach ( $case['expected'] as $key => $value ) {
		$got[ $key ] = isset( $result[ $key ] ) ? $result[ $key ] : null;
	}
	check( 'price: ' . $case['name'], $got, $case['expected'] );
}
$p2 = $engine->quote( array( 'package' => 'sworn', 'source_lang' => 'id', 'target_lang' => 'en', 'pages' => 3, 'documents' => 2, 'legalisation' => 'apostille' ), '2026-11-21' );
check( 'price: P2 lines as in section 7.3', array_map( function ( $l ) {
	return array( $l['label'], $l['qty'], $l['unit_price'], $l['amount'] );
}, $p2['lines'] ), array( array( 'Terjemahan tersumpah Indonesia → Inggris', 3, 125000, 375000 ), array( 'Apostille', 2, 700000, 1400000 ) ) );
check( 'price: reference uses the date', $p2['reference'], 'EST-20261121-TEST' );
check( 'price: notes say estimate, final pages and new-client deposit', array_slice( $p2['notes'], 0, 3 ), array( 'estimate', 'final_pages_from_output', 'new_client_deposit' ) );
$en = $engine->quote( array( 'package' => 'regular', 'source_lang' => 'en', 'target_lang' => 'id', 'pages' => 2, 'documents' => 1 ), '2026-11-21', 'en' );
check( 'price: English labels', $en['lines'][0]['label'] . ' / ' . $en['lines'][0]['unit'], 'Regular translation English → Indonesian / pages' );
$p8 = $engine->quote( array( 'package' => 'sworn', 'source_lang' => 'en', 'target_lang' => 'id', 'pages' => 2, 'documents' => 1, 'legalisation' => 'ministry_embassy' ), '2026-11-21' );
check( 'price: ministry and embassy are two lines', array_column( $p8['lines'], 'amount' ), array( 250000, 700000, 1500000 ) );
check( 'price: the discount never touches legalisation (P3)', array( $p3 = $engine->quote( array( 'package' => 'sworn', 'source_lang' => 'id', 'target_lang' => 'en', 'pages' => 20, 'documents' => 20, 'legalisation' => 'apostille' ), '2026-11-21' ), $p3['legalisation_total'] )[1], 14000000 );
check( 'price: express is flagged for the team', $engine->quote( array( 'package' => 'regular', 'source_lang' => 'id', 'target_lang' => 'en', 'pages' => 1, 'documents' => 1, 'speed' => 'same_day' ), '2026-11-21' )['team_reasons'], array( 'express' ) );
check( 'price: unavailable names the pair', $engine->quote( array( 'package' => 'sworn', 'source_lang' => 'zh', 'target_lang' => 'en', 'pages' => 1, 'documents' => 1 ), '2026-11-21' ), array( 'status' => 'unavailable', 'reason' => 'package_not_offered', 'pair' => 'Mandarin → Inggris' ) );
check( 'price: a pair missing from the table', $engine->quote( array( 'package' => 'regular', 'source_lang' => 'ja', 'target_lang' => 'ko', 'pages' => 1, 'documents' => 1 ), '2026-11-21' )['reason'], 'pair_not_offered' );
check( 'price: invalid input lists every bad field', $engine->quote( array( 'package' => 'gold', 'source_lang' => 'xx', 'target_lang' => 'en', 'pages' => '-2', 'documents' => 'two' ), '2026-11-21' )['errors'], array( 'package', 'source_lang', 'pages', 'documents' ) );
check( 'price: pages given as a numeric string are accepted', $engine->quote( array( 'package' => 'regular', 'source_lang' => 'id', 'target_lang' => 'en', 'pages' => '3', 'documents' => '1' ), '2026-11-21' )['total'], 150000 );

// Legalisation route from the destination country (section 7.4).
$route = function ( $country, $date = '2026-11-21' ) use ( $engine ) {
	$r = $engine->quote( array( 'package' => 'sworn', 'source_lang' => 'id', 'target_lang' => 'en', 'pages' => 1, 'documents' => 1, 'destination_country' => $country ), $date );
	return array( $r['status'], $r['legalisation'], $r['country'] );
};
check( 'route: Australia takes the apostille', $route( 'Australia' ), array( 'ok', 'apostille', 'AU' ) );
check( 'route: Uni Emirat Arab takes ministry and embassy', $route( 'Uni Emirat Arab' ), array( 'ok', 'ministry_embassy', 'AE' ) );
check( 'route: an unknown country goes to the team', $route( 'Narnia' ), array( 'needs_team', '', '' ) );
check( 'route: Thailand before its entry into force (2027-02-28)', $route( 'Thailand', '2027-02-27' )[1], 'ministry_embassy' );
check( 'route: Thailand from its entry into force', $route( 'Thailand', '2027-02-28' )[1], 'apostille' );
check( 'route: Hong Kong is covered through China', $route( 'Hongkong' )[1], 'apostille' );
check( 'route: Curaçao is covered through the Netherlands', $route( 'Curaçao' ), array( 'ok', 'apostille', 'CW' ) );
check( 'route: a document for Indonesia needs no legalisation', $route( 'Indonesia' ), array( 'ok', 'none', 'ID' ) );
check( 'route: an explicit "none" wins over the country', $engine->quote( array( 'package' => 'sworn', 'source_lang' => 'id', 'target_lang' => 'en', 'pages' => 1, 'documents' => 1, 'destination_country' => 'Australia', 'legalisation' => 'none' ), '2026-11-21' )['legalisation_total'], 0 );

// Country spellings, in Indonesian and English (T-07).
$spellings = array(
	'Jerman' => 'DE', 'Germany' => 'DE', 'Belanda' => 'NL', 'Holland' => 'NL', 'the Netherlands' => 'NL',
	'Amerika Serikat' => 'US', 'USA' => 'US', 'Inggris' => 'GB', 'United Kingdom' => 'GB', 'Korea Selatan' => 'KR',
	'korea' => 'KR', 'Jepang' => 'JP', 'Tiongkok' => 'CN', 'Cina' => 'CN', 'UEA' => 'AE', 'Arab Saudi' => 'SA',
	'Turki' => 'TR', 'Türkiye' => 'TR', 'Vietnam' => 'VN', 'Selandia Baru' => 'NZ', 'Prancis' => 'FR', 'Perancis' => 'FR',
	'Kanada' => 'CA', 'Swiss' => 'CH', 'Singapura' => 'SG', 'ke Australia' => 'AU', 'kedutaan Jerman' => 'DE',
	'universitas di Belanda' => 'NL', 'AU' => 'AU', 'Mars' => '', 'Jerman atau Belanda' => '', '' => '',
);
$got = array();
foreach ( $spellings as $spelling => $code ) {
	$got[ $spelling ] = $countries->resolve( $spelling );
}
check( 'countries: ' . count( $spellings ) . ' spellings map to the right code, or none', $got, $spellings );
check( 'countries: the bundled Apostille list has 147 parties and territories', $countries->member_count(), 147 );
check( 'countries: names in Indonesian', $countries->name( 'DE', 'id' ) . ', ' . $countries->name( 'DE', 'en' ), 'Jerman, Germany' );

// Price table seed: the live price page on 2026-11-21.
$seed = ContextChat_Price_Engine::seed();
check( 'seed: 32 language pairs', count( $seed['rates'] ), 32 );
check( 'seed: sworn is not offered for these pairs', array_keys( array_filter( $seed['rates'], function ( $r ) {
	return null === $r['sworn'];
} ) ), array( 'zh-en', 'ja-en', 'ko-en', 'de-en', 'fr-en', 'es-en', 'it-id', 'it-en', 'nl-en', 'ru-en' ) );
check( 'seed: published amounts include rates and add-ons', array_values( array_intersect( array( 125000, 150000, 700000, 1500000, 2200000 ), $engine->published_amounts() ) ), array( 125000, 150000, 700000, 1500000, 2200000 ) );

// IDs.
check( 'ulid: 26 characters of Crockford base32', (bool) preg_match( '/^[0-9A-HJKMNP-TV-Z]{26}$/', ContextChat_Installer::ulid() ), true );
check( 'ulid: the time part sorts', strcmp( substr( ContextChat_Installer::ulid( 1000 ), 0, 10 ), substr( ContextChat_Installer::ulid( 2000 ), 0, 10 ) ) < 0, true );
check( 'ulid: a known time', substr( ContextChat_Installer::ulid( 1469918176385 ), 0, 10 ), '01ARYZ6S41' );
check( 'reference: easy-to-read alphabet', (bool) preg_match( '/^EST-20261121-[2-9A-HJKMNP-TV-Z]{4}$/', ContextChat_Price_Engine::reference( '20261121' ) ), true );

// Guard (design plan section 9.2): true and false positives.
foreach ( json_decode( file_get_contents( dirname( __DIR__ ) . '/fixtures/guard.json' ), true ) as $case ) {
	$verdict = ContextChat_Guard::inspect( $case['text'] );
	$got     = array( 'block' => $verdict['block'] );
	$want    = array( 'block' => $case['block'] );
	if ( isset( $case['clean'] ) ) {
		$got['text']  = $verdict['text'];
		$want['text'] = $case['clean'];
	}
	if ( isset( $case['flag'] ) ) {
		$got['flag']  = in_array( $case['flag'], $verdict['flags'], true );
		$want['flag'] = true;
	}
	check( 'guard: ' . ( '' === $case['block'] ? 'passes' : 'blocks (' . $case['block'] . ')' ) . ': ' . $case['name'], $got, $want );
}
check( 'guard: a blocked message keeps no text', ContextChat_Guard::inspect( 'NIK 3201234567890001' )['text'], '' );
check( 'guard: an extra file host from settings is blocked', ContextChat_Guard::inspect( 'https://files.example.net/x', array( 'files.example.net' ) )['block'], 'upload' );
check( 'guard: luhn', array( ContextChat_Guard::luhn( '4111111111111111' ), ContextChat_Guard::luhn( '4111111111111112' ) ), array( true, false ) );

// Rate limits (section 9.1), with an array as the store.
class Array_Store {
	public $data = array();
	public function get( $key ) {
		return isset( $this->data[ $key ] ) ? $this->data[ $key ] : false;
	}
	public function set( $key, $value, $ttl ) {
		$this->data[ $key ] = $value;
	}
}
$store   = new Array_Store();
$limiter = new ContextChat_Rate_Limiter( $store );
$t       = 1795000000; // A fixed minute.
$t       = $t - ( $t % 60 );
$allowed = 0;
for ( $i = 0; $i < 10; $i++ ) {
	$allowed += $limiter->message( 'visitor-a', $t + $i ) ? 1 : 0;
}
check( 'rate: 8 messages a minute, the 9th and 10th refused', $allowed, 8 );
check( 'rate: another visitor has their own count', $limiter->message( 'visitor-b', $t ), true );
check( 'rate: the next minute allows messages again', $limiter->message( 'visitor-a', $t + 60 ), true );
$day = new ContextChat_Rate_Limiter( new Array_Store(), array( 'per_minute' => 1000 ) );
$n   = 0;
for ( $i = 0; $i < 85; $i++ ) {
	$n += $day->message( 'v', $t + $i * 61 ) ? 1 : 0;
}
check( 'rate: 80 messages a day', $n, 80 );
$starts = new ContextChat_Rate_Limiter( new Array_Store() );
$n      = 0;
for ( $i = 0; $i < 8; $i++ ) {
	$n += $starts->start( 'v', $t ) ? 1 : 0;
}
check( 'rate: 6 new conversations an hour', $n, 6 );
$tight = new ContextChat_Rate_Limiter( new Array_Store(), array( 'per_minute' => 2 ) );
check( 'rate: limits can be changed', array( $tight->message( 'v', $t ), $tight->message( 'v', $t ), $tight->message( 'v', $t ) ), array( true, true, false ) );
check( 'rate: keys never contain the visitor value', count( array_filter( array_keys( $store->data ), function ( $k ) {
	return false !== strpos( $k, 'visitor' );
} ) ), 0 );

// Validator (section 8.6).
$vfix = json_decode( file_get_contents( dirname( __DIR__ ) . '/fixtures/validator.json' ), true );
foreach ( $vfix['cases'] as $case ) {
	$ctx               = $vfix['context'];
	$ctx['quote_card'] = ! empty( $case['quote_card'] );
	$result            = ContextChat_Validator::check( $case['text'], $ctx );
	$got               = array( $result['ok'], $result['reasons'] );
	$want              = array( $case['ok'], $case['reasons'] );
	if ( isset( $case['clean'] ) ) {
		$got[]  = $result['text'];
		$want[] = $case['clean'];
	}
	check( 'validator: ' . ( $case['ok'] ? 'passes' : 'rejects' ) . ': ' . $case['name'], $got, $want );
}
check( 'validator: amount formats', ContextChat_Validator::amounts( 'Rp 1.775.000, Rp1,775,000, 1.775.000 rupiah, Rp 125 rb, Rp 1,5 jt, IDR 50.000, Rp 125.000,00, 2 juta rupiah' ), array( 1775000, 1775000, 125000, 1500000, 50000, 125000, 1775000, 2000000 ) );
check( 'validator: sentences ignore number dots and abbreviations', ContextChat_Validator::sentences( 'Totalnya Rp 1.775.000, Kak. Dokumen ijazah, transkrip, dll. sudah termasuk. Tenggatnya kapan ya, Kak?' ), 3 );
check( 'validator: a last sentence without a full stop counts', ContextChat_Validator::sentences( 'Satu. Dua' ), 2 );
check( 'validator: words', ContextChat_Validator::words( 'Estimasinya Rp 1.775.000, Kak.' ), 4 );

echo "\n{$count} checks, {$failures} failed\n";
exit( $failures ? 1 : 0 );

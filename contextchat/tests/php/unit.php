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

echo "\n{$count} checks, {$failures} failed\n";
exit( $failures ? 1 : 0 );

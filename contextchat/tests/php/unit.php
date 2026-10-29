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

define( 'CONTEXTCHAT_FILE', $plugin . '/contextchat.php' );
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

// Updates: WordPress.org must never offer another plugin named contextchat as an update.
$transient = (object) array(
	'response'  => array(
		'contextchat/contextchat.php' => (object) array( 'new_version' => '9.9.9' ),
		'akismet/akismet.php'         => (object) array( 'new_version' => '5.4' ),
	),
	'no_update' => array( 'contextchat/contextchat.php' => (object) array( 'new_version' => '9.9.9' ) ),
);
$updates   = ContextChat_Updates::drop_wporg_update( $transient );
check( 'updates: an offer for this plugin is dropped, others stay', array_keys( $updates->response ), array( 'akismet/akismet.php' ) );
check( 'updates: this plugin is removed from no_update too', $updates->no_update, array() );
check( 'updates: a missing transient stays missing', ContextChat_Updates::drop_wporg_update( false ), false );
check( 'updates: the header opts out of WordPress.org updates', false !== strpos( file_get_contents( CONTEXTCHAT_FILE ), "\n * Update URI:        false\n" ), true );

echo "\n{$count} checks, {$failures} failed\n";
exit( $failures ? 1 : 0 );

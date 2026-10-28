<?php
/**
 * Switch the site language, and report what the block editor script would receive.
 *
 *   php tests/e2e/set-language.php <site-dir> <locale, or "" for English>
 */

$_SERVER['HTTP_HOST']   = 'localhost';
$_SERVER['REQUEST_URI'] = '/';
require rtrim( $argv[1], '/' ) . '/wp-load.php';

// Not $locale: that is WordPress's own global, cleared below so get_locale() reads the new value.
$target = $argv[2];
update_option( 'WPLANG', $target );
unset( $GLOBALS['locale'] );
switch_to_locale( '' !== $target ? $target : 'en_US' );

$json = load_script_textdomain( 'contextchat-block', 'contextchat', CONTEXTCHAT_DIR . 'languages' );
echo wp_json_encode(
	array(
		'locale' => get_locale(),
		'block'  => $json ? json_decode( $json, true )['locale_data']['messages'] : null,
	)
) . "\n";

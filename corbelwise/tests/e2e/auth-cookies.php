<?php
/**
 * Print logged-in cookies for the administrator as JSON, for Playwright.
 *
 *   php tests/e2e/auth-cookies.php <site-dir> <site-url>
 */

$site = rtrim( $argv[1], '/' );
$url  = rtrim( $argv[2], '/' );
$_SERVER['HTTP_HOST']   = 'localhost';
$_SERVER['REQUEST_URI'] = '/';
require $site . '/wp-load.php';

$expire = time() + HOUR_IN_SECONDS;
$cookies = array();
foreach ( array( AUTH_COOKIE => 'auth', LOGGED_IN_COOKIE => 'logged_in' ) as $name => $scheme ) {
	$cookies[] = array(
		'name'  => $name,
		'value' => wp_generate_auth_cookie( 1, $expire, $scheme ),
		'url'   => $url . '/',
	);
}
echo wp_json_encode( $cookies, JSON_UNESCAPED_SLASHES );

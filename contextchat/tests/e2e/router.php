<?php
/**
 * Router for PHP's built-in server so WordPress pretty permalinks work:
 *   php -S 127.0.0.1:8899 -t <site> tests/e2e/router.php
 */

$root = $_SERVER['DOCUMENT_ROOT'];
$path = urldecode( parse_url( $_SERVER['REQUEST_URI'], PHP_URL_PATH ) );

if ( '/' !== $path && is_file( $root . $path ) ) {
	return false;
}
if ( is_dir( $root . $path ) && is_file( $root . rtrim( $path, '/' ) . '/index.php' ) ) {
	$_SERVER['SCRIPT_NAME'] = rtrim( $path, '/' ) . '/index.php';
	chdir( $root . rtrim( $path, '/' ) );
	require $root . rtrim( $path, '/' ) . '/index.php';
	return;
}

$_SERVER['SCRIPT_NAME'] = '/index.php';
require $root . '/index.php';

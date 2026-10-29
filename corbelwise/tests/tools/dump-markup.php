<?php
/**
 * Print the block markup of every theme pattern, template and template part as JSON, for the
 * block validator (tests/tools/validate-blocks.js).
 *
 *   php tests/tools/dump-markup.php <site-dir>
 */

$site = rtrim( $argv[1], '/' );
$_SERVER['HTTP_HOST']   = 'localhost';
$_SERVER['REQUEST_URI'] = '/';
require $site . '/wp-load.php';

$out = array();
foreach ( WP_Block_Patterns_Registry::get_instance()->get_all_registered() as $pattern ) {
	if ( 0 === strpos( $pattern['name'], 'corbelwise/' ) ) {
		$out[ 'pattern:' . $pattern['name'] ] = $pattern['content'];
	}
}
$dir = get_template_directory();
foreach ( array( 'templates', 'parts' ) as $folder ) {
	foreach ( glob( "$dir/$folder/*.html" ) as $file ) {
		$out[ $folder . ':' . basename( $file ) ] = file_get_contents( $file );
	}
}
echo wp_json_encode( $out );

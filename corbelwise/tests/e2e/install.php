<?php
/**
 * Install WordPress, activate Corbelwise and the toolkit, and create demo content.
 *
 *   php tests/e2e/install.php <site-dir> <site-url> [--no-toolkit]
 */

$site       = rtrim( $argv[1], '/' );
$url        = rtrim( $argv[2], '/' );
$no_toolkit = in_array( '--no-toolkit', $argv, true );

define( 'WP_INSTALLING', true );
$parts                  = parse_url( $url );
$_SERVER['HTTP_HOST']   = $parts['host'] . ( isset( $parts['port'] ) ? ':' . $parts['port'] : '' );
$_SERVER['REQUEST_URI'] = '/';
require $site . '/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/upgrade.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';

wp_install( 'Northwind Studio', 'admin', 'admin@example.com', true, '', 'password' );
update_option( 'siteurl', $url );
update_option( 'home', $url );
update_option( 'blogdescription', 'Design and advice for growing businesses' );
update_option( 'permalink_structure', '/%postname%/' );
$GLOBALS['wp_rewrite']->init();

switch_theme( 'corbelwise' );

if ( ! $no_toolkit ) {
	$result = activate_plugin( 'corbelwise-toolkit/corbelwise-toolkit.php' );
	if ( is_wp_error( $result ) ) {
		fwrite( STDERR, $result->get_error_message() . "\n" );
		exit( 1 );
	}
}
// The theme and plugin were switched on in this request, after init ran.
require_once get_template_directory() . '/functions.php';
do_action( 'init' );

// Demo pages built from the theme's full-page patterns, at the paths the patterns link to.
$pages = array(
	'home'     => array( 'Home', 'page-home', 'page-no-title' ),
	'about'    => array( 'About', 'page-about', 'page-no-title' ),
	'services' => array( 'Services', 'page-services', 'page-no-title' ),
	'pricing'  => array( 'Pricing', 'page-pricing', 'page-no-title' ),
	'contact'  => array( 'Contact', 'page-contact', 'page-no-title' ),
);
$ids = array();
foreach ( $pages as $slug => $page ) {
	$ids[ $slug ] = wp_insert_post(
		array(
			'post_type'    => 'page',
			'post_status'  => 'publish',
			'post_title'   => $page[0],
			'post_name'    => $slug,
			'post_content' => corbelwise_pattern_markup( $page[1] ),
			'meta_input'   => array( '_wp_page_template' => $page[2] ),
		)
	);
}
$ids['blog'] = wp_insert_post( array( 'post_type' => 'page', 'post_status' => 'publish', 'post_title' => 'Journal', 'post_name' => 'journal' ) );
update_option( 'show_on_front', 'page' );
update_option( 'page_on_front', $ids['home'] );
update_option( 'page_for_posts', $ids['blog'] );

$category = wp_insert_term( 'Guides', 'category' );
$posts    = array(
	'Five questions to ask before you hire anyone' => 'A short checklist that saves time, money and stress.',
	'How we keep projects on time'                 => 'The simple habits behind deadlines we actually meet.',
	'What a fixed price really includes'           => 'No surprises: here is exactly what you pay for, and why.',
	'A year of lessons from our clients'           => 'What we learned, what we changed and what comes next.',
);
$n = 0;
foreach ( $posts as $title => $lead ) {
	$post_id = wp_insert_post(
		array(
			'post_type'    => 'post',
			'post_author'  => 1,
			'post_status'  => 'publish',
			'post_title'   => $title,
			'post_date'    => gmdate( 'Y-m-d H:i:s', time() - DAY_IN_SECONDS * ( 10 - $n ) ),
			'post_excerpt' => $lead,
			'post_content' => "<!-- wp:paragraph -->\n<p>{$lead} Good work starts with a clear plan and honest conversations. In this post we share the approach we use with every client.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:heading -->\n<h2 class=\"wp-block-heading\">Start with the goal</h2>\n<!-- /wp:heading -->\n\n<!-- wp:paragraph -->\n<p>Before anything else, agree on what success looks like and write it down.</p>\n<!-- /wp:paragraph -->",
		)
	);
	if ( ! is_wp_error( $category ) ) {
		wp_set_post_categories( $post_id, array( $category['term_id'] ) );
	}
	if ( 0 === $n ) {
		wp_insert_comment( array( 'comment_post_ID' => $post_id, 'comment_author' => 'Jamie', 'comment_content' => 'Very helpful, thank you.', 'comment_approved' => 1 ) );
	}
	$n++;
}

flush_rewrite_rules();

$out = array();
foreach ( $ids as $slug => $id ) {
	$out[ $slug ] = get_permalink( $id );
}
$out['post'] = get_permalink( $post_id );
echo wp_json_encode( $out, JSON_UNESCAPED_SLASHES ) . "\n";

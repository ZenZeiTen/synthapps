<?php
/**
 * Pattern categories and a helper for composing full-page patterns from section patterns.
 *
 * Pattern files in patterns/ register themselves (WordPress reads their headers).
 *
 * @package Corbelwise
 */

defined( 'ABSPATH' ) || exit;

add_action( 'init', 'corbelwise_register_pattern_categories', 9 );

/**
 * Register the pattern categories the theme's patterns use.
 */
function corbelwise_register_pattern_categories() {
	$categories = array(
		'corbelwise-pages'    => array( __( 'Corbelwise: Full pages', 'corbelwise' ), __( 'Complete pages to start from.', 'corbelwise' ) ),
		'corbelwise-hero'     => array( __( 'Corbelwise: Hero', 'corbelwise' ), __( 'Opening sections with a headline and call to action.', 'corbelwise' ) ),
		'corbelwise-sections' => array( __( 'Corbelwise: Sections', 'corbelwise' ), __( 'Services, features, numbers, steps, team and more.', 'corbelwise' ) ),
		'corbelwise-social'   => array( __( 'Corbelwise: Testimonials and pricing', 'corbelwise' ), __( 'Social proof, pricing tables and questions.', 'corbelwise' ) ),
		'corbelwise-cta'      => array( __( 'Corbelwise: Calls to action', 'corbelwise' ), __( 'Banners that ask for the next step.', 'corbelwise' ) ),
		'corbelwise-blog'     => array( __( 'Corbelwise: Posts', 'corbelwise' ), __( 'Lists and grids of recent posts.', 'corbelwise' ) ),
	);

	foreach ( $categories as $slug => $labels ) {
		register_block_pattern_category(
			$slug,
			array(
				'label'       => $labels[0],
				'description' => $labels[1],
			)
		);
	}
}

/**
 * Return the block markup of one of the theme's own pattern files.
 *
 * Used by the full-page patterns to reuse sections, and by the "Create a home page" button.
 * Only file names made of lowercase letters, digits and hyphens that exist in patterns/ are read.
 *
 * @param string $name Pattern file name without ".php", for example "hero-split".
 * @return string Block markup, or an empty string for an unknown name.
 */
function corbelwise_pattern_markup( $name ) {
	if ( ! is_string( $name ) || ! preg_match( '/^[a-z0-9-]+$/', $name ) ) {
		return '';
	}
	$file = CORBELWISE_DIR . '/patterns/' . $name . '.php';
	if ( ! is_readable( $file ) ) {
		return '';
	}
	ob_start();
	include $file;
	return trim( (string) ob_get_clean() );
}

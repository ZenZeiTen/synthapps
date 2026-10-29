<?php
/**
 * Pattern categories and a helper for composing full-page patterns from section patterns.
 *
 * Pattern files in patterns/ register themselves (WordPress reads their headers).
 *
 * @package ZenZeiTen_Forma
 */

defined( 'ABSPATH' ) || exit;

add_action( 'init', 'zzforma_register_pattern_categories', 9 );

/**
 * Register the pattern categories the theme's patterns use.
 */
function zzforma_register_pattern_categories() {
	$categories = array(
		'zzforma-pages'    => array( __( 'Forma: Full pages', 'zenzeiten-forma' ), __( 'Complete pages to start from.', 'zenzeiten-forma' ) ),
		'zzforma-hero'     => array( __( 'Forma: Hero', 'zenzeiten-forma' ), __( 'Opening sections with a headline and call to action.', 'zenzeiten-forma' ) ),
		'zzforma-sections' => array( __( 'Forma: Sections', 'zenzeiten-forma' ), __( 'Services, features, numbers, steps, team and more.', 'zenzeiten-forma' ) ),
		'zzforma-social'   => array( __( 'Forma: Testimonials and pricing', 'zenzeiten-forma' ), __( 'Social proof, pricing tables and questions.', 'zenzeiten-forma' ) ),
		'zzforma-cta'      => array( __( 'Forma: Calls to action', 'zenzeiten-forma' ), __( 'Banners that ask for the next step.', 'zenzeiten-forma' ) ),
		'zzforma-blog'     => array( __( 'Forma: Posts', 'zenzeiten-forma' ), __( 'Lists and grids of recent posts.', 'zenzeiten-forma' ) ),
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
function zzforma_pattern_markup( $name ) {
	if ( ! is_string( $name ) || ! preg_match( '/^[a-z0-9-]+$/', $name ) ) {
		return '';
	}
	$file = ZZFORMA_DIR . '/patterns/' . $name . '.php';
	if ( ! is_readable( $file ) ) {
		return '';
	}
	ob_start();
	include $file;
	return trim( (string) ob_get_clean() );
}

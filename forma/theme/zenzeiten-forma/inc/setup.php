<?php
/**
 * Theme supports, the front-end stylesheet and font preloading.
 *
 * @package ZenZeiTen_Forma
 */

defined( 'ABSPATH' ) || exit;

add_action( 'after_setup_theme', 'zzforma_setup' );
add_action( 'wp_enqueue_scripts', 'zzforma_enqueue_styles' );
add_action( 'wp_head', 'zzforma_preload_fonts', 2 );
add_filter( 'body_class', 'zzforma_body_class' );

/**
 * Register theme supports.
 */
function zzforma_setup() {
	load_theme_textdomain( 'zenzeiten-forma', ZZFORMA_DIR . '/languages' );

	add_theme_support( 'editor-styles' );
	add_editor_style( 'assets/css/theme.css' );
	add_theme_support( 'responsive-embeds' );
	add_theme_support( 'post-thumbnails' );

	// The theme ships its own sections; WordPress's generic ones would crowd them out of the inserter.
	remove_theme_support( 'core-block-patterns' );
}

/**
 * Enqueue the front-end stylesheet. WordPress prints it inline (no extra request) because it is
 * small and its file path is registered, which keeps the critical rendering path short.
 */
function zzforma_enqueue_styles() {
	wp_enqueue_style( 'zzforma', ZZFORMA_URI . '/assets/css/theme.css', array(), ZZFORMA_VERSION );
	wp_style_add_data( 'zzforma', 'path', ZZFORMA_DIR . '/assets/css/theme.css' );
}

/**
 * Font files to preload for each font-family preset slug. Only the Latin subset of the upright
 * style is preloaded; other subsets and italics download only when a page uses them.
 *
 * @return array<string, string> Preset slug => file path relative to assets/fonts/.
 */
function zzforma_preloadable_fonts() {
	return array(
		'body'    => 'inter/inter-latin-wght-normal.woff2',
		'heading' => 'fraunces/fraunces-latin-wght-normal.woff2',
	);
}

/**
 * Work out which bundled fonts the active style uses for body text and headings.
 *
 * Reads the global styles, so it follows the chosen style variation and any edits made in the
 * Site Editor. A variation that uses system fonts (Mono) preloads nothing.
 *
 * @return string[] Font file paths relative to assets/fonts/.
 */
function zzforma_fonts_to_preload() {
	$map    = zzforma_preloadable_fonts();
	$values = array(
		wp_get_global_styles( array( 'typography', 'fontFamily' ) ),
		wp_get_global_styles( array( 'elements', 'heading', 'typography', 'fontFamily' ) ),
	);
	$files  = array();

	foreach ( $values as $value ) {
		// Accepts both "var(--wp--preset--font-family--body)" and "var:preset|font-family|body".
		if ( is_string( $value ) && preg_match( '/font-family(?:--|\|)([a-z0-9-]+)/', $value, $match ) && isset( $map[ $match[1] ] ) ) {
			$files[ $match[1] ] = $map[ $match[1] ];
		}
	}

	return array_values( $files );
}

/**
 * Preload the fonts used above the fold so text renders in its final face without a swap.
 */
function zzforma_preload_fonts() {
	foreach ( zzforma_fonts_to_preload() as $file ) {
		printf(
			'<link rel="preload" href="%s" as="font" type="font/woff2" crossorigin>' . "\n",
			esc_url( ZZFORMA_URI . '/assets/fonts/' . $file )
		);
	}
}

/**
 * Add body classes for theme options.
 *
 * @param string[] $classes Body classes.
 * @return string[]
 */
function zzforma_body_class( $classes ) {
	if ( zzforma_option( 'sticky_header' ) ) {
		$classes[] = 'zzforma-sticky-header';
	}
	return $classes;
}

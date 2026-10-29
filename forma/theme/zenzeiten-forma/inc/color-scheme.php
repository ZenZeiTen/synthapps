<?php
/**
 * Light and dark mode.
 *
 * The palette in theme.json is the light palette. Each style variation also defines a dark
 * palette under settings.custom.dark, which theme.css swaps in when <html> carries
 * data-color-scheme="dark", or "auto" while the visitor's system prefers dark.
 *
 * The attribute is printed on <html> by PHP, so following the system setting needs no JavaScript.
 * With the switch enabled, a few bytes of inline script in <head> apply a saved choice before the
 * first paint, so there is no flash of the wrong palette.
 *
 * @package ZenZeiTen_Forma
 */

defined( 'ABSPATH' ) || exit;

add_filter( 'language_attributes', 'zzforma_color_scheme_attribute', 10, 2 );
add_action( 'wp_head', 'zzforma_color_scheme_script', 0 );
add_action( 'init', 'zzforma_register_color_scheme_toggle' );

/**
 * Add data-color-scheme to the <html> element on the front end.
 *
 * @param string $output  The language attributes.
 * @param string $doctype The doctype ('html' or 'xhtml').
 * @return string
 */
function zzforma_color_scheme_attribute( $output, $doctype = 'html' ) {
	if ( is_admin() || 'html' !== $doctype || 'light' === zzforma_option( 'color_scheme' ) ) {
		return $output;
	}
	return $output . ' data-color-scheme="auto"';
}

/**
 * Apply a saved light/dark choice before the page paints.
 */
function zzforma_color_scheme_script() {
	if ( 'toggle' !== zzforma_option( 'color_scheme' ) ) {
		return;
	}
	$script = 'try{var s=localStorage.getItem("zzforma-color-scheme");if(s==="light"||s==="dark"){document.documentElement.setAttribute("data-color-scheme",s)}}catch(e){}';
	wp_print_inline_script_tag( $script, array( 'id' => 'zzforma-color-scheme' ) );
}

/**
 * Register the light/dark switch block and its front-end script.
 */
function zzforma_register_color_scheme_toggle() {
	wp_register_script(
		'zzforma-color-scheme-toggle',
		ZZFORMA_URI . '/assets/js/color-scheme-toggle.js',
		array(),
		ZZFORMA_VERSION,
		array(
			'in_footer' => true,
			'strategy'  => 'defer',
		)
	);
	register_block_type( ZZFORMA_DIR . '/blocks/color-scheme-toggle' );
}

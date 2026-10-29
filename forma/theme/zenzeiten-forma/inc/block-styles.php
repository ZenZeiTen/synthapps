<?php
/**
 * Extra block styles, picked from the "Styles" panel of a block in the editor.
 * Their CSS lives in assets/css/theme.css (loaded in the editor too).
 *
 * @package ZenZeiTen_Forma
 */

defined( 'ABSPATH' ) || exit;

add_action( 'init', 'zzforma_register_block_styles' );

/**
 * Register the theme's block styles.
 */
function zzforma_register_block_styles() {
	$styles = array(
		'core/group'     => array(
			'zzforma-card'   => __( 'Card', 'zenzeiten-forma' ),
			'zzforma-raised' => __( 'Raised card', 'zenzeiten-forma' ),
		),
		'core/column'    => array(
			'zzforma-card' => __( 'Card', 'zenzeiten-forma' ),
		),
		'core/paragraph' => array(
			'zzforma-eyebrow' => __( 'Eyebrow', 'zenzeiten-forma' ),
			'zzforma-lead'    => __( 'Lead', 'zenzeiten-forma' ),
		),
		'core/list'      => array(
			'zzforma-checklist' => __( 'Checklist', 'zenzeiten-forma' ),
		),
		'core/image'     => array(
			'zzforma-shadow' => __( 'Shadow', 'zenzeiten-forma' ),
		),
		'core/button'    => array(
			'zzforma-link' => __( 'Text link with arrow', 'zenzeiten-forma' ),
		),
		'core/details'   => array(
			'zzforma-faq' => __( 'FAQ', 'zenzeiten-forma' ),
		),
	);

	foreach ( $styles as $block => $variants ) {
		foreach ( $variants as $name => $label ) {
			register_block_style(
				$block,
				array(
					'name'  => $name,
					'label' => $label,
				)
			);
		}
	}
}

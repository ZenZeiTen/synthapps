<?php
/**
 * Extra block styles, picked from the "Styles" panel of a block in the editor.
 * Their CSS lives in assets/css/theme.css (loaded in the editor too).
 *
 * @package Corbelwise
 */

defined( 'ABSPATH' ) || exit;

add_action( 'init', 'corbelwise_register_block_styles' );

/**
 * Register the theme's block styles.
 */
function corbelwise_register_block_styles() {
	$styles = array(
		'core/group'     => array(
			'corbelwise-card'   => __( 'Card', 'corbelwise' ),
			'corbelwise-raised' => __( 'Raised card', 'corbelwise' ),
		),
		'core/column'    => array(
			'corbelwise-card' => __( 'Card', 'corbelwise' ),
		),
		'core/paragraph' => array(
			'corbelwise-eyebrow' => __( 'Eyebrow', 'corbelwise' ),
			'corbelwise-lead'    => __( 'Lead', 'corbelwise' ),
		),
		'core/list'      => array(
			'corbelwise-checklist' => __( 'Checklist', 'corbelwise' ),
		),
		'core/image'     => array(
			'corbelwise-shadow' => __( 'Shadow', 'corbelwise' ),
		),
		'core/button'    => array(
			'corbelwise-link' => __( 'Text link with arrow', 'corbelwise' ),
		),
		'core/details'   => array(
			'corbelwise-faq' => __( 'FAQ', 'corbelwise' ),
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

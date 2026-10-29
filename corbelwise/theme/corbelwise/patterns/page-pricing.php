<?php
/**
 * Title: Pricing page
 * Slug: corbelwise/page-pricing
 * Categories: corbelwise-pages, featured
 * Block Types: core/post-content
 * Post Types: page, wp_template
 * Viewport Width: 1400
 * Description: Pricing plans, a testimonial, questions and a call to action.
 *
 * Built from the section patterns, so a change to a section shows up here too.
 *
 * @package Corbelwise
 */

foreach ( array( 'intro-pricing', 'pricing', 'testimonial-large', 'faq', 'cta-split' ) as $corbelwise_section ) {
	echo corbelwise_pattern_markup( $corbelwise_section ) . "\n\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- block markup, escaped inside each pattern file.
}

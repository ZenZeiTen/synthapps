<?php
/**
 * Title: Contact page
 * Slug: corbelwise/page-contact
 * Categories: corbelwise-pages, featured
 * Block Types: core/post-content
 * Post Types: page, wp_template
 * Viewport Width: 1400
 * Description: Contact details, opening hours and common questions.
 *
 * Built from the section patterns, so a change to a section shows up here too.
 *
 * @package Corbelwise
 */

foreach ( array( 'intro-contact', 'contact-details', 'faq' ) as $corbelwise_section ) {
	echo corbelwise_pattern_markup( $corbelwise_section ) . "\n\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- block markup, escaped inside each pattern file.
}

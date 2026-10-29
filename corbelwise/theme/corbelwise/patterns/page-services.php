<?php
/**
 * Title: Services page
 * Slug: corbelwise/page-services
 * Categories: corbelwise-pages, featured
 * Block Types: core/post-content
 * Post Types: page, wp_template
 * Viewport Width: 1400
 * Description: Services, benefits, the process, questions and a call to action.
 *
 * Built from the section patterns, so a change to a section shows up here too.
 *
 * @package Corbelwise
 */

foreach ( array( 'intro-services', 'services-cards', 'features-grid', 'process-steps', 'faq', 'cta-split' ) as $corbelwise_section ) {
	echo corbelwise_pattern_markup( $corbelwise_section ) . "\n\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- block markup, escaped inside each pattern file.
}

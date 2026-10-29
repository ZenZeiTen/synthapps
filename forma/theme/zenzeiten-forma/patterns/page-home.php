<?php
/**
 * Title: Business home page
 * Slug: zenzeiten-forma/page-home
 * Categories: zzforma-pages, featured
 * Block Types: core/post-content
 * Post Types: page, wp_template
 * Viewport Width: 1400
 * Description: A complete home page: hero, numbers, services, steps, testimonials, questions and a call to action.
 *
 * Built from the section patterns, so a change to a section shows up here too.
 *
 * @package ZenZeiTen_Forma
 */

foreach ( array( 'hero-split', 'stats', 'services-cards', 'process-steps', 'testimonials', 'faq', 'cta-banner' ) as $zzforma_section ) {
	echo zzforma_pattern_markup( $zzforma_section ) . "\n\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- block markup, escaped inside each pattern file.
}

<?php
/**
 * Title: Contact page
 * Slug: zenzeiten-forma/page-contact
 * Categories: zzforma-pages, featured
 * Block Types: core/post-content
 * Post Types: page, wp_template
 * Viewport Width: 1400
 * Description: Contact details, opening hours and common questions.
 *
 * Built from the section patterns, so a change to a section shows up here too.
 *
 * @package ZenZeiTen_Forma
 */

foreach ( array( 'intro-contact', 'contact-details', 'faq' ) as $zzforma_section ) {
	echo zzforma_pattern_markup( $zzforma_section ) . "\n\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- block markup, escaped inside each pattern file.
}

<?php
/**
 * Title: About page
 * Slug: zenzeiten-forma/page-about
 * Categories: zzforma-pages, featured
 * Block Types: core/post-content
 * Post Types: page, wp_template
 * Viewport Width: 1400
 * Description: A company story, key figures, the team and a call to action.
 *
 * Built from the section patterns, so a change to a section shows up here too.
 *
 * @package ZenZeiTen_Forma
 */

foreach ( array( 'intro-about', 'about-split', 'stats', 'team', 'testimonial-large', 'cta-banner' ) as $zzforma_section ) {
	echo zzforma_pattern_markup( $zzforma_section ) . "\n\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- block markup, escaped inside each pattern file.
}

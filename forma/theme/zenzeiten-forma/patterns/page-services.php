<?php
/**
 * Title: Services page
 * Slug: zenzeiten-forma/page-services
 * Categories: zzforma-pages, featured
 * Block Types: core/post-content
 * Post Types: page, wp_template
 * Viewport Width: 1400
 * Description: Services, benefits, the process, questions and a call to action.
 *
 * Built from the section patterns, so a change to a section shows up here too.
 *
 * @package ZenZeiTen_Forma
 */

foreach ( array( 'intro-services', 'services-cards', 'features-grid', 'process-steps', 'faq', 'cta-split' ) as $zzforma_section ) {
	echo zzforma_pattern_markup( $zzforma_section ) . "\n\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- block markup, escaped inside each pattern file.
}

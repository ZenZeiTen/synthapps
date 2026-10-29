<?php
/**
 * Title: Hero: headline with results card
 * Slug: zenzeiten-forma/hero-split
 * Categories: zzforma-hero, featured
 * Keywords: hero, intro, header, banner, welcome
 * Viewport Width: 1400
 * Description: A headline, short introduction and two buttons, next to a card with a figure and a client quote.
 *
 * @package ZenZeiTen_Forma
 */

?>
<!-- wp:group {"align":"full","style":{"spacing":{"padding":{"top":"var:preset|spacing|70","bottom":"var:preset|spacing|70"},"margin":{"top":"0","bottom":"0"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull" style="margin-top:0;margin-bottom:0;padding-top:var(--wp--preset--spacing--70);padding-bottom:var(--wp--preset--spacing--70)"><!-- wp:columns {"verticalAlignment":"center","align":"wide","style":{"spacing":{"blockGap":{"top":"var:preset|spacing|50","left":"var:preset|spacing|70"}}}} -->
<div class="wp-block-columns alignwide are-vertically-aligned-center"><!-- wp:column {"verticalAlignment":"center","width":"56%","style":{"spacing":{"blockGap":"var:preset|spacing|30"}}} -->
<div class="wp-block-column is-vertically-aligned-center" style="flex-basis:56%"><!-- wp:paragraph {"className":"is-style-zzforma-eyebrow"} -->
<p class="is-style-zzforma-eyebrow"><?php esc_html_e( 'Welcome', 'zenzeiten-forma' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":1,"fontSize":"display"} -->
<h1 class="wp-block-heading has-display-font-size"><?php esc_html_e( 'Good work, done with care.', 'zenzeiten-forma' ); ?></h1>
<!-- /wp:heading -->

<!-- wp:paragraph {"className":"is-style-zzforma-lead"} -->
<p class="is-style-zzforma-lead"><?php esc_html_e( 'We help people and businesses get things done properly, from the first conversation to the final detail. Clear advice, fair prices and work you can rely on.', 'zenzeiten-forma' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:buttons {"style":{"spacing":{"margin":{"top":"var:preset|spacing|30"}}}} -->
<div class="wp-block-buttons" style="margin-top:var(--wp--preset--spacing--30)"><!-- wp:button -->
<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="<?php echo esc_url( home_url( '/contact/' ) ); ?>"><?php esc_html_e( 'Get in touch', 'zenzeiten-forma' ); ?></a></div>
<!-- /wp:button -->

<!-- wp:button {"className":"is-style-outline"} -->
<div class="wp-block-button is-style-outline"><a class="wp-block-button__link wp-element-button" href="<?php echo esc_url( home_url( '/services/' ) ); ?>"><?php esc_html_e( 'Our services', 'zenzeiten-forma' ); ?></a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons -->

<!-- wp:paragraph {"textColor":"muted","fontSize":"small"} -->
<p class="has-muted-color has-text-color has-small-font-size"><?php esc_html_e( 'Trusted by more than 200 clients · Rated 4.9 out of 5', 'zenzeiten-forma' ); ?></p>
<!-- /wp:paragraph --></div>
<!-- /wp:column -->

<!-- wp:column {"verticalAlignment":"center","width":"44%"} -->
<div class="wp-block-column is-vertically-aligned-center" style="flex-basis:44%"><!-- wp:group {"className":"is-style-zzforma-raised","style":{"spacing":{"blockGap":"var:preset|spacing|20"}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group is-style-zzforma-raised"><!-- wp:paragraph {"className":"is-style-zzforma-eyebrow"} -->
<p class="is-style-zzforma-eyebrow"><?php esc_html_e( 'Client results', 'zenzeiten-forma' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:paragraph {"className":"zzforma-stat","fontSize":"display"} -->
<p class="zzforma-stat has-display-font-size"><?php esc_html_e( '98%', 'zenzeiten-forma' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:paragraph {"textColor":"muted"} -->
<p class="has-muted-color has-text-color"><?php esc_html_e( 'of clients would recommend us to a friend or colleague.', 'zenzeiten-forma' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:separator -->
<hr class="wp-block-separator has-alpha-channel-opacity"/>
<!-- /wp:separator -->

<!-- wp:paragraph {"fontFamily":"heading","fontSize":"large"} -->
<p class="has-large-font-size has-heading-font-family"><?php esc_html_e( '“They made a complicated project feel simple. Every promise was kept.”', 'zenzeiten-forma' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:paragraph {"textColor":"muted","fontSize":"small"} -->
<p class="has-muted-color has-text-color has-small-font-size"><?php esc_html_e( 'Morgan Lee, operations director', 'zenzeiten-forma' ); ?></p>
<!-- /wp:paragraph --></div>
<!-- /wp:group --></div>
<!-- /wp:column --></div>
<!-- /wp:columns --></div>
<!-- /wp:group -->

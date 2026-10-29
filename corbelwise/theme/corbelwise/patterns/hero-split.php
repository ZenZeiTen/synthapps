<?php
/**
 * Title: Hero: headline with results card
 * Slug: corbelwise/hero-split
 * Categories: corbelwise-hero, featured
 * Keywords: hero, intro, header, banner, welcome
 * Viewport Width: 1400
 * Description: A headline, short introduction and two buttons, next to a card with a figure and a client quote.
 *
 * @package Corbelwise
 */

?>
<!-- wp:group {"align":"full","style":{"spacing":{"padding":{"top":"var:preset|spacing|70","bottom":"var:preset|spacing|70"},"margin":{"top":"0","bottom":"0"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull" style="margin-top:0;margin-bottom:0;padding-top:var(--wp--preset--spacing--70);padding-bottom:var(--wp--preset--spacing--70)"><!-- wp:columns {"verticalAlignment":"center","align":"wide","style":{"spacing":{"blockGap":{"top":"var:preset|spacing|50","left":"var:preset|spacing|70"}}}} -->
<div class="wp-block-columns alignwide are-vertically-aligned-center"><!-- wp:column {"verticalAlignment":"center","width":"56%","style":{"spacing":{"blockGap":"var:preset|spacing|30"}}} -->
<div class="wp-block-column is-vertically-aligned-center" style="flex-basis:56%"><!-- wp:paragraph {"className":"is-style-corbelwise-eyebrow"} -->
<p class="is-style-corbelwise-eyebrow"><?php esc_html_e( 'Welcome', 'corbelwise' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":1,"fontSize":"display"} -->
<h1 class="wp-block-heading has-display-font-size"><?php esc_html_e( 'Good work, done with care.', 'corbelwise' ); ?></h1>
<!-- /wp:heading -->

<!-- wp:paragraph {"className":"is-style-corbelwise-lead"} -->
<p class="is-style-corbelwise-lead"><?php esc_html_e( 'We help people and businesses get things done properly, from the first conversation to the final detail. Clear advice, fair prices and work you can rely on.', 'corbelwise' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:buttons {"style":{"spacing":{"margin":{"top":"var:preset|spacing|30"}}}} -->
<div class="wp-block-buttons" style="margin-top:var(--wp--preset--spacing--30)"><!-- wp:button -->
<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="<?php echo esc_url( home_url( '/contact/' ) ); ?>"><?php esc_html_e( 'Get in touch', 'corbelwise' ); ?></a></div>
<!-- /wp:button -->

<!-- wp:button {"className":"is-style-outline"} -->
<div class="wp-block-button is-style-outline"><a class="wp-block-button__link wp-element-button" href="<?php echo esc_url( home_url( '/services/' ) ); ?>"><?php esc_html_e( 'Our services', 'corbelwise' ); ?></a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons -->

<!-- wp:paragraph {"textColor":"muted","fontSize":"small"} -->
<p class="has-muted-color has-text-color has-small-font-size"><?php esc_html_e( 'Trusted by more than 200 clients · Rated 4.9 out of 5', 'corbelwise' ); ?></p>
<!-- /wp:paragraph --></div>
<!-- /wp:column -->

<!-- wp:column {"verticalAlignment":"center","width":"44%"} -->
<div class="wp-block-column is-vertically-aligned-center" style="flex-basis:44%"><!-- wp:group {"className":"is-style-corbelwise-raised","style":{"spacing":{"blockGap":"var:preset|spacing|20"}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group is-style-corbelwise-raised"><!-- wp:paragraph {"className":"is-style-corbelwise-eyebrow"} -->
<p class="is-style-corbelwise-eyebrow"><?php esc_html_e( 'Client results', 'corbelwise' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:paragraph {"className":"corbelwise-stat","fontSize":"display"} -->
<p class="corbelwise-stat has-display-font-size"><?php esc_html_e( '98%', 'corbelwise' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:paragraph {"textColor":"muted"} -->
<p class="has-muted-color has-text-color"><?php esc_html_e( 'of clients would recommend us to a friend or colleague.', 'corbelwise' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:separator -->
<hr class="wp-block-separator has-alpha-channel-opacity"/>
<!-- /wp:separator -->

<!-- wp:paragraph {"fontFamily":"heading","fontSize":"large"} -->
<p class="has-large-font-size has-heading-font-family"><?php esc_html_e( '“They made a complicated project feel simple. Every promise was kept.”', 'corbelwise' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:paragraph {"textColor":"muted","fontSize":"small"} -->
<p class="has-muted-color has-text-color has-small-font-size"><?php esc_html_e( 'Morgan Lee, operations director', 'corbelwise' ); ?></p>
<!-- /wp:paragraph --></div>
<!-- /wp:group --></div>
<!-- /wp:column --></div>
<!-- /wp:columns --></div>
<!-- /wp:group -->

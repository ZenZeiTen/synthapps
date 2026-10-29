<?php
/**
 * Title: Hero: centred headline
 * Slug: corbelwise/hero-centered
 * Categories: corbelwise-hero, featured
 * Keywords: hero, intro, centred, centered, banner
 * Viewport Width: 1400
 * Description: A large centred headline with an introduction and two buttons.
 *
 * @package Corbelwise
 */

?>
<!-- wp:group {"align":"full","style":{"spacing":{"padding":{"top":"var:preset|spacing|80","bottom":"var:preset|spacing|80"},"margin":{"top":"0","bottom":"0"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull" style="margin-top:0;margin-bottom:0;padding-top:var(--wp--preset--spacing--80);padding-bottom:var(--wp--preset--spacing--80)"><!-- wp:group {"style":{"spacing":{"blockGap":"var:preset|spacing|30"}},"layout":{"type":"constrained","contentSize":"820px"}} -->
<div class="wp-block-group"><!-- wp:paragraph {"className":"is-style-corbelwise-eyebrow","align":"center"} -->
<p class="has-text-align-center is-style-corbelwise-eyebrow"><?php esc_html_e( 'Independent · Experienced · Local', 'corbelwise' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":1,"textAlign":"center","fontSize":"display"} -->
<h1 class="wp-block-heading has-text-align-center has-display-font-size"><?php esc_html_e( 'The partner your business deserves.', 'corbelwise' ); ?></h1>
<!-- /wp:heading -->

<!-- wp:paragraph {"className":"is-style-corbelwise-lead","align":"center"} -->
<p class="has-text-align-center is-style-corbelwise-lead"><?php esc_html_e( 'Practical expertise, honest advice and a team that answers the phone. We take care of the details so you can focus on what you do best.', 'corbelwise' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"},"style":{"spacing":{"margin":{"top":"var:preset|spacing|30"}}}} -->
<div class="wp-block-buttons" style="margin-top:var(--wp--preset--spacing--30)"><!-- wp:button -->
<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="<?php echo esc_url( home_url( '/contact/' ) ); ?>"><?php esc_html_e( 'Book a free consultation', 'corbelwise' ); ?></a></div>
<!-- /wp:button -->

<!-- wp:button {"className":"is-style-outline"} -->
<div class="wp-block-button is-style-outline"><a class="wp-block-button__link wp-element-button" href="<?php echo esc_url( home_url( '/services/' ) ); ?>"><?php esc_html_e( 'See how we work', 'corbelwise' ); ?></a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons --></div>
<!-- /wp:group --></div>
<!-- /wp:group -->

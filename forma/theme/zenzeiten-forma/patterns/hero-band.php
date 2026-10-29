<?php
/**
 * Title: Hero: colour band
 * Slug: zenzeiten-forma/hero-band
 * Categories: zzforma-hero
 * Keywords: hero, banner, colour, color, accent
 * Viewport Width: 1400
 * Description: A full-width band in the accent colour with a headline and one button.
 *
 * @package ZenZeiTen_Forma
 */

?>
<!-- wp:group {"align":"full","style":{"spacing":{"padding":{"top":"var:preset|spacing|80","bottom":"var:preset|spacing|80"},"margin":{"top":"0","bottom":"0"}}},"backgroundColor":"accent","textColor":"on-accent","layout":{"type":"constrained","wideSize":"1200px"}} -->
<div class="wp-block-group alignfull has-on-accent-color has-text-color has-accent-background-color has-background" style="margin-top:0;margin-bottom:0;padding-top:var(--wp--preset--spacing--80);padding-bottom:var(--wp--preset--spacing--80)"><!-- wp:group {"align":"wide","layout":{"type":"default"}} -->
<div class="wp-block-group alignwide"><!-- wp:group {"style":{"spacing":{"blockGap":"var:preset|spacing|30"}},"layout":{"type":"constrained","contentSize":"820px","justifyContent":"left"}} -->
<div class="wp-block-group"><!-- wp:paragraph {"className":"is-style-zzforma-eyebrow","textColor":"on-accent"} -->
<p class="is-style-zzforma-eyebrow has-on-accent-color has-text-color"><?php esc_html_e( 'Now booking for this season', 'zenzeiten-forma' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":1,"fontSize":"display"} -->
<h1 class="wp-block-heading has-display-font-size"><?php esc_html_e( 'Make the next step the easy one.', 'zenzeiten-forma' ); ?></h1>
<!-- /wp:heading -->

<!-- wp:paragraph {"fontSize":"large"} -->
<p class="has-large-font-size"><?php esc_html_e( 'Tell us what you need and get a clear, no-obligation proposal within two working days.', 'zenzeiten-forma' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:buttons {"style":{"spacing":{"margin":{"top":"var:preset|spacing|30"}}}} -->
<div class="wp-block-buttons" style="margin-top:var(--wp--preset--spacing--30)"><!-- wp:button {"backgroundColor":"on-accent","textColor":"accent"} -->
<div class="wp-block-button"><a class="wp-block-button__link has-accent-color has-text-color has-on-accent-background-color has-background wp-element-button" href="<?php echo esc_url( home_url( '/contact/' ) ); ?>"><?php esc_html_e( 'Request a proposal', 'zenzeiten-forma' ); ?></a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons --></div>
<!-- /wp:group --></div>
<!-- /wp:group --></div>
<!-- /wp:group -->

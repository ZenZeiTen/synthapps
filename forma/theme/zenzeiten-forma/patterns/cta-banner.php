<?php
/**
 * Title: Call to action: colour panel
 * Slug: zenzeiten-forma/cta-banner
 * Categories: zzforma-cta, featured
 * Keywords: call to action, cta, contact, banner, sign up
 * Viewport Width: 1400
 * Description: A rounded panel in the accent colour with a headline and one button.
 *
 * @package ZenZeiTen_Forma
 */

?>
<!-- wp:group {"align":"full","style":{"spacing":{"padding":{"top":"var:preset|spacing|60","bottom":"var:preset|spacing|70"},"margin":{"top":"0","bottom":"0"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull" style="margin-top:0;margin-bottom:0;padding-top:var(--wp--preset--spacing--60);padding-bottom:var(--wp--preset--spacing--70)"><!-- wp:group {"align":"wide","backgroundColor":"accent","textColor":"on-accent","style":{"border":{"radius":"1.25rem"},"spacing":{"padding":{"top":"var:preset|spacing|70","right":"var:preset|spacing|50","bottom":"var:preset|spacing|70","left":"var:preset|spacing|50"},"blockGap":"var:preset|spacing|30"}},"layout":{"type":"constrained","contentSize":"720px"}} -->
<div class="wp-block-group alignwide has-on-accent-color has-text-color has-accent-background-color has-background" style="border-radius:1.25rem;padding-top:var(--wp--preset--spacing--70);padding-right:var(--wp--preset--spacing--50);padding-bottom:var(--wp--preset--spacing--70);padding-left:var(--wp--preset--spacing--50)"><!-- wp:heading {"textAlign":"center","fontSize":"xxx-large"} -->
<h2 class="wp-block-heading has-text-align-center has-xxx-large-font-size"><?php esc_html_e( 'Ready when you are.', 'zenzeiten-forma' ); ?></h2>
<!-- /wp:heading -->

<!-- wp:paragraph {"align":"center","fontSize":"large"} -->
<p class="has-text-align-center has-large-font-size"><?php esc_html_e( 'Tell us a little about what you need. We will reply within one working day with honest advice and next steps.', 'zenzeiten-forma' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"},"style":{"spacing":{"margin":{"top":"var:preset|spacing|30"}}}} -->
<div class="wp-block-buttons" style="margin-top:var(--wp--preset--spacing--30)"><!-- wp:button {"backgroundColor":"on-accent","textColor":"accent"} -->
<div class="wp-block-button"><a class="wp-block-button__link has-accent-color has-text-color has-on-accent-background-color has-background wp-element-button" href="<?php echo esc_url( home_url( '/contact/' ) ); ?>"><?php esc_html_e( 'Start the conversation', 'zenzeiten-forma' ); ?></a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons --></div>
<!-- /wp:group --></div>
<!-- /wp:group -->

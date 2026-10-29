<?php
/**
 * Title: About: story and promises
 * Slug: zenzeiten-forma/about-split
 * Categories: zzforma-sections
 * Keywords: about, story, mission, values, checklist
 * Viewport Width: 1400
 * Description: A short company story next to a card with a checklist of promises.
 *
 * @package ZenZeiTen_Forma
 */

?>
<!-- wp:group {"align":"full","style":{"spacing":{"padding":{"top":"var:preset|spacing|70","bottom":"var:preset|spacing|70"},"margin":{"top":"0","bottom":"0"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull" style="margin-top:0;margin-bottom:0;padding-top:var(--wp--preset--spacing--70);padding-bottom:var(--wp--preset--spacing--70)"><!-- wp:columns {"align":"wide","style":{"spacing":{"blockGap":{"top":"var:preset|spacing|50","left":"var:preset|spacing|70"}}}} -->
<div class="wp-block-columns alignwide"><!-- wp:column {"style":{"spacing":{"blockGap":"var:preset|spacing|30"}}} -->
<div class="wp-block-column"><!-- wp:paragraph {"className":"is-style-zzforma-eyebrow"} -->
<p class="is-style-zzforma-eyebrow"><?php esc_html_e( 'Our story', 'zenzeiten-forma' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:heading -->
<h2 class="wp-block-heading"><?php esc_html_e( 'Small enough to care, experienced enough to deliver.', 'zenzeiten-forma' ); ?></h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p><?php esc_html_e( 'We started with a simple idea: treat every client the way we would want to be treated. Today we are a close team of specialists, and that idea still guides every decision we make.', 'zenzeiten-forma' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:paragraph {"textColor":"muted"} -->
<p class="has-muted-color has-text-color"><?php esc_html_e( 'We keep our promises, explain things in plain language and take responsibility for the result.', 'zenzeiten-forma' ); ?></p>
<!-- /wp:paragraph --></div>
<!-- /wp:column -->

<!-- wp:column {"verticalAlignment":"center"} -->
<div class="wp-block-column is-vertically-aligned-center"><!-- wp:group {"className":"is-style-zzforma-card","backgroundColor":"surface","style":{"spacing":{"blockGap":"var:preset|spacing|30"}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group is-style-zzforma-card has-surface-background-color has-background"><!-- wp:heading {"level":3,"fontSize":"large"} -->
<h3 class="wp-block-heading has-large-font-size"><?php esc_html_e( 'What you can expect', 'zenzeiten-forma' ); ?></h3>
<!-- /wp:heading -->

<!-- wp:list {"className":"is-style-zzforma-checklist"} -->
<ul class="is-style-zzforma-checklist"><!-- wp:list-item -->
<li><?php esc_html_e( 'A named contact for every project', 'zenzeiten-forma' ); ?></li>
<!-- /wp:list-item --><!-- wp:list-item -->
<li><?php esc_html_e( 'Written quotes with fixed prices', 'zenzeiten-forma' ); ?></li>
<!-- /wp:list-item --><!-- wp:list-item -->
<li><?php esc_html_e( 'Honest timelines, kept', 'zenzeiten-forma' ); ?></li>
<!-- /wp:list-item --><!-- wp:list-item -->
<li><?php esc_html_e( 'Plain language, no jargon', 'zenzeiten-forma' ); ?></li>
<!-- /wp:list-item --><!-- wp:list-item -->
<li><?php esc_html_e( 'Help after the work is done', 'zenzeiten-forma' ); ?></li>
<!-- /wp:list-item --></ul>
<!-- /wp:list -->

<!-- wp:buttons {"style":{"spacing":{"margin":{"top":"var:preset|spacing|20"}}}} -->
<div class="wp-block-buttons" style="margin-top:var(--wp--preset--spacing--20)"><!-- wp:button -->
<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="<?php echo esc_url( home_url( '/contact/' ) ); ?>"><?php esc_html_e( 'Work with us', 'zenzeiten-forma' ); ?></a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons --></div>
<!-- /wp:group --></div>
<!-- /wp:column --></div>
<!-- /wp:columns --></div>
<!-- /wp:group -->

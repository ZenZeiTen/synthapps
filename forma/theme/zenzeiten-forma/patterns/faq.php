<?php
/**
 * Title: Questions and answers
 * Slug: zenzeiten-forma/faq
 * Categories: zzforma-social, featured
 * Keywords: faq, questions, answers, help, accordion
 * Viewport Width: 1400
 * Description: Five expandable questions next to a short introduction and a button.
 *
 * @package ZenZeiTen_Forma
 */

?>
<!-- wp:group {"align":"full","style":{"spacing":{"padding":{"top":"var:preset|spacing|70","bottom":"var:preset|spacing|70"},"margin":{"top":"0","bottom":"0"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull" style="margin-top:0;margin-bottom:0;padding-top:var(--wp--preset--spacing--70);padding-bottom:var(--wp--preset--spacing--70)"><!-- wp:columns {"align":"wide","style":{"spacing":{"blockGap":{"top":"var:preset|spacing|40","left":"var:preset|spacing|70"}}}} -->
<div class="wp-block-columns alignwide"><!-- wp:column {"width":"40%","style":{"spacing":{"blockGap":"var:preset|spacing|20"}}} -->
<div class="wp-block-column" style="flex-basis:40%"><!-- wp:paragraph {"className":"is-style-zzforma-eyebrow"} -->
<p class="is-style-zzforma-eyebrow"><?php esc_html_e( 'Questions', 'zenzeiten-forma' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:heading -->
<h2 class="wp-block-heading"><?php esc_html_e( 'Frequently asked questions', 'zenzeiten-forma' ); ?></h2>
<!-- /wp:heading -->

<!-- wp:paragraph {"textColor":"muted"} -->
<p class="has-muted-color has-text-color"><?php esc_html_e( 'Cannot find the answer you are looking for? We are happy to help.', 'zenzeiten-forma' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:buttons -->
<div class="wp-block-buttons"><!-- wp:button {"className":"is-style-outline"} -->
<div class="wp-block-button is-style-outline"><a class="wp-block-button__link wp-element-button" href="<?php echo esc_url( home_url( '/contact/' ) ); ?>"><?php esc_html_e( 'Ask a question', 'zenzeiten-forma' ); ?></a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons --></div>
<!-- /wp:column -->

<!-- wp:column {"width":"60%","style":{"spacing":{"blockGap":"0"}}} -->
<div class="wp-block-column" style="flex-basis:60%"><!-- wp:details {"className":"is-style-zzforma-faq"} -->
<details class="wp-block-details is-style-zzforma-faq"><summary><?php esc_html_e( 'How much does it cost?', 'zenzeiten-forma' ); ?></summary><!-- wp:paragraph -->
<p><?php esc_html_e( 'Most projects have a fixed price that we agree in writing before we start. Ongoing support is billed monthly and can be cancelled at any time.', 'zenzeiten-forma' ); ?></p>
<!-- /wp:paragraph --></details>
<!-- /wp:details -->

<!-- wp:details {"className":"is-style-zzforma-faq"} -->
<details class="wp-block-details is-style-zzforma-faq"><summary><?php esc_html_e( 'How quickly can you start?', 'zenzeiten-forma' ); ?></summary><!-- wp:paragraph -->
<p><?php esc_html_e( 'Usually within one to two weeks. For urgent requests, call us and we will do our best to help sooner.', 'zenzeiten-forma' ); ?></p>
<!-- /wp:paragraph --></details>
<!-- /wp:details -->

<!-- wp:details {"className":"is-style-zzforma-faq"} -->
<details class="wp-block-details is-style-zzforma-faq"><summary><?php esc_html_e( 'Do you work with small businesses?', 'zenzeiten-forma' ); ?></summary><!-- wp:paragraph -->
<p><?php esc_html_e( 'Yes. Many of our clients are small and family businesses, and our plans are designed with them in mind.', 'zenzeiten-forma' ); ?></p>
<!-- /wp:paragraph --></details>
<!-- /wp:details -->

<!-- wp:details {"className":"is-style-zzforma-faq"} -->
<details class="wp-block-details is-style-zzforma-faq"><summary><?php esc_html_e( 'Can we meet in person?', 'zenzeiten-forma' ); ?></summary><!-- wp:paragraph -->
<p><?php esc_html_e( 'Of course. We are happy to meet at our office, at your place or online, whichever is easiest for you.', 'zenzeiten-forma' ); ?></p>
<!-- /wp:paragraph --></details>
<!-- /wp:details -->

<!-- wp:details {"className":"is-style-zzforma-faq"} -->
<details class="wp-block-details is-style-zzforma-faq"><summary><?php esc_html_e( 'What happens after the work is done?', 'zenzeiten-forma' ); ?></summary><!-- wp:paragraph -->
<p><?php esc_html_e( 'You keep a named contact. We check in after a few weeks and are always available if something needs attention.', 'zenzeiten-forma' ); ?></p>
<!-- /wp:paragraph --></details>
<!-- /wp:details --></div>
<!-- /wp:column --></div>
<!-- /wp:columns --></div>
<!-- /wp:group -->

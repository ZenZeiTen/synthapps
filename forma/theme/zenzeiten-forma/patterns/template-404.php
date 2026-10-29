<?php
/**
 * Title: Page not found
 * Slug: zenzeiten-forma/template-404
 * Inserter: no
 *
 * @package ZenZeiTen_Forma
 */

?>
<!-- wp:group {"tagName":"main","style":{"spacing":{"margin":{"top":"0","bottom":"0"},"padding":{"top":"var:preset|spacing|80","bottom":"var:preset|spacing|80"}}},"layout":{"type":"constrained"}} -->
<main class="wp-block-group" style="margin-top:0;margin-bottom:0;padding-top:var(--wp--preset--spacing--80);padding-bottom:var(--wp--preset--spacing--80)"><!-- wp:group {"style":{"spacing":{"blockGap":"var:preset|spacing|30"}},"layout":{"type":"constrained","contentSize":"640px","justifyContent":"left"}} -->
<div class="wp-block-group"><!-- wp:paragraph {"className":"is-style-zzforma-eyebrow"} -->
<p class="is-style-zzforma-eyebrow"><?php esc_html_e( '404', 'zenzeiten-forma' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":1} -->
<h1 class="wp-block-heading"><?php esc_html_e( 'This page could not be found.', 'zenzeiten-forma' ); ?></h1>
<!-- /wp:heading -->

<!-- wp:paragraph {"className":"is-style-zzforma-lead"} -->
<p class="is-style-zzforma-lead"><?php esc_html_e( 'The link may be broken or the page may have moved. Try a search, or head back to the home page.', 'zenzeiten-forma' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:search <?php echo wp_json_encode( array( 'label' => __( 'Search', 'zenzeiten-forma' ), 'showLabel' => false, 'placeholder' => __( 'Search…', 'zenzeiten-forma' ), 'width' => 100, 'widthUnit' => '%', 'buttonText' => __( 'Search', 'zenzeiten-forma' ) ) ); ?> /-->

<!-- wp:buttons -->
<div class="wp-block-buttons"><!-- wp:button {"className":"is-style-outline"} -->
<div class="wp-block-button is-style-outline"><a class="wp-block-button__link wp-element-button" href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php esc_html_e( 'Back to the home page', 'zenzeiten-forma' ); ?></a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons --></div>
<!-- /wp:group --></main>
<!-- /wp:group -->

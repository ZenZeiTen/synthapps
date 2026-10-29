<?php
/**
 * Title: Pricing: three plans
 * Slug: corbelwise/pricing
 * Categories: corbelwise-social, featured
 * Keywords: pricing, plans, prices, packages, cost, table
 * Viewport Width: 1400
 * Description: Three pricing plans with features and buttons; the middle plan is highlighted.
 *
 * @package Corbelwise
 */

?>
<!-- wp:group {"align":"full","style":{"spacing":{"padding":{"top":"var:preset|spacing|70","bottom":"var:preset|spacing|70"},"margin":{"top":"0","bottom":"0"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull" style="margin-top:0;margin-bottom:0;padding-top:var(--wp--preset--spacing--70);padding-bottom:var(--wp--preset--spacing--70)"><!-- wp:group {"align":"wide","layout":{"type":"default"}} -->
<div class="wp-block-group alignwide"><!-- wp:group {"style":{"spacing":{"blockGap":"var:preset|spacing|20"}},"layout":{"type":"constrained","contentSize":"640px","justifyContent":"center"}} -->
<div class="wp-block-group"><!-- wp:paragraph {"className":"is-style-corbelwise-eyebrow","align":"center"} -->
<p class="has-text-align-center is-style-corbelwise-eyebrow"><?php esc_html_e( 'Pricing', 'corbelwise' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:heading {"textAlign":"center"} -->
<h2 class="wp-block-heading has-text-align-center"><?php esc_html_e( 'Simple plans, honest prices', 'corbelwise' ); ?></h2>
<!-- /wp:heading -->

<!-- wp:paragraph {"className":"is-style-corbelwise-lead","align":"center"} -->
<p class="has-text-align-center is-style-corbelwise-lead"><?php esc_html_e( 'No set-up fees and no long contracts. Change or cancel your plan at any time.', 'corbelwise' ); ?></p>
<!-- /wp:paragraph --></div>
<!-- /wp:group --></div>
<!-- /wp:group -->

<!-- wp:columns {"align":"wide","style":{"spacing":{"blockGap":{"top":"var:preset|spacing|30","left":"var:preset|spacing|30"}}}} -->
<div class="wp-block-columns alignwide"><!-- wp:column {"className":"is-style-corbelwise-card","style":{"spacing":{"blockGap":"var:preset|spacing|20"}}} -->
<div class="wp-block-column is-style-corbelwise-card"><!-- wp:heading {"level":3,"fontSize":"x-large"} -->
<h3 class="wp-block-heading has-x-large-font-size"><?php esc_html_e( 'Starter', 'corbelwise' ); ?></h3>
<!-- /wp:heading -->

<!-- wp:group {"style":{"spacing":{"blockGap":"0.5rem"}},"layout":{"type":"flex","flexWrap":"nowrap","verticalAlignment":"bottom"}} -->
<div class="wp-block-group"><!-- wp:paragraph {"className":"corbelwise-stat","fontSize":"xxx-large"} -->
<p class="corbelwise-stat has-xxx-large-font-size"><?php esc_html_e( '$49', 'corbelwise' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:paragraph {"textColor":"muted","fontSize":"small"} -->
<p class="has-muted-color has-text-color has-small-font-size"><?php esc_html_e( 'per month', 'corbelwise' ); ?></p>
<!-- /wp:paragraph --></div>
<!-- /wp:group -->

<!-- wp:paragraph {"textColor":"muted"} -->
<p class="has-muted-color has-text-color"><?php esc_html_e( 'For small jobs and first-time clients.', 'corbelwise' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:list {"className":"is-style-corbelwise-checklist"} -->
<ul class="is-style-corbelwise-checklist"><!-- wp:list-item -->
<li><?php esc_html_e( 'One service', 'corbelwise' ); ?></li>
<!-- /wp:list-item --><!-- wp:list-item -->
<li><?php esc_html_e( 'Email support', 'corbelwise' ); ?></li>
<!-- /wp:list-item --><!-- wp:list-item -->
<li><?php esc_html_e( 'Delivery within 10 days', 'corbelwise' ); ?></li>
<!-- /wp:list-item --></ul>
<!-- /wp:list -->

<!-- wp:buttons {"style":{"spacing":{"margin":{"top":"var:preset|spacing|20"}}}} -->
<div class="wp-block-buttons" style="margin-top:var(--wp--preset--spacing--20)"><!-- wp:button {"className":"is-style-outline"} -->
<div class="wp-block-button is-style-outline"><a class="wp-block-button__link wp-element-button" href="<?php echo esc_url( home_url( '/contact/' ) ); ?>"><?php esc_html_e( 'Choose this plan', 'corbelwise' ); ?></a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons --></div>
<!-- /wp:column -->

<!-- wp:column {"className":"is-style-corbelwise-card corbelwise-plan-featured","style":{"spacing":{"blockGap":"var:preset|spacing|20"}}} -->
<div class="wp-block-column is-style-corbelwise-card corbelwise-plan-featured"><!-- wp:paragraph {"className":"is-style-corbelwise-eyebrow"} -->
<p class="is-style-corbelwise-eyebrow"><?php esc_html_e( 'Most popular', 'corbelwise' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":3,"fontSize":"x-large"} -->
<h3 class="wp-block-heading has-x-large-font-size"><?php esc_html_e( 'Professional', 'corbelwise' ); ?></h3>
<!-- /wp:heading -->

<!-- wp:group {"style":{"spacing":{"blockGap":"0.5rem"}},"layout":{"type":"flex","flexWrap":"nowrap","verticalAlignment":"bottom"}} -->
<div class="wp-block-group"><!-- wp:paragraph {"className":"corbelwise-stat","fontSize":"xxx-large"} -->
<p class="corbelwise-stat has-xxx-large-font-size"><?php esc_html_e( '$149', 'corbelwise' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:paragraph {"textColor":"muted","fontSize":"small"} -->
<p class="has-muted-color has-text-color has-small-font-size"><?php esc_html_e( 'per month', 'corbelwise' ); ?></p>
<!-- /wp:paragraph --></div>
<!-- /wp:group -->

<!-- wp:paragraph {"textColor":"muted"} -->
<p class="has-muted-color has-text-color"><?php esc_html_e( 'Our most popular plan for growing businesses.', 'corbelwise' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:list {"className":"is-style-corbelwise-checklist"} -->
<ul class="is-style-corbelwise-checklist"><!-- wp:list-item -->
<li><?php esc_html_e( 'Up to three services', 'corbelwise' ); ?></li>
<!-- /wp:list-item --><!-- wp:list-item -->
<li><?php esc_html_e( 'Phone and email support', 'corbelwise' ); ?></li>
<!-- /wp:list-item --><!-- wp:list-item -->
<li><?php esc_html_e( 'Delivery within 5 days', 'corbelwise' ); ?></li>
<!-- /wp:list-item --><!-- wp:list-item -->
<li><?php esc_html_e( 'Quarterly review', 'corbelwise' ); ?></li>
<!-- /wp:list-item --></ul>
<!-- /wp:list -->

<!-- wp:buttons {"style":{"spacing":{"margin":{"top":"var:preset|spacing|20"}}}} -->
<div class="wp-block-buttons" style="margin-top:var(--wp--preset--spacing--20)"><!-- wp:button -->
<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="<?php echo esc_url( home_url( '/contact/' ) ); ?>"><?php esc_html_e( 'Choose this plan', 'corbelwise' ); ?></a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons --></div>
<!-- /wp:column -->

<!-- wp:column {"className":"is-style-corbelwise-card","style":{"spacing":{"blockGap":"var:preset|spacing|20"}}} -->
<div class="wp-block-column is-style-corbelwise-card"><!-- wp:heading {"level":3,"fontSize":"x-large"} -->
<h3 class="wp-block-heading has-x-large-font-size"><?php esc_html_e( 'Complete', 'corbelwise' ); ?></h3>
<!-- /wp:heading -->

<!-- wp:group {"style":{"spacing":{"blockGap":"0.5rem"}},"layout":{"type":"flex","flexWrap":"nowrap","verticalAlignment":"bottom"}} -->
<div class="wp-block-group"><!-- wp:paragraph {"className":"corbelwise-stat","fontSize":"xxx-large"} -->
<p class="corbelwise-stat has-xxx-large-font-size"><?php esc_html_e( '$399', 'corbelwise' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:paragraph {"textColor":"muted","fontSize":"small"} -->
<p class="has-muted-color has-text-color has-small-font-size"><?php esc_html_e( 'per month', 'corbelwise' ); ?></p>
<!-- /wp:paragraph --></div>
<!-- /wp:group -->

<!-- wp:paragraph {"textColor":"muted"} -->
<p class="has-muted-color has-text-color"><?php esc_html_e( 'Everything included, with priority care.', 'corbelwise' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:list {"className":"is-style-corbelwise-checklist"} -->
<ul class="is-style-corbelwise-checklist"><!-- wp:list-item -->
<li><?php esc_html_e( 'All services', 'corbelwise' ); ?></li>
<!-- /wp:list-item --><!-- wp:list-item -->
<li><?php esc_html_e( 'Dedicated contact', 'corbelwise' ); ?></li>
<!-- /wp:list-item --><!-- wp:list-item -->
<li><?php esc_html_e( 'Delivery within 48 hours', 'corbelwise' ); ?></li>
<!-- /wp:list-item --><!-- wp:list-item -->
<li><?php esc_html_e( 'Monthly review', 'corbelwise' ); ?></li>
<!-- /wp:list-item --></ul>
<!-- /wp:list -->

<!-- wp:buttons {"style":{"spacing":{"margin":{"top":"var:preset|spacing|20"}}}} -->
<div class="wp-block-buttons" style="margin-top:var(--wp--preset--spacing--20)"><!-- wp:button {"className":"is-style-outline"} -->
<div class="wp-block-button is-style-outline"><a class="wp-block-button__link wp-element-button" href="<?php echo esc_url( home_url( '/contact/' ) ); ?>"><?php esc_html_e( 'Choose this plan', 'corbelwise' ); ?></a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons --></div>
<!-- /wp:column --></div>
<!-- /wp:columns --></div>
<!-- /wp:group -->

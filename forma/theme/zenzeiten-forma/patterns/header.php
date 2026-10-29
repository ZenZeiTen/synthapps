<?php
/**
 * Title: Header
 * Slug: zenzeiten-forma/header
 * Inserter: no
 * Block Types: core/template-part/header
 *
 * @package ZenZeiTen_Forma
 */

?>
<!-- wp:group {"className":"zzforma-header","style":{"spacing":{"padding":{"top":"var:preset|spacing|20","bottom":"var:preset|spacing|20"}},"border":{"bottom":{"color":"var:preset|color|border","style":"solid","width":"1px"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group zzforma-header" style="border-bottom-color:var(--wp--preset--color--border);border-bottom-style:solid;border-bottom-width:1px;padding-top:var(--wp--preset--spacing--20);padding-bottom:var(--wp--preset--spacing--20)"><!-- wp:group {"align":"wide","layout":{"type":"flex","flexWrap":"nowrap","justifyContent":"space-between"}} -->
<div class="wp-block-group alignwide"><!-- wp:group {"style":{"spacing":{"blockGap":"0.75rem"}},"layout":{"type":"flex","flexWrap":"nowrap"}} -->
<div class="wp-block-group"><!-- wp:site-logo {"width":36,"shouldSyncIcon":false} /-->

<!-- wp:site-title {"level":0} /--></div>
<!-- /wp:group -->

<!-- wp:group {"style":{"spacing":{"blockGap":"var:preset|spacing|30"}},"layout":{"type":"flex","flexWrap":"nowrap","justifyContent":"right"}} -->
<div class="wp-block-group"><!-- wp:navigation {"overlayBackgroundColor":"base","overlayTextColor":"contrast","layout":{"type":"flex","justifyContent":"right"}} -->
<!-- wp:navigation-link <?php echo wp_json_encode( array( 'label' => __( 'About', 'zenzeiten-forma' ), 'url' => home_url( '/about/' ), 'kind' => 'custom', 'isTopLevelLink' => true ) ); ?> /-->

<!-- wp:navigation-link <?php echo wp_json_encode( array( 'label' => __( 'Services', 'zenzeiten-forma' ), 'url' => home_url( '/services/' ), 'kind' => 'custom', 'isTopLevelLink' => true ) ); ?> /-->

<!-- wp:navigation-link <?php echo wp_json_encode( array( 'label' => __( 'Pricing', 'zenzeiten-forma' ), 'url' => home_url( '/pricing/' ), 'kind' => 'custom', 'isTopLevelLink' => true ) ); ?> /-->

<!-- wp:navigation-link <?php echo wp_json_encode( array( 'label' => __( 'Contact', 'zenzeiten-forma' ), 'url' => home_url( '/contact/' ), 'kind' => 'custom', 'isTopLevelLink' => true ) ); ?> /-->
<!-- /wp:navigation -->

<!-- wp:zenzeiten-forma/color-scheme-toggle /-->

<!-- wp:buttons -->
<div class="wp-block-buttons"><!-- wp:button {"className":"zzforma-header-cta"} -->
<div class="wp-block-button zzforma-header-cta"><a class="wp-block-button__link wp-element-button" href="<?php echo esc_url( home_url( '/contact/' ) ); ?>"><?php esc_html_e( 'Get in touch', 'zenzeiten-forma' ); ?></a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons --></div>
<!-- /wp:group --></div>
<!-- /wp:group --></div>
<!-- /wp:group -->

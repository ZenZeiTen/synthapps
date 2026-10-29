<?php
/**
 * Title: Footer (minimal)
 * Slug: corbelwise/footer-minimal
 * Inserter: no
 * Block Types: core/template-part/footer
 *
 * @package Corbelwise
 */

?>
<!-- wp:group {"align":"full","style":{"spacing":{"padding":{"top":"var:preset|spacing|40","bottom":"var:preset|spacing|40"},"margin":{"top":"0"}},"border":{"top":{"color":"var:preset|color|border","style":"solid","width":"1px"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull" style="border-top-color:var(--wp--preset--color--border);border-top-style:solid;border-top-width:1px;margin-top:0;padding-top:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--40)"><!-- wp:group {"align":"wide","layout":{"type":"flex","justifyContent":"center"}} -->
<div class="wp-block-group alignwide"><!-- wp:paragraph {"textColor":"muted","fontSize":"x-small"} -->
<p class="has-muted-color has-text-color has-x-small-font-size"><?php echo esc_html( sprintf( /* translators: 1: year, 2: site name. */ __( '© %1$s %2$s. All rights reserved.', 'corbelwise' ), gmdate( 'Y' ), get_bloginfo( 'name' ) ) ); ?></p>
<!-- /wp:paragraph --></div>
<!-- /wp:group --></div>
<!-- /wp:group -->

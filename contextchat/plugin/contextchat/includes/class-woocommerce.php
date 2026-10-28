<?php
/**
 * WooCommerce: an "Ask about this product" button that sends the product name, price and link.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * WooCommerce integration.
 */
class ContextChat_WooCommerce {

	/**
	 * Hooks. Does nothing when WooCommerce is not active.
	 */
	public static function init() {
		if ( ! class_exists( 'WooCommerce' ) ) {
			return;
		}
		add_action( 'woocommerce_after_add_to_cart_form', array( __CLASS__, 'product_button' ), 15 );
	}

	/**
	 * Print the product button.
	 */
	public static function product_button() {
		$s = ContextChat_Settings::get();
		if ( empty( $s['woo_button'] ) || ! is_singular( 'product' ) ) {
			return;
		}
		if ( get_post_meta( get_queried_object_id(), '_contextchat_hide', true ) ) {
			return;
		}

		echo '<div class="ctxc-product">';
		echo ContextChat_Frontend::shortcode( // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped inside.
			array(
				'text'   => '' !== $s['woo_button_text'] ? $s['woo_button_text'] : __( 'Ask about this product', 'contextchat' ),
				'source' => 'product',
			)
		);
		echo '</div>';
	}
}

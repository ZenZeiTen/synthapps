<?php
/**
 * Plugin Name: Fake WooCommerce (ContextChat tests only)
 * Description: The handful of WooCommerce functions ContextChat uses, so the product button can be tested without WooCommerce itself. Never install this on a real site.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

// phpcs:disable Generic.Files.OneObjectStructurePerFile

/** Presence marker checked by ContextChat. */
class WooCommerce {}

/** Minimal product. */
class Fake_WC_Product {
	/** @var WP_Post */
	private $post;

	public function __construct( WP_Post $post ) {
		$this->post = $post;
	}
	public function get_id() {
		return $this->post->ID;
	}
	public function get_name() {
		return get_the_title( $this->post );
	}
	public function get_sku() {
		return (string) get_post_meta( $this->post->ID, '_sku', true );
	}
	public function get_price() {
		return (string) get_post_meta( $this->post->ID, '_price', true );
	}
	public function is_type( $type ) {
		return 'simple' === $type;
	}
	public function is_in_stock() {
		return 'outofstock' !== get_post_meta( $this->post->ID, '_stock_status', true );
	}
}

add_action(
	'init',
	static function () {
		register_post_type(
			'product',
			array(
				'public'      => true,
				'label'       => 'Products',
				'labels'      => array( 'singular_name' => 'Product' ),
				'has_archive' => true,
				'rewrite'     => array( 'slug' => 'product' ),
			)
		);
		register_taxonomy( 'product_cat', 'product', array( 'public' => true, 'label' => 'Product categories', 'rewrite' => array( 'slug' => 'product-category' ) ) );
	}
);

function wc_get_product( $id ) {
	$post = get_post( $id );
	return $post && 'product' === $post->post_type ? new Fake_WC_Product( $post ) : null;
}

function wc_price( $price ) {
	return '<span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol">Rp</span>' . number_format( (float) $price, 0, ',', '.' ) . '</bdi></span>';
}

function wc_get_price_to_display( $product ) {
	return $product->get_price();
}

// Stand-in for the single product template: a cart form followed by WooCommerce's hook.
add_filter(
	'the_content',
	static function ( $content ) {
		static $done = false;
		if ( $done || ! is_singular( 'product' ) ) {
			return $content;
		}
		$done = true;
		ob_start();
		echo '<form class="cart"><button type="button">Add to cart</button></form>';
		do_action( 'woocommerce_after_add_to_cart_form' );
		return $content . ob_get_clean();
	}
);

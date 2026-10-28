<?php
/**
 * Page context: what the visitor is looking at, which rule applies and who should answer.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Context resolver.
 */
class ContextChat_Context {

	/** Tracking parameters removed from {page_url} so the shared address stays clean. */
	const TRACKING_PARAMS = array( 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'msclkid', 'ttclid' );

	/**
	 * Facts about the current request that rules are matched against.
	 *
	 * @return array
	 */
	public static function env() {
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : '/'; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- only compared, never output.
		$id   = (int) get_queried_object_id();
		$env  = array(
			'path'             => strtolower( rawurldecode( (string) $uri ) ),
			'id'               => $id,
			'slug'             => '',
			'post_type'        => '',
			'categories'       => array(),
			'product_category' => array(),
			'product'          => false,
			'front_page'       => is_front_page(),
			'search'           => is_search(),
		);

		if ( is_singular() ) {
			$post             = get_post( $id );
			$env['slug']      = $post ? $post->post_name : '';
			$env['post_type'] = (string) get_post_type( $id );
			if ( 'post' === $env['post_type'] ) {
				$env['categories'] = self::term_slugs( $id, 'category' );
			}
			if ( 'product' === $env['post_type'] ) {
				$env['product']          = true;
				$env['product_category'] = self::term_slugs( $id, 'product_cat' );
			}
		} elseif ( is_post_type_archive() ) {
			$type             = get_query_var( 'post_type' );
			$env['post_type'] = is_array( $type ) ? (string) reset( $type ) : (string) $type;
		} elseif ( is_category() || is_tax( 'product_cat' ) ) {
			$term = get_queried_object();
			if ( $term instanceof WP_Term ) {
				$key           = 'category' === $term->taxonomy ? 'categories' : 'product_category';
				$env[ $key ]   = array( $term->slug );
				$env['slug']   = $term->slug;
			}
		}

		return $env;
	}

	/**
	 * Does a rule apply to a request? Values may be comma-separated; any match counts.
	 *
	 * @param array $rule Sanitised rule.
	 * @param array $env  Output of env().
	 * @return bool
	 */
	public static function rule_matches( array $rule, array $env ) {
		$values = array_values( array_filter( array_map( 'trim', explode( ',', strtolower( (string) $rule['value'] ) ) ), 'strlen' ) );

		switch ( $rule['type'] ) {
			case 'url_contains':
				foreach ( $values as $v ) {
					if ( false !== strpos( $env['path'], $v ) ) {
						return true;
					}
				}
				return false;
			case 'page':
				return in_array( (string) $env['id'], $values, true ) || ( '' !== $env['slug'] && in_array( $env['slug'], $values, true ) );
			case 'post_type':
				return '' !== $env['post_type'] && in_array( strtolower( $env['post_type'] ), $values, true );
			case 'category':
				return (bool) array_intersect( $env['categories'], $values );
			case 'product_category':
				return (bool) array_intersect( $env['product_category'], $values );
			case 'product':
				return ! empty( $env['product'] );
			case 'front_page':
				return ! empty( $env['front_page'] );
			case 'search':
				return ! empty( $env['search'] );
		}
		return false;
	}

	/**
	 * First rule that applies, or null.
	 *
	 * @param array $rules Rules in priority order.
	 * @param array $env   Output of env().
	 * @return array|null
	 */
	public static function first_match( array $rules, array $env ) {
		foreach ( $rules as $rule ) {
			if ( self::rule_matches( $rule, $env ) ) {
				return $rule;
			}
		}
		return null;
	}

	/**
	 * Placeholder values known on the server. Browser-only values (campaign, referrer, time)
	 * are added by the script.
	 *
	 * @param WC_Product|null $product Product to describe, if any.
	 * @return array
	 */
	public static function vars( $product = null ) {
		$vars = array(
			'site_name'    => self::plain( get_bloginfo( 'name' ) ),
			'page_title'   => self::page_title(),
			'page_url'     => self::page_url(),
			'post_type'    => '',
			'category'     => '',
			'search_query' => is_search() ? self::plain( get_search_query( false ) ) : '',
		);

		if ( is_singular() ) {
			$type_obj          = get_post_type_object( (string) get_post_type() );
			$vars['post_type'] = $type_obj ? self::plain( $type_obj->labels->singular_name ) : '';
			$taxonomy          = 'product' === get_post_type() ? 'product_cat' : 'category';
			$terms             = get_the_terms( get_queried_object_id(), $taxonomy );
			if ( is_array( $terms ) && $terms ) {
				$vars['category'] = self::plain( $terms[0]->name );
			}
		} elseif ( is_category() || is_tag() || is_tax() ) {
			$vars['category'] = self::plain( single_term_title( '', false ) );
		}

		if ( ! $product && function_exists( 'wc_get_product' ) && is_singular( 'product' ) ) {
			$product = wc_get_product( get_queried_object_id() );
		}
		if ( $product && is_object( $product ) && method_exists( $product, 'get_name' ) ) {
			$vars = array_merge( $vars, self::product_vars( $product ) );
		}

		/**
		 * Filter the placeholder values for this page. Add your own keys to use them as {key}.
		 *
		 * @param array           $vars    Placeholder values.
		 * @param WC_Product|null $product Product being described, if any.
		 */
		return (array) apply_filters( 'contextchat_context', $vars, $product );
	}

	/**
	 * Product placeholders.
	 *
	 * @param WC_Product $product Product.
	 * @return array
	 */
	public static function product_vars( $product ) {
		$price = '';
		if ( function_exists( 'wc_price' ) ) {
			if ( $product->is_type( 'variable' ) ) {
				$min   = $product->get_variation_price( 'min', true );
				$max   = $product->get_variation_price( 'max', true );
				$price = '' === (string) $min ? '' : ( $min === $max ? wc_price( $min ) : wc_price( $min ) . ' – ' . wc_price( $max ) );
			} elseif ( '' !== (string) $product->get_price() ) {
				$price = wc_price( wc_get_price_to_display( $product ) );
			}
		}

		return array(
			'product_name'  => self::plain( $product->get_name() ),
			'product_price' => self::plain( $price ),
			'product_sku'   => self::plain( $product->get_sku() ),
			'product_stock' => $product->is_in_stock() ? __( 'In stock', 'contextchat' ) : __( 'Out of stock', 'contextchat' ),
			'page_url'      => (string) get_permalink( $product->get_id() ),
		);
	}

	/**
	 * Work out the message template and agents for a button.
	 *
	 * Priority: a message set on the post itself, then the first matching rule, then the
	 * default (or the product default for product buttons).
	 *
	 * @param string $source Where the button is: float, shortcode, product, block.
	 * @return array{template: string, agents: array, rule: string}
	 */
	public static function resolve( $source = 'float' ) {
		$s     = ContextChat_Settings::get();
		$rule  = self::first_match( $s['rules'], self::env() );
		$meta  = is_singular() ? (string) get_post_meta( get_queried_object_id(), '_contextchat_message', true ) : '';
		$fallback = 'product' === $source ? $s['woo_message'] : $s['default_message'];

		if ( '' !== trim( $meta ) ) {
			$template = $meta;
		} elseif ( $rule && '' !== $rule['message'] ) {
			$template = $rule['message'];
		} else {
			$template = $fallback;
		}

		$agents = self::agents( $rule ? $rule['agents'] : array() );

		/**
		 * Filter the message template before placeholders are filled.
		 *
		 * @param string     $template Template.
		 * @param string     $source   Button location.
		 * @param array|null $rule     Matching rule.
		 */
		$template = (string) apply_filters( 'contextchat_message', $template, $source, $rule );

		return array(
			'template' => $template,
			'agents'   => $agents,
			'rule'     => $rule ? $rule['id'] : '',
		);
	}

	/**
	 * Agents to offer. Limited to the given IDs when there are any; falls back to the main
	 * number when no agents are set up.
	 *
	 * @param array $only IDs to keep.
	 * @return array
	 */
	public static function agents( array $only = array() ) {
		$s      = ContextChat_Settings::get();
		$agents = array_values(
			array_filter(
				$s['agents'],
				static function ( $a ) use ( $only ) {
					return empty( $a['disabled'] ) && ( ! $only || in_array( $a['id'], $only, true ) );
				}
			)
		);

		// A rule whose agents are all paused falls back to everyone else, never to nobody.
		if ( ! $agents && $only ) {
			return self::agents();
		}

		if ( ! $agents && '' !== $s['phone'] ) {
			$agents[] = array(
				'id'       => 'main',
				'name'     => self::plain( get_bloginfo( 'name' ) ),
				'role'     => $s['header_subtitle'],
				'phone'    => $s['phone'],
				'avatar'   => '',
				'always'   => false,
				'disabled' => false,
			);
		}

		/**
		 * Filter the agents offered on this page.
		 *
		 * @param array $agents Agents.
		 */
		return (array) apply_filters( 'contextchat_agents', $agents );
	}

	/**
	 * Title of what the visitor is looking at.
	 *
	 * @return string
	 */
	private static function page_title() {
		if ( is_front_page() || ( is_home() && ! get_queried_object_id() ) ) {
			return self::plain( get_bloginfo( 'name' ) );
		}
		if ( is_singular() || is_home() ) {
			return self::plain( get_the_title( get_queried_object_id() ) );
		}
		if ( is_search() ) {
			/* translators: %s: search terms. */
			return sprintf( __( 'Search results for "%s"', 'contextchat' ), self::plain( get_search_query( false ) ) );
		}
		if ( is_archive() ) {
			return self::plain( get_the_archive_title() );
		}
		return self::plain( wp_get_document_title() );
	}

	/**
	 * Address of the current page without tracking parameters.
	 *
	 * @return string
	 */
	private static function page_url() {
		if ( is_singular() ) {
			return (string) get_permalink( get_queried_object_id() );
		}
		// Scheme and host come from the site address, never from the request headers.
		$home = wp_parse_url( home_url( '/' ) );
		$base = $home['scheme'] . '://' . $home['host'] . ( isset( $home['port'] ) ? ':' . $home['port'] : '' );
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : '/'; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- escaped below.
		return esc_url_raw( remove_query_arg( self::TRACKING_PARAMS, $base . '/' . ltrim( (string) $uri, '/' ) ) );
	}

	/**
	 * Slugs of a post's terms.
	 *
	 * @param int    $id       Post ID.
	 * @param string $taxonomy Taxonomy.
	 * @return string[]
	 */
	private static function term_slugs( $id, $taxonomy ) {
		$terms = get_the_terms( $id, $taxonomy );
		return is_array( $terms ) ? array_map( 'strtolower', wp_list_pluck( $terms, 'slug' ) ) : array();
	}

	/**
	 * HTML to plain text for a chat message.
	 *
	 * @param string $html HTML or text.
	 * @return string
	 */
	public static function plain( $html ) {
		$text = html_entity_decode( wp_strip_all_tags( (string) $html ), ENT_QUOTES | ENT_HTML5, 'UTF-8' );
		return trim( preg_replace( '/\s+/u', ' ', str_replace( "\xc2\xa0", ' ', $text ) ) );
	}
}

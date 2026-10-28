<?php
/**
 * Message templates, phone numbers and chat links.
 *
 * Everything here is pure PHP with no WordPress calls, so it can be unit tested on its own.
 * The browser script (assets/js/contextchat.js) implements the same template rules; both are
 * checked against tests/fixtures/templates.json so the server fallback link and the live link
 * always produce the same text.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Template and link helpers.
 */
class ContextChat_Template {

	/** Longest message we put in a link. WhatsApp accepts more, but long URLs break on some phones. */
	const MAX_LENGTH = 1500;

	/**
	 * Fill `{placeholder}` and `{placeholder|fallback}` tokens, then tidy what is left.
	 *
	 * Unknown or empty placeholders become their fallback, or nothing. The tidy step removes the
	 * traces an empty value leaves behind, such as `()`, `""` and a space before a comma.
	 *
	 * @param string $template Message template.
	 * @param array  $vars     Placeholder values keyed by name.
	 * @return string
	 */
	public static function render( $template, array $vars ) {
		$text = preg_replace_callback(
			'/\{([a-z0-9_]+)(?:\|([^{}]*))?\}/i',
			static function ( $m ) use ( $vars ) {
				$key   = strtolower( $m[1] );
				$value = isset( $vars[ $key ] ) ? trim( (string) $vars[ $key ] ) : '';
				if ( '' === $value && isset( $m[2] ) ) {
					$value = trim( $m[2] );
				}
				return $value;
			},
			(string) $template
		);

		return self::tidy( $text );
	}

	/**
	 * Remove the leftovers of empty placeholders and normalise whitespace. Newlines are kept.
	 *
	 * @param string $text Rendered text.
	 * @return string
	 */
	public static function tidy( $text ) {
		$text = str_replace( array( "\r\n", "\r" ), "\n", (string) $text );
		$text = preg_replace( '/\(\s*\)|\[\s*\]|"\s*"|“\s*”/u', '', $text );
		$text = preg_replace( '/[ \t]+/', ' ', $text );
		$text = preg_replace( '/ +([,.!?;:])/', '$1', $text );
		$text = preg_replace( '/([,;:])(?=[,;:.!?])/', '', $text );
		$text = preg_replace( '/^ +| +$/m', '', $text );
		$text = preg_replace( '/\n{3,}/', "\n\n", $text );
		$text = trim( $text );

		if ( self::length( $text ) > self::MAX_LENGTH ) {
			$text = rtrim( self::substr( $text, 0, self::MAX_LENGTH - 1 ) ) . '…';
		}

		return $text;
	}

	/**
	 * Turn what a site owner typed into international digits, as WhatsApp links need.
	 *
	 * "+62 812-3456-7890", "0062 812 3456 7890" and, with country code 62, "0812 3456 7890"
	 * all become "6281234567890". Returns '' when the result cannot be a phone number.
	 *
	 * @param string $raw          Number as typed.
	 * @param string $country_code Digits to put in place of a leading national 0, e.g. "62".
	 * @return string
	 */
	public static function normalize_phone( $raw, $country_code = '' ) {
		// "+44 (0)20 …": the bracketed 0 is dialled only inside the country.
		$raw      = str_replace( '(0)', '', trim( (string) $raw ) );
		$has_plus = 0 === strpos( $raw, '+' );
		$digits   = preg_replace( '/\D+/', '', $raw );
		$country  = preg_replace( '/\D+/', '', (string) $country_code );

		if ( '' === $digits ) {
			return '';
		}
		if ( ! $has_plus && 0 === strpos( $digits, '00' ) ) {
			$digits = substr( $digits, 2 );
		} elseif ( ! $has_plus && '' !== $country && 0 === strpos( $digits, '0' ) ) {
			$digits = $country . ltrim( $digits, '0' );
		}

		$len = strlen( $digits );
		if ( $len < 7 || $len > 15 || 0 === strpos( $digits, '0' ) ) {
			return '';
		}

		return $digits;
	}

	/**
	 * Build a chat link. Phones and the WhatsApp app use wa.me; desktop browsers can go
	 * straight to WhatsApp Web.
	 *
	 * @param string $phone   International digits.
	 * @param string $message Pre-filled message.
	 * @param bool   $web     Use WhatsApp Web instead of wa.me.
	 * @return string
	 */
	public static function link( $phone, $message, $web = false ) {
		$text = '' === $message ? '' : rawurlencode( $message );

		if ( $web ) {
			return 'https://web.whatsapp.com/send?phone=' . $phone . ( '' === $text ? '' : '&text=' . $text );
		}

		return 'https://wa.me/' . $phone . ( '' === $text ? '' : '?text=' . $text );
	}

	/**
	 * Placeholders a site owner can use, with an example value for the settings preview.
	 *
	 * @return array<string, array{label: string, sample: string, scope: string}>
	 */
	public static function placeholders() {
		return array(
			'page_title'    => array( 'label' => 'Page title', 'sample' => 'Sworn Translation for Visa', 'scope' => 'page' ),
			'page_url'      => array( 'label' => 'Page address', 'sample' => 'https://example.com/visa-translation/', 'scope' => 'page' ),
			'site_name'     => array( 'label' => 'Site name', 'sample' => 'Example Co', 'scope' => 'page' ),
			'post_type'     => array( 'label' => 'Content type', 'sample' => 'Page', 'scope' => 'page' ),
			'category'      => array( 'label' => 'Category', 'sample' => 'Legal documents', 'scope' => 'page' ),
			'search_query'  => array( 'label' => 'Search terms', 'sample' => 'birth certificate', 'scope' => 'page' ),
			'product_name'  => array( 'label' => 'Product name', 'sample' => 'Certified Translation – 1 page', 'scope' => 'product' ),
			'product_price' => array( 'label' => 'Product price', 'sample' => 'Rp150.000', 'scope' => 'product' ),
			'product_sku'   => array( 'label' => 'Product SKU', 'sample' => 'TR-001', 'scope' => 'product' ),
			'product_stock' => array( 'label' => 'Stock status', 'sample' => 'In stock', 'scope' => 'product' ),
			'agent_name'    => array( 'label' => 'Agent name', 'sample' => 'Rina', 'scope' => 'visit' ),
			'utm_source'    => array( 'label' => 'Campaign source', 'sample' => 'instagram', 'scope' => 'visit' ),
			'utm_medium'    => array( 'label' => 'Campaign medium', 'sample' => 'social', 'scope' => 'visit' ),
			'utm_campaign'  => array( 'label' => 'Campaign name', 'sample' => 'visa-season', 'scope' => 'visit' ),
			'referrer'      => array( 'label' => 'Referring site', 'sample' => 'google.com', 'scope' => 'visit' ),
			'date'          => array( 'label' => 'Visitor date', 'sample' => '28/10/2026', 'scope' => 'visit' ),
			'time'          => array( 'label' => 'Visitor time', 'sample' => '14:05', 'scope' => 'visit' ),
		);
	}

	/**
	 * Multibyte-safe length.
	 *
	 * @param string $text Text.
	 * @return int
	 */
	private static function length( $text ) {
		return function_exists( 'mb_strlen' ) ? mb_strlen( $text, 'UTF-8' ) : strlen( $text );
	}

	/**
	 * Multibyte-safe substring.
	 *
	 * @param string $text   Text.
	 * @param int    $start  Start.
	 * @param int    $length Length.
	 * @return string
	 */
	private static function substr( $text, $start, $length ) {
		return function_exists( 'mb_substr' ) ? mb_substr( $text, $start, $length, 'UTF-8' ) : substr( $text, $start, $length );
	}
}

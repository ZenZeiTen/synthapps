<?php
/**
 * The current request: client address and the details logged with an event.
 *
 * @package ZenZeiTenBastion
 */

namespace ZenZeiTenBastion;

defined( 'ABSPATH' ) || exit;

/**
 * Per-request values, worked out once.
 */
final class Request {

	/**
	 * Cached client address.
	 *
	 * @var string|null
	 */
	private static $ip = null;

	/**
	 * Client address, honouring a proxy header only from trusted proxies.
	 *
	 * @return string
	 */
	public static function ip() {
		if ( null === self::$ip ) {
			$server   = isset( $_SERVER ) && is_array( $_SERVER ) ? $_SERVER : array(); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- read through IP::resolve(), which validates.
			self::$ip = IP::resolve( $server, Settings::trusted_proxies(), Settings::proxy_header() );
		}
		return self::$ip;
	}

	/**
	 * Forget cached values (between tests, and after settings change).
	 */
	public static function reset() {
		self::$ip = null;
	}

	/**
	 * Request method.
	 *
	 * @return string
	 */
	public static function method() {
		return isset( $_SERVER['REQUEST_METHOD'] ) ? strtoupper( substr( sanitize_key( wp_unslash( $_SERVER['REQUEST_METHOD'] ) ), 0, 10 ) ) : 'GET'; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- sanitize_key.
	}

	/**
	 * Request URI as sent, cut to a loggable length.
	 *
	 * @return string
	 */
	public static function uri() {
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '/'; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- logged as text and escaped on output.
		return self::clip( $uri, 255 );
	}

	/**
	 * User agent, cut to a loggable length.
	 *
	 * @return string
	 */
	public static function user_agent() {
		$ua = isset( $_SERVER['HTTP_USER_AGENT'] ) ? (string) wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- logged as text and escaped on output.
		return self::clip( $ua, 255 );
	}

	/**
	 * Cut a string to a byte length without splitting a UTF-8 character, and drop control characters.
	 *
	 * @param string $text  Text.
	 * @param int    $bytes Maximum length.
	 * @return string
	 */
	public static function clip( $text, $bytes ) {
		$text = preg_replace( '/[\x00-\x1F\x7F]/', '', (string) $text );
		if ( strlen( $text ) <= $bytes ) {
			return $text;
		}
		return function_exists( 'mb_strcut' ) ? mb_strcut( $text, 0, $bytes, 'UTF-8' ) : substr( $text, 0, $bytes );
	}
}

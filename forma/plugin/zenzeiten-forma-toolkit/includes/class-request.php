<?php
/**
 * Helpers for facts about the current request.
 *
 * @package ZenZeiTen\FormaToolkit
 */

namespace ZenZeiTen\FormaToolkit;

defined( 'ABSPATH' ) || exit;

/**
 * Request helpers.
 */
class Request {

	/**
	 * The visitor's IP address.
	 *
	 * Only REMOTE_ADDR is trusted by default, because forwarded-for headers can be set by anyone.
	 * Sites behind a proxy or CDN should return the real client address through the
	 * zzft_client_ip filter, reading the header their proxy sets, and only when the request came
	 * from that proxy.
	 *
	 * @return string IP address, or an empty string.
	 */
	public static function ip() {
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';

		/**
		 * Filters the visitor IP address used for rate limits and login protection.
		 *
		 * @param string $ip The address from REMOTE_ADDR.
		 */
		$ip = (string) apply_filters( 'zzft_client_ip', $ip );
		return filter_var( $ip, FILTER_VALIDATE_IP ) ? $ip : '';
	}

	/**
	 * A short, salted hash of the visitor's IP, so stored counters never hold the address itself.
	 *
	 * @return string
	 */
	public static function ip_key() {
		return substr( hash_hmac( 'sha256', self::ip(), wp_salt( 'nonce' ) ), 0, 20 );
	}

	/**
	 * Whether a URL points at this site.
	 *
	 * @param string $url URL.
	 * @return bool
	 */
	public static function is_own_url( $url ) {
		$host = wp_parse_url( (string) $url, PHP_URL_HOST );
		$home = wp_parse_url( home_url(), PHP_URL_HOST );
		return is_string( $host ) && is_string( $home ) && strtolower( $host ) === strtolower( $home );
	}

	/**
	 * Count an event against a limit in a time window. Returns false once the limit is reached.
	 *
	 * @param string $bucket Name of the counter, including whatever identifies the client.
	 * @param int    $limit  Allowed events per window.
	 * @param int    $window Window length in seconds.
	 * @return bool True if this event is allowed.
	 */
	public static function allow( $bucket, $limit, $window ) {
		if ( $limit <= 0 ) {
			return true;
		}
		$key   = 'zzft_rl_' . md5( $bucket );
		$state = get_transient( $key );
		$now   = time();
		if ( ! is_array( $state ) || ! isset( $state['start'], $state['count'] ) || $now - (int) $state['start'] >= $window ) {
			$state = array(
				'start' => $now,
				'count' => 0,
			);
		}
		if ( (int) $state['count'] >= $limit ) {
			return false;
		}
		$state['count']++;
		set_transient( $key, $state, max( 1, $window - ( $now - (int) $state['start'] ) ) );
		return true;
	}
}

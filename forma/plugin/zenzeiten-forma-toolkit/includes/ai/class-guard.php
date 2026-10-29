<?php
/**
 * Abuse protection for the public chat endpoint: page tokens, per-visitor limits and a daily cap.
 *
 * The chat must work on cached pages, so it cannot rely on WordPress nonces (which are tied to a
 * user session and expire). Instead every page carries a signed timestamp; the endpoint accepts
 * only fresh, correctly signed tokens, from this site's own pages, within the limits below.
 *
 * @package ZenZeiTen\FormaToolkit
 */

namespace ZenZeiTen\FormaToolkit;

defined( 'ABSPATH' ) || exit;

/**
 * Tokens, limits and usage counters.
 */
class Guard {

	/**
	 * How long a page token stays valid. Long enough for full-page caches.
	 */
	const TOKEN_TTL = 2 * DAY_IN_SECONDS;

	const USAGE_OPTION = 'zzft_ai_usage';

	/**
	 * Signing key.
	 *
	 * @return string
	 */
	private static function key() {
		return hash( 'sha256', 'zzft-chat|' . wp_salt( 'nonce' ) );
	}

	/**
	 * Issue a token for a page.
	 *
	 * @param int|null $time Timestamp (for tests).
	 * @return string
	 */
	public static function token( $time = null ) {
		$time = null === $time ? time() : (int) $time;
		return $time . '.' . substr( hash_hmac( 'sha256', (string) $time, self::key() ), 0, 32 );
	}

	/**
	 * Check a token.
	 *
	 * @param string   $token Token.
	 * @param int|null $now   Current time (for tests).
	 * @return bool
	 */
	public static function verify( $token, $now = null ) {
		$now = null === $now ? time() : (int) $now;
		if ( ! is_string( $token ) || ! preg_match( '/^(\d{9,11})\.([a-f0-9]{32})$/', $token, $m ) ) {
			return false;
		}
		$time = (int) $m[1];
		if ( $time > $now + 300 || $now - $time > self::TOKEN_TTL ) {
			return false;
		}
		return hash_equals( substr( hash_hmac( 'sha256', (string) $time, self::key() ), 0, 32 ), $m[2] );
	}

	/**
	 * Today's usage counters.
	 *
	 * @return array{date:string,chat:int,editor:int}
	 */
	public static function usage() {
		$usage = get_option( self::USAGE_OPTION, array() );
		$today = wp_date( 'Y-m-d' );
		if ( ! is_array( $usage ) || ! isset( $usage['date'] ) || $usage['date'] !== $today ) {
			$usage = array(
				'date'   => $today,
				'chat'   => 0,
				'editor' => 0,
			);
		}
		return array(
			'date'   => (string) $usage['date'],
			'chat'   => (int) ( isset( $usage['chat'] ) ? $usage['chat'] : 0 ),
			'editor' => (int) ( isset( $usage['editor'] ) ? $usage['editor'] : 0 ),
		);
	}

	/**
	 * Count one request of a kind ('chat' or 'editor'), unless the daily cap is reached.
	 *
	 * @param string $kind  Kind.
	 * @param int    $limit Daily cap; 0 means no cap.
	 * @return bool True if the request may go ahead.
	 */
	public static function take( $kind, $limit ) {
		$usage = self::usage();
		if ( $limit > 0 && $usage[ $kind ] >= $limit ) {
			return false;
		}
		$usage[ $kind ]++;
		update_option( self::USAGE_OPTION, $usage, false );
		return true;
	}
}

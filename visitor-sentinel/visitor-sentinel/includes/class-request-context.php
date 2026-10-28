<?php
/**
 * Facts about the current HTTP request: client IP, user agent, headers.
 *
 * @package VisitorSentinel
 */

namespace VisitorSentinel;

defined( 'ABSPATH' ) || exit;

/**
 * Built once per request from $_SERVER.
 */
final class Request_Context {

	/**
	 * Real client address (never stored when IP storage is off).
	 *
	 * @var string
	 */
	public $ip = '';

	/**
	 * Keyed hash of the address, used to match an IP without storing it.
	 *
	 * @var string
	 */
	public $ip_hash = '';

	/**
	 * The address as it may be stored under the chosen privacy mode.
	 *
	 * @var string
	 */
	public $ip_store = '';

	/**
	 * Raw user agent (trimmed to 512 bytes).
	 *
	 * @var string
	 */
	public $user_agent = '';

	/**
	 * Parsed user agent.
	 *
	 * @var array
	 */
	public $ua = array();

	/**
	 * Accept-Language header.
	 *
	 * @var string
	 */
	public $language = '';

	/**
	 * Two-letter country code, '' when unknown.
	 *
	 * @var string
	 */
	public $country = '';

	/**
	 * Whether the IP is on the allowlist.
	 *
	 * @var bool
	 */
	public $allowlisted = false;

	/**
	 * Whether the IP is in a suspicious network range.
	 *
	 * @var bool
	 */
	public $suspicious_network = false;

	/**
	 * Shared instance for this request.
	 *
	 * @var Request_Context|null
	 */
	private static $current = null;

	/**
	 * Context for the current request.
	 *
	 * @return Request_Context
	 */
	public static function current() {
		if ( null === self::$current ) {
			self::$current = self::from_server( wp_unslash( $_SERVER ) ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- every value is validated below.
		}
		return self::$current;
	}

	/**
	 * Forget the cached context (tests simulate many requests).
	 */
	public static function reset() {
		self::$current = null;
	}

	/**
	 * Build from a $_SERVER-like array.
	 *
	 * @param array $server Server variables.
	 * @return Request_Context
	 */
	public static function from_server( array $server ) {
		$ctx           = new self();
		$ctx->ip       = IP::resolve( $server, Settings::trusted_ranges(), Settings::proxy_header() );
		$ctx->ip_hash  = self::hash_ip( $ctx->ip );
		$ctx->ip_store = self::storable_ip( $ctx->ip );

		$ua              = isset( $server['HTTP_USER_AGENT'] ) && is_string( $server['HTTP_USER_AGENT'] ) ? $server['HTTP_USER_AGENT'] : '';
		$ctx->user_agent = substr( preg_replace( '/[\x00-\x1F\x7F]/', '', $ua ), 0, 512 );
		$ctx->ua         = User_Agent::parse( $ctx->user_agent );
		$ctx->language   = isset( $server['HTTP_ACCEPT_LANGUAGE'] ) && is_string( $server['HTTP_ACCEPT_LANGUAGE'] ) ? substr( $server['HTTP_ACCEPT_LANGUAGE'], 0, 100 ) : '';

		$country = '';
		$remote  = IP::normalize( isset( $server['REMOTE_ADDR'] ) ? $server['REMOTE_ADDR'] : '' );
		if ( Settings::get( 'trust_cloudflare' ) && IP::in_any( $remote, Settings::CLOUDFLARE_RANGES ) && isset( $server['HTTP_CF_IPCOUNTRY'] ) ) {
			$code = strtoupper( (string) $server['HTTP_CF_IPCOUNTRY'] );
			if ( preg_match( '/^[A-Z]{2}$/', $code ) && 'XX' !== $code ) {
				$country = $code;
			}
		}
		/**
		 * Filter the visitor's country (two-letter ISO code). Hook a geolocation service here.
		 *
		 * @param string $country Country code or ''.
		 * @param string $ip      Client IP.
		 */
		$country      = (string) apply_filters( 'vsen_country', $country, $ctx->ip );
		$ctx->country = preg_match( '/^[A-Z]{2}$/', $country ) ? $country : '';

		$ctx->allowlisted        = '' !== $ctx->ip && IP::in_any( $ctx->ip, IP::parse_list( (string) Settings::get( 'allowlist' ) ) );
		$ctx->suspicious_network = '' !== $ctx->ip && IP::in_any( $ctx->ip, IP::parse_list( (string) Settings::get( 'suspicious_networks' ) ) );

		return $ctx;
	}

	/**
	 * Keyed hash of an IP. The key is site-specific, so hashes cannot be reversed with a lookup table.
	 *
	 * @param string $ip Address.
	 * @return string
	 */
	public static function hash_ip( $ip ) {
		return '' === (string) $ip ? '' : hash_hmac( 'sha256', 'ip|' . $ip, Plugin::secret() );
	}

	/**
	 * The address in the form the privacy setting allows to be stored.
	 *
	 * @param string $ip Address.
	 * @return string
	 */
	public static function storable_ip( $ip ) {
		switch ( Settings::get( 'ip_mode' ) ) {
			case 'none':
				return '';
			case 'mask':
				return IP::anonymize( $ip );
		}
		return (string) $ip;
	}

	/**
	 * Whether the browser asked not to be tracked (Do Not Track or Global Privacy Control).
	 *
	 * @return bool
	 */
	public static function opted_out() {
		$dnt = isset( $_SERVER['HTTP_DNT'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_DNT'] ) ) : '';
		$gpc = isset( $_SERVER['HTTP_SEC_GPC'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_SEC_GPC'] ) ) : '';
		return '1' === $dnt || '1' === $gpc;
	}

	/**
	 * Fraud signals known at request time, stored with a click so it can be re-scored later.
	 *
	 * @return array
	 */
	public function signals() {
		return array(
			'bot'  => $this->ua['is_bot'] ? 1 : 0,
			'good' => $this->ua['good_bot'] ? 1 : 0,
			'hl'   => $this->ua['headless'] ? 1 : 0,
			'net'  => $this->suspicious_network ? 1 : 0,
			'al'   => $this->allowlisted ? 1 : 0,
			'mh'   => ( '' === $this->user_agent || '' === $this->language ) ? 1 : 0,
			'rl'   => Tracker::was_rate_limited( $this->ip_hash ) ? 1 : 0,
			'blk'  => Protection::is_blocked( $this ) ? 1 : 0,
		);
	}
}

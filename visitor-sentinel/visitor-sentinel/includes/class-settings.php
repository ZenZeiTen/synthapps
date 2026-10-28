<?php
/**
 * Plugin settings: defaults, reading and sanitizing.
 *
 * @package VisitorSentinel
 */

namespace VisitorSentinel;

defined( 'ABSPATH' ) || exit;

/**
 * All settings live in one option array. Reads are cached for the request.
 */
final class Settings {

	const OPTION = 'vsen_settings';

	/**
	 * Cloudflare's published edge ranges (https://www.cloudflare.com/ips/).
	 * Used only when "Site is behind Cloudflare" is switched on.
	 */
	const CLOUDFLARE_RANGES = array(
		'173.245.48.0/20',
		'103.21.244.0/22',
		'103.22.200.0/22',
		'103.31.4.0/22',
		'141.101.64.0/18',
		'108.162.192.0/18',
		'190.93.240.0/20',
		'188.114.96.0/20',
		'197.234.240.0/22',
		'198.41.128.0/17',
		'162.158.0.0/15',
		'104.16.0.0/13',
		'104.24.0.0/14',
		'172.64.0.0/13',
		'131.0.72.0/22',
		'2400:cb00::/32',
		'2606:4700::/32',
		'2803:f800::/32',
		'2405:b500::/32',
		'2405:8100::/32',
		'2a06:98c0::/29',
		'2c0f:f248::/32',
	);

	const PROXY_HEADERS = array( '', 'X-Forwarded-For', 'X-Real-IP', 'CF-Connecting-IP', 'True-Client-IP', 'X-Client-IP' );

	/**
	 * Request-level cache.
	 *
	 * @var array|null
	 */
	private static $cache = null;

	/**
	 * Default values for every setting.
	 *
	 * @return array
	 */
	public static function defaults() {
		return array(
			'tracking_enabled'     => 1,
			'exclude_roles'        => array( 'administrator' ),
			'respect_dnt'          => 1,
			'require_consent'      => 0,
			'use_storage'          => 1,
			'track_outbound'       => 1,
			'track_downloads'      => 1,
			'ip_mode'              => 'full',
			'proxy_header'         => '',
			'trusted_proxies'      => '',
			'trust_cloudflare'     => 0,
			'retention_days'       => 90,
			'ad_selectors'         => ".vsen-ad-slot\n[data-vsen-ad]\nins.adsbygoogle\n[id^=\"div-gpt-ad\"]",
			'fraud_sensitivity'    => 'medium',
			'burst_threshold'      => 3,
			'daily_threshold'      => 10,
			'fast_click_ms'        => 800,
			'min_dwell_seconds'    => 3,
			'suspicious_networks'  => '',
			'allowlist'            => '',
			'auto_block'           => 1,
			'auto_block_threshold' => 80,
			'block_duration_days'  => 7,
			'protection_action'    => 'hide_ads',
			'alerts_enabled'       => 1,
			'alert_email'          => '',
			'delete_on_uninstall'  => 0,
		);
	}

	/**
	 * All settings merged over the defaults.
	 *
	 * @return array
	 */
	public static function all() {
		if ( null === self::$cache ) {
			$stored      = get_option( self::OPTION, array() );
			self::$cache = array_merge( self::defaults(), is_array( $stored ) ? $stored : array() );
		}
		return self::$cache;
	}

	/**
	 * One setting.
	 *
	 * @param string $key Setting name.
	 * @return mixed
	 */
	public static function get( $key ) {
		$all = self::all();
		return isset( $all[ $key ] ) ? $all[ $key ] : null;
	}

	/**
	 * Forget the request cache, e.g. after saving.
	 */
	public static function flush() {
		self::$cache = null;
	}

	/**
	 * Proxy ranges whose forwarded-for header we believe.
	 *
	 * @return string[]
	 */
	public static function trusted_ranges() {
		$ranges = IP::parse_list( (string) self::get( 'trusted_proxies' ) );
		if ( self::get( 'trust_cloudflare' ) ) {
			$ranges = array_merge( $ranges, self::CLOUDFLARE_RANGES );
		}
		return array_values( array_unique( $ranges ) );
	}

	/**
	 * The header that carries the client address when the request came through a trusted proxy.
	 *
	 * @return string
	 */
	public static function proxy_header() {
		$header = (string) self::get( 'proxy_header' );
		if ( '' === $header && self::get( 'trust_cloudflare' ) ) {
			$header = 'CF-Connecting-IP';
		}
		return $header;
	}

	/**
	 * CSS selectors that mark ad elements, one per entry.
	 *
	 * @return string[]
	 */
	public static function ad_selectors() {
		$lines = preg_split( '/[\r\n]+/', (string) self::get( 'ad_selectors' ) );
		$out   = array();
		foreach ( $lines as $line ) {
			$line = trim( $line );
			// Selectors are printed into CSS and JS, so refuse anything that could close a rule or a tag.
			if ( '' !== $line && ! preg_match( '/[{}<>;@\\\\]/', $line ) ) {
				$out[] = $line;
			}
		}
		return $out;
	}

	/**
	 * Sanitize callback for register_setting().
	 *
	 * @param mixed $input Raw form input.
	 * @return array
	 */
	public static function sanitize( $input ) {
		$defaults = self::defaults();
		$input    = is_array( $input ) ? $input : array();
		$out      = array();

		$checkboxes = array(
			'tracking_enabled',
			'respect_dnt',
			'require_consent',
			'use_storage',
			'track_outbound',
			'track_downloads',
			'trust_cloudflare',
			'auto_block',
			'alerts_enabled',
			'delete_on_uninstall',
		);
		foreach ( $checkboxes as $key ) {
			$out[ $key ] = empty( $input[ $key ] ) ? 0 : 1;
		}

		$roles                = isset( $input['exclude_roles'] ) && is_array( $input['exclude_roles'] ) ? $input['exclude_roles'] : array();
		$known_roles          = function_exists( 'wp_roles' ) ? array_keys( wp_roles()->get_names() ) : array();
		$out['exclude_roles'] = array_values( array_intersect( array_map( 'sanitize_key', $roles ), $known_roles ) );

		$out['ip_mode'] = self::pick( $input, 'ip_mode', array( 'full', 'mask', 'none' ), $defaults['ip_mode'] );

		$out['proxy_header'] = self::pick( $input, 'proxy_header', self::PROXY_HEADERS, '' );

		$out['trusted_proxies']     = implode( "\n", IP::parse_list( isset( $input['trusted_proxies'] ) ? (string) $input['trusted_proxies'] : '' ) );
		$out['suspicious_networks'] = implode( "\n", IP::parse_list( isset( $input['suspicious_networks'] ) ? (string) $input['suspicious_networks'] : '' ) );
		$out['allowlist']           = implode( "\n", IP::parse_list( isset( $input['allowlist'] ) ? (string) $input['allowlist'] : '' ) );

		$out['retention_days']       = self::int( $input, 'retention_days', 0, 3650, $defaults['retention_days'] );
		$out['burst_threshold']      = self::int( $input, 'burst_threshold', 1, 100, $defaults['burst_threshold'] );
		$out['daily_threshold']      = self::int( $input, 'daily_threshold', 1, 1000, $defaults['daily_threshold'] );
		$out['fast_click_ms']        = self::int( $input, 'fast_click_ms', 0, 10000, $defaults['fast_click_ms'] );
		$out['min_dwell_seconds']    = self::int( $input, 'min_dwell_seconds', 0, 120, $defaults['min_dwell_seconds'] );
		$out['auto_block_threshold'] = self::int( $input, 'auto_block_threshold', 40, 100, $defaults['auto_block_threshold'] );
		$out['block_duration_days']  = self::int( $input, 'block_duration_days', 0, 3650, $defaults['block_duration_days'] );

		$out['fraud_sensitivity'] = self::pick( $input, 'fraud_sensitivity', array( 'low', 'medium', 'high' ), $defaults['fraud_sensitivity'] );
		$out['protection_action'] = self::pick( $input, 'protection_action', array( 'log_only', 'hide_ads', 'block_site' ), $defaults['protection_action'] );

		$selectors = isset( $input['ad_selectors'] ) ? (string) $input['ad_selectors'] : '';
		$kept      = array();
		foreach ( preg_split( '/[\r\n]+/', $selectors ) as $line ) {
			$line = trim( wp_strip_all_tags( $line ) );
			if ( '' !== $line && ! preg_match( '/[{}<>;@\\\\]/', $line ) && strlen( $line ) <= 200 ) {
				$kept[] = $line;
			}
		}
		$out['ad_selectors'] = implode( "\n", array_slice( array_unique( $kept ), 0, 50 ) );

		$email              = isset( $input['alert_email'] ) ? sanitize_email( (string) $input['alert_email'] ) : '';
		$out['alert_email'] = is_email( $email ) ? $email : '';

		self::flush();
		return $out;
	}

	/**
	 * Pick a value from an allowed list.
	 *
	 * @param array  $input    Input.
	 * @param string $key      Key.
	 * @param array  $allowed  Allowed values.
	 * @param string $fallback Fallback.
	 * @return string
	 */
	private static function pick( $input, $key, $allowed, $fallback ) {
		$value = isset( $input[ $key ] ) ? (string) $input[ $key ] : $fallback;
		return in_array( $value, $allowed, true ) ? $value : $fallback;
	}

	/**
	 * Clamp an integer.
	 *
	 * @param array  $input    Input.
	 * @param string $key      Key.
	 * @param int    $min      Minimum.
	 * @param int    $max      Maximum.
	 * @param int    $fallback Fallback when missing.
	 * @return int
	 */
	private static function int( $input, $key, $min, $max, $fallback ) {
		if ( ! isset( $input[ $key ] ) || '' === $input[ $key ] || ! is_numeric( $input[ $key ] ) ) {
			return $fallback;
		}
		return max( $min, min( $max, (int) $input[ $key ] ) );
	}
}

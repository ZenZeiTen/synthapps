<?php
/**
 * Settings: defaults, access and sanitizing.
 *
 * @package ZenZeiTenBastion
 */

namespace ZenZeiTenBastion;

defined( 'ABSPATH' ) || exit;

/**
 * One option holds every setting.
 */
final class Settings {

	const OPTION = 'zbst_settings';

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
	 * Cached settings.
	 *
	 * @var array|null
	 */
	private static $cache = null;

	/**
	 * Defaults for every setting.
	 *
	 * @return array
	 */
	public static function defaults() {
		return array(
			'firewall_mode'         => 'protect',
			'disabled_rules'        => array(),
			'xmlrpc'                => 'no_auth',
			'block_enumeration'     => 1,
			'generic_login_errors'  => 1,
			'login_max_failures'    => 5,
			'login_window'          => 15,
			'login_lockout'         => 60,
			'auto_block'            => 1,
			'score_threshold'       => 20,
			'score_window'          => 60,
			'not_found_limit'       => 40,
			'rate_limit'            => 0,
			'protect_admin_ips'     => 1,
			'allowlist'             => '',
			'proxy_header'          => '',
			'trusted_proxies'       => '',
			'trust_cloudflare'      => 0,
			'backup_schedule'       => 'daily',
			'backup_keep'           => 7,
			'backup_exclude_logs'   => 1,
			'backup_before_updates' => 1,
			'alerts_enabled'        => 1,
			'alert_email'           => '',
			'alert_on_block'        => 1,
			'alert_on_admin_change' => 1,
			'log_retention_days'    => 30,
			'delete_on_uninstall'   => 0,
		);
	}

	/**
	 * All settings, merged over the defaults.
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
	 * @param string $key Key.
	 * @return mixed
	 */
	public static function get( $key ) {
		$all = self::all();
		return isset( $all[ $key ] ) ? $all[ $key ] : null;
	}

	/**
	 * Forget the cached copy (after saving, and between tests).
	 */
	public static function flush() {
		self::$cache = null;
	}

	/**
	 * Save new values over the current ones.
	 *
	 * @param array $values Values.
	 */
	public static function update( array $values ) {
		update_option( self::OPTION, self::sanitize( array_merge( self::all(), $values ) ) );
		self::flush();
	}

	/**
	 * Proxies whose forwarded-for header is believed.
	 *
	 * @return string[]
	 */
	public static function trusted_proxies() {
		$ranges = IP::parse_list( (string) self::get( 'trusted_proxies' ) );
		if ( self::get( 'trust_cloudflare' ) ) {
			$ranges = array_merge( $ranges, self::CLOUDFLARE_RANGES );
		}
		return array_values( array_unique( $ranges ) );
	}

	/**
	 * Header that carries the client address behind a proxy.
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
	 * Addresses and ranges that are never blocked or inspected.
	 *
	 * @return string[]
	 */
	public static function allowlist() {
		return IP::parse_list( (string) self::get( 'allowlist' ) );
	}

	/**
	 * Address for alert emails.
	 *
	 * @return string
	 */
	public static function alert_email() {
		$email = (string) self::get( 'alert_email' );
		return '' !== $email ? $email : (string) get_option( 'admin_email' );
	}

	/**
	 * Clean every value and clamp numbers to their range. Unknown keys are dropped.
	 *
	 * @param mixed $input Raw input.
	 * @return array
	 */
	public static function sanitize( $input ) {
		$input = is_array( $input ) ? $input : array();
		$out   = self::defaults();

		$choices = array(
			'firewall_mode'   => array( 'protect', 'log', 'off' ),
			'xmlrpc'          => array( 'no_auth', 'allow', 'off' ),
			'backup_schedule' => array( 'daily', 'weekly', 'off' ),
			'proxy_header'    => self::PROXY_HEADERS,
		);
		foreach ( $choices as $key => $allowed ) {
			if ( isset( $input[ $key ] ) && in_array( (string) $input[ $key ], $allowed, true ) ) {
				$out[ $key ] = (string) $input[ $key ];
			}
		}

		$numbers = array(
			'login_max_failures' => array( 1, 100 ),
			'login_window'       => array( 1, 1440 ),
			'login_lockout'      => array( 1, 43200 ),
			'score_threshold'    => array( 5, 1000 ),
			'score_window'       => array( 5, 1440 ),
			'not_found_limit'    => array( 0, 1000 ),
			'rate_limit'         => array( 0, 10000 ),
			'backup_keep'        => array( 1, 60 ),
			'log_retention_days' => array( 1, 365 ),
		);
		foreach ( $numbers as $key => $range ) {
			if ( isset( $input[ $key ] ) && is_numeric( $input[ $key ] ) ) {
				$out[ $key ] = max( $range[0], min( $range[1], (int) $input[ $key ] ) );
			}
		}

		$flags = array(
			'block_enumeration',
			'generic_login_errors',
			'auto_block',
			'protect_admin_ips',
			'trust_cloudflare',
			'backup_exclude_logs',
			'backup_before_updates',
			'alerts_enabled',
			'alert_on_block',
			'alert_on_admin_change',
			'delete_on_uninstall',
		);
		foreach ( $flags as $key ) {
			$out[ $key ] = empty( $input[ $key ] ) ? 0 : 1;
		}

		// The settings form sends the rules left on (enabled_rules); everything else stores the
		// rules switched off (disabled_rules).
		$known = array_keys( Firewall::rules() );
		$rules = isset( $input['disabled_rules'] ) && is_array( $input['disabled_rules'] ) ? array_map( 'strval', $input['disabled_rules'] ) : array();
		if ( isset( $input['enabled_rules'] ) && is_array( $input['enabled_rules'] ) ) {
			$rules = array_diff( $known, array_map( 'strval', $input['enabled_rules'] ) );
		}
		$out['disabled_rules'] = array_values( array_intersect( $known, $rules ) );

		foreach ( array( 'allowlist', 'trusted_proxies' ) as $key ) {
			$out[ $key ] = isset( $input[ $key ] ) ? implode( "\n", IP::parse_list( (string) $input[ $key ] ) ) : '';
		}

		$email              = isset( $input['alert_email'] ) ? sanitize_email( (string) $input['alert_email'] ) : '';
		$out['alert_email'] = is_email( $email ) ? $email : '';

		return $out;
	}
}

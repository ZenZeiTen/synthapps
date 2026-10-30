<?php
/**
 * The front door: turns blocked addresses away, records threats and blocks addresses whose
 * threat score crosses the threshold.
 *
 * @package ZenZeiTenBastion
 */

namespace ZenZeiTenBastion;

defined( 'ABSPATH' ) || exit;

/**
 * Threat scoring, automatic blocking and request denial.
 */
final class Guard {

	/**
	 * Register hooks.
	 */
	public static function register() {
		// As early as a regular plugin can run: after all plugins are loaded and before any of
		// them does work on plugins_loaded.
		add_action( 'plugins_loaded', array( __CLASS__, 'early' ), -1000 );
	}

	/**
	 * Requests that are never inspected or turned away: command line and the site calling itself.
	 *
	 * @return bool
	 */
	public static function exempt() {
		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			return true;
		}
		$ip = Request::ip();
		return '' === $ip || Blocklist::is_allowlisted( $ip );
	}

	/**
	 * Every request: refuse blocked addresses, apply the rate limit, then run the firewall.
	 */
	public static function early() {
		if ( self::exempt() ) {
			return;
		}
		$ip      = Request::ip();
		$blocked = Blocklist::match( $ip );
		if ( null !== $blocked ) {
			Blocklist::hit( $blocked );
			// One log line per address every five minutes is enough to show it is still trying.
			$key = 'zbst_seen_' . md5( $ip );
			if ( ! get_transient( $key ) ) {
				set_transient( $key, 1, 5 * MINUTE_IN_SECONDS );
				Log::add(
					array(
						'type'     => 'blocked',
						'severity' => Log::SEVERITY_LOW,
						'action'   => 'blocked',
						/* translators: %s: blocked address or range */
						'details'  => sprintf( __( 'Request from blocked %s refused', 'zenzeiten-bastion' ), $blocked ),
					)
				);
			}
			self::deny( 403, __( 'Your access to this site has been blocked.', 'zenzeiten-bastion' ) );
		}
		Hardening::rate_limit();
		Firewall::run();
	}

	/**
	 * Record a threat, and block the address when its score over the window reaches the threshold.
	 *
	 * @param array $event Event for Log::add().
	 * @return array|null The block placed, if any.
	 */
	public static function report( array $event ) {
		Log::add( $event );
		$ip = isset( $event['ip'] ) ? (string) $event['ip'] : Request::ip();
		if ( ! Settings::get( 'auto_block' ) || '' === $ip ) {
			return null;
		}
		$score = Log::score( $ip, (int) Settings::get( 'score_window' ) );
		if ( $score < (int) Settings::get( 'score_threshold' ) ) {
			return null;
		}
		/* translators: 1: threat score, 2: minutes */
		$reason = sprintf( __( 'Threat score %1$d in %2$d minutes', 'zenzeiten-bastion' ), $score, (int) Settings::get( 'score_window' ) );
		return self::auto_block( $ip, 'auto', $reason, null );
	}

	/**
	 * Block an address automatically, unless it is protected or already blocked.
	 *
	 * @param string   $ip      Address.
	 * @param string   $source  auto or login.
	 * @param string   $reason  Why.
	 * @param int|null $minutes Length, or null to escalate.
	 * @return array|null The block placed.
	 */
	public static function auto_block( $ip, $source, $reason, $minutes ) {
		if ( null !== Blocklist::match( $ip ) || Blocklist::is_admin_ip( $ip ) ) {
			return null;
		}
		$block = Blocklist::add( $ip, $source, $reason, $minutes );
		if ( ! $block ) {
			return null;
		}
		$until = $block['expires_at'] ? $block['expires_at'] . ' UTC' : __( 'permanently', 'zenzeiten-bastion' );
		Log::add(
			array(
				'ip'       => $block['ip'],
				'type'     => 'auto_block',
				'severity' => Log::SEVERITY_HIGH,
				'score'    => 0,
				'action'   => 'locked',
				/* translators: 1: reason, 2: offence number, 3: end time */
				'details'  => sprintf( __( '%1$s (offence %2$d, until %3$s)', 'zenzeiten-bastion' ), $reason, $block['offenses'], $until ),
			)
		);
		Alerts::queue_block( $block );
		return $block;
	}

	/**
	 * Count an event in a time window, for limits checked on every request (404 floods, request
	 * rates). Uses the object cache when the site has one.
	 *
	 * @param string $key    Counter name.
	 * @param int    $window Seconds.
	 * @return int Count including this one.
	 */
	public static function bump( $key, $window ) {
		$key   = 'zbst_n_' . md5( $key );
		$state = get_transient( $key );
		$now   = time();
		if ( ! is_array( $state ) || $state[1] + $window <= $now ) {
			$state = array( 0, $now );
		}
		++$state[0];
		set_transient( $key, $state, $window );
		return $state[0];
	}

	/**
	 * Refuse the request and stop.
	 *
	 * @param int    $status  HTTP status.
	 * @param string $message Message for the visitor.
	 */
	public static function deny( $status, $message ) {
		do_action( 'zbst_deny', $status, $message );
		if ( ! headers_sent() ) {
			status_header( $status );
			nocache_headers();
			header( 'Content-Type: text/html; charset=utf-8' );
			if ( 429 === $status ) {
				header( 'Retry-After: 60' );
			}
		}
		$reference = gmdate( 'Y-m-d H:i:s' ) . ' UTC · ' . Request::ip();
		echo '<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' . esc_html__( 'Access denied', 'zenzeiten-bastion' ) . '</title>'
			. '<style>body{font:16px/1.5 system-ui,sans-serif;background:#f4f5f7;color:#1d2327;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center}main{background:#fff;padding:32px 40px;border-radius:12px;max-width:480px;box-shadow:0 2px 12px rgba(0,0,0,.08)}h1{font-size:22px;margin:0 0 8px}small{color:#646970}</style>'
			. '</head><body><main><h1>' . esc_html__( 'Access denied', 'zenzeiten-bastion' ) . '</h1><p>' . esc_html( $message ) . '</p><p><small>'
			. esc_html__( 'If you think this is a mistake, contact the site owner and quote this reference:', 'zenzeiten-bastion' ) . ' ' . esc_html( $reference ) . '</small></p></main></body></html>';
		exit;
	}
}

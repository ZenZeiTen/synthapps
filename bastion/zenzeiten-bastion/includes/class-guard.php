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
 *
 * This code runs on plugins_loaded, before WordPress may load translations (it warns from 6.7 on),
 * so the text it stores and shows is plain English. The admin screens translate what they can.
 */
final class Guard {

	const ERROR_OPTION = 'zbst_last_error';

	/**
	 * Holds the latest automatic block of a Cloudflare address, for the admin notice.
	 */
	const CLOUDFLARE_OPTION = 'zbst_cloudflare_notice';

	/**
	 * Longest automatic block, in minutes, of an address that may be a proxy in front of the site.
	 */
	const PROXY_BLOCK_MINUTES = 60;

	/**
	 * Register hooks.
	 */
	public static function register() {
		// As early as a regular plugin can run: after all plugins are loaded and before any of
		// them does work on plugins_loaded.
		add_action( 'plugins_loaded', self::wrap( array( __CLASS__, 'early' ) ), -1000 );
	}

	/**
	 * Wrap a hook callback so an error inside it is recorded and skipped instead of stopping the
	 * page. A security check that fails must never take the site down: the request carries on
	 * unchecked, and the error is shown to administrators so it can be reported and fixed.
	 *
	 * @param callable $callback Callback.
	 * @return \Closure
	 */
	public static function wrap( $callback ) {
		return function ( ...$args ) use ( $callback ) {
			try {
				return call_user_func_array( $callback, $args );
			} catch ( \Error $e ) {
				self::record_error( $e );
				// Filters get their value back unchanged; actions ignore the return value.
				return $args ? $args[0] : null;
			}
		};
	}

	/**
	 * Remember the latest error for the admin notice and write it to the PHP error log, at most
	 * once a minute so a busy site does not write on every request.
	 *
	 * @param \Throwable $e Error.
	 */
	public static function record_error( $e ) {
		$message = get_class( $e ) . ': ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine();
		$last    = get_option( self::ERROR_OPTION );
		if ( is_array( $last ) && isset( $last['time'], $last['message'] ) && $last['message'] === $message && time() - (int) $last['time'] < 60 ) {
			return;
		}
		error_log( 'ZenZeiTen Bastion skipped a check after an error: ' . $message ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- reported to the site owner.
		update_option(
			self::ERROR_OPTION,
			array(
				'time'    => time(),
				'message' => Request::clip( $message, 1000 ),
				'url'     => Request::uri(),
				'version' => ZBST_VERSION,
				'php'     => PHP_VERSION,
			),
			false
		);
	}

	/**
	 * ID of the user the request's login cookie belongs to, or 0.
	 *
	 * The guard runs before other plugins finish loading. Asking WordPress for the current user
	 * there (current_user_can(), is_user_logged_in()) would settle who the visitor is before
	 * plugins that hook into that decision, or that cache pages for logged-out visitors, are
	 * ready. That broke pages for logged-out visitors on a live site. This reads the cookie
	 * without setting the current user.
	 *
	 * @return int
	 */
	public static function cookie_user_id() {
		if ( ! function_exists( 'wp_validate_auth_cookie' ) ) {
			return 0;
		}
		return (int) wp_validate_auth_cookie( '', 'logged_in' );
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
	 * Every request: refuse blocked addresses, judge agents, apply the rate limit, then run the
	 * firewall. The agent check comes right after the blocklist, so a blocked address costs
	 * nothing extra, and before the rate limit, so verified crawlers can be spared from it.
	 */
	public static function early() {
		if ( self::exempt() ) {
			return;
		}
		$ip      = Request::ip();
		$blocked = Blocklist::match( $ip );
		if ( null !== $blocked && ! Agents::spared_on_robots() ) {
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
						'details'  => 'Request from blocked ' . $blocked . ' refused',
					)
				);
			}
			self::deny( 403, 'Your access to this site has been blocked.' );
		}
		$inspected = Agents::check();
		Hardening::rate_limit();
		if ( ! $inspected ) {
			Firewall::run();
		}
	}

	/**
	 * Record a threat, and block the address when its score reaches a threshold.
	 *
	 * Two windows are checked. The short one counts every event. The long one counts only high
	 * and critical events, so it catches a scanner that probes a few times a day without ever
	 * blocking someone for mistyping a password.
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
		// An event that adds no points cannot push a score over a threshold.
		if ( Log::points( $event ) <= 0 ) {
			return null;
		}

		$window = (int) Settings::get( 'score_window' );
		$score  = Log::score( $ip, $window );
		if ( $score >= (int) Settings::get( 'score_threshold' ) ) {
			return self::auto_block( $ip, 'auto', sprintf( 'Threat score %1$d in %2$d minutes', $score, $window ), null );
		}

		$window = (int) Settings::get( 'score_window_long' );
		if ( $window <= 0 ) {
			return null;
		}
		$score = Log::score_min( $ip, $window, Log::SEVERITY_HIGH );
		if ( $score >= (int) Settings::get( 'score_threshold_long' ) ) {
			return self::auto_block( $ip, 'auto', sprintf( 'Threat score %1$d in %2$d minutes (high and critical only)', $score, $window ), null );
		}
		return null;
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
		// An address inside Cloudflare's ranges, on a site that does not say it is behind
		// Cloudflare, may be Cloudflare's edge standing in for every visitor. Keep the block
		// short and ask the owner to check, rather than escalate to days.
		$proxy = ! Settings::get( 'trust_cloudflare' ) && IP::in_any( $ip, Settings::CLOUDFLARE_RANGES );
		if ( $proxy && ( null === $minutes || $minutes <= 0 || $minutes > self::PROXY_BLOCK_MINUTES ) ) {
			$minutes = self::PROXY_BLOCK_MINUTES;
		}
		$block = Blocklist::add( $ip, $source, $reason, $minutes );
		if ( ! $block ) {
			return null;
		}
		if ( $proxy ) {
			update_option(
				self::CLOUDFLARE_OPTION,
				array(
					'ip'   => $block['ip'],
					'time' => time(),
				),
				false
			);
		}
		$until = $block['expires_at'] ? $block['expires_at'] . ' UTC' : 'permanently';
		Log::add(
			array(
				'ip'       => $block['ip'],
				'type'     => 'auto_block',
				'severity' => Log::SEVERITY_HIGH,
				'score'    => 0,
				'action'   => 'locked',
				'details'  => sprintf( '%1$s (offence %2$d, until %3$s)', $reason, $block['offenses'], $until ),
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
	 * Refuse the request and stop. The page is in English: it is shown before translations load.
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
		echo '<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Access denied</title>'
			. '<style>body{font:16px/1.5 system-ui,sans-serif;background:#f4f5f7;color:#1d2327;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center}main{background:#fff;padding:32px 40px;border-radius:12px;max-width:480px;box-shadow:0 2px 12px rgba(0,0,0,.08)}h1{font-size:22px;margin:0 0 8px}small{color:#646970}</style>'
			. '</head><body><main><h1>Access denied</h1><p>' . esc_html( $message ) . '</p><p><small>'
			. 'If you think this is a mistake, contact the site owner and quote this reference: ' . esc_html( $reference ) . '</small></p></main></body></html>';
		exit;
	}
}

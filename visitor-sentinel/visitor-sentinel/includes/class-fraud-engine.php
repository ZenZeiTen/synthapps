<?php
/**
 * Rule-based fraud scoring for ad clicks.
 *
 * The engine is pure: it receives every fact about a click as an array and returns a score.
 * Gathering those facts from the database is the job of Fraud_Service.
 *
 * @package VisitorSentinel
 */

namespace VisitorSentinel;

defined( 'ABSPATH' ) || exit;

/**
 * Scores a click from 0 (clean) to 100 (almost certainly fraudulent).
 */
final class Fraud_Engine {

	const STATUS_CLEAN      = 0;
	const STATUS_SUSPICIOUS = 1;
	const STATUS_FRAUD      = 2;

	const SUSPICIOUS_AT = 40;
	const FRAUD_AT      = 70;

	/**
	 * Engine settings.
	 *
	 * @var array
	 */
	private $settings;

	/**
	 * Constructor.
	 *
	 * @param array $settings Uses burst_threshold, daily_threshold, fast_click_ms, min_dwell_seconds, fraud_sensitivity.
	 */
	public function __construct( array $settings ) {
		$this->settings = array_merge(
			array(
				'burst_threshold'   => 3,
				'daily_threshold'   => 10,
				'fast_click_ms'     => 800,
				'min_dwell_seconds' => 3,
				'fraud_sensitivity' => 'medium',
			),
			$settings
		);
	}

	/**
	 * Base points per rule before the sensitivity multiplier.
	 *
	 * @return int[]
	 */
	public static function weights() {
		return array(
			'bot_ua'            => 60,
			'headless'          => 50,
			'untrusted_event'   => 45,
			'no_js'             => 40,
			'suspicious_network' => 40,
			'click_id_replay'   => 35,
			'blocked_ip'        => 30,
			'ip_burst'          => 30,
			'repeat_target'     => 30,
			'ip_volume'         => 25,
			'fast_click'        => 25,
			'zero_engagement'   => 25,
			'no_interaction'    => 20,
			'cookie_churn'      => 20,
			'rate_limited'      => 20,
			'missing_headers'   => 15,
		);
	}

	/**
	 * Score one click.
	 *
	 * Recognized facts (all optional):
	 * - type: 'ad_landing' (arrived from a paid ad) or 'ad_click' (clicked an ad on this site)
	 * - allowlisted, bot, headless, no_js, click_id_replay, network, blocked, rate_limited, missing_headers (bool)
	 * - trusted (0/1): the browser said the click event came from a real user action
	 * - ip_clicks_1h, ip_clicks_24h (int): ad clicks from the same IP in that window, this one included
	 * - same_target (int): earlier clicks on the same ad by the same visitor or IP in the last 10 minutes
	 * - time_to_click (int ms, -1 when unknown), interactions (int, -1 when unknown), iframe (bool)
	 * - dwell (int seconds, -1 when unknown), session_pageviews (int)
	 * - visitors_24h (int): distinct visitor IDs seen on the same IP in 24 hours
	 *
	 * @param array $c Facts.
	 * @return array Keys: score (int), reasons (string[] strongest first), status (int).
	 */
	public function evaluate( array $c ) {
		if ( ! empty( $c['allowlisted'] ) ) {
			return array(
				'score'   => 0,
				'reasons' => array( 'allowlisted' ),
				'status'  => self::STATUS_CLEAN,
			);
		}

		$w      = self::weights();
		$s      = $this->settings;
		$type   = isset( $c['type'] ) ? $c['type'] : 'ad_click';
		$points = array();

		$flags = array( 'bot' => 'bot_ua', 'headless' => 'headless', 'no_js' => 'no_js', 'network' => 'suspicious_network', 'click_id_replay' => 'click_id_replay', 'blocked' => 'blocked_ip', 'rate_limited' => 'rate_limited', 'missing_headers' => 'missing_headers' );
		foreach ( $flags as $fact => $rule ) {
			if ( ! empty( $c[ $fact ] ) ) {
				$points[ $rule ] = $w[ $rule ];
			}
		}

		if ( isset( $c['trusted'] ) && 0 === (int) $c['trusted'] ) {
			$points['untrusted_event'] = $w['untrusted_event'];
		}

		$burst     = isset( $c['ip_clicks_1h'] ) ? (int) $c['ip_clicks_1h'] : 0;
		$burst_max = max( 1, (int) $s['burst_threshold'] );
		if ( $burst > $burst_max ) {
			$points['ip_burst'] = $w['ip_burst'] + min( 24, 8 * ( $burst - $burst_max - 1 ) );
		}

		$volume     = isset( $c['ip_clicks_24h'] ) ? (int) $c['ip_clicks_24h'] : 0;
		$volume_max = max( 1, (int) $s['daily_threshold'] );
		if ( $volume > $volume_max ) {
			$points['ip_volume'] = $w['ip_volume'] + min( 15, 3 * ( $volume - $volume_max - 1 ) );
		}

		if ( ! empty( $c['same_target'] ) ) {
			$points['repeat_target'] = $w['repeat_target'] + min( 20, 10 * ( (int) $c['same_target'] - 1 ) );
		}

		if ( isset( $c['visitors_24h'] ) && (int) $c['visitors_24h'] >= 5 ) {
			$points['cookie_churn'] = $w['cookie_churn'];
		}

		$interactions = isset( $c['interactions'] ) ? (int) $c['interactions'] : -1;

		if ( 'ad_click' === $type ) {
			$ms = isset( $c['time_to_click'] ) ? (int) $c['time_to_click'] : -1;
			if ( $ms >= 0 && $ms < (int) $s['fast_click_ms'] ) {
				$points['fast_click'] = $w['fast_click'];
			}
			if ( 0 === $interactions && empty( $c['iframe'] ) ) {
				$points['no_interaction'] = $w['no_interaction'];
			}
		}

		if ( 'ad_landing' === $type ) {
			$dwell = isset( $c['dwell'] ) ? (int) $c['dwell'] : -1;
			$pages = isset( $c['session_pageviews'] ) ? (int) $c['session_pageviews'] : 1;
			if ( $dwell >= 0 && $dwell < (int) $s['min_dwell_seconds'] && $interactions <= 0 && $pages <= 1 ) {
				$points['zero_engagement'] = $w['zero_engagement'];
			}
		}

		$multipliers = array(
			'low'    => 0.75,
			'medium' => 1.0,
			'high'   => 1.25,
		);
		$multiplier  = isset( $multipliers[ $s['fraud_sensitivity'] ] ) ? $multipliers[ $s['fraud_sensitivity'] ] : 1.0;
		$score       = (int) min( 100, round( array_sum( $points ) * $multiplier ) );

		arsort( $points );

		return array(
			'score'   => $score,
			'reasons' => array_keys( $points ),
			'status'  => self::status_for( $score ),
		);
	}

	/**
	 * Status for a score.
	 *
	 * @param int $score Score.
	 * @return int
	 */
	public static function status_for( $score ) {
		if ( $score >= self::FRAUD_AT ) {
			return self::STATUS_FRAUD;
		}
		return $score >= self::SUSPICIOUS_AT ? self::STATUS_SUSPICIOUS : self::STATUS_CLEAN;
	}

	/**
	 * Human labels for rule IDs.
	 *
	 * @return string[]
	 */
	public static function labels() {
		return array(
			'allowlisted'        => __( 'Allowlisted IP', 'visitor-sentinel' ),
			'bot_ua'             => __( 'Bot or automation user agent', 'visitor-sentinel' ),
			'headless'           => __( 'Headless or automated browser', 'visitor-sentinel' ),
			'untrusted_event'    => __( 'Click was generated by script, not a person', 'visitor-sentinel' ),
			'no_js'              => __( 'Ad landing without a browser running the page', 'visitor-sentinel' ),
			'suspicious_network' => __( 'IP in a suspicious network range', 'visitor-sentinel' ),
			'click_id_replay'    => __( 'Ad click ID reused from another IP', 'visitor-sentinel' ),
			'blocked_ip'         => __( 'IP was already blocked', 'visitor-sentinel' ),
			'ip_burst'           => __( 'Too many ad clicks from this IP in one hour', 'visitor-sentinel' ),
			'repeat_target'      => __( 'Same ad clicked again within 10 minutes', 'visitor-sentinel' ),
			'ip_volume'          => __( 'Too many ad clicks from this IP in 24 hours', 'visitor-sentinel' ),
			'fast_click'         => __( 'Ad clicked too soon after the page loaded', 'visitor-sentinel' ),
			'zero_engagement'    => __( 'Left the landing page at once without interacting', 'visitor-sentinel' ),
			'no_interaction'     => __( 'No mouse, touch, key or scroll activity before the click', 'visitor-sentinel' ),
			'cookie_churn'       => __( 'Many visitor IDs from one IP (cleared cookies)', 'visitor-sentinel' ),
			'rate_limited'       => __( 'IP exceeded the request rate limit', 'visitor-sentinel' ),
			'missing_headers'    => __( 'Browser headers missing (no language or user agent)', 'visitor-sentinel' ),
		);
	}
}

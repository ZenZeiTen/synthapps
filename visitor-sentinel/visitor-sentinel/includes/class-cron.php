<?php
/**
 * Scheduled work: final click scores, data retention, block expiry and alerts.
 *
 * @package VisitorSentinel
 */

namespace VisitorSentinel;

defined( 'ABSPATH' ) || exit;

/**
 * Runs every hour through WP-Cron (or a real cron calling wp-cron.php).
 */
final class Cron {

	const HOOK = 'vsen_hourly';

	/**
	 * Minutes after a click before it gets its final score. Engagement normally arrives well
	 * before this; a landing the browser never confirmed by then did not run JavaScript.
	 */
	const FINALIZE_AFTER = 900;

	/**
	 * Hook into WordPress.
	 */
	public static function register() {
		add_action( self::HOOK, array( __CLASS__, 'run' ) );
	}

	/**
	 * Schedule the hourly event.
	 */
	public static function schedule() {
		if ( ! wp_next_scheduled( self::HOOK ) ) {
			wp_schedule_event( time() + 300, 'hourly', self::HOOK );
		}
	}

	/**
	 * Remove the hourly event.
	 */
	public static function unschedule() {
		wp_clear_scheduled_hook( self::HOOK );
	}

	/**
	 * Hourly job.
	 */
	public static function run() {
		self::finalize_clicks();
		self::apply_retention();
		if ( Repository::instance()->delete_expired_blocks() > 0 ) {
			Protection::rebuild_index();
		}
		Alerts::send_digest();
	}

	/**
	 * Give every click older than FINALIZE_AFTER its final score.
	 *
	 * @return int Clicks finalized.
	 */
	public static function finalize_clicks() {
		$repo    = Repository::instance();
		$service = new Fraud_Service();
		$count   = 0;
		foreach ( (array) $repo->unfinalized_clicks( Repository::now( -self::FINALIZE_AFTER ) ) as $click ) {
			if ( 'ad_landing' === $click->click_type && 0 === (int) $click->visitor_id ) {
				self::attach_server_visitor( $click );
			}
			$service->evaluate( (int) $click->id, true );
			++$count;
		}
		return $count;
	}

	/**
	 * A landing the browser never confirmed has no visitor yet. Create one from the stored
	 * request facts so non-JavaScript clients show up in the visitor list.
	 *
	 * @param object $click Click row.
	 */
	private static function attach_server_visitor( $click ) {
		$signals = json_decode( (string) $click->signals, true );
		$signals = is_array( $signals ) ? $signals : array();
		$repo    = Repository::instance();
		$id      = $repo->upsert_visitor(
			hash_hmac( 'sha256', 'srv|' . $click->ip_hash, Plugin::secret() ),
			array(
				'ip'         => $click->ip,
				'ip_hash'    => $click->ip_hash,
				'country'    => '',
				'user_agent' => isset( $signals['ua'] ) ? substr( (string) $signals['ua'], 0, 512 ) : '',
				'browser'    => isset( $signals['br'] ) ? substr( (string) $signals['br'], 0, 40 ) : 'Other',
				'os'         => isset( $signals['os'] ) ? substr( (string) $signals['os'], 0, 40 ) : 'Other',
				'device'     => ! empty( $signals['bot'] ) ? 'bot' : 'unknown',
				'is_bot'     => ! empty( $signals['bot'] ) ? 1 : 0,
			)
		);
		if ( $id ) {
			$repo->set_click_visitor( (int) $click->id, $id );
			$repo->bump_visitor( $id, 'clicks' );
		}
	}

	/**
	 * Delete tracking data older than the retention period.
	 */
	public static function apply_retention() {
		$days = (int) Settings::get( 'retention_days' );
		if ( $days > 0 ) {
			Repository::instance()->purge_before( Repository::now( -DAY_IN_SECONDS * $days ) );
		}
	}
}

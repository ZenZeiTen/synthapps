<?php
/**
 * Email digest of new fraudulent clicks.
 *
 * @package VisitorSentinel
 */

namespace VisitorSentinel;

defined( 'ABSPATH' ) || exit;

/**
 * Sends at most one email per hourly run, listing fraudulent clicks no earlier email reported.
 *
 * Each click is marked once it has been reported. A click can turn fraudulent long after it
 * was recorded (a landing no browser confirms is scored 15 minutes later), so "newer than the
 * last one emailed" would miss it.
 */
final class Alerts {

	/**
	 * Clicks listed in one email.
	 */
	const PER_EMAIL = 25;

	/**
	 * Send the digest when there is something new.
	 *
	 * @return bool Whether an email was sent.
	 */
	public static function send_digest() {
		$repo = Repository::instance();
		$to   = Settings::get( 'alert_email' );
		$to   = is_email( $to ) ? $to : get_option( 'admin_email' );
		if ( ! Settings::get( 'alerts_enabled' ) || ! is_email( $to ) ) {
			// Nothing is saved up for later: switching alerts on reports only what follows.
			$repo->mark_alerted();
			return false;
		}
		$clicks = $repo->unreported_fraud( self::PER_EMAIL + 1 );
		if ( empty( $clicks ) ) {
			return false;
		}
		$more   = count( $clicks ) > self::PER_EMAIL;
		$clicks = array_slice( $clicks, 0, self::PER_EMAIL );
		if ( $more ) {
			// One email says "and more"; the rest is on the dashboard, not in the next email.
			$repo->mark_alerted();
		} else {
			$ids = array();
			foreach ( $clicks as $click ) {
				$ids[] = (int) $click->id;
			}
			$repo->mark_alerted( $ids );
		}

		$labels = Fraud_Engine::labels();
		$lines  = array();
		foreach ( $clicks as $click ) {
			$reasons = array();
			foreach ( array_filter( explode( ',', (string) $click->fraud_reasons ) ) as $rule ) {
				$reasons[] = isset( $labels[ $rule ] ) ? $labels[ $rule ] : $rule;
			}
			$lines[] = sprintf(
				'- %1$s UTC | %2$s | %3$s | %4$s %5$d | %6$s',
				$click->created_at,
				'' !== (string) $click->ip ? $click->ip : substr( (string) $click->ip_hash, 0, 12 ),
				'' !== (string) $click->network ? $click->network : $click->click_type,
				__( 'score', 'zenzeiten-visitor-guard' ),
				(int) $click->fraud_score,
				implode( '; ', $reasons )
			);
		}
		if ( $more ) {
			$lines[] = __( '- ...and more. See the dashboard for the full list.', 'zenzeiten-visitor-guard' );
		}

		$site = wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES );
		/* translators: 1: site name, 2: number of clicks */
		$subject = sprintf( __( '[%1$s] Visitor Guard: %2$d fraudulent clicks detected', 'zenzeiten-visitor-guard' ), $site, count( $clicks ) );
		$body    = __( 'Visitor Guard scored these ad clicks as fraudulent:', 'zenzeiten-visitor-guard' ) . "\n\n"
			. implode( "\n", $lines ) . "\n\n"
			. __( 'Review them here:', 'zenzeiten-visitor-guard' ) . ' ' . admin_url( 'admin.php?page=vsen-fraud&view=fraud' ) . "\n";

		return (bool) wp_mail( $to, $subject, $body );
	}
}

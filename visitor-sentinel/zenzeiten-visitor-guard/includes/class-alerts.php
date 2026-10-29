<?php
/**
 * Email digest of new fraudulent clicks.
 *
 * @package VisitorSentinel
 */

namespace VisitorSentinel;

defined( 'ABSPATH' ) || exit;

/**
 * Sends at most one email per hourly run, listing fraudulent clicks found since the last email.
 */
final class Alerts {

	const CURSOR_OPTION = 'vsen_alert_cursor';

	/**
	 * Send the digest when there is something new.
	 *
	 * @return bool Whether an email was sent.
	 */
	public static function send_digest() {
		$repo   = Repository::instance();
		$cursor = get_option( self::CURSOR_OPTION, null );
		if ( null === $cursor ) {
			// First run: start from now instead of reporting history.
			update_option( self::CURSOR_OPTION, $repo->max_click_id(), false );
			return false;
		}
		$clicks = (array) $repo->fraud_clicks_after( (int) $cursor, 26 );
		if ( empty( $clicks ) ) {
			return false;
		}
		$last = end( $clicks );
		update_option( self::CURSOR_OPTION, (int) $last->id, false );

		if ( ! Settings::get( 'alerts_enabled' ) ) {
			return false;
		}
		$to = Settings::get( 'alert_email' );
		$to = is_email( $to ) ? $to : get_option( 'admin_email' );
		if ( ! is_email( $to ) ) {
			return false;
		}

		$labels = Fraud_Engine::labels();
		$more   = count( $clicks ) > 25;
		$clicks = array_slice( $clicks, 0, 25 );
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

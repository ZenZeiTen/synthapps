<?php
/**
 * Suggested privacy policy text.
 *
 * @package VisitorSentinel
 */

namespace VisitorSentinel;

defined( 'ABSPATH' ) || exit;

/**
 * Adds a section to Settings > Privacy > Policy Guide.
 */
final class Privacy {

	/**
	 * Hook into WordPress.
	 */
	public static function register() {
		add_action( 'admin_init', array( __CLASS__, 'policy_text' ) );
	}

	/**
	 * Register the suggested text.
	 */
	public static function policy_text() {
		if ( ! function_exists( 'wp_add_privacy_policy_content' ) ) {
			return;
		}
		$days = (int) Settings::get( 'retention_days' );
		$keep = $days > 0
			/* translators: %d: number of days */
			? sprintf( __( 'This data is deleted automatically after %d days.', 'visitor-sentinel' ), $days )
			: __( 'This data is kept until an administrator deletes it.', 'visitor-sentinel' );

		$text  = '<p class="privacy-policy-tutorial">' . esc_html__( 'Visitor Sentinel records visits to detect fraudulent ad clicks. Adjust this text to match your settings.', 'visitor-sentinel' ) . '</p>';
		$text .= '<p><strong class="privacy-policy-tutorial">' . esc_html__( 'Suggested text:', 'visitor-sentinel' ) . '</strong> ';
		$text .= esc_html__( 'When you visit this site we record your IP address, browser and device type, the pages you view, how long you stay and which links and ads you click. We use this to understand how the site is used and to protect our advertising from fraudulent clicks. IP addresses that show automated or fraudulent activity may be blocked from seeing ads or from using the site.', 'visitor-sentinel' );
		$text .= ' ' . esc_html( $keep ) . '</p>';

		wp_add_privacy_policy_content( 'Visitor Sentinel', wp_kses_post( $text ) );
	}
}

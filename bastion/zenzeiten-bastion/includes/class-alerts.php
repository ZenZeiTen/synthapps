<?php
/**
 * Email alerts: blocks are batched into one message at most every fifteen minutes; backup and
 * restore problems are sent at once.
 *
 * @package ZenZeiTenBastion
 */

namespace ZenZeiTenBastion;

defined( 'ABSPATH' ) || exit;

/**
 * Sends alert emails.
 */
final class Alerts {

	const QUEUE    = 'zbst_alert_queue';
	const LAST     = 'zbst_alert_last';
	const INTERVAL = 900;
	const FLUSH_HOOK = 'zbst_flush_alerts';

	/**
	 * Add an automatic block to the next alert, and send it if enough time has passed.
	 *
	 * @param array $block Block row.
	 */
	public static function queue_block( array $block ) {
		if ( ! Settings::get( 'alerts_enabled' ) || ! Settings::get( 'alert_on_block' ) ) {
			return;
		}
		$queue   = (array) get_option( self::QUEUE, array() );
		$queue[] = array(
			'ip'      => $block['ip'],
			'reason'  => $block['reason'],
			'until'   => $block['expires_at'],
			'time'    => time(),
		);
		update_option( self::QUEUE, array_slice( $queue, -50 ), false );
		// Blocks made by the firewall happen before WordPress may load translations, which the
		// email needs, so cron sends those a moment later.
		if ( did_action( 'after_setup_theme' ) ) {
			self::flush();
		} elseif ( ! wp_next_scheduled( self::FLUSH_HOOK ) ) {
			wp_schedule_single_event( time(), self::FLUSH_HOOK );
		}
	}

	/**
	 * Send queued block alerts when the last one went out long enough ago.
	 *
	 * @return bool Whether an email was sent.
	 */
	public static function flush() {
		$queue = (array) get_option( self::QUEUE, array() );
		if ( ! $queue || time() - (int) get_option( self::LAST, 0 ) < self::INTERVAL ) {
			return false;
		}
		$lines = array();
		foreach ( $queue as $item ) {
			$until   = $item['until'] ? $item['until'] . ' UTC' : __( 'permanent', 'zenzeiten-bastion' );
			$lines[] = sprintf( '- %s: %s (%s %s)', $item['ip'], $item['reason'], __( 'until', 'zenzeiten-bastion' ), $until );
		}
		/* translators: %d: number of blocked addresses */
		$subject = sprintf( _n( '%d address blocked', '%d addresses blocked', count( $queue ), 'zenzeiten-bastion' ), count( $queue ) );
		$body    = __( 'ZenZeiTen Bastion blocked these addresses automatically:', 'zenzeiten-bastion' ) . "\n\n" . implode( "\n", $lines )
			. "\n\n" . __( 'Review or lift blocks here:', 'zenzeiten-bastion' ) . ' ' . admin_url( 'admin.php?page=zbst-blocks' );
		update_option( self::QUEUE, array(), false );
		update_option( self::LAST, time(), false );
		return self::mail( $subject, $body );
	}

	/**
	 * Send an alert now.
	 *
	 * @param string $subject Subject.
	 * @param string $body    Body.
	 * @return bool
	 */
	public static function send_now( $subject, $body ) {
		if ( ! Settings::get( 'alerts_enabled' ) ) {
			return false;
		}
		return self::mail( $subject, $body );
	}

	/**
	 * Send a message to the alert address.
	 *
	 * @param string $subject Subject.
	 * @param string $body    Body.
	 * @return bool
	 */
	private static function mail( $subject, $body ) {
		$site = wp_specialchars_decode( (string) get_bloginfo( 'name' ), ENT_QUOTES );
		return (bool) wp_mail( Settings::alert_email(), '[' . $site . '] ' . $subject, $body . "\n\n" . home_url( '/' ) );
	}
}

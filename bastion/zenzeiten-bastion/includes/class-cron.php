<?php
/**
 * Scheduled work: hourly upkeep and scheduled backups.
 *
 * @package ZenZeiTenBastion
 */

namespace ZenZeiTenBastion;

defined( 'ABSPATH' ) || exit;

/**
 * Cron events and the administrator watch.
 */
final class Cron {

	const HOURLY = 'zbst_hourly';
	const BACKUP = 'zbst_backup';

	/**
	 * Register handlers.
	 */
	public static function register() {
		add_action( self::HOURLY, array( __CLASS__, 'hourly' ) );
		add_action( self::BACKUP, array( __CLASS__, 'backup' ) );
		add_action( Alerts::FLUSH_HOOK, array( 'ZenZeiTenBastion\\Alerts', 'flush' ) );
	}

	/**
	 * Make sure both events are scheduled as the settings say. Runs on activation and on init,
	 * which covers sites where activation never ran for this copy.
	 */
	public static function schedule() {
		if ( ! wp_next_scheduled( self::HOURLY ) ) {
			wp_schedule_event( time() + 300, 'hourly', self::HOURLY );
		}
		$want = (string) Settings::get( 'backup_schedule' );
		$have = wp_get_schedule( self::BACKUP );
		if ( 'off' === $want ) {
			if ( $have ) {
				wp_clear_scheduled_hook( self::BACKUP );
			}
			return;
		}
		if ( $have !== $want ) {
			wp_clear_scheduled_hook( self::BACKUP );
			wp_schedule_event( time() + 600, $want, self::BACKUP );
		}
	}

	/**
	 * Remove the events (deactivation).
	 */
	public static function unschedule() {
		wp_clear_scheduled_hook( self::HOURLY );
		wp_clear_scheduled_hook( self::BACKUP );
		wp_clear_scheduled_hook( Alerts::FLUSH_HOOK );
	}

	/**
	 * Hourly: prune the log, refresh the block index (expired blocks drop out), send waiting
	 * alerts and check for new administrators.
	 */
	public static function hourly() {
		Log::prune( (int) Settings::get( 'log_retention_days' ) );
		Blocklist::rebuild_index();
		Alerts::flush();
		self::watch_admins();
	}

	/**
	 * Scheduled backup.
	 */
	public static function backup() {
		Backup::create( 'scheduled' );
	}

	/**
	 * Alert when an administrator account appears that was not there at the last check. An
	 * attacker who gets in usually adds one.
	 *
	 * @return string[] Logins of new administrators.
	 */
	public static function watch_admins() {
		$now = array();
		foreach ( get_users( array( 'role' => 'administrator', 'fields' => array( 'ID', 'user_login' ) ) ) as $user ) {
			$now[ (int) $user->ID ] = (string) $user->user_login;
		}
		$known = get_option( 'zbst_admins', null );
		update_option( 'zbst_admins', $now, false );
		if ( ! is_array( $known ) ) {
			return array();
		}
		$new = array_values( array_diff_key( $now, $known ) );
		if ( $new ) {
			/* translators: %s: comma-separated usernames */
			$text = sprintf( __( 'New administrator accounts: %s', 'zenzeiten-bastion' ), implode( ', ', $new ) );
			Log::add(
				array(
					'type'     => 'admin_change',
					'severity' => Log::SEVERITY_HIGH,
					'score'    => 0,
					'ip'       => '',
					'method'   => '',
					'uri'      => '',
					'details'  => $text,
				)
			);
			if ( Settings::get( 'alert_on_admin_change' ) ) {
				Alerts::send_now(
					__( 'New administrator account', 'zenzeiten-bastion' ),
					$text . "\n\n" . __( 'If you did not add this account, your site may be compromised: delete the account, change all passwords and consider restoring a backup.', 'zenzeiten-bastion' ) . ' ' . admin_url( 'users.php?role=administrator' )
				);
			}
		}
		return $new;
	}
}

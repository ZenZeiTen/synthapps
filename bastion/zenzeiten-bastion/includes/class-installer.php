<?php
/**
 * Activation, deactivation and schema upgrades.
 *
 * @package ZenZeiTenBastion
 */

namespace ZenZeiTenBastion;

defined( 'ABSPATH' ) || exit;

/**
 * Creates and upgrades the plugin's tables.
 */
final class Installer {

	/**
	 * Activation hook.
	 */
	public static function activate() {
		self::install();
		Cron::schedule();
		// The person activating the plugin is an administrator; spare their address from the start.
		Blocklist::remember_admin_ip( Request::ip() );
	}

	/**
	 * Deactivation hook. Data and backups stay; uninstall.php removes data when asked to.
	 */
	public static function deactivate() {
		Cron::unschedule();
	}

	/**
	 * Run install when the stored schema version is older than the code.
	 */
	public static function maybe_upgrade() {
		if ( get_option( 'zbst_db_version' ) !== ZBST_DB_VERSION ) {
			self::install();
		}
	}

	/**
	 * Create or update tables, and set first-run options.
	 */
	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( self::schema( $wpdb->get_charset_collate() ) );
		add_option( Settings::OPTION, Settings::defaults() );
		update_option( 'zbst_db_version', ZBST_DB_VERSION );
		Blocklist::rebuild_index();
	}

	/**
	 * CREATE TABLE statements in the format dbDelta() expects.
	 *
	 * @param string $charset Charset and collation clause.
	 * @return string[]
	 */
	public static function schema( $charset ) {
		$events = Log::table();
		$blocks = Blocklist::table();
		return array(
			"CREATE TABLE {$events} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  created_at datetime NOT NULL,
  ip varchar(45) NOT NULL DEFAULT '',
  type varchar(32) NOT NULL DEFAULT '',
  severity tinyint(3) unsigned NOT NULL DEFAULT 1,
  score smallint(5) unsigned NOT NULL DEFAULT 0,
  rule varchar(64) NOT NULL DEFAULT '',
  action varchar(16) NOT NULL DEFAULT '',
  method varchar(10) NOT NULL DEFAULT '',
  uri varchar(255) NOT NULL DEFAULT '',
  user_agent varchar(255) NOT NULL DEFAULT '',
  username varchar(60) NOT NULL DEFAULT '',
  details varchar(255) NOT NULL DEFAULT '',
  PRIMARY KEY  (id),
  KEY created_at (created_at),
  KEY ip_created (ip,created_at),
  KEY type_created (type,created_at)
) {$charset};",
			"CREATE TABLE {$blocks} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  ip varchar(64) NOT NULL DEFAULT '',
  source varchar(10) NOT NULL DEFAULT '',
  reason varchar(255) NOT NULL DEFAULT '',
  created_at datetime NOT NULL,
  expires_at datetime DEFAULT NULL,
  offenses int(10) unsigned NOT NULL DEFAULT 1,
  hits bigint(20) unsigned NOT NULL DEFAULT 0,
  last_hit datetime DEFAULT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY ip (ip),
  KEY expires_at (expires_at)
) {$charset};",
		);
	}
}

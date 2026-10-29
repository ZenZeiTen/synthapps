<?php
/**
 * Activation, deactivation and schema upgrades.
 *
 * @package VisitorSentinel
 */

namespace VisitorSentinel;

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
	}

	/**
	 * Deactivation hook. Data stays; uninstall.php removes it when asked to.
	 */
	public static function deactivate() {
		Cron::unschedule();
	}

	/**
	 * Run install when the stored schema version is older than the code.
	 */
	public static function maybe_upgrade() {
		if ( get_option( 'vsen_db_version' ) !== VSEN_DB_VERSION ) {
			self::install();
		}
	}

	/**
	 * Create or update tables, and set first-run options.
	 */
	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$repo    = Repository::instance();
		$charset = $wpdb->get_charset_collate();

		dbDelta( self::schema( $repo, $charset ) );

		add_option( Settings::OPTION, Settings::defaults() );
		Plugin::secret();
		update_option( 'vsen_db_version', VSEN_DB_VERSION );
		Protection::rebuild_index();
	}

	/**
	 * CREATE TABLE statements in the format dbDelta() expects.
	 *
	 * @param Repository $repo    Table names.
	 * @param string     $charset Charset and collation clause.
	 * @return string[]
	 */
	public static function schema( Repository $repo, $charset ) {
		return array(
			"CREATE TABLE {$repo->visitors} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  visitor_hash char(64) NOT NULL,
  ip varchar(45) NOT NULL DEFAULT '',
  ip_hash char(64) NOT NULL DEFAULT '',
  country char(2) NOT NULL DEFAULT '',
  user_agent varchar(512) NOT NULL DEFAULT '',
  browser varchar(40) NOT NULL DEFAULT '',
  os varchar(40) NOT NULL DEFAULT '',
  device varchar(20) NOT NULL DEFAULT '',
  is_bot tinyint(1) NOT NULL DEFAULT 0,
  user_id bigint(20) unsigned NOT NULL DEFAULT 0,
  first_seen datetime NOT NULL,
  last_seen datetime NOT NULL,
  sessions int(10) unsigned NOT NULL DEFAULT 0,
  pageviews int(10) unsigned NOT NULL DEFAULT 0,
  clicks int(10) unsigned NOT NULL DEFAULT 0,
  fraud_score tinyint(3) unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY  (id),
  UNIQUE KEY visitor_hash (visitor_hash),
  KEY ip_hash (ip_hash),
  KEY last_seen (last_seen),
  KEY fraud_score (fraud_score)
) {$charset};",
			"CREATE TABLE {$repo->sessions} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  session_key char(32) NOT NULL,
  visitor_id bigint(20) unsigned NOT NULL DEFAULT 0,
  ip varchar(45) NOT NULL DEFAULT '',
  ip_hash char(64) NOT NULL DEFAULT '',
  started_at datetime NOT NULL,
  last_activity datetime NOT NULL,
  entry_url varchar(1024) NOT NULL DEFAULT '',
  exit_url varchar(1024) NOT NULL DEFAULT '',
  referrer varchar(1024) NOT NULL DEFAULT '',
  referrer_host varchar(191) NOT NULL DEFAULT '',
  utm_source varchar(100) NOT NULL DEFAULT '',
  utm_medium varchar(100) NOT NULL DEFAULT '',
  utm_campaign varchar(191) NOT NULL DEFAULT '',
  click_id_type varchar(20) NOT NULL DEFAULT '',
  is_paid tinyint(1) NOT NULL DEFAULT 0,
  is_bot tinyint(1) NOT NULL DEFAULT 0,
  pageviews smallint(5) unsigned NOT NULL DEFAULT 0,
  duration int(10) unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY  (id),
  UNIQUE KEY session_key (session_key),
  KEY visitor_id (visitor_id),
  KEY ip_started (ip_hash,started_at),
  KEY started_at (started_at),
  KEY last_activity (last_activity)
) {$charset};",
			"CREATE TABLE {$repo->pageviews} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  session_id bigint(20) unsigned NOT NULL DEFAULT 0,
  visitor_id bigint(20) unsigned NOT NULL DEFAULT 0,
  url varchar(1024) NOT NULL DEFAULT '',
  path varchar(191) NOT NULL DEFAULT '',
  title varchar(255) NOT NULL DEFAULT '',
  referrer varchar(1024) NOT NULL DEFAULT '',
  is_bot tinyint(1) NOT NULL DEFAULT 0,
  created_at datetime NOT NULL,
  time_on_page int(10) unsigned NOT NULL DEFAULT 0,
  active_time int(10) unsigned NOT NULL DEFAULT 0,
  max_scroll tinyint(3) unsigned NOT NULL DEFAULT 0,
  interactions int(10) unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY  (id),
  KEY session_id (session_id),
  KEY visitor_id (visitor_id),
  KEY created_at (created_at),
  KEY path (path)
) {$charset};",
			"CREATE TABLE {$repo->clicks} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  click_type varchar(20) NOT NULL DEFAULT '',
  network varchar(30) NOT NULL DEFAULT '',
  visitor_id bigint(20) unsigned NOT NULL DEFAULT 0,
  session_id bigint(20) unsigned NOT NULL DEFAULT 0,
  pageview_id bigint(20) unsigned NOT NULL DEFAULT 0,
  ip varchar(45) NOT NULL DEFAULT '',
  ip_hash char(64) NOT NULL DEFAULT '',
  click_ref char(64) NOT NULL DEFAULT '',
  target varchar(1024) NOT NULL DEFAULT '',
  label varchar(191) NOT NULL DEFAULT '',
  created_at datetime NOT NULL,
  time_to_click int(11) NOT NULL DEFAULT -1,
  server_seen tinyint(1) NOT NULL DEFAULT 0,
  js_confirmed tinyint(1) NOT NULL DEFAULT 0,
  signals text NOT NULL,
  fraud_score tinyint(3) unsigned NOT NULL DEFAULT 0,
  fraud_reasons varchar(512) NOT NULL DEFAULT '',
  status tinyint(1) NOT NULL DEFAULT 0,
  reviewed tinyint(1) NOT NULL DEFAULT 0,
  finalized tinyint(1) NOT NULL DEFAULT 0,
  evaluated_at datetime NULL DEFAULT NULL,
  PRIMARY KEY  (id),
  KEY ip_created (ip_hash,created_at),
  KEY visitor_id (visitor_id),
  KEY session_id (session_id),
  KEY created_at (created_at),
  KEY click_ref (click_ref),
  KEY status_created (status,created_at),
  KEY finalized (finalized,created_at)
) {$charset};",
			"CREATE TABLE {$repo->blocklist} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  entry_key char(64) NOT NULL,
  match_type varchar(10) NOT NULL DEFAULT 'hash',
  ip_range varchar(64) NOT NULL DEFAULT '',
  ip_hash char(64) NOT NULL DEFAULT '',
  reason varchar(255) NOT NULL DEFAULT '',
  source varchar(10) NOT NULL DEFAULT 'manual',
  score tinyint(3) unsigned NOT NULL DEFAULT 0,
  created_at datetime NOT NULL,
  expires_at datetime NULL DEFAULT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY entry_key (entry_key),
  KEY expires_at (expires_at)
) {$charset};",
		);
	}
}

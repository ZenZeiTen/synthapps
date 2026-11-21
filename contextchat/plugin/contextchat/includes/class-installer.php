<?php
/**
 * Tables for the SI chat (design plan section 11): conversations, messages, quotes and events.
 *
 * They are created on activation and whenever the schema version changes, next to the 1.1
 * clicks table, which stays as it is. Times are stored in UTC.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Creates, upgrades and names the SI tables.
 */
class ContextChat_Installer {

	/** Schema version of the SI tables. Raise it when a table changes. */
	const VERSION = '1';

	/** Option holding the installed schema version. */
	const OPTION = 'contextchat_si_db_version';

	/** Table suffixes. */
	const TABLES = array( 'conversations', 'messages', 'quotes', 'events' );

	/** Crockford base32, used for ULIDs. */
	const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

	/**
	 * Create or upgrade the tables when the stored schema version differs.
	 */
	public static function maybe_install() {
		if ( get_option( self::OPTION ) !== self::VERSION ) {
			self::install();
		}
	}

	/**
	 * Full table name.
	 *
	 * @param string $name One of self::TABLES.
	 * @return string
	 */
	public static function table( $name ) {
		global $wpdb;
		return $wpdb->prefix . 'contextchat_' . $name;
	}

	/**
	 * Create or upgrade the tables.
	 */
	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$charset = $wpdb->get_charset_collate();
		$c       = self::table( 'conversations' );
		$m       = self::table( 'messages' );
		$q       = self::table( 'quotes' );
		$e       = self::table( 'events' );

		// dbDelta wants two spaces after PRIMARY KEY and one field per line.
		dbDelta(
			"CREATE TABLE {$c} (
				id char(26) NOT NULL,
				token_hash char(64) NOT NULL,
				reference varchar(24) NOT NULL,
				created_at datetime NOT NULL,
				updated_at datetime NOT NULL,
				expires_at datetime NOT NULL,
				lang varchar(5) NOT NULL,
				page_url varchar(500) NOT NULL DEFAULT '',
				rule_id varchar(64) NOT NULL DEFAULT '',
				device varchar(10) NOT NULL DEFAULT '',
				status varchar(20) NOT NULL DEFAULT 'open',
				service varchar(20) NOT NULL DEFAULT '',
				intake_json longtext NULL,
				handoff_channel varchar(10) NOT NULL DEFAULT '',
				handoff_reason varchar(20) NOT NULL DEFAULT '',
				tokens_in int(10) unsigned NOT NULL DEFAULT 0,
				tokens_out int(10) unsigned NOT NULL DEFAULT 0,
				cost_micro_usd bigint(20) unsigned NOT NULL DEFAULT 0,
				PRIMARY KEY  (id),
				UNIQUE KEY reference (reference),
				KEY expires_at (expires_at),
				KEY created_at (created_at)
			) {$charset};
			CREATE TABLE {$m} (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				conversation_id char(26) NOT NULL,
				role varchar(16) NOT NULL,
				content text NOT NULL,
				model varchar(40) NOT NULL DEFAULT '',
				created_at datetime NOT NULL,
				PRIMARY KEY  (id),
				KEY conv (conversation_id,id)
			) {$charset};
			CREATE TABLE {$q} (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				conversation_id char(26) NOT NULL,
				reference varchar(24) NOT NULL,
				input_json text NOT NULL,
				result_json text NOT NULL,
				total bigint(20) unsigned NOT NULL,
				table_version varchar(20) NOT NULL,
				created_at datetime NOT NULL,
				PRIMARY KEY  (id),
				KEY conv (conversation_id),
				UNIQUE KEY reference (reference)
			) {$charset};
			CREATE TABLE {$e} (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				conversation_id char(26) NULL,
				type varchar(30) NOT NULL,
				detail varchar(64) NOT NULL DEFAULT '',
				created_at datetime NOT NULL,
				PRIMARY KEY  (id),
				KEY type_date (type,created_at),
				KEY conv (conversation_id)
			) {$charset};"
		);
		update_option( self::OPTION, self::VERSION );
	}

	/**
	 * A ULID: 48 bits of milliseconds and 80 random bits, 26 characters, sortable by time.
	 *
	 * @param int|null $ms Milliseconds since the Unix epoch; now when null.
	 * @return string
	 */
	public static function ulid( $ms = null ) {
		if ( null === $ms ) {
			$ms = (int) floor( microtime( true ) * 1000 );
		}
		$chars = '';
		for ( $i = 0; $i < 10; $i++ ) {
			$chars = self::ULID_ALPHABET[ $ms % 32 ] . $chars;
			$ms    = intdiv( $ms, 32 );
		}
		$random = random_bytes( 10 );
		$bits   = '';
		for ( $i = 0; $i < 10; $i++ ) {
			$bits .= str_pad( decbin( ord( $random[ $i ] ) ), 8, '0', STR_PAD_LEFT );
		}
		for ( $i = 0; $i < 80; $i += 5 ) {
			$chars .= self::ULID_ALPHABET[ bindec( substr( $bits, $i, 5 ) ) ];
		}
		return $chars;
	}
}

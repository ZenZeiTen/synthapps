<?php
/**
 * Blocked addresses: automatic and manual blocks, with expiry and repeat-offender escalation.
 *
 * Every page load checks the current address against a compact index kept in an option, so a
 * blocked visitor costs no database query until the block is confirmed.
 *
 * @package ZenZeiTenBastion
 */

namespace ZenZeiTenBastion;

defined( 'ABSPATH' ) || exit;

/**
 * Reads and writes the blocks table.
 */
final class Blocklist {

	const INDEX_OPTION = 'zbst_block_index';

	/**
	 * Automatic block lengths in minutes for the 1st, 2nd, 3rd and later offence:
	 * one hour, one day, one week, thirty days.
	 */
	const ESCALATION = array( 60, 1440, 10080, 43200 );

	/**
	 * Cached index.
	 *
	 * @var array|null
	 */
	private static $index = null;

	/**
	 * Blocks table name.
	 *
	 * @return string
	 */
	public static function table() {
		global $wpdb;
		return $wpdb->prefix . 'zbst_blocks';
	}

	/**
	 * Forget the cached index (between tests).
	 */
	public static function reset() {
		self::$index = null;
	}

	/**
	 * Block an address or range.
	 *
	 * @param string   $ip      Address or CIDR range.
	 * @param string   $source  auto, login or manual.
	 * @param string   $reason  Why.
	 * @param int|null $minutes Length; null escalates for repeat offenders, 0 blocks permanently.
	 * @return array|null The block row, or null when the address is invalid or allowlisted.
	 */
	public static function add( $ip, $source, $reason, $minutes = null ) {
		global $wpdb;
		$parsed = IP::parse_range( $ip );
		if ( ! $parsed || self::is_allowlisted( $parsed['canonical'] ) ) {
			return null;
		}
		$ip       = $parsed['canonical'];
		$table    = self::table();
		$existing = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE ip = %s", $ip ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name.
		$offenses = $existing ? (int) $existing['offenses'] + 1 : 1;

		if ( null === $minutes ) {
			$minutes = self::ESCALATION[ min( $offenses, count( self::ESCALATION ) ) - 1 ];
		}
		$expires = $minutes > 0 ? gmdate( 'Y-m-d H:i:s', time() + 60 * (int) $minutes ) : null;

		$row = array(
			'ip'         => $ip,
			'source'     => sanitize_key( $source ),
			'reason'     => Request::clip( $reason, 255 ),
			'created_at' => gmdate( 'Y-m-d H:i:s' ),
			'expires_at' => $expires,
			'offenses'   => $offenses,
		);
		if ( $existing ) {
			$wpdb->update( $table, $row, array( 'id' => (int) $existing['id'] ) );
			$row['id'] = (int) $existing['id'];
		} else {
			$row['hits'] = 0;
			$wpdb->insert( $table, $row );
			$row['id'] = (int) $wpdb->insert_id;
		}
		self::rebuild_index();
		return $row;
	}

	/**
	 * Lift a block. The row stays as history so a repeat offence escalates; its expiry moves to now.
	 *
	 * @param string $ip Address or range as stored.
	 * @return bool Whether an active block was lifted.
	 */
	public static function remove( $ip ) {
		global $wpdb;
		$parsed = IP::parse_range( $ip );
		if ( ! $parsed ) {
			return false;
		}
		$table = self::table();
		$now   = gmdate( 'Y-m-d H:i:s' );
		$done  = $wpdb->query( $wpdb->prepare( "UPDATE {$table} SET expires_at = %s WHERE ip = %s AND (expires_at IS NULL OR expires_at > %s)", $now, $parsed['canonical'], $now ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name.
		self::rebuild_index();
		return $done > 0;
	}

	/**
	 * Lift a block and forget the address's history.
	 *
	 * @param int $id Row ID.
	 */
	public static function forget( $id ) {
		global $wpdb;
		$wpdb->delete( self::table(), array( 'id' => (int) $id ) );
		self::rebuild_index();
	}

	/**
	 * Active blocks, newest first.
	 *
	 * @param int $limit  Rows.
	 * @param int $offset Offset.
	 * @return array
	 */
	public static function active( $limit = 100, $offset = 0 ) {
		global $wpdb;
		$table = self::table();
		return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$table} WHERE expires_at IS NULL OR expires_at > %s ORDER BY created_at DESC, id DESC LIMIT %d OFFSET %d", gmdate( 'Y-m-d H:i:s' ), (int) $limit, (int) $offset ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name.
	}

	/**
	 * Number of active blocks.
	 *
	 * @return int
	 */
	public static function count_active() {
		global $wpdb;
		$table = self::table();
		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$table} WHERE expires_at IS NULL OR expires_at > %s", gmdate( 'Y-m-d H:i:s' ) ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name.
	}

	/**
	 * Rebuild the option the per-request check reads: exact addresses keyed for a direct lookup,
	 * ranges in a short list, each with its expiry as a Unix time (0 for permanent).
	 */
	public static function rebuild_index() {
		$index = array(
			'ips'    => array(),
			'ranges' => array(),
		);
		foreach ( self::active( 100000 ) as $row ) {
			$until = null === $row['expires_at'] || '' === $row['expires_at'] ? 0 : (int) strtotime( $row['expires_at'] . ' UTC' );
			if ( false === strpos( $row['ip'], '/' ) ) {
				$index['ips'][ $row['ip'] ] = $until;
			} else {
				$index['ranges'][] = array( $row['ip'], $until );
			}
		}
		update_option( self::INDEX_OPTION, $index, true );
		self::$index = $index;
	}

	/**
	 * The block covering an address, read from the index.
	 *
	 * @param string $ip Address.
	 * @return string|null The blocked address or range, or null when not blocked.
	 */
	public static function match( $ip ) {
		$ip = IP::normalize( $ip );
		if ( '' === $ip ) {
			return null;
		}
		if ( null === self::$index ) {
			$stored      = get_option( self::INDEX_OPTION, array() );
			self::$index = is_array( $stored ) ? $stored : array();
		}
		$now = time();
		if ( isset( self::$index['ips'][ $ip ] ) ) {
			$until = (int) self::$index['ips'][ $ip ];
			if ( 0 === $until || $until > $now ) {
				return $ip;
			}
		}
		foreach ( isset( self::$index['ranges'] ) ? self::$index['ranges'] : array() as $range ) {
			if ( ( 0 === (int) $range[1] || (int) $range[1] > $now ) && IP::in_range( $ip, $range[0] ) ) {
				return $range[0];
			}
		}
		return null;
	}

	/**
	 * Count a request that was turned away.
	 *
	 * @param string $blocked Address or range as stored.
	 */
	public static function hit( $blocked ) {
		global $wpdb;
		$table = self::table();
		$wpdb->query( $wpdb->prepare( "UPDATE {$table} SET hits = hits + 1, last_hit = %s WHERE ip = %s", gmdate( 'Y-m-d H:i:s' ), $blocked ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name.
	}

	/**
	 * Whether an address must never be blocked: on the allowlist, or the server itself.
	 *
	 * @param string $ip Address or range.
	 * @return bool
	 */
	public static function is_allowlisted( $ip ) {
		$parsed = IP::parse_range( $ip );
		if ( ! $parsed ) {
			return false;
		}
		$address = inet_ntop( $parsed['bin'] );
		if ( in_array( $address, array( '127.0.0.1', '::1' ), true ) ) {
			return true;
		}
		return IP::in_any( $address, Settings::allowlist() );
	}

	/**
	 * Remember an address an administrator signed in from, so automatic blocking spares it.
	 * Keeps the ten most recent for thirty days.
	 *
	 * @param string $ip Address.
	 */
	public static function remember_admin_ip( $ip ) {
		$ip = IP::normalize( $ip );
		if ( '' === $ip ) {
			return;
		}
		$list        = self::admin_ips();
		$list[ $ip ] = time();
		arsort( $list );
		update_option( 'zbst_admin_ips', array_slice( $list, 0, 10, true ), false );
	}

	/**
	 * Addresses administrators signed in from during the last thirty days.
	 *
	 * @return array Address => last sign-in time.
	 */
	public static function admin_ips() {
		$list = get_option( 'zbst_admin_ips', array() );
		$out  = array();
		foreach ( is_array( $list ) ? $list : array() as $ip => $time ) {
			if ( (int) $time > time() - 30 * DAY_IN_SECONDS ) {
				$out[ (string) $ip ] = (int) $time;
			}
		}
		return $out;
	}

	/**
	 * Whether automatic blocking must spare an address because an administrator used it recently.
	 *
	 * @param string $ip Address.
	 * @return bool
	 */
	public static function is_admin_ip( $ip ) {
		return Settings::get( 'protect_admin_ips' ) && isset( self::admin_ips()[ IP::normalize( $ip ) ] );
	}
}

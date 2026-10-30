<?php
/**
 * Security event log.
 *
 * Every query here runs on MySQL and on the SQLite database the tests use.
 *
 * @package ZenZeiTenBastion
 */

namespace ZenZeiTenBastion;

defined( 'ABSPATH' ) || exit;

/**
 * Reads and writes the events table.
 */
final class Log {

	const SEVERITY_LOW      = 1;
	const SEVERITY_MEDIUM   = 2;
	const SEVERITY_HIGH     = 3;
	const SEVERITY_CRITICAL = 4;

	/**
	 * Threat score each severity adds to the address that caused it.
	 */
	const WEIGHTS = array(
		1 => 0,
		2 => 3,
		3 => 5,
		4 => 10,
	);

	/**
	 * Events table name.
	 *
	 * @return string
	 */
	public static function table() {
		global $wpdb;
		return $wpdb->prefix . 'zbst_events';
	}

	/**
	 * Human names for event types.
	 *
	 * @return array
	 */
	public static function types() {
		return array(
			'firewall'      => __( 'Firewall rule', 'zenzeiten-bastion' ),
			'login_failed'  => __( 'Failed login', 'zenzeiten-bastion' ),
			'login_ok'      => __( 'Administrator login', 'zenzeiten-bastion' ),
			'blocked'       => __( 'Blocked address', 'zenzeiten-bastion' ),
			'enumeration'   => __( 'User enumeration', 'zenzeiten-bastion' ),
			'xmlrpc'        => __( 'XML-RPC', 'zenzeiten-bastion' ),
			'not_found'     => __( '404 flood', 'zenzeiten-bastion' ),
			'rate_limit'    => __( 'Rate limit', 'zenzeiten-bastion' ),
			'auto_block'    => __( 'Automatic block', 'zenzeiten-bastion' ),
			'manual_block'  => __( 'Manual block', 'zenzeiten-bastion' ),
			'unblock'       => __( 'Unblock', 'zenzeiten-bastion' ),
			'backup'        => __( 'Backup', 'zenzeiten-bastion' ),
			'restore'       => __( 'Restore', 'zenzeiten-bastion' ),
			'admin_change'  => __( 'Administrator change', 'zenzeiten-bastion' ),
		);
	}

	/**
	 * Human names for severities.
	 *
	 * @return array
	 */
	public static function severities() {
		return array(
			self::SEVERITY_LOW      => __( 'Info', 'zenzeiten-bastion' ),
			self::SEVERITY_MEDIUM   => __( 'Medium', 'zenzeiten-bastion' ),
			self::SEVERITY_HIGH     => __( 'High', 'zenzeiten-bastion' ),
			self::SEVERITY_CRITICAL => __( 'Critical', 'zenzeiten-bastion' ),
		);
	}

	/**
	 * Record an event. Missing request details are filled in from the current request.
	 *
	 * @param array $event Keys: type, severity, rule, action, details, ip, username, method, uri, user_agent.
	 * @return int Event ID.
	 */
	public static function add( array $event ) {
		global $wpdb;
		$severity = isset( $event['severity'] ) ? max( 1, min( 4, (int) $event['severity'] ) ) : self::SEVERITY_LOW;
		$row      = array(
			'created_at' => gmdate( 'Y-m-d H:i:s' ),
			'ip'         => isset( $event['ip'] ) ? (string) $event['ip'] : Request::ip(),
			'type'       => isset( $event['type'] ) ? sanitize_key( $event['type'] ) : 'firewall',
			'severity'   => $severity,
			'score'      => isset( $event['score'] ) ? max( 0, (int) $event['score'] ) : self::WEIGHTS[ $severity ],
			'rule'       => Request::clip( isset( $event['rule'] ) ? $event['rule'] : '', 64 ),
			'action'     => Request::clip( isset( $event['action'] ) ? $event['action'] : 'logged', 16 ),
			'method'     => Request::clip( isset( $event['method'] ) ? $event['method'] : Request::method(), 10 ),
			'uri'        => Request::clip( isset( $event['uri'] ) ? $event['uri'] : Request::uri(), 255 ),
			'user_agent' => Request::clip( isset( $event['user_agent'] ) ? $event['user_agent'] : Request::user_agent(), 255 ),
			'username'   => Request::clip( isset( $event['username'] ) ? $event['username'] : '', 60 ),
			'details'    => Request::clip( isset( $event['details'] ) ? $event['details'] : '', 255 ),
		);
		$wpdb->insert( self::table(), $row );
		return (int) $wpdb->insert_id;
	}

	/**
	 * UTC datetime string a number of minutes ago.
	 *
	 * @param int $minutes Minutes.
	 * @return string
	 */
	public static function ago( $minutes ) {
		return gmdate( 'Y-m-d H:i:s', time() - 60 * (int) $minutes );
	}

	/**
	 * Threat score an address built up over a window.
	 *
	 * @param string $ip      Address.
	 * @param int    $minutes Window.
	 * @return int
	 */
	public static function score( $ip, $minutes ) {
		global $wpdb;
		$table = self::table();
		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COALESCE(SUM(score), 0) FROM {$table} WHERE ip = %s AND created_at >= %s", $ip, self::ago( $minutes ) ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name.
	}

	/**
	 * How many events of a type an address caused over a window.
	 *
	 * @param string $ip      Address.
	 * @param string $type    Event type.
	 * @param int    $minutes Window.
	 * @return int
	 */
	public static function count_for( $ip, $type, $minutes ) {
		global $wpdb;
		$table = self::table();
		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$table} WHERE ip = %s AND type = %s AND created_at >= %s", $ip, $type, self::ago( $minutes ) ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name.
	}

	/**
	 * Events newer than an ID, oldest first (the live feed).
	 *
	 * @param int $after Last ID the client has.
	 * @param int $limit Maximum rows.
	 * @return array
	 */
	public static function after( $after, $limit = 50 ) {
		global $wpdb;
		$table = self::table();
		$rows  = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$table} WHERE id > %d ORDER BY id DESC LIMIT %d", (int) $after, max( 1, min( 200, (int) $limit ) ) ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name.
		return array_reverse( $rows );
	}

	/**
	 * WHERE clause and arguments for a filtered event list.
	 *
	 * @param array $filters Keys: type, ip, severity (minimum), blocked (bool).
	 * @return array Clause and arguments.
	 */
	private static function where( array $filters ) {
		$where = array( '1 = 1' );
		$args  = array();
		if ( ! empty( $filters['type'] ) ) {
			$where[] = 'type = %s';
			$args[]  = (string) $filters['type'];
		}
		if ( ! empty( $filters['ip'] ) ) {
			$where[] = 'ip = %s';
			$args[]  = (string) $filters['ip'];
		}
		if ( ! empty( $filters['severity'] ) ) {
			$where[] = 'severity >= %d';
			$args[]  = (int) $filters['severity'];
		}
		if ( ! empty( $filters['blocked'] ) ) {
			$where[] = "action IN ('blocked', 'locked')";
		}
		return array( implode( ' AND ', $where ), $args );
	}

	/**
	 * A page of events, newest first.
	 *
	 * @param array $filters See where().
	 * @param int   $limit   Rows.
	 * @param int   $offset  Offset.
	 * @return array
	 */
	public static function query( array $filters, $limit, $offset ) {
		global $wpdb;
		$table                 = self::table();
		list( $where, $args )  = self::where( $filters );
		$args[]                = max( 1, (int) $limit );
		$args[]                = max( 0, (int) $offset );
		return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$table} WHERE {$where} ORDER BY id DESC LIMIT %d OFFSET %d", $args ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name and fixed clauses.
	}

	/**
	 * Number of events matching filters.
	 *
	 * @param array $filters See where().
	 * @return int
	 */
	public static function count( array $filters ) {
		global $wpdb;
		$table                = self::table();
		list( $where, $args ) = self::where( $filters );
		$sql                  = "SELECT COUNT(*) FROM {$table} WHERE {$where}";
		return (int) $wpdb->get_var( $args ? $wpdb->prepare( $sql, $args ) : $sql ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- table name and fixed clauses; values prepared.
	}

	/**
	 * Dashboard numbers for the last day.
	 *
	 * @return array
	 */
	public static function stats() {
		global $wpdb;
		$table = self::table();
		$since = self::ago( 24 * 60 );

		$by_type = array();
		foreach ( $wpdb->get_results( $wpdb->prepare( "SELECT type, COUNT(*) AS n FROM {$table} WHERE created_at >= %s GROUP BY type", $since ), ARRAY_A ) as $row ) { // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name.
			$by_type[ $row['type'] ] = (int) $row['n'];
		}

		$blocked = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$table} WHERE created_at >= %s AND action IN ('blocked', 'locked')", $since ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name.

		// One bar per hour, oldest first, so empty hours show as zero.
		$hours = array();
		$now   = time();
		for ( $i = 23; $i >= 0; $i-- ) {
			$hours[ gmdate( 'Y-m-d H', $now - $i * 3600 ) ] = 0;
		}
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT SUBSTR(created_at, 1, 13) AS h, COUNT(*) AS n FROM {$table} WHERE created_at >= %s AND severity >= %d GROUP BY SUBSTR(created_at, 1, 13)", $since, self::SEVERITY_MEDIUM ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name.
		foreach ( $rows as $row ) {
			if ( isset( $hours[ $row['h'] ] ) ) {
				$hours[ $row['h'] ] = (int) $row['n'];
			}
		}

		$top = $wpdb->get_results( $wpdb->prepare( "SELECT ip, COUNT(*) AS n, SUM(score) AS score, MAX(created_at) AS last_seen FROM {$table} WHERE created_at >= %s AND severity >= %d AND ip <> '' GROUP BY ip ORDER BY score DESC, n DESC LIMIT 10", $since, self::SEVERITY_MEDIUM ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name.

		return array(
			'by_type' => $by_type,
			'blocked' => $blocked,
			'hours'   => $hours,
			'top'     => $top,
		);
	}

	/**
	 * Delete events older than a number of days.
	 *
	 * @param int $days Days to keep.
	 * @return int Rows deleted.
	 */
	public static function prune( $days ) {
		global $wpdb;
		$table = self::table();
		return (int) $wpdb->query( $wpdb->prepare( "DELETE FROM {$table} WHERE created_at < %s", self::ago( max( 1, (int) $days ) * 24 * 60 ) ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name.
	}
}

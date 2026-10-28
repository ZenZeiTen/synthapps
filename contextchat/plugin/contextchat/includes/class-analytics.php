<?php
/**
 * Click analytics: a small table, a public endpoint that records clicks, and report queries.
 *
 * Only what is needed to answer "which pages and agents bring conversations" is stored: the
 * time, the page path, the agent, the rule, the button location and the device class. No IP
 * address, cookie or message text is kept.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Analytics.
 */
class ContextChat_Analytics {

	const CRON = 'contextchat_prune';

	/** Clicks one visitor may record per minute. */
	const RATE_LIMIT = 20;

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
		add_action( self::CRON, array( __CLASS__, 'prune' ) );
		if ( get_option( 'contextchat_db_version' ) !== CONTEXTCHAT_DB_VERSION ) {
			self::install();
		}
	}

	/**
	 * Table name.
	 *
	 * @return string
	 */
	public static function table() {
		global $wpdb;
		return $wpdb->prefix . 'contextchat_clicks';
	}

	/**
	 * Activation: create the table and schedule pruning.
	 */
	public static function activate() {
		self::install();
		if ( ! wp_next_scheduled( self::CRON ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', self::CRON );
		}
	}

	/**
	 * Deactivation: stop pruning. Data stays until the plugin is deleted.
	 */
	public static function deactivate() {
		wp_clear_scheduled_hook( self::CRON );
	}

	/**
	 * Create or upgrade the table.
	 */
	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$table   = self::table();
		$charset = $wpdb->get_charset_collate();
		dbDelta(
			"CREATE TABLE {$table} (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				created_at datetime NOT NULL,
				post_id bigint(20) unsigned NOT NULL DEFAULT 0,
				path varchar(191) NOT NULL DEFAULT '',
				agent varchar(32) NOT NULL DEFAULT '',
				rule varchar(32) NOT NULL DEFAULT '',
				source varchar(16) NOT NULL DEFAULT '',
				device varchar(8) NOT NULL DEFAULT '',
				PRIMARY KEY  (id),
				KEY created_at (created_at),
				KEY path (path)
			) {$charset};"
		);
		update_option( 'contextchat_db_version', CONTEXTCHAT_DB_VERSION );
	}

	/**
	 * REST routes.
	 */
	public static function routes() {
		register_rest_route(
			'contextchat/v1',
			'/click',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'record' ),
				// Public on purpose: visitors are not logged in and pages may be cached, so a
				// nonce would go stale. Input is validated and rate limited instead.
				'permission_callback' => '__return_true',
				'args'                => array(
					'post'   => array( 'type' => 'integer', 'default' => 0, 'minimum' => 0 ),
					'path'   => array( 'type' => 'string', 'default' => '' ),
					'agent'  => array( 'type' => 'string', 'default' => '' ),
					'rule'   => array( 'type' => 'string', 'default' => '' ),
					'source' => array( 'type' => 'string', 'default' => 'float', 'enum' => array( 'float', 'shortcode', 'product', 'block' ) ),
					'device' => array( 'type' => 'string', 'default' => '', 'enum' => array( '', 'mobile', 'desktop' ) ),
				),
			)
		);
	}

	/**
	 * Record a click.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function record( WP_REST_Request $request ) {
		if ( empty( ContextChat_Settings::get()['analytics'] ) ) {
			return new WP_REST_Response( array( 'recorded' => false ), 200 );
		}

		if ( ! self::within_rate_limit() ) {
			return new WP_Error( 'contextchat_rate_limited', __( 'Too many requests.', 'contextchat' ), array( 'status' => 429 ) );
		}

		$path = (string) wp_parse_url( (string) $request['path'], PHP_URL_PATH );
		$path = substr( '/' . ltrim( sanitize_text_field( $path ), '/' ), 0, 191 );

		global $wpdb;
		$ok = $wpdb->insert( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			self::table(),
			array(
				'created_at' => current_time( 'mysql', true ),
				'post_id'    => absint( $request['post'] ),
				'path'       => $path,
				'agent'      => substr( sanitize_key( $request['agent'] ), 0, 32 ),
				'rule'       => substr( sanitize_key( $request['rule'] ), 0, 32 ),
				'source'     => $request['source'],
				'device'     => $request['device'],
			),
			array( '%s', '%d', '%s', '%s', '%s', '%s', '%s' )
		);

		return new WP_REST_Response( array( 'recorded' => (bool) $ok ), $ok ? 201 : 500 );
	}

	/**
	 * Count this visitor's clicks in the current minute. The address is only hashed, never stored.
	 *
	 * @return bool
	 */
	private static function within_rate_limit() {
		$ip  = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
		$key = 'contextchat_rl_' . md5( $ip . wp_salt( 'nonce' ) . gmdate( 'YmdHi' ) );
		$n   = (int) get_transient( $key );
		if ( $n >= self::RATE_LIMIT ) {
			return false;
		}
		set_transient( $key, $n + 1, 2 * MINUTE_IN_SECONDS );
		return true;
	}

	/**
	 * Delete clicks older than the retention period.
	 */
	public static function prune() {
		global $wpdb;
		$days   = (int) ContextChat_Settings::get()['retention_days'];
		$cutoff = gmdate( 'Y-m-d H:i:s', time() - $days * DAY_IN_SECONDS );
		$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE created_at < %s', self::table(), $cutoff ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
	}

	/**
	 * Report for the last N days.
	 *
	 * @param int $days Days to cover, including today.
	 * @return array{total: int, previous: int, daily: array, pages: array, agents: array, sources: array, devices: array}
	 */
	public static function report( $days ) {
		global $wpdb;
		$days  = max( 1, (int) $days );
		$table = self::table();
		$start = gmdate( 'Y-m-d 00:00:00', time() - ( $days - 1 ) * DAY_IN_SECONDS );
		$prev  = gmdate( 'Y-m-d 00:00:00', time() - ( 2 * $days - 1 ) * DAY_IN_SECONDS );

		// phpcs:disable WordPress.DB.DirectDatabaseQuery
		$total    = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE created_at >= %s', $table, $start ) );
		$previous = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE created_at >= %s AND created_at < %s', $table, $prev, $start ) );
		$by_day   = $wpdb->get_results( $wpdb->prepare( 'SELECT DATE(created_at) AS d, COUNT(*) AS n FROM %i WHERE created_at >= %s GROUP BY DATE(created_at)', $table, $start ), ARRAY_A );
		$pages    = $wpdb->get_results( $wpdb->prepare( 'SELECT path, MAX(post_id) AS post_id, COUNT(*) AS n FROM %i WHERE created_at >= %s GROUP BY path ORDER BY n DESC LIMIT 10', $table, $start ), ARRAY_A );
		$agents   = $wpdb->get_results( $wpdb->prepare( 'SELECT agent, COUNT(*) AS n FROM %i WHERE created_at >= %s GROUP BY agent ORDER BY n DESC', $table, $start ), ARRAY_A );
		$sources  = $wpdb->get_results( $wpdb->prepare( 'SELECT source, COUNT(*) AS n FROM %i WHERE created_at >= %s GROUP BY source ORDER BY n DESC', $table, $start ), ARRAY_A );
		$devices  = $wpdb->get_results( $wpdb->prepare( 'SELECT device, COUNT(*) AS n FROM %i WHERE created_at >= %s GROUP BY device ORDER BY n DESC', $table, $start ), ARRAY_A );
		// phpcs:enable

		$counts = array();
		foreach ( (array) $by_day as $row ) {
			$counts[ $row['d'] ] = (int) $row['n'];
		}
		$daily = array();
		for ( $i = $days - 1; $i >= 0; $i-- ) {
			$d           = gmdate( 'Y-m-d', time() - $i * DAY_IN_SECONDS );
			$daily[ $d ] = isset( $counts[ $d ] ) ? $counts[ $d ] : 0;
		}

		return array(
			'total'    => $total,
			'previous' => $previous,
			'daily'    => $daily,
			'pages'    => (array) $pages,
			'agents'   => (array) $agents,
			'sources'  => (array) $sources,
			'devices'  => (array) $devices,
		);
	}

	/**
	 * All clicks in a period, oldest first, for CSV export.
	 *
	 * @param int $days Days to cover.
	 * @return array
	 */
	public static function rows( $days ) {
		global $wpdb;
		$start = gmdate( 'Y-m-d 00:00:00', time() - ( max( 1, (int) $days ) - 1 ) * DAY_IN_SECONDS );
		return (array) $wpdb->get_results( $wpdb->prepare( 'SELECT created_at, post_id, path, agent, rule, source, device FROM %i WHERE created_at >= %s ORDER BY id ASC', self::table(), $start ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
	}
}

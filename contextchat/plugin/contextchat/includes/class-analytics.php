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

	/** Where a button can be: the floating button, a shortcode, a block or the product button. */
	const SOURCES = array( 'float', 'shortcode', 'block', 'product' );

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
		add_action( self::CRON, array( __CLASS__, 'prune' ) );
		if ( get_option( 'contextchat_db_version' ) !== CONTEXTCHAT_DB_VERSION ) {
			self::install();
		}
		// Activation schedules pruning, but not on every site of a network, and schedules get lost.
		if ( is_admin() ) {
			self::schedule();
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
		self::schedule();
	}

	/**
	 * Schedule daily pruning, unless it already is.
	 */
	private static function schedule() {
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
					'source' => array( 'type' => 'string', 'default' => 'float', 'enum' => self::SOURCES ),
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
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';

		/**
		 * Filter the visitor address used for rate limiting. Behind a proxy or CDN that does not
		 * put the visitor's address in REMOTE_ADDR, every visitor shares one limit; return the
		 * real address here (from a header your proxy sets and you trust).
		 *
		 * @param string $ip Address from REMOTE_ADDR.
		 */
		$ip  = (string) apply_filters( 'contextchat_client_ip', $ip );
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
	 * Report for the last N days. Days are days in the site time zone.
	 *
	 * @param int $days Days to cover, including today.
	 * @return array{total: int, previous: int, daily: array, pages: array, agents: array, sources: array, devices: array}
	 */
	public static function report( $days ) {
		global $wpdb;
		$days  = max( 1, (int) $days );
		$table = self::table();
		$start = self::day_start( $days - 1 );
		$prev  = self::day_start( 2 * $days - 1 );

		// phpcs:disable WordPress.DB.DirectDatabaseQuery
		$total    = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE created_at >= %s', $table, $start ) );
		$previous = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE created_at >= %s AND created_at < %s', $table, $prev, $start ) );
		// Counted per quarter of an hour, the finest step any time zone is offset by, so that
		// daily_counts() can put each click on the right local day.
		$slots    = $wpdb->get_results( $wpdb->prepare( 'SELECT DATE(created_at) AS d, HOUR(created_at) AS h, FLOOR(MINUTE(created_at) / 15) AS q, COUNT(*) AS n FROM %i WHERE created_at >= %s GROUP BY d, h, q', $table, $start ), ARRAY_A );
		$pages    = $wpdb->get_results( $wpdb->prepare( 'SELECT path, MAX(post_id) AS post_id, COUNT(*) AS n FROM %i WHERE created_at >= %s GROUP BY path ORDER BY n DESC LIMIT 10', $table, $start ), ARRAY_A );
		$agents   = $wpdb->get_results( $wpdb->prepare( 'SELECT agent, COUNT(*) AS n FROM %i WHERE created_at >= %s GROUP BY agent ORDER BY n DESC', $table, $start ), ARRAY_A );
		$sources  = $wpdb->get_results( $wpdb->prepare( 'SELECT source, COUNT(*) AS n FROM %i WHERE created_at >= %s GROUP BY source ORDER BY n DESC', $table, $start ), ARRAY_A );
		$devices  = $wpdb->get_results( $wpdb->prepare( 'SELECT device, COUNT(*) AS n FROM %i WHERE created_at >= %s GROUP BY device ORDER BY n DESC', $table, $start ), ARRAY_A );
		// phpcs:enable

		return array(
			'total'    => $total,
			'previous' => $previous,
			'daily'    => self::daily_counts( (array) $slots, $days, wp_timezone(), time() ),
			'pages'    => (array) $pages,
			'agents'   => (array) $agents,
			'sources'  => (array) $sources,
			'devices'  => (array) $devices,
		);
	}

	/**
	 * Clicks per local day, oldest first, with a zero for days without clicks.
	 *
	 * Clicks are stored in UTC. Each slot is a quarter of an hour of UTC time; it counts towards
	 * the day it falls on in the given time zone, which also follows daylight saving changes.
	 *
	 * @param array        $slots Rows with d (UTC date), h (hour), q (quarter, 0-3) and n (clicks).
	 * @param int          $days  Days to cover, including today.
	 * @param DateTimeZone $tz    Time zone the days are in.
	 * @param int          $now   Current Unix time.
	 * @return array<string, int> Counts keyed by Y-m-d.
	 */
	public static function daily_counts( array $slots, $days, DateTimeZone $tz, $now ) {
		$today = ( new DateTimeImmutable( '@' . (int) $now ) )->setTimezone( $tz )->setTime( 0, 0 );
		$daily = array();
		for ( $i = max( 1, (int) $days ) - 1; $i >= 0; $i-- ) {
			$daily[ $today->modify( '-' . $i . ' days' )->format( 'Y-m-d' ) ] = 0;
		}

		$utc = new DateTimeZone( 'UTC' );
		foreach ( $slots as $slot ) {
			$at = DateTimeImmutable::createFromFormat( '!Y-m-d G:i', sprintf( '%s %d:%02d', $slot['d'], $slot['h'], 15 * $slot['q'] ), $utc );
			if ( ! $at ) {
				continue;
			}
			$day = $at->setTimezone( $tz )->format( 'Y-m-d' );
			if ( isset( $daily[ $day ] ) ) {
				$daily[ $day ] += (int) $slot['n'];
			}
		}
		return $daily;
	}

	/**
	 * All clicks in a period, oldest first, for CSV export.
	 *
	 * @param int $days Days to cover, including today.
	 * @return array
	 */
	public static function rows( $days ) {
		global $wpdb;
		$start = self::day_start( max( 1, (int) $days ) - 1 );
		return (array) $wpdb->get_results( $wpdb->prepare( 'SELECT created_at, post_id, path, agent, rule, source, device FROM %i WHERE created_at >= %s ORDER BY id ASC', self::table(), $start ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
	}

	/**
	 * When a day began in the site time zone, as the UTC time the table stores.
	 *
	 * @param int $days_ago 0 for today, 1 for yesterday, and so on.
	 * @return string Y-m-d H:i:s in UTC.
	 */
	private static function day_start( $days_ago ) {
		$midnight = new DateTimeImmutable( 'today', wp_timezone() );
		return $midnight->modify( '-' . (int) $days_ago . ' days' )->setTimezone( new DateTimeZone( 'UTC' ) )->format( 'Y-m-d H:i:s' );
	}
}

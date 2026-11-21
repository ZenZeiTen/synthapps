<?php
/**
 * SI chat analytics: the funnel from chat started to handoff clicked, refusals, errors and cost,
 * from the conversations and events tables. Message text is never read here.
 *
 * Times are stored in UTC; periods start at midnight in the site time zone.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * SI analytics.
 */
class ContextChat_SI_Analytics {

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'admin_post_contextchat_si_export', array( __CLASS__, 'export' ) );
	}

	/**
	 * When a day began in the site time zone, in UTC.
	 *
	 * @param int $days_ago 0 for today.
	 * @return string Y-m-d H:i:s.
	 */
	public static function day_start( $days_ago ) {
		$midnight = new DateTimeImmutable( 'today', wp_timezone() );
		return $midnight->modify( '-' . (int) $days_ago . ' days' )->setTimezone( new DateTimeZone( 'UTC' ) )->format( 'Y-m-d H:i:s' );
	}

	/**
	 * Whether there is anything to show: the SI chat is on, or chats are stored.
	 *
	 * @return bool
	 */
	public static function has_data() {
		global $wpdb;
		if ( ! empty( ContextChat_Settings::get()['si_enabled'] ) ) {
			return true;
		}
		return (bool) $wpdb->get_var( $wpdb->prepare( 'SELECT 1 FROM %i LIMIT 1', ContextChat_Installer::table( 'conversations' ) ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
	}

	/**
	 * The report for the last $days days, today included.
	 *
	 * @param int $days Days.
	 * @return array started, engaged, quoted, offered, clicked, channels, events, cost_micro_usd, services, devices.
	 */
	public static function report( $days ) {
		global $wpdb;
		$start = self::day_start( max( 1, (int) $days ) - 1 );
		$c     = ContextChat_Installer::table( 'conversations' );
		$m     = ContextChat_Installer::table( 'messages' );
		$e     = ContextChat_Installer::table( 'events' );

		// phpcs:disable WordPress.DB.DirectDatabaseQuery
		$started = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE created_at >= %s', $c, $start ) );
		$engaged = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(DISTINCT m.conversation_id) FROM %i m JOIN %i c ON c.id = m.conversation_id WHERE m.role = 'visitor' AND c.created_at >= %s", $m, $c, $start ) );
		$steps   = $wpdb->get_results( $wpdb->prepare( "SELECT e.type, COUNT(DISTINCT e.conversation_id) AS n FROM %i e JOIN %i c ON c.id = e.conversation_id WHERE e.type IN ('quote_shown', 'handoff_offered', 'handoff_clicked') AND c.created_at >= %s GROUP BY e.type", $e, $c, $start ), ARRAY_A );
		$chans   = $wpdb->get_results( $wpdb->prepare( "SELECT e.detail AS channel, COUNT(DISTINCT e.conversation_id) AS n FROM %i e JOIN %i c ON c.id = e.conversation_id WHERE e.type = 'handoff_clicked' AND c.created_at >= %s GROUP BY e.detail ORDER BY n DESC", $e, $c, $start ), ARRAY_A );
		$events  = $wpdb->get_results( $wpdb->prepare( "SELECT type, COUNT(*) AS n FROM %i WHERE created_at >= %s AND type NOT IN ('chat_started', 'quote_shown', 'handoff_offered', 'handoff_clicked', 'consent', 'retention_deleted', 'admin_deleted') GROUP BY type ORDER BY n DESC", $e, $start ), ARRAY_A );
		$cost    = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COALESCE(SUM(cost_micro_usd), 0) FROM %i WHERE created_at >= %s', $c, $start ) );
		$service = $wpdb->get_results( $wpdb->prepare( 'SELECT service, COUNT(*) AS n FROM %i WHERE created_at >= %s GROUP BY service ORDER BY n DESC', $c, $start ), ARRAY_A );
		$device  = $wpdb->get_results( $wpdb->prepare( 'SELECT device, COUNT(*) AS n FROM %i WHERE created_at >= %s GROUP BY device ORDER BY n DESC', $c, $start ), ARRAY_A );
		// phpcs:enable

		$step = array(
			'quote_shown'     => 0,
			'handoff_offered' => 0,
			'handoff_clicked' => 0,
		);
		foreach ( (array) $steps as $row ) {
			$step[ $row['type'] ] = (int) $row['n'];
		}
		return array(
			'started'        => $started,
			'engaged'        => $engaged,
			'quoted'         => $step['quote_shown'],
			'offered'        => $step['handoff_offered'],
			'clicked'        => $step['handoff_clicked'],
			'channels'       => (array) $chans,
			'events'         => (array) $events,
			'cost_micro_usd' => $cost,
			'services'       => (array) $service,
			'devices'        => (array) $device,
		);
	}

	/**
	 * One row per conversation for the CSV: no message text, no token, no IP address.
	 *
	 * @param int $days Days.
	 * @return array
	 */
	public static function rows( $days ) {
		global $wpdb;
		$start = self::day_start( max( 1, (int) $days ) - 1 );
		return (array) $wpdb->get_results( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->prepare(
				"SELECT c.created_at, c.reference, c.lang, c.device, c.page_url, c.status, c.service, c.handoff_reason, c.handoff_channel,
					(SELECT COUNT(*) FROM %i m WHERE m.conversation_id = c.id AND m.role = 'visitor') AS visitor_messages,
					(SELECT COUNT(*) FROM %i q WHERE q.conversation_id = c.id) AS estimates,
					(SELECT q2.total FROM %i q2 WHERE q2.conversation_id = c.id ORDER BY q2.id DESC LIMIT 1) AS last_estimate_idr,
					c.cost_micro_usd
				FROM %i c WHERE c.created_at >= %s ORDER BY c.created_at ASC",
				ContextChat_Installer::table( 'messages' ),
				ContextChat_Installer::table( 'quotes' ),
				ContextChat_Installer::table( 'quotes' ),
				ContextChat_Installer::table( 'conversations' ),
				$start
			),
			ARRAY_A
		);
	}

	/**
	 * Download the SI chats as CSV.
	 */
	public static function export() {
		if ( ! current_user_can( ContextChat_Admin::CAP ) ) {
			wp_die( esc_html__( 'You are not allowed to export this data.', 'contextchat' ), 403 );
		}
		check_admin_referer( 'contextchat_si_export' );
		$days = isset( $_GET['range'] ) ? absint( $_GET['range'] ) : ContextChat_Admin_Analytics::DEFAULT_RANGE;
		$days = in_array( $days, ContextChat_Admin_Analytics::RANGES, true ) ? $days : ContextChat_Admin_Analytics::DEFAULT_RANGE;

		nocache_headers();
		header( 'Content-Type: text/csv; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename=contextchat-si-chats-' . gmdate( 'Y-m-d' ) . '.csv' );

		$out = fopen( 'php://output', 'w' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fopen
		fputcsv( $out, array( 'time_utc', 'reference', 'lang', 'device', 'path', 'status', 'service', 'handoff_reason', 'handoff_channel', 'visitor_messages', 'estimates', 'last_estimate_idr', 'cost_usd' ) );
		foreach ( self::rows( $days ) as $row ) {
			$row['cost_micro_usd'] = number_format( (int) $row['cost_micro_usd'] / 1000000, 6, '.', '' );
			// Neutralise spreadsheet formulas in text cells.
			$row = array_map(
				static function ( $v ) {
					return preg_match( '/^[=+\-@\t\r]/', (string) $v ) ? "'" . $v : $v;
				},
				$row
			);
			fputcsv( $out, $row );
		}
		fclose( $out ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose
		exit;
	}
}

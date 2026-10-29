<?php
/**
 * Database access. Every query in the plugin lives here.
 *
 * Queries use only SQL that MySQL, MariaDB and SQLite all understand, so the plugin also runs
 * on WordPress sites that use the SQLite database integration.
 *
 * @package VisitorSentinel
 */

namespace VisitorSentinel;

defined( 'ABSPATH' ) || exit;

/**
 * Table access for visitors, sessions, pageviews, clicks and the blocklist.
 */
final class Repository {

	const AD_TYPES = array( 'ad_landing', 'ad_click' );

	/**
	 * Shared instance.
	 *
	 * @var Repository|null
	 */
	private static $instance = null;

	/**
	 * Database.
	 *
	 * @var \wpdb
	 */
	private $db;

	/**
	 * Table names.
	 *
	 * @var string
	 */
	public $visitors;
	/**
	 * Sessions table.
	 *
	 * @var string
	 */
	public $sessions;
	/**
	 * Pageviews table.
	 *
	 * @var string
	 */
	public $pageviews;
	/**
	 * Clicks table.
	 *
	 * @var string
	 */
	public $clicks;
	/**
	 * Blocklist table.
	 *
	 * @var string
	 */
	public $blocklist;

	/**
	 * Constructor.
	 */
	public function __construct() {
		global $wpdb;
		$this->db        = $wpdb;
		$prefix          = $wpdb->prefix . 'vsen_';
		$this->visitors  = $prefix . 'visitors';
		$this->sessions  = $prefix . 'sessions';
		$this->pageviews = $prefix . 'pageviews';
		$this->clicks    = $prefix . 'clicks';
		$this->blocklist = $prefix . 'blocklist';
	}

	/**
	 * Shared instance.
	 *
	 * @return Repository
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Drop the shared instance (tests switch databases).
	 */
	public static function reset() {
		self::$instance = null;
	}

	/**
	 * Current UTC time in MySQL format.
	 *
	 * @param int $offset Seconds to add.
	 * @return string
	 */
	public static function now( $offset = 0 ) {
		return gmdate( 'Y-m-d H:i:s', time() + (int) $offset );
	}

	/**
	 * All table names.
	 *
	 * @return string[]
	 */
	public function tables() {
		return array( $this->visitors, $this->sessions, $this->pageviews, $this->clicks, $this->blocklist );
	}

	// ---------------------------------------------------------------------------------------------
	// Visitors.
	// ---------------------------------------------------------------------------------------------

	/**
	 * Visitor by ID.
	 *
	 * @param int $id ID.
	 * @return object|null
	 */
	public function get_visitor( $id ) {
		return $this->db->get_row( $this->db->prepare( "SELECT * FROM {$this->visitors} WHERE id = %d", $id ) );
	}

	/**
	 * Visitor by hash.
	 *
	 * @param string $hash Visitor hash.
	 * @return object|null
	 */
	public function get_visitor_by_hash( $hash ) {
		return $this->db->get_row( $this->db->prepare( "SELECT * FROM {$this->visitors} WHERE visitor_hash = %s", $hash ) );
	}

	/**
	 * Create or refresh a visitor and return its ID.
	 *
	 * @param string $hash Visitor hash.
	 * @param array  $data Columns: ip, ip_hash, country, user_agent, browser, os, device, is_bot, user_id.
	 * @return int
	 */
	public function upsert_visitor( $hash, array $data ) {
		$now      = self::now();
		$existing = $this->get_visitor_by_hash( $hash );
		$columns  = array(
			'ip'         => (string) $data['ip'],
			'ip_hash'    => (string) $data['ip_hash'],
			'country'    => (string) $data['country'],
			'user_agent' => (string) $data['user_agent'],
			'browser'    => (string) $data['browser'],
			'os'         => (string) $data['os'],
			'device'     => (string) $data['device'],
			'is_bot'     => (int) $data['is_bot'],
			'last_seen'  => $now,
		);
		if ( ! empty( $data['user_id'] ) ) {
			$columns['user_id'] = (int) $data['user_id'];
		}
		if ( $existing ) {
			$this->db->update( $this->visitors, $columns, array( 'id' => (int) $existing->id ) );
			return (int) $existing->id;
		}
		$columns['visitor_hash'] = $hash;
		$columns['first_seen']   = $now;
		if ( false === $this->db->insert( $this->visitors, $columns ) ) {
			// Another request created it a moment ago.
			$existing = $this->get_visitor_by_hash( $hash );
			return $existing ? (int) $existing->id : 0;
		}
		return (int) $this->db->insert_id;
	}

	/**
	 * Add to a visitor's counters.
	 *
	 * @param int    $id     Visitor ID.
	 * @param string $column sessions, pageviews or clicks.
	 */
	public function bump_visitor( $id, $column ) {
		if ( in_array( $column, array( 'sessions', 'pageviews', 'clicks' ), true ) ) {
			$this->db->query( $this->db->prepare( "UPDATE {$this->visitors} SET {$column} = {$column} + 1 WHERE id = %d", $id ) );
		}
	}

	/**
	 * Raise a visitor's fraud score to the highest of their click scores.
	 *
	 * @param int $id Visitor ID.
	 */
	public function refresh_visitor_score( $id ) {
		$max = (int) $this->db->get_var( $this->db->prepare( "SELECT MAX(fraud_score) FROM {$this->clicks} WHERE visitor_id = %d AND reviewed <> 1", $id ) );
		$this->db->update( $this->visitors, array( 'fraud_score' => $max ), array( 'id' => (int) $id ) );
	}

	/**
	 * Visitors for the admin list.
	 *
	 * @param array $args search, filter (all|suspicious|bots|humans), orderby, order, limit, offset.
	 * @return array Keys rows and total.
	 */
	public function list_visitors( array $args ) {
		list( $where, $params ) = $this->visitor_filters( $args );

		$orderby = in_array( $args['orderby'], array( 'last_seen', 'first_seen', 'pageviews', 'sessions', 'clicks', 'fraud_score' ), true ) ? $args['orderby'] : 'last_seen';
		$order   = 'ASC' === strtoupper( (string) $args['order'] ) ? 'ASC' : 'DESC';

		$total = (int) $this->db->get_var( $this->maybe_prepare( "SELECT COUNT(*) FROM {$this->visitors} WHERE {$where}", $params ) );
		$sql   = "SELECT * FROM {$this->visitors} WHERE {$where} ORDER BY {$orderby} {$order}, id DESC LIMIT %d OFFSET %d";
		$rows  = $this->db->get_results( $this->db->prepare( $sql, array_merge( $params, array( (int) $args['limit'], (int) $args['offset'] ) ) ) );

		return array(
			'rows'  => $rows ? $rows : array(),
			'total' => $total,
		);
	}

	/**
	 * Counts for the visitor list views.
	 *
	 * @return int[]
	 */
	public function visitor_view_counts() {
		$row = $this->db->get_row(
			$this->db->prepare(
				"SELECT COUNT(*) AS total_count,
					SUM(CASE WHEN is_bot = 0 THEN 1 ELSE 0 END) AS humans,
					SUM(CASE WHEN is_bot = 1 THEN 1 ELSE 0 END) AS bots,
					SUM(CASE WHEN fraud_score >= %d THEN 1 ELSE 0 END) AS suspicious
				FROM {$this->visitors}",
				Fraud_Engine::SUSPICIOUS_AT
			)
		);
		return array(
			'all'        => $row ? (int) $row->total_count : 0,
			'humans'     => $row ? (int) $row->humans : 0,
			'bots'       => $row ? (int) $row->bots : 0,
			'suspicious' => $row ? (int) $row->suspicious : 0,
		);
	}

	/**
	 * WHERE clause for visitor filters.
	 *
	 * @param array $args Arguments.
	 * @return array SQL and params.
	 */
	private function visitor_filters( array $args ) {
		$where  = array( '1=1' );
		$params = array();
		switch ( isset( $args['filter'] ) ? $args['filter'] : 'all' ) {
			case 'suspicious':
				$where[]  = 'fraud_score >= %d';
				$params[] = Fraud_Engine::SUSPICIOUS_AT;
				break;
			case 'bots':
				$where[] = 'is_bot = 1';
				break;
			case 'humans':
				$where[] = 'is_bot = 0';
				break;
		}
		if ( ! empty( $args['search'] ) ) {
			$search = (string) $args['search'];
			$ip     = IP::normalize( $search );
			if ( '' !== $ip ) {
				$where[]  = '(ip_hash = %s OR ip = %s)';
				$params[] = Request_Context::hash_ip( $ip );
				$params[] = $ip;
			} else {
				$like     = '%' . $this->db->esc_like( $search ) . '%';
				$where[]  = '(ip LIKE %s OR user_agent LIKE %s OR country LIKE %s)';
				$params[] = $like;
				$params[] = $like;
				$params[] = $like;
			}
		}
		return array( implode( ' AND ', $where ), $params );
	}

	// ---------------------------------------------------------------------------------------------
	// Sessions.
	// ---------------------------------------------------------------------------------------------

	/**
	 * Session by ID.
	 *
	 * @param int $id ID.
	 * @return object|null
	 */
	public function get_session( $id ) {
		return $this->db->get_row( $this->db->prepare( "SELECT * FROM {$this->sessions} WHERE id = %d", $id ) );
	}

	/**
	 * Session by client key.
	 *
	 * @param string $key Session key.
	 * @return object|null
	 */
	public function get_session_by_key( $key ) {
		return $this->db->get_row( $this->db->prepare( "SELECT * FROM {$this->sessions} WHERE session_key = %s", $key ) );
	}

	/**
	 * A visitor's newest session that is still active.
	 *
	 * @param int    $visitor_id Visitor ID.
	 * @param string $since      Oldest last_activity to accept.
	 * @return object|null
	 */
	public function get_active_session( $visitor_id, $since ) {
		return $this->db->get_row( $this->db->prepare( "SELECT * FROM {$this->sessions} WHERE visitor_id = %d AND last_activity >= %s ORDER BY last_activity DESC LIMIT 1", $visitor_id, $since ) );
	}

	/**
	 * Insert a session.
	 *
	 * @param array $data Columns.
	 * @return int
	 */
	public function insert_session( array $data ) {
		$now  = self::now();
		$data = array_merge(
			array(
				'started_at'    => $now,
				'last_activity' => $now,
				'pageviews'     => 0,
				'duration'      => 0,
			),
			$data
		);
		if ( false === $this->db->insert( $this->sessions, $data ) ) {
			$existing = $this->get_session_by_key( $data['session_key'] );
			return $existing ? (int) $existing->id : 0;
		}
		return (int) $this->db->insert_id;
	}

	/**
	 * Record activity on a session.
	 *
	 * @param object $session      Session row.
	 * @param string $exit_url     Latest URL, or '' to leave it.
	 * @param bool   $pageview     Whether this activity is a new pageview.
	 * @param int    $min_duration Duration in seconds the browser measured, if larger.
	 */
	public function touch_session( $session, $exit_url = '', $pageview = false, $min_duration = 0 ) {
		$now      = time();
		$duration = max( (int) $session->duration, $now - (int) strtotime( $session->started_at . ' UTC' ), (int) $min_duration );
		$sql      = "UPDATE {$this->sessions} SET last_activity = %s, duration = %d";
		$params   = array( gmdate( 'Y-m-d H:i:s', $now ), min( $duration, 86400 ) );
		if ( '' !== $exit_url ) {
			$sql     .= ', exit_url = %s';
			$params[] = $exit_url;
		}
		if ( $pageview ) {
			$sql .= ', pageviews = pageviews + 1';
		}
		$params[] = (int) $session->id;
		$this->db->query( $this->db->prepare( $sql . ' WHERE id = %d', $params ) );
	}

	/**
	 * Mark a session as coming from a paid click.
	 *
	 * @param int    $id      Session ID.
	 * @param string $network Ad network.
	 */
	public function mark_session_paid( $id, $network ) {
		$this->db->update(
			$this->sessions,
			array(
				'is_paid'       => 1,
				'click_id_type' => substr( (string) $network, 0, 20 ),
			),
			array( 'id' => (int) $id )
		);
	}

	/**
	 * Sessions of a visitor, newest first.
	 *
	 * @param int $visitor_id Visitor ID.
	 * @param int $limit      Limit.
	 * @return array
	 */
	public function visitor_sessions( $visitor_id, $limit = 50 ) {
		return $this->db->get_results( $this->db->prepare( "SELECT * FROM {$this->sessions} WHERE visitor_id = %d ORDER BY started_at DESC LIMIT %d", $visitor_id, $limit ) );
	}

	/**
	 * Engagement totals for a session.
	 *
	 * @param int $session_id Session ID.
	 * @return array Keys pageviews, time, interactions, scroll.
	 */
	public function session_engagement( $session_id ) {
		$row = $this->db->get_row( $this->db->prepare( "SELECT COUNT(*) AS pages, SUM(time_on_page) AS total_time, SUM(interactions) AS total_interactions, MAX(max_scroll) AS scroll FROM {$this->pageviews} WHERE session_id = %d", $session_id ) );
		return array(
			'pageviews'    => $row ? (int) $row->pages : 0,
			'time'         => $row ? (int) $row->total_time : 0,
			'interactions' => $row ? (int) $row->total_interactions : 0,
			'scroll'       => $row ? (int) $row->scroll : 0,
		);
	}

	/**
	 * Distinct visitor IDs on one IP since a time.
	 *
	 * @param string $ip_hash IP hash.
	 * @param string $since   Since.
	 * @return int
	 */
	public function count_visitors_on_ip( $ip_hash, $since ) {
		return (int) $this->db->get_var( $this->db->prepare( "SELECT COUNT(DISTINCT visitor_id) FROM {$this->sessions} WHERE ip_hash = %s AND started_at >= %s", $ip_hash, $since ) );
	}

	// ---------------------------------------------------------------------------------------------
	// Pageviews.
	// ---------------------------------------------------------------------------------------------

	/**
	 * Pageview by ID.
	 *
	 * @param int $id ID.
	 * @return object|null
	 */
	public function get_pageview( $id ) {
		return $this->db->get_row( $this->db->prepare( "SELECT * FROM {$this->pageviews} WHERE id = %d", $id ) );
	}

	/**
	 * Insert a pageview.
	 *
	 * @param array $data Columns.
	 * @return int
	 */
	public function insert_pageview( array $data ) {
		$data = array_merge(
			array(
				'created_at'   => self::now(),
				'time_on_page' => 0,
				'active_time'  => 0,
				'max_scroll'   => 0,
				'interactions' => 0,
			),
			$data
		);
		$this->db->insert( $this->pageviews, $data );
		return (int) $this->db->insert_id;
	}

	/**
	 * Store engagement for a pageview. Values only ever grow, so late or repeated beacons are harmless.
	 *
	 * @param object $pageview Pageview row.
	 * @param array  $data     time_on_page, active_time, max_scroll, interactions.
	 */
	public function update_engagement( $pageview, array $data ) {
		$this->db->update(
			$this->pageviews,
			array(
				'time_on_page' => max( (int) $pageview->time_on_page, (int) $data['time_on_page'] ),
				'active_time'  => max( (int) $pageview->active_time, (int) $data['active_time'] ),
				'max_scroll'   => max( (int) $pageview->max_scroll, (int) $data['max_scroll'] ),
				'interactions' => max( (int) $pageview->interactions, (int) $data['interactions'] ),
			),
			array( 'id' => (int) $pageview->id )
		);
	}

	/**
	 * Pageviews of a visitor, newest first.
	 *
	 * @param int $visitor_id Visitor ID.
	 * @param int $limit      Limit.
	 * @return array
	 */
	public function visitor_pageviews( $visitor_id, $limit = 200 ) {
		return $this->db->get_results( $this->db->prepare( "SELECT * FROM {$this->pageviews} WHERE visitor_id = %d ORDER BY created_at DESC, id DESC LIMIT %d", $visitor_id, $limit ) );
	}

	// ---------------------------------------------------------------------------------------------
	// Clicks.
	// ---------------------------------------------------------------------------------------------

	/**
	 * Click by ID.
	 *
	 * @param int $id ID.
	 * @return object|null
	 */
	public function get_click( $id ) {
		return $this->db->get_row( $this->db->prepare( "SELECT * FROM {$this->clicks} WHERE id = %d", $id ) );
	}

	/**
	 * Ad landing clicks with this click reference, oldest first.
	 *
	 * @param string $ref Click reference hash.
	 * @return array
	 */
	public function clicks_by_ref( $ref ) {
		return $this->db->get_results( $this->db->prepare( "SELECT * FROM {$this->clicks} WHERE click_ref = %s ORDER BY id ASC LIMIT 50", $ref ) );
	}

	/**
	 * Insert a click.
	 *
	 * @param array $data Columns.
	 * @return int
	 */
	public function insert_click( array $data ) {
		$data = array_merge(
			array(
				'click_type'    => 'tracked',
				'network'       => '',
				'visitor_id'    => 0,
				'session_id'    => 0,
				'pageview_id'   => 0,
				'ip'            => '',
				'ip_hash'       => '',
				'click_ref'     => '',
				'target'        => '',
				'label'         => '',
				'created_at'    => self::now(),
				'time_to_click' => -1,
				'server_seen'   => 0,
				'js_confirmed'  => 0,
				'signals'       => '{}',
				'fraud_score'   => 0,
				'fraud_reasons' => '',
				'status'        => 0,
				'reviewed'      => 0,
				'finalized'     => 0,
			),
			$data
		);
		$this->db->insert( $this->clicks, $data );
		return (int) $this->db->insert_id;
	}

	/**
	 * Update a click.
	 *
	 * @param int   $id   Click ID.
	 * @param array $data Columns.
	 */
	public function update_click( $id, array $data ) {
		$this->db->update( $this->clicks, $data, array( 'id' => (int) $id ) );
	}

	/**
	 * Ad clicks (landings and on-site) from one IP since a time.
	 *
	 * @param string $ip_hash IP hash.
	 * @param string $since   Since.
	 * @param int    $until_id Count only clicks up to and including this ID.
	 * @return int
	 */
	public function count_ip_ad_clicks( $ip_hash, $since, $until_id ) {
		return (int) $this->db->get_var(
			$this->db->prepare(
				"SELECT COUNT(*) FROM {$this->clicks} WHERE ip_hash = %s AND created_at >= %s AND id <= %d AND click_type IN ('ad_landing', 'ad_click')",
				$ip_hash,
				$since,
				$until_id
			)
		);
	}

	/**
	 * Earlier clicks on the same on-site ad by the same visitor or IP.
	 *
	 * @param object $click Click row.
	 * @param string $since Since.
	 * @return int
	 */
	public function count_same_target( $click, $since ) {
		return (int) $this->db->get_var(
			$this->db->prepare(
				"SELECT COUNT(*) FROM {$this->clicks} WHERE click_type = 'ad_click' AND id < %d AND created_at >= %s AND target = %s AND label = %s AND (visitor_id = %d OR ip_hash = %s)",
				(int) $click->id,
				$since,
				(string) $click->target,
				(string) $click->label,
				(int) $click->visitor_id,
				(string) $click->ip_hash
			)
		);
	}

	/**
	 * IDs of a session's ad landings that are still open for re-scoring.
	 *
	 * @param int $session_id Session ID.
	 * @return int[]
	 */
	public function session_landings( $session_id ) {
		return array_map( 'intval', (array) $this->db->get_col( $this->db->prepare( "SELECT id FROM {$this->clicks} WHERE session_id = %d AND click_type = 'ad_landing' AND finalized = 0 LIMIT 5", $session_id ) ) );
	}

	/**
	 * Attach a click to a visitor.
	 *
	 * @param int $click_id   Click ID.
	 * @param int $visitor_id Visitor ID.
	 */
	public function set_click_visitor( $click_id, $visitor_id ) {
		$this->db->update( $this->clicks, array( 'visitor_id' => (int) $visitor_id ), array( 'id' => (int) $click_id ) );
	}

	/**
	 * Ad landings not yet given their final score.
	 *
	 * @param string $before Created before this time.
	 * @param int    $limit  Limit.
	 * @return array
	 */
	public function unfinalized_clicks( $before, $limit = 500 ) {
		return $this->db->get_results( $this->db->prepare( "SELECT * FROM {$this->clicks} WHERE finalized = 0 AND created_at < %s ORDER BY id ASC LIMIT %d", $before, $limit ) );
	}

	/**
	 * Clicks for the admin list.
	 *
	 * @param array $args filter, search, visitor_id, orderby, order, limit, offset.
	 * @return array rows and total.
	 */
	public function list_clicks( array $args ) {
		$where  = array( '1=1' );
		$params = array();
		switch ( isset( $args['filter'] ) ? $args['filter'] : 'all' ) {
			case 'fraud':
				$where[] = 'c.status = 2';
				break;
			case 'suspicious':
				$where[] = 'c.status = 1';
				break;
			case 'clean':
				$where[] = "c.status = 0 AND c.click_type IN ('ad_landing', 'ad_click')";
				break;
			case 'landing':
				$where[] = "c.click_type = 'ad_landing'";
				break;
			case 'onsite':
				$where[] = "c.click_type = 'ad_click'";
				break;
			case 'activity':
				$where[] = "c.click_type NOT IN ('ad_landing', 'ad_click')";
				break;
			default:
				$where[] = "c.click_type IN ('ad_landing', 'ad_click')";
		}
		if ( ! empty( $args['visitor_id'] ) ) {
			$where[]  = 'c.visitor_id = %d';
			$params[] = (int) $args['visitor_id'];
		}
		if ( ! empty( $args['search'] ) ) {
			$ip = IP::normalize( (string) $args['search'] );
			if ( '' !== $ip ) {
				$where[]  = '(c.ip_hash = %s OR c.ip = %s)';
				$params[] = Request_Context::hash_ip( $ip );
				$params[] = $ip;
			} else {
				$like     = '%' . $this->db->esc_like( (string) $args['search'] ) . '%';
				$where[]  = '(c.ip LIKE %s OR c.target LIKE %s OR c.label LIKE %s OR c.network LIKE %s)';
				$params   = array_merge( $params, array( $like, $like, $like, $like ) );
			}
		}
		$where   = implode( ' AND ', $where );
		$orderby = in_array( isset( $args['orderby'] ) ? $args['orderby'] : '', array( 'created_at', 'fraud_score' ), true ) ? 'c.' . $args['orderby'] : 'c.created_at';
		$order   = isset( $args['order'] ) && 'ASC' === strtoupper( (string) $args['order'] ) ? 'ASC' : 'DESC';

		$total = (int) $this->db->get_var( $this->maybe_prepare( "SELECT COUNT(*) FROM {$this->clicks} c WHERE {$where}", $params ) );
		$sql   = "SELECT c.*, v.country, v.browser, v.os, v.device, v.is_bot FROM {$this->clicks} c LEFT JOIN {$this->visitors} v ON v.id = c.visitor_id WHERE {$where} ORDER BY {$orderby} {$order}, c.id DESC LIMIT %d OFFSET %d";
		$rows  = $this->db->get_results( $this->db->prepare( $sql, array_merge( $params, array( (int) $args['limit'], (int) $args['offset'] ) ) ) );

		return array(
			'rows'  => $rows ? $rows : array(),
			'total' => $total,
		);
	}

	/**
	 * Counts for the click list views.
	 *
	 * @return int[]
	 */
	public function click_view_counts() {
		$row = $this->db->get_row(
			"SELECT
				SUM(CASE WHEN click_type IN ('ad_landing', 'ad_click') THEN 1 ELSE 0 END) AS ads,
				SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) AS fraud,
				SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS suspicious,
				SUM(CASE WHEN status = 0 AND click_type IN ('ad_landing', 'ad_click') THEN 1 ELSE 0 END) AS clean,
				SUM(CASE WHEN click_type = 'ad_landing' THEN 1 ELSE 0 END) AS landing,
				SUM(CASE WHEN click_type = 'ad_click' THEN 1 ELSE 0 END) AS onsite,
				SUM(CASE WHEN click_type NOT IN ('ad_landing', 'ad_click') THEN 1 ELSE 0 END) AS activity
			FROM {$this->clicks}"
		);
		$out = array();
		foreach ( array( 'all' => 'ads', 'fraud' => 'fraud', 'suspicious' => 'suspicious', 'clean' => 'clean', 'landing' => 'landing', 'onsite' => 'onsite', 'activity' => 'activity' ) as $view => $col ) {
			$out[ $view ] = $row ? (int) $row->$col : 0;
		}
		return $out;
	}

	/**
	 * Fraudulent clicks newer than an ID, for alerts.
	 *
	 * @param int $after_id Last ID already reported.
	 * @param int $limit    Limit.
	 * @return array
	 */
	public function fraud_clicks_after( $after_id, $limit = 25 ) {
		return $this->db->get_results( $this->db->prepare( "SELECT * FROM {$this->clicks} WHERE id > %d AND status = 2 AND reviewed = 0 ORDER BY id ASC LIMIT %d", $after_id, $limit ) );
	}

	/**
	 * Highest click ID.
	 *
	 * @return int
	 */
	public function max_click_id() {
		return (int) $this->db->get_var( "SELECT MAX(id) FROM {$this->clicks}" );
	}

	/**
	 * Clicks of a visitor, newest first.
	 *
	 * @param int $visitor_id Visitor ID.
	 * @param int $limit      Limit.
	 * @return array
	 */
	public function visitor_clicks( $visitor_id, $limit = 200 ) {
		return $this->db->get_results( $this->db->prepare( "SELECT * FROM {$this->clicks} WHERE visitor_id = %d ORDER BY created_at DESC, id DESC LIMIT %d", $visitor_id, $limit ) );
	}

	// ---------------------------------------------------------------------------------------------
	// Blocklist.
	// ---------------------------------------------------------------------------------------------

	/**
	 * Add or extend a blocklist entry.
	 *
	 * @param array $entry entry_key, match_type, ip_range, ip_hash, reason, source, score, expires_at.
	 * @return int Entry ID.
	 */
	public function upsert_block( array $entry ) {
		$existing = $this->db->get_row( $this->db->prepare( "SELECT * FROM {$this->blocklist} WHERE entry_key = %s", $entry['entry_key'] ) );
		if ( $existing ) {
			$update = array(
				'reason'     => $entry['reason'],
				'score'      => max( (int) $existing->score, (int) $entry['score'] ),
				'expires_at' => $entry['expires_at'],
			);
			// A manual block is never downgraded to an automatic one.
			if ( 'manual' === $entry['source'] ) {
				$update['source'] = 'manual';
			}
			if ( '' === (string) $existing->ip_range && '' !== (string) $entry['ip_range'] ) {
				$update['ip_range'] = $entry['ip_range'];
			}
			$this->db->update( $this->blocklist, $update, array( 'id' => (int) $existing->id ) );
			return (int) $existing->id;
		}
		$entry['created_at'] = self::now();
		$this->db->insert( $this->blocklist, $entry );
		return (int) $this->db->insert_id;
	}

	/**
	 * Remove a blocklist entry.
	 *
	 * @param int $id Entry ID.
	 */
	public function delete_block( $id ) {
		$this->db->delete( $this->blocklist, array( 'id' => (int) $id ) );
	}

	/**
	 * Remove the entry for one IP hash.
	 *
	 * @param string $ip_hash IP hash.
	 */
	public function delete_block_by_hash( $ip_hash ) {
		$this->db->delete( $this->blocklist, array( 'entry_key' => $ip_hash ) );
	}

	/**
	 * Entry by ID.
	 *
	 * @param int $id ID.
	 * @return object|null
	 */
	public function get_block( $id ) {
		return $this->db->get_row( $this->db->prepare( "SELECT * FROM {$this->blocklist} WHERE id = %d", $id ) );
	}

	/**
	 * Active entries (not expired).
	 *
	 * @return array
	 */
	public function active_blocks() {
		return $this->db->get_results( $this->db->prepare( "SELECT * FROM {$this->blocklist} WHERE expires_at IS NULL OR expires_at > %s ORDER BY created_at DESC", self::now() ) );
	}

	/**
	 * Entries for the admin list.
	 *
	 * @param array $args search, limit, offset.
	 * @return array rows and total.
	 */
	public function list_blocks( array $args ) {
		$where  = '1=1';
		$params = array();
		if ( ! empty( $args['search'] ) ) {
			$where   .= ' AND (ip_range LIKE %s OR reason LIKE %s)';
			$like     = '%' . $this->db->esc_like( (string) $args['search'] ) . '%';
			$params[] = $like;
			$params[] = $like;
		}
		$total = (int) $this->db->get_var( $this->maybe_prepare( "SELECT COUNT(*) FROM {$this->blocklist} WHERE {$where}", $params ) );
		$rows  = $this->db->get_results( $this->db->prepare( "SELECT * FROM {$this->blocklist} WHERE {$where} ORDER BY created_at DESC, id DESC LIMIT %d OFFSET %d", array_merge( $params, array( (int) $args['limit'], (int) $args['offset'] ) ) ) );
		return array(
			'rows'  => $rows ? $rows : array(),
			'total' => $total,
		);
	}

	/**
	 * Delete expired entries.
	 *
	 * @return int Rows removed.
	 */
	public function delete_expired_blocks() {
		return (int) $this->db->query( $this->db->prepare( "DELETE FROM {$this->blocklist} WHERE expires_at IS NOT NULL AND expires_at <= %s", self::now() ) );
	}

	// ---------------------------------------------------------------------------------------------
	// Maintenance.
	// ---------------------------------------------------------------------------------------------

	/**
	 * Delete tracking data older than a time.
	 *
	 * @param string $before Cut-off.
	 */
	public function purge_before( $before ) {
		$this->db->query( $this->db->prepare( "DELETE FROM {$this->pageviews} WHERE created_at < %s", $before ) );
		$this->db->query( $this->db->prepare( "DELETE FROM {$this->clicks} WHERE created_at < %s", $before ) );
		$this->db->query( $this->db->prepare( "DELETE FROM {$this->sessions} WHERE last_activity < %s", $before ) );
		$this->db->query( $this->db->prepare( "DELETE FROM {$this->visitors} WHERE last_seen < %s", $before ) );
	}

	/**
	 * Delete all tracking data (the blocklist stays).
	 */
	public function truncate_tracking() {
		foreach ( array( $this->pageviews, $this->clicks, $this->sessions, $this->visitors ) as $table ) {
			$this->db->query( "DELETE FROM {$table}" );
		}
	}

	// ---------------------------------------------------------------------------------------------
	// Reports.
	// ---------------------------------------------------------------------------------------------

	/**
	 * Headline numbers for a period.
	 *
	 * @param string $from Start (UTC).
	 * @param string $to   End (UTC).
	 * @return array
	 */
	public function summary( $from, $to ) {
		$s = $this->db->get_row(
			$this->db->prepare(
				"SELECT COUNT(*) AS sessions, COUNT(DISTINCT visitor_id) AS visitors, AVG(duration) AS avg_duration,
					SUM(CASE WHEN pageviews <= 1 THEN 1 ELSE 0 END) AS bounces
				FROM {$this->sessions} WHERE started_at >= %s AND started_at < %s AND is_bot = 0",
				$from,
				$to
			)
		);
		$pageviews = (int) $this->db->get_var( $this->db->prepare( "SELECT COUNT(*) FROM {$this->pageviews} WHERE created_at >= %s AND created_at < %s AND is_bot = 0", $from, $to ) );
		$c         = $this->db->get_row(
			$this->db->prepare(
				"SELECT SUM(CASE WHEN click_type = 'ad_landing' THEN 1 ELSE 0 END) AS landings,
					SUM(CASE WHEN click_type = 'ad_click' THEN 1 ELSE 0 END) AS onsite,
					SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS suspicious,
					SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) AS fraud
				FROM {$this->clicks} WHERE created_at >= %s AND created_at < %s AND click_type IN ('ad_landing', 'ad_click')",
				$from,
				$to
			)
		);
		$blocks = (int) $this->db->get_var( $this->db->prepare( "SELECT COUNT(*) FROM {$this->blocklist} WHERE expires_at IS NULL OR expires_at > %s", self::now() ) );

		$sessions = $s ? (int) $s->sessions : 0;
		$ads      = $c ? (int) $c->landings + (int) $c->onsite : 0;
		$fraud    = $c ? (int) $c->fraud : 0;

		return array(
			'visitors'     => $s ? (int) $s->visitors : 0,
			'sessions'     => $sessions,
			'pageviews'    => $pageviews,
			'avg_duration' => $s ? (int) round( (float) $s->avg_duration ) : 0,
			'bounce_rate'  => $sessions ? round( 100 * (int) $s->bounces / $sessions, 1 ) : 0,
			'paid_clicks'  => $c ? (int) $c->landings : 0,
			'onsite_ads'   => $c ? (int) $c->onsite : 0,
			'suspicious'   => $c ? (int) $c->suspicious : 0,
			'fraud'        => $fraud,
			'fraud_rate'   => $ads ? round( 100 * $fraud / $ads, 1 ) : 0,
			'blocked'      => $blocks,
		);
	}

	/**
	 * Hourly counts in UTC, keyed by "Y-m-d H". The caller folds hours into local days.
	 *
	 * @param string $from Start (UTC).
	 * @return array Keys pageviews, visitors, ads, fraud; each an array of hour => count.
	 */
	public function hourly_series( $from ) {
		$out = array(
			'pageviews' => array(),
			'visitors'  => array(),
			'ads'       => array(),
			'fraud'     => array(),
		);

		$rows = $this->db->get_results( $this->db->prepare( "SELECT SUBSTR(created_at, 1, 13) AS hr, COUNT(*) AS n FROM {$this->pageviews} WHERE created_at >= %s AND is_bot = 0 GROUP BY SUBSTR(created_at, 1, 13)", $from ) );
		foreach ( (array) $rows as $r ) {
			$out['pageviews'][ $r->hr ] = (int) $r->n;
		}
		// Visitors are counted per session start; a visitor with sessions on two days counts on both.
		$rows = $this->db->get_results( $this->db->prepare( "SELECT SUBSTR(started_at, 1, 13) AS hr, visitor_id FROM {$this->sessions} WHERE started_at >= %s AND is_bot = 0 GROUP BY SUBSTR(started_at, 1, 13), visitor_id", $from ) );
		foreach ( (array) $rows as $r ) {
			$out['visitors'][ $r->hr ][ (int) $r->visitor_id ] = true;
		}
		$rows = $this->db->get_results(
			$this->db->prepare(
				"SELECT SUBSTR(created_at, 1, 13) AS hr, COUNT(*) AS n, SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) AS fraud
				FROM {$this->clicks} WHERE created_at >= %s AND click_type IN ('ad_landing', 'ad_click') GROUP BY SUBSTR(created_at, 1, 13)",
				$from
			)
		);
		foreach ( (array) $rows as $r ) {
			$out['ads'][ $r->hr ]   = (int) $r->n;
			$out['fraud'][ $r->hr ] = (int) $r->fraud;
		}
		return $out;
	}

	/**
	 * Top values of a breakdown for a period.
	 *
	 * @param string $dimension pages, referrers, devices, browsers, os, countries, campaigns, networks.
	 * @param string $from      Start (UTC).
	 * @param string $to        End (UTC).
	 * @param int    $limit     Limit.
	 * @return array Rows with label and n (networks also have fraud).
	 */
	public function breakdown( $dimension, $from, $to, $limit = 10 ) {
		$s = $this->sessions;
		$v = $this->visitors;
		switch ( $dimension ) {
			case 'pages':
				$sql = "SELECT path AS label, MAX(title) AS title, COUNT(*) AS n FROM {$this->pageviews} WHERE created_at >= %s AND created_at < %s AND is_bot = 0 GROUP BY path ORDER BY n DESC LIMIT %d";
				break;
			case 'referrers':
				$sql = "SELECT referrer_host AS label, COUNT(*) AS n FROM {$s} WHERE started_at >= %s AND started_at < %s AND is_bot = 0 AND referrer_host <> '' GROUP BY referrer_host ORDER BY n DESC LIMIT %d";
				break;
			case 'campaigns':
				$sql = "SELECT utm_source AS label, utm_campaign AS title, COUNT(*) AS n FROM {$s} WHERE started_at >= %s AND started_at < %s AND is_bot = 0 AND utm_source <> '' GROUP BY utm_source, utm_campaign ORDER BY n DESC LIMIT %d";
				break;
			case 'devices':
			case 'browsers':
			case 'os':
			case 'countries':
				$columns = array(
					'devices'   => 'device',
					'browsers'  => 'browser',
					'os'        => 'os',
					'countries' => 'country',
				);
				$col     = $columns[ $dimension ];
				$sql     = "SELECT v.{$col} AS label, COUNT(*) AS n FROM {$s} s JOIN {$v} v ON v.id = s.visitor_id WHERE s.started_at >= %s AND s.started_at < %s AND s.is_bot = 0 GROUP BY v.{$col} ORDER BY n DESC LIMIT %d";
				break;
			case 'networks':
				$sql = "SELECT network AS label, COUNT(*) AS n, SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) AS fraud FROM {$this->clicks} WHERE created_at >= %s AND created_at < %s AND click_type IN ('ad_landing', 'ad_click') GROUP BY network ORDER BY n DESC LIMIT %d";
				break;
			default:
				return array();
		}
		$rows = $this->db->get_results( $this->db->prepare( $sql, $from, $to, $limit ) );
		return $rows ? $rows : array();
	}

	/**
	 * Sessions active in the last few minutes.
	 *
	 * @param int $minutes Window.
	 * @param int $limit   Limit.
	 * @return array
	 */
	public function live_sessions( $minutes = 5, $limit = 15 ) {
		return $this->db->get_results(
			$this->db->prepare(
				"SELECT s.id, s.visitor_id, s.exit_url, s.last_activity, s.pageviews, s.is_paid, s.referrer_host, v.ip, v.ip_hash, v.country, v.device, v.browser, v.fraud_score
				FROM {$this->sessions} s JOIN {$this->visitors} v ON v.id = s.visitor_id
				WHERE s.last_activity >= %s AND s.is_bot = 0 ORDER BY s.last_activity DESC LIMIT %d",
				self::now( -60 * $minutes ),
				$limit
			)
		);
	}

	/**
	 * Count of sessions active in the last few minutes.
	 *
	 * @param int $minutes Window.
	 * @return int
	 */
	public function live_count( $minutes = 5 ) {
		return (int) $this->db->get_var( $this->db->prepare( "SELECT COUNT(*) FROM {$this->sessions} WHERE last_activity >= %s AND is_bot = 0", self::now( -60 * $minutes ) ) );
	}

	/**
	 * Rows for CSV export.
	 *
	 * @param string $what visitors or clicks.
	 * @param int    $limit Limit.
	 * @return array
	 */
	public function export_rows( $what, $limit = 50000 ) {
		if ( 'clicks' === $what ) {
			return $this->db->get_results( $this->db->prepare( "SELECT id, created_at, click_type, network, ip, visitor_id, session_id, target, label, time_to_click, fraud_score, fraud_reasons, status, reviewed FROM {$this->clicks} ORDER BY id DESC LIMIT %d", $limit ), ARRAY_A );
		}
		return $this->db->get_results( $this->db->prepare( "SELECT id, ip, country, browser, os, device, is_bot, first_seen, last_seen, sessions, pageviews, clicks, fraud_score, user_agent FROM {$this->visitors} ORDER BY last_seen DESC LIMIT %d", $limit ), ARRAY_A );
	}

	/**
	 * Prepare only when there are parameters (wpdb::prepare() requires at least one).
	 *
	 * @param string $sql    SQL.
	 * @param array  $params Parameters.
	 * @return string
	 */
	private function maybe_prepare( $sql, array $params ) {
		return empty( $params ) ? $sql : $this->db->prepare( $sql, $params );
	}
}

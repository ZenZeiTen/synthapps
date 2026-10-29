<?php
/**
 * Front-end tracking: the tracker script, the collect endpoint and server-side ad landing capture.
 *
 * @package VisitorSentinel
 */

namespace VisitorSentinel;

defined( 'ABSPATH' ) || exit;

/**
 * Receives pageviews, engagement and clicks from the tracker script.
 *
 * The collect endpoint takes no nonce for anonymous visitors, because full-page caches would
 * serve stale nonces. It defends itself instead: payloads are size-limited and validated,
 * URLs must belong to this site, engagement updates need a per-pageview HMAC token, and every
 * IP is rate limited.
 */
final class Tracker {

	const REST_NAMESPACE = 'visitor-sentinel/v1';

	const SESSION_TIMEOUT = 1800;

	/**
	 * Ad click ID parameters that only paid clicks carry, and the network that adds each.
	 */
	const CLICK_IDS = array(
		'gclid'     => 'google_ads',
		'gbraid'    => 'google_ads',
		'wbraid'    => 'google_ads',
		'dclid'     => 'google_ads',
		'msclkid'   => 'microsoft',
		'ttclid'    => 'tiktok',
		'twclid'    => 'x',
		'li_fat_id' => 'linkedin',
		'ScCid'     => 'snapchat',
		'yclid'     => 'yandex',
		'rdt_cid'   => 'reddit',
	);

	/**
	 * utm_medium values that mean paid traffic.
	 */
	const PAID_MEDIUM = '/^(cpc|ppc|paid|paid[_-]?search|paidsearch|paid[_-]?social|paidsocial|cpm|cpv|cpa|display|banner|ads?|retargeting|remarketing)$/';

	/**
	 * Hook into WordPress.
	 */
	public function register() {
		add_action( 'rest_api_init', array( $this, 'routes' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue' ) );
		add_action( 'template_redirect', array( $this, 'capture_landing' ), 1 );
	}

	/**
	 * Register the collect endpoint.
	 */
	public function routes() {
		register_rest_route(
			self::REST_NAMESPACE,
			'/collect',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'collect' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	/**
	 * Whether the current user should be tracked at all.
	 *
	 * @return bool
	 */
	public static function should_track_user() {
		if ( ! Settings::get( 'tracking_enabled' ) ) {
			return false;
		}
		if ( is_user_logged_in() ) {
			$user     = wp_get_current_user();
			$excluded = (array) Settings::get( 'exclude_roles' );
			if ( array_intersect( (array) $user->roles, $excluded ) ) {
				return false;
			}
		}
		/**
		 * Filter whether the current request is tracked.
		 *
		 * @param bool $track Track.
		 */
		return (bool) apply_filters( 'vsen_should_track', true );
	}

	/**
	 * Load the tracker on public pages.
	 */
	public function enqueue() {
		if ( ! self::should_track_user() || is_preview() || is_customize_preview() || is_feed() || is_robots() || is_trackback() ) {
			return;
		}
		$endpoint = rest_url( self::REST_NAMESPACE . '/collect' );
		if ( is_user_logged_in() ) {
			// Lets the endpoint know who is logged in; pages for logged-in users are not page-cached.
			$endpoint = add_query_arg( '_wpnonce', wp_create_nonce( 'wp_rest' ), $endpoint );
		}
		$config = array(
			'endpoint'    => esc_url_raw( $endpoint ),
			'storage'     => (bool) Settings::get( 'use_storage' ),
			'dnt'         => (bool) Settings::get( 'respect_dnt' ),
			'consent'     => (bool) Settings::get( 'require_consent' ),
			'outbound'    => (bool) Settings::get( 'track_outbound' ),
			'downloads'   => (bool) Settings::get( 'track_downloads' ),
			'adSelectors' => Settings::ad_selectors(),
			'protect'     => 'hide_ads' === Settings::get( 'protection_action' ),
			'flagDays'    => max( 1, (int) Settings::get( 'block_duration_days' ) ),
		);
		wp_enqueue_script(
			'vsen-tracker',
			VSEN_URL . 'assets/js/tracker.js',
			array(),
			VSEN_VERSION,
			array(
				'in_footer' => true,
				'strategy'  => 'defer',
			)
		);
		wp_add_inline_script( 'vsen-tracker', 'window.vsenConfig=' . wp_json_encode( $config ) . ';', 'before' );
	}

	/**
	 * Record ad landings on the server too. A visit that the server sees but the browser never
	 * confirms means a client that does not run JavaScript, which real ad visitors do.
	 * Pages served from a full-page cache skip this; the browser then records the landing alone.
	 */
	public function capture_landing() {
		$method = isset( $_SERVER['REQUEST_METHOD'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_METHOD'] ) ) : '';
		if ( 'GET' !== $method || is_admin() || wp_doing_ajax() || is_feed() || is_robots() || is_preview() ) {
			return;
		}
		// Without consent nothing may be stored before the visitor agrees in the browser.
		if ( Settings::get( 'require_consent' ) || ! self::should_track_user() ) {
			return;
		}
		if ( Settings::get( 'respect_dnt' ) && Request_Context::opted_out() ) {
			return;
		}
		$click_id = self::detect_click_id( wp_unslash( $_GET ) ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only detection of ad parameters.
		if ( ! $click_id ) {
			return;
		}
		$ctx      = Request_Context::current();
		$ref      = self::click_ref( $click_id );
		$existing = Repository::instance()->clicks_by_ref( $ref );
		$others   = 0;
		foreach ( $existing as $row ) {
			if ( $row->ip_hash === $ctx->ip_hash ) {
				return; // A reload, or the browser already recorded it.
			}
			++$others;
		}
		$request_uri = isset( $_SERVER['REQUEST_URI'] ) ? esc_url_raw( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '/';
		$signals     = $ctx->signals();
		if ( $others > 0 ) {
			$signals['rep'] = 1;
		}
		// Kept so a visitor can be created later if the browser never confirms the visit.
		$signals['ua'] = $ctx->user_agent;
		$signals['br'] = $ctx->ua['browser'];
		$signals['os'] = $ctx->ua['os'];

		$id = Repository::instance()->insert_click(
			array(
				'click_type'  => 'ad_landing',
				'network'     => $click_id['network'],
				'ip'          => $ctx->ip_store,
				'ip_hash'     => $ctx->ip_hash,
				'click_ref'   => $ref,
				'target'      => substr( home_url( $request_uri ), 0, 1024 ),
				'label'       => $click_id['param'],
				'server_seen' => 1,
				'signals'     => wp_json_encode( $signals ),
			)
		);
		( new Fraud_Service() )->evaluate( $id );
	}

	/**
	 * Find a paid click ID in query parameters.
	 *
	 * @param array $query Query parameters.
	 * @return array|null Keys param, value, network.
	 */
	public static function detect_click_id( $query ) {
		if ( ! is_array( $query ) ) {
			return null;
		}
		foreach ( self::CLICK_IDS as $param => $network ) {
			if ( isset( $query[ $param ] ) && is_string( $query[ $param ] ) && preg_match( '/^[A-Za-z0-9._~\-]{6,512}$/', $query[ $param ] ) ) {
				return array(
					'param'   => $param,
					'value'   => $query[ $param ],
					'network' => $network,
				);
			}
		}
		// Facebook adds fbclid to every outbound link, paid or not, so it counts only with a paid utm_medium.
		if ( isset( $query['fbclid'], $query['utm_medium'] ) && is_string( $query['fbclid'] ) && is_string( $query['utm_medium'] )
			&& preg_match( '/^[A-Za-z0-9._~\-]{6,512}$/', $query['fbclid'] ) && preg_match( self::PAID_MEDIUM, strtolower( $query['utm_medium'] ) ) ) {
			return array(
				'param'   => 'fbclid',
				'value'   => $query['fbclid'],
				'network' => 'meta',
			);
		}
		return null;
	}

	/**
	 * Stable reference for a click ID, used to recognize the same ad click across requests.
	 *
	 * @param array $click_id detect_click_id() result.
	 * @return string
	 */
	public static function click_ref( array $click_id ) {
		return hash( 'sha256', 'cid|' . $click_id['param'] . '|' . $click_id['value'] );
	}

	/**
	 * Ad network from utm_source.
	 *
	 * @param string $source utm_source.
	 * @return string
	 */
	public static function network_from_source( $source ) {
		$source = strtolower( (string) $source );
		$map    = array(
			'google'    => 'google_ads',
			'adwords'   => 'google_ads',
			'bing'      => 'microsoft',
			'microsoft' => 'microsoft',
			'facebook'  => 'meta',
			'instagram' => 'meta',
			'meta'      => 'meta',
			'fb'        => 'meta',
			'tiktok'    => 'tiktok',
			'linkedin'  => 'linkedin',
			'twitter'   => 'x',
			'pinterest' => 'pinterest',
			'reddit'    => 'reddit',
			'snapchat'  => 'snapchat',
			'yandex'    => 'yandex',
		);
		foreach ( $map as $needle => $network ) {
			if ( false !== strpos( $source, $needle ) ) {
				return $network;
			}
		}
		$key = substr( sanitize_key( $source ), 0, 30 );
		return '' !== $key ? $key : 'other';
	}

	/**
	 * Per-pageview token that authorizes engagement updates.
	 *
	 * @param int $pageview_id Pageview ID.
	 * @return string
	 */
	public static function token( $pageview_id ) {
		return substr( hash_hmac( 'sha256', 'pv|' . (int) $pageview_id, Plugin::secret() ), 0, 24 );
	}

	/**
	 * Handle a beacon from the tracker.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response
	 */
	public function collect( $request ) {
		if ( ! self::should_track_user() ) {
			return $this->reply( array( 'ok' => false ) );
		}
		if ( Settings::get( 'respect_dnt' ) && Request_Context::opted_out() ) {
			return $this->reply( array( 'ok' => false ) );
		}
		$body = (string) $request->get_body();
		if ( '' === $body || strlen( $body ) > 8192 ) {
			return $this->reply( array( 'ok' => false ), 400 );
		}
		$data = json_decode( $body, true );
		if ( ! is_array( $data ) || empty( $data['e'] ) || ! is_string( $data['e'] ) ) {
			return $this->reply( array( 'ok' => false ), 400 );
		}
		$ctx = Request_Context::current();
		if ( '' === $ctx->ip ) {
			return $this->reply( array( 'ok' => false ), 400 );
		}
		if ( $this->rate_limit_hit( $ctx->ip_hash ) ) {
			return $this->reply( array( 'ok' => false ), 429 );
		}
		switch ( $data['e'] ) {
			case 'pv':
				return $this->pageview( $data, $ctx );
			case 'eng':
				return $this->engagement( $data );
			case 'click':
				return $this->click( $data, $ctx );
		}
		return $this->reply( array( 'ok' => false ), 400 );
	}

	/**
	 * Record a pageview, creating the visitor and session as needed.
	 *
	 * @param array           $data Payload.
	 * @param Request_Context $ctx  Request.
	 * @return \WP_REST_Response
	 */
	private function pageview( array $data, Request_Context $ctx ) {
		$repo = Repository::instance();
		$url  = $this->clean_url( isset( $data['u'] ) ? $data['u'] : '' );
		$host = '' !== $url ? (string) wp_parse_url( $url, PHP_URL_HOST ) : '';
		if ( '' === $url || ! $this->is_own_host( $host ) ) {
			return $this->reply( array( 'ok' => false ), 400 );
		}
		$client = $this->client_signals( $data );
		$is_bot = $ctx->ua['is_bot'] || ! empty( $client['wd'] );

		$visitor_id = $repo->upsert_visitor(
			$this->visitor_hash( isset( $data['v'] ) ? $data['v'] : '', $ctx ),
			array(
				'ip'         => $ctx->ip_store,
				'ip_hash'    => $ctx->ip_hash,
				'country'    => $ctx->country,
				'user_agent' => $ctx->user_agent,
				'browser'    => $ctx->ua['browser'],
				'os'         => $ctx->ua['os'],
				'device'     => $is_bot ? 'bot' : $ctx->ua['device'],
				'is_bot'     => $is_bot ? 1 : 0,
				'user_id'    => get_current_user_id(),
			)
		);
		if ( ! $visitor_id ) {
			return $this->reply( array( 'ok' => false ), 500 );
		}

		$query = array();
		parse_str( (string) wp_parse_url( $url, PHP_URL_QUERY ), $query );
		$path     = substr( (string) wp_parse_url( $url, PHP_URL_PATH ), 0, 191 );
		$path     = '' === $path ? '/' : $path;
		$referrer = $this->clean_url( isset( $data['r'] ) ? $data['r'] : '' );

		$session = $this->find_session( $data, $visitor_id );
		if ( ! $session ) {
			$ref_host   = '' !== $referrer ? strtolower( (string) wp_parse_url( $referrer, PHP_URL_HOST ) ) : '';
			$key        = isset( $data['s'] ) && is_string( $data['s'] ) && preg_match( '/^[a-f0-9]{32}$/', $data['s'] ) && ! $repo->get_session_by_key( $data['s'] ) ? $data['s'] : bin2hex( random_bytes( 16 ) );
			$session_id = $repo->insert_session(
				array(
					'session_key'   => $key,
					'visitor_id'    => $visitor_id,
					'ip'            => $ctx->ip_store,
					'ip_hash'       => $ctx->ip_hash,
					'entry_url'     => $url,
					'exit_url'      => $url,
					'referrer'      => $referrer,
					'referrer_host' => $this->is_own_host( $ref_host ) ? '' : substr( $ref_host, 0, 191 ),
					'utm_source'    => $this->query_text( $query, 'utm_source', 100 ),
					'utm_medium'    => $this->query_text( $query, 'utm_medium', 100 ),
					'utm_campaign'  => $this->query_text( $query, 'utm_campaign', 191 ),
					'click_id_type' => '',
					'is_paid'       => 0,
					'is_bot'        => $is_bot ? 1 : 0,
				)
			);
			$repo->bump_visitor( $visitor_id, 'sessions' );
			$session = $repo->get_session( $session_id );
			if ( ! $session ) {
				return $this->reply( array( 'ok' => false ), 500 );
			}
		}

		$title       = isset( $data['ti'] ) && is_string( $data['ti'] ) ? substr( sanitize_text_field( $data['ti'] ), 0, 255 ) : '';
		$pageview_id = $repo->insert_pageview(
			array(
				'session_id' => (int) $session->id,
				'visitor_id' => $visitor_id,
				'url'        => $url,
				'path'       => $path,
				'title'      => $title,
				'referrer'   => $referrer,
				'is_bot'     => $is_bot ? 1 : 0,
			)
		);
		$repo->touch_session( $session, $url, true );
		$repo->bump_visitor( $visitor_id, 'pageviews' );

		$this->record_landing( $query, $url, $path, $ctx, $client, $visitor_id, $session, $pageview_id );

		return $this->reply(
			array(
				'ok' => true,
				'pv' => $pageview_id,
				't'  => self::token( $pageview_id ),
				's'  => $session->session_key,
				'f'  => $this->flagged( $ctx ) ? 1 : 0,
			)
		);
	}

	/**
	 * The visitor's current session: the one the browser names, or their latest active one
	 * when the browser keeps no storage.
	 *
	 * @param array $data       Payload.
	 * @param int   $visitor_id Visitor ID.
	 * @return object|null
	 */
	private function find_session( array $data, $visitor_id ) {
		$repo  = Repository::instance();
		$since = Repository::now( -self::SESSION_TIMEOUT );
		if ( isset( $data['s'] ) && is_string( $data['s'] ) && preg_match( '/^[a-f0-9]{32}$/', $data['s'] ) ) {
			$session = $repo->get_session_by_key( $data['s'] );
			if ( $session && (int) $session->visitor_id === (int) $visitor_id && $session->last_activity >= $since ) {
				return $session;
			}
			return null;
		}
		return $repo->get_active_session( $visitor_id, $since );
	}

	/**
	 * Record a paid ad landing for this pageview, or confirm one the server already saw.
	 *
	 * @param array           $query       Query parameters of the URL.
	 * @param string          $url         URL.
	 * @param string          $path        Path.
	 * @param Request_Context $ctx         Request.
	 * @param array           $client      Browser signals.
	 * @param int             $visitor_id  Visitor ID.
	 * @param object          $session     Session row.
	 * @param int             $pageview_id Pageview ID.
	 */
	private function record_landing( array $query, $url, $path, Request_Context $ctx, array $client, $visitor_id, $session, $pageview_id ) {
		$click_id = self::detect_click_id( $query );
		$medium   = isset( $query['utm_medium'] ) && is_string( $query['utm_medium'] ) ? strtolower( $query['utm_medium'] ) : '';
		if ( ! $click_id && ! preg_match( self::PAID_MEDIUM, $medium ) ) {
			return;
		}
		$repo    = Repository::instance();
		$network = $click_id ? $click_id['network'] : self::network_from_source( isset( $query['utm_source'] ) ? $query['utm_source'] : '' );
		$ref     = $click_id ? self::click_ref( $click_id ) : hash( 'sha256', 'utm|' . $session->session_key . '|' . $path );
		$mine    = null;
		$others  = 0;
		foreach ( $repo->clicks_by_ref( $ref ) as $row ) {
			if ( $row->ip_hash === $ctx->ip_hash ) {
				$mine = $mine ? $mine : $row;
			} else {
				++$others;
			}
		}
		$signals = array_merge( $ctx->signals(), $client );
		if ( $others > 0 ) {
			$signals['rep'] = 1;
		}

		if ( $mine ) {
			if ( 0 === (int) $mine->session_id ) {
				// The server recorded this landing; the browser now confirms it ran the page.
				$stored = json_decode( (string) $mine->signals, true );
				$repo->update_click(
					$mine->id,
					array(
						'visitor_id'   => $visitor_id,
						'session_id'   => (int) $session->id,
						'pageview_id'  => $pageview_id,
						'js_confirmed' => 1,
						'signals'      => wp_json_encode( array_merge( is_array( $stored ) ? $stored : array(), $signals ) ),
					)
				);
				$repo->bump_visitor( $visitor_id, 'clicks' );
				$repo->mark_session_paid( (int) $session->id, $network );
				( new Fraud_Service() )->evaluate( (int) $mine->id );
			}
			return; // Otherwise a reload of a landing already counted.
		}

		$id = $repo->insert_click(
			array(
				'click_type'   => 'ad_landing',
				'network'      => $network,
				'visitor_id'   => $visitor_id,
				'session_id'   => (int) $session->id,
				'pageview_id'  => $pageview_id,
				'ip'           => $ctx->ip_store,
				'ip_hash'      => $ctx->ip_hash,
				'click_ref'    => $ref,
				'target'       => $url,
				'label'        => $click_id ? $click_id['param'] : 'utm',
				'js_confirmed' => 1,
				'signals'      => wp_json_encode( $signals ),
			)
		);
		$repo->bump_visitor( $visitor_id, 'clicks' );
		$repo->mark_session_paid( (int) $session->id, $network );
		( new Fraud_Service() )->evaluate( $id );
	}

	/**
	 * Store time on page, scroll depth and interactions, then re-score the session's ad landing.
	 *
	 * @param array $data Payload.
	 * @return \WP_REST_Response
	 */
	private function engagement( array $data ) {
		$repo        = Repository::instance();
		$pageview_id = isset( $data['pv'] ) ? absint( $data['pv'] ) : 0;
		$token       = isset( $data['t'] ) && is_string( $data['t'] ) ? $data['t'] : '';
		if ( ! $pageview_id || ! hash_equals( self::token( $pageview_id ), $token ) ) {
			return $this->reply( array( 'ok' => false ), 403 );
		}
		$pageview = $repo->get_pageview( $pageview_id );
		if ( ! $pageview ) {
			return $this->reply( array( 'ok' => false ), 404 );
		}
		$repo->update_engagement(
			$pageview,
			array(
				'time_on_page' => $this->int_in( $data, 'tt', 0, 21600000 ) / 1000,
				'active_time'  => $this->int_in( $data, 'at', 0, 21600000 ) / 1000,
				'max_scroll'   => $this->int_in( $data, 'sc', 0, 100 ),
				'interactions' => $this->int_in( $data, 'it', 0, 100000 ),
			)
		);
		$session = $repo->get_session( (int) $pageview->session_id );
		if ( $session ) {
			// Session length reaches at least to the end of this page's measured time.
			$offset = (int) strtotime( $pageview->created_at . ' UTC' ) - (int) strtotime( $session->started_at . ' UTC' );
			$repo->touch_session( $session, '', false, max( 0, $offset ) + (int) ( $this->int_in( $data, 'tt', 0, 21600000 ) / 1000 ) );
			$service = new Fraud_Service();
			foreach ( $repo->session_landings( (int) $session->id ) as $click_id ) {
				$service->evaluate( (int) $click_id );
			}
		}
		return $this->reply( array( 'ok' => true ) );
	}

	/**
	 * Record a click on an ad, an outbound link, a download or a tracked element.
	 *
	 * @param array           $data Payload.
	 * @param Request_Context $ctx  Request.
	 * @return \WP_REST_Response
	 */
	private function click( array $data, Request_Context $ctx ) {
		$kinds = array(
			'ad'  => 'ad_click',
			'out' => 'outbound',
			'dl'  => 'download',
			'trk' => 'tracked',
		);
		$kind  = isset( $data['k'] ) && is_string( $data['k'] ) && isset( $kinds[ $data['k'] ] ) ? $data['k'] : '';
		if ( '' === $kind ) {
			return $this->reply( array( 'ok' => false ), 400 );
		}
		if ( ( 'out' === $kind && ! Settings::get( 'track_outbound' ) ) || ( 'dl' === $kind && ! Settings::get( 'track_downloads' ) ) ) {
			return $this->reply( array( 'ok' => true ) );
		}
		$repo       = Repository::instance();
		$visitor_id = 0;
		$session    = null;
		$pageview   = 0;

		$pageview_id = isset( $data['pv'] ) ? absint( $data['pv'] ) : 0;
		$token       = isset( $data['t'] ) && is_string( $data['t'] ) ? $data['t'] : '';
		if ( $pageview_id && hash_equals( self::token( $pageview_id ), $token ) ) {
			$row = $repo->get_pageview( $pageview_id );
			if ( $row ) {
				$pageview   = (int) $row->id;
				$visitor_id = (int) $row->visitor_id;
				$session    = $repo->get_session( (int) $row->session_id );
			}
		}
		if ( ! $session && isset( $data['s'] ) && is_string( $data['s'] ) && preg_match( '/^[a-f0-9]{32}$/', $data['s'] ) ) {
			// The click came before the pageview reply; attach it by session key, but only to a
			// session that belongs to the same IP.
			$candidate = $repo->get_session_by_key( $data['s'] );
			if ( $candidate && $candidate->ip_hash === $ctx->ip_hash ) {
				$session    = $candidate;
				$visitor_id = (int) $candidate->visitor_id;
			}
		}

		$target = isset( $data['h'] ) && is_string( $data['h'] ) ? $this->clean_url( $data['h'] ) : '';
		$label  = isset( $data['l'] ) && is_string( $data['l'] ) ? substr( sanitize_text_field( $data['l'] ), 0, 191 ) : '';
		$net    = isset( $data['n'] ) && is_string( $data['n'] ) ? substr( sanitize_key( $data['n'] ), 0, 30 ) : '';

		$id = $repo->insert_click(
			array(
				'click_type'    => $kinds[ $kind ],
				'network'       => $net,
				'visitor_id'    => $visitor_id,
				'session_id'    => $session ? (int) $session->id : 0,
				'pageview_id'   => $pageview,
				'ip'            => $ctx->ip_store,
				'ip_hash'       => $ctx->ip_hash,
				'target'        => $target,
				'label'         => $label,
				'time_to_click' => isset( $data['ms'] ) ? $this->int_in( $data, 'ms', 0, 86400000 ) : -1,
				'js_confirmed'  => 1,
				'finalized'     => 'ad' === $kind ? 0 : 1,
				'signals'       => wp_json_encode( array_merge( $ctx->signals(), $this->client_signals( $data ) ) ),
			)
		);
		if ( $visitor_id ) {
			$repo->bump_visitor( $visitor_id, 'clicks' );
		}
		if ( $session ) {
			$repo->touch_session( $session );
		}
		if ( 'ad' === $kind ) {
			( new Fraud_Service() )->evaluate( $id );
		}
		return $this->reply(
			array(
				'ok' => true,
				'f'  => $this->flagged( $ctx ) ? 1 : 0,
			)
		);
	}

	/**
	 * Browser-reported signals, normalized.
	 *
	 * @param array $data Payload.
	 * @return array
	 */
	private function client_signals( array $data ) {
		$out = array();
		if ( isset( $data['wd'] ) || isset( $data['sw'] ) ) {
			$zero_screen = isset( $data['sw'], $data['sh'] ) && ( 0 === (int) $data['sw'] || 0 === (int) $data['sh'] );
			$out['wd']   = ( ! empty( $data['wd'] ) || $zero_screen ) ? 1 : 0;
		}
		if ( isset( $data['tr'] ) ) {
			$out['tr'] = empty( $data['tr'] ) ? 0 : 1;
		}
		if ( isset( $data['it'] ) ) {
			$out['it'] = $this->int_in( $data, 'it', 0, 100000 );
		}
		if ( isset( $data['xy'] ) ) {
			$out['xy'] = empty( $data['xy'] ) ? 0 : 1;
		}
		if ( ! empty( $data['ifr'] ) ) {
			$out['ifr'] = 1;
		}
		return $out;
	}

	/**
	 * Whether the visitor should be shown as flagged (ads hidden) by the tracker.
	 *
	 * @param Request_Context $ctx Request.
	 * @return bool
	 */
	private function flagged( Request_Context $ctx ) {
		return 'log_only' !== Settings::get( 'protection_action' ) && Protection::is_blocked( $ctx );
	}

	/**
	 * Visitor hash: from the browser's random ID when storage is allowed, else from IP and user agent.
	 *
	 * @param mixed           $client_id Browser ID.
	 * @param Request_Context $ctx       Request.
	 * @return string
	 */
	private function visitor_hash( $client_id, Request_Context $ctx ) {
		if ( Settings::get( 'use_storage' ) && is_string( $client_id ) && preg_match( '/^[a-f0-9]{32}$/', $client_id ) ) {
			return hash_hmac( 'sha256', 'c|' . $client_id, Plugin::secret() );
		}
		return hash_hmac( 'sha256', 'i|' . $ctx->ip_hash . '|' . $ctx->user_agent, Plugin::secret() );
	}

	/**
	 * Count a request against the IP's per-minute budget.
	 *
	 * @param string $ip_hash IP hash.
	 * @return bool True when over the limit.
	 */
	private function rate_limit_hit( $ip_hash ) {
		/**
		 * Filter how many tracker requests one IP may make per minute.
		 *
		 * @param int $limit Requests per minute.
		 */
		$limit  = (int) apply_filters( 'vsen_rate_limit', 120 );
		$bucket = 'rl_' . substr( $ip_hash, 0, 24 ) . '_' . (int) floor( time() / 60 );
		if ( wp_using_ext_object_cache() ) {
			wp_cache_add( $bucket, 0, 'vsen', 120 );
			$count = (int) wp_cache_incr( $bucket, 1, 'vsen' );
		} else {
			$count = (int) get_transient( 'vsen_' . $bucket ) + 1;
			set_transient( 'vsen_' . $bucket, $count, 120 );
		}
		if ( $count > $limit ) {
			set_transient( 'vsen_rlhit_' . substr( $ip_hash, 0, 24 ), 1, HOUR_IN_SECONDS );
			return true;
		}
		return false;
	}

	/**
	 * Whether an IP went over the rate limit in the last hour.
	 *
	 * @param string $ip_hash IP hash.
	 * @return bool
	 */
	public static function was_rate_limited( $ip_hash ) {
		return '' !== (string) $ip_hash && (bool) get_transient( 'vsen_rlhit_' . substr( $ip_hash, 0, 24 ) );
	}

	/**
	 * An absolute http(s) URL of at most 1024 bytes, or ''.
	 *
	 * @param mixed $url URL.
	 * @return string
	 */
	private function clean_url( $url ) {
		if ( ! is_string( $url ) || '' === $url || strlen( $url ) > 4096 ) {
			return '';
		}
		$url = esc_url_raw( $url, array( 'http', 'https' ) );
		return '' === $url ? '' : substr( $url, 0, 1024 );
	}

	/**
	 * Whether a host is this site (www. is ignored).
	 *
	 * @param string $host Host.
	 * @return bool
	 */
	private function is_own_host( $host ) {
		$host = preg_replace( '/^www\./', '', strtolower( (string) $host ) );
		if ( '' === $host ) {
			return false;
		}
		$own = array(
			preg_replace( '/^www\./', '', strtolower( (string) wp_parse_url( home_url(), PHP_URL_HOST ) ) ),
			preg_replace( '/^www\./', '', strtolower( (string) wp_parse_url( site_url(), PHP_URL_HOST ) ) ),
		);
		/**
		 * Filter the hosts the tracker accepts pageviews for.
		 *
		 * @param string[] $own Hosts without www.
		 */
		$own = (array) apply_filters( 'vsen_allowed_hosts', $own );
		return in_array( $host, $own, true );
	}

	/**
	 * A sanitized query parameter.
	 *
	 * @param array  $query Query.
	 * @param string $key   Key.
	 * @param int    $max   Max length.
	 * @return string
	 */
	private function query_text( array $query, $key, $max ) {
		return isset( $query[ $key ] ) && is_string( $query[ $key ] ) ? substr( sanitize_text_field( $query[ $key ] ), 0, $max ) : '';
	}

	/**
	 * An integer field clamped to a range.
	 *
	 * @param array  $data Payload.
	 * @param string $key  Key.
	 * @param int    $min  Min.
	 * @param int    $max  Max.
	 * @return int
	 */
	private function int_in( array $data, $key, $min, $max ) {
		$value = isset( $data[ $key ] ) && is_numeric( $data[ $key ] ) ? (int) $data[ $key ] : $min;
		return max( $min, min( $max, $value ) );
	}

	/**
	 * A REST response that no cache will store.
	 *
	 * @param array $body   Body.
	 * @param int   $status Status.
	 * @return \WP_REST_Response
	 */
	private function reply( array $body, $status = 200 ) {
		$response = new \WP_REST_Response( $body, $status );
		$response->header( 'Cache-Control', 'no-store, max-age=0' );
		return $response;
	}
}

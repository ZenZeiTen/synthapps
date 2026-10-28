<?php
/**
 * Admin screens, actions and the dashboard REST route.
 *
 * @package VisitorSentinel
 */

namespace VisitorSentinel\Admin;

use VisitorSentinel\Fraud_Engine;
use VisitorSentinel\IP;
use VisitorSentinel\Plugin;
use VisitorSentinel\Protection;
use VisitorSentinel\Repository;
use VisitorSentinel\Settings;
use VisitorSentinel\Tracker;

defined( 'ABSPATH' ) || exit;

/**
 * Menu pages, settings registration, admin-post actions and helpers shared by the views.
 */
final class Admin {

	const SLUG = 'vsen-dashboard';

	/**
	 * Hook into WordPress.
	 */
	public function register() {
		add_action( 'admin_menu', array( $this, 'menu' ) );
		add_action( 'admin_init', array( $this, 'register_settings' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'assets' ) );
		add_action( 'admin_post_vsen', array( $this, 'handle_action' ) );
		add_action( 'admin_notices', array( $this, 'notices' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( VSEN_FILE ), array( $this, 'action_links' ) );
	}

	/**
	 * Admin REST routes.
	 */
	public function routes() {
		register_rest_route(
			Tracker::REST_NAMESPACE,
			'/live',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'rest_live' ),
				'permission_callback' => function () {
					return current_user_can( Plugin::capability() );
				},
			)
		);
	}

	/**
	 * Menu pages.
	 */
	public function menu() {
		$cap   = Plugin::capability();
		$hooks = array();

		add_menu_page( __( 'Visitor Sentinel', 'visitor-sentinel' ), __( 'Visitor Sentinel', 'visitor-sentinel' ), $cap, self::SLUG, array( $this, 'page_dashboard' ), 'dashicons-shield-alt', 58 );
		$hooks[] = add_submenu_page( self::SLUG, __( 'Dashboard', 'visitor-sentinel' ), __( 'Dashboard', 'visitor-sentinel' ), $cap, self::SLUG, array( $this, 'page_dashboard' ) );
		$hooks[] = add_submenu_page( self::SLUG, __( 'Visitors', 'visitor-sentinel' ), __( 'Visitors', 'visitor-sentinel' ), $cap, 'vsen-visitors', array( $this, 'page_visitors' ) );
		$hooks[] = add_submenu_page( self::SLUG, __( 'Click Fraud', 'visitor-sentinel' ), __( 'Click Fraud', 'visitor-sentinel' ), $cap, 'vsen-fraud', array( $this, 'page_fraud' ) );
		$hooks[] = add_submenu_page( self::SLUG, __( 'Blocklist', 'visitor-sentinel' ), __( 'Blocklist', 'visitor-sentinel' ), $cap, 'vsen-blocklist', array( $this, 'page_blocklist' ) );
		$hooks[] = add_submenu_page( self::SLUG, __( 'Settings', 'visitor-sentinel' ), __( 'Settings', 'visitor-sentinel' ), $cap, 'vsen-settings', array( $this, 'page_settings' ) );

		// Bulk actions are handled before any output so they can redirect.
		add_action( 'load-' . $hooks[1], array( $this, 'load_visitors' ) );
		add_action( 'load-' . $hooks[2], array( $this, 'load_fraud' ) );
		add_action( 'load-' . $hooks[3], array( $this, 'load_blocklist' ) );
	}

	/**
	 * Settings link on the Plugins screen.
	 *
	 * @param array $links Links.
	 * @return array
	 */
	public function action_links( $links ) {
		array_unshift( $links, '<a href="' . esc_url( admin_url( 'admin.php?page=vsen-settings' ) ) . '">' . esc_html__( 'Settings', 'visitor-sentinel' ) . '</a>' );
		return $links;
	}

	/**
	 * Register the settings option.
	 */
	public function register_settings() {
		register_setting(
			'vsen_settings_group',
			Settings::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( Settings::class, 'sanitize' ),
				'default'           => Settings::defaults(),
			)
		);
	}

	/**
	 * Styles and scripts on the plugin's own screens only.
	 *
	 * @param string $hook Screen hook.
	 */
	public function assets( $hook ) {
		$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ( 0 !== strpos( $page, 'vsen-' ) ) {
			return;
		}
		wp_enqueue_style( 'vsen-admin', VSEN_URL . 'assets/css/admin.css', array(), VSEN_VERSION );
		wp_enqueue_script( 'vsen-admin', VSEN_URL . 'assets/js/admin.js', array(), VSEN_VERSION, true );
		wp_localize_script(
			'vsen-admin',
			'vsenAdmin',
			array(
				'liveUrl' => esc_url_raw( rest_url( Tracker::REST_NAMESPACE . '/live' ) ),
				'nonce'   => wp_create_nonce( 'wp_rest' ),
				'i18n'    => array(
					'pageviews' => __( 'Pageviews', 'visitor-sentinel' ),
					'visitors'  => __( 'Visitors', 'visitor-sentinel' ),
					'ads'       => __( 'Ad clicks', 'visitor-sentinel' ),
					'fraud'     => __( 'Fraudulent', 'visitor-sentinel' ),
					'nobody'    => __( 'Nobody is on the site right now.', 'visitor-sentinel' ),
					'paid'      => __( 'Paid', 'visitor-sentinel' ),
					'ago'       => __( '%s ago', 'visitor-sentinel' ),
					'confirm'   => __( 'Are you sure? This cannot be undone.', 'visitor-sentinel' ),
				),
			)
		);
	}

	// ---------------------------------------------------------------------------------------------
	// Pages.
	// ---------------------------------------------------------------------------------------------

	/**
	 * Dashboard.
	 */
	public function page_dashboard() {
		$this->require_cap();
		$range  = $this->current_range();
		$bounds = $this->range_bounds( $range );
		$repo   = Repository::instance();
		$data   = array(
			'range'     => $range,
			'summary'   => $repo->summary( $bounds[0], $bounds[1] ),
			'series'    => $this->daily_series( 30 ),
			'pages'     => $repo->breakdown( 'pages', $bounds[0], $bounds[1], 8 ),
			'referrers' => $repo->breakdown( 'referrers', $bounds[0], $bounds[1], 8 ),
			'campaigns' => $repo->breakdown( 'campaigns', $bounds[0], $bounds[1], 8 ),
			'devices'   => $repo->breakdown( 'devices', $bounds[0], $bounds[1], 5 ),
			'browsers'  => $repo->breakdown( 'browsers', $bounds[0], $bounds[1], 6 ),
			'countries' => $repo->breakdown( 'countries', $bounds[0], $bounds[1], 8 ),
			'networks'  => $repo->breakdown( 'networks', $bounds[0], $bounds[1], 8 ),
			'recent'    => $repo->list_clicks(
				array(
					'filter' => 'fraud',
					'limit'  => 6,
					'offset' => 0,
				)
			),
		);
		require VSEN_DIR . 'includes/admin/views/dashboard.php';
	}

	/**
	 * Visitor list, or one visitor when ?visitor= is set.
	 */
	public function page_visitors() {
		$this->require_cap();
		$visitor_id = isset( $_GET['visitor'] ) ? absint( $_GET['visitor'] ) : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ( $visitor_id ) {
			$repo    = Repository::instance();
			$visitor = $repo->get_visitor( $visitor_id );
			if ( ! $visitor ) {
				wp_die( esc_html__( 'Visitor not found.', 'visitor-sentinel' ) );
			}
			$sessions  = $repo->visitor_sessions( $visitor_id );
			$pageviews = $repo->visitor_pageviews( $visitor_id );
			$clicks    = $repo->visitor_clicks( $visitor_id );
			require VSEN_DIR . 'includes/admin/views/visitor.php';
			return;
		}
		$table = $this->visitors_table();
		$table->prepare_items();
		require VSEN_DIR . 'includes/admin/views/visitors.php';
	}

	/**
	 * Click fraud list.
	 */
	public function page_fraud() {
		$this->require_cap();
		$table = $this->clicks_table();
		$table->prepare_items();
		$bounds   = $this->range_bounds( '30d' );
		$networks = Repository::instance()->breakdown( 'networks', $bounds[0], $bounds[1], 10 );
		require VSEN_DIR . 'includes/admin/views/fraud.php';
	}

	/**
	 * Blocklist.
	 */
	public function page_blocklist() {
		$this->require_cap();
		$table = $this->blocklist_table();
		$table->prepare_items();
		require VSEN_DIR . 'includes/admin/views/blocklist.php';
	}

	/**
	 * Settings.
	 */
	public function page_settings() {
		$this->require_cap();
		$settings = Settings::all();
		require VSEN_DIR . 'includes/admin/views/settings.php';
	}

	// ---------------------------------------------------------------------------------------------
	// Tables and bulk actions.
	// ---------------------------------------------------------------------------------------------

	/**
	 * Visitors table.
	 *
	 * @return Visitors_Table
	 */
	private function visitors_table() {
		require_once VSEN_DIR . 'includes/admin/class-visitors-table.php';
		return new Visitors_Table();
	}

	/**
	 * Clicks table.
	 *
	 * @return Clicks_Table
	 */
	private function clicks_table() {
		require_once VSEN_DIR . 'includes/admin/class-clicks-table.php';
		return new Clicks_Table();
	}

	/**
	 * Blocklist table.
	 *
	 * @return Blocklist_Table
	 */
	private function blocklist_table() {
		require_once VSEN_DIR . 'includes/admin/class-blocklist-table.php';
		return new Blocklist_Table();
	}

	/**
	 * Bulk actions on visitors.
	 */
	public function load_visitors() {
		$table  = $this->visitors_table();
		$action = $table->current_action();
		$ids    = isset( $_REQUEST['ids'] ) ? array_map( 'absint', (array) wp_unslash( $_REQUEST['ids'] ) ) : array(); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- verified below.
		if ( ! $action || empty( $ids ) ) {
			return;
		}
		check_admin_referer( 'bulk-visitors' );
		$this->require_cap();
		$repo  = Repository::instance();
		$count = 0;
		foreach ( $ids as $id ) {
			$visitor = $repo->get_visitor( $id );
			if ( ! $visitor || '' === (string) $visitor->ip_hash ) {
				continue;
			}
			if ( 'block' === $action ) {
				Protection::block_hash( $visitor->ip_hash, $visitor->ip, __( 'Blocked from the visitor list', 'visitor-sentinel' ), 'manual', (int) $visitor->fraud_score, (int) Settings::get( 'block_duration_days' ) );
				++$count;
			} elseif ( 'unblock' === $action ) {
				Protection::unblock_hash( $visitor->ip_hash );
				++$count;
			}
		}
		$this->redirect( remove_query_arg( array( 'action', 'action2', 'ids', '_wpnonce', '_wp_http_referer' ) ), 'block' === $action ? 'blocked' : 'unblocked', $count );
	}

	/**
	 * Bulk actions on clicks.
	 */
	public function load_fraud() {
		$table  = $this->clicks_table();
		$action = $table->current_action();
		$ids    = isset( $_REQUEST['ids'] ) ? array_map( 'absint', (array) wp_unslash( $_REQUEST['ids'] ) ) : array(); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- verified below.
		if ( ! $action || empty( $ids ) ) {
			return;
		}
		check_admin_referer( 'bulk-clicks' );
		$this->require_cap();
		$count = 0;
		foreach ( $ids as $id ) {
			if ( $this->apply_click_action( $action, $id ) ) {
				++$count;
			}
		}
		$codes = array(
			'valid' => 'marked_valid',
			'fraud' => 'marked_fraud',
			'block' => 'blocked',
		);
		$this->redirect( remove_query_arg( array( 'action', 'action2', 'ids', '_wpnonce', '_wp_http_referer' ) ), isset( $codes[ $action ] ) ? $codes[ $action ] : 'done', $count );
	}

	/**
	 * Bulk removal from the blocklist.
	 */
	public function load_blocklist() {
		$table  = $this->blocklist_table();
		$action = $table->current_action();
		$ids    = isset( $_REQUEST['ids'] ) ? array_map( 'absint', (array) wp_unslash( $_REQUEST['ids'] ) ) : array(); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- verified below.
		if ( 'remove' !== $action || empty( $ids ) ) {
			return;
		}
		check_admin_referer( 'bulk-blocks' );
		$this->require_cap();
		foreach ( $ids as $id ) {
			Repository::instance()->delete_block( $id );
		}
		Protection::rebuild_index();
		$this->redirect( remove_query_arg( array( 'action', 'action2', 'ids', '_wpnonce', '_wp_http_referer' ) ), 'unblocked', count( $ids ) );
	}

	/**
	 * Apply a review action to one click.
	 *
	 * @param string $action valid, fraud or block.
	 * @param int    $id     Click ID.
	 * @return bool
	 */
	private function apply_click_action( $action, $id ) {
		$repo  = Repository::instance();
		$click = $repo->get_click( $id );
		if ( ! $click ) {
			return false;
		}
		switch ( $action ) {
			case 'valid':
				$repo->update_click(
					$id,
					array(
						'reviewed' => 1,
						'status'   => Fraud_Engine::STATUS_CLEAN,
					)
				);
				break;
			case 'fraud':
				$repo->update_click(
					$id,
					array(
						'reviewed' => 2,
						'status'   => Fraud_Engine::STATUS_FRAUD,
					)
				);
				break;
			case 'block':
				if ( '' === (string) $click->ip_hash ) {
					return false;
				}
				Protection::block_hash( $click->ip_hash, $click->ip, __( 'Blocked from the click list', 'visitor-sentinel' ), 'manual', (int) $click->fraud_score, (int) Settings::get( 'block_duration_days' ) );
				return true;
			default:
				return false;
		}
		if ( (int) $click->visitor_id > 0 ) {
			$repo->refresh_visitor_score( (int) $click->visitor_id );
		}
		return true;
	}

	// ---------------------------------------------------------------------------------------------
	// Single actions (admin-post.php?action=vsen&do=...).
	// ---------------------------------------------------------------------------------------------

	/**
	 * Nonce-protected URL for an action.
	 *
	 * @param string $do   Action.
	 * @param array  $args Extra arguments.
	 * @return string
	 */
	public static function action_url( $do, array $args = array() ) {
		$args = array_merge(
			array(
				'action' => 'vsen',
				'do'     => $do,
			),
			$args
		);
		return wp_nonce_url( add_query_arg( $args, admin_url( 'admin-post.php' ) ), 'vsen_' . $do );
	}

	/**
	 * Handle an admin-post action.
	 */
	public function handle_action() {
		$this->require_cap();
		$do = isset( $_REQUEST['do'] ) ? sanitize_key( wp_unslash( $_REQUEST['do'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- verified on the next line.
		check_admin_referer( 'vsen_' . $do );

		$back = wp_get_referer();
		$back = $back ? $back : admin_url( 'admin.php?page=' . self::SLUG );
		$repo = Repository::instance();

		switch ( $do ) {
			case 'block_visitor':
				$visitor = $repo->get_visitor( isset( $_GET['id'] ) ? absint( $_GET['id'] ) : 0 );
				if ( $visitor && '' !== (string) $visitor->ip_hash ) {
					Protection::block_hash( $visitor->ip_hash, $visitor->ip, __( 'Blocked by an administrator', 'visitor-sentinel' ), 'manual', (int) $visitor->fraud_score, (int) Settings::get( 'block_duration_days' ) );
				}
				$this->redirect( $back, 'blocked', 1 );
				break;

			case 'unblock_visitor':
				$visitor = $repo->get_visitor( isset( $_GET['id'] ) ? absint( $_GET['id'] ) : 0 );
				if ( $visitor ) {
					Protection::unblock_hash( $visitor->ip_hash );
				}
				$this->redirect( $back, 'unblocked', 1 );
				break;

			case 'click':
				$verb = isset( $_GET['verb'] ) ? sanitize_key( wp_unslash( $_GET['verb'] ) ) : '';
				$ok   = $this->apply_click_action( $verb, isset( $_GET['id'] ) ? absint( $_GET['id'] ) : 0 );
				$this->redirect( $back, $ok ? ( 'block' === $verb ? 'blocked' : ( 'valid' === $verb ? 'marked_valid' : 'marked_fraud' ) ) : 'failed', 1 );
				break;

			case 'unblock':
				Protection::unblock( isset( $_GET['id'] ) ? absint( $_GET['id'] ) : 0 );
				$this->redirect( $back, 'unblocked', 1 );
				break;

			case 'add_block':
				$value  = isset( $_POST['ip'] ) ? sanitize_text_field( wp_unslash( $_POST['ip'] ) ) : '';
				$reason = isset( $_POST['reason'] ) ? sanitize_text_field( wp_unslash( $_POST['reason'] ) ) : '';
				$days   = isset( $_POST['days'] ) ? absint( $_POST['days'] ) : 0;
				$result = Protection::block_manual( $value, $reason, min( 3650, $days ) );
				$this->redirect( $back, true === $result ? 'blocked' : 'invalid_ip', 1 );
				break;

			case 'export':
				$what = isset( $_GET['what'] ) ? sanitize_key( wp_unslash( $_GET['what'] ) ) : 'visitors';
				$this->export( $what );
				break;

			case 'purge':
				$repo->truncate_tracking();
				$this->redirect( admin_url( 'admin.php?page=vsen-settings' ), 'purged', 1 );
				break;

			case 'rescore':
				$count = \VisitorSentinel\Cron::finalize_clicks();
				$this->redirect( $back, 'rescored', $count );
				break;
		}
		$this->redirect( $back, 'failed', 0 );
	}

	/**
	 * Stream an export file and exit.
	 *
	 * @param string $what visitors, clicks or google_ads.
	 */
	private function export( $what ) {
		$stamp = gmdate( 'Y-m-d' );
		nocache_headers();

		if ( 'google_ads' === $what ) {
			$lines = array();
			foreach ( (array) Repository::instance()->active_blocks() as $block ) {
				$entry = IP::to_google_ads( (string) $block->ip_range );
				if ( '' !== $entry ) {
					$lines[ $entry ] = true;
				}
			}
			header( 'Content-Type: text/plain; charset=utf-8' );
			header( 'Content-Disposition: attachment; filename="google-ads-ip-exclusions-' . $stamp . '.txt"' );
			// Google Ads accepts up to 500 IP exclusions per campaign.
			echo implode( "\n", array_slice( array_keys( $lines ), 0, 500 ) ) . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- plain-text download of validated IPs.
			exit;
		}

		$what = 'clicks' === $what ? 'clicks' : 'visitors';
		$rows = (array) Repository::instance()->export_rows( $what );
		header( 'Content-Type: text/csv; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename="visitor-sentinel-' . $what . '-' . $stamp . '.csv"' );
		$out = fopen( 'php://output', 'w' );
		if ( ! empty( $rows ) ) {
			fputcsv( $out, array_keys( $rows[0] ) );
			foreach ( $rows as $row ) {
				fputcsv( $out, array_map( array( __CLASS__, 'csv_cell' ), $row ) );
			}
		}
		fclose( $out ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose
		exit;
	}

	/**
	 * Neutralize spreadsheet formulas in a CSV cell.
	 *
	 * @param mixed $value Value.
	 * @return string
	 */
	public static function csv_cell( $value ) {
		$value = (string) $value;
		return '' !== $value && in_array( $value[0], array( '=', '+', '-', '@', "\t", "\r" ), true ) && ! is_numeric( $value ) ? "'" . $value : $value;
	}

	/**
	 * Redirect with a notice code and stop.
	 *
	 * @param string $url   URL.
	 * @param string $code  Notice code.
	 * @param int    $count Count for the notice.
	 */
	private function redirect( $url, $code, $count ) {
		wp_safe_redirect(
			add_query_arg(
				array(
					'vsen_notice' => $code,
					'vsen_count'  => (int) $count,
				),
				$url
			)
		);
		exit;
	}

	/**
	 * Show the result of the last action.
	 */
	public function notices() {
		if ( ! isset( $_GET['vsen_notice'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			return;
		}
		$code  = sanitize_key( wp_unslash( $_GET['vsen_notice'] ) ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$count = isset( $_GET['vsen_count'] ) ? absint( $_GET['vsen_count'] ) : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$map   = array(
			/* translators: %d: number of IPs */
			'blocked'      => array( 'success', _n( '%d IP blocked.', '%d IPs blocked.', $count, 'visitor-sentinel' ) ),
			/* translators: %d: number of IPs */
			'unblocked'    => array( 'success', _n( '%d block removed.', '%d blocks removed.', $count, 'visitor-sentinel' ) ),
			/* translators: %d: number of clicks */
			'marked_valid' => array( 'success', _n( '%d click marked as valid.', '%d clicks marked as valid.', $count, 'visitor-sentinel' ) ),
			/* translators: %d: number of clicks */
			'marked_fraud' => array( 'success', _n( '%d click confirmed as fraud.', '%d clicks confirmed as fraud.', $count, 'visitor-sentinel' ) ),
			/* translators: %d: number of clicks */
			'rescored'     => array( 'success', _n( '%d pending click given its final score.', '%d pending clicks given their final score.', $count, 'visitor-sentinel' ) ),
			'purged'       => array( 'success', __( 'All tracking data was deleted. The blocklist was kept.', 'visitor-sentinel' ) ),
			'invalid_ip'   => array( 'error', __( 'That is not a valid IP address or CIDR range.', 'visitor-sentinel' ) ),
			'failed'       => array( 'error', __( 'Nothing was changed.', 'visitor-sentinel' ) ),
		);
		if ( ! isset( $map[ $code ] ) ) {
			return;
		}
		printf( '<div class="notice notice-%1$s is-dismissible"><p>%2$s</p></div>', esc_attr( $map[ $code ][0] ), esc_html( sprintf( $map[ $code ][1], $count ) ) );
	}

	// ---------------------------------------------------------------------------------------------
	// REST: live visitors.
	// ---------------------------------------------------------------------------------------------

	/**
	 * Visitors active in the last five minutes.
	 *
	 * @return \WP_REST_Response
	 */
	public function rest_live() {
		$repo = Repository::instance();
		$rows = array();
		foreach ( (array) $repo->live_sessions( 5, 15 ) as $s ) {
			$rows[] = array(
				'visitor' => (int) $s->visitor_id,
				'url'     => (string) wp_parse_url( (string) $s->exit_url, PHP_URL_PATH ),
				'ip'      => self::ip_label( $s->ip, $s->ip_hash ),
				'country' => (string) $s->country,
				'flag'    => self::flag( (string) $s->country ),
				'device'  => (string) $s->device,
				'browser' => (string) $s->browser,
				'paid'    => (bool) $s->is_paid,
				'score'   => (int) $s->fraud_score,
				'ago'     => human_time_diff( (int) strtotime( $s->last_activity . ' UTC' ), time() ),
				'link'    => esc_url_raw( admin_url( 'admin.php?page=vsen-visitors&visitor=' . (int) $s->visitor_id ) ),
			);
		}
		return new \WP_REST_Response(
			array(
				'count'    => $repo->live_count( 5 ),
				'sessions' => $rows,
			)
		);
	}

	// ---------------------------------------------------------------------------------------------
	// Ranges and series.
	// ---------------------------------------------------------------------------------------------

	/**
	 * Selected dashboard range.
	 *
	 * @return string today, 7d or 30d.
	 */
	private function current_range() {
		$range = isset( $_GET['range'] ) ? sanitize_key( wp_unslash( $_GET['range'] ) ) : '7d'; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		return in_array( $range, array( 'today', '7d', '30d' ), true ) ? $range : '7d';
	}

	/**
	 * UTC start and end of a range, measured in the site's time zone.
	 *
	 * @param string $range today, 7d or 30d.
	 * @return string[]
	 */
	private function range_bounds( $range ) {
		$days  = array(
			'today' => 0,
			'7d'    => 6,
			'30d'   => 29,
		);
		$start = new \DateTimeImmutable( 'today', wp_timezone() );
		$start = $start->modify( '-' . $days[ $range ] . ' days' )->setTimezone( new \DateTimeZone( 'UTC' ) );
		return array( $start->format( 'Y-m-d H:i:s' ), Repository::now( 1 ) );
	}

	/**
	 * Daily totals for the chart, folded from UTC hours into local days.
	 *
	 * @param int $days Number of days ending today.
	 * @return array List of date, label, pageviews, visitors, ads, fraud.
	 */
	private function daily_series( $days ) {
		$tz    = wp_timezone();
		$utc   = new \DateTimeZone( 'UTC' );
		$start = ( new \DateTimeImmutable( 'today', $tz ) )->modify( '-' . ( $days - 1 ) . ' days' );
		$out   = array();
		for ( $i = 0; $i < $days; $i++ ) {
			$day         = $start->modify( '+' . $i . ' days' );
			$key         = $day->format( 'Y-m-d' );
			$out[ $key ] = array(
				'date'      => $key,
				'label'     => wp_date( 'M j', $day->getTimestamp() ),
				'pageviews' => 0,
				'visitors'  => array(),
				'ads'       => 0,
				'fraud'     => 0,
			);
		}
		$hours = Repository::instance()->hourly_series( $start->setTimezone( $utc )->format( 'Y-m-d H:i:s' ) );
		$local = function ( $hour ) use ( $tz, $utc ) {
			$dt = \DateTimeImmutable::createFromFormat( 'Y-m-d H:i:s', $hour . ':00:00', $utc );
			return $dt ? $dt->setTimezone( $tz )->format( 'Y-m-d' ) : '';
		};
		foreach ( array( 'pageviews', 'ads', 'fraud' ) as $metric ) {
			foreach ( $hours[ $metric ] as $hour => $n ) {
				$day = $local( $hour );
				if ( isset( $out[ $day ] ) ) {
					$out[ $day ][ $metric ] += $n;
				}
			}
		}
		foreach ( $hours['visitors'] as $hour => $ids ) {
			$day = $local( $hour );
			if ( isset( $out[ $day ] ) ) {
				$out[ $day ]['visitors'] += $ids;
			}
		}
		foreach ( $out as $key => $row ) {
			$out[ $key ]['visitors'] = count( $row['visitors'] );
		}
		return array_values( $out );
	}

	// ---------------------------------------------------------------------------------------------
	// View helpers.
	// ---------------------------------------------------------------------------------------------

	/**
	 * Stop unless the user may use the plugin.
	 */
	private function require_cap() {
		if ( ! current_user_can( Plugin::capability() ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to access this page.', 'visitor-sentinel' ), 403 );
		}
	}

	/**
	 * Address for display: the stored IP, or a short hash when IPs are not stored.
	 *
	 * @param string $ip      Stored IP.
	 * @param string $ip_hash IP hash.
	 * @return string
	 */
	public static function ip_label( $ip, $ip_hash ) {
		if ( '' !== (string) $ip ) {
			return (string) $ip;
		}
		return '' !== (string) $ip_hash ? '#' . substr( (string) $ip_hash, 0, 10 ) : '—';
	}

	/**
	 * Emoji flag for a country code.
	 *
	 * @param string $code Two-letter code.
	 * @return string
	 */
	public static function flag( $code ) {
		if ( ! preg_match( '/^[A-Z]{2}$/', (string) $code ) ) {
			return '';
		}
		$flag = '';
		foreach ( str_split( $code ) as $char ) {
			$flag .= html_entity_decode( '&#' . ( 0x1F1E6 + ord( $char ) - 65 ) . ';', ENT_NOQUOTES, 'UTF-8' );
		}
		return $flag;
	}

	/**
	 * Score badge HTML.
	 *
	 * @param int $score Score.
	 * @return string
	 */
	public static function score_badge( $score ) {
		$score = (int) $score;
		$class = 'vsen-badge--clean';
		if ( $score >= Fraud_Engine::FRAUD_AT ) {
			$class = 'vsen-badge--fraud';
		} elseif ( $score >= Fraud_Engine::SUSPICIOUS_AT ) {
			$class = 'vsen-badge--suspicious';
		}
		return '<span class="vsen-badge ' . esc_attr( $class ) . '">' . esc_html( (string) $score ) . '</span>';
	}

	/**
	 * Status label HTML for a click.
	 *
	 * @param object $click Click row.
	 * @return string
	 */
	public static function status_pill( $click ) {
		if ( ! in_array( $click->click_type, Repository::AD_TYPES, true ) ) {
			return '<span class="vsen-pill">' . esc_html__( 'Activity', 'visitor-sentinel' ) . '</span>';
		}
		$labels = array(
			Fraud_Engine::STATUS_CLEAN      => array( 'clean', __( 'Clean', 'visitor-sentinel' ) ),
			Fraud_Engine::STATUS_SUSPICIOUS => array( 'suspicious', __( 'Suspicious', 'visitor-sentinel' ) ),
			Fraud_Engine::STATUS_FRAUD      => array( 'fraud', __( 'Fraudulent', 'visitor-sentinel' ) ),
		);
		$label  = isset( $labels[ (int) $click->status ] ) ? $labels[ (int) $click->status ] : $labels[0];
		$extra  = '';
		if ( 1 === (int) $click->reviewed ) {
			$extra = ' ' . __( '(reviewed)', 'visitor-sentinel' );
		} elseif ( 2 === (int) $click->reviewed ) {
			$extra = ' ' . __( '(confirmed)', 'visitor-sentinel' );
		} elseif ( ! (int) $click->finalized ) {
			$extra = ' ' . __( '(pending)', 'visitor-sentinel' );
		}
		return '<span class="vsen-pill vsen-pill--' . esc_attr( $label[0] ) . '">' . esc_html( $label[1] . $extra ) . '</span>';
	}

	/**
	 * Readable list of the reasons behind a score.
	 *
	 * @param string $reasons Comma-separated rule IDs.
	 * @return string[]
	 */
	public static function reason_labels( $reasons ) {
		$labels = Fraud_Engine::labels();
		$out    = array();
		foreach ( array_filter( explode( ',', (string) $reasons ) ) as $rule ) {
			$out[] = isset( $labels[ $rule ] ) ? $labels[ $rule ] : $rule;
		}
		return $out;
	}

	/**
	 * Human label for a click type.
	 *
	 * @param string $type Click type.
	 * @return string
	 */
	public static function click_type_label( $type ) {
		$labels = array(
			'ad_landing' => __( 'Paid ad visit', 'visitor-sentinel' ),
			'ad_click'   => __( 'On-site ad click', 'visitor-sentinel' ),
			'outbound'   => __( 'Outbound link', 'visitor-sentinel' ),
			'download'   => __( 'Download', 'visitor-sentinel' ),
			'tracked'    => __( 'Tracked element', 'visitor-sentinel' ),
		);
		return isset( $labels[ $type ] ) ? $labels[ $type ] : (string) $type;
	}

	/**
	 * Local date and time for a UTC MySQL datetime.
	 *
	 * @param string $utc    Datetime.
	 * @param string $format Format, defaults to the site's.
	 * @return string
	 */
	public static function local_time( $utc, $format = '' ) {
		if ( empty( $utc ) ) {
			return '—';
		}
		$format = '' !== (string) $format ? $format : trim( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ) );
		return wp_date( '' !== $format ? $format : 'Y-m-d H:i', (int) strtotime( $utc . ' UTC' ) );
	}

	/**
	 * Seconds as "3m 20s".
	 *
	 * @param int $seconds Seconds.
	 * @return string
	 */
	public static function duration( $seconds ) {
		$seconds = max( 0, (int) $seconds );
		if ( $seconds < 60 ) {
			return $seconds . 's';
		}
		if ( $seconds < 3600 ) {
			return floor( $seconds / 60 ) . 'm ' . ( $seconds % 60 ) . 's';
		}
		return floor( $seconds / 3600 ) . 'h ' . floor( ( $seconds % 3600 ) / 60 ) . 'm';
	}

	/**
	 * Whether an IP hash is on the active blocklist.
	 *
	 * @param string $ip_hash IP hash.
	 * @return bool
	 */
	public static function hash_blocked( $ip_hash ) {
		$index = Protection::index();
		if ( ! isset( $index['h'][ $ip_hash ] ) ) {
			return false;
		}
		$expires = (int) $index['h'][ $ip_hash ];
		return 0 === $expires || $expires > time();
	}
}

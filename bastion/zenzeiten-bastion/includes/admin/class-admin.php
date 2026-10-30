<?php
/**
 * Admin screens, form handlers and the live monitor's REST route.
 *
 * @package ZenZeiTenBastion
 */

namespace ZenZeiTenBastion\Admin;

use ZenZeiTenBastion\Backup;
use ZenZeiTenBastion\Blocklist;
use ZenZeiTenBastion\Firewall;
use ZenZeiTenBastion\IP;
use ZenZeiTenBastion\Log;
use ZenZeiTenBastion\Plugin;
use ZenZeiTenBastion\Request;
use ZenZeiTenBastion\Settings;

defined( 'ABSPATH' ) || exit;

/**
 * Menu, screens and actions. Every handler checks the capability and a nonce itself.
 */
final class Admin {

	const PER_PAGE = 50;

	/**
	 * Register hooks.
	 */
	public function register() {
		add_action( 'admin_menu', array( $this, 'menu' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'assets' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( ZBST_FILE ), array( $this, 'action_links' ) );
		foreach ( array( 'block', 'unblock', 'forget', 'backup_now', 'download', 'restore', 'delete_backup', 'upload', 'save_settings' ) as $action ) {
			add_action( 'admin_post_zbst_' . $action, array( $this, 'handle_' . $action ) );
		}
	}

	/**
	 * REST route for the live monitor.
	 */
	public function routes() {
		register_rest_route(
			'zenzeiten-bastion/v1',
			'/live',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'live' ),
				'permission_callback' => function () {
					return current_user_can( Plugin::capability() );
				},
				'args'                => array(
					'after' => array(
						'type'              => 'integer',
						'default'           => 0,
						'sanitize_callback' => 'absint',
					),
				),
			)
		);
	}

	/**
	 * Live monitor data: events after the client's last ID, plus the headline numbers.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response
	 */
	public function live( $request ) {
		$after  = (int) $request->get_param( 'after' );
		$events = array();
		foreach ( Log::after( $after, $after ? 100 : 30 ) as $row ) {
			$events[] = self::event_for_js( $row );
		}
		$stats    = Log::stats();
		$response = new \WP_REST_Response(
			array(
				'events'   => $events,
				'counters' => self::counters( $stats ),
				'hours'    => array_values( $stats['hours'] ),
			)
		);
		$response->header( 'Cache-Control', 'no-store' );
		return $response;
	}

	/**
	 * Headline numbers.
	 *
	 * @param array $stats Log::stats().
	 * @return array
	 */
	public static function counters( array $stats ) {
		$t = $stats['by_type'];
		return array(
			'blocked'  => (int) $stats['blocked'],
			'firewall' => isset( $t['firewall'] ) ? (int) $t['firewall'] : 0,
			'logins'   => isset( $t['login_failed'] ) ? (int) $t['login_failed'] : 0,
			'active'   => Blocklist::count_active(),
		);
	}

	/**
	 * An event row as the live monitor shows it. Text is escaped in the browser.
	 *
	 * @param array $row Event row.
	 * @return array
	 */
	public static function event_for_js( array $row ) {
		$types      = Log::types();
		$severities = Log::severities();
		$labels     = Firewall::labels();
		$details    = (string) ( '' !== $row['details'] ? $row['details'] : $row['username'] );
		if ( isset( $labels[ $row['rule'] ] ) ) {
			$details = $labels[ $row['rule'] ] . ' · ' . $details;
		}
		return array(
			'id'       => (int) $row['id'],
			'time'     => self::local_time( $row['created_at'], 'H:i:s' ),
			'ip'       => (string) $row['ip'],
			'type'     => isset( $types[ $row['type'] ] ) ? $types[ $row['type'] ] : (string) $row['type'],
			'severity' => (int) $row['severity'],
			'level'    => isset( $severities[ (int) $row['severity'] ] ) ? $severities[ (int) $row['severity'] ] : '',
			'action'   => (string) $row['action'],
			'request'  => trim( $row['method'] . ' ' . $row['uri'] ),
			'details'  => $details,
		);
	}

	/**
	 * A stored UTC time in the site's time zone.
	 *
	 * @param string|null $utc    'Y-m-d H:i:s' in UTC.
	 * @param string      $format Format.
	 * @return string
	 */
	public static function local_time( $utc, $format = 'Y-m-d H:i' ) {
		if ( ! $utc ) {
			return '';
		}
		$ts = strtotime( $utc . ' UTC' );
		return $ts ? wp_date( $format, $ts ) : '';
	}

	/**
	 * Admin menu.
	 */
	public function menu() {
		$cap = Plugin::capability();
		add_menu_page( __( 'Bastion', 'zenzeiten-bastion' ), __( 'Bastion', 'zenzeiten-bastion' ), $cap, 'zbst-dashboard', array( $this, 'page_dashboard' ), 'dashicons-shield', 80 );
		add_submenu_page( 'zbst-dashboard', __( 'Live monitor', 'zenzeiten-bastion' ), __( 'Live monitor', 'zenzeiten-bastion' ), $cap, 'zbst-dashboard', array( $this, 'page_dashboard' ) );
		add_submenu_page( 'zbst-dashboard', __( 'Attack log', 'zenzeiten-bastion' ), __( 'Attack log', 'zenzeiten-bastion' ), $cap, 'zbst-events', array( $this, 'page_events' ) );
		add_submenu_page( 'zbst-dashboard', __( 'Blocked IPs', 'zenzeiten-bastion' ), __( 'Blocked IPs', 'zenzeiten-bastion' ), $cap, 'zbst-blocks', array( $this, 'page_blocks' ) );
		add_submenu_page( 'zbst-dashboard', __( 'Backups', 'zenzeiten-bastion' ), __( 'Backups', 'zenzeiten-bastion' ), $cap, 'zbst-backups', array( $this, 'page_backups' ) );
		add_submenu_page( 'zbst-dashboard', __( 'Settings', 'zenzeiten-bastion' ), __( 'Settings', 'zenzeiten-bastion' ), $cap, 'zbst-settings', array( $this, 'page_settings' ) );
	}

	/**
	 * Settings link on the Plugins screen.
	 *
	 * @param array $links Links.
	 * @return array
	 */
	public function action_links( $links ) {
		array_unshift( $links, '<a href="' . esc_url( admin_url( 'admin.php?page=zbst-settings' ) ) . '">' . esc_html__( 'Settings', 'zenzeiten-bastion' ) . '</a>' );
		return $links;
	}

	/**
	 * Styles and scripts on our screens only.
	 *
	 * @param string $hook Screen hook.
	 */
	public function assets( $hook ) {
		if ( false === strpos( (string) $hook, 'zbst-' ) ) {
			return;
		}
		wp_enqueue_style( 'zbst-admin', ZBST_URL . 'assets/css/admin.css', array(), ZBST_VERSION );
		wp_enqueue_script( 'zbst-admin', ZBST_URL . 'assets/js/admin.js', array(), ZBST_VERSION, true );
		wp_localize_script(
			'zbst-admin',
			'zbstAdmin',
			array(
				'live'     => esc_url_raw( rest_url( 'zenzeiten-bastion/v1/live' ) ),
				'nonce'    => wp_create_nonce( 'wp_rest' ),
				'interval' => 4000,
				'i18n'     => array(
					'paused'  => __( 'Paused', 'zenzeiten-bastion' ),
					'live'    => __( 'Live', 'zenzeiten-bastion' ),
					'offline' => __( 'Connection lost, retrying…', 'zenzeiten-bastion' ),
					'empty'   => __( 'No events yet. Attacks will appear here as they happen.', 'zenzeiten-bastion' ),
					'block'   => __( 'Block', 'zenzeiten-bastion' ),
					'restore' => __( 'Replace the whole database with this backup? A safety backup of the current database is taken first and restored automatically if anything fails.', 'zenzeiten-bastion' ),
					'delete'  => __( 'Delete this backup permanently?', 'zenzeiten-bastion' ),
				),
				'blockUrl' => esc_url_raw( admin_url( 'admin.php?page=zbst-blocks' ) ),
			)
		);
	}

	/**
	 * Stop unless the user has the capability and the nonce is valid.
	 *
	 * @param string $action Nonce action.
	 */
	private function guard( $action ) {
		if ( ! current_user_can( Plugin::capability() ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to do that.', 'zenzeiten-bastion' ), 403 );
		}
		check_admin_referer( $action );
	}

	/**
	 * Back to a screen with a notice.
	 *
	 * @param string $page   Page slug.
	 * @param string $type   success or error.
	 * @param string $notice Message.
	 */
	private function back( $page, $type, $notice ) {
		set_transient( 'zbst_notice_' . get_current_user_id(), array( $type, $notice ), 60 );
		wp_safe_redirect( admin_url( 'admin.php?page=' . $page ) );
		exit;
	}

	/**
	 * Show and clear the pending notice.
	 */
	public static function notice() {
		$key    = 'zbst_notice_' . get_current_user_id();
		$notice = get_transient( $key );
		if ( is_array( $notice ) ) {
			delete_transient( $key );
			printf( '<div class="notice notice-%s is-dismissible"><p>%s</p></div>', 'error' === $notice[0] ? 'error' : 'success', esc_html( $notice[1] ) );
		}
	}

	/**
	 * A POST or GET value as plain text.
	 *
	 * @param string $key Key.
	 * @return string
	 */
	private static function input( $key ) {
		// phpcs:ignore WordPress.Security.NonceVerification -- every caller verified the nonce first.
		return isset( $_REQUEST[ $key ] ) ? sanitize_text_field( wp_unslash( $_REQUEST[ $key ] ) ) : '';
	}

	/**
	 * Block an address by hand.
	 */
	public function handle_block() {
		$this->guard( 'zbst_block' );
		$ip      = self::input( 'ip' );
		$minutes = '' === self::input( 'minutes' ) ? 0 : max( 0, (int) self::input( 'minutes' ) );
		if ( '' !== $ip && IP::in_range( Request::ip(), $ip ) ) {
			$this->back( 'zbst-blocks', 'error', __( 'That would block your own address, so it was not blocked.', 'zenzeiten-bastion' ) );
		}
		$reason = '' !== self::input( 'reason' ) ? self::input( 'reason' ) : __( 'Blocked by an administrator', 'zenzeiten-bastion' );
		$block  = Blocklist::add( $ip, 'manual', $reason, $minutes );
		if ( ! $block ) {
			$this->back( 'zbst-blocks', 'error', __( 'Enter a valid IP address or range that is not on the allowlist.', 'zenzeiten-bastion' ) );
		}
		Log::add(
			array(
				'ip'       => $block['ip'],
				'type'     => 'manual_block',
				'severity' => Log::SEVERITY_LOW,
				'score'    => 0,
				'action'   => 'locked',
				'details'  => $reason,
			)
		);
		/* translators: %s: address */
		$this->back( 'zbst-blocks', 'success', sprintf( __( 'Blocked %s.', 'zenzeiten-bastion' ), $block['ip'] ) );
	}

	/**
	 * Lift a block.
	 */
	public function handle_unblock() {
		$this->guard( 'zbst_unblock' );
		$ip = self::input( 'ip' );
		if ( Blocklist::remove( $ip ) ) {
			Log::add(
				array(
					'ip'       => $ip,
					'type'     => 'unblock',
					'severity' => Log::SEVERITY_LOW,
					'score'    => 0,
				)
			);
			/* translators: %s: address */
			$this->back( 'zbst-blocks', 'success', sprintf( __( 'Unblocked %s.', 'zenzeiten-bastion' ), $ip ) );
		}
		$this->back( 'zbst-blocks', 'error', __( 'That address is not blocked.', 'zenzeiten-bastion' ) );
	}

	/**
	 * Lift a block and forget its history, so a new offence starts at the shortest block again.
	 */
	public function handle_forget() {
		$this->guard( 'zbst_forget' );
		Blocklist::forget( (int) self::input( 'id' ) );
		$this->back( 'zbst-blocks', 'success', __( 'Block removed and its history forgotten.', 'zenzeiten-bastion' ) );
	}

	/**
	 * Back up now.
	 */
	public function handle_backup_now() {
		$this->guard( 'zbst_backup_now' );
		$result = Backup::create( 'manual' );
		if ( is_wp_error( $result ) ) {
			$this->back( 'zbst-backups', 'error', $result->get_error_message() );
		}
		/* translators: 1: tables, 2: rows */
		$this->back( 'zbst-backups', 'success', sprintf( __( 'Backup created: %1$d tables, %2$d rows.', 'zenzeiten-bastion' ), $result['tables'], $result['rows'] ) );
	}

	/**
	 * Download a backup file.
	 */
	public function handle_download() {
		$this->guard( 'zbst_download' );
		$manifest = Backup::get( self::input( 'id' ) );
		$path     = $manifest ? Backup::path( $manifest ) : '';
		if ( '' === $path || ! is_readable( $path ) ) {
			wp_die( esc_html__( 'That backup does not exist.', 'zenzeiten-bastion' ), 404 );
		}
		nocache_headers();
		header( 'Content-Type: application/gzip' );
		header( 'Content-Disposition: attachment; filename="' . sanitize_file_name( wp_parse_url( home_url(), PHP_URL_HOST ) . '-' . $manifest['id'] . '.sql.gz' ) . '"' );
		header( 'Content-Length: ' . filesize( $path ) );
		header( 'X-Content-Type-Options: nosniff' );
		readfile( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_readfile -- streaming a private file to an authorised user.
		exit;
	}

	/**
	 * Restore a backup.
	 */
	public function handle_restore() {
		$this->guard( 'zbst_restore' );
		$id     = self::input( 'id' );
		$result = Backup::restore( $id );
		if ( is_wp_error( $result ) ) {
			$this->back( 'zbst-backups', 'error', $result->get_error_message() );
		}
		/* translators: 1: backup ID, 2: safety backup ID */
		$this->back( 'zbst-backups', 'success', sprintf( __( 'Database restored from %1$s. The database as it was before is saved as %2$s. If the site uses a different login now, sign in again.', 'zenzeiten-bastion' ), $id, $result['safety'] ) );
	}

	/**
	 * Delete a backup.
	 */
	public function handle_delete_backup() {
		$this->guard( 'zbst_delete_backup' );
		Backup::delete( self::input( 'id' ) );
		$this->back( 'zbst-backups', 'success', __( 'Backup deleted.', 'zenzeiten-bastion' ) );
	}

	/**
	 * Add an uploaded backup file to the list.
	 */
	public function handle_upload() {
		$this->guard( 'zbst_upload' );
		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- the temp path is checked with is_uploaded_file() and the file's header is validated.
		$tmp = isset( $_FILES['backup']['tmp_name'] ) ? (string) $_FILES['backup']['tmp_name'] : '';
		if ( '' === $tmp || ! is_uploaded_file( $tmp ) ) {
			$this->back( 'zbst-backups', 'error', __( 'Choose a backup file to upload. If you did, it may be larger than the server allows.', 'zenzeiten-bastion' ) );
		}
		$result = Backup::import( $tmp );
		if ( is_wp_error( $result ) ) {
			$this->back( 'zbst-backups', 'error', $result->get_error_message() );
		}
		/* translators: %s: backup ID */
		$this->back( 'zbst-backups', 'success', sprintf( __( 'Backup uploaded as %s. You can restore it from the list.', 'zenzeiten-bastion' ), $result['id'] ) );
	}

	/**
	 * Save settings.
	 */
	public function handle_save_settings() {
		$this->guard( 'zbst_save_settings' );
		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- Settings::sanitize() cleans every key.
		$input = isset( $_POST['zbst'] ) && is_array( $_POST['zbst'] ) ? wp_unslash( $_POST['zbst'] ) : array();
		update_option( Settings::OPTION, Settings::sanitize( $input ) );
		Settings::flush();
		$this->back( 'zbst-settings', 'success', __( 'Settings saved.', 'zenzeiten-bastion' ) );
	}

	/**
	 * Check the capability before rendering a screen (screens can be opened by URL).
	 */
	private function can_view() {
		if ( ! current_user_can( Plugin::capability() ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to access this page.', 'zenzeiten-bastion' ), 403 );
		}
	}

	/**
	 * Dashboard and live monitor.
	 */
	public function page_dashboard() {
		$this->can_view();
		$stats    = Log::stats();
		$counters = self::counters( $stats );
		$last     = get_option( 'zbst_last_backup', array() );
		$recent   = array_map( array( __CLASS__, 'event_for_js' ), array_reverse( Log::query( array(), 30, 0 ) ) );
		include __DIR__ . '/views/dashboard.php';
	}

	/**
	 * Attack log.
	 */
	public function page_events() {
		$this->can_view();
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- read-only filters.
		$filters = array(
			'type'     => isset( $_GET['type'] ) ? sanitize_key( wp_unslash( $_GET['type'] ) ) : '',
			'ip'       => isset( $_GET['ip'] ) ? IP::normalize( sanitize_text_field( wp_unslash( $_GET['ip'] ) ) ) : '',
			'severity' => isset( $_GET['severity'] ) ? absint( $_GET['severity'] ) : 0,
		);
		$paged   = isset( $_GET['paged'] ) ? max( 1, absint( $_GET['paged'] ) ) : 1;
		// phpcs:enable
		$total  = Log::count( $filters );
		$events = Log::query( $filters, self::PER_PAGE, ( $paged - 1 ) * self::PER_PAGE );
		$pages  = max( 1, (int) ceil( $total / self::PER_PAGE ) );
		include __DIR__ . '/views/events.php';
	}

	/**
	 * Blocked addresses.
	 */
	public function page_blocks() {
		$this->can_view();
		$blocks = Blocklist::active( 500 );
		$own_ip = Request::ip();
		include __DIR__ . '/views/blocks.php';
	}

	/**
	 * Backups.
	 */
	public function page_backups() {
		$this->can_view();
		$backups = Backup::all();
		$dir     = Backup::dir();
		include __DIR__ . '/views/backups.php';
	}

	/**
	 * Settings.
	 */
	public function page_settings() {
		$this->can_view();
		$s      = Settings::all();
		$rules  = Firewall::labels();
		$own_ip = Request::ip();
		include __DIR__ . '/views/settings.php';
	}

	/**
	 * Link to an admin-post action with its nonce.
	 *
	 * @param string $action Action without the zbst_ prefix.
	 * @param array  $args   Extra query arguments.
	 * @return string
	 */
	public static function action_url( $action, array $args = array() ) {
		return wp_nonce_url( add_query_arg( array_merge( array( 'action' => 'zbst_' . $action ), $args ), admin_url( 'admin-post.php' ) ), 'zbst_' . $action );
	}
}

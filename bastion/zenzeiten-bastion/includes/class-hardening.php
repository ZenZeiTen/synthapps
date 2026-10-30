<?php
/**
 * Login protection and hardening: brute-force lockout, user enumeration, XML-RPC, 404 floods
 * and request rate limits.
 *
 * @package ZenZeiTenBastion
 */

namespace ZenZeiTenBastion;

defined( 'ABSPATH' ) || exit;

/**
 * Hooks into WordPress authentication and routing.
 */
final class Hardening {

	/**
	 * Register hooks.
	 */
	public static function register() {
		add_action( 'wp_login_failed', array( __CLASS__, 'login_failed' ), 10, 1 );
		add_action( 'wp_login', array( __CLASS__, 'login_ok' ), 10, 2 );
		add_filter( 'login_errors', array( __CLASS__, 'login_errors' ) );
		add_action( 'template_redirect', array( __CLASS__, 'template_redirect' ), 0 );
		add_filter( 'rest_pre_dispatch', array( __CLASS__, 'rest_users' ), 10, 3 );
		add_filter( 'xmlrpc_enabled', array( __CLASS__, 'xmlrpc_enabled' ) );
		add_filter( 'xmlrpc_methods', array( __CLASS__, 'xmlrpc_methods' ) );
		add_action( 'init', array( __CLASS__, 'xmlrpc_off' ), 0 );
	}

	/**
	 * A failed login: log it and lock the address out after too many.
	 *
	 * @param string $username Username tried.
	 */
	public static function login_failed( $username ) {
		$ip = Request::ip();
		if ( '' === $ip || Blocklist::is_allowlisted( $ip ) ) {
			return;
		}
		$xmlrpc = defined( 'XMLRPC_REQUEST' ) && XMLRPC_REQUEST;
		Log::add(
			array(
				'type'     => 'login_failed',
				'severity' => Log::SEVERITY_MEDIUM,
				'score'    => 2,
				'username' => (string) $username,
				'details'  => $xmlrpc ? __( 'Through XML-RPC', 'zenzeiten-bastion' ) : '',
			)
		);
		$window   = (int) Settings::get( 'login_window' );
		$failures = Log::count_for( $ip, 'login_failed', $window );
		if ( $failures >= (int) Settings::get( 'login_max_failures' ) ) {
			/* translators: 1: number of failed logins, 2: minutes */
			$reason = sprintf( __( '%1$d failed logins in %2$d minutes', 'zenzeiten-bastion' ), $failures, $window );
			Guard::auto_block( $ip, 'login', $reason, (int) Settings::get( 'login_lockout' ) );
		}
	}

	/**
	 * A successful login: remember administrator addresses so automatic blocking spares them.
	 *
	 * @param string $login Username.
	 * @param object $user  WP_User.
	 */
	public static function login_ok( $login, $user = null ) {
		if ( $user && method_exists( $user, 'has_cap' ) && $user->has_cap( 'manage_options' ) ) {
			Blocklist::remember_admin_ip( Request::ip() );
			Log::add(
				array(
					'type'     => 'login_ok',
					'severity' => Log::SEVERITY_LOW,
					'score'    => 0,
					'username' => (string) $login,
				)
			);
		}
	}

	/**
	 * Replace login error messages with one that does not reveal whether the username exists.
	 *
	 * @param string $message Message.
	 * @return string
	 */
	public static function login_errors( $message ) {
		if ( ! Settings::get( 'generic_login_errors' ) || '' === trim( wp_strip_all_tags( (string) $message ) ) ) {
			return $message;
		}
		return '<strong>' . esc_html__( 'Error:', 'zenzeiten-bastion' ) . '</strong> ' . esc_html__( 'The username or password is incorrect.', 'zenzeiten-bastion' );
	}

	/**
	 * Front-end checks: author-ID scans and 404 floods.
	 */
	public static function template_redirect() {
		if ( Guard::exempt() || is_user_logged_in() ) {
			return;
		}
		// ?author=1 redirects to /author/admin/, which reveals the login name.
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only check.
		if ( Settings::get( 'block_enumeration' ) && isset( $_GET['author'] ) && is_numeric( $_GET['author'] ) ) {
			Guard::report(
				array(
					'type'     => 'enumeration',
					'severity' => Log::SEVERITY_MEDIUM,
					'action'   => 'blocked',
					'details'  => __( 'Author ID scan', 'zenzeiten-bastion' ),
				)
			);
			wp_safe_redirect( home_url( '/' ), 302 );
			exit;
		}
		$limit = (int) Settings::get( 'not_found_limit' );
		if ( $limit > 0 && is_404() && Guard::bump( 'nf' . Request::ip(), 60 ) === $limit + 1 ) {
			Guard::report(
				array(
					'type'     => 'not_found',
					'severity' => Log::SEVERITY_HIGH,
					/* translators: %d: limit */
					'details'  => sprintf( __( 'More than %d missing pages in one minute', 'zenzeiten-bastion' ), $limit ),
				)
			);
		}
	}

	/**
	 * Hide the REST API's user list from visitors who are not logged in.
	 *
	 * @param mixed  $result  Response so far.
	 * @param mixed  $server  REST server.
	 * @param object $request Request.
	 * @return mixed
	 */
	public static function rest_users( $result, $server, $request ) {
		if ( null !== $result || ! Settings::get( 'block_enumeration' ) || is_user_logged_in() ) {
			return $result;
		}
		$route = method_exists( $request, 'get_route' ) ? (string) $request->get_route() : '';
		if ( 0 !== strpos( $route, '/wp/v2/users' ) ) {
			return $result;
		}
		Guard::report(
			array(
				'type'     => 'enumeration',
				'severity' => Log::SEVERITY_MEDIUM,
				'action'   => 'blocked',
				'details'  => __( 'REST API user list', 'zenzeiten-bastion' ),
			)
		);
		return new \WP_Error( 'rest_user_cannot_view', __( 'Sorry, you are not allowed to list users.', 'zenzeiten-bastion' ), array( 'status' => 401 ) );
	}

	/**
	 * XML-RPC methods that need a password are switched off unless the site allows them.
	 *
	 * @param bool $enabled Enabled.
	 * @return bool
	 */
	public static function xmlrpc_enabled( $enabled ) {
		return 'allow' === Settings::get( 'xmlrpc' ) ? $enabled : false;
	}

	/**
	 * system.multicall tries hundreds of passwords in one request; remove it unless allowed.
	 *
	 * @param array $methods Methods.
	 * @return array
	 */
	public static function xmlrpc_methods( $methods ) {
		if ( 'allow' !== Settings::get( 'xmlrpc' ) ) {
			unset( $methods['system.multicall'] );
		}
		return $methods;
	}

	/**
	 * Refuse every XML-RPC request when XML-RPC is switched off.
	 */
	public static function xmlrpc_off() {
		if ( 'off' === Settings::get( 'xmlrpc' ) && defined( 'XMLRPC_REQUEST' ) && XMLRPC_REQUEST && ! Guard::exempt() ) {
			Guard::report(
				array(
					'type'     => 'xmlrpc',
					'severity' => Log::SEVERITY_MEDIUM,
					'action'   => 'blocked',
					'details'  => __( 'XML-RPC is switched off', 'zenzeiten-bastion' ),
				)
			);
			Guard::deny( 403, __( 'XML-RPC is not available on this site.', 'zenzeiten-bastion' ) );
		}
	}

	/**
	 * Limit how many requests one address may make per minute. Logged-in users and cron are not
	 * counted; static files never reach WordPress. Runs before translations load, so its text is
	 * plain English.
	 */
	public static function rate_limit() {
		$limit = (int) Settings::get( 'rate_limit' );
		if ( $limit <= 0 || is_user_logged_in() || ( defined( 'DOING_CRON' ) && DOING_CRON ) ) {
			return;
		}
		$ip    = Request::ip();
		$count = Guard::bump( 'rl' . $ip, 60 );
		if ( $count <= $limit ) {
			return;
		}
		if ( $count === $limit + 1 ) {
			Guard::report(
				array(
					'type'     => 'rate_limit',
					'severity' => Log::SEVERITY_HIGH,
					'action'   => 'blocked',
					'details'  => sprintf( 'More than %d requests in one minute', $limit ),
				)
			);
		}
		Guard::deny( 429, 'Too many requests. Please wait a minute and try again.' );
	}
}

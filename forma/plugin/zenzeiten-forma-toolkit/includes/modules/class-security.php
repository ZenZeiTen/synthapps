<?php
/**
 * Security module: safe-by-default hardening that does not get in the way of normal use.
 *
 * @package ZenZeiTen\FormaToolkit
 */

namespace ZenZeiTen\FormaToolkit;

defined( 'ABSPATH' ) || exit;

/**
 * Security settings.
 */
class Security extends Module {

	/** {@inheritDoc} */
	public function id() {
		return 'security';
	}

	/** {@inheritDoc} */
	public function label() {
		return __( 'Security', 'zenzeiten-forma-toolkit' );
	}

	/** {@inheritDoc} */
	public function description() {
		return __( 'Hardening that stays out of your way: protective browser headers, login guessing protection, and fewer details about your site for attackers to collect.', 'zenzeiten-forma-toolkit' );
	}

	/** {@inheritDoc} */
	public function default_enabled() {
		return true;
	}

	/** {@inheritDoc} */
	public function fields() {
		return array(
			'headers'         => array(
				'type'    => 'checkbox',
				'label'   => __( 'Send protective browser headers', 'zenzeiten-forma-toolkit' ),
				'help'    => __( 'Stops other sites from showing yours in a frame, stops browsers guessing file types, and limits what is shared when visitors follow a link away.', 'zenzeiten-forma-toolkit' ),
				'default' => true,
			),
			'hsts'            => array(
				'type'    => 'checkbox',
				'label'   => __( 'Tell browsers to always use HTTPS (HSTS)', 'zenzeiten-forma-toolkit' ),
				'help'    => __( 'Only switch this on when the whole site works over HTTPS. Browsers remember it for a year.', 'zenzeiten-forma-toolkit' ),
				'default' => false,
			),
			'hide_version'    => array(
				'type'    => 'checkbox',
				'label'   => __( 'Hide the WordPress version number', 'zenzeiten-forma-toolkit' ),
				'default' => true,
			),
			'block_user_enum' => array(
				'type'    => 'checkbox',
				'label'   => __( 'Hide usernames from visitors', 'zenzeiten-forma-toolkit' ),
				'help'    => __( 'Blocks the ?author= trick, the public users list in the REST API and the users sitemap for people who are not logged in.', 'zenzeiten-forma-toolkit' ),
				'default' => true,
			),
			'login_errors'    => array(
				'type'    => 'checkbox',
				'label'   => __( 'Use one error message for a wrong username or a wrong password', 'zenzeiten-forma-toolkit' ),
				'help'    => __( 'So the login form does not confirm which usernames exist.', 'zenzeiten-forma-toolkit' ),
				'default' => true,
			),
			'login_limit'     => array(
				'type'    => 'checkbox',
				'label'   => __( 'Pause logins after repeated failures from the same address', 'zenzeiten-forma-toolkit' ),
				'default' => true,
			),
			'login_attempts'  => array(
				'type'    => 'number',
				'label'   => __( 'Failed logins allowed', 'zenzeiten-forma-toolkit' ),
				'default' => 5,
				'min'     => 3,
				'max'     => 50,
			),
			'login_lockout'   => array(
				'type'    => 'number',
				'label'   => __( 'Pause length (minutes)', 'zenzeiten-forma-toolkit' ),
				'default' => 15,
				'min'     => 1,
				'max'     => 1440,
			),
			'disable_xmlrpc'  => array(
				'type'    => 'checkbox',
				'label'   => __( 'Turn off XML-RPC', 'zenzeiten-forma-toolkit' ),
				'help'    => __( 'An old remote-publishing interface that attackers like to target. Leave it on if you use the Jetpack plugin or a desktop app that needs it.', 'zenzeiten-forma-toolkit' ),
				'default' => false,
			),
			'disable_editor'  => array(
				'type'    => 'checkbox',
				'label'   => __( 'Turn off the theme and plugin file editors in the admin area', 'zenzeiten-forma-toolkit' ),
				'help'    => __( 'If an admin account is ever compromised, it cannot be used to change PHP files from the browser.', 'zenzeiten-forma-toolkit' ),
				'default' => false,
			),
		);
	}

	/** {@inheritDoc} */
	public function boot() {
		if ( $this->get( 'headers' ) || $this->get( 'hsts' ) ) {
			add_action( 'send_headers', array( $this, 'send_headers' ) );
			add_action( 'login_init', array( $this, 'send_headers' ) );
		}
		if ( $this->get( 'hide_version' ) ) {
			remove_action( 'wp_head', 'wp_generator' );
			add_filter( 'the_generator', '__return_empty_string' );
		}
		if ( $this->get( 'block_user_enum' ) ) {
			add_action( 'template_redirect', array( $this, 'block_author_scan' ), 1 );
			add_filter( 'rest_endpoints', array( $this, 'hide_users_endpoint' ) );
			add_filter( 'wp_sitemaps_add_provider', array( $this, 'hide_users_sitemap' ), 10, 2 );
			add_filter( 'oembed_response_data', array( $this, 'hide_oembed_author' ) );
		}
		if ( $this->get( 'login_limit' ) ) {
			// After WordPress checks the password (priority 20), which would replace an earlier error,
			// and before the generic message (100), so a paused address is refused even with the
			// right password.
			add_filter( 'authenticate', array( $this, 'refuse_while_paused' ), 99, 3 );
			add_action( 'wp_login_failed', array( $this, 'count_failure' ) );
			add_action( 'wp_login', array( $this, 'clear_failures' ) );
		}
		if ( $this->get( 'login_errors' ) ) {
			add_filter( 'authenticate', array( $this, 'generic_login_error' ), 100 );
		}
		if ( $this->get( 'disable_xmlrpc' ) ) {
			add_filter( 'xmlrpc_enabled', '__return_false' );
			add_filter( 'xmlrpc_methods', '__return_empty_array' );
			add_filter( 'wp_headers', array( $this, 'drop_pingback_header' ) );
			remove_action( 'wp_head', 'rsd_link' );
		}
		if ( $this->get( 'disable_editor' ) && ! defined( 'DISALLOW_FILE_EDIT' ) ) {
			define( 'DISALLOW_FILE_EDIT', true );
		}
	}

	/**
	 * The headers this module sends.
	 *
	 * @return array<string, string>
	 */
	public function header_list() {
		$headers = array();
		if ( $this->get( 'headers' ) ) {
			$headers['X-Content-Type-Options'] = 'nosniff';
			$headers['X-Frame-Options']        = 'SAMEORIGIN';
			$headers['Referrer-Policy']        = 'strict-origin-when-cross-origin';
			$headers['Permissions-Policy']     = 'browsing-topics=()';
		}
		if ( $this->get( 'hsts' ) && is_ssl() ) {
			$headers['Strict-Transport-Security'] = 'max-age=31536000';
		}
		/**
		 * Filters the security headers, for example to add a Content-Security-Policy.
		 *
		 * @param array<string, string> $headers Header name => value.
		 */
		return (array) apply_filters( 'zzft_security_headers', $headers );
	}

	/**
	 * Send the headers.
	 */
	public function send_headers() {
		if ( headers_sent() ) {
			return;
		}
		foreach ( $this->header_list() as $name => $value ) {
			header( $name . ': ' . $value );
		}
	}

	/**
	 * Redirect "?author=N" probes from visitors to the home page.
	 */
	public function block_author_scan() {
		if ( is_user_logged_in() || ! isset( $_GET['author'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only check.
			return;
		}
		wp_safe_redirect( home_url( '/' ), 301 );
		exit;
	}

	/**
	 * Remove the users routes from the REST API for visitors who are not logged in.
	 *
	 * @param array $endpoints REST endpoints.
	 * @return array
	 */
	public function hide_users_endpoint( $endpoints ) {
		if ( is_user_logged_in() ) {
			return $endpoints;
		}
		foreach ( array_keys( $endpoints ) as $route ) {
			if ( 0 === strpos( $route, '/wp/v2/users' ) ) {
				unset( $endpoints[ $route ] );
			}
		}
		return $endpoints;
	}

	/**
	 * Leave the users sitemap out.
	 *
	 * @param mixed  $provider Sitemap provider.
	 * @param string $name     Provider name.
	 * @return mixed
	 */
	public function hide_users_sitemap( $provider, $name ) {
		return 'users' === $name ? false : $provider;
	}

	/**
	 * Leave the author's username out of oEmbed data.
	 *
	 * @param array $data oEmbed response data.
	 * @return array
	 */
	public function hide_oembed_author( $data ) {
		unset( $data['author_name'], $data['author_url'] );
		return $data;
	}

	/**
	 * Transient keys for the current address.
	 *
	 * @return array{0:string,1:string} Failure counter key, pause key.
	 */
	private function login_keys() {
		$id = Request::ip_key();
		return array( 'zzft_lf_' . $id, 'zzft_lp_' . $id );
	}

	/**
	 * Refuse a login attempt while this address is paused.
	 *
	 * @param mixed  $user     User or error so far.
	 * @param string $username Username.
	 * @return mixed
	 */
	public function refuse_while_paused( $user, $username = '' ) {
		if ( '' === (string) $username ) {
			return $user;
		}
		list( , $pause ) = $this->login_keys();
		$until           = (int) get_transient( $pause );
		if ( $until > time() ) {
			remove_filter( 'authenticate', array( $this, 'generic_login_error' ), 100 );
			$minutes = max( 1, (int) ceil( ( $until - time() ) / MINUTE_IN_SECONDS ) );
			return new \WP_Error(
				'zzft_login_paused',
				sprintf(
					/* translators: %d: minutes. */
					_n( 'Too many failed login attempts. Please try again in %d minute.', 'Too many failed login attempts. Please try again in %d minutes.', $minutes, 'zenzeiten-forma-toolkit' ),
					$minutes
				)
			);
		}
		return $user;
	}

	/**
	 * Count a failed login and pause the address once the limit is reached.
	 */
	public function count_failure() {
		list( $count_key, $pause_key ) = $this->login_keys();
		$window                        = (int) $this->get( 'login_lockout' ) * MINUTE_IN_SECONDS;
		$count                         = (int) get_transient( $count_key ) + 1;
		if ( $count >= (int) $this->get( 'login_attempts' ) ) {
			set_transient( $pause_key, time() + $window, $window );
			delete_transient( $count_key );
			return;
		}
		set_transient( $count_key, $count, $window );
	}

	/**
	 * Reset the counter after a successful login.
	 */
	public function clear_failures() {
		list( $count_key ) = $this->login_keys();
		delete_transient( $count_key );
	}

	/**
	 * Replace "unknown username" and "wrong password" with one message.
	 *
	 * @param mixed $user User or error.
	 * @return mixed
	 */
	public function generic_login_error( $user ) {
		if ( is_wp_error( $user ) && array_intersect( $user->get_error_codes(), array( 'invalid_username', 'invalid_email', 'incorrect_password' ) ) ) {
			return new \WP_Error( 'zzft_invalid_login', __( '<strong>Error:</strong> The username or password is incorrect.', 'zenzeiten-forma-toolkit' ) );
		}
		return $user;
	}

	/**
	 * Remove the X-Pingback header.
	 *
	 * @param array $headers Headers.
	 * @return array
	 */
	public function drop_pingback_header( $headers ) {
		unset( $headers['X-Pingback'] );
		return $headers;
	}
}

<?php
/**
 * Plugin bootstrap.
 *
 * @package VisitorSentinel
 */

namespace VisitorSentinel;

defined( 'ABSPATH' ) || exit;

/**
 * Wires the parts together.
 */
final class Plugin {

	/**
	 * Singleton.
	 *
	 * @var Plugin|null
	 */
	private static $instance = null;

	/**
	 * Singleton.
	 *
	 * @return Plugin
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Register hooks.
	 */
	public function boot() {
		add_action( 'plugins_loaded', array( 'VisitorSentinel\\Installer', 'maybe_upgrade' ) );
		add_action( 'init', array( $this, 'load_textdomain' ) );

		( new Tracker() )->register();
		( new Protection() )->register();
		Cron::register();
		Privacy::register();

		add_action( 'rest_api_init', array( $this, 'admin_rest' ) );
		if ( is_admin() ) {
			require_once VSEN_DIR . 'includes/admin/class-admin.php';
			( new Admin\Admin() )->register();
		}
	}

	/**
	 * Admin REST routes (the dashboard's live panel). REST requests are not is_admin(), so the
	 * admin code is loaded on demand.
	 */
	public function admin_rest() {
		require_once VSEN_DIR . 'includes/admin/class-admin.php';
		( new Admin\Admin() )->routes();
	}

	/**
	 * Load translations.
	 */
	public function load_textdomain() {
		load_plugin_textdomain( 'visitor-sentinel', false, dirname( plugin_basename( VSEN_FILE ) ) . '/languages' );
	}

	/**
	 * Capability needed to see reports and change settings.
	 *
	 * @return string
	 */
	public static function capability() {
		/**
		 * Filter the capability for Visitor Sentinel's admin screens.
		 *
		 * @param string $capability Capability.
		 */
		return (string) apply_filters( 'vsen_capability', 'manage_options' );
	}

	/**
	 * Site-specific secret used for IP hashes and pageview tokens. Created on first use.
	 *
	 * @return string
	 */
	public static function secret() {
		$secret = get_option( 'vsen_secret' );
		if ( ! is_string( $secret ) || strlen( $secret ) < 32 ) {
			$secret = bin2hex( random_bytes( 32 ) );
			add_option( 'vsen_secret', $secret, '', 'yes' ); // Read on most front-end requests.
			// Another request may have won the race; use whatever is stored.
			$stored = get_option( 'vsen_secret' );
			$secret = is_string( $stored ) && strlen( $stored ) >= 32 ? $stored : $secret;
		}
		return $secret;
	}
}

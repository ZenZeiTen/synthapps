<?php
/**
 * Plugin bootstrap.
 *
 * @package ZenZeiTenBastion
 */

namespace ZenZeiTenBastion;

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
	 * Capability needed for every screen and action. Filter it to widen access.
	 *
	 * @return string
	 */
	public static function capability() {
		return (string) apply_filters( 'zbst_capability', 'manage_options' );
	}

	/**
	 * Register hooks.
	 */
	public function boot() {
		add_action( 'plugins_loaded', array( 'ZenZeiTenBastion\\Installer', 'maybe_upgrade' ), 5 );
		add_action( 'init', array( $this, 'load_textdomain' ) );
		add_action( 'init', array( 'ZenZeiTenBastion\\Cron', 'schedule' ) );
		add_action( 'update_option_' . Settings::OPTION, array( __CLASS__, 'settings_changed' ) );
		add_filter( 'site_transient_update_plugins', array( __CLASS__, 'drop_wporg_update' ) );
		add_filter( 'upgrader_pre_install', array( 'ZenZeiTenBastion\\Backup', 'before_update' ), 10, 1 );

		Guard::register();
		Hardening::register();
		Cron::register();

		add_action( 'rest_api_init', array( $this, 'admin_rest' ) );
		if ( is_admin() ) {
			require_once ZBST_DIR . 'includes/admin/class-admin.php';
			( new Admin\Admin() )->register();
		}
		if ( defined( 'WP_CLI' ) && WP_CLI && class_exists( 'WP_CLI' ) ) {
			require_once ZBST_DIR . 'includes/class-cli.php';
			\WP_CLI::add_command( 'bastion', 'ZenZeiTenBastion\\CLI' );
		}
	}

	/**
	 * Admin REST routes (the live monitor). REST requests are not is_admin(), so the admin code is
	 * loaded on demand.
	 */
	public function admin_rest() {
		require_once ZBST_DIR . 'includes/admin/class-admin.php';
		( new Admin\Admin() )->routes();
	}

	/**
	 * Apply saved settings that other parts cache or schedule.
	 */
	public static function settings_changed() {
		Settings::flush();
		Request::reset();
		Cron::schedule();
	}

	/**
	 * Remove any update WordPress.org offers for this plugin. WordPress matches updates by folder
	 * name, so if WordPress.org ever hosts a plugin in a folder of the same name, "update now"
	 * would replace this plugin with it. The Update URI header asks WordPress.org not to offer
	 * updates; this also clears an offer already cached on the site.
	 *
	 * @param mixed $transient Value of the update_plugins site transient.
	 * @return mixed
	 */
	public static function drop_wporg_update( $transient ) {
		if ( is_object( $transient ) ) {
			$file = plugin_basename( ZBST_FILE );
			foreach ( array( 'response', 'no_update' ) as $list ) {
				if ( isset( $transient->$list ) && is_array( $transient->$list ) ) {
					unset( $transient->{$list}[ $file ] );
				}
			}
		}
		return $transient;
	}

	/**
	 * Load translations.
	 */
	public function load_textdomain() {
		load_plugin_textdomain( 'zenzeiten-bastion', false, dirname( plugin_basename( ZBST_FILE ) ) . '/languages' );
	}
}

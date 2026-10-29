<?php
/**
 * Plugin bootstrap: builds the module list and boots the modules that are switched on.
 *
 * @package ZenZeiTen\FormaToolkit
 */

namespace ZenZeiTen\FormaToolkit;

defined( 'ABSPATH' ) || exit;

/**
 * Main plugin object.
 */
class Plugin {

	/**
	 * Single instance.
	 *
	 * @var Plugin|null
	 */
	private static $instance = null;

	/**
	 * Settings store.
	 *
	 * @var Settings
	 */
	private $settings;

	/**
	 * Whether boot() already ran.
	 *
	 * @var bool
	 */
	private $booted = false;

	/**
	 * The plugin instance.
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
	 * Constructor.
	 */
	private function __construct() {
		$this->settings = new Settings();
	}

	/**
	 * Settings store.
	 *
	 * @return Settings
	 */
	public function settings() {
		return $this->settings;
	}

	/**
	 * A registered module by id.
	 *
	 * @param string $id Module id.
	 * @return Module|null
	 */
	public function module( $id ) {
		$modules = $this->settings->modules();
		return isset( $modules[ $id ] ) ? $modules[ $id ] : null;
	}

	/**
	 * Whether a module exists and is switched on.
	 *
	 * @param string $id Module id.
	 * @return bool
	 */
	public function is_active( $id ) {
		return null !== $this->module( $id ) && $this->settings->is_enabled( $id );
	}

	/**
	 * Register hooks. Modules boot on init, after translations can load.
	 */
	public function boot() {
		if ( $this->booted ) {
			return;
		}
		$this->booted = true;

		add_action( 'init', array( $this, 'load_textdomain' ), 0 );
		add_action( 'init', array( $this, 'boot_modules' ), 1 );
		add_filter( 'site_transient_update_plugins', array( $this, 'drop_wporg_update' ) );

		if ( is_admin() ) {
			( new Admin( $this ) )->hooks();
		}
	}

	/**
	 * Load translations from the plugin's languages folder.
	 */
	public function load_textdomain() {
		load_plugin_textdomain( 'zenzeiten-forma-toolkit', false, dirname( plugin_basename( ZZFT_FILE ) ) . '/languages' );
	}

	/**
	 * Build the module list and boot each module that is switched on.
	 */
	public function boot_modules() {
		$modules = array();
		foreach ( array( Performance::class, Security::class, Seo::class, Business::class, Announcement::class, Ai::class ) as $class ) {
			$module                   = new $class( $this->settings );
			$modules[ $module->id() ] = $module;
		}

		/**
		 * Filters the toolkit's modules. Add a module by returning an instance of a
		 * \ZenZeiTen\FormaToolkit\Module subclass keyed by its id.
		 *
		 * @param Module[] $modules  Modules keyed by id.
		 * @param Settings $settings Settings store to pass to new modules.
		 */
		$modules = apply_filters( 'zzft_modules', $modules, $this->settings );

		$valid = array();
		foreach ( (array) $modules as $id => $module ) {
			if ( $module instanceof Module && $id === $module->id() && preg_match( '/^[a-z0-9_]+$/', $id ) && 'advanced' !== $id && 'modules' !== $id ) {
				$valid[ $id ] = $module;
			}
		}
		$this->settings->set_modules( $valid );

		foreach ( $valid as $id => $module ) {
			if ( $this->settings->is_enabled( $id ) ) {
				$module->boot();
			}
		}

		/**
		 * Fires after the toolkit's modules have booted.
		 *
		 * @param Plugin $plugin The plugin.
		 */
		do_action( 'zzft_modules_booted', $this );
	}

	/**
	 * Remove any WordPress.org update offer for this plugin's folder. The toolkit is not hosted on
	 * WordPress.org, so such an offer would be a different plugin that replaces this one.
	 *
	 * @param mixed $transient The update_plugins site transient.
	 * @return mixed
	 */
	public function drop_wporg_update( $transient ) {
		if ( is_object( $transient ) && isset( $transient->response ) && is_array( $transient->response ) ) {
			unset( $transient->response[ plugin_basename( ZZFT_FILE ) ] );
		}
		return $transient;
	}

	/**
	 * Capability needed to change toolkit settings.
	 *
	 * @return string
	 */
	public static function capability() {
		/**
		 * Filters the capability that grants access to the toolkit settings.
		 *
		 * @param string $capability Default 'manage_options'.
		 */
		return (string) apply_filters( 'zzft_capability', 'manage_options' );
	}
}

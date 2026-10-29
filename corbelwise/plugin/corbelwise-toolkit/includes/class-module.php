<?php
/**
 * Base class for toolkit modules.
 *
 * @package Corbelwise\Toolkit
 */

namespace Corbelwise\Toolkit;

defined( 'ABSPATH' ) || exit;

/**
 * A module is a switchable feature with its own settings tab. Add your own through the
 * cwtk_modules filter: return an instance of a subclass keyed by its id.
 */
abstract class Module {

	/**
	 * Settings store.
	 *
	 * @var Settings
	 */
	protected $settings;

	/**
	 * Constructor.
	 *
	 * @param Settings $settings Settings store.
	 */
	public function __construct( Settings $settings ) {
		$this->settings = $settings;
	}

	/**
	 * Unique id: lowercase letters, digits and underscores.
	 *
	 * @return string
	 */
	abstract public function id();

	/**
	 * Name shown on the settings screen.
	 *
	 * @return string
	 */
	abstract public function label();

	/**
	 * One or two sentences on what the module does.
	 *
	 * @return string
	 */
	abstract public function description();

	/**
	 * Whether the module is on before the site owner chooses.
	 *
	 * @return bool
	 */
	public function default_enabled() {
		return false;
	}

	/**
	 * Settings fields: key => array( type, label, help, default, options, min, max, maxlength ).
	 *
	 * @return array<string, array>
	 */
	public function fields() {
		return array();
	}

	/**
	 * Hook the module into WordPress. Called on plugins_loaded, only while the module is on.
	 */
	public function boot() {}

	/**
	 * A reason the module is on but not doing its work, shown on the settings screen.
	 *
	 * @return string Empty when the module works normally.
	 */
	public function paused_reason() {
		return '';
	}

	/**
	 * Read one of this module's settings.
	 *
	 * @param string $key Field key.
	 * @return mixed
	 */
	public function get( $key ) {
		return $this->settings->get( $this->id(), $key );
	}
}

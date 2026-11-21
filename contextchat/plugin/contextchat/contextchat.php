<?php
/**
 * Plugin Name:       ContextChat – Smart Chat Button for WhatsApp
 * Plugin URI:        https://github.com/ZenZeiTen/synthapps/tree/main/contextchat
 * Description:       A fast, accessible chat button for WhatsApp that pre-fills every message with the page, product and campaign the visitor came from, and routes it to the right agent.
 * Version:           2.0.0-dev
 * Requires at least: 6.2
 * Requires PHP:      7.4
 * Author:            NSXSFT
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       contextchat
 * Update URI:        false
 * Domain Path:       /languages
 *
 * WhatsApp is a trademark of WhatsApp LLC. This plugin is not affiliated with or endorsed by WhatsApp LLC.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

define( 'CONTEXTCHAT_VERSION', '2.0.0-dev' );
define( 'CONTEXTCHAT_DB_VERSION', '1' );
define( 'CONTEXTCHAT_FILE', __FILE__ );
define( 'CONTEXTCHAT_DIR', plugin_dir_path( __FILE__ ) );
define( 'CONTEXTCHAT_URL', plugin_dir_url( __FILE__ ) );

require_once CONTEXTCHAT_DIR . 'includes/class-template.php';
require_once CONTEXTCHAT_DIR . 'includes/class-settings.php';
require_once CONTEXTCHAT_DIR . 'includes/class-context.php';
require_once CONTEXTCHAT_DIR . 'includes/class-analytics.php';
require_once CONTEXTCHAT_DIR . 'includes/class-frontend.php';
require_once CONTEXTCHAT_DIR . 'includes/class-meta-box.php';
require_once CONTEXTCHAT_DIR . 'includes/class-woocommerce.php';
require_once CONTEXTCHAT_DIR . 'includes/class-admin.php';
require_once CONTEXTCHAT_DIR . 'includes/class-admin-analytics.php';
require_once CONTEXTCHAT_DIR . 'includes/class-updates.php';
require_once CONTEXTCHAT_DIR . 'includes/class-installer.php';
require_once CONTEXTCHAT_DIR . 'includes/si/class-si-pricing.php';
require_once CONTEXTCHAT_DIR . 'includes/si/class-si-secrets.php';
require_once CONTEXTCHAT_DIR . 'includes/si/class-si-client.php';
require_once CONTEXTCHAT_DIR . 'includes/si/class-si-router.php';
require_once CONTEXTCHAT_DIR . 'includes/si/class-si.php';
require_once CONTEXTCHAT_DIR . 'includes/si/class-countries.php';
require_once CONTEXTCHAT_DIR . 'includes/si/class-price-engine.php';
require_once CONTEXTCHAT_DIR . 'includes/si/class-guard.php';
require_once CONTEXTCHAT_DIR . 'includes/si/class-validator.php';

register_activation_hook( __FILE__, array( 'ContextChat_Analytics', 'activate' ) );
register_activation_hook( __FILE__, array( 'ContextChat_Installer', 'install' ) );
register_deactivation_hook( __FILE__, array( 'ContextChat_Analytics', 'deactivate' ) );

add_action(
	'plugins_loaded',
	static function () {
		load_plugin_textdomain( 'contextchat', false, dirname( plugin_basename( CONTEXTCHAT_FILE ) ) . '/languages' );

		add_action( 'init', array( 'ContextChat_Settings', 'register' ) );
		ContextChat_Installer::maybe_install();
		ContextChat_Analytics::init();
		ContextChat_Frontend::init();
		ContextChat_Meta_Box::init();
		ContextChat_WooCommerce::init();
		ContextChat_Updates::init();
		ContextChat_SI::init();

		if ( is_admin() ) {
			ContextChat_Admin::init();
			ContextChat_Admin_Analytics::init();
		}
	}
);

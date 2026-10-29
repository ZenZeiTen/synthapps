<?php
/**
 * Plugin Name:       ContextChat – Smart Chat Button for WhatsApp
 * Plugin URI:        https://github.com/ZenZeiTen/synthapps/tree/main/contextchat
 * Description:       A fast, accessible chat button for WhatsApp that pre-fills every message with the page, product and campaign the visitor came from, and routes it to the right agent.
 * Version:           1.0.2
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

define( 'CONTEXTCHAT_VERSION', '1.0.2' );
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
require_once CONTEXTCHAT_DIR . 'includes/class-updates.php';

register_activation_hook( __FILE__, array( 'ContextChat_Analytics', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'ContextChat_Analytics', 'deactivate' ) );

add_action(
	'plugins_loaded',
	static function () {
		load_plugin_textdomain( 'contextchat', false, dirname( plugin_basename( CONTEXTCHAT_FILE ) ) . '/languages' );

		add_action( 'init', array( 'ContextChat_Settings', 'register' ) );
		ContextChat_Analytics::init();
		ContextChat_Frontend::init();
		ContextChat_Meta_Box::init();
		ContextChat_WooCommerce::init();
		ContextChat_Updates::init();

		if ( is_admin() ) {
			ContextChat_Admin::init();
		}
	}
);

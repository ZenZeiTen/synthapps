<?php
/**
 * Plugin Name:       Visitor Sentinel
 * Plugin URI:        https://github.com/ZenZeiTen/synthapps/tree/main/visitor-sentinel
 * Description:       Visitor analytics with IP address tracking, page activity tracking and fraudulent click detection for paid ad clicks and on-site ads.
 * Version:           1.0.1
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            ZenZeiTen
 * License:           MIT
 * License URI:       https://opensource.org/licenses/MIT
 * Update URI:        false
 * Text Domain:       visitor-sentinel
 * Domain Path:       /languages
 *
 * @package VisitorSentinel
 */

defined( 'ABSPATH' ) || exit;

define( 'VSEN_VERSION', '1.0.1' );
define( 'VSEN_DB_VERSION', '1' );
define( 'VSEN_FILE', __FILE__ );
define( 'VSEN_DIR', plugin_dir_path( __FILE__ ) );
define( 'VSEN_URL', plugin_dir_url( __FILE__ ) );

require_once VSEN_DIR . 'includes/class-settings.php';
require_once VSEN_DIR . 'includes/class-ip.php';
require_once VSEN_DIR . 'includes/class-user-agent.php';
require_once VSEN_DIR . 'includes/class-fraud-engine.php';
require_once VSEN_DIR . 'includes/class-repository.php';
require_once VSEN_DIR . 'includes/class-request-context.php';
require_once VSEN_DIR . 'includes/class-protection.php';
require_once VSEN_DIR . 'includes/class-fraud-service.php';
require_once VSEN_DIR . 'includes/class-tracker.php';
require_once VSEN_DIR . 'includes/class-alerts.php';
require_once VSEN_DIR . 'includes/class-cron.php';
require_once VSEN_DIR . 'includes/class-privacy.php';
require_once VSEN_DIR . 'includes/class-installer.php';
require_once VSEN_DIR . 'includes/class-plugin.php';

register_activation_hook( __FILE__, array( 'VisitorSentinel\\Installer', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'VisitorSentinel\\Installer', 'deactivate' ) );

VisitorSentinel\Plugin::instance()->boot();

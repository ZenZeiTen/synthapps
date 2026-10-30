<?php
/**
 * Plugin Name:       ZenZeiTen Bastion
 * Plugin URI:        https://github.com/ZenZeiTen/synthapps/tree/main/bastion
 * Description:       Website security: a firewall against common attacks, real-time attack monitoring, automatic detection and blocking of attacking IP addresses, login protection, and automatic database backups with one-click restore and automatic rollback.
 * Version:           1.0.1
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            ZenZeiTen
 * License:           MIT
 * License URI:       https://opensource.org/licenses/MIT
 * Update URI:        false
 * Text Domain:       zenzeiten-bastion
 * Domain Path:       /languages
 *
 * @package ZenZeiTenBastion
 */

defined( 'ABSPATH' ) || exit;

define( 'ZBST_VERSION', '1.0.1' );
define( 'ZBST_DB_VERSION', '1' );
define( 'ZBST_FILE', __FILE__ );
define( 'ZBST_DIR', plugin_dir_path( __FILE__ ) );
define( 'ZBST_URL', plugin_dir_url( __FILE__ ) );

require_once ZBST_DIR . 'includes/class-settings.php';
require_once ZBST_DIR . 'includes/class-ip.php';
require_once ZBST_DIR . 'includes/class-request.php';
require_once ZBST_DIR . 'includes/class-log.php';
require_once ZBST_DIR . 'includes/class-blocklist.php';
require_once ZBST_DIR . 'includes/class-alerts.php';
require_once ZBST_DIR . 'includes/class-guard.php';
require_once ZBST_DIR . 'includes/class-firewall.php';
require_once ZBST_DIR . 'includes/class-hardening.php';
require_once ZBST_DIR . 'includes/class-backup.php';
require_once ZBST_DIR . 'includes/class-cron.php';
require_once ZBST_DIR . 'includes/class-installer.php';
require_once ZBST_DIR . 'includes/class-plugin.php';

register_activation_hook( __FILE__, array( 'ZenZeiTenBastion\\Installer', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'ZenZeiTenBastion\\Installer', 'deactivate' ) );

ZenZeiTenBastion\Plugin::instance()->boot();

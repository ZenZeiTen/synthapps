<?php
/**
 * Plugin Name:       Corbelwise Toolkit
 * Plugin URI:        https://github.com/ZenZeiTen/synthapps/tree/main/corbelwise
 * Description:       Switchable modules for a fast, secure business site: performance and security settings, SEO and structured data, business details, an announcement bar and an optional AI assistant powered by Claude. Made for the Corbelwise theme; works with any theme.
 * Version:           1.0.0
 * Requires at least: 6.5
 * Requires PHP:      7.4
 * Author:            ZenZeiTen
 * Author URI:        https://github.com/ZenZeiTen
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Update URI:        false
 * Text Domain:       corbelwise-toolkit
 * Domain Path:       /languages
 *
 * @package Corbelwise\Toolkit
 */

defined( 'ABSPATH' ) || exit;

define( 'CWTK_VERSION', '1.0.0' );
define( 'CWTK_FILE', __FILE__ );
define( 'CWTK_DIR', plugin_dir_path( __FILE__ ) );
define( 'CWTK_URL', plugin_dir_url( __FILE__ ) );

require_once CWTK_DIR . 'includes/class-settings.php';
require_once CWTK_DIR . 'includes/class-module.php';
require_once CWTK_DIR . 'includes/class-request.php';
require_once CWTK_DIR . 'includes/modules/class-performance.php';
require_once CWTK_DIR . 'includes/modules/class-security.php';
require_once CWTK_DIR . 'includes/modules/class-seo.php';
require_once CWTK_DIR . 'includes/modules/class-business.php';
require_once CWTK_DIR . 'includes/modules/class-announcement.php';
require_once CWTK_DIR . 'includes/ai/class-provider.php';
require_once CWTK_DIR . 'includes/ai/class-anthropic.php';
require_once CWTK_DIR . 'includes/ai/class-guard.php';
require_once CWTK_DIR . 'includes/ai/class-prompts.php';
require_once CWTK_DIR . 'includes/modules/class-ai.php';
require_once CWTK_DIR . 'includes/class-admin.php';
require_once CWTK_DIR . 'includes/class-plugin.php';

\Corbelwise\Toolkit\Plugin::instance()->boot();

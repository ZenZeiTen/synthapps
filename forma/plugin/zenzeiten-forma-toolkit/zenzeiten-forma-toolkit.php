<?php
/**
 * Plugin Name:       ZenZeiTen Forma Toolkit
 * Plugin URI:        https://github.com/ZenZeiTen/synthapps/tree/main/forma
 * Description:       Switchable modules for a fast, secure business site: performance and security settings, SEO and structured data, business details, an announcement bar and an optional AI assistant powered by Claude. Made for the ZenZeiTen Forma theme; works with any theme.
 * Version:           1.0.0
 * Requires at least: 6.5
 * Requires PHP:      7.4
 * Author:            ZenZeiTen
 * Author URI:        https://github.com/ZenZeiTen
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Update URI:        false
 * Text Domain:       zenzeiten-forma-toolkit
 * Domain Path:       /languages
 *
 * @package ZenZeiTen\FormaToolkit
 */

defined( 'ABSPATH' ) || exit;

define( 'ZZFT_VERSION', '1.0.0' );
define( 'ZZFT_FILE', __FILE__ );
define( 'ZZFT_DIR', plugin_dir_path( __FILE__ ) );
define( 'ZZFT_URL', plugin_dir_url( __FILE__ ) );

require_once ZZFT_DIR . 'includes/class-settings.php';
require_once ZZFT_DIR . 'includes/class-module.php';
require_once ZZFT_DIR . 'includes/class-request.php';
require_once ZZFT_DIR . 'includes/modules/class-performance.php';
require_once ZZFT_DIR . 'includes/modules/class-security.php';
require_once ZZFT_DIR . 'includes/modules/class-seo.php';
require_once ZZFT_DIR . 'includes/modules/class-business.php';
require_once ZZFT_DIR . 'includes/modules/class-announcement.php';
require_once ZZFT_DIR . 'includes/ai/class-provider.php';
require_once ZZFT_DIR . 'includes/ai/class-anthropic.php';
require_once ZZFT_DIR . 'includes/ai/class-guard.php';
require_once ZZFT_DIR . 'includes/ai/class-prompts.php';
require_once ZZFT_DIR . 'includes/modules/class-ai.php';
require_once ZZFT_DIR . 'includes/class-admin.php';
require_once ZZFT_DIR . 'includes/class-plugin.php';

\ZenZeiTen\FormaToolkit\Plugin::instance()->boot();

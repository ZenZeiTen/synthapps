<?php
/**
 * ZenZeiTen Forma: theme bootstrap.
 *
 * Everything the theme does in PHP is split by job into files under inc/. Design tokens live in
 * theme.json, layouts in templates/ and parts/, and ready-made sections in patterns/.
 *
 * @package ZenZeiTen_Forma
 */

defined( 'ABSPATH' ) || exit;

define( 'ZZFORMA_VERSION', '1.0.0' );
define( 'ZZFORMA_SLUG', 'zenzeiten-forma' );
define( 'ZZFORMA_DIR', get_template_directory() );
define( 'ZZFORMA_URI', get_template_directory_uri() );

require ZZFORMA_DIR . '/inc/options.php';
require ZZFORMA_DIR . '/inc/setup.php';
require ZZFORMA_DIR . '/inc/color-scheme.php';
require ZZFORMA_DIR . '/inc/block-styles.php';
require ZZFORMA_DIR . '/inc/patterns.php';
require ZZFORMA_DIR . '/inc/updates.php';

if ( is_admin() ) {
	require ZZFORMA_DIR . '/inc/admin.php';
}

<?php
/**
 * Corbelwise: theme bootstrap.
 *
 * Everything the theme does in PHP is split by job into files under inc/. Design tokens live in
 * theme.json, layouts in templates/ and parts/, and ready-made sections in patterns/.
 *
 * @package Corbelwise
 */

defined( 'ABSPATH' ) || exit;

define( 'CORBELWISE_VERSION', '1.0.0' );
define( 'CORBELWISE_SLUG', 'corbelwise' );
define( 'CORBELWISE_DIR', get_template_directory() );
define( 'CORBELWISE_URI', get_template_directory_uri() );

require CORBELWISE_DIR . '/inc/options.php';
require CORBELWISE_DIR . '/inc/setup.php';
require CORBELWISE_DIR . '/inc/color-scheme.php';
require CORBELWISE_DIR . '/inc/block-styles.php';
require CORBELWISE_DIR . '/inc/patterns.php';
require CORBELWISE_DIR . '/inc/updates.php';

if ( is_admin() ) {
	require CORBELWISE_DIR . '/inc/admin.php';
}

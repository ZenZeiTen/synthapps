<?php
/**
 * Keep WordPress.org from offering an unrelated theme as an "update".
 *
 * WordPress matches theme updates by folder name. Corbelwise is not hosted on WordPress.org,
 * so any update offered there for this folder name would be a different theme that replaces this
 * one. Updates come from the Corbelwise release download instead.
 *
 * @package Corbelwise
 */

defined( 'ABSPATH' ) || exit;

add_filter( 'site_transient_update_themes', 'corbelwise_drop_wporg_update' );

/**
 * Remove any WordPress.org update offer for this theme's folder.
 *
 * @param mixed $transient The update_themes site transient.
 * @return mixed
 */
function corbelwise_drop_wporg_update( $transient ) {
	/**
	 * Return true to let WordPress.org update offers through (for example, if the theme is ever
	 * published there under this folder name).
	 *
	 * @param bool $allow Default false.
	 */
	if ( apply_filters( 'corbelwise_allow_wporg_updates', false ) ) {
		return $transient;
	}
	if ( is_object( $transient ) && isset( $transient->response ) && is_array( $transient->response ) ) {
		unset( $transient->response[ CORBELWISE_SLUG ] );
	}
	return $transient;
}

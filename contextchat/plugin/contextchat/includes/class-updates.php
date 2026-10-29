<?php
/**
 * Keeps WordPress.org from offering another plugin as an update to this one.
 *
 * WordPress matches update offers by plugin folder. ContextChat is not hosted on WordPress.org,
 * so any plugin there in a folder named contextchat would be offered as an "update", and
 * accepting it would replace ContextChat. The Update URI header asks WordPress.org not to offer
 * updates; this filter also removes an offer a site has already cached.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Updates.
 */
class ContextChat_Updates {

	/**
	 * Hooks.
	 */
	public static function init() {
		add_filter( 'site_transient_update_plugins', array( __CLASS__, 'drop_wporg_update' ) );
	}

	/**
	 * Remove any update offered for this plugin.
	 *
	 * @param mixed $transient Value of the update_plugins site transient.
	 * @return mixed
	 */
	public static function drop_wporg_update( $transient ) {
		if ( is_object( $transient ) ) {
			$file = plugin_basename( CONTEXTCHAT_FILE );
			foreach ( array( 'response', 'no_update' ) as $list ) {
				if ( isset( $transient->$list ) && is_array( $transient->$list ) ) {
					unset( $transient->{$list}[ $file ] );
				}
			}
		}
		return $transient;
	}
}

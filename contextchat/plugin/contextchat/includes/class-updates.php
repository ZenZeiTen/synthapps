<?php
/**
 * Updates: keep WordPress.org from offering another plugin as an update to this one.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Update offers.
 */
class ContextChat_Updates {

	/**
	 * Hooks.
	 */
	public static function init() {
		add_filter( 'site_transient_update_plugins', array( __CLASS__, 'drop_wporg_update' ) );
	}

	/**
	 * Remove any update WordPress.org offers for this plugin. ContextChat is not hosted on
	 * WordPress.org, and WordPress matches updates by folder name, so a WordPress.org plugin in a
	 * folder named "contextchat" would be offered here and "update now" would replace this plugin
	 * with it. The Update URI header asks WordPress.org not to offer updates; this also clears an
	 * offer already cached on the site.
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

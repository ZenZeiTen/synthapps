<?php
/**
 * Theme options: a handful of settings on Appearance → Corbelwise.
 *
 * Colours, fonts and layout are edited in the Site Editor (theme.json), so this list stays short:
 * only behaviour that the Site Editor cannot express lives here.
 *
 * @package Corbelwise
 */

defined( 'ABSPATH' ) || exit;

/**
 * Default value of every option.
 *
 * @return array<string, mixed>
 */
function corbelwise_option_defaults() {
	return array(
		// 'toggle': follow the visitor's system setting and show a light/dark switch.
		// 'system': follow the visitor's system setting, no switch.
		// 'light': always use the light palette.
		'color_scheme'  => 'toggle',
		'sticky_header' => true,
	);
}

/**
 * Read one option, falling back to its default.
 *
 * @param string $key Option key from corbelwise_option_defaults().
 * @return mixed
 */
function corbelwise_option( $key ) {
	$defaults = corbelwise_option_defaults();
	$saved    = get_option( 'corbelwise_options', array() );
	$saved    = is_array( $saved ) ? $saved : array();
	$value    = array_key_exists( $key, $saved ) ? $saved[ $key ] : ( isset( $defaults[ $key ] ) ? $defaults[ $key ] : null );

	/**
	 * Filters a theme option, for child themes and plugins.
	 *
	 * @param mixed  $value Option value.
	 * @param string $key   Option key.
	 */
	return apply_filters( 'corbelwise_option', $value, $key );
}

/**
 * Sanitize the options array on save. Unknown keys are dropped.
 *
 * @param mixed $input Raw submitted value.
 * @return array<string, mixed>
 */
function corbelwise_sanitize_options( $input ) {
	$input = is_array( $input ) ? $input : array();
	$clean = corbelwise_option_defaults();

	$schemes               = array( 'toggle', 'system', 'light' );
	$clean['color_scheme'] = ( isset( $input['color_scheme'] ) && in_array( $input['color_scheme'], $schemes, true ) ) ? $input['color_scheme'] : 'toggle';
	$clean['sticky_header'] = ! empty( $input['sticky_header'] );

	return $clean;
}

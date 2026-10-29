<?php
/**
 * Server render of the light/dark switch. Prints nothing unless the switch is enabled.
 *
 * @package Corbelwise
 */

defined( 'ABSPATH' ) || exit;

if ( 'toggle' !== corbelwise_option( 'color_scheme' ) ) {
	return;
}

wp_enqueue_script( 'corbelwise-color-scheme-toggle' );
?>
<button type="button" <?php echo get_block_wrapper_attributes( array( 'class' => 'corbelwise-scheme-toggle', 'aria-pressed' => 'false' ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped by core. ?>>
	<span class="screen-reader-text"><?php esc_html_e( 'Dark mode', 'corbelwise' ); ?></span>
	<svg class="corbelwise-scheme-toggle__moon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
	<svg class="corbelwise-scheme-toggle__sun" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
</button>

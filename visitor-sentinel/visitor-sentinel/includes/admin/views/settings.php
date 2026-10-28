<?php
/**
 * Settings view.
 *
 * @package VisitorSentinel
 *
 * @var array $settings Current settings.
 */

use VisitorSentinel\Admin\Admin;
use VisitorSentinel\Settings;

defined( 'ABSPATH' ) || exit;

$vsen_name = function ( $key ) {
	return Settings::OPTION . '[' . $key . ']';
};

$vsen_checkbox = function ( $key, $label, $help = '' ) use ( $settings, $vsen_name ) {
	echo '<label class="vsen-toggle"><input type="checkbox" name="' . esc_attr( $vsen_name( $key ) ) . '" value="1" ' . checked( 1, (int) $settings[ $key ], false ) . ' /> <span>' . esc_html( $label ) . '</span></label>';
	if ( '' !== $help ) {
		echo '<p class="description">' . esc_html( $help ) . '</p>';
	}
};

$vsen_number = function ( $key, $min, $max, $suffix = '', $help = '' ) use ( $settings, $vsen_name ) {
	echo '<input type="number" class="small-text" name="' . esc_attr( $vsen_name( $key ) ) . '" id="vsen-' . esc_attr( $key ) . '" value="' . esc_attr( (string) $settings[ $key ] ) . '" min="' . esc_attr( (string) $min ) . '" max="' . esc_attr( (string) $max ) . '" /> ' . esc_html( $suffix );
	if ( '' !== $help ) {
		echo '<p class="description">' . esc_html( $help ) . '</p>';
	}
};

$vsen_select = function ( $key, array $options, $help = '' ) use ( $settings, $vsen_name ) {
	echo '<select name="' . esc_attr( $vsen_name( $key ) ) . '" id="vsen-' . esc_attr( $key ) . '">';
	foreach ( $options as $value => $label ) {
		echo '<option value="' . esc_attr( $value ) . '" ' . selected( (string) $settings[ $key ], (string) $value, false ) . '>' . esc_html( $label ) . '</option>';
	}
	echo '</select>';
	if ( '' !== $help ) {
		echo '<p class="description">' . esc_html( $help ) . '</p>';
	}
};

$vsen_textarea = function ( $key, $placeholder, $help = '' ) use ( $settings, $vsen_name ) {
	echo '<textarea class="large-text code" rows="4" name="' . esc_attr( $vsen_name( $key ) ) . '" id="vsen-' . esc_attr( $key ) . '" placeholder="' . esc_attr( $placeholder ) . '">' . esc_textarea( (string) $settings[ $key ] ) . '</textarea>';
	if ( '' !== $help ) {
		echo '<p class="description">' . esc_html( $help ) . '</p>';
	}
};

$vsen_remote = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
$vsen_seen   = \VisitorSentinel\Request_Context::current()->ip;
?>
<div class="wrap vsen-wrap">
	<div class="vsen-header">
		<h1><?php esc_html_e( 'Visitor Sentinel Settings', 'visitor-sentinel' ); ?></h1>
	</div>

	<nav class="vsen-toc">
		<a href="#vsen-tracking"><?php esc_html_e( 'Tracking', 'visitor-sentinel' ); ?></a>
		<a href="#vsen-privacy"><?php esc_html_e( 'IP addresses & privacy', 'visitor-sentinel' ); ?></a>
		<a href="#vsen-detection"><?php esc_html_e( 'Fraud detection', 'visitor-sentinel' ); ?></a>
		<a href="#vsen-protection"><?php esc_html_e( 'Protection', 'visitor-sentinel' ); ?></a>
		<a href="#vsen-alerts"><?php esc_html_e( 'Alerts', 'visitor-sentinel' ); ?></a>
		<a href="#vsen-data"><?php esc_html_e( 'Data', 'visitor-sentinel' ); ?></a>
	</nav>

	<form method="post" action="options.php">
		<?php settings_fields( 'vsen_settings_group' ); ?>

		<div class="vsen-card" id="vsen-tracking">
			<h2><?php esc_html_e( 'Tracking', 'visitor-sentinel' ); ?></h2>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><?php esc_html_e( 'Tracking', 'visitor-sentinel' ); ?></th>
					<td><?php $vsen_checkbox( 'tracking_enabled', __( 'Record visits, page activity and clicks', 'visitor-sentinel' ) ); ?></td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Do not track these roles', 'visitor-sentinel' ); ?></th>
					<td>
						<?php foreach ( wp_roles()->get_names() as $vsen_role => $vsen_role_name ) : ?>
							<label class="vsen-inline-check"><input type="checkbox" name="<?php echo esc_attr( $vsen_name( 'exclude_roles' ) ); ?>[]" value="<?php echo esc_attr( $vsen_role ); ?>" <?php checked( in_array( $vsen_role, (array) $settings['exclude_roles'], true ) ); ?> /> <?php echo esc_html( translate_user_role( $vsen_role_name ) ); ?></label>
						<?php endforeach; ?>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Page activity', 'visitor-sentinel' ); ?></th>
					<td>
						<?php $vsen_checkbox( 'track_outbound', __( 'Record clicks on links to other sites', 'visitor-sentinel' ) ); ?><br>
						<?php $vsen_checkbox( 'track_downloads', __( 'Record file downloads (PDF, ZIP, documents, media)', 'visitor-sentinel' ) ); ?>
						<p class="description"><?php esc_html_e( 'Time on page, scroll depth and interactions are always recorded. Add data-vsen-track="label" to any element to record clicks on it.', 'visitor-sentinel' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="vsen-ad_selectors"><?php esc_html_e( 'Ad elements', 'visitor-sentinel' ); ?></label></th>
					<td><?php $vsen_textarea( 'ad_selectors', '.vsen-ad-slot', __( 'CSS selectors for your ad units, one per line. Clicks on these, including clicks into ad iframes such as AdSense, are scored for fraud. Content wrapped in the [vsen_ad] shortcode is always included.', 'visitor-sentinel' ) ); ?></td>
				</tr>
			</table>
		</div>

		<div class="vsen-card" id="vsen-privacy">
			<h2><?php esc_html_e( 'IP addresses & privacy', 'visitor-sentinel' ); ?></h2>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="vsen-ip_mode"><?php esc_html_e( 'Store IP addresses', 'visitor-sentinel' ); ?></label></th>
					<td>
						<?php
						$vsen_select(
							'ip_mode',
							array(
								'full' => __( 'Full address', 'visitor-sentinel' ),
								'mask' => __( 'Masked (last part removed: 203.0.113.0)', 'visitor-sentinel' ),
								'none' => __( 'Do not store (keyed hash only)', 'visitor-sentinel' ),
							),
							__( 'Fraud detection and blocking work in every mode, because they match a keyed hash of the full address. Masked and hashed modes reduce the personal data you keep; the Google Ads export then has less to export.', 'visitor-sentinel' )
						);
						?>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Proxy and CDN', 'visitor-sentinel' ); ?></th>
					<td>
						<?php $vsen_checkbox( 'trust_cloudflare', __( 'This site is behind Cloudflare', 'visitor-sentinel' ), __( 'Reads the visitor address and country from Cloudflare headers, but only for requests that really come from Cloudflare\'s network.', 'visitor-sentinel' ) ); ?>
						<p><label for="vsen-proxy_header"><?php esc_html_e( 'Client IP header from other proxies', 'visitor-sentinel' ); ?></label></p>
						<?php
						$vsen_headers = array( '' => __( 'None (use the connection address)', 'visitor-sentinel' ) );
						foreach ( array_filter( Settings::PROXY_HEADERS ) as $vsen_header ) {
							$vsen_headers[ $vsen_header ] = $vsen_header;
						}
						$vsen_select( 'proxy_header', $vsen_headers );
						?>
						<p><label for="vsen-trusted_proxies"><?php esc_html_e( 'Trusted proxy addresses', 'visitor-sentinel' ); ?></label></p>
						<?php $vsen_textarea( 'trusted_proxies', "10.0.0.0/8\n192.168.1.10", __( 'The header above is believed only for requests arriving from these addresses or ranges. Without them, anyone could fake their IP by sending the header.', 'visitor-sentinel' ) ); ?>
						<p class="description">
							<?php
							printf(
								/* translators: 1: connection address, 2: resolved visitor address */
								esc_html__( 'Your request now: connection address %1$s, resolved visitor address %2$s.', 'visitor-sentinel' ),
								'<code>' . esc_html( '' !== $vsen_remote ? $vsen_remote : '—' ) . '</code>',
								'<code>' . esc_html( '' !== $vsen_seen ? $vsen_seen : '—' ) . '</code>'
							);
							?>
						</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Visitor choices', 'visitor-sentinel' ); ?></th>
					<td>
						<?php $vsen_checkbox( 'respect_dnt', __( 'Do not track browsers that send Do Not Track or Global Privacy Control', 'visitor-sentinel' ) ); ?><br>
						<?php $vsen_checkbox( 'require_consent', __( 'Wait for consent before tracking', 'visitor-sentinel' ), __( 'Works with consent plugins that support the WP Consent API (statistics category). Without one, call VisitorSentinel.consent(true) from your cookie banner.', 'visitor-sentinel' ) ); ?><br>
						<?php $vsen_checkbox( 'use_storage', __( 'Remember returning visitors with a random ID in browser storage', 'visitor-sentinel' ), __( 'When off, visitors are recognized by IP and browser only, and nothing is stored in the browser.', 'visitor-sentinel' ) ); ?>
					</td>
				</tr>
			</table>
		</div>

		<div class="vsen-card" id="vsen-detection">
			<h2><?php esc_html_e( 'Fraud detection', 'visitor-sentinel' ); ?></h2>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="vsen-fraud_sensitivity"><?php esc_html_e( 'Sensitivity', 'visitor-sentinel' ); ?></label></th>
					<td>
						<?php
						$vsen_select(
							'fraud_sensitivity',
							array(
								'low'    => __( 'Low (fewer false alarms)', 'visitor-sentinel' ),
								'medium' => __( 'Medium (recommended)', 'visitor-sentinel' ),
								'high'   => __( 'High (catch more, review more)', 'visitor-sentinel' ),
							)
						);
						?>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="vsen-burst_threshold"><?php esc_html_e( 'Click limits per IP', 'visitor-sentinel' ); ?></label></th>
					<td>
						<?php
						$vsen_number( 'burst_threshold', 1, 100, __( 'ad clicks per hour', 'visitor-sentinel' ) );
						echo '<br>';
						$vsen_number( 'daily_threshold', 1, 1000, __( 'ad clicks per 24 hours', 'visitor-sentinel' ), __( 'Clicks beyond these counts from one IP raise the score.', 'visitor-sentinel' ) );
						?>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="vsen-fast_click_ms"><?php esc_html_e( 'Timing', 'visitor-sentinel' ); ?></label></th>
					<td>
						<?php
						$vsen_number( 'fast_click_ms', 0, 10000, __( 'ms: an on-site ad clicked sooner than this after page load is suspicious', 'visitor-sentinel' ) );
						echo '<br>';
						$vsen_number( 'min_dwell_seconds', 0, 120, __( 's: a paid visitor who leaves sooner without interacting is suspicious', 'visitor-sentinel' ) );
						?>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="vsen-suspicious_networks"><?php esc_html_e( 'Suspicious networks', 'visitor-sentinel' ); ?></label></th>
					<td><?php $vsen_textarea( 'suspicious_networks', "198.51.100.0/24\n2001:db8::/32", __( 'IP ranges that raise the score, such as data-center or VPN ranges you see abusing your ads. One address or CIDR range per line.', 'visitor-sentinel' ) ); ?></td>
				</tr>
				<tr>
					<th scope="row"><label for="vsen-allowlist"><?php esc_html_e( 'Allowlist', 'visitor-sentinel' ); ?></label></th>
					<td><?php $vsen_textarea( 'allowlist', '203.0.113.0/24', __( 'Your office, your agency and your own monitoring. These IPs are still tracked but never scored or blocked.', 'visitor-sentinel' ) ); ?></td>
				</tr>
			</table>
		</div>

		<div class="vsen-card" id="vsen-protection">
			<h2><?php esc_html_e( 'Protection', 'visitor-sentinel' ); ?></h2>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="vsen-protection_action"><?php esc_html_e( 'Blocked IPs', 'visitor-sentinel' ); ?></label></th>
					<td>
						<?php
						$vsen_select(
							'protection_action',
							array(
								'log_only'   => __( 'Only record them', 'visitor-sentinel' ),
								'hide_ads'   => __( 'Hide ads from them (recommended)', 'visitor-sentinel' ),
								'block_site' => __( 'Refuse them the whole site (403)', 'visitor-sentinel' ),
							),
							__( 'Hiding ads stops further paid and on-site ad clicks without turning away visitors who may be real. Logged-in administrators and the login page are never refused.', 'visitor-sentinel' )
						);
						?>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Automatic blocking', 'visitor-sentinel' ); ?></th>
					<td>
						<?php $vsen_checkbox( 'auto_block', __( 'Add IPs to the blocklist automatically', 'visitor-sentinel' ), __( 'Search engine and ad platform crawlers (Googlebot, AdsBot, Bingbot and others) are flagged but never blocked automatically.', 'visitor-sentinel' ) ); ?>
						<p>
							<?php
							esc_html_e( 'when a click scores at least', 'visitor-sentinel' );
							echo ' ';
							$vsen_number( 'auto_block_threshold', 40, 100 );
							?>
						</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="vsen-block_duration_days"><?php esc_html_e( 'Block duration', 'visitor-sentinel' ); ?></label></th>
					<td><?php $vsen_number( 'block_duration_days', 0, 3650, __( 'days (0 = permanent)', 'visitor-sentinel' ), __( 'Home and mobile IPs change hands, so blocks that expire are kinder to the next person who gets the address.', 'visitor-sentinel' ) ); ?></td>
				</tr>
			</table>
		</div>

		<div class="vsen-card" id="vsen-alerts">
			<h2><?php esc_html_e( 'Alerts', 'visitor-sentinel' ); ?></h2>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><?php esc_html_e( 'Email', 'visitor-sentinel' ); ?></th>
					<td>
						<?php $vsen_checkbox( 'alerts_enabled', __( 'Email me an hourly digest when fraudulent clicks are found', 'visitor-sentinel' ) ); ?>
						<p><input type="email" class="regular-text" name="<?php echo esc_attr( $vsen_name( 'alert_email' ) ); ?>" value="<?php echo esc_attr( (string) $settings['alert_email'] ); ?>" placeholder="<?php echo esc_attr( (string) get_option( 'admin_email' ) ); ?>" /></p>
						<p class="description"><?php esc_html_e( 'Leave empty to use the site administration email.', 'visitor-sentinel' ); ?></p>
					</td>
				</tr>
			</table>
		</div>

		<div class="vsen-card" id="vsen-data">
			<h2><?php esc_html_e( 'Data', 'visitor-sentinel' ); ?></h2>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="vsen-retention_days"><?php esc_html_e( 'Keep data for', 'visitor-sentinel' ); ?></label></th>
					<td><?php $vsen_number( 'retention_days', 0, 3650, __( 'days (0 = forever)', 'visitor-sentinel' ), __( 'Older visits, sessions and clicks are deleted every hour. The blocklist is not affected.', 'visitor-sentinel' ) ); ?></td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Uninstall', 'visitor-sentinel' ); ?></th>
					<td><?php $vsen_checkbox( 'delete_on_uninstall', __( 'Delete all tables and settings when the plugin is deleted', 'visitor-sentinel' ) ); ?></td>
				</tr>
			</table>
		</div>

		<?php submit_button(); ?>
	</form>

	<div class="vsen-card vsen-card--danger">
		<h2><?php esc_html_e( 'Delete tracking data', 'visitor-sentinel' ); ?></h2>
		<p><?php esc_html_e( 'Removes every recorded visitor, session, pageview and click. Settings and the blocklist stay.', 'visitor-sentinel' ); ?></p>
		<a class="button vsen-button-danger" data-vsen-confirm href="<?php echo esc_url( Admin::action_url( 'purge' ) ); ?>"><?php esc_html_e( 'Delete all tracking data', 'visitor-sentinel' ); ?></a>
	</div>
</div>

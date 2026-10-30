<?php
/**
 * Settings.
 *
 * @package ZenZeiTenBastion
 *
 * @var array  $s      Settings.
 * @var array  $rules  Firewall rules.
 * @var string $own_ip The administrator's address as the plugin sees it.
 */

use ZenZeiTenBastion\Admin\Admin;
use ZenZeiTenBastion\Settings;

defined( 'ABSPATH' ) || exit;

/**
 * A checkbox row.
 *
 * @param array  $s     Settings.
 * @param string $key   Key.
 * @param string $label Label.
 * @param string $help  Help text.
 */
$zbst_check = function ( array $s, $key, $label, $help = '' ) {
	echo '<label><input type="checkbox" name="zbst[' . esc_attr( $key ) . ']" value="1" ' . checked( 1, (int) $s[ $key ], false ) . ' /> ' . esc_html( $label ) . '</label>';
	if ( '' !== $help ) {
		echo '<p class="description">' . esc_html( $help ) . '</p>';
	}
};

/**
 * A number input.
 *
 * @param array  $s   Settings.
 * @param string $key Key.
 * @param int    $min Minimum.
 * @param int    $max Maximum.
 */
$zbst_number = function ( array $s, $key, $min, $max ) {
	echo '<input type="number" class="small-text" name="zbst[' . esc_attr( $key ) . ']" min="' . esc_attr( (string) $min ) . '" max="' . esc_attr( (string) $max ) . '" value="' . esc_attr( (string) (int) $s[ $key ] ) . '" />';
};
?>
<div class="wrap zbst-wrap">
	<h1><?php esc_html_e( 'Bastion settings', 'zenzeiten-bastion' ); ?></h1>
	<?php Admin::notice(); ?>

	<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
		<input type="hidden" name="action" value="zbst_save_settings" />
		<?php wp_nonce_field( 'zbst_save_settings' ); ?>

		<h2><?php esc_html_e( 'Firewall', 'zenzeiten-bastion' ); ?></h2>
		<table class="form-table" role="presentation">
			<tr>
				<th scope="row"><?php esc_html_e( 'Mode', 'zenzeiten-bastion' ); ?></th>
				<td>
					<?php
					$zbst_modes = array(
						'protect' => __( 'Protect: block attacks', 'zenzeiten-bastion' ),
						'log'     => __( 'Log only: record attacks without blocking (use for a few days if you worry about false alarms)', 'zenzeiten-bastion' ),
						'off'     => __( 'Off', 'zenzeiten-bastion' ),
					);
					foreach ( $zbst_modes as $zbst_value => $zbst_label ) {
						echo '<label class="zbst-radio"><input type="radio" name="zbst[firewall_mode]" value="' . esc_attr( $zbst_value ) . '" ' . checked( $s['firewall_mode'], $zbst_value, false ) . ' /> ' . esc_html( $zbst_label ) . '</label>';
					}
					?>
					<p class="description"><?php esc_html_e( 'Administrators and editors, who may post any HTML, are never inspected.', 'zenzeiten-bastion' ); ?></p>
				</td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Rules', 'zenzeiten-bastion' ); ?></th>
				<td class="zbst-rules">
					<input type="hidden" name="zbst[enabled_rules][]" value="" />
					<?php foreach ( $rules as $zbst_id => $zbst_rule ) : ?>
						<label><input type="checkbox" name="zbst[enabled_rules][]" value="<?php echo esc_attr( $zbst_id ); ?>" <?php checked( ! in_array( $zbst_id, $s['disabled_rules'], true ) ); ?> /> <?php echo esc_html( $zbst_rule[0] ); ?> <code><?php echo esc_html( $zbst_id ); ?></code></label>
					<?php endforeach; ?>
					<p class="description"><?php esc_html_e( 'Untick a rule only if it blocks something legitimate on your site; the attack log shows which rule matched.', 'zenzeiten-bastion' ); ?></p>
				</td>
			</tr>
		</table>

		<h2><?php esc_html_e( 'Automatic IP blocking', 'zenzeiten-bastion' ); ?></h2>
		<table class="form-table" role="presentation">
			<tr>
				<th scope="row"><?php esc_html_e( 'Automatic blocking', 'zenzeiten-bastion' ); ?></th>
				<td><?php $zbst_check( $s, 'auto_block', __( 'Block addresses whose threat score reaches the threshold', 'zenzeiten-bastion' ), __( 'Each attack adds to the address\'s score: critical 10, high 5, medium 3, failed login 2.', 'zenzeiten-bastion' ) ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Threshold', 'zenzeiten-bastion' ); ?></th>
				<td>
					<?php
					$zbst_number( $s, 'score_threshold', 5, 1000 );
					echo ' ' . esc_html__( 'points within', 'zenzeiten-bastion' ) . ' ';
					$zbst_number( $s, 'score_window', 5, 1440 );
					echo ' ' . esc_html__( 'minutes', 'zenzeiten-bastion' );
					?>
					<p class="description"><?php esc_html_e( 'Blocks last 1 hour, then 1 day, 1 week and 30 days for repeat offenders.', 'zenzeiten-bastion' ); ?></p>
				</td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( '404 flood', 'zenzeiten-bastion' ); ?></th>
				<td>
					<?php
					$zbst_number( $s, 'not_found_limit', 0, 1000 );
					echo ' ' . esc_html__( 'missing pages per minute count as a scan (0 turns this off)', 'zenzeiten-bastion' );
					?>
				</td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Rate limit', 'zenzeiten-bastion' ); ?></th>
				<td>
					<?php
					$zbst_number( $s, 'rate_limit', 0, 10000 );
					echo ' ' . esc_html__( 'requests per minute per visitor (0 turns this off)', 'zenzeiten-bastion' );
					?>
					<p class="description"><?php esc_html_e( 'Visitors over the limit get "429 Too many requests". Logged-in users are not limited. Keep this off, or well above 120, unless your host has a persistent object cache.', 'zenzeiten-bastion' ); ?></p>
				</td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Your own addresses', 'zenzeiten-bastion' ); ?></th>
				<td><?php $zbst_check( $s, 'protect_admin_ips', __( 'Never block automatically an address an administrator signed in from in the last 30 days', 'zenzeiten-bastion' ) ); ?></td>
			</tr>
			<tr>
				<th scope="row"><label for="zbst-allowlist"><?php esc_html_e( 'Allowlist', 'zenzeiten-bastion' ); ?></label></th>
				<td>
					<textarea id="zbst-allowlist" name="zbst[allowlist]" rows="4" class="large-text code"><?php echo esc_textarea( $s['allowlist'] ); ?></textarea>
					<?php /* translators: %s: the administrator's IP address */ ?>
					<p class="description"><?php echo esc_html( sprintf( __( 'Addresses or ranges (one per line, e.g. 203.0.113.0/24) that are never inspected or blocked: your office, uptime monitors, payment gateway callbacks. Your current address is %s.', 'zenzeiten-bastion' ), $own_ip ) ); ?></p>
				</td>
			</tr>
		</table>

		<h2><?php esc_html_e( 'Login protection', 'zenzeiten-bastion' ); ?></h2>
		<table class="form-table" role="presentation">
			<tr>
				<th scope="row"><?php esc_html_e( 'Lockout', 'zenzeiten-bastion' ); ?></th>
				<td>
					<?php
					echo esc_html__( 'After', 'zenzeiten-bastion' ) . ' ';
					$zbst_number( $s, 'login_max_failures', 1, 100 );
					echo ' ' . esc_html__( 'failed logins within', 'zenzeiten-bastion' ) . ' ';
					$zbst_number( $s, 'login_window', 1, 1440 );
					echo ' ' . esc_html__( 'minutes, block the address for', 'zenzeiten-bastion' ) . ' ';
					$zbst_number( $s, 'login_lockout', 1, 43200 );
					echo ' ' . esc_html__( 'minutes', 'zenzeiten-bastion' );
					?>
				</td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Hardening', 'zenzeiten-bastion' ); ?></th>
				<td>
					<?php $zbst_check( $s, 'generic_login_errors', __( 'Show one login error that does not reveal whether a username exists', 'zenzeiten-bastion' ) ); ?><br />
					<?php $zbst_check( $s, 'block_enumeration', __( 'Stop visitors from listing usernames (?author=N scans and the REST API user list)', 'zenzeiten-bastion' ) ); ?>
				</td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'XML-RPC', 'zenzeiten-bastion' ); ?></th>
				<td>
					<?php
					$zbst_xmlrpc = array(
						'no_auth' => __( 'Allow pingbacks only; refuse password logins and multicall (recommended)', 'zenzeiten-bastion' ),
						'allow'   => __( 'Allow everything (needed by some old apps)', 'zenzeiten-bastion' ),
						'off'     => __( 'Switch off completely', 'zenzeiten-bastion' ),
					);
					foreach ( $zbst_xmlrpc as $zbst_value => $zbst_label ) {
						echo '<label class="zbst-radio"><input type="radio" name="zbst[xmlrpc]" value="' . esc_attr( $zbst_value ) . '" ' . checked( $s['xmlrpc'], $zbst_value, false ) . ' /> ' . esc_html( $zbst_label ) . '</label>';
					}
					?>
					<p class="description"><?php esc_html_e( 'The Jetpack plugin and the WordPress mobile app need XML-RPC logins; choose "Allow everything" if you use them.', 'zenzeiten-bastion' ); ?></p>
				</td>
			</tr>
		</table>

		<h2 id="zbst-backups"><?php esc_html_e( 'Database backups', 'zenzeiten-bastion' ); ?></h2>
		<table class="form-table" role="presentation">
			<tr>
				<th scope="row"><?php esc_html_e( 'Schedule', 'zenzeiten-bastion' ); ?></th>
				<td>
					<select name="zbst[backup_schedule]">
						<option value="daily" <?php selected( $s['backup_schedule'], 'daily' ); ?>><?php esc_html_e( 'Every day', 'zenzeiten-bastion' ); ?></option>
						<option value="weekly" <?php selected( $s['backup_schedule'], 'weekly' ); ?>><?php esc_html_e( 'Every week', 'zenzeiten-bastion' ); ?></option>
						<option value="off" <?php selected( $s['backup_schedule'], 'off' ); ?>><?php esc_html_e( 'Off', 'zenzeiten-bastion' ); ?></option>
					</select>
					<?php
					echo ' ' . esc_html__( 'Keep the newest', 'zenzeiten-bastion' ) . ' ';
					$zbst_number( $s, 'backup_keep', 1, 60 );
					echo ' ' . esc_html__( 'backups', 'zenzeiten-bastion' );
					?>
				</td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Options', 'zenzeiten-bastion' ); ?></th>
				<td>
					<?php $zbst_check( $s, 'backup_before_updates', __( 'Back up before WordPress installs updates to plugins, themes or core', 'zenzeiten-bastion' ) ); ?><br />
					<?php $zbst_check( $s, 'backup_exclude_logs', __( 'Leave the attack log out of backups (keeps them small; a restore keeps the current log)', 'zenzeiten-bastion' ) ); ?>
				</td>
			</tr>
		</table>

		<h2><?php esc_html_e( 'Alerts', 'zenzeiten-bastion' ); ?></h2>
		<table class="form-table" role="presentation">
			<tr>
				<th scope="row"><?php esc_html_e( 'Email alerts', 'zenzeiten-bastion' ); ?></th>
				<td>
					<?php $zbst_check( $s, 'alerts_enabled', __( 'Send email alerts', 'zenzeiten-bastion' ), __( 'Backup failures and restores are always reported while alerts are on.', 'zenzeiten-bastion' ) ); ?>
					<?php $zbst_check( $s, 'alert_on_block', __( 'When addresses are blocked automatically (at most one email every 15 minutes)', 'zenzeiten-bastion' ) ); ?><br />
					<?php $zbst_check( $s, 'alert_on_admin_change', __( 'When a new administrator account appears', 'zenzeiten-bastion' ) ); ?>
				</td>
			</tr>
			<tr>
				<th scope="row"><label for="zbst-email"><?php esc_html_e( 'Send to', 'zenzeiten-bastion' ); ?></label></th>
				<td><input type="email" id="zbst-email" class="regular-text" name="zbst[alert_email]" value="<?php echo esc_attr( $s['alert_email'] ); ?>" placeholder="<?php echo esc_attr( (string) get_option( 'admin_email' ) ); ?>" /></td>
			</tr>
		</table>

		<h2><?php esc_html_e( 'Visitor IP address', 'zenzeiten-bastion' ); ?></h2>
		<table class="form-table" role="presentation">
			<tr>
				<th scope="row"><?php esc_html_e( 'Behind a proxy', 'zenzeiten-bastion' ); ?></th>
				<td>
					<?php $zbst_check( $s, 'trust_cloudflare', __( 'This site is behind Cloudflare', 'zenzeiten-bastion' ) ); ?>
					<p>
						<label for="zbst-header"><?php esc_html_e( 'Header with the visitor address', 'zenzeiten-bastion' ); ?></label>
						<select id="zbst-header" name="zbst[proxy_header]">
							<?php foreach ( Settings::PROXY_HEADERS as $zbst_header ) : ?>
								<option value="<?php echo esc_attr( $zbst_header ); ?>" <?php selected( $s['proxy_header'], $zbst_header ); ?>><?php echo '' === $zbst_header ? esc_html__( 'None (use the connection address)', 'zenzeiten-bastion' ) : esc_html( $zbst_header ); ?></option>
							<?php endforeach; ?>
						</select>
					</p>
					<p><label for="zbst-proxies"><?php esc_html_e( 'Trusted proxy addresses', 'zenzeiten-bastion' ); ?></label></p>
					<textarea id="zbst-proxies" name="zbst[trusted_proxies]" rows="3" class="large-text code"><?php echo esc_textarea( $s['trusted_proxies'] ); ?></textarea>
					<p class="description"><?php esc_html_e( 'The header is believed only from these addresses (Cloudflare\'s are built in). Getting this wrong makes every visitor look like your proxy, so check that your own address below is right after saving.', 'zenzeiten-bastion' ); ?></p>
					<?php /* translators: %s: IP address */ ?>
					<p><strong><?php echo esc_html( sprintf( __( 'Your address as Bastion sees it: %s', 'zenzeiten-bastion' ), $own_ip ) ); ?></strong></p>
				</td>
			</tr>
		</table>

		<h2><?php esc_html_e( 'Data', 'zenzeiten-bastion' ); ?></h2>
		<table class="form-table" role="presentation">
			<tr>
				<th scope="row"><?php esc_html_e( 'Keep the attack log for', 'zenzeiten-bastion' ); ?></th>
				<td><?php $zbst_number( $s, 'log_retention_days', 1, 365 ); ?> <?php esc_html_e( 'days', 'zenzeiten-bastion' ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Uninstall', 'zenzeiten-bastion' ); ?></th>
				<td><?php $zbst_check( $s, 'delete_on_uninstall', __( 'Delete the log, blocks, settings and all backups when the plugin is deleted', 'zenzeiten-bastion' ), __( 'Leave this off if you may reinstall the plugin.', 'zenzeiten-bastion' ) ); ?></td>
			</tr>
		</table>

		<?php submit_button( __( 'Save settings', 'zenzeiten-bastion' ) ); ?>
	</form>
</div>

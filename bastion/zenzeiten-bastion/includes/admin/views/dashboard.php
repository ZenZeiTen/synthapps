<?php
/**
 * Dashboard and live monitor.
 *
 * @package ZenZeiTenBastion
 *
 * @var array $stats    Log::stats().
 * @var array $counters Headline numbers.
 * @var array $last     Last backup.
 * @var array $recent   Recent events for the feed.
 */

use ZenZeiTenBastion\Admin\Admin;
use ZenZeiTenBastion\Settings;

defined( 'ABSPATH' ) || exit;

$zbst_mode  = Settings::get( 'firewall_mode' );
$zbst_max   = max( 1, max( $stats['hours'] ) );
$zbst_cards = array(
	'blocked'  => __( 'Attacks blocked (24 h)', 'zenzeiten-bastion' ),
	'firewall' => __( 'Firewall hits (24 h)', 'zenzeiten-bastion' ),
	'logins'   => __( 'Failed logins (24 h)', 'zenzeiten-bastion' ),
	'active'   => __( 'IPs blocked now', 'zenzeiten-bastion' ),
);
?>
<div class="wrap zbst-wrap">
	<h1 class="zbst-title"><span class="dashicons dashicons-shield"></span> <?php esc_html_e( 'Bastion live monitor', 'zenzeiten-bastion' ); ?></h1>
	<?php Admin::notice(); ?>

	<?php if ( 'protect' !== $zbst_mode ) : ?>
		<div class="notice notice-warning"><p>
			<?php echo 'off' === $zbst_mode ? esc_html__( 'The firewall is switched off. Attacks are not inspected.', 'zenzeiten-bastion' ) : esc_html__( 'The firewall is in log-only mode: attacks are recorded but not blocked.', 'zenzeiten-bastion' ); ?>
			<a href="<?php echo esc_url( admin_url( 'admin.php?page=zbst-settings' ) ); ?>"><?php esc_html_e( 'Change', 'zenzeiten-bastion' ); ?></a>
		</p></div>
	<?php endif; ?>

	<div class="zbst-cards">
		<?php foreach ( $zbst_cards as $zbst_key => $zbst_label ) : ?>
			<div class="zbst-card">
				<div class="zbst-card-value" data-counter="<?php echo esc_attr( $zbst_key ); ?>"><?php echo esc_html( number_format_i18n( $counters[ $zbst_key ] ) ); ?></div>
				<div class="zbst-card-label"><?php echo esc_html( $zbst_label ); ?></div>
			</div>
		<?php endforeach; ?>
		<div class="zbst-card">
			<div class="zbst-card-value zbst-card-small">
				<?php
				if ( ! empty( $last['time'] ) ) {
					/* translators: %s: time since */
					echo esc_html( sprintf( __( '%s ago', 'zenzeiten-bastion' ), human_time_diff( (int) $last['time'], time() ) ) );
				} else {
					esc_html_e( 'Never', 'zenzeiten-bastion' );
				}
				?>
			</div>
			<div class="zbst-card-label"><a href="<?php echo esc_url( admin_url( 'admin.php?page=zbst-backups' ) ); ?>"><?php esc_html_e( 'Last database backup', 'zenzeiten-bastion' ); ?></a></div>
		</div>
	</div>

	<div class="zbst-panel">
		<h2><?php esc_html_e( 'Threats per hour, last 24 hours', 'zenzeiten-bastion' ); ?></h2>
		<div class="zbst-chart" role="img" aria-label="<?php esc_attr_e( 'Bar chart of threats per hour', 'zenzeiten-bastion' ); ?>">
			<?php foreach ( $stats['hours'] as $zbst_hour => $zbst_count ) : ?>
				<?php $zbst_local = Admin::local_time( $zbst_hour . ':00:00', 'H:00' ); ?>
				<div class="zbst-bar" title="<?php echo esc_attr( $zbst_local . ' · ' . $zbst_count ); ?>"><span style="height:<?php echo esc_attr( (string) round( 100 * $zbst_count / $zbst_max ) ); ?>%"></span></div>
			<?php endforeach; ?>
		</div>
	</div>

	<div class="zbst-columns">
		<div class="zbst-panel zbst-live">
			<h2>
				<?php esc_html_e( 'Live attack feed', 'zenzeiten-bastion' ); ?>
				<button type="button" class="button button-small zbst-toggle" aria-pressed="false"><span class="zbst-dot"></span> <span class="zbst-state"><?php esc_html_e( 'Live', 'zenzeiten-bastion' ); ?></span></button>
			</h2>
			<table class="widefat striped zbst-feed">
				<thead><tr>
					<th><?php esc_html_e( 'Time', 'zenzeiten-bastion' ); ?></th>
					<th><?php esc_html_e( 'IP address', 'zenzeiten-bastion' ); ?></th>
					<th><?php esc_html_e( 'Event', 'zenzeiten-bastion' ); ?></th>
					<th><?php esc_html_e( 'Request', 'zenzeiten-bastion' ); ?></th>
					<th><?php esc_html_e( 'Details', 'zenzeiten-bastion' ); ?></th>
				</tr></thead>
				<tbody></tbody>
			</table>
			<script type="application/json" class="zbst-initial"><?php echo wp_json_encode( $recent, JSON_HEX_TAG | JSON_HEX_AMP ); ?></script>
		</div>

		<div class="zbst-panel">
			<h2><?php esc_html_e( 'Top attacking IPs (24 h)', 'zenzeiten-bastion' ); ?></h2>
			<?php if ( ! $stats['top'] ) : ?>
				<p class="description"><?php esc_html_e( 'No attacks in the last 24 hours.', 'zenzeiten-bastion' ); ?></p>
			<?php else : ?>
				<table class="widefat striped">
					<thead><tr>
						<th><?php esc_html_e( 'IP address', 'zenzeiten-bastion' ); ?></th>
						<th><?php esc_html_e( 'Events', 'zenzeiten-bastion' ); ?></th>
						<th><?php esc_html_e( 'Score', 'zenzeiten-bastion' ); ?></th>
						<th></th>
					</tr></thead>
					<tbody>
					<?php foreach ( $stats['top'] as $zbst_row ) : ?>
						<tr>
							<td><a href="<?php echo esc_url( admin_url( 'admin.php?page=zbst-events&ip=' . rawurlencode( $zbst_row['ip'] ) ) ); ?>"><code><?php echo esc_html( $zbst_row['ip'] ); ?></code></a></td>
							<td><?php echo esc_html( number_format_i18n( (int) $zbst_row['n'] ) ); ?></td>
							<td><?php echo esc_html( number_format_i18n( (int) $zbst_row['score'] ) ); ?></td>
							<td><a class="button button-small" href="<?php echo esc_url( admin_url( 'admin.php?page=zbst-blocks&ip=' . rawurlencode( $zbst_row['ip'] ) ) ); ?>"><?php esc_html_e( 'Block', 'zenzeiten-bastion' ); ?></a></td>
						</tr>
					<?php endforeach; ?>
					</tbody>
				</table>
			<?php endif; ?>
		</div>
	</div>
</div>

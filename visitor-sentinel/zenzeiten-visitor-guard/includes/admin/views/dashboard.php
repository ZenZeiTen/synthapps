<?php
/**
 * Dashboard view.
 *
 * @package VisitorSentinel
 *
 * @var array $data Report data from Admin::page_dashboard().
 */

use VisitorSentinel\Admin\Admin;

defined( 'ABSPATH' ) || exit;

$vsen_s      = $data['summary'];
$vsen_ranges = array(
	'today' => __( 'Today', 'zenzeiten-visitor-guard' ),
	'7d'    => __( 'Last 7 days', 'zenzeiten-visitor-guard' ),
	'30d'   => __( 'Last 30 days', 'zenzeiten-visitor-guard' ),
);
$vsen_cards  = array(
	array( __( 'Visitors', 'zenzeiten-visitor-guard' ), number_format_i18n( $vsen_s['visitors'] ), '' ),
	array( __( 'Pageviews', 'zenzeiten-visitor-guard' ), number_format_i18n( $vsen_s['pageviews'] ), '' ),
	array( __( 'Avg. session', 'zenzeiten-visitor-guard' ), Admin::duration( $vsen_s['avg_duration'] ), '' ),
	array( __( 'Bounce rate', 'zenzeiten-visitor-guard' ), number_format_i18n( $vsen_s['bounce_rate'], 1 ) . '%', '' ),
	array( __( 'Paid ad visits', 'zenzeiten-visitor-guard' ), number_format_i18n( $vsen_s['paid_clicks'] ), '' ),
	array( __( 'On-site ad clicks', 'zenzeiten-visitor-guard' ), number_format_i18n( $vsen_s['onsite_ads'] ), '' ),
	array( __( 'Fraudulent clicks', 'zenzeiten-visitor-guard' ), number_format_i18n( $vsen_s['fraud'] ), $vsen_s['fraud'] > 0 ? 'fraud' : '' ),
	array( __( 'Fraud rate', 'zenzeiten-visitor-guard' ), number_format_i18n( $vsen_s['fraud_rate'], 1 ) . '%', $vsen_s['fraud_rate'] >= 10 ? 'fraud' : ( $vsen_s['fraud_rate'] > 0 ? 'suspicious' : '' ) ),
	array( __( 'Suspicious clicks', 'zenzeiten-visitor-guard' ), number_format_i18n( $vsen_s['suspicious'] ), $vsen_s['suspicious'] > 0 ? 'suspicious' : '' ),
	array( __( 'Blocked IPs', 'zenzeiten-visitor-guard' ), number_format_i18n( $vsen_s['blocked'] ), '' ),
);

/**
 * Print a small ranked list.
 *
 * @param string $title Title.
 * @param array  $rows  Rows with label and n.
 * @param string $empty Empty label.
 */
$vsen_list = function ( $title, $rows, $empty ) {
	$max = 0;
	foreach ( $rows as $row ) {
		$max = max( $max, (int) $row->n );
	}
	echo '<div class="vsen-card"><h2>' . esc_html( $title ) . '</h2>';
	if ( empty( $rows ) ) {
		echo '<p class="vsen-muted">' . esc_html( $empty ) . '</p></div>';
		return;
	}
	echo '<ol class="vsen-rank">';
	foreach ( $rows as $row ) {
		$label = '' !== (string) $row->label ? (string) $row->label : __( '(unknown)', 'zenzeiten-visitor-guard' );
		if ( isset( $row->title ) && '' !== (string) $row->title ) {
			$label .= ' — ' . $row->title;
		}
		$width = $max ? round( 100 * (int) $row->n / $max ) : 0;
		echo '<li><span class="vsen-rank__bar" style="width:' . esc_attr( $width ) . '%"></span><span class="vsen-rank__label" title="' . esc_attr( $label ) . '">' . esc_html( $label ) . '</span><span class="vsen-rank__n">' . esc_html( number_format_i18n( (int) $row->n ) ) . '</span></li>';
	}
	echo '</ol></div>';
};
?>
<div class="wrap vsen-wrap">
	<div class="vsen-header">
		<h1><span class="dashicons dashicons-shield-alt"></span> <?php esc_html_e( 'Visitor Guard', 'zenzeiten-visitor-guard' ); ?></h1>
		<nav class="vsen-range" aria-label="<?php esc_attr_e( 'Period', 'zenzeiten-visitor-guard' ); ?>">
			<?php foreach ( $vsen_ranges as $vsen_key => $vsen_label ) : ?>
				<a class="<?php echo $data['range'] === $vsen_key ? 'is-active' : ''; ?>" href="<?php echo esc_url( add_query_arg( 'range', $vsen_key, admin_url( 'admin.php?page=' . Admin::SLUG ) ) ); ?>"><?php echo esc_html( $vsen_label ); ?></a>
			<?php endforeach; ?>
		</nav>
	</div>

	<?php if ( ! \VisitorSentinel\Settings::get( 'tracking_enabled' ) ) : ?>
		<div class="notice notice-warning inline"><p><?php esc_html_e( 'Tracking is switched off in Settings. No new visits are being recorded.', 'zenzeiten-visitor-guard' ); ?></p></div>
	<?php endif; ?>

	<div class="vsen-kpis">
		<?php foreach ( $vsen_cards as $vsen_card ) : ?>
			<div class="vsen-kpi <?php echo $vsen_card[2] ? 'vsen-kpi--' . esc_attr( $vsen_card[2] ) : ''; ?>">
				<span class="vsen-kpi__label"><?php echo esc_html( $vsen_card[0] ); ?></span>
				<span class="vsen-kpi__value"><?php echo esc_html( $vsen_card[1] ); ?></span>
			</div>
		<?php endforeach; ?>
	</div>

	<div class="vsen-grid vsen-grid--main">
		<div class="vsen-card vsen-card--chart">
			<div class="vsen-card__head">
				<h2><?php esc_html_e( 'Traffic and ad clicks, last 30 days', 'zenzeiten-visitor-guard' ); ?></h2>
				<div class="vsen-legend">
					<span class="vsen-legend__item vsen-legend__item--pageviews"><?php esc_html_e( 'Pageviews', 'zenzeiten-visitor-guard' ); ?></span>
					<span class="vsen-legend__item vsen-legend__item--visitors"><?php esc_html_e( 'Visitors', 'zenzeiten-visitor-guard' ); ?></span>
					<span class="vsen-legend__item vsen-legend__item--ads"><?php esc_html_e( 'Ad clicks', 'zenzeiten-visitor-guard' ); ?></span>
					<span class="vsen-legend__item vsen-legend__item--fraud"><?php esc_html_e( 'Fraudulent', 'zenzeiten-visitor-guard' ); ?></span>
				</div>
			</div>
			<div id="vsen-chart" class="vsen-chart" data-series="<?php echo esc_attr( wp_json_encode( $data['series'] ) ); ?>" role="img" aria-label="<?php esc_attr_e( 'Daily pageviews, visitors, ad clicks and fraudulent clicks for the last 30 days', 'zenzeiten-visitor-guard' ); ?>"></div>
		</div>

		<div class="vsen-card vsen-card--live">
			<div class="vsen-card__head">
				<h2><span class="vsen-pulse" aria-hidden="true"></span><?php esc_html_e( 'Live now', 'zenzeiten-visitor-guard' ); ?></h2>
				<span class="vsen-live-count" id="vsen-live-count">–</span>
			</div>
			<p class="vsen-muted"><?php esc_html_e( 'Active in the last 5 minutes. Updates every 30 seconds.', 'zenzeiten-visitor-guard' ); ?></p>
			<ul class="vsen-live" id="vsen-live"></ul>
		</div>
	</div>

	<div class="vsen-grid">
		<?php
		$vsen_list( __( 'Top pages', 'zenzeiten-visitor-guard' ), $data['pages'], __( 'No pageviews in this period.', 'zenzeiten-visitor-guard' ) );
		$vsen_list( __( 'Referrers', 'zenzeiten-visitor-guard' ), $data['referrers'], __( 'No external referrers in this period.', 'zenzeiten-visitor-guard' ) );
		$vsen_list( __( 'Campaigns (utm_source — campaign)', 'zenzeiten-visitor-guard' ), $data['campaigns'], __( 'No tagged campaigns in this period.', 'zenzeiten-visitor-guard' ) );
		$vsen_known = array_filter(
			$data['countries'],
			function ( $row ) {
				return '' !== (string) $row->label;
			}
		);
		$vsen_list(
			__( 'Countries', 'zenzeiten-visitor-guard' ),
			$vsen_known ? $data['countries'] : array(),
			__( 'Countries appear when the site is behind Cloudflare (see Settings) or a geolocation service is connected through the vsen_country filter.', 'zenzeiten-visitor-guard' )
		);
		$vsen_list( __( 'Devices', 'zenzeiten-visitor-guard' ), $data['devices'], __( 'No data.', 'zenzeiten-visitor-guard' ) );
		$vsen_list( __( 'Browsers', 'zenzeiten-visitor-guard' ), $data['browsers'], __( 'No data.', 'zenzeiten-visitor-guard' ) );
		?>
	</div>

	<div class="vsen-grid vsen-grid--two">
		<div class="vsen-card">
			<h2><?php esc_html_e( 'Ad clicks by network', 'zenzeiten-visitor-guard' ); ?></h2>
			<?php if ( empty( $data['networks'] ) ) : ?>
				<p class="vsen-muted"><?php esc_html_e( 'No ad clicks in this period.', 'zenzeiten-visitor-guard' ); ?></p>
			<?php else : ?>
				<table class="vsen-mini">
					<thead><tr><th><?php esc_html_e( 'Network', 'zenzeiten-visitor-guard' ); ?></th><th><?php esc_html_e( 'Clicks', 'zenzeiten-visitor-guard' ); ?></th><th><?php esc_html_e( 'Fraudulent', 'zenzeiten-visitor-guard' ); ?></th><th><?php esc_html_e( 'Rate', 'zenzeiten-visitor-guard' ); ?></th></tr></thead>
					<tbody>
					<?php foreach ( $data['networks'] as $vsen_row ) : ?>
						<?php $vsen_rate = (int) $vsen_row->n ? 100 * (int) $vsen_row->fraud / (int) $vsen_row->n : 0; ?>
						<tr>
							<td><?php echo esc_html( '' !== (string) $vsen_row->label ? str_replace( '_', ' ', $vsen_row->label ) : __( 'other', 'zenzeiten-visitor-guard' ) ); ?></td>
							<td><?php echo esc_html( number_format_i18n( (int) $vsen_row->n ) ); ?></td>
							<td><?php echo esc_html( number_format_i18n( (int) $vsen_row->fraud ) ); ?></td>
							<td><span class="vsen-rate" style="--vsen-rate:<?php echo esc_attr( round( $vsen_rate ) ); ?>%"><?php echo esc_html( number_format_i18n( $vsen_rate, 1 ) ); ?>%</span></td>
						</tr>
					<?php endforeach; ?>
					</tbody>
				</table>
			<?php endif; ?>
		</div>

		<div class="vsen-card">
			<div class="vsen-card__head">
				<h2><?php esc_html_e( 'Latest fraudulent clicks', 'zenzeiten-visitor-guard' ); ?></h2>
				<a href="<?php echo esc_url( admin_url( 'admin.php?page=vsen-fraud&view=fraud' ) ); ?>"><?php esc_html_e( 'Review all', 'zenzeiten-visitor-guard' ); ?> &rarr;</a>
			</div>
			<?php if ( empty( $data['recent']['rows'] ) ) : ?>
				<p class="vsen-muted"><?php esc_html_e( 'No fraudulent clicks detected. Nice.', 'zenzeiten-visitor-guard' ); ?></p>
			<?php else : ?>
				<ul class="vsen-feed">
					<?php foreach ( $data['recent']['rows'] as $vsen_click ) : ?>
						<?php $vsen_reasons = Admin::reason_labels( $vsen_click->fraud_reasons ); ?>
						<li>
							<?php echo Admin::score_badge( (int) $vsen_click->fraud_score ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in score_badge(). ?>
							<div>
								<strong class="vsen-ip"><?php echo esc_html( Admin::ip_label( $vsen_click->ip, $vsen_click->ip_hash ) ); ?></strong>
								<span class="vsen-muted"><?php echo esc_html( Admin::click_type_label( $vsen_click->click_type ) . ' · ' . Admin::local_time( $vsen_click->created_at ) ); ?></span>
								<br><span><?php echo esc_html( $vsen_reasons ? $vsen_reasons[0] : '' ); ?></span>
							</div>
						</li>
					<?php endforeach; ?>
				</ul>
			<?php endif; ?>
		</div>
	</div>
</div>

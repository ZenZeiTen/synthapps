<?php
/**
 * Single visitor view: profile, sessions and an activity timeline.
 *
 * @package VisitorSentinel
 *
 * @var object $visitor   Visitor row.
 * @var array  $sessions  Sessions.
 * @var array  $pageviews Pageviews.
 * @var array  $clicks    Clicks.
 */

use VisitorSentinel\Admin\Admin;

defined( 'ABSPATH' ) || exit;

$vsen_blocked = '' !== (string) $visitor->ip_hash && Admin::hash_blocked( $visitor->ip_hash );

// One timeline from pageviews and clicks, newest first.
$vsen_events = array();
foreach ( (array) $pageviews as $vsen_pv ) {
	$vsen_events[] = array(
		'time' => $vsen_pv->created_at,
		'id'   => 'p' . $vsen_pv->id,
		'kind' => 'pageview',
		'row'  => $vsen_pv,
	);
}
foreach ( (array) $clicks as $vsen_click ) {
	$vsen_events[] = array(
		'time' => $vsen_click->created_at,
		'id'   => 'c' . $vsen_click->id,
		'kind' => 'click',
		'row'  => $vsen_click,
	);
}
usort(
	$vsen_events,
	function ( $a, $b ) {
		return strcmp( $b['time'], $a['time'] );
	}
);
$vsen_events = array_slice( $vsen_events, 0, 300 );

$vsen_facts = array(
	__( 'IP address', 'visitor-sentinel' ) => Admin::ip_label( $visitor->ip, $visitor->ip_hash ),
	__( 'Country', 'visitor-sentinel' )    => '' !== (string) $visitor->country ? Admin::flag( $visitor->country ) . ' ' . $visitor->country : '—',
	__( 'Device', 'visitor-sentinel' )     => ucfirst( (string) $visitor->device ),
	__( 'Browser', 'visitor-sentinel' )    => $visitor->browser,
	__( 'System', 'visitor-sentinel' )     => $visitor->os,
	__( 'First seen', 'visitor-sentinel' ) => Admin::local_time( $visitor->first_seen ),
	__( 'Last seen', 'visitor-sentinel' )  => Admin::local_time( $visitor->last_seen ),
	__( 'Sessions', 'visitor-sentinel' )   => number_format_i18n( (int) $visitor->sessions ),
	__( 'Pageviews', 'visitor-sentinel' )  => number_format_i18n( (int) $visitor->pageviews ),
	__( 'Clicks', 'visitor-sentinel' )     => number_format_i18n( (int) $visitor->clicks ),
);
if ( (int) $visitor->user_id > 0 ) {
	$vsen_user = get_userdata( (int) $visitor->user_id );
	if ( $vsen_user ) {
		$vsen_facts[ __( 'User', 'visitor-sentinel' ) ] = $vsen_user->user_login;
	}
}
?>
<div class="wrap vsen-wrap">
	<p><a href="<?php echo esc_url( admin_url( 'admin.php?page=vsen-visitors' ) ); ?>">&larr; <?php esc_html_e( 'All visitors', 'visitor-sentinel' ); ?></a></p>
	<div class="vsen-header">
		<h1>
			<span class="vsen-ip"><?php echo esc_html( Admin::ip_label( $visitor->ip, $visitor->ip_hash ) ); ?></span>
			<?php echo Admin::score_badge( (int) $visitor->fraud_score ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in score_badge(). ?>
			<?php if ( (int) $visitor->is_bot ) : ?>
				<span class="vsen-pill"><?php esc_html_e( 'Bot', 'visitor-sentinel' ); ?></span>
			<?php endif; ?>
			<?php if ( $vsen_blocked ) : ?>
				<span class="vsen-pill vsen-pill--fraud"><?php esc_html_e( 'Blocked', 'visitor-sentinel' ); ?></span>
			<?php endif; ?>
		</h1>
		<div class="vsen-header__actions">
			<?php if ( '' !== (string) $visitor->ip_hash ) : ?>
				<?php if ( $vsen_blocked ) : ?>
					<a class="button" href="<?php echo esc_url( Admin::action_url( 'unblock_visitor', array( 'id' => (int) $visitor->id ) ) ); ?>"><?php esc_html_e( 'Unblock IP', 'visitor-sentinel' ); ?></a>
				<?php else : ?>
					<a class="button vsen-button-danger" href="<?php echo esc_url( Admin::action_url( 'block_visitor', array( 'id' => (int) $visitor->id ) ) ); ?>"><?php esc_html_e( 'Block IP', 'visitor-sentinel' ); ?></a>
				<?php endif; ?>
			<?php endif; ?>
		</div>
	</div>

	<div class="vsen-grid vsen-grid--profile">
		<div class="vsen-card">
			<h2><?php esc_html_e( 'Profile', 'visitor-sentinel' ); ?></h2>
			<dl class="vsen-facts">
				<?php foreach ( $vsen_facts as $vsen_label => $vsen_value ) : ?>
					<dt><?php echo esc_html( $vsen_label ); ?></dt>
					<dd><?php echo esc_html( (string) $vsen_value ); ?></dd>
				<?php endforeach; ?>
			</dl>
			<?php if ( '' !== (string) $visitor->user_agent ) : ?>
				<p class="vsen-ua"><code><?php echo esc_html( $visitor->user_agent ); ?></code></p>
			<?php endif; ?>
		</div>

		<div class="vsen-card">
			<h2><?php esc_html_e( 'Sessions', 'visitor-sentinel' ); ?></h2>
			<?php if ( empty( $sessions ) ) : ?>
				<p class="vsen-muted"><?php esc_html_e( 'No browser sessions. This visitor was only seen by the server (no JavaScript).', 'visitor-sentinel' ); ?></p>
			<?php else : ?>
				<table class="vsen-mini">
					<thead><tr>
						<th><?php esc_html_e( 'Started', 'visitor-sentinel' ); ?></th>
						<th><?php esc_html_e( 'Duration', 'visitor-sentinel' ); ?></th>
						<th><?php esc_html_e( 'Pages', 'visitor-sentinel' ); ?></th>
						<th><?php esc_html_e( 'Source', 'visitor-sentinel' ); ?></th>
						<th><?php esc_html_e( 'Entry page', 'visitor-sentinel' ); ?></th>
					</tr></thead>
					<tbody>
					<?php foreach ( $sessions as $vsen_session ) : ?>
						<?php
						$vsen_source = '' !== (string) $vsen_session->utm_source ? $vsen_session->utm_source : ( '' !== (string) $vsen_session->referrer_host ? $vsen_session->referrer_host : __( 'direct', 'visitor-sentinel' ) );
						?>
						<tr>
							<td><?php echo esc_html( Admin::local_time( $vsen_session->started_at ) ); ?></td>
							<td><?php echo esc_html( Admin::duration( (int) $vsen_session->duration ) ); ?></td>
							<td><?php echo esc_html( number_format_i18n( (int) $vsen_session->pageviews ) ); ?></td>
							<td>
								<?php echo esc_html( $vsen_source ); ?>
								<?php if ( (int) $vsen_session->is_paid ) : ?>
									<span class="vsen-pill vsen-pill--paid"><?php echo esc_html( __( 'Paid', 'visitor-sentinel' ) . ( '' !== (string) $vsen_session->click_id_type ? ' · ' . str_replace( '_', ' ', $vsen_session->click_id_type ) : '' ) ); ?></span>
								<?php endif; ?>
							</td>
							<td class="vsen-url" title="<?php echo esc_attr( $vsen_session->entry_url ); ?>"><?php echo esc_html( (string) wp_parse_url( $vsen_session->entry_url, PHP_URL_PATH ) ); ?></td>
						</tr>
					<?php endforeach; ?>
					</tbody>
				</table>
			<?php endif; ?>
		</div>
	</div>

	<div class="vsen-card">
		<h2><?php esc_html_e( 'Activity', 'visitor-sentinel' ); ?></h2>
		<?php if ( empty( $vsen_events ) ) : ?>
			<p class="vsen-muted"><?php esc_html_e( 'No activity recorded.', 'visitor-sentinel' ); ?></p>
		<?php else : ?>
			<ol class="vsen-timeline">
				<?php foreach ( $vsen_events as $vsen_event ) : ?>
					<?php $vsen_row = $vsen_event['row']; ?>
					<?php if ( 'pageview' === $vsen_event['kind'] ) : ?>
						<li class="vsen-timeline__item vsen-timeline__item--pageview">
							<span class="vsen-timeline__time"><?php echo esc_html( Admin::local_time( $vsen_row->created_at, get_option( 'time_format' ) ) ); ?><br><span class="vsen-muted"><?php echo esc_html( Admin::local_time( $vsen_row->created_at, get_option( 'date_format' ) ) ); ?></span></span>
							<div>
								<strong><?php echo esc_html( '' !== (string) $vsen_row->title ? $vsen_row->title : $vsen_row->path ); ?></strong>
								<span class="vsen-url vsen-muted" title="<?php echo esc_attr( $vsen_row->url ); ?>"><?php echo esc_html( $vsen_row->path ); ?></span>
								<span class="vsen-metrics">
									<?php
									echo esc_html(
										sprintf(
											/* translators: 1: time on page, 2: scroll depth percentage, 3: interaction count */
											__( '%1$s on page · scrolled %2$d%% · %3$d interactions', 'visitor-sentinel' ),
											Admin::duration( (int) $vsen_row->time_on_page ),
											(int) $vsen_row->max_scroll,
											(int) $vsen_row->interactions
										)
									);
									?>
								</span>
							</div>
						</li>
					<?php else : ?>
						<li class="vsen-timeline__item vsen-timeline__item--<?php echo esc_attr( $vsen_row->click_type ); ?>">
							<span class="vsen-timeline__time"><?php echo esc_html( Admin::local_time( $vsen_row->created_at, get_option( 'time_format' ) ) ); ?><br><span class="vsen-muted"><?php echo esc_html( Admin::local_time( $vsen_row->created_at, get_option( 'date_format' ) ) ); ?></span></span>
							<div>
								<strong><?php echo esc_html( Admin::click_type_label( $vsen_row->click_type ) ); ?></strong>
								<?php if ( '' !== (string) $vsen_row->network ) : ?>
									<span class="vsen-muted"><?php echo esc_html( str_replace( '_', ' ', $vsen_row->network ) ); ?></span>
								<?php endif; ?>
								<?php echo Admin::status_pill( $vsen_row ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in status_pill(). ?>
								<?php if ( in_array( $vsen_row->click_type, \VisitorSentinel\Repository::AD_TYPES, true ) ) : ?>
									<?php echo Admin::score_badge( (int) $vsen_row->fraud_score ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in score_badge(). ?>
								<?php endif; ?>
								<span class="vsen-url vsen-muted" title="<?php echo esc_attr( $vsen_row->target ); ?>"><?php echo esc_html( trim( $vsen_row->label . ' ' . $vsen_row->target ) ); ?></span>
								<?php $vsen_reasons = Admin::reason_labels( $vsen_row->fraud_reasons ); ?>
								<?php if ( $vsen_reasons ) : ?>
									<ul class="vsen-reasons"><li><?php echo implode( '</li><li>', array_map( 'esc_html', $vsen_reasons ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- each item escaped. ?></li></ul>
								<?php endif; ?>
							</div>
						</li>
					<?php endif; ?>
				<?php endforeach; ?>
			</ol>
		<?php endif; ?>
	</div>
</div>

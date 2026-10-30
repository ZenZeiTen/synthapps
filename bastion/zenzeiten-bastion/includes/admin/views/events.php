<?php
/**
 * Attack log.
 *
 * @package ZenZeiTenBastion
 *
 * @var array $filters Filters.
 * @var array $events  Rows.
 * @var int   $total   Matching rows.
 * @var int   $paged   Page.
 * @var int   $pages   Pages.
 */

use ZenZeiTenBastion\Admin\Admin;
use ZenZeiTenBastion\Log;

defined( 'ABSPATH' ) || exit;

$zbst_types      = Log::types();
$zbst_labels     = ZenZeiTenBastion\Firewall::labels();
$zbst_severities = Log::severities();
?>
<div class="wrap zbst-wrap">
	<h1><?php esc_html_e( 'Attack log', 'zenzeiten-bastion' ); ?></h1>
	<?php Admin::notice(); ?>

	<form method="get" class="zbst-filters">
		<input type="hidden" name="page" value="zbst-events" />
		<select name="type">
			<option value=""><?php esc_html_e( 'All events', 'zenzeiten-bastion' ); ?></option>
			<?php foreach ( $zbst_types as $zbst_key => $zbst_label ) : ?>
				<option value="<?php echo esc_attr( $zbst_key ); ?>" <?php selected( $filters['type'], $zbst_key ); ?>><?php echo esc_html( $zbst_label ); ?></option>
			<?php endforeach; ?>
		</select>
		<select name="severity">
			<option value="0"><?php esc_html_e( 'Any severity', 'zenzeiten-bastion' ); ?></option>
			<?php foreach ( $zbst_severities as $zbst_key => $zbst_label ) : ?>
				<?php /* translators: %s: severity */ ?>
				<option value="<?php echo esc_attr( (string) $zbst_key ); ?>" <?php selected( (int) $filters['severity'], $zbst_key ); ?>><?php echo esc_html( sprintf( __( '%s and above', 'zenzeiten-bastion' ), $zbst_label ) ); ?></option>
			<?php endforeach; ?>
		</select>
		<input type="search" name="ip" value="<?php echo esc_attr( $filters['ip'] ); ?>" placeholder="<?php esc_attr_e( 'IP address', 'zenzeiten-bastion' ); ?>" />
		<button class="button"><?php esc_html_e( 'Filter', 'zenzeiten-bastion' ); ?></button>
		<?php /* translators: %s: number of events */ ?>
		<span class="zbst-count"><?php echo esc_html( sprintf( _n( '%s event', '%s events', $total, 'zenzeiten-bastion' ), number_format_i18n( $total ) ) ); ?></span>
	</form>

	<table class="widefat striped zbst-events">
		<thead><tr>
			<th><?php esc_html_e( 'Time', 'zenzeiten-bastion' ); ?></th>
			<th><?php esc_html_e( 'Severity', 'zenzeiten-bastion' ); ?></th>
			<th><?php esc_html_e( 'IP address', 'zenzeiten-bastion' ); ?></th>
			<th><?php esc_html_e( 'Event', 'zenzeiten-bastion' ); ?></th>
			<th><?php esc_html_e( 'Action', 'zenzeiten-bastion' ); ?></th>
			<th><?php esc_html_e( 'Request', 'zenzeiten-bastion' ); ?></th>
			<th><?php esc_html_e( 'Details', 'zenzeiten-bastion' ); ?></th>
		</tr></thead>
		<tbody>
		<?php if ( ! $events ) : ?>
			<tr><td colspan="7"><?php esc_html_e( 'No events match.', 'zenzeiten-bastion' ); ?></td></tr>
		<?php endif; ?>
		<?php foreach ( $events as $zbst_e ) : ?>
			<tr class="zbst-sev-<?php echo esc_attr( (string) (int) $zbst_e['severity'] ); ?>">
				<td><?php echo esc_html( Admin::local_time( $zbst_e['created_at'], 'Y-m-d H:i:s' ) ); ?></td>
				<td><span class="zbst-badge zbst-badge-<?php echo esc_attr( (string) (int) $zbst_e['severity'] ); ?>"><?php echo esc_html( isset( $zbst_severities[ (int) $zbst_e['severity'] ] ) ? $zbst_severities[ (int) $zbst_e['severity'] ] : '' ); ?></span></td>
				<td><?php if ( '' !== $zbst_e['ip'] ) : ?><a href="<?php echo esc_url( add_query_arg( array( 'page' => 'zbst-events', 'ip' => $zbst_e['ip'] ), admin_url( 'admin.php' ) ) ); ?>"><code><?php echo esc_html( $zbst_e['ip'] ); ?></code></a><?php endif; ?></td>
				<td><?php echo esc_html( isset( $zbst_types[ $zbst_e['type'] ] ) ? $zbst_types[ $zbst_e['type'] ] : $zbst_e['type'] ); ?><?php if ( '' !== $zbst_e['rule'] ) : ?><br /><?php echo esc_html( isset( $zbst_labels[ $zbst_e['rule'] ] ) ? $zbst_labels[ $zbst_e['rule'] ] : '' ); ?> <code><?php echo esc_html( $zbst_e['rule'] ); ?></code><?php endif; ?></td>
				<td><?php echo esc_html( $zbst_e['action'] ); ?></td>
				<td class="zbst-request"><?php echo esc_html( trim( $zbst_e['method'] . ' ' . $zbst_e['uri'] ) ); ?><?php if ( '' !== $zbst_e['user_agent'] ) : ?><br /><small><?php echo esc_html( $zbst_e['user_agent'] ); ?></small><?php endif; ?></td>
				<td><?php echo esc_html( $zbst_e['details'] ); ?><?php if ( '' !== $zbst_e['username'] ) : ?><br /><small><?php esc_html_e( 'User:', 'zenzeiten-bastion' ); ?> <?php echo esc_html( $zbst_e['username'] ); ?></small><?php endif; ?></td>
			</tr>
		<?php endforeach; ?>
		</tbody>
	</table>

	<?php if ( $pages > 1 ) : ?>
		<div class="tablenav"><div class="tablenav-pages">
			<?php
			echo wp_kses_post(
				paginate_links(
					array(
						'base'    => add_query_arg( 'paged', '%#%' ),
						'format'  => '',
						'current' => $paged,
						'total'   => $pages,
					)
				)
			);
			?>
		</div></div>
	<?php endif; ?>
</div>

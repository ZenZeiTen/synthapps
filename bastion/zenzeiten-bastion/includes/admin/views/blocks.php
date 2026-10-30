<?php
/**
 * Blocked IP addresses.
 *
 * @package ZenZeiTenBastion
 *
 * @var array  $blocks Active blocks.
 * @var string $own_ip The administrator's address.
 */

use ZenZeiTenBastion\Admin\Admin;
use ZenZeiTenBastion\Blocklist;

defined( 'ABSPATH' ) || exit;

// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- pre-fills a form field.
$zbst_prefill = isset( $_GET['ip'] ) ? sanitize_text_field( wp_unslash( $_GET['ip'] ) ) : '';
$zbst_sources = array(
	'auto'   => __( 'Automatic', 'zenzeiten-bastion' ),
	'login'  => __( 'Login lockout', 'zenzeiten-bastion' ),
	'manual' => __( 'Manual', 'zenzeiten-bastion' ),
);
?>
<div class="wrap zbst-wrap">
	<h1><?php esc_html_e( 'Blocked IP addresses', 'zenzeiten-bastion' ); ?></h1>
	<?php Admin::notice(); ?>

	<div class="zbst-panel">
		<h2><?php esc_html_e( 'Block an address', 'zenzeiten-bastion' ); ?></h2>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="zbst-inline-form">
			<input type="hidden" name="action" value="zbst_block" />
			<?php wp_nonce_field( 'zbst_block' ); ?>
			<input type="text" name="ip" required value="<?php echo esc_attr( $zbst_prefill ); ?>" placeholder="203.0.113.7 or 203.0.113.0/24" aria-label="<?php esc_attr_e( 'IP address or range', 'zenzeiten-bastion' ); ?>" />
			<select name="minutes" aria-label="<?php esc_attr_e( 'Duration', 'zenzeiten-bastion' ); ?>">
				<option value="60"><?php esc_html_e( '1 hour', 'zenzeiten-bastion' ); ?></option>
				<option value="1440"><?php esc_html_e( '1 day', 'zenzeiten-bastion' ); ?></option>
				<option value="10080"><?php esc_html_e( '1 week', 'zenzeiten-bastion' ); ?></option>
				<option value="43200"><?php esc_html_e( '30 days', 'zenzeiten-bastion' ); ?></option>
				<option value="0" selected><?php esc_html_e( 'Permanently', 'zenzeiten-bastion' ); ?></option>
			</select>
			<input type="text" name="reason" placeholder="<?php esc_attr_e( 'Reason (optional)', 'zenzeiten-bastion' ); ?>" aria-label="<?php esc_attr_e( 'Reason', 'zenzeiten-bastion' ); ?>" />
			<button class="button button-primary"><?php esc_html_e( 'Block', 'zenzeiten-bastion' ); ?></button>
		</form>
		<?php /* translators: %s: the administrator's own IP address */ ?>
		<p class="description"><?php echo esc_html( sprintf( __( 'Your address is %s. It cannot be blocked from here, and addresses administrators signed in from are spared from automatic blocks.', 'zenzeiten-bastion' ), $own_ip ) ); ?></p>
	</div>

	<table class="widefat striped zbst-blocks">
		<thead><tr>
			<th><?php esc_html_e( 'IP address', 'zenzeiten-bastion' ); ?></th>
			<th><?php esc_html_e( 'Source', 'zenzeiten-bastion' ); ?></th>
			<th><?php esc_html_e( 'Reason', 'zenzeiten-bastion' ); ?></th>
			<th><?php esc_html_e( 'Blocked', 'zenzeiten-bastion' ); ?></th>
			<th><?php esc_html_e( 'Until', 'zenzeiten-bastion' ); ?></th>
			<th><?php esc_html_e( 'Offences', 'zenzeiten-bastion' ); ?></th>
			<th><?php esc_html_e( 'Requests refused', 'zenzeiten-bastion' ); ?></th>
			<th></th>
		</tr></thead>
		<tbody>
		<?php if ( ! $blocks ) : ?>
			<tr><td colspan="8"><?php esc_html_e( 'No addresses are blocked right now.', 'zenzeiten-bastion' ); ?></td></tr>
		<?php endif; ?>
		<?php foreach ( $blocks as $zbst_b ) : ?>
			<tr>
				<td><a href="<?php echo esc_url( add_query_arg( array( 'page' => 'zbst-events', 'ip' => $zbst_b['ip'] ), admin_url( 'admin.php' ) ) ); ?>"><code><?php echo esc_html( $zbst_b['ip'] ); ?></code></a></td>
				<td><?php echo esc_html( isset( $zbst_sources[ $zbst_b['source'] ] ) ? $zbst_sources[ $zbst_b['source'] ] : $zbst_b['source'] ); ?></td>
				<td><?php echo esc_html( $zbst_b['reason'] ); ?></td>
				<td><?php echo esc_html( Admin::local_time( $zbst_b['created_at'] ) ); ?></td>
				<td><?php echo $zbst_b['expires_at'] ? esc_html( Admin::local_time( $zbst_b['expires_at'] ) ) : esc_html__( 'Permanent', 'zenzeiten-bastion' ); ?></td>
				<td><?php echo esc_html( (string) (int) $zbst_b['offenses'] ); ?></td>
				<td><?php echo esc_html( number_format_i18n( (int) $zbst_b['hits'] ) ); ?></td>
				<td class="zbst-actions">
					<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
						<input type="hidden" name="action" value="zbst_unblock" />
						<input type="hidden" name="ip" value="<?php echo esc_attr( $zbst_b['ip'] ); ?>" />
						<?php wp_nonce_field( 'zbst_unblock' ); ?>
						<button class="button button-small"><?php esc_html_e( 'Unblock', 'zenzeiten-bastion' ); ?></button>
					</form>
					<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
						<input type="hidden" name="action" value="zbst_forget" />
						<input type="hidden" name="id" value="<?php echo esc_attr( (string) (int) $zbst_b['id'] ); ?>" />
						<?php wp_nonce_field( 'zbst_forget' ); ?>
						<button class="button button-small button-link-delete" title="<?php esc_attr_e( 'Unblock and forget past offences', 'zenzeiten-bastion' ); ?>"><?php esc_html_e( 'Forget', 'zenzeiten-bastion' ); ?></button>
					</form>
				</td>
			</tr>
		<?php endforeach; ?>
		</tbody>
	</table>
	<p class="description">
		<?php
		/* translators: 1-4: durations */
		echo esc_html( sprintf( __( 'Automatic blocks grow longer for repeat offenders: %1$s, then %2$s, then %3$s, then %4$s.', 'zenzeiten-bastion' ), __( '1 hour', 'zenzeiten-bastion' ), __( '1 day', 'zenzeiten-bastion' ), __( '1 week', 'zenzeiten-bastion' ), __( '30 days', 'zenzeiten-bastion' ) ) );
		echo ' ';
		/* translators: %d: count of protected addresses */
		echo esc_html( sprintf( _n( '%d administrator address is protected from automatic blocks.', '%d administrator addresses are protected from automatic blocks.', count( Blocklist::admin_ips() ), 'zenzeiten-bastion' ), count( Blocklist::admin_ips() ) ) );
		?>
	</p>
</div>

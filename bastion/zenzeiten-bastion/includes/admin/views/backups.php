<?php
/**
 * Database backups.
 *
 * @package ZenZeiTenBastion
 *
 * @var array            $backups Manifests, newest first.
 * @var string|\WP_Error $dir     Backup folder.
 */

use ZenZeiTenBastion\Admin\Admin;
use ZenZeiTenBastion\Settings;

defined( 'ABSPATH' ) || exit;

$zbst_triggers = array(
	'scheduled'   => __( 'Scheduled', 'zenzeiten-bastion' ),
	'manual'      => __( 'Manual', 'zenzeiten-bastion' ),
	'pre-update'  => __( 'Before an update', 'zenzeiten-bastion' ),
	'pre-restore' => __( 'Safety (before a restore)', 'zenzeiten-bastion' ),
	'cli'         => __( 'WP-CLI', 'zenzeiten-bastion' ),
	'uploaded'    => __( 'Uploaded', 'zenzeiten-bastion' ),
);
$zbst_schedule = array(
	'daily'  => __( 'every day', 'zenzeiten-bastion' ),
	'weekly' => __( 'every week', 'zenzeiten-bastion' ),
	'off'    => __( 'never (automatic backups are off)', 'zenzeiten-bastion' ),
);
$zbst_next     = wp_next_scheduled( 'zbst_backup' );
?>
<div class="wrap zbst-wrap">
	<h1 class="wp-heading-inline"><?php esc_html_e( 'Database backups', 'zenzeiten-bastion' ); ?></h1>
	<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="zbst-heading-action">
		<input type="hidden" name="action" value="zbst_backup_now" />
		<?php wp_nonce_field( 'zbst_backup_now' ); ?>
		<button class="page-title-action"><?php esc_html_e( 'Back up now', 'zenzeiten-bastion' ); ?></button>
	</form>
	<hr class="wp-header-end" />
	<?php Admin::notice(); ?>

	<?php if ( is_wp_error( $dir ) ) : ?>
		<div class="notice notice-error"><p><?php echo esc_html( $dir->get_error_message() ); ?></p></div>
	<?php endif; ?>

	<p>
		<?php
		/* translators: 1: schedule, 2: number of backups kept */
		echo esc_html( sprintf( __( 'Automatic backups run %1$s; the newest %2$d are kept.', 'zenzeiten-bastion' ), $zbst_schedule[ Settings::get( 'backup_schedule' ) ], (int) Settings::get( 'backup_keep' ) ) );
		if ( $zbst_next ) {
			echo ' ';
			/* translators: %s: date and time */
			echo esc_html( sprintf( __( 'Next: %s.', 'zenzeiten-bastion' ), wp_date( 'Y-m-d H:i', $zbst_next ) ) );
		}
		if ( Settings::get( 'backup_before_updates' ) ) {
			echo ' ' . esc_html__( 'A backup is also taken before WordPress installs updates.', 'zenzeiten-bastion' );
		}
		?>
		<a href="<?php echo esc_url( admin_url( 'admin.php?page=zbst-settings#zbst-backups' ) ); ?>"><?php esc_html_e( 'Change', 'zenzeiten-bastion' ); ?></a>
	</p>

	<table class="widefat striped zbst-backups">
		<thead><tr>
			<th><?php esc_html_e( 'Created', 'zenzeiten-bastion' ); ?></th>
			<th><?php esc_html_e( 'Type', 'zenzeiten-bastion' ); ?></th>
			<th><?php esc_html_e( 'Tables', 'zenzeiten-bastion' ); ?></th>
			<th><?php esc_html_e( 'Rows', 'zenzeiten-bastion' ); ?></th>
			<th><?php esc_html_e( 'Size', 'zenzeiten-bastion' ); ?></th>
			<th><?php esc_html_e( 'Backup ID', 'zenzeiten-bastion' ); ?></th>
			<th></th>
		</tr></thead>
		<tbody>
		<?php if ( ! $backups ) : ?>
			<tr><td colspan="7"><?php esc_html_e( 'No backups yet. Click "Back up now" to make the first one.', 'zenzeiten-bastion' ); ?></td></tr>
		<?php endif; ?>
		<?php foreach ( $backups as $zbst_m ) : ?>
			<tr>
				<td><?php echo esc_html( wp_date( 'Y-m-d H:i', (int) $zbst_m['created'] ) ); ?></td>
				<td><?php echo esc_html( isset( $zbst_triggers[ $zbst_m['trigger'] ] ) ? $zbst_triggers[ $zbst_m['trigger'] ] : $zbst_m['trigger'] ); ?></td>
				<td><?php echo $zbst_m['tables'] ? esc_html( number_format_i18n( (int) $zbst_m['tables'] ) ) : '—'; ?></td>
				<td><?php echo $zbst_m['rows'] ? esc_html( number_format_i18n( (int) $zbst_m['rows'] ) ) : '—'; ?></td>
				<td><?php echo esc_html( size_format( (int) $zbst_m['size'], 1 ) ); ?></td>
				<td><code><?php echo esc_html( $zbst_m['id'] ); ?></code></td>
				<td class="zbst-actions">
					<a class="button button-small" href="<?php echo esc_url( Admin::action_url( 'download', array( 'id' => $zbst_m['id'] ) ) ); ?>"><?php esc_html_e( 'Download', 'zenzeiten-bastion' ); ?></a>
					<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" data-zbst-confirm="restore">
						<input type="hidden" name="action" value="zbst_restore" />
						<input type="hidden" name="id" value="<?php echo esc_attr( $zbst_m['id'] ); ?>" />
						<?php wp_nonce_field( 'zbst_restore' ); ?>
						<button class="button button-small button-primary"><?php esc_html_e( 'Restore', 'zenzeiten-bastion' ); ?></button>
					</form>
					<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" data-zbst-confirm="delete">
						<input type="hidden" name="action" value="zbst_delete_backup" />
						<input type="hidden" name="id" value="<?php echo esc_attr( $zbst_m['id'] ); ?>" />
						<?php wp_nonce_field( 'zbst_delete_backup' ); ?>
						<button class="button button-small button-link-delete"><?php esc_html_e( 'Delete', 'zenzeiten-bastion' ); ?></button>
					</form>
				</td>
			</tr>
		<?php endforeach; ?>
		</tbody>
	</table>

	<div class="zbst-panel">
		<h2><?php esc_html_e( 'Upload a backup', 'zenzeiten-bastion' ); ?></h2>
		<p class="description"><?php esc_html_e( 'Add a .sql.gz file downloaded from this plugin, for example after moving to a new server. It is checked, added to the list, and can then be restored.', 'zenzeiten-bastion' ); ?></p>
		<form method="post" enctype="multipart/form-data" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="zbst-inline-form">
			<input type="hidden" name="action" value="zbst_upload" />
			<?php wp_nonce_field( 'zbst_upload' ); ?>
			<input type="file" name="backup" accept=".gz,application/gzip" required />
			<button class="button"><?php esc_html_e( 'Upload', 'zenzeiten-bastion' ); ?></button>
		</form>
	</div>

	<div class="zbst-panel">
		<h2><?php esc_html_e( 'If the admin area stops working', 'zenzeiten-bastion' ); ?></h2>
		<p><?php esc_html_e( 'Restore from the command line with WP-CLI. A safety backup is taken first and restored automatically if anything fails:', 'zenzeiten-bastion' ); ?></p>
		<pre><code>wp bastion backups
wp bastion restore latest --yes</code></pre>
		<p class="description"><?php esc_html_e( 'Backups are stored in a private, randomly named folder inside the uploads folder. Download copies regularly and keep them somewhere else as well: a backup on the same server does not help if the server itself is lost.', 'zenzeiten-bastion' ); ?></p>
	</div>
</div>

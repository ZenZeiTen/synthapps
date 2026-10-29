<?php
/**
 * Blocklist view.
 *
 * @package VisitorSentinel
 *
 * @var \VisitorSentinel\Admin\Blocklist_Table $table Table.
 */

use VisitorSentinel\Admin\Admin;
use VisitorSentinel\Settings;

defined( 'ABSPATH' ) || exit;

$vsen_actions = array(
	'log_only'   => __( 'Blocked IPs are only recorded. Nothing changes for them on the site.', 'zenzeiten-visitor-guard' ),
	'hide_ads'   => __( 'Blocked IPs see the site but not your ads.', 'zenzeiten-visitor-guard' ),
	'block_site' => __( 'Blocked IPs get a 403 "Access restricted" page. Logged-in administrators and the login page are never blocked.', 'zenzeiten-visitor-guard' ),
);
$vsen_action  = (string) Settings::get( 'protection_action' );
?>
<div class="wrap vsen-wrap">
	<div class="vsen-header">
		<h1><?php esc_html_e( 'Blocklist', 'zenzeiten-visitor-guard' ); ?></h1>
		<div class="vsen-header__actions">
			<a class="button" href="<?php echo esc_url( Admin::action_url( 'export', array( 'what' => 'google_ads' ) ) ); ?>"><?php esc_html_e( 'Export for Google Ads', 'zenzeiten-visitor-guard' ); ?></a>
		</div>
	</div>

	<div class="vsen-grid vsen-grid--two">
		<div class="vsen-card">
			<h2><?php esc_html_e( 'Block an IP or range', 'zenzeiten-visitor-guard' ); ?></h2>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="vsen-form-inline">
				<input type="hidden" name="action" value="vsen" />
				<input type="hidden" name="do" value="add_block" />
				<?php wp_nonce_field( 'vsen_add_block' ); ?>
				<label>
					<span><?php esc_html_e( 'IP address or CIDR range', 'zenzeiten-visitor-guard' ); ?></span>
					<input type="text" name="ip" required placeholder="203.0.113.7 or 198.51.100.0/24" class="regular-text code" />
				</label>
				<label>
					<span><?php esc_html_e( 'Reason (optional)', 'zenzeiten-visitor-guard' ); ?></span>
					<input type="text" name="reason" maxlength="255" class="regular-text" />
				</label>
				<label>
					<span><?php esc_html_e( 'Expires after (days, 0 = never)', 'zenzeiten-visitor-guard' ); ?></span>
					<input type="number" name="days" min="0" max="3650" value="<?php echo esc_attr( (int) Settings::get( 'block_duration_days' ) ); ?>" class="small-text" />
				</label>
				<?php submit_button( __( 'Block', 'zenzeiten-visitor-guard' ), 'primary', 'submit', false ); ?>
			</form>
		</div>
		<div class="vsen-card">
			<h2><?php esc_html_e( 'What blocking does', 'zenzeiten-visitor-guard' ); ?></h2>
			<p><strong><?php echo esc_html( $vsen_actions[ $vsen_action ] ?? '' ); ?></strong></p>
			<p class="vsen-muted">
				<?php
				printf(
					/* translators: %s: settings link */
					esc_html__( 'Change this under %s. Automatic blocks are added when a click scores at or above the auto-block threshold.', 'zenzeiten-visitor-guard' ),
					'<a href="' . esc_url( admin_url( 'admin.php?page=vsen-settings#vsen-protection' ) ) . '">' . esc_html__( 'Settings → Protection', 'zenzeiten-visitor-guard' ) . '</a>'
				);
				?>
			</p>
			<p class="vsen-muted"><?php esc_html_e( 'Export for Google Ads downloads up to 500 entries in the format of the campaign "IP exclusions" setting. Masked IPs export as a.b.c.* ranges; IPs stored only as hashes cannot be exported.', 'zenzeiten-visitor-guard' ); ?></p>
		</div>
	</div>

	<form method="get">
		<input type="hidden" name="page" value="vsen-blocklist" />
		<?php
		$table->search_box( __( 'Search', 'zenzeiten-visitor-guard' ), 'vsen-block-search' );
		$table->display();
		?>
	</form>
</div>

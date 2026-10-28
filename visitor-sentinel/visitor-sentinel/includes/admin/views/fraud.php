<?php
/**
 * Click fraud view.
 *
 * @package VisitorSentinel
 *
 * @var \VisitorSentinel\Admin\Clicks_Table $table    Table.
 * @var array                               $networks Clicks by network, last 30 days.
 */

use VisitorSentinel\Admin\Admin;

defined( 'ABSPATH' ) || exit;
?>
<div class="wrap vsen-wrap">
	<div class="vsen-header">
		<h1><?php esc_html_e( 'Click Fraud', 'visitor-sentinel' ); ?></h1>
		<div class="vsen-header__actions">
			<a class="button" href="<?php echo esc_url( Admin::action_url( 'rescore' ) ); ?>" title="<?php esc_attr_e( 'Give clicks older than 15 minutes their final score now instead of at the next hourly run.', 'visitor-sentinel' ); ?>"><?php esc_html_e( 'Finalize pending scores', 'visitor-sentinel' ); ?></a>
			<a class="button" href="<?php echo esc_url( Admin::action_url( 'export', array( 'what' => 'clicks' ) ) ); ?>"><?php esc_html_e( 'Export CSV', 'visitor-sentinel' ); ?></a>
		</div>
	</div>

	<p class="vsen-intro">
		<?php esc_html_e( 'Every paid ad visit (gclid, msclkid, ttclid and similar, or a paid utm_medium) and every click on an ad element on your pages gets a fraud score from 0 to 100. 40 and above is suspicious, 70 and above is fraudulent. Scores are revised when engagement arrives and finalized after 15 minutes.', 'visitor-sentinel' ); ?>
	</p>

	<?php if ( ! empty( $networks ) ) : ?>
		<div class="vsen-chips">
			<?php foreach ( $networks as $vsen_row ) : ?>
				<?php $vsen_rate = (int) $vsen_row->n ? 100 * (int) $vsen_row->fraud / (int) $vsen_row->n : 0; ?>
				<div class="vsen-chip">
					<strong><?php echo esc_html( '' !== (string) $vsen_row->label ? str_replace( '_', ' ', $vsen_row->label ) : __( 'other', 'visitor-sentinel' ) ); ?></strong>
					<span>
						<?php
						/* translators: 1: clicks, 2: fraud percentage */
						echo esc_html( sprintf( __( '%1$s clicks · %2$s%% fraudulent (30 days)', 'visitor-sentinel' ), number_format_i18n( (int) $vsen_row->n ), number_format_i18n( $vsen_rate, 1 ) ) );
						?>
					</span>
				</div>
			<?php endforeach; ?>
		</div>
	<?php endif; ?>

	<?php $table->views(); ?>
	<form method="get">
		<input type="hidden" name="page" value="vsen-fraud" />
		<input type="hidden" name="view" value="<?php echo esc_attr( $table->current_filter() ); ?>" />
		<?php
		$table->search_box( __( 'Search IP, URL or network', 'visitor-sentinel' ), 'vsen-click-search' );
		$table->display();
		?>
	</form>
</div>

<?php
/**
 * Visitor list view.
 *
 * @package VisitorSentinel
 *
 * @var \VisitorSentinel\Admin\Visitors_Table $table Table.
 */

use VisitorSentinel\Admin\Admin;

defined( 'ABSPATH' ) || exit;
?>
<div class="wrap vsen-wrap">
	<div class="vsen-header">
		<h1><?php esc_html_e( 'Visitors', 'visitor-sentinel' ); ?></h1>
		<div class="vsen-header__actions">
			<a class="button" href="<?php echo esc_url( Admin::action_url( 'export', array( 'what' => 'visitors' ) ) ); ?>"><?php esc_html_e( 'Export CSV', 'visitor-sentinel' ); ?></a>
		</div>
	</div>
	<?php $table->views(); ?>
	<form method="get">
		<input type="hidden" name="page" value="vsen-visitors" />
		<?php
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$vsen_view = isset( $_GET['view'] ) ? sanitize_key( wp_unslash( $_GET['view'] ) ) : '';
		if ( '' !== $vsen_view ) {
			echo '<input type="hidden" name="view" value="' . esc_attr( $vsen_view ) . '" />';
		}
		$table->search_box( __( 'Search IP or user agent', 'visitor-sentinel' ), 'vsen-visitor-search' );
		$table->display();
		?>
	</form>
</div>

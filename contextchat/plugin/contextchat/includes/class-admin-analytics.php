<?php
/**
 * Admin: the analytics report and its CSV export.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Analytics screen.
 */
class ContextChat_Admin_Analytics {

	/** Periods the report can cover, in days. */
	const RANGES        = array( 7, 30, 90 );
	const DEFAULT_RANGE = 30;

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'admin_post_contextchat_export', array( __CLASS__, 'export' ) );
	}

	/**
	 * The period asked for in the address, or the default when it is not one we offer.
	 *
	 * @return int Days.
	 */
	private static function requested_range() {
		$days = isset( $_GET['range'] ) ? absint( $_GET['range'] ) : self::DEFAULT_RANGE; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- only picks a period; the export checks its nonce first.
		return in_array( $days, self::RANGES, true ) ? $days : self::DEFAULT_RANGE;
	}

	/**
	 * Analytics screen.
	 */
	public static function page() {
		if ( ! current_user_can( ContextChat_Admin::CAP ) ) {
			return;
		}
		$days = self::requested_range();
		$r    = ContextChat_Analytics::report( $days );
		$s    = ContextChat_Settings::get();

		$names = array( 'main' => __( 'Main number', 'contextchat' ) );
		foreach ( $s['agents'] as $agent ) {
			$names[ $agent['id'] ] = ContextChat_Settings::agent_label( $agent );
		}
		$sources = array(
			'float'     => __( 'Floating button', 'contextchat' ),
			'shortcode' => __( 'Shortcode', 'contextchat' ),
			'block'     => __( 'Block', 'contextchat' ),
			'product'   => __( 'Product button', 'contextchat' ),
		);
		$change = $r['previous'] > 0 ? round( ( $r['total'] - $r['previous'] ) / $r['previous'] * 100 ) : null;
		$max    = max( 1, max( $r['daily'] ) );
		?>
		<div class="wrap ctxc-admin">
			<h1><?php esc_html_e( 'ContextChat Analytics', 'contextchat' ); ?></h1>
			<?php if ( empty( $s['analytics'] ) ) : ?>
				<div class="notice notice-warning inline"><p><?php esc_html_e( 'Click counting is turned off in Settings → WooCommerce & advanced.', 'contextchat' ); ?></p></div>
			<?php endif; ?>

			<div class="ctxc-range">
				<?php foreach ( self::RANGES as $range ) : ?>
					<a class="button <?php echo $range === $days ? 'button-primary' : ''; ?>" href="<?php echo esc_url( add_query_arg( 'range', $range ) ); ?>" <?php echo $range === $days ? 'aria-current="page"' : ''; ?>>
						<?php echo esc_html( sprintf( /* translators: %d: number of days. */ __( 'Last %d days', 'contextchat' ), $range ) ); ?>
					</a>
				<?php endforeach; ?>
				<a class="button" href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=contextchat_export&range=' . $days ), 'contextchat_export' ) ); ?>"><?php esc_html_e( 'Export CSV', 'contextchat' ); ?></a>
			</div>

			<div class="ctxc-cards">
				<div class="ctxc-card">
					<p class="ctxc-card-label"><?php esc_html_e( 'Chats started', 'contextchat' ); ?></p>
					<p class="ctxc-card-value"><?php echo esc_html( number_format_i18n( $r['total'] ) ); ?></p>
					<?php if ( null !== $change ) : ?>
						<p class="ctxc-card-note <?php echo $change >= 0 ? 'is-up' : 'is-down'; ?>">
							<?php echo esc_html( sprintf( /* translators: 1: signed percent change, 2: days. */ __( '%1$s%% vs the previous %2$d days', 'contextchat' ), ( $change > 0 ? '+' : '' ) . $change, $days ) ); ?>
						</p>
					<?php endif; ?>
				</div>
				<div class="ctxc-card">
					<p class="ctxc-card-label"><?php esc_html_e( 'Daily average', 'contextchat' ); ?></p>
					<p class="ctxc-card-value"><?php echo esc_html( number_format_i18n( $r['total'] / $days, 1 ) ); ?></p>
				</div>
				<div class="ctxc-card">
					<p class="ctxc-card-label"><?php esc_html_e( 'From phones', 'contextchat' ); ?></p>
					<p class="ctxc-card-value">
						<?php
						$mobile = 0;
						foreach ( $r['devices'] as $row ) {
							if ( 'mobile' === $row['device'] ) {
								$mobile = (int) $row['n'];
							}
						}
						echo esc_html( $r['total'] ? round( $mobile / $r['total'] * 100 ) . '%' : '–' );
						?>
					</p>
				</div>
			</div>

			<div class="ctxc-panel-box">
				<h2><?php esc_html_e( 'Chats per day', 'contextchat' ); ?></h2>
				<div class="ctxc-chart" role="img" aria-label="<?php echo esc_attr( sprintf( /* translators: 1: total, 2: days. */ __( '%1$d chats over %2$d days', 'contextchat' ), $r['total'], $days ) ); ?>">
					<?php foreach ( $r['daily'] as $date => $n ) : ?>
						<span class="ctxc-bar" style="<?php echo esc_attr( 'height:' . max( 2, round( $n / $max * 100 ) ) . '%' ); ?>" title="<?php echo esc_attr( date_i18n( get_option( 'date_format' ), strtotime( $date ) ) . ': ' . $n ); ?>"></span>
					<?php endforeach; ?>
				</div>
			</div>

			<div class="ctxc-grid">
				<div class="ctxc-panel-box">
					<h2><?php esc_html_e( 'Top pages', 'contextchat' ); ?></h2>
					<?php if ( $r['pages'] ) : ?>
						<table class="widefat striped">
							<thead><tr><th><?php esc_html_e( 'Page', 'contextchat' ); ?></th><th class="num"><?php esc_html_e( 'Chats', 'contextchat' ); ?></th></tr></thead>
							<tbody>
								<?php foreach ( $r['pages'] as $row ) : ?>
									<?php $title = $row['post_id'] ? get_the_title( (int) $row['post_id'] ) : ''; ?>
									<tr>
										<td><?php echo esc_html( '' !== $title ? $title : $row['path'] ); ?><br><code><?php echo esc_html( $row['path'] ); ?></code></td>
										<td class="num"><?php echo esc_html( number_format_i18n( (int) $row['n'] ) ); ?></td>
									</tr>
								<?php endforeach; ?>
							</tbody>
						</table>
					<?php else : ?>
						<p><?php esc_html_e( 'No chats yet in this period.', 'contextchat' ); ?></p>
					<?php endif; ?>
				</div>
				<div class="ctxc-panel-box">
					<h2><?php esc_html_e( 'By agent', 'contextchat' ); ?></h2>
					<?php self::share_list( $r['agents'], 'agent', $names, $r['total'] ); ?>
					<h2><?php esc_html_e( 'By button', 'contextchat' ); ?></h2>
					<?php self::share_list( $r['sources'], 'source', $sources, $r['total'] ); ?>
				</div>
			</div>
		</div>
		<?php
	}

	/**
	 * A list of shares with bars.
	 *
	 * @param array  $rows  Rows with a key column and n.
	 * @param string $col   Key column.
	 * @param array  $names Display names.
	 * @param int    $total Total for percentages.
	 */
	private static function share_list( array $rows, $col, array $names, $total ) {
		if ( ! $rows ) {
			echo '<p>' . esc_html__( 'No data yet.', 'contextchat' ) . '</p>';
			return;
		}
		echo '<ul class="ctxc-shares">';
		foreach ( $rows as $row ) {
			$key   = (string) $row[ $col ];
			$label = isset( $names[ $key ] ) ? $names[ $key ] : ( '' !== $key ? $key : __( 'Unknown', 'contextchat' ) );
			$pct   = $total ? round( (int) $row['n'] / $total * 100 ) : 0;
			printf(
				'<li><span class="ctxc-share-label">%1$s</span><span class="ctxc-share-n">%2$s</span><span class="ctxc-share-bar"><span style="%3$s"></span></span></li>',
				esc_html( $label ),
				esc_html( number_format_i18n( (int) $row['n'] ) . ' · ' . $pct . '%' ),
				esc_attr( 'width:' . $pct . '%' )
			);
		}
		echo '</ul>';
	}

	/**
	 * Download clicks as CSV.
	 */
	public static function export() {
		if ( ! current_user_can( ContextChat_Admin::CAP ) ) {
			wp_die( esc_html__( 'You are not allowed to export this data.', 'contextchat' ), 403 );
		}
		check_admin_referer( 'contextchat_export' );
		$days = self::requested_range();

		nocache_headers();
		header( 'Content-Type: text/csv; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename=contextchat-clicks-' . gmdate( 'Y-m-d' ) . '.csv' );

		$out = fopen( 'php://output', 'w' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fopen
		fputcsv( $out, array( 'time_utc', 'post_id', 'path', 'agent', 'rule', 'source', 'device' ) );
		foreach ( ContextChat_Analytics::rows( $days ) as $row ) {
			// Neutralise spreadsheet formulas in text cells.
			$row = array_map(
				static function ( $v ) {
					return preg_match( '/^[=+\-@\t\r]/', (string) $v ) ? "'" . $v : $v;
				},
				$row
			);
			fputcsv( $out, $row );
		}
		fclose( $out ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose
		exit;
	}
}

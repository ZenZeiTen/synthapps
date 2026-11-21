<?php
/**
 * Admin: the SI conversations, with a transcript view, a JSON export and delete.
 *
 * Only administrators (manage_options) see this screen. Message text is shown escaped and is
 * never sent anywhere from here.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Conversations screen.
 */
class ContextChat_Admin_Conversations {

	/** Screen slug. */
	const SLUG = 'contextchat-conversations';

	/** Conversation statuses. */
	const STATUSES = array( 'open', 'quoted', 'limited', 'handed_off' );

	/** Rows per page. */
	const PER_PAGE = 20;

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'admin_post_contextchat_conversation_export', array( __CLASS__, 'export' ) );
		add_action( 'admin_post_contextchat_conversation_delete', array( __CLASS__, 'delete' ) );
	}

	/**
	 * Screen address.
	 *
	 * @param array $args Query arguments.
	 * @return string
	 */
	public static function url( array $args = array() ) {
		return add_query_arg( $args, admin_url( 'admin.php?page=' . self::SLUG ) );
	}

	/**
	 * Filters from the address, cleaned.
	 *
	 * @return array status, service, from, to, reference, paged.
	 */
	private static function filters() {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- read-only filters on an admin screen.
		$get    = wp_unslash( $_GET );
		$status = isset( $get['status'] ) ? sanitize_key( $get['status'] ) : '';
		$serv   = isset( $get['service'] ) ? sanitize_key( $get['service'] ) : '';
		$date   = function ( $key ) use ( $get ) {
			$v = isset( $get[ $key ] ) ? (string) $get[ $key ] : '';
			return preg_match( '/^\d{4}-\d{2}-\d{2}$/', $v ) ? $v : '';
		};
		$ref    = isset( $get['reference'] ) ? strtoupper( preg_replace( '/[^A-Za-z0-9-]/', '', (string) $get['reference'] ) ) : '';
		// phpcs:enable
		return array(
			'status'    => in_array( $status, self::STATUSES, true ) ? $status : '',
			'service'   => in_array( $serv, array( 'translation', 'interpreting', 'none' ), true ) ? $serv : '',
			'from'      => $date( 'from' ),
			'to'        => $date( 'to' ),
			'reference' => substr( $ref, 0, 24 ),
			'paged'     => isset( $get['paged'] ) ? max( 1, absint( $get['paged'] ) ) : 1,
		);
	}

	/**
	 * A UTC database time in the site's time zone.
	 *
	 * @param string $utc Y-m-d H:i:s in UTC.
	 * @return string
	 */
	private static function local( $utc ) {
		return get_date_from_gmt( (string) $utc, get_option( 'date_format' ) . ' ' . get_option( 'time_format' ) );
	}

	/**
	 * Status label.
	 *
	 * @param string $status Status.
	 * @return string
	 */
	private static function status_label( $status ) {
		$labels = array(
			'open'       => __( 'Open', 'contextchat' ),
			'quoted'     => __( 'Estimate given', 'contextchat' ),
			'limited'    => __( 'Reached the message limit', 'contextchat' ),
			'handed_off' => __( 'Handed to the team', 'contextchat' ),
		);
		return isset( $labels[ $status ] ) ? $labels[ $status ] : (string) $status;
	}

	/**
	 * Service label.
	 *
	 * @param string $service Service.
	 * @return string
	 */
	private static function service_label( $service ) {
		$labels = array(
			'translation'  => __( 'Translation', 'contextchat' ),
			'interpreting' => __( 'Interpreting', 'contextchat' ),
		);
		return isset( $labels[ $service ] ) ? $labels[ $service ] : '—';
	}

	/**
	 * The screen: one transcript, or the list.
	 */
	public static function page() {
		if ( ! current_user_can( ContextChat_Admin::CAP ) ) {
			return;
		}
		$view = isset( $_GET['view'] ) ? sanitize_text_field( wp_unslash( $_GET['view'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only.
		echo '<div class="wrap ctxc-admin ctxc-conversations">';
		if ( isset( $_GET['deleted'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- notice only.
			echo '<div class="notice notice-success is-dismissible"><p>' . esc_html__( 'The conversation was deleted.', 'contextchat' ) . '</p></div>';
		}
		if ( '' !== $view ) {
			self::transcript( $view );
		} else {
			self::listing();
		}
		echo '</div>';
	}

	/**
	 * The list with its filters.
	 */
	private static function listing() {
		$f      = self::filters();
		$result = ContextChat_Chat_Store::search( $f, $f['paged'], self::PER_PAGE );
		$pages  = max( 1, (int) ceil( $result['total'] / self::PER_PAGE ) );
		?>
		<h1><?php esc_html_e( 'SI conversations', 'contextchat' ); ?></h1>
		<p>
			<?php
			printf(
				/* translators: %d: number of days. */
				esc_html__( 'Chats with the SI assistant. Each one is deleted %d days after it started (Settings → Privacy).', 'contextchat' ),
				(int) ContextChat_Chat_REST::retention_days()
			);
			?>
		</p>
		<form method="get" class="ctxc-conv-filters">
			<input type="hidden" name="page" value="<?php echo esc_attr( self::SLUG ); ?>">
			<label for="ctxc-conv-ref"><?php esc_html_e( 'Reference', 'contextchat' ); ?></label>
			<input type="search" id="ctxc-conv-ref" name="reference" value="<?php echo esc_attr( $f['reference'] ); ?>" placeholder="CC-">
			<label for="ctxc-conv-status"><?php esc_html_e( 'Status', 'contextchat' ); ?></label>
			<select id="ctxc-conv-status" name="status">
				<option value=""><?php esc_html_e( 'All', 'contextchat' ); ?></option>
				<?php foreach ( self::STATUSES as $st ) : ?>
					<option value="<?php echo esc_attr( $st ); ?>" <?php selected( $f['status'], $st ); ?>><?php echo esc_html( self::status_label( $st ) ); ?></option>
				<?php endforeach; ?>
			</select>
			<label for="ctxc-conv-service"><?php esc_html_e( 'Service', 'contextchat' ); ?></label>
			<select id="ctxc-conv-service" name="service">
				<option value=""><?php esc_html_e( 'All', 'contextchat' ); ?></option>
				<option value="translation" <?php selected( $f['service'], 'translation' ); ?>><?php esc_html_e( 'Translation', 'contextchat' ); ?></option>
				<option value="interpreting" <?php selected( $f['service'], 'interpreting' ); ?>><?php esc_html_e( 'Interpreting', 'contextchat' ); ?></option>
				<option value="none" <?php selected( $f['service'], 'none' ); ?>><?php esc_html_e( 'Not known yet', 'contextchat' ); ?></option>
			</select>
			<label for="ctxc-conv-from"><?php esc_html_e( 'From', 'contextchat' ); ?></label>
			<input type="date" id="ctxc-conv-from" name="from" value="<?php echo esc_attr( $f['from'] ); ?>">
			<label for="ctxc-conv-to"><?php esc_html_e( 'To', 'contextchat' ); ?></label>
			<input type="date" id="ctxc-conv-to" name="to" value="<?php echo esc_attr( $f['to'] ); ?>">
			<button type="submit" class="button"><?php esc_html_e( 'Filter', 'contextchat' ); ?></button>
		</form>
		<p class="description"><?php esc_html_e( 'Dates are in UTC.', 'contextchat' ); ?></p>

		<table class="widefat striped ctxc-conv-table">
			<thead>
				<tr>
					<th scope="col"><?php esc_html_e( 'Reference', 'contextchat' ); ?></th>
					<th scope="col"><?php esc_html_e( 'Started', 'contextchat' ); ?></th>
					<th scope="col"><?php esc_html_e( 'Status', 'contextchat' ); ?></th>
					<th scope="col"><?php esc_html_e( 'Service', 'contextchat' ); ?></th>
					<th scope="col"><?php esc_html_e( 'Visitor messages', 'contextchat' ); ?></th>
					<th scope="col"><?php esc_html_e( 'Language', 'contextchat' ); ?></th>
					<th scope="col"><?php esc_html_e( 'Device', 'contextchat' ); ?></th>
				</tr>
			</thead>
			<tbody>
				<?php if ( ! $result['rows'] ) : ?>
					<tr><td colspan="7"><?php esc_html_e( 'No conversations found.', 'contextchat' ); ?></td></tr>
				<?php endif; ?>
				<?php foreach ( $result['rows'] as $row ) : ?>
					<tr>
						<td><a href="<?php echo esc_url( self::url( array( 'view' => $row['id'] ) ) ); ?>"><strong><?php echo esc_html( $row['reference'] ); ?></strong></a></td>
						<td><?php echo esc_html( self::local( $row['created_at'] ) ); ?></td>
						<td><?php echo esc_html( self::status_label( $row['status'] ) ); ?></td>
						<td><?php echo esc_html( self::service_label( $row['service'] ) ); ?></td>
						<td><?php echo (int) $row['visitor_messages']; ?></td>
						<td><?php echo esc_html( strtoupper( (string) $row['lang'] ) ); ?></td>
						<td><?php echo esc_html( (string) $row['device'] ); ?></td>
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
							'current' => $f['paged'],
							'total'   => $pages,
						)
					)
				);
				?>
			</div></div>
		<?php endif; ?>
		<?php
	}

	/**
	 * One conversation: summary, messages, estimates, export and delete.
	 *
	 * @param string $id Conversation ID.
	 */
	private static function transcript( $id ) {
		$data = ContextChat_Chat_Store::full( $id );
		echo '<p><a href="' . esc_url( self::url() ) . '">&larr; ' . esc_html__( 'All conversations', 'contextchat' ) . '</a></p>';
		if ( ! $data ) {
			echo '<h1>' . esc_html__( 'Conversation not found', 'contextchat' ) . '</h1>';
			echo '<p>' . esc_html__( 'It may have been deleted, or its keep-for period has ended.', 'contextchat' ) . '</p>';
			return;
		}
		$c     = $data['conversation'];
		$state = $c['state'];
		$roles = array(
			'visitor'         => __( 'Visitor', 'contextchat' ),
			'assistant'       => __( 'SI assistant', 'contextchat' ),
			'system_template' => __( 'Fixed reply', 'contextchat' ),
		);
		$site  = ContextChat_Chat_REST::business_name();
		?>
		<h1>
			<?php
			/* translators: %s: conversation reference. */
			printf( esc_html__( 'Conversation %s', 'contextchat' ), esc_html( $c['reference'] ) );
			?>
		</h1>
		<table class="form-table ctxc-conv-meta" role="presentation">
			<tr><th scope="row"><?php esc_html_e( 'Started', 'contextchat' ); ?></th><td><?php echo esc_html( self::local( $c['created_at'] ) ); ?></td></tr>
			<tr><th scope="row"><?php esc_html_e( 'Last activity', 'contextchat' ); ?></th><td><?php echo esc_html( self::local( $c['updated_at'] ) ); ?></td></tr>
			<tr><th scope="row"><?php esc_html_e( 'Deleted on', 'contextchat' ); ?></th><td><?php echo esc_html( self::local( $c['expires_at'] ) ); ?></td></tr>
			<tr><th scope="row"><?php esc_html_e( 'Status', 'contextchat' ); ?></th><td><?php echo esc_html( self::status_label( $c['status'] ) . ( '' !== $c['handoff_channel'] ? ' (' . $c['handoff_channel'] . ')' : '' ) ); ?></td></tr>
			<tr><th scope="row"><?php esc_html_e( 'Service', 'contextchat' ); ?></th><td><?php echo esc_html( self::service_label( $c['service'] ) ); ?></td></tr>
			<tr><th scope="row"><?php esc_html_e( 'Page', 'contextchat' ); ?></th><td><?php echo esc_html( (string) $c['page_url'] ); ?></td></tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Model cost', 'contextchat' ); ?></th>
				<td>
					<?php
					/* translators: 1: cost in US dollars, 2: input tokens, 3: output tokens. */
					printf( esc_html__( '$%1$s (%2$s input and %3$s output tokens)', 'contextchat' ), esc_html( number_format_i18n( (int) $c['cost_micro_usd'] / 1000000, 4 ) ), esc_html( number_format_i18n( (int) $c['tokens_in'] ) ), esc_html( number_format_i18n( (int) $c['tokens_out'] ) ) );
					?>
				</td>
			</tr>
		</table>

		<h2><?php esc_html_e( 'Summary for the team', 'contextchat' ); ?></h2>
		<pre class="ctxc-conv-summary"><?php echo esc_html( ContextChat_Handoff::summary( $state + ContextChat_Orchestrator::new_state( $c['lang'], '' ), $c['lang'], $site ) ); ?></pre>

		<h2><?php esc_html_e( 'Messages', 'contextchat' ); ?></h2>
		<ol class="ctxc-conv-messages">
			<?php foreach ( $data['messages'] as $m ) : ?>
				<li class="ctxc-conv-msg is-<?php echo esc_attr( sanitize_html_class( $m['role'] ) ); ?>">
					<p class="ctxc-conv-who"><strong><?php echo esc_html( isset( $roles[ $m['role'] ] ) ? $roles[ $m['role'] ] : $m['role'] ); ?></strong> · <?php echo esc_html( self::local( $m['created_at'] ) ); ?><?php echo '' !== $m['model'] ? ' · ' . esc_html( $m['model'] ) : ''; ?></p>
					<div class="ctxc-conv-text"><?php echo nl2br( esc_html( $m['content'] ) ); ?></div>
				</li>
			<?php endforeach; ?>
		</ol>

		<?php if ( $data['quotes'] ) : ?>
			<h2><?php esc_html_e( 'Estimates', 'contextchat' ); ?></h2>
			<table class="widefat striped">
				<thead><tr>
					<th scope="col"><?php esc_html_e( 'Reference', 'contextchat' ); ?></th>
					<th scope="col"><?php esc_html_e( 'Total', 'contextchat' ); ?></th>
					<th scope="col"><?php esc_html_e( 'Price table', 'contextchat' ); ?></th>
					<th scope="col"><?php esc_html_e( 'Made', 'contextchat' ); ?></th>
				</tr></thead>
				<tbody>
					<?php foreach ( $data['quotes'] as $q ) : ?>
						<tr>
							<td><?php echo esc_html( $q['reference'] ); ?></td>
							<td><?php echo esc_html( ContextChat_Prompt::rp( (int) $q['total'] ) ); ?></td>
							<td><?php echo esc_html( $q['table_version'] ); ?></td>
							<td><?php echo esc_html( self::local( $q['created_at'] ) ); ?></td>
						</tr>
					<?php endforeach; ?>
				</tbody>
			</table>
		<?php endif; ?>

		<?php if ( $data['events'] ) : ?>
			<h2><?php esc_html_e( 'Processing record', 'contextchat' ); ?></h2>
			<p class="description"><?php esc_html_e( 'What happened in this chat, without message text: consent, refused messages, estimates and handoffs. It is part of the export.', 'contextchat' ); ?></p>
			<table class="widefat striped ctxc-conv-events">
				<thead><tr>
					<th scope="col"><?php esc_html_e( 'Time', 'contextchat' ); ?></th>
					<th scope="col"><?php esc_html_e( 'Event', 'contextchat' ); ?></th>
					<th scope="col"><?php esc_html_e( 'Detail', 'contextchat' ); ?></th>
				</tr></thead>
				<tbody>
					<?php foreach ( $data['events'] as $e ) : ?>
						<tr>
							<td><?php echo esc_html( self::local( $e['created_at'] ) ); ?></td>
							<td><?php echo esc_html( 'consent' === $e['type'] ? __( 'Agreed to the privacy notice', 'contextchat' ) : $e['type'] ); ?></td>
							<td><code><?php echo esc_html( $e['detail'] ); ?></code></td>
						</tr>
					<?php endforeach; ?>
				</tbody>
			</table>
		<?php endif; ?>

		<h2><?php esc_html_e( 'Export or delete', 'contextchat' ); ?></h2>
		<p><?php esc_html_e( 'Use the export to answer a visitor who asks for a copy of their data, and delete when they ask you to remove it. Under Indonesia\'s data protection rules (UU 27/2022 and PP 33/2026), check that the request comes from the person in the chat, answer within 3 × 24 hours, and tell them when the deletion is done. The deletion itself is logged by reference only.', 'contextchat' ); ?></p>
		<p class="ctxc-conv-actions">
			<a class="button" href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=contextchat_conversation_export&id=' . rawurlencode( $c['id'] ) ), 'contextchat_conversation_export_' . $c['id'] ) ); ?>"><?php esc_html_e( 'Export JSON', 'contextchat' ); ?></a>
		</p>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="ctxc-conv-delete">
			<input type="hidden" name="action" value="contextchat_conversation_delete">
			<input type="hidden" name="id" value="<?php echo esc_attr( $c['id'] ); ?>">
			<?php wp_nonce_field( 'contextchat_conversation_delete_' . $c['id'] ); ?>
			<label><input type="checkbox" name="confirm" value="1" required> <?php esc_html_e( 'I want to delete this conversation, its messages and its estimates for good.', 'contextchat' ); ?></label>
			<p><button type="submit" class="button button-link-delete"><?php esc_html_e( 'Delete conversation', 'contextchat' ); ?></button></p>
		</form>
		<?php
	}

	/**
	 * Download one conversation as JSON: the conversation, its messages and its estimates.
	 */
	public static function export() {
		$id = isset( $_GET['id'] ) ? sanitize_text_field( wp_unslash( $_GET['id'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- checked next.
		check_admin_referer( 'contextchat_conversation_export_' . $id );
		if ( ! current_user_can( ContextChat_Admin::CAP ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'contextchat' ), 403 );
		}
		$data = ContextChat_Chat_Store::full( $id );
		if ( ! $data ) {
			wp_die( esc_html__( 'Conversation not found.', 'contextchat' ), 404 );
		}
		$data = array( 'exported_at' => gmdate( 'c' ) ) + $data;
		nocache_headers();
		header( 'Content-Type: application/json; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename="contextchat-' . sanitize_file_name( $data['conversation']['reference'] ) . '.json"' );
		header( 'X-Content-Type-Options: nosniff' );
		echo wp_json_encode( $data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- JSON download.
		exit;
	}

	/**
	 * Delete one conversation.
	 */
	public static function delete() {
		$id = isset( $_POST['id'] ) ? sanitize_text_field( wp_unslash( $_POST['id'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Missing -- checked next.
		check_admin_referer( 'contextchat_conversation_delete_' . $id );
		if ( ! current_user_can( ContextChat_Admin::CAP ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'contextchat' ), 403 );
		}
		if ( empty( $_POST['confirm'] ) ) {
			wp_safe_redirect( self::url( array( 'view' => $id ) ) );
			exit;
		}
		ContextChat_Chat_Store::delete( $id );
		wp_safe_redirect( self::url( array( 'deleted' => 1 ) ) );
		exit;
	}
}

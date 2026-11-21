<?php
/**
 * Chat store: conversations, messages, quotes and events in the tables from
 * ContextChat_Installer. Every query goes through $wpdb->prepare.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Database access for the SI chat.
 */
class ContextChat_Chat_Store {

	/** Default days a conversation is kept (D-06); the Privacy tab can change it. */
	const RETENTION_DAYS = 365;

	/**
	 * Days a conversation is kept: the Privacy tab's setting.
	 *
	 * @return int
	 */
	public static function retention_days() {
		return class_exists( 'ContextChat_Chat_REST' ) ? ContextChat_Chat_REST::retention_days() : self::RETENTION_DAYS;
	}

	/**
	 * Create a conversation. Returns its ID, reference and the token, which is only ever returned
	 * here; the database keeps its SHA-256.
	 *
	 * @param array $fields lang, page_url, rule_id, device, state.
	 * @return array { id, reference, token }
	 */
	public function create_conversation( array $fields ) {
		global $wpdb;
		$id    = ContextChat_Installer::ulid();
		$token = bin2hex( random_bytes( 32 ) );
		$now   = time();
		for ( $i = 0; $i < 5; $i++ ) {
			$reference = ContextChat_Price_Engine::reference( gmdate( 'Ymd', $now ), 'CC' );
			$ok        = $wpdb->insert( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
				ContextChat_Installer::table( 'conversations' ),
				array(
					'id'          => $id,
					'token_hash'  => hash( 'sha256', $token ),
					'reference'   => $reference,
					'created_at'  => gmdate( 'Y-m-d H:i:s', $now ),
					'updated_at'  => gmdate( 'Y-m-d H:i:s', $now ),
					'expires_at'  => gmdate( 'Y-m-d H:i:s', $now + self::retention_days() * 86400 ),
					'lang'        => substr( (string) $fields['lang'], 0, 5 ),
					'page_url'    => substr( (string) $fields['page_url'], 0, 500 ),
					'rule_id'     => substr( (string) $fields['rule_id'], 0, 64 ),
					'device'      => substr( (string) $fields['device'], 0, 10 ),
					'status'      => 'open',
					'intake_json' => wp_json_encode( $fields['state'] ),
				)
			);
			if ( $ok ) {
				return array(
					'id'        => $id,
					'reference' => $reference,
					'token'     => $token,
				);
			}
		}
		return array();
	}

	/**
	 * A conversation by ID and token, or null. The token is compared in constant time.
	 *
	 * @param string $id    Conversation ID.
	 * @param string $token Token.
	 * @return array|null Row with 'state' decoded.
	 */
	public function find( $id, $token ) {
		global $wpdb;
		if ( ! preg_match( '/^[0-9A-HJKMNP-TV-Z]{26}$/', (string) $id ) || ! preg_match( '/^[0-9a-f]{64}$/', (string) $token ) ) {
			return null;
		}
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM %i WHERE id = %s', ContextChat_Installer::table( 'conversations' ), $id ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		if ( ! $row || ! hash_equals( $row['token_hash'], hash( 'sha256', $token ) ) || strcmp( $row['expires_at'], gmdate( 'Y-m-d H:i:s' ) ) <= 0 ) {
			return null;
		}
		$state        = json_decode( (string) $row['intake_json'], true );
		$row['state'] = is_array( $state ) ? $state : array();
		return $row;
	}

	/**
	 * Update a conversation. state is encoded; tokens and cost are added to the totals.
	 *
	 * @param string $id     Conversation ID.
	 * @param array  $fields state, status, service, lang, handoff_reason, handoff_channel, tokens_in, tokens_out, cost_micro_usd.
	 */
	public function update_conversation( $id, array $fields ) {
		global $wpdb;
		$table = ContextChat_Installer::table( 'conversations' );
		$set   = array( 'updated_at' => gmdate( 'Y-m-d H:i:s' ) );
		if ( isset( $fields['state'] ) ) {
			$set['intake_json'] = wp_json_encode( $fields['state'] );
		}
		foreach ( array( 'status', 'service', 'lang', 'handoff_reason', 'handoff_channel' ) as $key ) {
			if ( isset( $fields[ $key ] ) && '' !== $fields[ $key ] ) {
				$set[ $key ] = substr( (string) $fields[ $key ], 0, 'lang' === $key ? 5 : 20 );
			}
		}
		$wpdb->update( $table, $set, array( 'id' => $id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		$in   = isset( $fields['tokens_in'] ) ? (int) $fields['tokens_in'] : 0;
		$tout = isset( $fields['tokens_out'] ) ? (int) $fields['tokens_out'] : 0;
		$cost = isset( $fields['cost_micro_usd'] ) ? (int) $fields['cost_micro_usd'] : 0;
		if ( $in || $tout || $cost ) {
			$wpdb->query( $wpdb->prepare( 'UPDATE %i SET tokens_in = tokens_in + %d, tokens_out = tokens_out + %d, cost_micro_usd = cost_micro_usd + %d WHERE id = %s', $table, $in, $tout, $cost, $id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		}
	}

	/**
	 * Add a message.
	 *
	 * @param string $conv_id Conversation ID.
	 * @param string $role    visitor, assistant or system_template.
	 * @param string $content Text.
	 * @param string $model   Model that wrote it.
	 */
	public function add_message( $conv_id, $role, $content, $model ) {
		global $wpdb;
		$wpdb->insert( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			ContextChat_Installer::table( 'messages' ),
			array(
				'conversation_id' => $conv_id,
				'role'            => substr( (string) $role, 0, 16 ),
				'content'         => (string) $content,
				'model'           => substr( (string) $model, 0, 40 ),
				'created_at'      => gmdate( 'Y-m-d H:i:s' ),
			)
		);
	}

	/**
	 * The last messages, oldest first.
	 *
	 * @param string $conv_id Conversation ID.
	 * @param int    $limit   How many.
	 * @return array List of { role, content, created_at }.
	 */
	public function recent_messages( $conv_id, $limit ) {
		global $wpdb;
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT role, content, created_at FROM %i WHERE conversation_id = %s ORDER BY id DESC LIMIT %d', ContextChat_Installer::table( 'messages' ), $conv_id, (int) $limit ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		return array_reverse( is_array( $rows ) ? $rows : array() );
	}

	/**
	 * Save a quote.
	 *
	 * @param string $conv_id Conversation ID.
	 * @param array  $result  Price engine result.
	 * @param array  $input   What was asked.
	 */
	public function add_quote( $conv_id, array $result, array $input ) {
		global $wpdb;
		$wpdb->insert( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			ContextChat_Installer::table( 'quotes' ),
			array(
				'conversation_id' => $conv_id,
				'reference'       => $result['reference'],
				'input_json'      => wp_json_encode( $input ),
				'result_json'     => wp_json_encode( $result ),
				'total'           => (int) $result['total'],
				'table_version'   => substr( (string) $result['table_version'], 0, 20 ),
				'created_at'      => gmdate( 'Y-m-d H:i:s' ),
			)
		);
	}

	/**
	 * Log an event. No message text goes here.
	 *
	 * @param string|null $conv_id Conversation ID, or null.
	 * @param string      $type    Event type.
	 * @param string      $detail  Short detail.
	 */
	public function add_event( $conv_id, $type, $detail ) {
		global $wpdb;
		$wpdb->insert( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			ContextChat_Installer::table( 'events' ),
			array(
				'conversation_id' => $conv_id,
				'type'            => substr( (string) $type, 0, 30 ),
				'detail'          => substr( (string) $detail, 0, 64 ),
				'created_at'      => gmdate( 'Y-m-d H:i:s' ),
			)
		);
	}

	/**
	 * Conversations for the admin list, newest first. Messages are not read here.
	 *
	 * @param array $filters status, service, from, to (Y-m-d, UTC), reference.
	 * @param int   $page    Page, from 1.
	 * @param int   $per     Rows per page.
	 * @return array { rows, total }
	 */
	public static function search( array $filters, $page, $per ) {
		global $wpdb;
		$where = array( '1=1' );
		$args  = array( ContextChat_Installer::table( 'conversations' ) );
		if ( ! empty( $filters['status'] ) ) {
			$where[] = 'status = %s';
			$args[]  = (string) $filters['status'];
		}
		if ( isset( $filters['service'] ) && '' !== $filters['service'] ) {
			$where[] = 'service = %s';
			$args[]  = 'none' === $filters['service'] ? '' : (string) $filters['service'];
		}
		if ( ! empty( $filters['from'] ) ) {
			$where[] = 'created_at >= %s';
			$args[]  = $filters['from'] . ' 00:00:00';
		}
		if ( ! empty( $filters['to'] ) ) {
			$where[] = 'created_at <= %s';
			$args[]  = $filters['to'] . ' 23:59:59';
		}
		if ( ! empty( $filters['reference'] ) ) {
			$where[] = 'reference LIKE %s';
			$args[]  = '%' . $wpdb->esc_like( (string) $filters['reference'] ) . '%';
		}
		$sql   = implode( ' AND ', $where );
		$total = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM %i WHERE {$sql}", $args ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- fixed conditions with placeholders.
		$rows  = $wpdb->get_results( $wpdb->prepare( "SELECT id, reference, created_at, updated_at, expires_at, lang, page_url, device, status, service, handoff_channel, handoff_reason, cost_micro_usd, (SELECT COUNT(*) FROM %i m WHERE m.conversation_id = c.id AND m.role = 'visitor') AS visitor_messages FROM %i c WHERE {$sql} ORDER BY created_at DESC, id DESC LIMIT %d OFFSET %d", array_merge( array( ContextChat_Installer::table( 'messages' ) ), $args, array( (int) $per, max( 0, ( (int) $page - 1 ) * (int) $per ) ) ) ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- fixed conditions with placeholders.
		return array(
			'rows'  => is_array( $rows ) ? $rows : array(),
			'total' => $total,
		);
	}

	/**
	 * One conversation with all its messages and quotes, for the administrator. The token hash
	 * is left out.
	 *
	 * @param string $id Conversation ID.
	 * @return array|null { conversation, messages, quotes }
	 */
	public static function full( $id ) {
		global $wpdb;
		if ( ! preg_match( '/^[0-9A-HJKMNP-TV-Z]{26}$/', (string) $id ) ) {
			return null;
		}
		$conv = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM %i WHERE id = %s', ContextChat_Installer::table( 'conversations' ), $id ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		if ( ! $conv ) {
			return null;
		}
		unset( $conv['token_hash'] );
		$state         = json_decode( (string) $conv['intake_json'], true );
		$conv['state'] = is_array( $state ) ? $state : array();
		unset( $conv['intake_json'] );
		$messages = $wpdb->get_results( $wpdb->prepare( 'SELECT role, content, model, created_at FROM %i WHERE conversation_id = %s ORDER BY id ASC', ContextChat_Installer::table( 'messages' ), $id ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		$quotes   = $wpdb->get_results( $wpdb->prepare( 'SELECT reference, input_json, result_json, total, table_version, created_at FROM %i WHERE conversation_id = %s ORDER BY id ASC', ContextChat_Installer::table( 'quotes' ), $id ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		foreach ( (array) $quotes as $k => $q ) {
			$quotes[ $k ]['input']  = json_decode( (string) $q['input_json'], true );
			$quotes[ $k ]['result'] = json_decode( (string) $q['result_json'], true );
			unset( $quotes[ $k ]['input_json'], $quotes[ $k ]['result_json'] );
		}
		// The processing record (UU 27/2022 Pasal 32): what happened, without message text.
		$events = $wpdb->get_results( $wpdb->prepare( 'SELECT type, detail, created_at FROM %i WHERE conversation_id = %s ORDER BY id ASC', ContextChat_Installer::table( 'events' ), $id ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		return array(
			'conversation' => $conv,
			'messages'     => is_array( $messages ) ? $messages : array(),
			'quotes'       => is_array( $quotes ) ? $quotes : array(),
			'events'       => is_array( $events ) ? $events : array(),
		);
	}

	/**
	 * Delete one conversation with its messages, quotes and events.
	 *
	 * @param string $id Conversation ID.
	 * @return bool Whether it existed.
	 */
	public static function delete( $id ) {
		global $wpdb;
		if ( ! preg_match( '/^[0-9A-HJKMNP-TV-Z]{26}$/', (string) $id ) ) {
			return false;
		}
		$reference = $wpdb->get_var( $wpdb->prepare( 'SELECT reference FROM %i WHERE id = %s', ContextChat_Installer::table( 'conversations' ), $id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		if ( null === $reference ) {
			return false;
		}
		foreach ( array( 'messages', 'quotes', 'events' ) as $name ) {
			$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE conversation_id = %s', ContextChat_Installer::table( $name ), $id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		}
		$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE id = %s', ContextChat_Installer::table( 'conversations' ), $id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		// A record that the deletion was done, with the reference only (PP 33/2026 Pasal 86).
		$wpdb->insert( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			ContextChat_Installer::table( 'events' ),
			array(
				'conversation_id' => null,
				'type'            => 'admin_deleted',
				'detail'          => substr( (string) $reference, 0, 64 ),
				'created_at'      => gmdate( 'Y-m-d H:i:s' ),
			)
		);
		return true;
	}

	/**
	 * Delete conversations past their expiry date, with their messages, quotes and events, in
	 * batches of 500 (design plan section 10). Runs with the daily clean-up.
	 *
	 * @param int $max_batches Batches per run.
	 * @return int Conversations deleted.
	 */
	public static function prune( $max_batches = 20 ) {
		global $wpdb;
		$now     = gmdate( 'Y-m-d H:i:s' );
		$deleted = 0;
		for ( $b = 0; $b < $max_batches; $b++ ) {
			$ids = $wpdb->get_col( $wpdb->prepare( 'SELECT id FROM %i WHERE expires_at <= %s LIMIT 500', ContextChat_Installer::table( 'conversations' ), $now ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			if ( ! $ids ) {
				break;
			}
			$in = implode( ',', array_fill( 0, count( $ids ), '%s' ) );
			foreach ( array( 'messages', 'quotes', 'events' ) as $name ) {
				$wpdb->query( $wpdb->prepare( "DELETE FROM %i WHERE conversation_id IN ({$in})", array_merge( array( ContextChat_Installer::table( $name ) ), $ids ) ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- placeholders only.
			}
			$wpdb->query( $wpdb->prepare( "DELETE FROM %i WHERE id IN ({$in})", array_merge( array( ContextChat_Installer::table( 'conversations' ) ), $ids ) ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- placeholders only.
			$deleted += count( $ids );
		}
		if ( $deleted ) {
			// A record of the deletion, without personal data (PP 33/2026 Pasal 86 ayat 2 huruf f).
			$wpdb->insert( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
				ContextChat_Installer::table( 'events' ),
				array(
					'conversation_id' => null,
					'type'            => 'retention_deleted',
					'detail'          => (string) $deleted,
					'created_at'      => $now,
				)
			);
		}
		// Events without a conversation (refused starts) follow the same retention; deletion
		// records stay.
		$wpdb->query( $wpdb->prepare( "DELETE FROM %i WHERE conversation_id IS NULL AND type NOT IN ('retention_deleted', 'admin_deleted') AND created_at <= %s", ContextChat_Installer::table( 'events' ), gmdate( 'Y-m-d H:i:s', time() - self::retention_days() * 86400 ) ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		// Stale conversation locks.
		$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE option_name LIKE %s AND option_value < %d', $wpdb->options, $wpdb->esc_like( 'contextchat_si_lock_' ) . '%', time() - 3600 ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		return $deleted;
	}
}

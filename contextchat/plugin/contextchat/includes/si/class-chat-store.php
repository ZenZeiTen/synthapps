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

	/** Days a conversation is kept (D-06). */
	const RETENTION_DAYS = 365;

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
					'expires_at'  => gmdate( 'Y-m-d H:i:s', $now + self::RETENTION_DAYS * 86400 ),
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
		if ( ! $row || ! hash_equals( $row['token_hash'], hash( 'sha256', $token ) ) ) {
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
}

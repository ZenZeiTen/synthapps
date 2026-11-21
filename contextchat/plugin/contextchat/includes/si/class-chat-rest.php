<?php
/**
 * REST endpoints of the SI chat (design plan section 12), under /wp-json/contextchat/v1/chat/.
 *
 * Visitors are not logged in: each conversation has a random token, returned once by chat/start
 * and stored only as a hash. The guard and rate limits run before anything reaches the model.
 * Requests from another site (a foreign Origin header) are refused.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Chat routes.
 */
class ContextChat_Chat_REST {

	/** Route namespace. */
	const NS = 'contextchat/v1';

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
	}

	/**
	 * Is the SI chat on and able to answer? Off by default after an update (design plan section 17).
	 *
	 * @return bool
	 */
	public static function available() {
		$s  = ContextChat_Settings::get();
		$on = ! empty( $s['si_enabled'] ) && '' !== ContextChat_SI_Secrets::get_key();
		/**
		 * Filter whether the SI chat is offered.
		 *
		 * @param bool $on Whether the SI chat is on and has a key.
		 */
		return (bool) apply_filters( 'contextchat_si_enabled', $on );
	}

	/**
	 * Register the routes.
	 */
	public static function routes() {
		$id    = array(
			'type'     => 'string',
			'required' => true,
			'pattern'  => '^[0-9A-HJKMNP-TV-Z]{26}$',
		);
		$token = array(
			'type'     => 'string',
			'required' => true,
			'pattern'  => '^[0-9a-f]{64}$',
		);
		$open  = '__return_true'; // Visitors are not logged in; the token and the guard protect each route.

		register_rest_route(
			self::NS,
			'/chat/start',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'start' ),
				'permission_callback' => $open,
				'args'                => array(
					'lang'   => array(
						'type'    => 'string',
						'enum'    => array( 'id', 'en' ),
						'default' => 'id',
					),
					'page'   => array(
						'type'      => 'string',
						'default'   => '',
						'maxLength' => 500,
					),
					'rule'   => array(
						'type'      => 'string',
						'default'   => '',
						'maxLength' => 64,
					),
					'device' => array(
						'type'    => 'string',
						'enum'    => array( 'mobile', 'desktop', '' ),
						'default' => '',
					),
				),
			)
		);
		register_rest_route(
			self::NS,
			'/chat/message',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'message' ),
				'permission_callback' => $open,
				'args'                => array(
					'conversation_id' => $id,
					'token'           => $token,
					'text'            => array(
						'type'     => 'string',
						'required' => true,
					),
				),
			)
		);
		register_rest_route(
			self::NS,
			'/chat/handoff',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'handoff' ),
				'permission_callback' => $open,
				'args'                => array(
					'conversation_id' => $id,
					'token'           => $token,
					'channel'         => array(
						'type'     => 'string',
						'enum'     => array( 'whatsapp', 'email' ),
						'required' => true,
					),
					'text'            => array(
						'type'    => 'string',
						'default' => '',
					),
				),
			)
		);
		register_rest_route(
			self::NS,
			'/chat/idle',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'idle' ),
				'permission_callback' => $open,
				'args'                => array(
					'conversation_id' => $id,
					'token'           => $token,
				),
			)
		);
		register_rest_route(
			self::NS,
			'/chat/resume',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'resume' ),
				'permission_callback' => $open,
				'args'                => array(
					'conversation_id' => $id,
					'token'           => $token,
				),
			)
		);
	}

	/**
	 * Refuse a request: SI off, a foreign origin or an oversized body. Null when it may go on.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_Error|null
	 */
	private static function refuse( WP_REST_Request $request ) {
		if ( ! self::available() ) {
			return new WP_Error( 'contextchat_si_off', 'The SI chat is not available.', array( 'status' => 404 ) );
		}
		$origin = $request->get_header( 'origin' );
		if ( $origin ) {
			$host = wp_parse_url( $origin, PHP_URL_HOST );
			if ( ! $host || strtolower( $host ) !== strtolower( (string) wp_parse_url( home_url(), PHP_URL_HOST ) ) ) {
				return new WP_Error( 'contextchat_origin', 'Requests from other sites are not accepted.', array( 'status' => 403 ) );
			}
		}
		if ( strlen( (string) $request->get_body() ) > ContextChat_Guard::MAX_BODY ) {
			return new WP_Error( 'contextchat_too_large', 'The request is too large.', array( 'status' => 413 ) );
		}
		return null;
	}

	/**
	 * The store, and the rate limiter for this visitor.
	 *
	 * @return ContextChat_Chat_Store
	 */
	private static function store() {
		return new ContextChat_Chat_Store();
	}

	/**
	 * Rate limiter with the transient store.
	 *
	 * @return ContextChat_Rate_Limiter
	 */
	private static function limiter() {
		/**
		 * Filter the SI chat's rate limits (design plan section 9.1).
		 *
		 * @param array $limits per_minute, starts_per_hour, per_day, per_conversation.
		 */
		$limits = (array) apply_filters( 'contextchat_si_limits', ContextChat_Guard::LIMITS );
		return new ContextChat_Rate_Limiter( new ContextChat_Transient_Store(), $limits );
	}

	/**
	 * POST chat/start.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function start( WP_REST_Request $request ) {
		$refused = self::refuse( $request );
		if ( $refused ) {
			return $refused;
		}
		$lang = 'en' === $request['lang'] ? 'en' : 'id';
		if ( ! self::limiter()->start( ContextChat_Guard::visitor_hash(), time() ) ) {
			self::store()->add_event( null, 'rate_limited', 'start' );
			return self::limited( $lang );
		}
		$page = esc_url_raw( (string) $request['page'] );
		if ( $page && wp_parse_url( $page, PHP_URL_HOST ) !== wp_parse_url( home_url(), PHP_URL_HOST ) ) {
			$page = '';
		}
		$state            = ContextChat_Orchestrator::new_state( $lang, $page );
		$state['started'] = (int) floor( microtime( true ) * 1000 );
		$created          = self::store()->create_conversation(
			array(
				'lang'     => $lang,
				'page_url' => $page,
				'rule_id'  => sanitize_key( (string) $request['rule'] ),
				'device'   => (string) $request['device'],
				'state'    => $state,
			)
		);
		if ( ! $created ) {
			return new WP_Error( 'contextchat_store', 'The conversation could not be started.', array( 'status' => 500 ) );
		}
		self::store()->add_event( $created['id'], 'chat_started', '' );
		$greeting = ContextChat_Voice::template( 'greeting', $lang );
		self::store()->add_message( $created['id'], 'system_template', $greeting, '' );

		return new WP_REST_Response(
			array(
				'conversation_id' => $created['id'],
				'token'           => $created['token'],
				'reference'       => $created['reference'],
				'greeting'        => $greeting,
				'notice'          => ContextChat_Voice::template( 'notice', $lang ),
				'lang'            => $lang,
			),
			201
		);
	}

	/**
	 * POST chat/message.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function message( WP_REST_Request $request ) {
		$refused = self::refuse( $request );
		if ( $refused ) {
			return $refused;
		}
		$store = self::store();
		$conv  = $store->find( (string) $request['conversation_id'], (string) $request['token'] );
		if ( ! $conv ) {
			return new WP_Error( 'contextchat_token', 'Unknown conversation.', array( 'status' => 403 ) );
		}
		$state = array_merge( ContextChat_Orchestrator::new_state( $conv['lang'], $conv['page_url'] ), $conv['state'] );
		$lang  = $state['lang'];

		// Bot check: no first message within 1.5 seconds of opening the chat.
		$now_ms = (int) floor( microtime( true ) * 1000 );
		if ( 0 === (int) $state['visitor_messages'] && isset( $state['started'] ) && $now_ms - (int) $state['started'] < ContextChat_Guard::MIN_FIRST_MESSAGE_MS ) {
			$store->add_event( $conv['id'], 'rate_limited', 'too_fast' );
			return self::limited( $lang );
		}
		if ( ! self::limiter()->message( ContextChat_Guard::visitor_hash(), time() ) ) {
			$store->add_event( $conv['id'], 'rate_limited', 'message' );
			return self::limited( $lang, $conv, $state );
		}

		$hosts   = (array) apply_filters( 'contextchat_si_file_hosts', ContextChat_Guard::FILE_HOSTS );
		$verdict = ContextChat_Guard::inspect( (string) $request['text'], $hosts );
		if ( ! $verdict['ok'] && 'empty' === $verdict['block'] ) {
			return new WP_Error( 'contextchat_empty', 'Empty message.', array( 'status' => 400 ) );
		}
		if ( ! $verdict['ok'] ) {
			// Not sent to the model and not stored; only the kind of block is logged.
			$lang = ContextChat_Orchestrator::detect_lang( (string) $request['text'], $lang );
			$type = in_array( $verdict['block'], array( 'upload', 'pii' ), true ) ? 'blocked_' . $verdict['block'] : 'blocked_input';
			$store->add_event( $conv['id'], $type, implode( ',', array_merge( array( $verdict['block'] ), $verdict['flags'] ) ) );
			$template = in_array( $verdict['block'], array( 'upload', 'pii', 'too_long', 'markup' ), true ) ? $verdict['block'] : 'markup';
			$reply  = ContextChat_Voice::template( $template, $lang );
			$reason = 'upload' === $verdict['block'] ? 'documents' : ( 'pii' === $verdict['block'] ? 'blocked' : '' );
			$store->add_message( $conv['id'], 'system_template', $reply, '' );
			if ( $reason ) {
				$state['handoff_offered'] = true;
				$state['handoff_reason']  = $reason;
				$store->add_event( $conv['id'], 'handoff_offered', $reason );
				$store->update_conversation( $conv['id'], array( 'state' => $state ) );
			}
			return new WP_REST_Response(
				array(
					'reply'   => $reply,
					'blocked' => $verdict['block'],
					'quote'   => null,
					'handoff' => $reason ? self::handoff_card( $conv, $state, $reason, $lang ) : null,
					'lang'    => $lang,
				),
				200
			);
		}

		$router = ContextChat_SI::router();
		if ( ! $router ) {
			return new WP_Error( 'contextchat_si_off', 'The SI chat is not available.', array( 'status' => 404 ) );
		}
		$orchestrator = new ContextChat_Orchestrator( $store, $router, self::engine(), self::context() );
		$conv['state'] = $state;
		$result        = $orchestrator->turn( $conv, $verdict['text'] );

		$reply = $result['reply'];
		/**
		 * Filter an SI reply after it passed the checks, before the visitor sees it.
		 *
		 * @param string $reply  Reply.
		 * @param array  $result Turn result (model, lang, quote, handoff, state).
		 */
		$reply = (string) apply_filters( 'contextchat_si_reply', $reply, $result );

		return new WP_REST_Response(
			array(
				'reply'   => $reply,
				'quote'   => $result['quote'] ? self::quote_card( $result['quote'], $result['lang'] ) : null,
				'handoff' => '' !== $result['handoff'] ? self::handoff_card( $conv, $result['state'], $result['handoff'], $result['lang'] ) : null,
				'lang'    => $result['lang'],
			),
			200
		);
	}

	/**
	 * POST chat/handoff: the link for the channel the visitor chose, with their (edited) text.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function handoff( WP_REST_Request $request ) {
		$refused = self::refuse( $request );
		if ( $refused ) {
			return $refused;
		}
		$store = self::store();
		$conv  = $store->find( (string) $request['conversation_id'], (string) $request['token'] );
		if ( ! $conv ) {
			return new WP_Error( 'contextchat_token', 'Unknown conversation.', array( 'status' => 403 ) );
		}
		$state   = array_merge( ContextChat_Orchestrator::new_state( $conv['lang'], $conv['page_url'] ), $conv['state'] );
		$reason  = '' !== $state['handoff_reason'] ? $state['handoff_reason'] : 'visitor_asked';
		$card    = self::handoff_card( $conv, $state, $reason, $state['lang'] );
		$channel = (string) $request['channel'];
		$text    = ContextChat_Template::tidy( sanitize_textarea_field( (string) $request['text'] ) );
		if ( '' === $text ) {
			$text = 'email' === $channel ? $card['email_text'] : $card['text'];
		}
		if ( 'whatsapp' === $channel ) {
			if ( '' === $card['phone'] ) {
				return new WP_Error( 'contextchat_no_whatsapp', 'No WhatsApp number is set.', array( 'status' => 409 ) );
			}
			$url = ContextChat_Template::link( $card['phone'], mb_substr( $text, 0, ContextChat_Handoff::MAX_WHATSAPP ) );
		} else {
			$url = ContextChat_Handoff::mailto( $card['email'], $card['subject'], mb_substr( $text, 0, 4000 ) );
		}
		$store->add_event( $conv['id'], 'handoff_clicked', $channel );
		$store->update_conversation(
			$conv['id'],
			array(
				'status'          => 'handed_off',
				'handoff_channel' => $channel,
				'handoff_reason'  => $reason,
			)
		);
		return new WP_REST_Response( array( 'url' => $url ), 200 );
	}

	/**
	 * POST chat/idle: after the visitor has been silent for the idle time since a quote, offer
	 * the handoff once per conversation.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function idle( WP_REST_Request $request ) {
		$refused = self::refuse( $request );
		if ( $refused ) {
			return $refused;
		}
		$store = self::store();
		$conv  = $store->find( (string) $request['conversation_id'], (string) $request['token'] );
		if ( ! $conv ) {
			return new WP_Error( 'contextchat_token', 'Unknown conversation.', array( 'status' => 403 ) );
		}
		$state = array_merge( ContextChat_Orchestrator::new_state( $conv['lang'], $conv['page_url'] ), $conv['state'] );
		if ( '' === $state['quote_ref'] || $state['idle_offered'] || 'handed_off' === $conv['status'] ) {
			return new WP_REST_Response( array( 'handoff' => null ), 200 );
		}
		$state['idle_offered']    = true;
		$state['handoff_offered'] = true;
		$state['handoff_reason']  = 'idle';
		$reply                    = ContextChat_Voice::template( 'idle', $state['lang'] );
		$store->add_message( $conv['id'], 'system_template', $reply, '' );
		$store->add_event( $conv['id'], 'idle_offer', '' );
		$store->update_conversation( $conv['id'], array( 'state' => $state ) );
		return new WP_REST_Response(
			array(
				'reply'   => $reply,
				'handoff' => self::handoff_card( $conv, $state, 'idle', $state['lang'] ),
			),
			200
		);
	}

	/**
	 * GET chat/resume: the last 20 messages and the latest quote, for the same browser tab.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function resume( WP_REST_Request $request ) {
		$refused = self::refuse( $request );
		if ( $refused ) {
			return $refused;
		}
		$store = self::store();
		$conv  = $store->find( (string) $request['conversation_id'], (string) $request['token'] );
		if ( ! $conv ) {
			return new WP_Error( 'contextchat_token', 'Unknown conversation.', array( 'status' => 403 ) );
		}
		$state    = array_merge( ContextChat_Orchestrator::new_state( $conv['lang'], $conv['page_url'] ), $conv['state'] );
		$messages = array();
		foreach ( $store->recent_messages( $conv['id'], 20 ) as $m ) {
			$messages[] = array(
				'role' => 'visitor' === $m['role'] ? 'visitor' : 'assistant',
				'text' => $m['content'],
			);
		}
		return new WP_REST_Response(
			array(
				'reference' => $conv['reference'],
				'lang'      => $state['lang'],
				'messages'  => $messages,
				'quote'     => is_array( $state['quote'] ) ? self::quote_card( $state['quote'], $state['lang'] ) : null,
				'handoff'   => $state['handoff_offered'] ? self::handoff_card( $conv, $state, $state['handoff_reason'], $state['lang'] ) : null,
				'notice'    => ContextChat_Voice::template( 'notice', $state['lang'] ),
			),
			200
		);
	}

	/**
	 * A rate-limited answer: the fixed reply and, inside a conversation, the handoff card.
	 *
	 * @param string     $lang  Language.
	 * @param array|null $conv  Conversation.
	 * @param array|null $state State.
	 * @return WP_REST_Response
	 */
	private static function limited( $lang, $conv = null, $state = null ) {
		return new WP_REST_Response(
			array(
				'reply'   => ContextChat_Voice::template( 'rate_limited', $lang ),
				'limited' => true,
				'quote'   => null,
				'handoff' => $conv ? self::handoff_card( $conv, $state, 'busy', $lang ) : self::handoff_card( null, null, 'busy', $lang ),
				'lang'    => $lang,
			),
			429
		);
	}

	/**
	 * The price engine with the site's table and the bundled country data.
	 *
	 * @return ContextChat_Price_Engine
	 */
	public static function engine() {
		return new ContextChat_Price_Engine( self::price_table(), new ContextChat_Countries() );
	}

	/**
	 * The price table: the bundled seed, or a site's own through the filter.
	 *
	 * @return array
	 */
	public static function price_table() {
		/**
		 * Filter the price table the engine calculates from.
		 *
		 * @param array $table Decoded data/price-table.nusalexia.json.
		 */
		return (array) apply_filters( 'contextchat_price_table', ContextChat_Price_Engine::seed() );
	}

	/**
	 * Business name used in the SI's instructions and summaries.
	 *
	 * @return string
	 */
	public static function business_name() {
		$s = ContextChat_Settings::get();
		return '' !== $s['si_business_name'] ? $s['si_business_name'] : wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES );
	}

	/**
	 * Address that receives email handoffs.
	 *
	 * @return string
	 */
	public static function handoff_email() {
		$s = ContextChat_Settings::get();
		return '' !== $s['si_handoff_email'] ? $s['si_handoff_email'] : (string) get_option( 'admin_email' );
	}

	/**
	 * What the orchestrator needs from the site.
	 *
	 * @return array
	 */
	private static function context() {
		$voice     = ContextChat_Voice::get();
		$knowledge = ContextChat_Knowledge::entries();
		return array(
			'prefix'    => ContextChat_Prompt::prefix(
				$voice,
				$knowledge,
				self::price_table(),
				array( 'name' => self::business_name() )
			),
			'voice'     => $voice,
			'knowledge' => $knowledge,
			'site_host' => (string) wp_parse_url( home_url(), PHP_URL_HOST ),
			'email'     => self::handoff_email(),
			'today'     => wp_date( 'Y-m-d' ),
		);
	}

	/**
	 * The quote card for the widget, with labels in the visitor's language.
	 *
	 * @param array  $q    Price engine result.
	 * @param string $lang Language.
	 * @return array
	 */
	public static function quote_card( array $q, $lang ) {
		$en = 'en' === $lang;
		return array(
			'status'            => $q['status'],
			'reference'         => $q['reference'],
			'lines'             => $q['lines'],
			'express_surcharge' => $q['express_surcharge'],
			'discount'          => $q['discount'],
			'discount_percent'  => $q['discount_percent'],
			'total'             => $q['total'],
			'deposit'           => $q['deposit'],
			'valid_days'        => $q['valid_days'],
			'labels'            => array(
				'title'    => $en ? 'Estimate' : 'Estimasi',
				'express'  => $en ? 'Express surcharge' : 'Biaya ekspres',
				'discount' => $en ? 'Volume discount' : 'Diskon volume',
				'total'    => 'Total',
				'deposit'  => $en ? 'Deposit (50%)' : 'DP 50%',
				'note'     => $en ? 'Estimate only; the final price is confirmed in a written quotation. Final page count comes from the translation.' : 'Estimasi — penawaran final dikonfirmasi tertulis. Jumlah halaman final dihitung dari hasil terjemahan.',
				'valid'    => $en ? 'Valid for %d days' : 'Berlaku %d hari',
				'team'     => $en ? 'Our team needs to confirm this one (for example translator capacity for express work).' : 'Untuk yang ini tim kami perlu mengonfirmasi dulu (misalnya kapasitas penerjemah untuk layanan ekspres).',
			),
		);
	}

	/**
	 * The handoff card: summary text, WhatsApp and email targets, agent label, hours note.
	 *
	 * @param array|null $conv   Conversation, or null before one exists.
	 * @param array|null $state  State.
	 * @param string     $reason Reason.
	 * @param string     $lang   Language.
	 * @return array
	 */
	public static function handoff_card( $conv, $state, $reason, $lang ) {
		$s       = ContextChat_Settings::get();
		$site    = self::business_name();
		$state   = is_array( $state ) ? $state : ContextChat_Orchestrator::new_state( $lang, '' );
		$summary = array(
			'service'   => $state['service'],
			'intake'    => $state['intake'],
			'quote'     => is_array( $state['quote'] ) ? $state['quote'] : array(),
			'reason'    => $reason,
			'reference' => $conv ? $conv['reference'] : '',
			'page'      => $state['page'],
		);
		/**
		 * Filter the handoff summary the visitor sends on WhatsApp or by email.
		 *
		 * @param string $text    Summary.
		 * @param array  $summary The data it was built from.
		 * @param string $lang    Language.
		 */
		$text   = (string) apply_filters( 'contextchat_handoff_text', ContextChat_Handoff::summary( $summary, $lang, $site ), $summary, $lang );
		$email  = (string) apply_filters( 'contextchat_handoff_text', ContextChat_Handoff::summary( $summary, $lang, $site, true ), $summary, $lang );
		$agent  = ContextChat_Handoff::agent( $s['agents'], 'interpreting' === $state['service'] ? $s['si_agent_interpreting'] : $s['si_agent_translation'] );
		$phone  = $agent ? $agent['phone'] : (string) $s['phone'];
		$label  = $agent ? trim( $agent['name'] . ( '' !== $agent['role'] ? ' · ' . $agent['role'] : '' ) ) : '';
		$en     = 'en' === $lang;
		return array(
			'reason'     => $reason,
			'text'       => $text,
			'email_text' => $email,
			'subject'    => ContextChat_Handoff::subject( $summary, $lang, $site ),
			'phone'      => $phone,
			'email'      => self::handoff_email(),
			'agent'      => $label,
			'agent_id'   => $agent ? $agent['id'] : '',
			'hours_note' => ContextChat_Voice::template( 'handoff_hours', $lang ),
			'labels'     => array(
				'title'    => $en ? 'Continue with our team' : 'Lanjut dengan tim kami',
				'edit'     => $en ? 'Your message (you can edit it)' : 'Pesan Anda (bisa diubah)',
				'whatsapp' => 'WhatsApp',
				'email'    => 'Email',
			),
		);
	}
}

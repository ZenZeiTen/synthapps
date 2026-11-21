<?php
/**
 * Orchestrator: one visitor turn of the SI chat (design plan sections 5.2 and 8).
 *
 * The visitor's message has already passed the guard. The orchestrator keeps the conversation
 * state (intake, latest quote, handoff, counters), asks the model with the cached prefix and the
 * state line, runs up to 3 tool rounds, checks the reply with the validator, retries once on the
 * stronger model when the check fails, and falls back to a fixed reply with the handoff card when
 * nothing usable comes back. Pure PHP: the store, router and price engine are passed in.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Runs chat turns.
 */
class ContextChat_Orchestrator {

	/** Visitor messages per conversation before only the handoff is offered. */
	const MAX_VISITOR_MESSAGES = 40;

	/** Tool rounds per model per turn. */
	const MAX_TOOL_ROUNDS = 3;

	/** Messages of history sent with each turn. */
	const HISTORY = 20;

	/** Requests for the instructions. */
	const INSTRUCTIONS = '/(system\s*prompt|\bprompt\s+(kamu|anda|mu|you)\b|\binstruksi\s+(kamu|anda|sistem|mu|awal)\b|abaikan\s+(semua\s+)?(instruksi|perintah|aturan)|ignore\s+(all\s+|the\s+|your\s+)?(previous|prior|above|earlier)\s+(instructions|rules)|\byour\s+(system\s+)?(instructions|prompt|rules)\b|\breveal\b.*\binstructions\b)/iu';

	/** Questions for a person's name. */
	const NAME_QUESTIONS = '/(siapa\s+(nama\s+)?(pemilik|direktur|owner|ceo|pendiri|founder|bos|penerjemah(nya)?|admin(nya)?|staf(nya)?)|nama\s+(pemilik|direktur|pendiri|penerjemah|staf|admin|owner)|who\s+(is|are)\s+(the\s+|your\s+)?(owner|director|founder|ceo|boss|translators?|staff)|(owner|director|founder|ceo)\'?s\s+name)/iu';

	/** Asking for a person or another channel. */
	const ASKS_PERSON = '/\b(whatsapp|wa|telepon|telp|telfon|nelpon|call|phone|email|e-mail|admin|cs|customer\s+service|orang\s+asli|manusia|human|real\s+person|agent|staf)\b/iu';

	/** Hesitation about the price. */
	const HESITATION = '/\b(diskon|discount|mahal|kemahalan|expensive|kurangin|bisa\s+kurang|nego|negosiasi|harga\s+(final|pas|nett?|terakhir)|final\s+price|best\s+price|potongan|murahin|lebih\s+murah|cheaper)\b/iu';

	/** Store. @var object */
	private $store;

	/** Router. @var ContextChat_SI_Router */
	private $router;

	/** Price engine. @var ContextChat_Price_Engine */
	private $engine;

	/** Settings: prefix, voice, knowledge, site_host, email, today. @var array */
	private $ctx;

	/**
	 * Set up.
	 *
	 * @param object                   $store  Chat store (ContextChat_Chat_Store or a test double).
	 * @param ContextChat_SI_Router    $router Router.
	 * @param ContextChat_Price_Engine $engine Price engine.
	 * @param array                    $ctx    prefix (string), voice (ContextChat_Voice::get()), knowledge (entries),
	 *                                         site_host, email, today (Y-m-d).
	 */
	public function __construct( $store, $router, $engine, array $ctx ) {
		$this->store  = $store;
		$this->router = $router;
		$this->engine = $engine;
		$this->ctx    = $ctx;
	}

	/**
	 * A fresh conversation state.
	 *
	 * @param string $lang Language of the site or page.
	 * @param string $page Page address.
	 * @return array
	 */
	public static function new_state( $lang, $page ) {
		return array(
			'service'          => '',
			'intake'           => array(),
			'quote'            => null,
			'quote_ref'        => '',
			'handoff_offered'  => false,
			'handoff_reason'   => '',
			'idle_offered'     => false,
			'visitor_messages' => 0,
			'lang'             => 'en' === $lang ? 'en' : 'id',
			'page'             => (string) $page,
		);
	}

	/**
	 * Guess the visitor's language from their message: Indonesian or English.
	 *
	 * @param string $text     Message.
	 * @param string $fallback Language when unclear.
	 * @return string 'id' or 'en'.
	 */
	public static function detect_lang( $text, $fallback ) {
		$words = preg_split( '/[^a-z]+/', strtolower( (string) $text ) );
		$id    = array( 'saya', 'mau', 'untuk', 'yang', 'berapa', 'dokumen', 'apa', 'bisa', 'kak', 'tidak', 'dan', 'ke', 'dari', 'ini', 'itu', 'harga', 'terjemahan', 'tersumpah', 'halaman', 'biaya', 'ada', 'apakah', 'bagaimana', 'kalau', 'dengan', 'sudah', 'belum', 'terima', 'kasih', 'halo', 'pak', 'bu', 'mohon', 'tolong', 'butuh', 'perlu', 'aku', 'gimana', 'kapan', 'jadi', 'juga', 'bahasa', 'ijazah', 'akta' );
		$en    = array( 'the', 'i', 'my', 'how', 'what', 'please', 'need', 'is', 'to', 'a', 'and', 'for', 'of', 'do', 'you', 'can', 'much', 'translation', 'translate', 'document', 'documents', 'price', 'cost', 'hello', 'hi', 'thanks', 'thank', 'would', 'like', 'want', 'pages', 'sworn', 'certified', 'into', 'from', 'english', 'indonesian', 'does', 'it', 'are', 'there', 'your' );
		$si    = 0;
		$se    = 0;
		foreach ( $words as $w ) {
			if ( in_array( $w, $id, true ) ) {
				++$si;
			} elseif ( in_array( $w, $en, true ) ) {
				++$se;
			}
		}
		if ( $si === $se ) {
			return 'en' === $fallback ? 'en' : 'id';
		}
		return $si > $se ? 'id' : 'en';
	}

	/**
	 * Run one visitor turn.
	 *
	 * @param array  $conv Conversation row: id, reference, and state (decoded intake_json).
	 * @param string $text Visitor message (already checked by the guard).
	 * @return array {
	 *     reply: string, model: string, lang: string, quote: array|null (when this turn made one),
	 *     handoff: string (reason, or '' for none), state: array (new state), status: string,
	 *     tokens_in: int, tokens_out: int, cost_micro_usd: int
	 * }
	 */
	public function turn( array $conv, $text ) {
		$state = isset( $conv['state'] ) && is_array( $conv['state'] ) ? $conv['state'] : self::new_state( 'id', '' );
		$lang  = self::detect_lang( $text, $state['lang'] );

		$state['lang'] = $lang;
		++$state['visitor_messages'];
		$out = array(
			'reply'          => '',
			'model'          => '',
			'lang'           => $lang,
			'quote'          => null,
			'handoff'        => '',
			'state'          => $state,
			'status'         => '',
			'tokens_in'      => 0,
			'tokens_out'     => 0,
			'cost_micro_usd' => 0,
		);

		$this->store->add_message( $conv['id'], 'visitor', $text, '' );

		// Turns answered without the model.
		$max = isset( $this->ctx['max_messages'] ) ? (int) $this->ctx['max_messages'] : self::MAX_VISITOR_MESSAGES;
		if ( $state['visitor_messages'] > $max ) {
			return $this->fixed( $conv, $out, 'conversation_limit', 'limit', 'limited' );
		}
		if ( preg_match( self::INSTRUCTIONS, $text ) ) {
			$this->store->add_event( $conv['id'], 'instructions_request', '' );
			return $this->fixed( $conv, $out, 'instructions', '', '' );
		}
		if ( preg_match( self::NAME_QUESTIONS, $text ) ) {
			$this->store->add_event( $conv['id'], 'name_request', '' );
			return $this->fixed( $conv, $out, 'names', 'visitor_asked', '' );
		}

		$keyword = '';
		if ( preg_match( self::HESITATION, $text ) ) {
			$keyword = 'hesitation';
		} elseif ( preg_match( self::ASKS_PERSON, $text ) ) {
			$keyword = 'visitor_asked';
		}

		$base = $this->history( $conv['id'] );

		$start_state     = $state;
		$pending_handoff = '';
		$quote_this_turn = null;
		$quotes          = array();
		$note            = '';
		$final           = null;

		foreach ( $this->router->models() as $model ) {
			// Each model starts from the same state: nothing a rejected attempt did carries over.
			$state           = $start_state;
			$pending_handoff = '';
			$quote_this_turn = null;
			$quotes          = array();
			$messages        = $base;
			for ( $round = 0; $round <= self::MAX_TOOL_ROUNDS; $round++ ) {
				$request = array(
					'system'   => ContextChat_Prompt::system( $this->ctx['prefix'], ContextChat_Prompt::state_line( $state ) ),
					'messages' => $messages,
					'tools'    => ContextChat_Prompt::tools(),
				);
				$res     = $this->router->call( $model, $request, $note );
				$out['cost_micro_usd'] += (int) $res['cost_micro_usd'];
				$out['tokens_in']      += isset( $res['usage']['input_tokens'] ) ? (int) $res['usage']['input_tokens'] + ( isset( $res['usage']['cache_read_input_tokens'] ) ? (int) $res['usage']['cache_read_input_tokens'] : 0 ) + ( isset( $res['usage']['cache_creation_input_tokens'] ) ? (int) $res['usage']['cache_creation_input_tokens'] : 0 ) : 0;
				$out['tokens_out']     += isset( $res['usage']['output_tokens'] ) ? (int) $res['usage']['output_tokens'] : 0;

				if ( 'cap_reached' === $res['outcome'] || 'spend_limit' === $res['outcome'] ) {
					$this->store->add_event( $conv['id'], 'cap_reached', $res['outcome'] );
					$out['state'] = $start_state;
					return $this->fixed( $conv, $out, 'cap_reached', 'busy', '' );
				}
				if ( 'ok' !== $res['outcome'] ) {
					$this->store->add_event( $conv['id'], 'api_error', substr( $res['outcome'] . ':' . $res['status'], 0, 64 ) );
					if ( ContextChat_SI_Router::escalates( $res['outcome'] ) ) {
						continue 2; // Next model.
					}
					$out['state'] = $start_state;
					return $this->fixed( $conv, $out, 'busy', 'busy', '' );
				}

				$content = isset( $res['response']['content'] ) && is_array( $res['response']['content'] ) ? $res['response']['content'] : array();
				if ( 'tool_use' === $res['stop_reason'] ) {
					if ( $round >= self::MAX_TOOL_ROUNDS ) {
						$note = 'too_many_tool_rounds';
						$this->store->add_event( $conv['id'], 'validator_reject', 'tool_rounds' );
						continue 2;
					}
					$messages[] = array(
						'role'    => 'assistant',
						'content' => $content,
					);
					$results    = array();
					foreach ( $content as $block ) {
						if ( isset( $block['type'] ) && 'tool_use' === $block['type'] ) {
							$results[] = $this->run_tool( $state, $block, $lang, $pending_handoff, $quote_this_turn, $quotes );
						}
					}
					$messages[] = array(
						'role'    => 'user',
						'content' => $results,
					);
					continue;
				}

				if ( 'max_tokens' === $res['stop_reason'] ) {
					// Cut off mid-reply: try again rather than show half a sentence.
					$note = 'truncated';
					$this->store->add_event( $conv['id'], 'validator_reject', 'truncated' );
					continue 2;
				}
				$card  = $quote_this_turn && in_array( $quote_this_turn['status'], array( 'ok', 'needs_team' ), true );
				$check = ContextChat_Validator::check( $res['text'], $this->validator_ctx( $state, $card ) );
				if ( $check['ok'] ) {
					$final = array(
						'text'  => $check['text'],
						'model' => isset( $res['served_by'] ) && '' !== $res['served_by'] ? $res['served_by'] : $model,
					);
					break 2;
				}
				$note = implode( ', ', $check['reasons'] );
				$this->store->add_event( $conv['id'], 'validator_reject', substr( $note, 0, 64 ) );
				continue 2;
			}
		}

		if ( null === $final ) {
			// Nothing usable: keep the state from before this turn (apart from the counters) and hand over.
			$start_state['lang'] = $lang;
			$out['state']        = $start_state;
			return $this->fixed( $conv, $out, 'fallback', 'other', '' );
		}
		$out['state'] = $state;
		foreach ( $quotes as $saved ) {
			$this->store->add_quote( $conv['id'], $saved[0], $saved[1] );
		}

		// Handoff: the model's request, then the engine's verdict, then the interpreting rule, then keywords.
		$handoff = $pending_handoff;
		if ( '' === $handoff && $quote_this_turn ) {
			if ( 'needs_team' === $quote_this_turn['status'] ) {
				$handoff = 'complex';
			} elseif ( 'unavailable' === $quote_this_turn['status'] ) {
				$handoff = 'unavailable';
			}
		}
		if ( '' === $handoff && 'interpreting' === $state['service'] && ! array_diff( ContextChat_Prompt::INTERPRETING_REQUIRED, array_keys( $state['intake'] ) ) ) {
			$handoff = 'interpreting';
		}
		if ( '' === $handoff && '' !== $keyword ) {
			$handoff = $keyword;
		}

		$this->store->add_message( $conv['id'], 'assistant', $final['text'], $final['model'] );
		$out['reply'] = $final['text'];
		$out['model'] = $final['model'];
		$out['quote'] = $quote_this_turn && in_array( $quote_this_turn['status'], array( 'ok', 'needs_team' ), true ) ? $quote_this_turn : null;
		if ( $out['quote'] ) {
			$this->store->add_event( $conv['id'], 'quote_shown', $out['quote']['reference'] );
		}
		return $this->finish( $conv, $out, $state, $handoff, $out['quote'] ? 'quoted' : '' );
	}

	/**
	 * Answer with a fixed reply (and the handoff card when a reason is given).
	 *
	 * @param array  $conv     Conversation.
	 * @param array  $out      Result so far.
	 * @param string $template Fixed reply key.
	 * @param string $handoff  Handoff reason or ''.
	 * @param string $status   New status or ''.
	 * @return array
	 */
	private function fixed( array $conv, array $out, $template, $handoff, $status ) {
		$text = ContextChat_Voice::template( $template, $out['lang'] );
		$this->store->add_message( $conv['id'], 'system_template', $text, '' );
		$out['reply'] = $text;
		$out['model'] = '';
		return $this->finish( $conv, $out, $out['state'], $handoff, $status );
	}

	/**
	 * Record the handoff offer and the new state.
	 *
	 * @param array  $conv    Conversation.
	 * @param array  $out     Result.
	 * @param array  $state   State.
	 * @param string $handoff Handoff reason or ''.
	 * @param string $status  New status or ''.
	 * @return array
	 */
	private function finish( array $conv, array $out, array $state, $handoff, $status ) {
		if ( '' !== $handoff ) {
			$state['handoff_offered'] = true;
			$state['handoff_reason']  = $handoff;
			$this->store->add_event( $conv['id'], 'handoff_offered', $handoff );
		}
		$out['handoff'] = $handoff;
		$out['state']   = $state;
		$out['status']  = $status;
		$this->store->update_conversation(
			$conv['id'],
			array(
				'state'          => $state,
				'status'         => $status,
				'service'        => $state['service'],
				'lang'           => $state['lang'],
				'handoff_reason' => $handoff,
				'tokens_in'      => $out['tokens_in'],
				'tokens_out'     => $out['tokens_out'],
				'cost_micro_usd' => $out['cost_micro_usd'],
			)
		);
		return $out;
	}

	/**
	 * The last messages as Messages API turns: visitor = user, everything else = assistant,
	 * starting with the visitor and with consecutive turns of one side joined.
	 *
	 * @param string $conv_id Conversation ID.
	 * @return array
	 */
	private function history( $conv_id ) {
		$out = array();
		foreach ( $this->store->recent_messages( $conv_id, self::HISTORY ) as $m ) {
			$role = 'visitor' === $m['role'] ? 'user' : 'assistant';
			if ( ! $out && 'assistant' === $role ) {
				continue;
			}
			$last = count( $out ) - 1;
			if ( $last >= 0 && $out[ $last ]['role'] === $role ) {
				$out[ $last ]['content'] .= "\n\n" . $m['content'];
			} else {
				$out[] = array(
					'role'    => $role,
					'content' => (string) $m['content'],
				);
			}
		}
		return $out;
	}

	/**
	 * Context for the reply checker: amounts from the latest quote and the published rates.
	 *
	 * @param array $state      State.
	 * @param bool  $quote_card A quote card goes with this reply.
	 * @return array
	 */
	private function validator_ctx( array $state, $quote_card ) {
		$amounts = $this->engine->published_amounts();
		if ( is_array( $state['quote'] ) ) {
			$q = $state['quote'];
			foreach ( array( 'total', 'deposit', 'express_surcharge', 'discount', 'translation_total', 'legalisation_total' ) as $key ) {
				if ( ! empty( $q[ $key ] ) ) {
					$amounts[] = (int) $q[ $key ];
				}
			}
			foreach ( isset( $q['lines'] ) ? $q['lines'] : array() as $line ) {
				$amounts[] = (int) $line['unit_price'];
				$amounts[] = (int) $line['amount'];
			}
		}
		return array(
			'amounts'    => array_values( array_unique( $amounts ) ),
			'site_host'  => $this->ctx['site_host'],
			'email'      => $this->ctx['email'],
			'names'      => $this->ctx['voice']['names'],
			'banned'     => $this->ctx['voice']['banned_words'],
			'phones'     => isset( $this->ctx['phones'] ) ? $this->ctx['phones'] : array(),
			'quote_card' => $quote_card,
		);
	}

	/**
	 * Run one tool call and return its tool_result block.
	 *
	 * @param array  $state   State (updated).
	 * @param array  $block   tool_use block.
	 * @param string $lang    Language.
	 * @param string $handoff Pending handoff reason (updated).
	 * @param mixed  $quote   Quote made this turn (updated).
	 * @param array  $quotes  Quotes to save if this attempt's reply is accepted (updated).
	 * @return array
	 */
	private function run_tool( array &$state, array $block, $lang, &$handoff, &$quote, array &$quotes ) {
		$input  = isset( $block['input'] ) && is_array( $block['input'] ) ? $block['input'] : array();
		$name   = isset( $block['name'] ) ? (string) $block['name'] : '';
		$error  = false;
		$result = array();

		switch ( $name ) {
			case 'record_intake':
				$result = $this->record_intake( $state, $input );
				break;

			case 'get_quote':
				$q_in = array();
				foreach ( array( 'package', 'source_lang', 'target_lang', 'pages', 'documents', 'speed', 'destination_country', 'legalisation', 'legal_documents', 'matter' ) as $key ) {
					if ( isset( $input[ $key ] ) && is_scalar( $input[ $key ] ) ) {
						$q_in[ $key ] = $input[ $key ];
					}
				}
				if ( ! isset( $q_in['matter'] ) && isset( $state['intake']['matter'] ) ) {
					$q_in['matter'] = $state['intake']['matter'];
				}
				$result = $this->engine->quote( $q_in, $this->ctx['today'], $lang );
				if ( in_array( $result['status'], array( 'ok', 'needs_team' ), true ) ) {
					$quotes[]           = array( $result, $q_in );
					$state['quote']     = $result;
					$state['quote_ref'] = $result['reference'];
					if ( '' === $state['service'] ) {
						$state['service'] = 'translation';
					}
				}
				$quote = $result;
				$error = 'invalid' === $result['status'];
				break;

			case 'lookup_knowledge':
				$hits   = ContextChat_Knowledge::search( $this->ctx['knowledge'], isset( $input['query'] ) ? (string) $input['query'] : '' );
				$result = array(
					'entries' => array_map(
						function ( $e ) {
							return array(
								'title' => $e['title'],
								'text'  => $e['body'],
							);
						},
						$hits
					),
				);
				if ( ! $hits ) {
					$result['note'] = 'No entry matches. Do not guess; say you have no reliable information and offer the team.';
				}
				break;

			case 'request_handoff':
				$reason  = isset( $input['reason'] ) && is_string( $input['reason'] ) && isset( ContextChat_Handoff::REASONS[ $input['reason'] ] ) ? $input['reason'] : 'other';
				$handoff = $reason;
				$result  = array( 'shown' => 'A handoff card with WhatsApp and email buttons and a prepared summary is shown under your reply.' );
				break;

			default:
				$error  = true;
				$result = array( 'error' => 'unknown_tool' );
		}

		$block_out = array(
			'type'        => 'tool_result',
			'tool_use_id' => isset( $block['id'] ) ? (string) $block['id'] : '',
			'content'     => (string) json_encode( $result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ), // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode -- pure PHP class.
		);
		if ( $error ) {
			$block_out['is_error'] = true;
		}
		return $block_out;
	}

	/**
	 * record_intake: keep only known fields, as short plain values.
	 *
	 * @param array $state State (updated).
	 * @param array $input Tool input.
	 * @return array Result for the model.
	 */
	private function record_intake( array &$state, array $input ) {
		$service = isset( $input['service'] ) && is_string( $input['service'] ) && in_array( $input['service'], array( 'translation', 'interpreting', 'other' ), true ) ? $input['service'] : $state['service'];
		if ( '' !== $service && 'other' !== $service ) {
			$state['service'] = $service;
		}
		$allowed = 'interpreting' === $state['service'] ? ContextChat_Prompt::INTERPRETING_FIELDS : ContextChat_Prompt::TRANSLATION_FIELDS;
		$fields  = isset( $input['fields'] ) && is_array( $input['fields'] ) ? $input['fields'] : array();
		$saved   = array();
		$ignored = array();
		foreach ( $fields as $key => $value ) {
			if ( ! in_array( $key, $allowed, true ) ) {
				$ignored[] = (string) $key;
				continue;
			}
			$clean = self::clean_field( $key, $value );
			if ( null === $clean ) {
				$ignored[] = (string) $key;
				continue;
			}
			$state['intake'][ $key ] = $clean;
			$saved[]                 = $key;
		}
		$required = 'interpreting' === $state['service'] ? ContextChat_Prompt::INTERPRETING_REQUIRED : ContextChat_Prompt::TRANSLATION_REQUIRED;
		return array(
			'saved'   => $saved,
			'ignored' => $ignored,
			'missing' => array_values( array_diff( $required, array_keys( $state['intake'] ) ) ),
		);
	}

	/**
	 * One intake value, cleaned, or null when it does not fit the field.
	 *
	 * @param string $key   Field.
	 * @param mixed  $value Value.
	 * @return mixed
	 */
	private static function clean_field( $key, $value ) {
		$text = function ( $v, $max = 200 ) {
			$v = is_scalar( $v ) ? trim( preg_replace( '/[\x00-\x1F\x7F<>]+/u', ' ', (string) $v ) ) : '';
			return mb_substr( $v, 0, $max, 'UTF-8' );
		};
		if ( ! is_scalar( $value ) && 'document_types' !== $key ) {
			return null;
		}
		switch ( $key ) {
			case 'documents_count':
			case 'pages_count':
				$n = is_numeric( $value ) ? (int) $value : 0;
				return ( $n >= 1 && $n <= ContextChat_Price_Engine::MAX_COUNT ) ? $n : null;
			case 'sworn':
				if ( is_bool( $value ) ) {
					return $value;
				}
				$v = strtolower( (string) $value );
				return in_array( $v, array( 'true', 'yes', 'ya', '1', 'sworn', 'tersumpah' ), true ) ? true : ( in_array( $v, array( 'false', 'no', 'tidak', '0', 'regular', 'reguler' ), true ) ? false : null );
			case 'source_lang':
			case 'target_lang':
				$v = strtolower( trim( (string) $value ) );
				return in_array( $v, ContextChat_Price_Engine::LANGS, true ) ? $v : null;
			case 'matter':
			case 'payment_account':
				$v = strtolower( (string) $value );
				return in_array( $v, array( 'personal', 'corporate' ), true ) ? $v : null;
			case 'speed':
				return in_array( (string) $value, ContextChat_Price_Engine::SPEEDS, true ) ? (string) $value : null;
			case 'legalisation':
				return in_array( (string) $value, array( 'none', 'apostille', 'ministry_embassy' ), true ) ? (string) $value : null;
			case 'document_types':
				$list = is_array( $value ) ? array_filter( $value, 'is_scalar' ) : preg_split( '/\s*[,;]\s*/', (string) $value );
				$list = array_values( array_filter( array_map( $text, array_slice( (array) $list, 0, 20 ) ) ) );
				return $list ? $list : null;
			default:
				$v = $text( $value );
				return '' === $v ? null : $v;
		}
	}
}

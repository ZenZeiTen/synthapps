<?php
/**
 * Model routing: which Claude model answers, and when to try the stronger one.
 *
 * In automatic mode a fast, low-cost model (Claude Haiku 5.5 by default) answers first. The
 * stronger model (Claude Sonnet 5.5 by default) is asked once when the fast model's reply
 * cannot be used:
 *
 *  - the reply fails ContextChat's checks (the accept callback rejects it),
 *  - the model declined to answer (stop_reason "refusal"),
 *  - the reply was cut off before any text (stop_reason "max_tokens"), or finished empty,
 *  - the configured fast model does not exist (404).
 *
 * Problems another model cannot fix stop routing at once: a wrong API key, a malformed
 * request, the Anthropic account's spend limit, and the site's own daily cap. A busy or
 * failing API (429, 5xx, timeouts) is retried once on the same model after a short pause,
 * as the design plan says, and then reported.
 *
 * Pure PHP with no WordPress calls: the client, the spend meter and the pause are passed in,
 * so the routing can be unit tested with fakes.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Model router.
 */
class ContextChat_SI_Router {

	/** Routing modes. */
	const MODES = array( 'auto', 'worker_only', 'executor_only' );

	/** Outcomes after which the next model is tried. */
	const ESCALATE = array( 'rejected', 'refusal', 'truncated', 'empty', 'model_not_found' );

	/** Models that accept server-side refusal fallbacks ("fallbacks": "default"). */
	const FALLBACK_MODELS = array( 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2' );

	const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

	/** Client with send( array $body, array $betas ). @var object */
	private $client;

	/** Configuration. @var array */
	private $config;

	/** Spend meter with spent_today() and add( int $micro_usd ). @var object */
	private $meter;

	/** Pause before a retry; receives seconds. @var callable */
	private $sleep;

	/**
	 * Router.
	 *
	 * @param object        $client Messages client.
	 * @param array         $config mode, worker, executor, effort, max_tokens, cap_micro_usd, prices.
	 * @param object        $meter  Spend meter.
	 * @param callable|null $sleep  Pause function, `sleep` by default.
	 */
	public function __construct( $client, array $config, $meter, $sleep = null ) {
		$this->client = $client;
		$this->config = array_merge(
			array(
				'mode'          => 'auto',
				'worker'        => 'claude-haiku-5-5',
				'executor'      => 'claude-sonnet-5-5',
				'effort'        => 'low',
				'max_tokens'    => 1024,
				'cap_micro_usd' => 10000000,
				'prices'        => ContextChat_SI_Pricing::table(),
			),
			$config
		);
		$this->meter  = $meter;
		$this->sleep  = $sleep ? $sleep : 'sleep';
	}

	/**
	 * Models to try, in order, for the configured mode.
	 *
	 * @return string[]
	 */
	public function plan() {
		$c = $this->config;
		if ( 'worker_only' === $c['mode'] ) {
			return array( $c['worker'] );
		}
		if ( 'executor_only' === $c['mode'] ) {
			return array( $c['executor'] );
		}
		return array_values( array_unique( array( $c['worker'], $c['executor'] ) ) );
	}

	/**
	 * Get one reply, choosing the model.
	 *
	 * @param array         $request system (string), messages (array) and optionally tools.
	 * @param callable|null $accept  Receives ( string $text, string $model ). Returns true to
	 *                               accept the reply, or a short reason string to reject it.
	 * @return array{ok: bool, text: string, model: string, error: string, cost_micro_usd: int, attempts: array, response: array}
	 */
	public function route( array $request, $accept = null ) {
		$result = array(
			'ok'             => false,
			'text'           => '',
			'model'          => '',
			'error'          => '',
			'cost_micro_usd' => 0,
			'attempts'       => array(),
			'response'       => array(),
		);
		$note   = '';

		foreach ( $this->plan() as $model ) {
			if ( $this->over_cap() ) {
				$result['error'] = 'cap_reached';
				return $result;
			}

			$attempt                   = $this->attempt( $model, $request, $note );
			$result['cost_micro_usd'] += $attempt['cost_micro_usd'];

			if ( 'ok' === $attempt['outcome'] ) {
				$verdict = $accept ? call_user_func( $accept, $attempt['text'], $attempt['model'] ) : true;
				if ( true === $verdict ) {
					$result['attempts'][] = self::summary( $attempt );
					$result['ok']         = true;
					$result['error']      = '';
					$result['text']       = $attempt['text'];
					$result['model']      = $attempt['model'];
					$result['response']   = $attempt['response'];
					return $result;
				}
				$attempt['outcome'] = 'rejected';
				$attempt['reason']  = is_string( $verdict ) && '' !== $verdict ? $verdict : 'check_failed';
				$note               = $attempt['reason'];
			}

			$result['attempts'][] = self::summary( $attempt );
			$result['error']      = $attempt['outcome'];
			if ( ! in_array( $attempt['outcome'], self::ESCALATE, true ) ) {
				return $result;
			}
		}

		return $result;
	}

	/**
	 * One model: send, retry once on a transient failure, and classify the outcome.
	 *
	 * @param string $model   Model.
	 * @param array  $request Request.
	 * @param string $note    Why the previous model's reply was rejected, or ''.
	 * @return array
	 */
	private function attempt( $model, array $request, $note ) {
		$c    = $this->config;
		$body = array(
			'model'         => $model,
			'max_tokens'    => (int) $c['max_tokens'],
			'messages'      => isset( $request['messages'] ) ? $request['messages'] : array(),
			'output_config' => array( 'effort' => $c['effort'] ),
		);
		$system = isset( $request['system'] ) ? (string) $request['system'] : '';
		if ( '' !== $note ) {
			$system .= ( '' !== $system ? "\n\n" : '' ) . 'A previous draft of this reply was rejected by an automatic check (' . $note . '). Write a new reply that avoids the problem.';
		}
		if ( '' !== $system ) {
			$body['system'] = $system;
		}
		if ( ! empty( $request['tools'] ) ) {
			$body['tools'] = $request['tools'];
		}
		$betas = array();
		if ( in_array( $model, self::FALLBACK_MODELS, true ) ) {
			$body['fallbacks'] = 'default';
			$betas[]           = self::FALLBACK_BETA;
		}

		$started = microtime( true );
		$calls   = 0;
		$cost    = 0;
		do {
			++$calls;
			$res      = $this->client->send( $body, $betas );
			$data     = $res['data'];
			$served   = isset( $data['model'] ) ? (string) $data['model'] : $model;
			$usage    = isset( $data['usage'] ) && is_array( $data['usage'] ) ? $data['usage'] : array();
			$charged  = ContextChat_SI_Pricing::cost_micro_usd( $served, $usage, $c['prices'] );
			if ( 0 === (int) $res['status'] ) {
				// No answer (timeout): Anthropic may still have produced and billed the reply, so
				// count the worst case, a full-length reply, toward the cap.
				$charged = ContextChat_SI_Pricing::cost_micro_usd(
					$model,
					array(
						'input_tokens'  => (int) ceil( strlen( (string) json_encode( $body ) ) / 3 ), // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode -- pure PHP class, no WordPress loaded in its tests.
						'output_tokens' => (int) $c['max_tokens'],
					),
					$c['prices']
				);
			}
			$cost    += $charged;
			if ( $charged > 0 ) {
				$this->meter->add( $charged );
			}
			$outcome = self::classify( $res );
			if ( 'transient' === $outcome && $calls < 2 ) {
				call_user_func( $this->sleep, $res['retry_after'] > 0 ? min( 5, $res['retry_after'] ) : 2 );
				continue;
			}
			break;
		} while ( true );

		if ( 'transient' === $outcome ) {
			$outcome = 'unavailable';
		}

		return array(
			'model'          => $model,
			'served_by'      => $served,
			'outcome'        => $outcome,
			'reason'         => '',
			'status'         => $res['status'],
			'calls'          => $calls,
			'ms'             => (int) round( ( microtime( true ) - $started ) * 1000 ),
			'text'           => 'ok' === $outcome ? self::text_of( $data ) : '',
			'usage'          => $usage,
			'cost_micro_usd' => $cost,
			'response'       => 'ok' === $outcome ? $data : array(),
		);
	}

	/**
	 * Sort a response into an outcome.
	 *
	 * @param array $res Client result.
	 * @return string ok | refusal | truncated | transient | spend_limit | auth_error | model_not_found | invalid_request | error
	 */
	public static function classify( array $res ) {
		$status = (int) $res['status'];
		if ( 200 === $status ) {
			$stop = isset( $res['data']['stop_reason'] ) ? $res['data']['stop_reason'] : '';
			if ( 'refusal' === $stop ) {
				return 'refusal';
			}
			$empty = '' === self::text_of( $res['data'] );
			if ( 'max_tokens' === $stop && $empty ) {
				return 'truncated';
			}
			if ( $empty && in_array( $stop, array( 'end_turn', 'stop_sequence' ), true ) ) {
				return 'empty';
			}
			return 'ok';
		}
		if ( 429 === $status && 'enforced_spend_limit_reached' === $res['error_code'] ) {
			return 'spend_limit';
		}
		if ( 0 === $status || 429 === $status || $status >= 500 ) {
			return 'transient';
		}
		if ( 401 === $status || 403 === $status ) {
			return 'auth_error';
		}
		if ( 404 === $status ) {
			return 'model_not_found';
		}
		if ( 400 === $status || 413 === $status ) {
			return 'invalid_request';
		}
		return 'error';
	}

	/**
	 * The reply text: every text block, joined. Thinking and tool blocks are left out.
	 *
	 * @param array $data Response body.
	 * @return string
	 */
	public static function text_of( array $data ) {
		$parts = array();
		foreach ( isset( $data['content'] ) && is_array( $data['content'] ) ? $data['content'] : array() as $block ) {
			if ( is_array( $block ) && isset( $block['type'], $block['text'] ) && 'text' === $block['type'] ) {
				$parts[] = (string) $block['text'];
			}
		}
		return trim( implode( "\n\n", $parts ) );
	}

	/**
	 * Has today's spending reached the cap?
	 *
	 * @return bool
	 */
	private function over_cap() {
		$cap = (int) $this->config['cap_micro_usd'];
		return $cap > 0 && (int) $this->meter->spent_today() >= $cap;
	}

	/**
	 * What to report about an attempt (no reply text, no usage beyond token counts).
	 *
	 * @param array $a Attempt.
	 * @return array
	 */
	private static function summary( array $a ) {
		$u = $a['usage'];
		return array(
			'model'          => $a['model'],
			'served_by'      => $a['served_by'],
			'outcome'        => $a['outcome'],
			'reason'         => $a['reason'],
			'status'         => $a['status'],
			'calls'          => $a['calls'],
			'ms'             => $a['ms'],
			'input_tokens'   => isset( $u['input_tokens'] ) ? (int) $u['input_tokens'] : 0,
			'output_tokens'  => isset( $u['output_tokens'] ) ? (int) $u['output_tokens'] : 0,
			'cost_micro_usd' => $a['cost_micro_usd'],
		);
	}
}

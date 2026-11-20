<?php
/**
 * SI (Synthesized Intelligence) for ContextChat 2.0: settings, the daily spend meter, the
 * model router and the admin connection test.
 *
 * Nothing here runs for visitors yet. The SI chat arrives in a later 2.0 update; until then a
 * request reaches Anthropic only when an administrator presses "Test connection".
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * SI facade.
 */
class ContextChat_SI {

	/** Option with today's spend. Not autoloaded. */
	const USAGE_OPTION = 'contextchat_si_usage';

	/** Efforts offered in settings. A chat reply needs no more than "high". */
	const EFFORTS = array( 'low', 'medium', 'high' );

	/** Default models: a fast one for every reply, a stronger one for retries. */
	const DEFAULT_WORKER   = 'claude-haiku-5-5';
	const DEFAULT_EXECUTOR = 'claude-sonnet-5-5';

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
	}

	/**
	 * Router configuration from the saved settings.
	 *
	 * @return array
	 */
	public static function config() {
		$s = ContextChat_Settings::get();

		/**
		 * Filter the model prices (US dollars per million tokens) used for the daily cap.
		 *
		 * @param array $prices Keyed by model ID: input, output, cache_read.
		 */
		$prices = (array) apply_filters( 'contextchat_si_prices', ContextChat_SI_Pricing::table() );

		return array(
			'mode'          => $s['si_routing'],
			'worker'        => $s['si_model_worker'],
			'executor'      => $s['si_model_executor'],
			'effort'        => $s['si_effort'],
			'max_tokens'    => (int) $s['si_max_tokens'],
			'cap_micro_usd' => (int) $s['si_daily_cap_cents'] * 10000,
			'prices'        => $prices,
		);
	}

	/**
	 * A router using the saved key and settings, or null when there is no usable key.
	 *
	 * @return ContextChat_SI_Router|null
	 */
	public static function router() {
		$key = ContextChat_SI_Secrets::get_key();
		if ( '' === $key ) {
			return null;
		}

		/**
		 * Filter the Messages API endpoint, for example to point it at a test double.
		 *
		 * @param string $url Endpoint.
		 */
		$url = (string) apply_filters( 'contextchat_si_api_url', ContextChat_SI_Client::API_URL );
		// The key travels in a header, so never over plain HTTP, except to this machine.
		$parts = wp_parse_url( $url );
		$local = isset( $parts['host'] ) && in_array( $parts['host'], array( '127.0.0.1', 'localhost', '::1' ), true );
		if ( ! isset( $parts['scheme'] ) || ( 'https' !== $parts['scheme'] && ! $local ) ) {
			$url = ContextChat_SI_Client::API_URL;
		}

		return new ContextChat_SI_Router( new ContextChat_SI_Client( $key, $url ), self::config(), new self() );
	}

	/**
	 * Micro-dollars spent today, in the site time zone. Used by the router as its meter.
	 *
	 * @return int
	 */
	public function spent_today() {
		$u = get_option( self::USAGE_OPTION );
		return is_array( $u ) && isset( $u['day'], $u['micro_usd'] ) && self::today() === $u['day'] ? (int) $u['micro_usd'] : 0;
	}

	/**
	 * Add to today's spend.
	 *
	 * @param int $micro_usd Cost.
	 */
	public function add( $micro_usd ) {
		$u = get_option( self::USAGE_OPTION );
		if ( ! is_array( $u ) || ! isset( $u['day'] ) || self::today() !== $u['day'] ) {
			$u = array(
				'day'       => self::today(),
				'micro_usd' => 0,
				'calls'     => 0,
			);
		}
		$u['micro_usd'] += max( 0, (int) $micro_usd );
		++$u['calls'];
		if ( false === get_option( self::USAGE_OPTION ) ) {
			add_option( self::USAGE_OPTION, $u, '', 'no' );
		} else {
			update_option( self::USAGE_OPTION, $u, false );
		}
	}

	/**
	 * Today's date in the site time zone.
	 *
	 * @return string
	 */
	private static function today() {
		return ( new DateTimeImmutable( 'now', wp_timezone() ) )->format( 'Y-m-d' );
	}

	/**
	 * REST routes.
	 */
	public static function routes() {
		register_rest_route(
			'contextchat/v1',
			'/admin/si-test',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'test' ),
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' );
				},
				'args'                => array(
					'prompt'          => array(
						'type'      => 'string',
						'required'  => true,
						'minLength' => 1,
						'maxLength' => 500,
					),
					'simulate_reject' => array(
						'type'    => 'boolean',
						'default' => false,
					),
				),
			)
		);
	}

	/**
	 * Admin connection test: send one message through the router with the saved settings.
	 *
	 * With simulate_reject, the first model's reply is rejected as if it had failed a check,
	 * which shows the retry model at work.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function test( WP_REST_Request $request ) {
		$router = self::router();
		if ( ! $router ) {
			return new WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'no_key',
				),
				200
			);
		}

		$reject = (bool) $request['simulate_reject'];
		$first  = true;
		$result = $router->route(
			array(
				'system'   => 'You are the connection test for a website chat. Reply in one short, friendly sentence, in the language of the message.',
				'messages' => array(
					array(
						'role'    => 'user',
						'content' => sanitize_textarea_field( (string) $request['prompt'] ),
					),
				),
			),
			static function () use ( $reject, &$first ) {
				if ( $reject && $first ) {
					$first = false;
					return 'simulated failed check';
				}
				return true;
			}
		);
		$meter = new self();

		return new WP_REST_Response(
			array(
				'ok'             => $result['ok'],
				'error'          => $result['error'],
				'model'          => $result['model'],
				'reply'          => $result['text'],
				'attempts'       => $result['attempts'],
				'cost_micro_usd' => $result['cost_micro_usd'],
				'spent_today'    => $meter->spent_today(),
				'cap_micro_usd'  => self::config()['cap_micro_usd'],
			),
			200
		);
	}
}

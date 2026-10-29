<?php
/**
 * Claude, through the Anthropic Messages API.
 *
 * Uses WordPress's own HTTP API rather than the Anthropic PHP SDK: the SDK needs PHP 8.1 and
 * Composer packages that would clash with other plugins loading different versions of the same
 * libraries, which is a common cause of fatal errors on WordPress sites.
 *
 * @package Corbelwise\Toolkit
 */

namespace Corbelwise\Toolkit;

defined( 'ABSPATH' ) || exit;

/**
 * Anthropic Messages API client.
 */
class Anthropic implements Provider {

	const ENDPOINT = 'https://api.anthropic.com/v1/messages';
	const VERSION  = '2026-10-21';

	/**
	 * Models that accept server-side refusal fallbacks ("fallbacks": "default").
	 */
	const FALLBACK_MODELS = array( 'claude-opus-5-5', 'claude-sonnet-5-5' );

	/**
	 * API key.
	 *
	 * @var string
	 */
	private $key;

	/**
	 * Constructor.
	 *
	 * @param string $key API key.
	 */
	public function __construct( $key ) {
		$this->key = (string) $key;
	}

	/**
	 * Models offered in the settings, id => label.
	 *
	 * @return array<string, string>
	 */
	public static function models() {
		$models = array(
			'claude-opus-5-5'   => __( 'Claude Opus 5.5: best quality', 'corbelwise-toolkit' ),
			'claude-sonnet-5-5' => __( 'Claude Sonnet 5.5: balanced quality and cost', 'corbelwise-toolkit' ),
			'claude-haiku-5-5'  => __( 'Claude Haiku 5.5: fastest and lowest cost', 'corbelwise-toolkit' ),
		);
		/**
		 * Filters the models offered on the settings screen.
		 *
		 * @param array<string, string> $models Model id => label.
		 */
		return (array) apply_filters( 'cwtk_ai_models', $models );
	}

	/**
	 * Build the HTTP request for a completion.
	 *
	 * @param array $request See Provider::complete().
	 * @return array{headers: array<string, string>, body: array}
	 */
	public function build( array $request ) {
		$model = isset( $request['model'] ) ? (string) $request['model'] : 'claude-opus-5-5';
		$body  = array(
			'model'      => $model,
			'max_tokens' => isset( $request['max_tokens'] ) ? (int) $request['max_tokens'] : 4096,
			'messages'   => array_values( $request['messages'] ),
		);
		if ( ! empty( $request['system'] ) ) {
			$body['system'] = (string) $request['system'];
		}
		if ( ! empty( $request['effort'] ) ) {
			$body['output_config'] = array( 'effort' => (string) $request['effort'] );
		}
		$headers = array(
			'content-type'      => 'application/json',
			'x-api-key'         => $this->key,
			'anthropic-version' => self::VERSION,
		);
		if ( in_array( $model, self::FALLBACK_MODELS, true ) ) {
			// When a safety classifier declines a request, the API retries it on the model
			// Anthropic recommends for that case instead of returning the refusal.
			$body['fallbacks']        = 'default';
			$headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
		}
		return array(
			'headers' => $headers,
			'body'    => $body,
		);
	}

	/** {@inheritDoc} */
	public function complete( array $request ) {
		if ( '' === $this->key ) {
			return new \WP_Error( 'cwtk_ai_no_key', __( 'No Anthropic API key is set.', 'corbelwise-toolkit' ) );
		}
		$http = $this->build( $request );
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 150 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- not allowed on every host.
		}
		$response = wp_remote_post(
			self::ENDPOINT,
			array(
				'timeout'     => isset( $request['timeout'] ) ? (int) $request['timeout'] : 120,
				'headers'     => $http['headers'],
				'body'        => wp_json_encode( $http['body'] ),
				'data_format' => 'body',
			)
		);
		return self::parse( $response );
	}

	/**
	 * Turn an HTTP response into a result or an error.
	 *
	 * @param array|\WP_Error $response Response from wp_remote_post().
	 * @return array|\WP_Error
	 */
	public static function parse( $response ) {
		if ( is_wp_error( $response ) ) {
			return new \WP_Error( 'cwtk_ai_unreachable', __( 'Could not reach the AI service. Please try again.', 'corbelwise-toolkit' ), array( 'detail' => $response->get_error_message() ) );
		}
		$code = (int) wp_remote_retrieve_response_code( $response );
		$data = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		$data = is_array( $data ) ? $data : array();

		if ( 200 !== $code ) {
			$detail = isset( $data['error']['message'] ) ? (string) $data['error']['message'] : '';
			if ( 401 === $code || 403 === $code ) {
				return new \WP_Error( 'cwtk_ai_auth', __( 'The AI service refused the API key. Check the key in Corbelwise → AI assistant.', 'corbelwise-toolkit' ), array( 'status' => $code, 'detail' => $detail ) );
			}
			if ( 429 === $code ) {
				return new \WP_Error( 'cwtk_ai_busy', __( 'The AI service is receiving too many requests from this site. Please try again in a minute.', 'corbelwise-toolkit' ), array( 'status' => $code, 'detail' => $detail ) );
			}
			if ( $code >= 500 ) {
				return new \WP_Error( 'cwtk_ai_busy', __( 'The AI service is busy. Please try again shortly.', 'corbelwise-toolkit' ), array( 'status' => $code, 'detail' => $detail ) );
			}
			/* translators: %d: HTTP status code. */
			return new \WP_Error( 'cwtk_ai_request', sprintf( __( 'The AI request failed (error %d).', 'corbelwise-toolkit' ), $code ), array( 'status' => $code, 'detail' => $detail ) );
		}

		$stop = isset( $data['stop_reason'] ) ? (string) $data['stop_reason'] : '';
		if ( 'refusal' === $stop ) {
			return new \WP_Error( 'cwtk_ai_refused', __( 'The AI declined this request. Try rephrasing it.', 'corbelwise-toolkit' ) );
		}

		// Only text blocks form the answer; thinking blocks and other block types are skipped.
		$text = '';
		foreach ( isset( $data['content'] ) && is_array( $data['content'] ) ? $data['content'] : array() as $block ) {
			if ( isset( $block['type'], $block['text'] ) && 'text' === $block['type'] ) {
				$text .= $block['text'];
			}
		}
		$text = trim( $text );
		if ( '' === $text ) {
			return new \WP_Error( 'cwtk_ai_empty', __( 'The AI returned no text. Please try again.', 'corbelwise-toolkit' ) );
		}

		return array(
			'text'        => $text,
			'model'       => isset( $data['model'] ) ? (string) $data['model'] : '',
			'stop_reason' => $stop,
			'usage'       => array(
				'input'  => isset( $data['usage']['input_tokens'] ) ? (int) $data['usage']['input_tokens'] : 0,
				'output' => isset( $data['usage']['output_tokens'] ) ? (int) $data['usage']['output_tokens'] : 0,
			),
		);
	}
}

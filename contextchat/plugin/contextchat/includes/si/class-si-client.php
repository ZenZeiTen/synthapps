<?php
/**
 * A minimal client for the Claude Messages API, over WordPress's HTTP API.
 *
 * WordPress plugins run on ordinary PHP hosting without Composer, so this uses
 * wp_remote_post() instead of the Anthropic PHP SDK.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Messages API client.
 */
class ContextChat_SI_Client {

	const API_URL     = 'https://api.anthropic.com/v1/messages';
	const API_VERSION = '2026-10-21';
	const TIMEOUT     = 20;

	/** API key. @var string */
	private $key;

	/** Endpoint. @var string */
	private $url;

	/**
	 * Client.
	 *
	 * @param string $key API key.
	 * @param string $url Endpoint; defaults to the Anthropic API.
	 */
	public function __construct( $key, $url = '' ) {
		$this->key = (string) $key;
		$this->url = '' !== $url ? (string) $url : self::API_URL;
	}

	/**
	 * Send one Messages request.
	 *
	 * @param array $body  Request body.
	 * @param array $betas Beta flags for the anthropic-beta header.
	 * @return array{status: int, data: array, error_type: string, error_code: string, retry_after: int}
	 *               status 0 means the request never got an HTTP answer (timeout, DNS, TLS).
	 */
	public function send( array $body, array $betas = array() ) {
		$headers = array(
			'content-type'      => 'application/json',
			'x-api-key'         => $this->key,
			'anthropic-version' => self::API_VERSION,
		);
		if ( $betas ) {
			$headers['anthropic-beta'] = implode( ',', $betas );
		}

		$response = wp_remote_post(
			$this->url,
			array(
				'timeout'     => self::TIMEOUT,
				'redirection' => 0,
				'headers'     => $headers,
				'body'        => wp_json_encode( $body ),
				'user-agent'  => 'ContextChat/' . CONTEXTCHAT_VERSION . ' (WordPress)',
			)
		);

		if ( is_wp_error( $response ) ) {
			// Only the error code: transport messages can contain the full URL.
			return array(
				'status'      => 0,
				'data'        => array(),
				'error_type'  => 'transport_error',
				'error_code'  => (string) $response->get_error_code(),
				'retry_after' => 0,
			);
		}

		$data = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		$data = is_array( $data ) ? $data : array();
		$err  = isset( $data['error'] ) && is_array( $data['error'] ) ? $data['error'] : array();

		return array(
			'status'      => (int) wp_remote_retrieve_response_code( $response ),
			'data'        => $data,
			'error_type'  => isset( $err['type'] ) ? (string) $err['type'] : '',
			'error_code'  => isset( $err['details']['error_code'] ) ? (string) $err['details']['error_code'] : '',
			'retry_after' => (int) wp_remote_retrieve_header( $response, 'retry-after' ),
		);
	}
}

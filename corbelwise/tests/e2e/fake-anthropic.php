<?php
/**
 * Plugin Name: Fake Anthropic API (tests only)
 * Description: Answers requests to api.anthropic.com with canned replies, so the AI features can be
 * tested without a key, network access or cost. Records the last request for assertions.
 */

add_filter(
	'pre_http_request',
	static function ( $pre, $args, $url ) {
		if ( 0 !== strpos( $url, 'https://api.anthropic.com/' ) ) {
			return $pre;
		}
		$body = json_decode( (string) $args['body'], true );
		update_option( 'cwtk_test_last_request', array( 'headers' => $args['headers'], 'body' => $body ), false );

		$last = '';
		foreach ( (array) $body['messages'] as $message ) {
			$last = is_string( $message['content'] ) ? $message['content'] : '';
		}
		$system = isset( $body['system'] ) ? (string) $body['system'] : '';

		$respond = static function ( $code, $data ) {
			return array(
				'headers'  => array( 'content-type' => 'application/json' ),
				'body'     => wp_json_encode( $data ),
				'response' => array( 'code' => $code, 'message' => 'X' ),
				'cookies'  => array(),
				'filename' => null,
			);
		};

		if ( false !== strpos( $last, 'TRIGGER-500' ) ) {
			return $respond( 500, array( 'type' => 'error', 'error' => array( 'type' => 'api_error', 'message' => 'Internal error' ) ) );
		}
		if ( false !== strpos( $last, 'TRIGGER-401' ) ) {
			return $respond( 401, array( 'type' => 'error', 'error' => array( 'type' => 'authentication_error', 'message' => 'invalid x-api-key' ) ) );
		}
		if ( false !== strpos( $last, 'TRIGGER-REFUSAL' ) ) {
			return $respond( 200, array( 'type' => 'message', 'model' => $body['model'], 'stop_reason' => 'refusal', 'content' => array(), 'usage' => array( 'input_tokens' => 5, 'output_tokens' => 0 ) ) );
		}

		if ( false !== strpos( $system, 'answering questions from visitors' ) ) {
			$text = 'We are open Monday to Friday, 9:00 to 17:00. You can reach us through ' . home_url( '/contact/' ) . ' any time.';
		} elseif ( false !== strpos( $last, 'Suggest five different titles' ) ) {
			$text = "1. Five questions to ask first\n2. \"Hiring without regrets\"\n- A checklist for choosing well\nPicking the right partner\nWhat to ask before you hire";
		} elseif ( false !== strpos( $last, 'search engine description' ) ) {
			$text = '"A short, practical checklist that helps you choose the right partner for your next project."';
		} elseif ( false !== strpos( $last, 'summary of the text' ) ) {
			$text = 'A short checklist for choosing the right partner.';
		} else {
			$text = "<h2>Start with the goal</h2>\n<p>Agree on what success looks like.</p><script>alert(1)</script>\n<ul><li>Write it down</li></ul>";
		}

		return $respond(
			200,
			array(
				'type'        => 'message',
				'model'       => $body['model'],
				'stop_reason' => 'end_turn',
				'content'     => array(
					array( 'type' => 'thinking', 'thinking' => '', 'signature' => 'x' ),
					array( 'type' => 'text', 'text' => $text ),
				),
				'usage'       => array( 'input_tokens' => 100, 'output_tokens' => 40 ),
			)
		);
	},
	10,
	3
);

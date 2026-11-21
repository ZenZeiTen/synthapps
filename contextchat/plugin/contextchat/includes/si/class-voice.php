<?php
/**
 * The SI's house voice (design plan sections 6.2 and 6.7): the voice guide, examples, the fixed
 * replies used when the model is not asked or cannot be trusted, extra banned words and the
 * staff-name list the reply checker blocks.
 *
 * Stored in one option that is not autoloaded and edited under ContextChat → Voice. Fields left
 * empty fall back to the bundled defaults in data/voice.nusalexia.json.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Voice settings.
 */
class ContextChat_Voice {

	/** Option holding the voice settings. */
	const OPTION = 'contextchat_si_voice';

	/** Most examples kept. */
	const MAX_EXAMPLES = 20;

	/** Bundled defaults, loaded once. @var array|null */
	private static $defaults = null;

	/**
	 * Register the option in the settings form.
	 */
	public static function register() {
		register_setting(
			'contextchat',
			self::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( __CLASS__, 'sanitize_option' ),
				'default'           => array(),
				'show_in_rest'      => false,
			)
		);
	}

	/**
	 * The bundled defaults.
	 *
	 * @return array
	 */
	public static function defaults() {
		if ( null === self::$defaults ) {
			$data           = json_decode( (string) file_get_contents( dirname( __DIR__, 2 ) . '/data/voice.nusalexia.json' ), true );
			self::$defaults = is_array( $data ) ? $data : array();
		}
		return self::$defaults;
	}

	/**
	 * Settings in use: saved values over the defaults.
	 *
	 * @return array guide (id/en), examples, templates (key => id/en), banned_words, names.
	 */
	public static function get() {
		$d      = self::defaults();
		$stored = function_exists( 'get_option' ) ? get_option( self::OPTION ) : false;
		$stored = is_array( $stored ) ? $stored : array();
		$out    = array(
			'guide'        => $d['guide'],
			'examples'     => $d['examples'],
			'templates'    => $d['templates'],
			'banned_words' => $d['banned_words'],
			'names'        => $d['names'],
		);
		foreach ( array( 'id', 'en' ) as $lang ) {
			if ( ! empty( $stored['guide'][ $lang ] ) ) {
				$out['guide'][ $lang ] = $stored['guide'][ $lang ];
			}
		}
		if ( isset( $stored['examples'] ) && is_array( $stored['examples'] ) && $stored['examples'] ) {
			$out['examples'] = $stored['examples'];
		}
		foreach ( $out['templates'] as $key => $texts ) {
			foreach ( array( 'id', 'en' ) as $lang ) {
				if ( ! empty( $stored['templates'][ $key ][ $lang ] ) ) {
					$out['templates'][ $key ][ $lang ] = $stored['templates'][ $key ][ $lang ];
				}
			}
		}
		foreach ( array( 'banned_words', 'names' ) as $list ) {
			if ( isset( $stored[ $list ] ) && is_array( $stored[ $list ] ) ) {
				$out[ $list ] = $stored[ $list ];
			}
		}
		return $out;
	}

	/**
	 * One fixed reply in a language.
	 *
	 * @param string $key  Template key, e.g. 'busy'.
	 * @param string $lang 'id' or 'en'.
	 * @return string
	 */
	public static function template( $key, $lang ) {
		$t    = self::get()['templates'];
		$lang = 'en' === $lang ? 'en' : 'id';
		return isset( $t[ $key ][ $lang ] ) ? (string) $t[ $key ][ $lang ] : '';
	}

	/**
	 * Sanitize callback. Already-clean values (a second pass) keep their shape.
	 *
	 * @param mixed $input Posted value.
	 * @return array
	 */
	public static function sanitize_option( $input ) {
		if ( ! is_array( $input ) ) {
			return array();
		}
		$clean_pass = ! isset( $input['form'] );
		if ( ! $clean_pass ) {
			$input = wp_unslash( $input );
		}
		if ( ! empty( $input['reset'] ) ) {
			return array();
		}
		$d   = self::defaults();
		$out = array(
			'guide'        => array(),
			'examples'     => array(),
			'templates'    => array(),
			'banned_words' => array(),
			'names'        => array(),
		);
		foreach ( array( 'id', 'en' ) as $lang ) {
			$guide = isset( $input['guide'][ $lang ] ) ? ContextChat_Knowledge::text( $input['guide'][ $lang ], 6000, true ) : '';
			if ( '' !== $guide && $guide !== $d['guide'][ $lang ] ) {
				$out['guide'][ $lang ] = $guide;
			}
		}
		$examples = isset( $input['examples'] ) && is_array( $input['examples'] ) ? array_values( $input['examples'] ) : array();
		foreach ( $examples as $ex ) {
			$reply = isset( $ex['reply'] ) ? ContextChat_Knowledge::text( $ex['reply'], 1200, false ) : '';
			if ( '' === $reply || count( $out['examples'] ) >= self::MAX_EXAMPLES ) {
				continue;
			}
			$out['examples'][] = array(
				'situation' => isset( $ex['situation'] ) ? ContextChat_Knowledge::text( $ex['situation'], 150, false ) : '',
				'lang'      => isset( $ex['lang'] ) && 'en' === $ex['lang'] ? 'en' : 'id',
				'reply'     => $reply,
			);
		}
		if ( $out['examples'] === $d['examples'] ) {
			$out['examples'] = array();
		}
		foreach ( $d['templates'] as $key => $texts ) {
			foreach ( array( 'id', 'en' ) as $lang ) {
				$value = isset( $input['templates'][ $key ][ $lang ] ) ? ContextChat_Knowledge::text( $input['templates'][ $key ][ $lang ], 600, false ) : '';
				if ( '' !== $value && $value !== $texts[ $lang ] ) {
					$out['templates'][ $key ][ $lang ] = $value;
				}
			}
		}
		foreach ( array( 'banned_words', 'names' ) as $list ) {
			$value = isset( $input[ $list ] ) ? $input[ $list ] : array();
			if ( is_string( $value ) ) {
				$value = preg_split( '/[\r\n,]+/', $value );
			}
			$words = array();
			foreach ( (array) $value as $word ) {
				$word = ContextChat_Knowledge::text( $word, 80, false );
				if ( '' !== $word && ! in_array( $word, $words, true ) ) {
					$words[] = $word;
				}
			}
			$out[ $list ] = array_slice( $words, 0, 200 );
		}
		return $out;
	}
}

<?php
/**
 * Settings storage: one option holding which modules are on and each module's fields.
 *
 * @package Corbelwise\Toolkit
 */

namespace Corbelwise\Toolkit;

defined( 'ABSPATH' ) || exit;

/**
 * Reads, sanitizes and saves the cwtk_settings option.
 *
 * Shape: array( 'modules' => array( id => bool ), '<module id>' => array( field => value ), 'advanced' => array(...) ).
 */
class Settings {

	const OPTION = 'cwtk_settings';

	/**
	 * Prefix of encrypted secrets.
	 */
	const SECRET_PREFIX = 'cwtk1:';

	/**
	 * Registered modules, keyed by id.
	 *
	 * @var Module[]
	 */
	private $modules = array();

	/**
	 * Cached option value.
	 *
	 * @var array|null
	 */
	private $data = null;

	/**
	 * Settings that are not tied to a module.
	 *
	 * @return array<string, array>
	 */
	public static function advanced_fields() {
		return array(
			'delete_data' => array(
				'type'    => 'checkbox',
				'label'   => __( 'Delete all toolkit settings and data when the plugin is deleted', 'corbelwise-toolkit' ),
				'help'    => __( 'Leave this off if you might reinstall the plugin. Deactivating never deletes anything.', 'corbelwise-toolkit' ),
				'default' => false,
			),
		);
	}

	/**
	 * Tell the store which modules exist, so it knows their fields and defaults.
	 *
	 * @param Module[] $modules Modules keyed by id.
	 */
	public function set_modules( array $modules ) {
		$this->modules = $modules;
	}

	/**
	 * Registered modules keyed by id.
	 *
	 * @return Module[]
	 */
	public function modules() {
		return $this->modules;
	}

	/**
	 * The raw stored option.
	 *
	 * @return array
	 */
	private function data() {
		if ( null === $this->data ) {
			$value      = get_option( self::OPTION, array() );
			$this->data = is_array( $value ) ? $value : array();
		}
		return $this->data;
	}

	/**
	 * Forget the cached option (after it changed).
	 */
	public function flush() {
		$this->data = null;
	}

	/**
	 * Whether a module is switched on.
	 *
	 * @param string $id Module id.
	 * @return bool
	 */
	public function is_enabled( $id ) {
		$data = $this->data();
		if ( isset( $data['modules'][ $id ] ) ) {
			return (bool) $data['modules'][ $id ];
		}
		return isset( $this->modules[ $id ] ) ? (bool) $this->modules[ $id ]->default_enabled() : false;
	}

	/**
	 * Fields for a settings group: a module id or 'advanced'.
	 *
	 * @param string $group Group id.
	 * @return array<string, array>
	 */
	public function fields( $group ) {
		if ( 'advanced' === $group ) {
			return self::advanced_fields();
		}
		return isset( $this->modules[ $group ] ) ? $this->modules[ $group ]->fields() : array();
	}

	/**
	 * Read one field, falling back to its default. Secrets come back decrypted.
	 *
	 * @param string $group Module id or 'advanced'.
	 * @param string $key   Field key.
	 * @return mixed
	 */
	public function get( $group, $key ) {
		$data   = $this->data();
		$fields = $this->fields( $group );
		$field  = isset( $fields[ $key ] ) ? $fields[ $key ] : array();
		if ( isset( $data[ $group ] ) && is_array( $data[ $group ] ) && array_key_exists( $key, $data[ $group ] ) ) {
			$value = $data[ $group ][ $key ];
			if ( isset( $field['type'] ) && 'secret' === $field['type'] ) {
				$value = self::decrypt( (string) $value );
			}
			return $value;
		}
		return isset( $field['default'] ) ? $field['default'] : null;
	}

	/**
	 * Sanitize a submission from one tab of the settings screen, and merge it into the stored
	 * settings so that saving one tab never resets another.
	 *
	 * @param mixed $input Submitted value.
	 * @return array
	 */
	public function sanitize( $input ) {
		$current = $this->data();
		$input   = is_array( $input ) ? $input : array();
		$tab     = isset( $input['_tab'] ) ? sanitize_key( $input['_tab'] ) : '';

		if ( 'modules' === $tab ) {
			$current['modules'] = array();
			foreach ( array_keys( $this->modules ) as $id ) {
				$current['modules'][ $id ] = ! empty( $input['modules'][ $id ] );
			}
		} elseif ( 'advanced' === $tab || isset( $this->modules[ $tab ] ) ) {
			$old    = isset( $current[ $tab ] ) && is_array( $current[ $tab ] ) ? $current[ $tab ] : array();
			$values = isset( $input[ $tab ] ) && is_array( $input[ $tab ] ) ? $input[ $tab ] : array();
			$clean  = array();
			foreach ( $this->fields( $tab ) as $key => $field ) {
				if ( isset( $field['type'] ) && 'heading' === $field['type'] ) {
					continue;
				}
				$clean[ $key ] = self::sanitize_field(
					$field,
					array_key_exists( $key, $values ) ? $values[ $key ] : null,
					array_key_exists( $key, $old ) ? $old[ $key ] : null,
					! empty( $values[ $key . '__clear' ] )
				);
			}
			$current[ $tab ] = $clean;
		}

		$this->data = $current;
		return $current;
	}

	/**
	 * Sanitize one field value by its type.
	 *
	 * @param array $field  Field definition.
	 * @param mixed $value  Submitted value (null when the field was not sent, as with an unticked box).
	 * @param mixed $old    Stored value.
	 * @param bool  $clear  For secrets: remove the stored value.
	 * @return mixed
	 */
	public static function sanitize_field( array $field, $value, $old = null, $clear = false ) {
		$type    = isset( $field['type'] ) ? $field['type'] : 'text';
		$default = isset( $field['default'] ) ? $field['default'] : '';
		$value   = is_string( $value ) ? wp_unslash( $value ) : $value;
		$max     = isset( $field['maxlength'] ) ? (int) $field['maxlength'] : 0;

		switch ( $type ) {
			case 'checkbox':
				return ! empty( $value );

			case 'number':
				$number = is_numeric( $value ) ? (int) $value : (int) $default;
				if ( isset( $field['min'] ) ) {
					$number = max( (int) $field['min'], $number );
				}
				if ( isset( $field['max'] ) ) {
					$number = min( (int) $field['max'], $number );
				}
				return $number;

			case 'select':
				$options = isset( $field['options'] ) ? array_map( 'strval', array_keys( $field['options'] ) ) : array();
				return ( is_scalar( $value ) && in_array( (string) $value, $options, true ) ) ? (string) $value : $default;

			case 'url':
				$url = is_string( $value ) ? esc_url_raw( trim( $value ), array( 'http', 'https' ) ) : '';
				return $url;

			case 'email':
				return is_string( $value ) ? sanitize_email( $value ) : '';

			case 'date':
				return ( is_string( $value ) && preg_match( '/^\d{4}-\d{2}-\d{2}$/', $value ) ) ? $value : '';

			case 'textarea':
				$text = is_string( $value ) ? sanitize_textarea_field( $value ) : '';
				return $max ? self::cut( $text, $max ) : $text;

			case 'rich':
				$allowed = array(
					'a'      => array( 'href' => true ),
					'strong' => array(),
					'em'     => array(),
				);
				$html    = is_string( $value ) ? wp_kses( $value, $allowed ) : '';
				return $max ? self::cut( $html, $max ) : $html;

			case 'secret':
				if ( $clear ) {
					return '';
				}
				$secret = is_string( $value ) ? trim( sanitize_text_field( $value ) ) : '';
				if ( '' === $secret ) {
					return is_string( $old ) ? $old : '';
				}
				return self::encrypt( $secret );

			case 'text':
			default:
				$text = is_string( $value ) ? sanitize_text_field( $value ) : '';
				return $max ? self::cut( $text, $max ) : $text;
		}
	}

	/**
	 * Shorten a string to a number of characters.
	 *
	 * @param string $text  Text.
	 * @param int    $limit Maximum characters.
	 * @return string
	 */
	public static function cut( $text, $limit ) {
		return function_exists( 'mb_substr' ) ? mb_substr( $text, 0, $limit ) : substr( $text, 0, $limit );
	}

	/**
	 * Encryption key derived from the site's secret keys in wp-config.php.
	 *
	 * @return string 32 raw bytes.
	 */
	private static function key() {
		return hash( 'sha256', 'cwtk-secret|' . wp_salt( 'auth' ), true );
	}

	/**
	 * Encrypt a secret for storage, so an API key is not readable from a database copy alone.
	 *
	 * @param string $plain Secret.
	 * @return string
	 */
	public static function encrypt( $plain ) {
		if ( '' === $plain || ! function_exists( 'sodium_crypto_secretbox' ) ) {
			return $plain;
		}
		$nonce = random_bytes( SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
		return self::SECRET_PREFIX . base64_encode( $nonce . sodium_crypto_secretbox( $plain, $nonce, self::key() ) ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- binary ciphertext.
	}

	/**
	 * Decrypt a stored secret. Values saved before encryption existed are returned as they are.
	 *
	 * @param string $stored Stored value.
	 * @return string Empty string when the value cannot be decrypted (for example after the site's keys changed).
	 */
	public static function decrypt( $stored ) {
		if ( 0 !== strpos( $stored, self::SECRET_PREFIX ) ) {
			return $stored;
		}
		if ( ! function_exists( 'sodium_crypto_secretbox_open' ) ) {
			return '';
		}
		$raw = base64_decode( substr( $stored, strlen( self::SECRET_PREFIX ) ), true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- binary ciphertext.
		if ( false === $raw || strlen( $raw ) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES ) {
			return '';
		}
		$plain = sodium_crypto_secretbox_open( substr( $raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES ), substr( $raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES ), self::key() );
		return false === $plain ? '' : $plain;
	}
}

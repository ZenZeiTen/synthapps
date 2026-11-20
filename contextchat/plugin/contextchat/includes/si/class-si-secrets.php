<?php
/**
 * The Anthropic API key: read from wp-config.php, or stored encrypted in the database.
 *
 * The key is never sent to the browser, printed on a screen, or written to a log.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * API key storage.
 */
class ContextChat_SI_Secrets {

	/** Option holding the encrypted key. Not autoloaded. */
	const OPTION = 'contextchat_si_key';

	/** A constant in wp-config.php that, when defined, wins over a stored key. */
	const CONSTANT = 'CONTEXTCHAT_ANTHROPIC_KEY';

	/**
	 * Where the key comes from.
	 *
	 * @return string constant | stored | unreadable (stored, but it can no longer be decrypted) | none
	 */
	public static function source() {
		if ( defined( self::CONSTANT ) && '' !== trim( (string) constant( self::CONSTANT ) ) ) {
			return 'constant';
		}
		$stored = get_option( self::OPTION );
		if ( ! is_array( $stored ) || empty( $stored['box'] ) ) {
			return 'none';
		}
		return '' !== self::decrypt( $stored['box'], self::secret() ) ? 'stored' : 'unreadable';
	}

	/**
	 * The key to use, or '' when there is none.
	 *
	 * @return string
	 */
	public static function get_key() {
		if ( defined( self::CONSTANT ) && '' !== trim( (string) constant( self::CONSTANT ) ) ) {
			return trim( (string) constant( self::CONSTANT ) );
		}
		$stored = get_option( self::OPTION );
		return is_array( $stored ) && ! empty( $stored['box'] ) ? self::decrypt( $stored['box'], self::secret() ) : '';
	}

	/**
	 * Date the stored key was saved (UTC, Y-m-d H:i:s), or ''.
	 *
	 * @return string
	 */
	public static function saved_at() {
		$stored = get_option( self::OPTION );
		return is_array( $stored ) && isset( $stored['saved'] ) ? (string) $stored['saved'] : '';
	}

	/**
	 * Encrypt and store a key.
	 *
	 * @param string $key API key as typed.
	 * @return true|WP_Error
	 */
	public static function save( $key ) {
		$key = trim( (string) $key );
		if ( ! self::looks_valid( $key ) ) {
			return new WP_Error( 'contextchat_si_key_format', __( 'That does not look like an Anthropic API key. Keys start with "sk-ant-" and contain no spaces.', 'contextchat' ) );
		}
		$secret = self::secret();
		if ( '' === $secret ) {
			return new WP_Error( 'contextchat_si_no_salt', __( 'This site has no unique AUTH_KEY in wp-config.php, so the key cannot be stored safely. Add the key to wp-config.php instead: define( \'CONTEXTCHAT_ANTHROPIC_KEY\', \'sk-ant-…\' );', 'contextchat' ) );
		}
		$value = array(
			'v'     => 1,
			'box'   => self::encrypt( $key, $secret ),
			'saved' => gmdate( 'Y-m-d H:i:s' ),
		);
		// Not autoloaded, so the encrypted key is only read when a request needs it.
		if ( false === get_option( self::OPTION ) ) {
			add_option( self::OPTION, $value, '', 'no' );
		} else {
			update_option( self::OPTION, $value, false );
		}
		return true;
	}

	/**
	 * Remove the stored key. A key in wp-config.php stays.
	 */
	public static function clear() {
		delete_option( self::OPTION );
	}

	/**
	 * Plausible API key: starts with "sk-ant-", printable, no spaces. Admin keys are refused,
	 * because they manage an organization and cannot send messages.
	 *
	 * @param string $key Key.
	 * @return bool
	 */
	public static function looks_valid( $key ) {
		return (bool) preg_match( '/^sk-ant-(?!admin)[A-Za-z0-9_\-]{16,250}$/', (string) $key );
	}

	/**
	 * Encrypt with libsodium's secretbox. WordPress includes a fallback when the PHP extension
	 * is missing.
	 *
	 * @param string $plain  Text.
	 * @param string $secret Secret the encryption key is derived from.
	 * @return string Base64 of nonce and ciphertext.
	 */
	public static function encrypt( $plain, $secret ) {
		$nonce = random_bytes( SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
		return base64_encode( $nonce . sodium_crypto_secretbox( (string) $plain, $nonce, self::derive( $secret ) ) ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- binary to text for storage.
	}

	/**
	 * Decrypt what encrypt() returned. Returns '' when the data or the secret is wrong.
	 *
	 * @param string $box    Base64 of nonce and ciphertext.
	 * @param string $secret Secret the encryption key is derived from.
	 * @return string
	 */
	public static function decrypt( $box, $secret ) {
		if ( '' === (string) $secret ) {
			return '';
		}
		$raw = base64_decode( (string) $box, true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- reverses encrypt().
		if ( false === $raw || strlen( $raw ) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES ) {
			return '';
		}
		$plain = sodium_crypto_secretbox_open(
			substr( $raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES ),
			substr( $raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES ),
			self::derive( $secret )
		);
		return false === $plain ? '' : $plain;
	}

	/**
	 * 32-byte encryption key from the secret.
	 *
	 * @param string $secret Secret.
	 * @return string
	 */
	private static function derive( $secret ) {
		return sodium_crypto_generichash( 'contextchat-si-key|' . $secret, '', SODIUM_CRYPTO_SECRETBOX_KEYBYTES );
	}

	/**
	 * The site's AUTH_KEY, or '' when it is missing or still the sample text.
	 *
	 * @return string
	 */
	private static function secret() {
		if ( ! defined( 'AUTH_KEY' ) ) {
			return '';
		}
		$key = (string) AUTH_KEY;
		return strlen( $key ) < 16 || false !== strpos( $key, 'put your unique phrase here' ) ? '' : $key;
	}
}

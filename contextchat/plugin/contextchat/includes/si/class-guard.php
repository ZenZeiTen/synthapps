<?php
/**
 * Guard: checks every visitor message before the model sees it (design plan section 9).
 *
 * inspect() is pure PHP: size, markup, upload attempts (data URIs, base64, file links, file-sharing
 * hosts) and personal numbers (NIK, passport, card numbers that pass the Luhn check). A blocked
 * message is never sent to the model and is not stored; only the reason is kept.
 *
 * The rate limits count per visitor address, hashed with a secret that changes every day. Raw
 * addresses are never stored.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Message checks and rate limits.
 */
class ContextChat_Guard {

	/** Longest visitor message, in characters. */
	const MAX_LENGTH = 1000;

	/** Largest request body, in bytes. */
	const MAX_BODY = 4096;

	/** Shortest time from opening the chat to the first message, in milliseconds (bot check). */
	const MIN_FIRST_MESSAGE_MS = 1500;

	/** File types a link may not point to. */
	const FILE_TYPES = array( 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', '7z', 'exe', 'apk', 'msi', 'bat', 'sh', 'js', 'php', 'html', 'htm', 'svg', 'jpg', 'jpeg', 'png', 'gif', 'heic', 'webp' );

	/** File-sharing hosts (editable under Privasi). */
	const FILE_HOSTS = array( 'drive.google.com', 'docs.google.com', 'dropbox.com', 'wetransfer.com', 'we.tl', 'mega.nz', 'onedrive.live.com', '1drv.ms', 'mediafire.com', 'icloud.com' );

	/** Default limits (section 9.1), editable under Privasi. */
	const LIMITS = array(
		'per_minute'        => 8,
		'starts_per_hour'   => 6,
		'per_day'           => 80,
		'per_conversation'  => 40,
	);

	/**
	 * Check one visitor message.
	 *
	 * @param string $text  Message as sent.
	 * @param array  $hosts File-sharing hosts to block; the default list when empty.
	 * @return array { ok: bool, block: string, text: string, flags: string[] }.
	 *               block is '', 'empty', 'too_long', 'markup', 'upload' or 'pii'.
	 *               text is the message with markup removed and spaces tidied.
	 */
	public static function inspect( $text, array $hosts = array() ) {
		$text  = (string) $text;
		$flags = array();
		if ( ! preg_match( '//u', $text ) ) {
			return self::verdict( 'markup', '', array( 'invalid_utf8' ) );
		}
		$text = str_replace( array( "\r\n", "\r" ), "\n", $text );
		$text = preg_replace( '/[\x{0000}-\x{0008}\x{000B}\x{000C}\x{000E}-\x{001F}\x{007F}\x{200B}-\x{200F}\x{2028}-\x{202E}\x{2060}-\x{2064}\x{FEFF}]/u', '', $text );
		if ( mb_strlen( $text, 'UTF-8' ) > self::MAX_LENGTH ) {
			return self::verdict( 'too_long', '', array() );
		}

		// Upload attempts are checked on the raw text, before markup is removed.
		$upload = self::upload_kind( $text, $hosts ? $hosts : self::FILE_HOSTS );
		if ( '' !== $upload ) {
			return self::verdict( 'upload', '', array( $upload ) );
		}

		// Markup: strip it and flag the message; a message that was only markup is blocked.
		if ( preg_match( '/<\s*\/?\s*[a-z!][^>]*>/i', $text ) ) {
			$flags[] = 'markup';
			$text    = preg_replace( '/<\s*(script|style)\b[^>]*>.*?<\s*\/\s*\1\s*>/is', ' ', $text );
			$text    = preg_replace( '/<\s*\/?\s*[a-z!][^>]*>/i', ' ', $text );
		}
		$text = trim( preg_replace( '/[ \t]+/', ' ', preg_replace( "/\n{3,}/", "\n\n", $text ) ) );
		if ( '' === $text ) {
			return self::verdict( in_array( 'markup', $flags, true ) ? 'markup' : 'empty', '', $flags );
		}

		$pii = self::pii_kind( $text );
		if ( '' !== $pii ) {
			return self::verdict( 'pii', '', array_merge( $flags, array( $pii ) ) );
		}
		return array(
			'ok'    => true,
			'block' => '',
			'text'  => $text,
			'flags' => $flags,
		);
	}

	/**
	 * What kind of upload attempt the text is, or ''.
	 *
	 * @param string $text  Text.
	 * @param array  $hosts File-sharing hosts.
	 * @return string
	 */
	private static function upload_kind( $text, array $hosts ) {
		if ( preg_match( '/\bdata:[a-z0-9.+\/-]*[;,]/i', $text ) ) {
			return 'data_uri';
		}
		if ( preg_match( '/[A-Za-z0-9+\/=_-]{200,}/', $text ) ) {
			return 'base64';
		}
		// Links and bare host names ("drive.google.com/…", "www.dropbox.com").
		if ( preg_match_all( '~(?:https?://|ftp://|www\.)?((?:[a-z0-9-]+\.)+[a-z]{2,})(/[^\s<>"\']*)?~i', $text, $links, PREG_SET_ORDER ) ) {
			foreach ( $links as $link ) {
				$host = strtolower( $link[1] );
				foreach ( $hosts as $blocked ) {
					$blocked = strtolower( trim( $blocked ) );
					if ( '' !== $blocked && ( $host === $blocked || substr( $host, -strlen( $blocked ) - 1 ) === '.' . $blocked ) ) {
						return 'file_host';
					}
				}
				$path = isset( $link[2] ) ? strtolower( preg_replace( '/[?#].*$/', '', $link[2] ) ) : '';
				$is_link = '' !== $path || preg_match( '~^(?:https?://|ftp://|www\.)~i', $link[0] );
				if ( $is_link && preg_match( '/\.([a-z0-9]{1,5})$/', $path, $ext ) && in_array( $ext[1], self::FILE_TYPES, true ) ) {
					return 'file_link';
				}
			}
		}
		return '';
	}

	/**
	 * What kind of personal number the text contains, or ''.
	 *
	 * @param string $text Text.
	 * @return string
	 */
	private static function pii_kind( $text ) {
		// Passport-like: one or two capital letters, then 7 digits ("A1234567", "B 1234567").
		if ( preg_match( '/(?<![A-Za-z0-9])[A-Z]{1,2} ?\d{7}(?![0-9])/', $text ) ) {
			return 'passport';
		}
		// Runs of digits that may be split by single spaces, dots or dashes.
		if ( preg_match_all( '/(?<![0-9])(\+?)(\d(?:[ .-]?\d){9,22})(?![0-9])/', $text, $runs, PREG_SET_ORDER ) ) {
			foreach ( $runs as $run ) {
				$raw    = $run[2];
				$digits = preg_replace( '/\D/', '', $raw );
				$len    = strlen( $digits );
				// Grouped by thousands with dots is an amount ("1.775.000"), not an ID.
				if ( preg_match( '/^\d{1,3}(\.\d{3})+$/', $raw ) ) {
					continue;
				}
				// Split numbers must be grouped the way IDs and cards are written (4-4-4-4, 6-6-4,
				// 4-6-5), so two dates side by side ("2026-11-21 2026-11-22") are not an ID.
				$groups = array_map( 'strlen', preg_split( '/[ .-]/', $raw ) );
				if ( count( $groups ) > 1 && ! in_array( $groups, array( array( 4, 4, 4, 4 ), array( 6, 6, 4 ), array( 4, 6, 5 ), array( 4, 4, 4, 4, 3 ), array( 4, 4, 4, 3 ) ), true ) ) {
					continue;
				}
				if ( 16 === $len ) {
					return 'nik';
				}
				// Phone numbers: +62…, 62… up to 14 digits, or 08….
				$phone = '+' === $run[1] || 0 === strpos( $digits, '08' ) || ( 0 === strpos( $digits, '62' ) && $len <= 14 );
				if ( ! $phone && $len >= 13 && $len <= 19 && self::luhn( $digits ) ) {
					return 'card';
				}
			}
		}
		return '';
	}

	/**
	 * Luhn check.
	 *
	 * @param string $digits Digits only.
	 * @return bool
	 */
	public static function luhn( $digits ) {
		$sum    = 0;
		$double = false;
		for ( $i = strlen( $digits ) - 1; $i >= 0; $i-- ) {
			$d = (int) $digits[ $i ];
			if ( $double ) {
				$d *= 2;
				if ( $d > 9 ) {
					$d -= 9;
				}
			}
			$sum   += $d;
			$double = ! $double;
		}
		return 0 === $sum % 10;
	}

	/**
	 * A verdict that blocks the message.
	 *
	 * @param string $block Reason.
	 * @param string $text  Text to keep (none).
	 * @param array  $flags Flags.
	 * @return array
	 */
	private static function verdict( $block, $text, array $flags ) {
		return array(
			'ok'    => false,
			'block' => $block,
			'text'  => $text,
			'flags' => $flags,
		);
	}

	/**
	 * The visitor address, hashed with today's secret. The raw address is not kept.
	 *
	 * @return string
	 */
	public static function visitor_hash() {
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
		/** This filter is documented in includes/class-analytics.php. */
		$ip = (string) apply_filters( 'contextchat_client_ip', $ip );
		return hash_hmac( 'sha256', $ip, self::daily_secret() );
	}

	/**
	 * A random secret that changes every UTC day, kept in an option that is not autoloaded.
	 *
	 * @return string
	 */
	public static function daily_secret() {
		$day    = gmdate( 'Ymd' );
		$stored = get_option( 'contextchat_si_salt' );
		if ( is_array( $stored ) && isset( $stored['day'], $stored['secret'] ) && $stored['day'] === $day ) {
			return $stored['secret'];
		}
		$secret = bin2hex( random_bytes( 32 ) );
		update_option(
			'contextchat_si_salt',
			array(
				'day'    => $day,
				'secret' => $secret,
			),
			false
		);
		return $secret;
	}
}

/**
 * Counts requests per visitor in fixed windows. The store is the transient API on a site and an
 * array in tests.
 */
class ContextChat_Rate_Limiter {

	/** Store: object with get( $key ) and set( $key, $value, $ttl ). @var object */
	private $store;

	/** Limits, as in ContextChat_Guard::LIMITS. @var array */
	private $limits;

	/**
	 * Set up.
	 *
	 * @param object $store  Store.
	 * @param array  $limits Limits.
	 */
	public function __construct( $store, array $limits = array() ) {
		$this->store  = $store;
		$this->limits = array_merge( ContextChat_Guard::LIMITS, $limits );
	}

	/**
	 * Count one message from a visitor. False when a limit is already reached.
	 *
	 * @param string $visitor Hashed address.
	 * @param int    $now     Unix time.
	 * @return bool
	 */
	public function message( $visitor, $now ) {
		return $this->take(
			array(
				array( 'm', gmdate( 'YmdHi', $now ), $this->limits['per_minute'], 2 * 60 ),
				array( 'd', gmdate( 'Ymd', $now ), $this->limits['per_day'], 2 * 86400 ),
			),
			$visitor
		);
	}

	/**
	 * Count one new conversation from a visitor. False when the hourly limit is reached.
	 *
	 * @param string $visitor Hashed address.
	 * @param int    $now     Unix time.
	 * @return bool
	 */
	public function start( $visitor, $now ) {
		return $this->take( array( array( 's', gmdate( 'YmdH', $now ), $this->limits['starts_per_hour'], 2 * 3600 ) ), $visitor );
	}

	/**
	 * Check every window first, then count in all of them, so a refused request costs nothing.
	 *
	 * @param array  $windows List of array( kind, window, limit, ttl ).
	 * @param string $visitor Hashed address.
	 * @return bool
	 */
	private function take( array $windows, $visitor ) {
		$keys = array();
		foreach ( $windows as $w ) {
			$key = 'contextchat_si_rl_' . $w[0] . '_' . substr( hash( 'sha256', $visitor . '|' . $w[1] ), 0, 32 );
			$n   = (int) $this->store->get( $key );
			if ( $n >= (int) $w[2] ) {
				return false;
			}
			$keys[] = array( $key, $n + 1, $w[3] );
		}
		foreach ( $keys as $k ) {
			$this->store->set( $k[0], $k[1], $k[2] );
		}
		return true;
	}
}

/**
 * The transient API as a rate-limit store.
 */
class ContextChat_Transient_Store {

	/**
	 * Read.
	 *
	 * @param string $key Key.
	 * @return mixed
	 */
	public function get( $key ) {
		return get_transient( $key );
	}

	/**
	 * Write.
	 *
	 * @param string $key   Key.
	 * @param mixed  $value Value.
	 * @param int    $ttl   Seconds.
	 */
	public function set( $key, $value, $ttl ) {
		set_transient( $key, $value, $ttl );
	}
}

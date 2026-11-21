<?php
/**
 * Output validator: checks every SI reply before the visitor sees it (design plan section 8.6).
 *
 * Pure PHP. A rejected reply is retried once on the stronger model with the reason, and if that
 * fails too the visitor gets a template reply with the handoff card (the router and orchestrator
 * do that part). Links that are not allowed are removed rather than rejected.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Reply checks.
 */
class ContextChat_Validator {

	/** At most this many sentences, unless a quote card is attached. */
	const MAX_SENTENCES = 5;

	/** At most this many words (headroom over the 60-word target), unless a quote card is attached. */
	const MAX_WORDS = 90;

	/** Words that never appear in a reply. Matched as whole words, case-insensitively unless noted. */
	const BANNED = array( 'kecerdasan buatan', 'artificial intelligence', 'gue', 'gw', 'lo', 'lu', 'gak', 'nggak', 'ngga', 'enggak' );

	/** Promise patterns (rule 6). */
	const PROMISES = array(
		'/\bpasti\s+(?:diterima|lolos|disetujui|selesai|beres)\b/iu',
		'/\bdijamin\b/iu',
		'/\b(?:kami|saya)\s+(?:jamin|menjamin)\b/iu',
		'/\b(?:bisa|akan|dapat)\s+(?:kami|saya)\s+(?:beri|berikan|kasih)\s+(?:diskon|potongan)/iu',
		'/\b(?:kami|saya)\s+(?:beri|berikan|kasih)\s+(?:diskon|potongan)\b/iu',
		'/\bguarantee(?:d|s)?\b/iu',
		'/\bwill\s+(?:definitely|certainly|surely)\s+be\s+(?:accepted|approved|finished|done)\b/iu',
		'/\b(?:I|we)\s+(?:can|will|could)\s+(?:give|offer)\s+you\s+(?:a\s+)?discount\b/iu',
	);

	/**
	 * Check a reply.
	 *
	 * @param string $text Reply text.
	 * @param array  $ctx  amounts (int[] allowed rupiah amounts), site_host (string), email (allowed
	 *                     address), names (string[] denylist), banned (string[] extra words),
	 *                     quote_card (bool: a quote card goes with the reply).
	 * @return array { ok: bool, reasons: string[], text: string } with disallowed links removed.
	 */
	public static function check( $text, array $ctx ) {
		$reasons = array();
		$text    = self::strip_links( (string) $text, $ctx );

		// 1. Amounts.
		$allowed = array_map( 'intval', isset( $ctx['amounts'] ) ? (array) $ctx['amounts'] : array() );
		foreach ( self::amounts( $text ) as $amount ) {
			if ( ! in_array( $amount, $allowed, true ) ) {
				$reasons[] = 'amount:' . $amount;
			}
		}

		// 3. Names.
		foreach ( isset( $ctx['names'] ) ? (array) $ctx['names'] : array() as $name ) {
			$name = trim( (string) $name );
			if ( '' !== $name && preg_match( '/(?<![\p{L}\p{N}])' . preg_quote( $name, '/' ) . '(?![\p{L}\p{N}])/iu', $text ) ) {
				$reasons[] = 'name';
				break;
			}
		}

		// 4. Length.
		if ( empty( $ctx['quote_card'] ) ) {
			if ( self::sentences( $text ) > self::MAX_SENTENCES ) {
				$reasons[] = 'too_many_sentences';
			}
			if ( self::words( $text ) > self::MAX_WORDS ) {
				$reasons[] = 'too_many_words';
			}
		}

		// 5. Banned words and emoji. "AI" only in capitals, so the Indonesian "ai" in a name is fine.
		$banned = array_merge( self::BANNED, isset( $ctx['banned'] ) ? (array) $ctx['banned'] : array() );
		if ( preg_match( '/(?<![\p{L}\p{N}])(?:AI|A\.I\.)(?![\p{L}\p{N}])/u', $text ) ) {
			$reasons[] = 'banned_word';
		} else {
			foreach ( $banned as $word ) {
				$word = trim( (string) $word );
				if ( '' !== $word && preg_match( '/(?<![\p{L}\p{N}])' . preg_quote( $word, '/' ) . '(?![\p{L}\p{N}])/iu', $text ) ) {
					$reasons[] = 'banned_word';
					break;
				}
			}
		}
		if ( preg_match( '/[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B00}-\x{2BFF}\x{FE0F}\x{200D}]/u', $text ) ) {
			$reasons[] = 'emoji';
		}

		// 6. Promises.
		foreach ( self::PROMISES as $pattern ) {
			if ( preg_match( $pattern, $text ) ) {
				$reasons[] = 'promise';
				break;
			}
		}

		if ( '' === trim( $text ) ) {
			$reasons[] = 'empty';
		}

		return array(
			'ok'      => ! $reasons,
			'reasons' => $reasons,
			'text'    => $text,
		);
	}

	/**
	 * Every rupiah amount in a text, as whole rupiah.
	 *
	 * Understands "Rp 1.775.000", "Rp1,775,000", "Rp 125 rb", "Rp 1,5 jt", "IDR 50.000",
	 * "1.775.000 rupiah" and "1,5 juta rupiah".
	 *
	 * @param string $text Text.
	 * @return int[]
	 */
	public static function amounts( $text ) {
		$found = array();
		// A range shares its unit: "Rp 300–415 rb" is Rp 300 rb and Rp 415 rb.
		$text   = preg_replace( '/((?:Rp\.?|IDR)\s*)(\d[\d.,]*)\s*[–—-]\s*(?:Rp\.?\s*)?(\d[\d.,]*)\s*(rb|ribu|k|jt|juta)(?![\p{L}])/iu', '$1$2 $4 – $1$3 $4', (string) $text );
		$number = '(\d[\d.,]*)\s*(rb|ribu|k|jt|juta|million|thousand)?';
		$patterns = array(
			'/(?<![\p{L}])(?:Rp\.?|IDR)\s*' . $number . '(?![\p{L}])/iu',
			'/(?<![\d.,])' . $number . '\s*(?:rupiah|IDR)(?![\p{L}])/iu',
			// Without "Rp": "125rb", "1,5 jt" and amounts grouped in thousands ("total 1.775.000").
			'/(?<![\p{L}\d.,])(\d[\d.,]*)\s*(rb|ribu|jt|juta)(?![\p{L}])/iu',
			'/(?<![\p{L}\d.,\/-])(\d{1,3}(?:\.\d{3})+)(?![\d.,]*\d)()/u',
		);
		$seen = array();
		foreach ( $patterns as $i => $pattern ) {
			if ( ! preg_match_all( $pattern, $text, $matches, PREG_SET_ORDER | PREG_OFFSET_CAPTURE ) ) {
				continue;
			}
			foreach ( $matches as $m ) {
				$offset = $m[1][1];
				if ( isset( $seen[ $offset ] ) ) {
					continue; // "Rp 50.000 rupiah" counted once.
				}
				$seen[ $offset ] = true;
				$value           = self::parse( $m[1][0], isset( $m[2] ) && -1 !== $m[2][1] ? strtolower( $m[2][0] ) : '' );
				if ( 3 === $i ) {
					// A bare grouped number is an amount only if it is large and not a count ("1.000 karakter").
					$after = substr( $text, $offset + strlen( $m[1][0] ), 24 );
					if ( null === $value || $value < 10000 || preg_match( '/^\s*(karakter|kata|halaman|hlm|dokumen|token|orang|kali|characters|words|pages|documents|people|times)\b/iu', $after ) ) {
						continue;
					}
				}
				if ( null !== $value ) {
					$found[] = $value;
				}
			}
		}
		return $found;
	}

	/**
	 * Turn "1.775.000", "1,775,000", "1,5" + "jt" into whole rupiah.
	 *
	 * @param string $number Digits with separators.
	 * @param string $unit   '', rb/ribu/k/thousand, jt/juta/million.
	 * @return int|null
	 */
	private static function parse( $number, $unit ) {
		$number = rtrim( $number, '.,' );
		$scale  = 1;
		if ( in_array( $unit, array( 'rb', 'ribu', 'k', 'thousand' ), true ) ) {
			$scale = 1000;
		} elseif ( in_array( $unit, array( 'jt', 'juta', 'million' ), true ) ) {
			$scale = 1000000;
		}
		if ( preg_match( '/^\d{1,3}(?:([.,])\d{3})(?:\1\d{3})*$/', $number ) && 1 === $scale ) {
			return (int) preg_replace( '/\D/', '', $number ); // Grouped thousands.
		}
		if ( preg_match( '/^\d{1,3}(?:([.,])\d{3})(?:\1\d{3})*(?:[.,](\d+))?$/', $number ) && 1 === $scale ) {
			return (int) preg_replace( '/\D/', '', preg_replace( '/[.,]\d+$/', '', $number ) );
		}
		if ( preg_match( '/^\d+$/', $number ) ) {
			return (int) $number * $scale;
		}
		if ( preg_match( '/^(\d+)[.,](\d{1,2})$/', $number, $m ) ) {
			// A decimal with a unit: "1,5 jt" = 1 500 000.
			$dec = str_pad( $m[2], 2, '0' );
			return (int) round( ( (int) $m[1] * 100 + (int) $dec ) * $scale / 100 );
		}
		if ( preg_match( '/^\d{1,3}(?:[.,]\d{3})+$/', $number ) ) {
			return (int) preg_replace( '/\D/', '', $number ) * $scale;
		}
		return null;
	}

	/**
	 * Remove links that are not wa.me, the allowed email address or the site's own domain.
	 *
	 * @param string $text Text.
	 * @param array  $ctx  Context with site_host and email.
	 * @return string
	 */
	private static function strip_links( $text, array $ctx ) {
		$site  = isset( $ctx['site_host'] ) ? strtolower( preg_replace( '/^www\./i', '', (string) $ctx['site_host'] ) ) : '';
		$email  = isset( $ctx['email'] ) ? strtolower( (string) $ctx['email'] ) : '';
		$phones = isset( $ctx['phones'] ) ? array_values( array_filter( array_map( 'strval', (array) $ctx['phones'] ) ) ) : array();

		// Email addresses (with or without mailto:).
		$text = preg_replace_callback(
			'/(?:mailto:)?[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/',
			function ( $m ) use ( $email ) {
				$address = strtolower( preg_replace( '/^mailto:/i', '', $m[0] ) );
				return ( '' !== $email && $address === $email ) ? $m[0] : '';
			},
			$text
		);

		// Web links and bare domains with a path.
		$text = preg_replace_callback(
			'~(?:https?://|www\.)[^\s<>"\']+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}/[^\s<>"\']*~i',
			function ( $m ) use ( $site, $phones ) {
				$url  = rtrim( $m[0], '.,;:!?)' );
				$tail = substr( $m[0], strlen( $url ) );
				$host = strtolower( (string) parse_url( preg_match( '~^https?://~i', $url ) ? $url : 'http://' . $url, PHP_URL_HOST ) );
				$host = preg_replace( '/^www\./', '', $host );
				if ( 'wa.me' === $host ) {
					// Only the site's own WhatsApp numbers, when they are known.
					$number = preg_replace( '/\D/', '', (string) parse_url( preg_match( '~^https?://~i', $url ) ? $url : 'http://' . $url, PHP_URL_PATH ) );
					return ( ! $phones || in_array( $number, $phones, true ) ) ? $m[0] : $tail;
				}
				if ( '' !== $site && ( $host === $site || substr( $host, -strlen( $site ) - 1 ) === '.' . $site ) ) {
					return $m[0];
				}
				return $tail;
			},
			$text
		);
		return trim( preg_replace( '/[ \t]{2,}/', ' ', $text ) );
	}

	/**
	 * Sentences: ends of sentences, plus a last sentence without a full stop.
	 *
	 * @param string $text Text.
	 * @return int
	 */
	public static function sentences( $text ) {
		$text = trim( $text );
		if ( '' === $text ) {
			return 0;
		}
		// Full stops inside numbers ("1.775.000") and common abbreviations are not sentence ends.
		$plain = preg_replace( '/\b(?:dll|dsb|dst|yth|no|hlm|mis|dr|mr|mrs|ms|e\.g|i\.e|etc)\./i', '', $text );
		$count = preg_match_all( '/[.!?]+(?=\s|$)/u', $plain );
		if ( ! preg_match( '/[.!?]\s*$/u', $plain ) ) {
			$count++;
		}
		return $count;
	}

	/**
	 * Words.
	 *
	 * @param string $text Text.
	 * @return int
	 */
	public static function words( $text ) {
		return preg_match_all( '/[\p{L}\p{N}][\p{L}\p{N}\'’.,\/-]*/u', $text );
	}
}

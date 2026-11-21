<?php
/**
 * Knowledge entries the SI answers from (design plan section 6.6).
 *
 * Entries live in one option that is not autoloaded, edited under ContextChat → Knowledge. Until
 * an administrator saves their own, the bundled seed (data/knowledge.nusalexia.json) is used.
 * The SI states facts only from these entries and tool results.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Knowledge entries: storage, cleaning, search and the text the model sees.
 */
class ContextChat_Knowledge {

	/** Option holding the entries. */
	const OPTION = 'contextchat_si_knowledge';

	/** Limits. */
	const MAX_ENTRIES = 200;
	const MAX_BODY    = 4000;
	const MAX_TITLE   = 150;

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
	 * The bundled seed.
	 *
	 * @return array Entries.
	 */
	public static function seed() {
		$data = json_decode( (string) file_get_contents( dirname( __DIR__, 2 ) . '/data/knowledge.nusalexia.json' ), true );
		return isset( $data['entries'] ) && is_array( $data['entries'] ) ? self::clean_entries( $data['entries'] ) : array();
	}

	/**
	 * The entries in use: the saved ones, or the seed when none were saved.
	 *
	 * @return array
	 */
	public static function entries() {
		$stored = function_exists( 'get_option' ) ? get_option( self::OPTION ) : false;
		if ( is_array( $stored ) && isset( $stored['entries'] ) && is_array( $stored['entries'] ) ) {
			return $stored['entries'];
		}
		return self::seed();
	}

	/**
	 * Whether the saved entries are the seed (nothing saved yet).
	 *
	 * @return bool
	 */
	public static function using_seed() {
		$stored = get_option( self::OPTION );
		return ! ( is_array( $stored ) && isset( $stored['entries'] ) );
	}

	/**
	 * Sanitize callback for the settings form: rows from the editor, a JSON import that replaces
	 * them, or "restore the seed". Already-clean values (a second pass) are returned as they are.
	 *
	 * @param mixed $input Posted value.
	 * @return array
	 */
	public static function sanitize_option( $input ) {
		if ( ! is_array( $input ) ) {
			return array( 'entries' => self::entries() );
		}
		if ( ! isset( $input['rows'] ) && ! isset( $input['import'] ) && ! isset( $input['reset'] ) ) {
			// A second pass over an already clean value.
			return isset( $input['entries'] ) ? array( 'entries' => self::clean_entries( (array) $input['entries'] ) ) : array();
		}
		if ( ! empty( $input['reset'] ) ) {
			return array();
		}
		$import = isset( $input['import'] ) ? trim( wp_unslash( (string) $input['import'] ) ) : '';
		if ( '' !== $import ) {
			$entries = self::parse_import( $import );
			if ( null === $entries ) {
				add_settings_error( 'contextchat', 'ctxc-knowledge-import', __( 'The knowledge import is not valid JSON with an "entries" list, so the entries were not changed.', 'contextchat' ) );
				return array( 'entries' => self::entries() );
			}
			return array( 'entries' => $entries );
		}
		$rows    = isset( $input['rows'] ) && is_array( $input['rows'] ) ? array_values( $input['rows'] ) : array();
		$entries = self::clean_entries( wp_unslash( $rows ) );
		// Unchanged bundled entries are not stored, so a plugin update can bring newer ones.
		return $entries === self::seed() ? array() : array( 'entries' => $entries );
	}

	/**
	 * Entries from imported JSON (either { entries: [...] } or a bare list), or null.
	 *
	 * @param string $json JSON.
	 * @return array|null
	 */
	public static function parse_import( $json ) {
		$data = json_decode( $json, true );
		if ( is_array( $data ) && isset( $data['entries'] ) && is_array( $data['entries'] ) ) {
			$data = $data['entries'];
		}
		if ( ! is_array( $data ) || ( $data && array_keys( $data ) !== range( 0, count( $data ) - 1 ) ) ) {
			return null;
		}
		return self::clean_entries( $data );
	}

	/**
	 * Clean a list of entries: plain text, known languages, unique IDs, no empty bodies.
	 *
	 * @param array $rows Rows.
	 * @return array
	 */
	public static function clean_entries( array $rows ) {
		$out = array();
		$ids = array();
		foreach ( $rows as $row ) {
			if ( ! is_array( $row ) || count( $out ) >= self::MAX_ENTRIES ) {
				continue;
			}
			$body = self::text( isset( $row['body'] ) ? $row['body'] : '', self::MAX_BODY, true );
			if ( '' === $body ) {
				continue;
			}
			$title = self::text( isset( $row['title'] ) ? $row['title'] : '', self::MAX_TITLE, false );
			$tags  = isset( $row['tags'] ) ? $row['tags'] : array();
			if ( is_string( $tags ) ) {
				$tags = explode( ',', $tags );
			}
			$tags = array_values( array_filter( array_map( function ( $t ) {
				return ContextChat_Knowledge::text( $t, 40, false );
			}, (array) $tags ) ) );
			$id   = isset( $row['id'] ) ? strtolower( preg_replace( '/[^a-z0-9-]+/i', '-', (string) $row['id'] ) ) : '';
			$id   = trim( $id, '-' );
			if ( '' === $id ) {
				$id = 'entry-' . substr( md5( $title . $body ), 0, 8 );
			}
			while ( isset( $ids[ $id ] ) ) {
				$id .= '-2';
			}
			$ids[ $id ] = true;
			$url        = isset( $row['source_url'] ) ? trim( (string) $row['source_url'] ) : '';
			$out[]      = array(
				'id'         => substr( $id, 0, 64 ),
				'title'      => $title,
				'lang'       => isset( $row['lang'] ) && 'en' === $row['lang'] ? 'en' : 'id',
				'body'       => $body,
				'tags'       => array_slice( $tags, 0, 12 ),
				'source_url' => preg_match( '~^https?://~i', $url ) ? substr( $url, 0, 300 ) : '',
				'updated'    => isset( $row['updated'] ) && preg_match( '/^\d{4}-\d{2}-\d{2}$/', (string) $row['updated'] ) ? (string) $row['updated'] : gmdate( 'Y-m-d' ),
			);
		}
		return $out;
	}

	/**
	 * Plain text: no tags or control characters, trimmed to a length.
	 *
	 * @param mixed $value     Value.
	 * @param int   $max       Maximum characters.
	 * @param bool  $multiline Keep line breaks.
	 * @return string
	 */
	public static function text( $value, $max, $multiline ) {
		$value = is_scalar( $value ) ? (string) $value : '';
		$value = preg_replace( '/<[^>]*>/', '', $value );
		$value = str_replace( array( "\r\n", "\r" ), "\n", $value );
		$value = preg_replace( $multiline ? '/[\x00-\x09\x0B-\x1F\x7F]/u' : '/[\x00-\x1F\x7F]/u', $multiline ? '' : ' ', (string) $value );
		$value = trim( preg_replace( '/[ \t]+/', ' ', (string) $value ) );
		return function_exists( 'mb_substr' ) ? mb_substr( $value, 0, $max, 'UTF-8' ) : substr( $value, 0, $max );
	}

	/**
	 * Rough token count of the entries the model sees (about 4 characters a token).
	 *
	 * @param array $entries Entries.
	 * @return int
	 */
	public static function size_tokens( array $entries ) {
		return (int) ceil( strlen( self::for_prompt( $entries ) ) / 4 );
	}

	/**
	 * The entries as data for the instruction prefix. Wrapped so they read as data, not instructions.
	 *
	 * @param array $entries Entries.
	 * @return string
	 */
	public static function for_prompt( array $entries ) {
		$out = '';
		foreach ( $entries as $e ) {
			$out .= '<entry id="' . $e['id'] . '" lang="' . $e['lang'] . '"' . ( $e['source_url'] ? ' source="' . $e['source_url'] . '"' : '' ) . ">\n"
				. '# ' . $e['title'] . "\n" . $e['body'] . "\n</entry>\n";
		}
		return $out;
	}

	/**
	 * Keyword search over titles, tags and bodies, for the lookup_knowledge tool.
	 *
	 * @param array  $entries Entries.
	 * @param string $query   Query.
	 * @param int    $limit   How many to return.
	 * @return array Matching entries, best first.
	 */
	public static function search( array $entries, $query, $limit = 5 ) {
		$words = array_filter(
			preg_split( '/[^\p{L}\p{N}]+/u', mb_strtolower( (string) $query, 'UTF-8' ) ),
			function ( $w ) {
				return mb_strlen( $w, 'UTF-8' ) >= 3;
			}
		);
		if ( ! $words ) {
			return array();
		}
		$scored = array();
		foreach ( $entries as $i => $e ) {
			$title = mb_strtolower( $e['title'] . ' ' . implode( ' ', $e['tags'] ), 'UTF-8' );
			$body  = mb_strtolower( $e['body'], 'UTF-8' );
			$score = 0;
			foreach ( $words as $w ) {
				$score += 3 * substr_count( $title, $w ) + substr_count( $body, $w );
			}
			if ( $score > 0 ) {
				$scored[] = array( $score, $i );
			}
		}
		usort(
			$scored,
			function ( $a, $b ) {
				return $b[0] - $a[0] ?: $a[1] - $b[1];
			}
		);
		$out = array();
		foreach ( array_slice( $scored, 0, $limit ) as $hit ) {
			$out[] = $entries[ $hit[1] ];
		}
		return $out;
	}
}

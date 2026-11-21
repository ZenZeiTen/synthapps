<?php
/**
 * Countries: turns what a visitor wrote ("Australia", "Jerman", "UEA") into a country code, and
 * says which legalisation route a document for that country takes.
 *
 * Pure PHP with no WordPress calls, so it can be tested on its own. The Apostille member list
 * comes only from data/apostille-members.json (the HCCH status table), never from memory.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Country names and the Apostille member list.
 */
class ContextChat_Countries {

	/** Territories covered through another party that HCCH does not list on their own. */
	const COVERED_BY = array(
		'HK' => 'CN',
		'MO' => 'CN',
	);

	/** Words visitors put around a country name ("negara Jerman", "to Japan"). */
	const FILLER = array( 'negara', 'ke', 'di', 'untuk', 'the', 'to', 'in', 'for', 'country', 'kedutaan', 'kedubes', 'embassy', 'of', 'dari' );

	/** Code => array( en, id, aliases ). @var array */
	private $names;

	/** Code => member entry from the Apostille list. @var array */
	private $members;

	/** Normalised name => code, or '' when two countries share it. @var array */
	private $index;

	/**
	 * Load the two data files.
	 *
	 * @param array|null $countries Decoded countries.json, or null to read the bundled file.
	 * @param array|null $apostille Decoded apostille-members.json, or null to read the bundled file.
	 */
	public function __construct( $countries = null, $apostille = null ) {
		$dir = dirname( __DIR__, 2 ) . '/data/';
		if ( null === $countries ) {
			$countries = json_decode( (string) file_get_contents( $dir . 'countries.json' ), true );
		}
		if ( null === $apostille ) {
			$apostille = json_decode( (string) file_get_contents( $dir . 'apostille-members.json' ), true );
		}
		$this->names   = isset( $countries['countries'] ) && is_array( $countries['countries'] ) ? $countries['countries'] : array();
		$this->members = array();
		if ( isset( $apostille['members'] ) && is_array( $apostille['members'] ) ) {
			foreach ( $apostille['members'] as $member ) {
				if ( isset( $member['code'], $member['in_force_from'] ) ) {
					$this->members[ strtoupper( $member['code'] ) ] = $member;
				}
			}
		}
		$this->index = array();
		foreach ( $this->names as $code => $entry ) {
			$spellings = array( $code );
			foreach ( array( 'en', 'id' ) as $lang ) {
				if ( isset( $entry[ $lang ] ) ) {
					$spellings[] = $entry[ $lang ];
				}
			}
			if ( isset( $entry['aliases'] ) && is_array( $entry['aliases'] ) ) {
				$spellings = array_merge( $spellings, $entry['aliases'] );
			}
			foreach ( $spellings as $spelling ) {
				$key = self::normalise( $spelling );
				if ( '' === $key ) {
					continue;
				}
				if ( isset( $this->index[ $key ] ) && $this->index[ $key ] !== $code ) {
					$this->index[ $key ] = ''; // Shared by two countries: ambiguous.
				} else {
					$this->index[ $key ] = $code;
				}
			}
		}
	}

	/**
	 * Lower case, no accents or punctuation, single spaces.
	 *
	 * @param string $text Text.
	 * @return string
	 */
	public static function normalise( $text ) {
		$text = (string) $text;
		if ( function_exists( 'iconv' ) ) {
			$ascii = @iconv( 'UTF-8', 'ASCII//TRANSLIT//IGNORE', $text ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- iconv warns on odd input; the original is kept then.
			if ( false !== $ascii && '' !== $ascii ) {
				$text = $ascii;
			}
		}
		$text = strtolower( $text );
		$text = str_replace( '&', ' and ', $text );
		$text = preg_replace( '/[^a-z0-9]+/', ' ', $text );
		return trim( (string) $text );
	}

	/**
	 * The country code for what a visitor wrote, or '' when it is unknown or ambiguous.
	 *
	 * @param string $input Country name, common spelling or ISO code.
	 * @return string
	 */
	public function resolve( $input ) {
		$key = self::normalise( $input );
		if ( '' === $key ) {
			return '';
		}
		if ( isset( $this->index[ $key ] ) ) {
			return $this->index[ $key ];
		}
		$words = array_values( array_diff( explode( ' ', $key ), self::FILLER ) );
		$key   = implode( ' ', $words );
		if ( isset( $this->index[ $key ] ) ) {
			return $this->index[ $key ];
		}
		// A country named inside a longer phrase ("universitas di Jerman"): take the longest name
		// found, but only if no other country is also named.
		$found = array();
		$count = count( $words );
		for ( $len = min( 6, $count ); $len >= 1; $len-- ) {
			for ( $i = 0; $i + $len <= $count; $i++ ) {
				$phrase = implode( ' ', array_slice( $words, $i, $len ) );
				if ( strlen( $phrase ) < 3 || ! isset( $this->index[ $phrase ] ) || '' === $this->index[ $phrase ] ) {
					continue;
				}
				$found[ $this->index[ $phrase ] ] = true;
				// Mark the words used so shorter names inside them ("Korea" in "Korea Selatan") are not counted again.
				array_splice( $words, $i, $len, array_fill( 0, $len, '' ) );
			}
		}
		return 1 === count( $found ) ? (string) key( $found ) : '';
	}

	/**
	 * Display name for a code.
	 *
	 * @param string $code ISO code.
	 * @param string $lang 'id' or 'en'.
	 * @return string
	 */
	public function name( $code, $lang = 'id' ) {
		$code = strtoupper( (string) $code );
		if ( isset( $this->names[ $code ][ $lang ] ) ) {
			return $this->names[ $code ][ $lang ];
		}
		return $code;
	}

	/**
	 * Is the Apostille Convention in force for this country on this date?
	 *
	 * @param string $code  ISO code.
	 * @param string $today Date as Y-m-d.
	 * @return bool
	 */
	public function is_apostille_member( $code, $today ) {
		$code = strtoupper( (string) $code );
		if ( isset( self::COVERED_BY[ $code ] ) ) {
			$code = self::COVERED_BY[ $code ];
		}
		return isset( $this->members[ $code ] ) && strcmp( $this->members[ $code ]['in_force_from'], (string) $today ) <= 0;
	}

	/**
	 * The legalisation route for a document used in a country.
	 *
	 * @param string $input Country as the visitor wrote it.
	 * @param string $today Date as Y-m-d.
	 * @return array { code, route } where route is 'none', 'apostille', 'ministry_embassy' or '' (unknown country).
	 */
	public function route( $input, $today ) {
		$code = $this->resolve( $input );
		if ( '' === $code ) {
			return array(
				'code'  => '',
				'route' => '',
			);
		}
		if ( 'ID' === $code ) {
			$route = 'none'; // Used in Indonesia: no legalisation for another country.
		} elseif ( $this->is_apostille_member( $code, $today ) ) {
			$route = 'apostille';
		} else {
			$route = 'ministry_embassy';
		}
		return array(
			'code'  => $code,
			'route' => $route,
		);
	}

	/**
	 * Number of Apostille parties in the list.
	 *
	 * @return int
	 */
	public function member_count() {
		return count( $this->members );
	}
}

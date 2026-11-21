<?php
/**
 * The price table and the Apostille member list as the site uses them: the administrator's own
 * copy when they changed something on the Prices tab, otherwise the bundled data files.
 *
 * Both are stored in options that are not autoloaded. Unchanged data is not stored, so a plugin
 * update can bring newer bundled prices or members.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Price table and Apostille list storage.
 */
class ContextChat_Prices {

	/** Options. */
	const OPTION    = 'contextchat_si_prices';
	const APOSTILLE = 'contextchat_si_apostille';

	/** Days after which the prices are flagged as possibly out of date. */
	const STALE_DAYS = 90;

	/** Days after which the Apostille list should be checked against HCCH again. */
	const APOSTILLE_STALE_DAYS = 365;

	/**
	 * Register both options in the settings form.
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
		register_setting(
			'contextchat',
			self::APOSTILLE,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( __CLASS__, 'sanitize_apostille' ),
				'default'           => array(),
				'show_in_rest'      => false,
			)
		);
	}

	/**
	 * The price table in use.
	 *
	 * @return array
	 */
	public static function table() {
		$stored = function_exists( 'get_option' ) ? get_option( self::OPTION ) : false;
		$table  = is_array( $stored ) && isset( $stored['rates'] ) ? $stored : ContextChat_Price_Engine::seed();
		if ( function_exists( 'apply_filters' ) ) {
			/**
			 * Filter the price table the engine calculates from.
			 *
			 * @param array $table The Prices tab's table, or data/price-table.nusalexia.json.
			 */
			$table = (array) apply_filters( 'contextchat_price_table', $table );
		}
		return $table;
	}

	/**
	 * Whether the bundled price table is in use.
	 *
	 * @return bool
	 */
	public static function using_seed() {
		$stored = get_option( self::OPTION );
		return ! ( is_array( $stored ) && isset( $stored['rates'] ) );
	}

	/**
	 * The bundled Apostille list.
	 *
	 * @return array
	 */
	public static function apostille_seed() {
		$data = json_decode( (string) file_get_contents( dirname( __DIR__, 2 ) . '/data/apostille-members.json' ), true );
		return is_array( $data ) ? $data : array( 'members' => array() );
	}

	/**
	 * The Apostille list in use.
	 *
	 * @return array { source_url, fetched_at, members }
	 */
	public static function apostille() {
		$stored = function_exists( 'get_option' ) ? get_option( self::APOSTILLE ) : false;
		return is_array( $stored ) && isset( $stored['members'] ) ? $stored : self::apostille_seed();
	}

	/**
	 * Days since a Y-m-d date, or null.
	 *
	 * @param string $date Date.
	 * @param int    $now  Unix time.
	 * @return int|null
	 */
	public static function age_days( $date, $now ) {
		$t = strtotime( (string) $date . ' 00:00:00 UTC' );
		return false === $t ? null : (int) floor( ( $now - $t ) / 86400 );
	}

	/**
	 * Sanitize callback for the price table form. Already-clean values keep their shape.
	 *
	 * @param mixed $input Posted value.
	 * @return array Empty to use the bundled table.
	 */
	public static function sanitize_option( $input ) {
		if ( ! is_array( $input ) ) {
			return array();
		}
		if ( isset( $input['rates'] ) && ! isset( $input['form'] ) ) {
			// A second pass over a clean value.
			$clean = self::clean_table( $input );
			return null === $clean ? array() : $clean;
		}
		$input = wp_unslash( $input );
		if ( ! empty( $input['reset'] ) ) {
			return array();
		}
		$seed = ContextChat_Price_Engine::seed();
		if ( isset( $input['import'] ) && '' !== trim( (string) $input['import'] ) ) {
			$data  = json_decode( (string) $input['import'], true );
			$clean = is_array( $data ) ? self::clean_table( $data ) : null;
			if ( null === $clean ) {
				add_settings_error( 'contextchat', 'ctxc-prices-import', __( 'The price import is not a valid price table, so the prices were not changed.', 'contextchat' ) );
				return self::using_seed() ? array() : get_option( self::OPTION );
			}
			return self::same_as_seed( $clean, $seed ) ? array() : self::stamp( $clean );
		}
		$clean = self::clean_table( self::from_form( $input ) );
		if ( null === $clean ) {
			add_settings_error( 'contextchat', 'ctxc-prices-empty', __( 'The price table needs at least one language pair, so the prices were not changed.', 'contextchat' ) );
			return self::using_seed() ? array() : get_option( self::OPTION );
		}
		if ( self::same_as_seed( $clean, $seed ) ) {
			return array();
		}
		$current = self::table();
		if ( ! self::using_seed() && self::same_as_seed( $clean, $current ) ) {
			return $current; // Saved again without changes: keep the date.
		}
		return self::stamp( $clean );
	}

	/**
	 * The editor's fields as a price table.
	 *
	 * @param array $in Form fields.
	 * @return array
	 */
	private static function from_form( array $in ) {
		$seed  = ContextChat_Price_Engine::seed();
		$num   = function ( $key, $default = null ) use ( $in ) {
			return isset( $in[ $key ] ) && '' !== trim( (string) $in[ $key ] ) ? $in[ $key ] : $default;
		};
		$rates = array();
		foreach ( isset( $in['rows'] ) && is_array( $in['rows'] ) ? $in['rows'] : array() as $row ) {
			if ( ! is_array( $row ) || empty( $row['source'] ) || empty( $row['target'] ) ) {
				continue;
			}
			$pair = $row['source'] . '-' . $row['target'];
			if ( isset( $rates[ $pair ] ) ) {
				continue;
			}
			$rates[ $pair ] = array(
				'regular' => isset( $row['regular'] ) && '' !== trim( (string) $row['regular'] ) ? $row['regular'] : null,
				'sworn'   => isset( $row['sworn'] ) && '' !== trim( (string) $row['sworn'] ) ? $row['sworn'] : null,
			);
		}
		return array(
			'source_url'           => $num( 'source_url', '' ),
			'currency'             => 'IDR',
			'unit'                 => 'translated A4 page',
			'rates'                => $rates,
			'legalisation'         => array(
				'ministry'  => $num( 'legal_ministry', $seed['legalisation']['ministry'] ),
				'embassy'   => $num( 'legal_embassy', $seed['legalisation']['embassy'] ),
				'apostille' => $num( 'legal_apostille', $seed['legalisation']['apostille'] ),
			),
			'terminology_per_hour' => $num( 'terminology', $seed['terminology_per_hour'] ),
			'express_percent'      => array(
				'standard' => 100,
				'next_day' => 100 + (int) $num( 'express_next_day', 50 ),
				'same_day' => 100 + (int) $num( 'express_same_day', 100 ),
			),
			'volume_discounts'     => array(
				array(
					'min_documents' => $num( 'discount2_documents', 40 ),
					'percent'       => $num( 'discount2_percent', 10 ),
				),
				array(
					'min_documents' => $num( 'discount1_documents', 20 ),
					'percent'       => $num( 'discount1_percent', 5 ),
				),
			),
			'deposit'              => array(
				'min_total' => $num( 'deposit_min', 1000000 ),
				'percent'   => $num( 'deposit_percent', 50 ),
			),
			'min_pages'            => $num( 'min_pages', 1 ),
			'revisions'            => array(
				'count' => $num( 'revisions', 3 ),
				'days'  => $num( 'revision_days', 7 ),
			),
			'valid_days'           => $num( 'valid_days', 7 ),
		);
	}

	/**
	 * A clean price table, or null when it has no usable pair. Whole rupiah only; null for a
	 * package that is not offered.
	 *
	 * @param array $t Table.
	 * @return array|null
	 */
	public static function clean_table( array $t ) {
		$int   = function ( $v, $min, $max, $default ) {
			if ( is_int( $v ) || ( is_string( $v ) && preg_match( '/^\s*\d+\s*$/', $v ) ) || ( is_float( $v ) && floor( $v ) === $v ) ) {
				$v = (int) $v;
				return max( $min, min( $max, $v ) );
			}
			if ( is_string( $v ) && preg_match( '/^\s*[\d.]+\s*$/', $v ) ) {
				// "125.000" typed the Indonesian way.
				return max( $min, min( $max, (int) str_replace( '.', '', $v ) ) );
			}
			return $default;
		};
		$rate  = function ( $v ) use ( $int ) {
			if ( null === $v || '' === $v ) {
				return null;
			}
			$n = $int( $v, 0, 100000000, null );
			return null === $n || 0 === $n ? null : $n;
		};
		$rates = array();
		foreach ( isset( $t['rates'] ) && is_array( $t['rates'] ) ? $t['rates'] : array() as $pair => $r ) {
			if ( ! preg_match( '/^([a-z]{2})-([a-z]{2})$/', (string) $pair, $m ) || $m[1] === $m[2] || ! in_array( $m[1], ContextChat_Price_Engine::LANGS, true ) || ! in_array( $m[2], ContextChat_Price_Engine::LANGS, true ) || ! is_array( $r ) ) {
				continue;
			}
			$regular = $rate( isset( $r['regular'] ) ? $r['regular'] : null );
			$sworn   = $rate( isset( $r['sworn'] ) ? $r['sworn'] : null );
			if ( null === $regular && null === $sworn ) {
				continue;
			}
			$rates[ $pair ] = array(
				'regular' => $regular,
				'sworn'   => $sworn,
			);
		}
		if ( ! $rates ) {
			return null;
		}
		$l     = isset( $t['legalisation'] ) && is_array( $t['legalisation'] ) ? $t['legalisation'] : array();
		$e     = isset( $t['express_percent'] ) && is_array( $t['express_percent'] ) ? $t['express_percent'] : array();
		$tiers = array();
		foreach ( isset( $t['volume_discounts'] ) && is_array( $t['volume_discounts'] ) ? $t['volume_discounts'] : array() as $tier ) {
			if ( ! is_array( $tier ) ) {
				continue;
			}
			$docs = $int( isset( $tier['min_documents'] ) ? $tier['min_documents'] : null, 2, 100000, null );
			$pct  = $int( isset( $tier['percent'] ) ? $tier['percent'] : null, 0, 90, null );
			if ( $docs && $pct ) {
				$tiers[] = array(
					'min_documents' => $docs,
					'percent'       => $pct,
				);
			}
		}
		usort(
			$tiers,
			function ( $a, $b ) {
				return $b['min_documents'] - $a['min_documents'];
			}
		);
		$d   = isset( $t['deposit'] ) && is_array( $t['deposit'] ) ? $t['deposit'] : array();
		$rev = isset( $t['revisions'] ) && is_array( $t['revisions'] ) ? $t['revisions'] : array();
		$url = isset( $t['source_url'] ) ? trim( (string) $t['source_url'] ) : '';
		$out = array(
			'version'              => isset( $t['version'] ) && preg_match( '/^\d{4}-\d{2}-\d{2}$/', (string) $t['version'] ) ? (string) $t['version'] : gmdate( 'Y-m-d' ),
			'source_url'           => preg_match( '~^https?://~i', $url ) ? substr( $url, 0, 300 ) : '',
			'fetched_at'           => isset( $t['fetched_at'] ) && preg_match( '/^\d{4}-\d{2}-\d{2}$/', (string) $t['fetched_at'] ) ? (string) $t['fetched_at'] : gmdate( 'Y-m-d' ),
			'currency'             => 'IDR',
			'unit'                 => 'translated A4 page',
			'rates'                => $rates,
			'legalisation'         => array(
				'ministry'  => $int( isset( $l['ministry'] ) ? $l['ministry'] : 0, 0, 100000000, 0 ),
				'embassy'   => $int( isset( $l['embassy'] ) ? $l['embassy'] : 0, 0, 100000000, 0 ),
				'apostille' => $int( isset( $l['apostille'] ) ? $l['apostille'] : 0, 0, 100000000, 0 ),
			),
			'terminology_per_hour' => $int( isset( $t['terminology_per_hour'] ) ? $t['terminology_per_hour'] : 0, 0, 100000000, 0 ),
			'express_percent'      => array(
				'standard' => 100,
				'next_day' => $int( isset( $e['next_day'] ) ? $e['next_day'] : 150, 100, 500, 150 ),
				'same_day' => $int( isset( $e['same_day'] ) ? $e['same_day'] : 200, 100, 500, 200 ),
			),
			'volume_discounts'     => $tiers,
			'deposit'              => array(
				'min_total' => $int( isset( $d['min_total'] ) ? $d['min_total'] : 1000000, 0, 1000000000, 1000000 ),
				'percent'   => $int( isset( $d['percent'] ) ? $d['percent'] : 50, 0, 100, 50 ),
			),
			'min_pages'            => $int( isset( $t['min_pages'] ) ? $t['min_pages'] : 1, 1, 100, 1 ),
			'revisions'            => array(
				'count' => $int( isset( $rev['count'] ) ? $rev['count'] : 3, 0, 20, 3 ),
				'days'  => $int( isset( $rev['days'] ) ? $rev['days'] : 7, 0, 365, 7 ),
			),
			'valid_days'           => $int( isset( $t['valid_days'] ) ? $t['valid_days'] : 7, 1, 90, 7 ),
		);
		return $out;
	}

	/**
	 * Same prices and rules, ignoring the dates.
	 *
	 * @param array $a Table.
	 * @param array $b Table.
	 * @return bool
	 */
	public static function same_as_seed( array $a, array $b ) {
		$strip = function ( $t ) {
			$t = self::clean_table( $t );
			if ( null === $t ) {
				return null;
			}
			unset( $t['version'], $t['fetched_at'] );
			ksort( $t['rates'] );
			return $t;
		};
		return $strip( $a ) === $strip( $b );
	}

	/**
	 * Date a changed table as of today.
	 *
	 * @param array $t Clean table.
	 * @return array
	 */
	private static function stamp( array $t ) {
		$t['version']    = gmdate( 'Y-m-d' );
		$t['fetched_at'] = gmdate( 'Y-m-d' );
		return $t;
	}

	/**
	 * The Apostille list as editable lines: "AU 1995-03-16 Australia".
	 *
	 * @param array $list List.
	 * @return string
	 */
	public static function apostille_lines( array $list ) {
		$lines = array();
		foreach ( isset( $list['members'] ) ? $list['members'] : array() as $m ) {
			$lines[] = $m['code'] . ' ' . $m['in_force_from'] . ( isset( $m['name'] ) && '' !== $m['name'] ? ' ' . $m['name'] : '' );
		}
		return implode( "\n", $lines );
	}

	/**
	 * Members from editable lines. Bad lines are reported in $errors.
	 *
	 * @param string $text   Lines.
	 * @param array  $errors Line numbers that could not be read (filled).
	 * @return array
	 */
	public static function parse_apostille( $text, &$errors ) {
		$errors  = array();
		$members = array();
		foreach ( preg_split( '/\r\n|\r|\n/', (string) $text ) as $n => $line ) {
			$line = trim( $line );
			if ( '' === $line ) {
				continue;
			}
			if ( ! preg_match( '/^([A-Za-z]{2})\s+(\d{4}-\d{2}-\d{2})(?:\s+(.+))?$/u', $line, $m ) || false === strtotime( $m[2] ) ) {
				$errors[] = $n + 1;
				continue;
			}
			$code             = strtoupper( $m[1] );
			$members[ $code ] = array(
				'code'          => $code,
				'name'          => isset( $m[3] ) ? mb_substr( trim( wp_strip_all_tags( $m[3] ) ), 0, 120 ) : '',
				'in_force_from' => $m[2],
			);
		}
		ksort( $members );
		return array_values( $members );
	}

	/**
	 * Sanitize callback for the Apostille list.
	 *
	 * @param mixed $input Posted value.
	 * @return array Empty to use the bundled list.
	 */
	public static function sanitize_apostille( $input ) {
		if ( ! is_array( $input ) ) {
			return array();
		}
		if ( isset( $input['members'] ) && ! isset( $input['lines'] ) ) {
			return $input; // A second pass over a clean value.
		}
		$input = wp_unslash( $input );
		if ( ! empty( $input['reset'] ) ) {
			return array();
		}
		$members = self::parse_apostille( isset( $input['lines'] ) ? $input['lines'] : '', $errors );
		if ( $errors || ! $members ) {
			add_settings_error(
				'contextchat',
				'ctxc-apostille',
				/* translators: %s: line numbers. */
				sprintf( __( 'Some lines of the Apostille list could not be read (line %s). Each line needs a two-letter country code and a date, e.g. "AU 1995-03-16 Australia". The list was not changed.', 'contextchat' ), implode( ', ', array_slice( $errors, 0, 10 ) ) )
			);
			$stored = get_option( self::APOSTILLE );
			return is_array( $stored ) ? $stored : array();
		}
		$seed      = self::apostille_seed();
		$types     = array();
		foreach ( $seed['members'] as $m ) {
			$types[ $m['code'] ] = isset( $m['type'] ) ? $m['type'] : '';
		}
		foreach ( $members as $k => $m ) {
			$members[ $k ]['type'] = isset( $types[ $m['code'] ] ) ? $types[ $m['code'] ] : 'own';
		}
		$seed_keys = array();
		foreach ( $seed['members'] as $m ) {
			$seed_keys[ $m['code'] ] = $m['in_force_from'];
		}
		$new_keys = array();
		foreach ( $members as $m ) {
			$new_keys[ $m['code'] ] = $m['in_force_from'];
		}
		ksort( $seed_keys );
		if ( $new_keys === $seed_keys ) {
			return array(); // Same countries and dates as the bundled list.
		}
		$current = self::apostille();
		$current_keys = array();
		foreach ( $current['members'] as $m ) {
			$current_keys[ $m['code'] ] = $m['in_force_from'];
		}
		ksort( $current_keys );
		if ( $new_keys === $current_keys ) {
			return $current; // Saved again without changes.
		}
		return array(
			'source_url' => isset( $input['source_url'] ) && preg_match( '~^https?://~i', trim( (string) $input['source_url'] ) ) ? substr( trim( (string) $input['source_url'] ), 0, 300 ) : $seed['source_url'],
			'fetched_at' => gmdate( 'Y-m-d' ),
			'note'       => 'Edited on the Prices tab.',
			'members'    => $members,
		);
	}
}

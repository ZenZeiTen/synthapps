<?php
/**
 * Price engine: the only place a translation price is calculated (design plan section 7).
 *
 * Pure PHP with no WordPress or model calls. All amounts are whole rupiah as integers, and the
 * translation fee is rounded once, half up. The SI collects the details; this code sets the price.
 * The same test vectors (tests/fixtures/prices.json) run against the browser copy in
 * assets/js/price-engine.js.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Translation estimates from the official price table.
 */
class ContextChat_Price_Engine {

	/** Language codes the table may use. */
	const LANGS = array( 'id', 'en', 'zh', 'ja', 'ko', 'de', 'fr', 'es', 'it', 'nl', 'ar', 'ru', 'pt' );

	/** Speeds. */
	const SPEEDS = array( 'standard', 'next_day', 'same_day' );

	/** Legalisation choices. 'auto' takes the route from the destination country. */
	const LEGALISATION = array( 'auto', 'none', 'apostille', 'ministry_embassy' );

	/** Above this many documents, corporate work goes to the team. */
	const TEAM_DOCUMENTS = 40;

	/** Upper bound on pages and documents, so a typo cannot produce an absurd number. */
	const MAX_COUNT = 10000;

	/** Language names for the breakdown lines. */
	const LANG_NAMES = array(
		'id' => array(
			'id' => 'Indonesia',
			'en' => 'Inggris',
			'zh' => 'Mandarin',
			'ja' => 'Jepang',
			'ko' => 'Korea',
			'de' => 'Jerman',
			'fr' => 'Prancis',
			'es' => 'Spanyol',
			'it' => 'Italia',
			'nl' => 'Belanda',
			'ar' => 'Arab',
			'ru' => 'Rusia',
			'pt' => 'Portugis',
		),
		'en' => array(
			'id' => 'Indonesian',
			'en' => 'English',
			'zh' => 'Mandarin',
			'ja' => 'Japanese',
			'ko' => 'Korean',
			'de' => 'German',
			'fr' => 'French',
			'es' => 'Spanish',
			'it' => 'Italian',
			'nl' => 'Dutch',
			'ar' => 'Arabic',
			'ru' => 'Russian',
			'pt' => 'Portuguese',
		),
	);

	/** Decoded price table. @var array */
	private $table;

	/** Country routes, or null to accept only an explicit legalisation. @var ContextChat_Countries|null */
	private $countries;

	/** Makes reference codes; replaced in tests. @var callable */
	private $reference;

	/**
	 * Set up.
	 *
	 * @param array                      $table     Decoded price table (data/price-table.nusalexia.json).
	 * @param ContextChat_Countries|null $countries Country routes.
	 * @param callable|null              $reference Returns a reference code for a date (Ymd).
	 */
	public function __construct( array $table, $countries = null, $reference = null ) {
		$this->table     = $table;
		$this->countries = $countries;
		$this->reference = $reference ? $reference : array( __CLASS__, 'reference' );
	}

	/**
	 * The bundled price table.
	 *
	 * @return array
	 */
	public static function seed() {
		$table = json_decode( (string) file_get_contents( dirname( __DIR__, 2 ) . '/data/price-table.nusalexia.json' ), true );
		return is_array( $table ) ? $table : array();
	}

	/**
	 * A reference such as EST-20261121-4F7K, in the easy-to-read alphabet (no 0/O/1/I/L).
	 *
	 * @param string $ymd    Date as Ymd.
	 * @param string $prefix Prefix.
	 * @return string
	 */
	public static function reference( $ymd, $prefix = 'EST' ) {
		$alphabet = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
		$code     = '';
		for ( $i = 0; $i < 4; $i++ ) {
			$code .= $alphabet[ random_int( 0, strlen( $alphabet ) - 1 ) ];
		}
		return $prefix . '-' . $ymd . '-' . $code;
	}

	/**
	 * Calculate an estimate.
	 *
	 * @param array  $in    package, source_lang, target_lang, pages, documents, and optionally speed,
	 *                      legalisation, destination_country, legal_documents, matter.
	 * @param string $today Date as Y-m-d, for the reference and the Apostille list.
	 * @param string $lang  'id' or 'en', for the line labels.
	 * @return array Result as in design plan section 7.3, or status 'invalid' with errors.
	 */
	public function quote( array $in, $today, $lang = 'id' ) {
		$lang   = 'en' === $lang ? 'en' : 'id';
		$errors = array();

		$package = isset( $in['package'] ) ? (string) $in['package'] : '';
		if ( ! in_array( $package, array( 'regular', 'sworn' ), true ) ) {
			$errors[] = 'package';
		}
		$source = isset( $in['source_lang'] ) ? strtolower( trim( (string) $in['source_lang'] ) ) : '';
		$target = isset( $in['target_lang'] ) ? strtolower( trim( (string) $in['target_lang'] ) ) : '';
		if ( ! in_array( $source, self::LANGS, true ) ) {
			$errors[] = 'source_lang';
		}
		if ( ! in_array( $target, self::LANGS, true ) || $target === $source ) {
			$errors[] = 'target_lang';
		}
		$pages     = self::count( isset( $in['pages'] ) ? $in['pages'] : null );
		$documents = self::count( isset( $in['documents'] ) ? $in['documents'] : null );
		$min_pages = isset( $this->table['min_pages'] ) ? max( 1, (int) $this->table['min_pages'] ) : 1;
		if ( $pages < $min_pages ) {
			$errors[] = 'pages';
		}
		if ( $documents < 1 ) {
			$errors[] = 'documents';
		}
		$speed = isset( $in['speed'] ) && '' !== $in['speed'] ? (string) $in['speed'] : 'standard';
		if ( ! in_array( $speed, self::SPEEDS, true ) ) {
			$errors[] = 'speed';
		}
		$destination  = isset( $in['destination_country'] ) ? trim( (string) $in['destination_country'] ) : '';
		$legalisation = isset( $in['legalisation'] ) && '' !== $in['legalisation'] ? (string) $in['legalisation'] : ( '' !== $destination ? 'auto' : 'none' );
		if ( ! in_array( $legalisation, self::LEGALISATION, true ) ) {
			$errors[] = 'legalisation';
		}
		$legal_docs = isset( $in['legal_documents'] ) ? self::count( $in['legal_documents'] ) : $documents;
		if ( $legal_docs < 1 && 'none' !== $legalisation ) {
			$errors[] = 'legal_documents';
		}
		if ( $errors ) {
			return array(
				'status' => 'invalid',
				'errors' => $errors,
			);
		}

		$names = self::LANG_NAMES[ $lang ];
		$pair  = $source . '-' . $target;
		$rate  = isset( $this->table['rates'][ $pair ][ $package ] ) ? $this->table['rates'][ $pair ][ $package ] : null;
		if ( null === $rate || (int) $rate <= 0 ) {
			return array(
				'status' => 'unavailable',
				'reason' => isset( $this->table['rates'][ $pair ] ) ? 'package_not_offered' : 'pair_not_offered',
				'pair'   => $names[ $source ] . ' → ' . $names[ $target ],
			);
		}
		$rate = (int) $rate;

		$notes = array( 'estimate', 'final_pages_from_output', 'new_client_deposit' );
		$team  = array();

		// Legalisation route.
		$country = '';
		if ( 'auto' === $legalisation ) {
			$route = $this->countries ? $this->countries->route( $destination, $today ) : array(
				'code'  => '',
				'route' => '',
			);
			$country      = $route['code'];
			$legalisation = $route['route'];
			if ( '' === $legalisation ) {
				$team[]  = 'destination_unknown';
				$notes[] = 'legalisation_route_unknown';
			}
		}

		// Translation fee: one rounding step for express and discount together.
		$translation = $rate * $pages;
		$express     = isset( $this->table['express_percent'][ $speed ] ) ? (int) $this->table['express_percent'][ $speed ] : ( 'standard' === $speed ? 100 : 0 );
		if ( $express < 100 ) {
			return array(
				'status' => 'invalid',
				'errors' => array( 'speed' ),
			);
		}
		$discount_percent = 0;
		$tiers            = isset( $this->table['volume_discounts'] ) && is_array( $this->table['volume_discounts'] ) ? $this->table['volume_discounts'] : array();
		foreach ( $tiers as $tier ) {
			if ( $documents >= (int) $tier['min_documents'] && (int) $tier['percent'] > $discount_percent ) {
				$discount_percent = (int) $tier['percent'];
			}
		}
		$keep            = 100 - $discount_percent;
		$translation_net = self::round_div( $translation * $express * $keep, 10000 );
		$with_express    = self::round_div( $translation * $express, 100 );
		$surcharge       = $with_express - $translation;
		$discount        = $with_express - $translation_net;

		$package_name = 'sworn' === $package
			? ( 'en' === $lang ? 'Sworn translation' : 'Terjemahan tersumpah' )
			: ( 'en' === $lang ? 'Regular translation' : 'Terjemahan reguler' );
		$lines        = array(
			array(
				'kind'       => 'translation',
				'label'      => $package_name . ' ' . $names[ $source ] . ' → ' . $names[ $target ],
				'qty'        => $pages,
				'unit'       => 'en' === $lang ? 'pages' : 'halaman',
				'unit_price' => $rate,
				'amount'     => $translation,
			),
		);

		// Legalisation is never discounted (D-15).
		$legal_total = 0;
		$fees        = isset( $this->table['legalisation'] ) ? $this->table['legalisation'] : array();
		$unit_docs   = 'en' === $lang ? 'documents' : 'dokumen';
		if ( 'apostille' === $legalisation ) {
			$lines[] = self::legal_line( 'apostille', 'Apostille', (int) $fees['apostille'], $legal_docs, $unit_docs );
		} elseif ( 'ministry_embassy' === $legalisation ) {
			$lines[] = self::legal_line( 'ministry', 'en' === $lang ? 'Kemenkum/Kemenlu legalisation' : 'Legalisasi Kemenkum/Kemenlu', (int) $fees['ministry'], $legal_docs, $unit_docs );
			$lines[] = self::legal_line( 'embassy', 'en' === $lang ? 'Embassy legalisation' : 'Legalisasi Kedutaan', (int) $fees['embassy'], $legal_docs, $unit_docs );
		}
		foreach ( $lines as $line ) {
			if ( 'translation' !== $line['kind'] ) {
				$legal_total += $line['amount'];
			}
		}

		$total   = $translation_net + $legal_total;
		$deposit = 0;
		$rule    = isset( $this->table['deposit'] ) ? $this->table['deposit'] : array(
			'min_total' => 1000000,
			'percent'   => 50,
		);
		if ( $total >= (int) $rule['min_total'] ) {
			$deposit = self::round_div( $total * (int) $rule['percent'], 100 );
		}

		if ( 'standard' !== $speed ) {
			$team[]  = 'express';
			$notes[] = 'express_capacity';
		}
		$matter = isset( $in['matter'] ) ? (string) $in['matter'] : '';
		if ( 'corporate' === $matter ) {
			$notes[] = 'corporate_pph23';
			if ( $documents > self::TEAM_DOCUMENTS ) {
				$team[] = 'corporate_volume';
			}
		}
		if ( $discount_percent ) {
			$notes[] = 'volume_discount';
		}

		$ymd = str_replace( '-', '', (string) $today );
		return array(
			'status'            => $team ? 'needs_team' : 'ok',
			'team_reasons'      => $team,
			'reference'         => call_user_func( $this->reference, $ymd ),
			'currency'          => 'IDR',
			'package'           => $package,
			'source_lang'       => $source,
			'target_lang'       => $target,
			'pages'             => $pages,
			'documents'         => $documents,
			'speed'             => $speed,
			'legalisation'      => $legalisation,
			'country'           => $country,
			'lines'             => $lines,
			'express_surcharge' => $surcharge,
			'discount_percent'  => $discount_percent,
			'discount'          => $discount,
			'translation_total' => $translation_net,
			'legalisation_total' => $legal_total,
			'total'             => $total,
			'deposit'           => $deposit,
			'valid_days'        => isset( $this->table['valid_days'] ) ? (int) $this->table['valid_days'] : 7,
			'table_version'     => isset( $this->table['version'] ) ? (string) $this->table['version'] : '',
			'notes'             => $notes,
		);
	}

	/**
	 * Every amount a reply may quote without a calculation: per-page rates and add-on fees.
	 *
	 * @return int[]
	 */
	public function published_amounts() {
		$amounts = array();
		foreach ( isset( $this->table['rates'] ) ? $this->table['rates'] : array() as $rates ) {
			foreach ( $rates as $rate ) {
				if ( null !== $rate ) {
					$amounts[] = (int) $rate;
				}
			}
		}
		foreach ( isset( $this->table['legalisation'] ) ? $this->table['legalisation'] : array() as $fee ) {
			$amounts[] = (int) $fee;
		}
		if ( isset( $this->table['terminology_per_hour'] ) ) {
			$amounts[] = (int) $this->table['terminology_per_hour'];
		}
		if ( isset( $this->table['legalisation']['ministry'], $this->table['legalisation']['embassy'] ) ) {
			$amounts[] = (int) $this->table['legalisation']['ministry'] + (int) $this->table['legalisation']['embassy'];
		}
		if ( isset( $this->table['deposit']['min_total'] ) ) {
			$amounts[] = (int) $this->table['deposit']['min_total'];
		}
		$amounts = array_values( array_unique( $amounts ) );
		sort( $amounts );
		return $amounts;
	}

	/**
	 * A positive whole number from model or form input, or 0.
	 *
	 * @param mixed $value Value.
	 * @return int
	 */
	private static function count( $value ) {
		if ( is_int( $value ) ) {
			$n = $value;
		} elseif ( is_string( $value ) && preg_match( '/^\s*\d+\s*$/', $value ) ) {
			$n = (int) $value;
		} elseif ( is_float( $value ) && floor( $value ) === $value ) {
			$n = (int) $value;
		} else {
			return 0;
		}
		return ( $n >= 1 && $n <= self::MAX_COUNT ) ? $n : 0;
	}

	/**
	 * Integer division rounded half up, for non-negative numbers.
	 *
	 * @param int $num Numerator.
	 * @param int $den Denominator.
	 * @return int
	 */
	private static function round_div( $num, $den ) {
		return intdiv( 2 * $num + $den, 2 * $den );
	}

	/**
	 * One legalisation line.
	 *
	 * @param string $kind  Kind.
	 * @param string $label Label.
	 * @param int    $fee   Fee per document.
	 * @param int    $docs  Documents.
	 * @param string $unit  Unit word.
	 * @return array
	 */
	private static function legal_line( $kind, $label, $fee, $docs, $unit ) {
		return array(
			'kind'       => $kind,
			'label'      => $label,
			'qty'        => $docs,
			'unit'       => $unit,
			'unit_price' => $fee,
			'amount'     => $fee * $docs,
		);
	}
}

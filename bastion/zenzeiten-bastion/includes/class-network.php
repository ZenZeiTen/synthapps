<?php
/**
 * Who an address belongs to: the network's owner and its country, for the live feed.
 *
 * @package ZenZeiTenBastion
 */

namespace ZenZeiTenBastion;

defined( 'ABSPATH' ) || exit;

/**
 * Looks addresses up in public registries and remembers the answers.
 *
 * Lookups run only while an administrator has the live monitor open, never during a visitor's
 * request. Two sources are asked, in order: Team Cymru's IP-to-network service (a DNS lookup) and,
 * when that gives nothing, the address registries' own records through rdap.org.
 */
final class Network {

	const OPTION = 'zbst_ip_networks';

	/**
	 * How long an answer is kept (30 days), and how long "nothing found" is kept (6 hours).
	 */
	const KEEP_SECONDS = 2592000;
	const MISS_SECONDS = 21600;

	/**
	 * Most addresses remembered. The oldest are dropped first.
	 */
	const MAX_ENTRIES = 500;

	/**
	 * Remembered answers, read once per request.
	 *
	 * @var array|null
	 */
	private static $cache = null;

	/**
	 * Forget what this request has read (between tests).
	 */
	public static function reset() {
		self::$cache = null;
	}

	/**
	 * Whether the site owner allows lookups.
	 *
	 * @return bool
	 */
	public static function enabled() {
		return (bool) Settings::get( 'ip_lookup' );
	}

	/**
	 * Ranges that belong to nobody on the internet: private, loopback, link-local, carrier-grade
	 * NAT, multicast and reserved. Listed here, not left to PHP's filter, whose list differs
	 * between PHP versions.
	 */
	const NOT_PUBLIC = array(
		'0.0.0.0/8',
		'10.0.0.0/8',
		'100.64.0.0/10',
		'127.0.0.0/8',
		'169.254.0.0/16',
		'172.16.0.0/12',
		'192.168.0.0/16',
		'224.0.0.0/3',
		'::/8',
		'fc00::/7',
		'fe80::/10',
		'ff00::/8',
	);

	/**
	 * Whether an address can be looked up at all: a public one, not a private or loopback one.
	 *
	 * @param string $ip Address.
	 * @return bool
	 */
	public static function is_public( $ip ) {
		$ip = IP::normalize( $ip );
		return '' !== $ip && ! IP::in_any( $ip, self::NOT_PUBLIC );
	}

	/**
	 * Remembered answers.
	 *
	 * @return array Address => array( owner, country, asn, time ).
	 */
	private static function all() {
		if ( null === self::$cache ) {
			$stored      = get_option( self::OPTION, array() );
			self::$cache = is_array( $stored ) ? $stored : array();
		}
		return self::$cache;
	}

	/**
	 * What is already known about an address, without asking anyone.
	 *
	 * @param string $ip Address.
	 * @return array|null|false Owner and country; null when a lookup found nothing; false when
	 *                          the address has not been looked up yet, or the answer is too old.
	 */
	public static function known( $ip ) {
		$ip  = IP::normalize( $ip );
		$all = self::all();
		if ( '' === $ip || ! isset( $all[ $ip ] ) || ! is_array( $all[ $ip ] ) ) {
			return false;
		}
		$entry = $all[ $ip ];
		$found = '' !== (string) $entry['owner'] || '' !== (string) $entry['country'];
		if ( time() - (int) $entry['time'] > ( $found ? self::KEEP_SECONDS : self::MISS_SECONDS ) ) {
			return false;
		}
		return $found ? self::public_fields( $entry ) : null;
	}

	/**
	 * The fields shown to administrators.
	 *
	 * @param array $entry Stored entry.
	 * @return array
	 */
	private static function public_fields( array $entry ) {
		return array(
			'owner'   => (string) $entry['owner'],
			'country' => (string) $entry['country'],
			'asn'     => (int) $entry['asn'],
		);
	}

	/**
	 * Owner and country of an address, looking it up when it is not remembered.
	 *
	 * @param string $ip Address.
	 * @return array|null Keys owner, country (two-letter code) and asn; null when nothing is known.
	 */
	public static function lookup( $ip ) {
		$ip = IP::normalize( $ip );
		if ( '' === $ip || ! self::enabled() || ! self::is_public( $ip ) ) {
			return null;
		}
		$known = self::known( $ip );
		if ( false !== $known ) {
			return $known;
		}
		$found = self::from_cymru( $ip );
		if ( ! $found ) {
			$found = self::from_rdap( $ip );
		}
		$entry = array(
			'owner'   => $found ? Request::clip( $found['owner'], 80 ) : '',
			'country' => $found && preg_match( '/^[A-Z]{2}$/', $found['country'] ) ? $found['country'] : '',
			'asn'     => $found ? (int) $found['asn'] : 0,
			'time'    => time(),
		);
		self::remember( $ip, $entry );
		return '' !== $entry['owner'] || '' !== $entry['country'] ? self::public_fields( $entry ) : null;
	}

	/**
	 * Store an answer, dropping the oldest ones beyond the limit.
	 *
	 * @param string $ip    Address.
	 * @param array  $entry Entry.
	 */
	private static function remember( $ip, array $entry ) {
		$all = self::all();
		unset( $all[ $ip ] );
		$all[ $ip ] = $entry;
		if ( count( $all ) > self::MAX_ENTRIES ) {
			$all = array_slice( $all, -self::MAX_ENTRIES, null, true );
		}
		update_option( self::OPTION, $all, false );
		self::$cache = $all;
	}

	/**
	 * TXT records of a DNS name.
	 *
	 * @param string $host Name.
	 * @return string[]
	 */
	private static function txt( $host ) {
		// Tests, and sites that resolve names another way, answer through this filter.
		$records = apply_filters( 'zbst_dns_txt', null, $host );
		if ( null === $records ) {
			if ( ! function_exists( 'dns_get_record' ) ) {
				return array();
			}
			$records = array();
			// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- a failed lookup warns; the result is checked instead.
			foreach ( (array) @dns_get_record( $host, DNS_TXT ) as $record ) {
				if ( is_array( $record ) && isset( $record['txt'] ) ) {
					$records[] = (string) $record['txt'];
				}
			}
		}
		return array_values( array_filter( (array) $records, 'is_string' ) );
	}

	/**
	 * The name Team Cymru's service answers for an address: its parts in reverse order.
	 *
	 * @param string $ip Normalized address.
	 * @return string
	 */
	public static function cymru_name( $ip ) {
		$bin = inet_pton( $ip );
		if ( 4 === strlen( $bin ) ) {
			return implode( '.', array_reverse( explode( '.', $ip ) ) ) . '.origin.asn.cymru.com';
		}
		return implode( '.', str_split( strrev( bin2hex( $bin ) ) ) ) . '.origin6.asn.cymru.com';
	}

	/**
	 * Look an address up with Team Cymru.
	 *
	 * The first answer reads "15169 | 8.8.8.0/24 | US | arin | 1992-12-01": network number,
	 * range, country. The second, for that network number, reads
	 * "15169 | US | arin | 2000-03-30 | GOOGLE, US": the last field is the owner.
	 *
	 * @param string $ip Normalized address.
	 * @return array|null Keys owner, country, asn.
	 */
	private static function from_cymru( $ip ) {
		$origin = self::txt( self::cymru_name( $ip ) );
		if ( ! $origin ) {
			return null;
		}
		$fields = array_map( 'trim', explode( '|', $origin[0] ) );
		// An address announced by several networks lists them all; the first one is used.
		$asn = isset( $fields[0] ) ? (int) strtok( $fields[0], ' ' ) : 0;
		if ( $asn <= 0 ) {
			return null;
		}
		$country = isset( $fields[2] ) ? strtoupper( $fields[2] ) : '';
		$owner   = '';
		$names   = self::txt( 'AS' . $asn . '.asn.cymru.com' );
		if ( $names ) {
			$parts = array_map( 'trim', explode( '|', $names[0] ) );
			$owner = isset( $parts[4] ) ? $parts[4] : '';
			// "GOOGLE, US": the country at the end repeats what is shown beside it.
			$owner = (string) preg_replace( '/,\s*[A-Z]{2}$/', '', $owner );
			if ( '' === $country && isset( $parts[1] ) ) {
				$country = strtoupper( $parts[1] );
			}
		}
		return array(
			'owner'   => '' !== $owner ? $owner : 'AS' . $asn,
			'country' => $country,
			'asn'     => $asn,
		);
	}

	/**
	 * Look an address up in its registry's records (RDAP).
	 *
	 * @param string $ip Normalized address.
	 * @return array|null Keys owner, country, asn.
	 */
	private static function from_rdap( $ip ) {
		$response = wp_remote_get(
			'https://rdap.org/ip/' . rawurlencode( $ip ),
			array(
				'timeout'             => 4,
				'redirection'         => 3,
				'limit_response_size' => 262144,
				'user-agent'          => 'ZenZeiTen-Bastion/' . ZBST_VERSION,
				'headers'             => array( 'Accept' => 'application/rdap+json, application/json' ),
			)
		);
		if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
			return null;
		}
		$data = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		if ( ! is_array( $data ) ) {
			return null;
		}
		$owner = '';
		// The registrant's organisation name reads better than the range's short name.
		foreach ( isset( $data['entities'] ) && is_array( $data['entities'] ) ? $data['entities'] : array() as $entity ) {
			if ( ! is_array( $entity ) || ! in_array( 'registrant', isset( $entity['roles'] ) ? (array) $entity['roles'] : array(), true ) ) {
				continue;
			}
			foreach ( isset( $entity['vcardArray'][1] ) && is_array( $entity['vcardArray'][1] ) ? $entity['vcardArray'][1] : array() as $field ) {
				if ( is_array( $field ) && isset( $field[0], $field[3] ) && 'fn' === $field[0] && is_string( $field[3] ) ) {
					$owner = $field[3];
					break 2;
				}
			}
		}
		if ( '' === $owner && isset( $data['name'] ) && is_string( $data['name'] ) ) {
			$owner = $data['name'];
		}
		$country = isset( $data['country'] ) && is_string( $data['country'] ) ? strtoupper( $data['country'] ) : '';
		if ( '' === $owner && '' === $country ) {
			return null;
		}
		return array(
			'owner'   => $owner,
			'country' => $country,
			'asn'     => 0,
		);
	}
}

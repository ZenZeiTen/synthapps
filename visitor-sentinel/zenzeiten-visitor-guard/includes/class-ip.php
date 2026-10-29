<?php
/**
 * IP address helpers: client address resolution, ranges, anonymizing.
 *
 * This class has no WordPress dependencies so it can be unit tested on its own.
 *
 * @package VisitorSentinel
 */

namespace VisitorSentinel;

defined( 'ABSPATH' ) || exit;

/**
 * Static IP helpers for IPv4 and IPv6.
 */
final class IP {

	/**
	 * Canonical form of an address, or '' when it is not a valid IP.
	 * Strips ports, brackets and zone IDs, and turns IPv4-mapped IPv6 back into IPv4.
	 *
	 * @param string $ip Address.
	 * @return string
	 */
	public static function normalize( $ip ) {
		$ip = trim( (string) $ip );
		if ( '' === $ip || strlen( $ip ) > 64 ) {
			return '';
		}
		if ( preg_match( '/^\[([^\]]+)\](?::\d+)?$/', $ip, $m ) ) {
			$ip = $m[1];
		} elseif ( preg_match( '/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/', $ip, $m ) ) {
			$ip = $m[1];
		}
		$zone = strpos( $ip, '%' );
		if ( false !== $zone ) {
			$ip = substr( $ip, 0, $zone );
		}
		if ( false === filter_var( $ip, FILTER_VALIDATE_IP ) ) {
			return '';
		}
		$bin = inet_pton( $ip );
		if ( 16 === strlen( $bin ) && 0 === strncmp( $bin, str_repeat( "\0", 10 ) . "\xff\xff", 12 ) ) {
			return inet_ntop( substr( $bin, 12 ) );
		}
		return inet_ntop( $bin );
	}

	/**
	 * Whether a string is a valid IP address.
	 *
	 * @param string $ip Address.
	 * @return bool
	 */
	public static function is_valid( $ip ) {
		return '' !== self::normalize( $ip );
	}

	/**
	 * Whether an address is IPv6.
	 *
	 * @param string $ip Normalized address.
	 * @return bool
	 */
	public static function is_v6( $ip ) {
		return false !== strpos( (string) $ip, ':' );
	}

	/**
	 * Parse "ip" or "ip/prefix" into its binary network and prefix length.
	 *
	 * @param string $range Range.
	 * @return array|null Array with keys bin, prefix and canonical, or null when invalid.
	 */
	public static function parse_range( $range ) {
		$range  = trim( (string) $range );
		$prefix = null;
		if ( false !== strpos( $range, '/' ) ) {
			list( $addr, $bits ) = explode( '/', $range, 2 );
			if ( '' === $bits || ! ctype_digit( $bits ) ) {
				return null;
			}
			$prefix = (int) $bits;
		} else {
			$addr = $range;
		}
		$addr = self::normalize( $addr );
		if ( '' === $addr ) {
			return null;
		}
		$bin  = inet_pton( $addr );
		$size = strlen( $bin ) * 8;
		if ( null === $prefix ) {
			$prefix = $size;
		}
		if ( $prefix > $size ) {
			return null;
		}
		$network = self::mask_bin( $bin, $prefix );
		return array(
			'bin'       => $network,
			'prefix'    => $prefix,
			'canonical' => $prefix === $size ? $addr : inet_ntop( $network ) . '/' . $prefix,
		);
	}

	/**
	 * Whether an address falls inside a range.
	 *
	 * @param string       $ip    Address.
	 * @param string|array $range Range string or a parse_range() result.
	 * @return bool
	 */
	public static function in_range( $ip, $range ) {
		$ip = self::normalize( $ip );
		if ( '' === $ip ) {
			return false;
		}
		$parsed = is_array( $range ) ? $range : self::parse_range( $range );
		if ( ! $parsed ) {
			return false;
		}
		$bin = inet_pton( $ip );
		if ( strlen( $bin ) !== strlen( $parsed['bin'] ) ) {
			return false;
		}
		return self::mask_bin( $bin, $parsed['prefix'] ) === $parsed['bin'];
	}

	/**
	 * Whether an address falls inside any of the ranges.
	 *
	 * @param string $ip     Address.
	 * @param array  $ranges Range strings or parse_range() results.
	 * @return bool
	 */
	public static function in_any( $ip, array $ranges ) {
		foreach ( $ranges as $range ) {
			if ( self::in_range( $ip, $range ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Parse free text (one entry per line, commas and spaces also separate, # starts a comment)
	 * into canonical ranges. Invalid entries are dropped.
	 *
	 * @param string $text Text.
	 * @return string[]
	 */
	public static function parse_list( $text ) {
		$out = array();
		foreach ( preg_split( '/\r\n|\r|\n/', (string) $text ) as $line ) {
			$hash = strpos( $line, '#' );
			if ( false !== $hash ) {
				$line = substr( $line, 0, $hash );
			}
			foreach ( preg_split( '/[\s,;]+/', $line ) as $entry ) {
				$parsed = '' === $entry ? null : self::parse_range( $entry );
				if ( $parsed ) {
					$out[ $parsed['canonical'] ] = true;
				}
			}
		}
		return array_keys( $out );
	}

	/**
	 * Coarsen an address so it no longer identifies one device: IPv4 to /24, IPv6 to /48.
	 *
	 * @param string $ip Address.
	 * @return string
	 */
	public static function anonymize( $ip ) {
		$ip = self::normalize( $ip );
		if ( '' === $ip ) {
			return '';
		}
		$bin = inet_pton( $ip );
		return inet_ntop( self::mask_bin( $bin, 16 === strlen( $bin ) ? 48 : 24 ) );
	}

	/**
	 * Resolve the real client address.
	 *
	 * The proxy header is believed only when REMOTE_ADDR is a trusted proxy. The header is read
	 * right to left, skipping trusted hops, so a client cannot spoof its address by prepending
	 * values to X-Forwarded-For.
	 *
	 * @param array  $server  $_SERVER-like array.
	 * @param array  $trusted Trusted proxy ranges.
	 * @param string $header  Header name such as X-Forwarded-For, or '' to use REMOTE_ADDR only.
	 * @return string
	 */
	public static function resolve( array $server, array $trusted, $header ) {
		$remote = self::normalize( isset( $server['REMOTE_ADDR'] ) ? $server['REMOTE_ADDR'] : '' );
		if ( '' === $remote || '' === (string) $header || empty( $trusted ) || ! self::in_any( $remote, $trusted ) ) {
			return $remote;
		}
		$key = 'HTTP_' . strtoupper( str_replace( '-', '_', (string) $header ) );
		if ( empty( $server[ $key ] ) || ! is_string( $server[ $key ] ) ) {
			return $remote;
		}
		$hops = explode( ',', $server[ $key ] );
		$last = '';
		for ( $i = count( $hops ) - 1; $i >= 0; $i-- ) {
			$hop = self::normalize( $hops[ $i ] );
			if ( '' === $hop ) {
				continue;
			}
			if ( ! self::in_any( $hop, $trusted ) ) {
				return $hop;
			}
			$last = $hop;
		}
		return '' !== $last ? $last : $remote;
	}

	/**
	 * Express an address or range in the form Google Ads accepts for IP exclusions:
	 * a single address, or IPv4 with trailing * wildcards for /8, /16 and /24.
	 * Returns '' for ranges Google Ads cannot express.
	 *
	 * @param string $value Address or CIDR range.
	 * @return string
	 */
	public static function to_google_ads( $value ) {
		$parsed = self::parse_range( $value );
		if ( ! $parsed ) {
			return '';
		}
		$addr = inet_ntop( $parsed['bin'] );
		if ( 16 === strlen( $parsed['bin'] ) ) {
			return 128 === $parsed['prefix'] ? $addr : '';
		}
		$parts = explode( '.', $addr );
		switch ( $parsed['prefix'] ) {
			case 32:
				return $addr;
			case 24:
				return $parts[0] . '.' . $parts[1] . '.' . $parts[2] . '.*';
			case 16:
				return $parts[0] . '.' . $parts[1] . '.*.*';
			case 8:
				return $parts[0] . '.*.*.*';
		}
		return '';
	}

	/**
	 * Zero every bit after the prefix.
	 *
	 * @param string $bin    Packed address.
	 * @param int    $prefix Prefix length.
	 * @return string
	 */
	private static function mask_bin( $bin, $prefix ) {
		$out = '';
		$len = strlen( $bin );
		for ( $i = 0; $i < $len; $i++ ) {
			$bits = max( 0, min( 8, $prefix - $i * 8 ) );
			$mask = 0 === $bits ? 0 : ( 0xFF << ( 8 - $bits ) ) & 0xFF;
			$out .= chr( ord( $bin[ $i ] ) & $mask );
		}
		return $out;
	}
}

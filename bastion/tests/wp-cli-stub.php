<?php
/**
 * A stand-in for WP-CLI's output functions, so the commands can run in the unit tests.
 *
 * @package ZenZeiTenBastion
 */

// phpcs:disable

namespace {
	final class WP_CLI {
		public static $out = array();
		public static function line( $text = '' ) { self::$out[] = $text; }
		public static function success( $text ) { self::$out[] = 'Success: ' . $text; }
		public static function warning( $text ) { self::$out[] = 'Warning: ' . $text; }
		public static function error( $text ) { throw new \RuntimeException( 'WP_CLI::error: ' . $text ); }
		public static function confirm( $question, $assoc_args = array() ) {}
		public static function add_command( $name, $class ) {}
	}
}

namespace WP_CLI\Utils {
	function format_items( $format, $items, $fields ) {
		foreach ( $items as $item ) {
			$row = array();
			foreach ( $fields as $field ) {
				$row[] = $item[ $field ];
			}
			\WP_CLI::$out[] = implode( ' | ', $row );
		}
	}
}

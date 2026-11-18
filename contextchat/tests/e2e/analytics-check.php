<?php
/**
 * Check that the analytics report counts days in the site time zone, not in UTC.
 *
 *   php tests/e2e/analytics-check.php <site-dir>
 *
 * The test site is in Asia/Jakarta (UTC+7), so its day starts at 17:00 UTC the day before. Two
 * clicks are stored one minute either side of the start of the 7-day report: only the later one
 * may be counted, and it belongs to the first day of the chart.
 */

$_SERVER['HTTP_HOST']   = 'localhost';
$_SERVER['REQUEST_URI'] = '/';
require rtrim( $argv[1], '/' ) . '/wp-load.php';

global $wpdb;
$table = ContextChat_Analytics::table();
$tz    = wp_timezone();
if ( 'Asia/Jakarta' !== $tz->getName() ) {
	fwrite( STDERR, "Expected the test site to be in Asia/Jakarta.\n" );
	exit( 1 );
}

$first_day = ( new DateTimeImmutable( 'today', $tz ) )->modify( '-6 days' );
$before    = ContextChat_Analytics::report( 7 );

foreach ( array( '-1 minute', '+1 minute' ) as $shift ) {
	$wpdb->insert( // phpcs:ignore
		$table,
		array(
			'created_at' => $first_day->modify( $shift )->setTimezone( new DateTimeZone( 'UTC' ) )->format( 'Y-m-d H:i:s' ),
			'path'       => '/time-zone-check/',
			'source'     => 'float',
		)
	);
}

$after  = ContextChat_Analytics::report( 7 );
$rows   = count( ContextChat_Analytics::rows( 7 ) );
$day    = $first_day->format( 'Y-m-d' );
$errors = array();

if ( array_keys( $after['daily'] )[0] !== $day || 7 !== count( $after['daily'] ) ) {
	$errors[] = 'the chart should cover 7 local days starting ' . $day . ', got ' . implode( ', ', array_keys( $after['daily'] ) );
}
if ( 1 !== $after['total'] - $before['total'] ) {
	$errors[] = 'exactly one of the two clicks is inside the period, counted ' . ( $after['total'] - $before['total'] );
}
if ( isset( $after['daily'][ $day ] ) && 1 !== $after['daily'][ $day ] - $before['daily'][ $day ] ) {
	$errors[] = 'the click just after local midnight belongs to ' . $day;
}
if ( array_sum( $after['daily'] ) !== $after['total'] ) {
	$errors[] = 'the daily counts (' . array_sum( $after['daily'] ) . ') should add up to the total (' . $after['total'] . ')';
}
if ( $rows !== $after['total'] ) {
	$errors[] = 'the CSV export (' . $rows . ' rows) should cover the same clicks as the report (' . $after['total'] . ')';
}

$wpdb->delete( $table, array( 'path' => '/time-zone-check/' ) ); // phpcs:ignore

if ( $errors ) {
	fwrite( STDERR, "Analytics time zone check failed:\n - " . implode( "\n - ", $errors ) . "\n" );
	exit( 1 );
}
echo "ok - analytics counts days in the site time zone ({$tz->getName()}), {$after['total']} clicks in the last 7 days\n";

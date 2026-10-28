<?php
/**
 * Minimal test runner: php tests/run.php [filter]
 *
 * Every function named test_* in tests/test-*.php is a test. A test fails when it throws,
 * including on any PHP warning or notice (the bootstrap turns those into exceptions).
 *
 * @package VisitorSentinel
 */

// phpcs:disable

require __DIR__ . '/bootstrap.php';

final class Assert_Failed extends Exception {}

function check( $condition, $message = 'assertion failed' ) {
	if ( ! $condition ) {
		throw new Assert_Failed( $message );
	}
}

function check_same( $expected, $actual, $message = '' ) {
	if ( $expected !== $actual ) {
		throw new Assert_Failed( ( '' !== $message ? $message . ': ' : '' ) . 'expected ' . var_export( $expected, true ) . ', got ' . var_export( $actual, true ) );
	}
}

foreach ( glob( __DIR__ . '/test-*.php' ) as $file ) {
	require $file;
}

$filter = $argv[1] ?? '';
$tests  = array_filter(
	get_defined_functions()['user'],
	function ( $name ) use ( $filter ) {
		return 0 === strpos( $name, 'test_' ) && ( '' === $filter || false !== strpos( $name, $filter ) );
	}
);

$failed = 0;
foreach ( $tests as $test ) {
	try {
		vsen_test_reset();
		$test();
		echo "  ok    {$test}\n";
	} catch ( Throwable $e ) {
		++$failed;
		echo "  FAIL  {$test}\n        " . get_class( $e ) . ': ' . $e->getMessage() . "\n        at " . $e->getFile() . ':' . $e->getLine() . "\n";
	}
}

printf( "\n%d tests, %d failed\n", count( $tests ), $failed );
exit( $failed ? 1 : 0 );

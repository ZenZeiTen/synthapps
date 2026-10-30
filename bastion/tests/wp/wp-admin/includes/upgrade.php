<?php
// phpcs:disable
// Test stand-in for WordPress's dbDelta(): creates missing tables on the SQLite test database.
function dbDelta( $statements ) {
	global $wpdb;
	foreach ( (array) $statements as $sql ) {
		preg_match( '/CREATE TABLE (\S+) /', $sql, $m );
		$exists = $wpdb->pdo->query( "SELECT name FROM sqlite_master WHERE type = 'table' AND name = " . $wpdb->pdo->quote( $m[1] ) )->fetchColumn();
		if ( ! $exists ) {
			$wpdb->create_from_dbdelta( array( $sql ) );
		}
	}
	return array();
}

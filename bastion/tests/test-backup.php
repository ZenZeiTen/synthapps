<?php
/**
 * Backup, verify, restore and automatic rollback on the SQLite database.
 *
 * @package ZenZeiTenBastion
 */

// phpcs:disable

use ZenZeiTenBastion\Backup;
use ZenZeiTenBastion\Log;
use ZenZeiTenBastion\Settings;

/**
 * A small WordPress-like table with awkward values.
 */
function zbst_seed_site() {
	global $wpdb;
	$wpdb->pdo->exec( 'CREATE TABLE wp_options (option_id INTEGER PRIMARY KEY AUTOINCREMENT, option_name TEXT NOT NULL, option_value TEXT, autoload TEXT)' );
	$wpdb->pdo->exec( 'CREATE TABLE wp_posts (ID INTEGER PRIMARY KEY AUTOINCREMENT, post_title TEXT, post_content TEXT, post_parent INTEGER)' );
	$values = zbst_tricky_values();
	foreach ( $values as $i => $v ) {
		$wpdb->insert( 'wp_posts', array( 'post_title' => 'Post ' . $i, 'post_content' => $v, 'post_parent' => $i ) );
	}
	$wpdb->insert( 'wp_options', array( 'option_name' => 'blogname', 'option_value' => 'Toko Budi', 'autoload' => 'yes' ) );
	$wpdb->insert( 'wp_options', array( 'option_name' => 'serialized', 'option_value' => serialize( array( 'a' => "line1\nline2", 'b' => 'é' ) ), 'autoload' => 'no' ) );
	// More rows than one SELECT batch, to exercise paging.
	for ( $i = 0; $i < 1203; $i++ ) {
		$wpdb->insert( 'wp_options', array( 'option_name' => 'bulk_' . $i, 'option_value' => str_repeat( 'x', $i % 50 ), 'autoload' => 'no' ) );
	}
}

function zbst_tricky_values() {
	return array(
		"plain text",
		"it's \"quoted\"",
		"back\\slash and \\' escape",
		"multi\nline\r\ntext\twith tabs",
		"unicode: Selamat datang — 日本語 🚀",
		"<script>alert('x')</script>; DROP TABLE wp_users; --",
		"",
		"X'414243' looks like hex",
		"%s %d %% placeholders",
		str_repeat( 'long ', 70000 ),
	);
}

function zbst_snapshot() {
	global $wpdb;
	return array(
		'posts'   => $wpdb->get_results( 'SELECT * FROM wp_posts ORDER BY ID', ARRAY_A ),
		'options' => $wpdb->get_results( 'SELECT * FROM wp_options ORDER BY option_id', ARRAY_A ),
	);
}

function zbst_vandalize() {
	global $wpdb;
	$wpdb->query( "UPDATE wp_options SET option_value = 'HACKED' WHERE option_name = 'blogname'" );
	$wpdb->query( 'DELETE FROM wp_posts WHERE ID > 3' );
	$wpdb->query( "INSERT INTO wp_posts (post_title, post_content, post_parent) VALUES ('spam', 'casino', 0)" );
	$wpdb->query( 'DROP TABLE wp_options' );
}

function test_backup_creates_a_verified_private_file() {
	zbst_seed_site();
	$m = Backup::create( 'manual' );
	check( is_array( $m ), is_wp_error( $m ) ? $m->get_error_message() : 'no manifest' );
	check( preg_match( Backup::ID_PATTERN, $m['id'] ) === 1 );
	check_same( 'manual', $m['trigger'] );
	check_same( 1215, $m['rows'], 'rows of wp_options and wp_posts plus the blocks table' );
	check( true === Backup::verify( $m ) );
	$dir = Backup::dir();
	check( 0 === strpos( basename( $dir ), 'zbst-backups-' ) && strlen( basename( $dir ) ) === strlen( 'zbst-backups-' ) + 16 );
	foreach ( array( '.htaccess', 'index.php', 'web.config' ) as $guard ) {
		check( file_exists( $dir . '/' . $guard ), "missing {$guard}" );
	}
	check( false !== strpos( file_get_contents( $dir . '/.htaccess' ), 'Require all denied' ) );
	$sql = gzdecode( file_get_contents( Backup::path( $m ) ) );
	check( 0 === strpos( $sql, Backup::HEADER ) );
	check( false === strpos( $sql, 'wp_zbst_events' ), 'the attack log is left out by default' );
	foreach ( explode( "\n", trim( $sql ) ) as $line ) {
		check( '' === $line || 0 === strpos( $line, '--' ) || ';' === substr( $line, -1 ), 'every statement is one line' );
	}
	check_same( 1, count( Backup::all() ) );
	check_same( $m['id'], get_option( 'zbst_last_backup' )['id'] );
}

function test_restore_round_trip_is_exact() {
	zbst_seed_site();
	$before = zbst_snapshot();
	$m      = Backup::create( 'manual' );
	zbst_vandalize();
	$result = Backup::restore( $m['id'] );
	check( is_array( $result ), is_wp_error( $result ) ? $result->get_error_message() : '' );
	check( $result['statements'] > 4 );
	check_same( $before, zbst_snapshot(), 'restored data matches byte for byte' );
	$tricky = zbst_tricky_values();
	global $wpdb;
	check_same( $tricky[2], $wpdb->get_var( 'SELECT post_content FROM wp_posts WHERE post_parent = 2' ) );
	check_same( $tricky[4], $wpdb->get_var( 'SELECT post_content FROM wp_posts WHERE post_parent = 4' ) );

	// A safety backup of the vandalised state was taken first.
	$safety = Backup::get( $result['safety'] );
	check( $safety && 'pre-restore' === $safety['trigger'] );
	check_same( 1, count( Log::query( array( 'type' => 'restore' ), 10, 0 ) ) );
	check( false !== strpos( end( WP_Stub::$mail )['subject'], 'Database restored' ) );
}

function test_failed_restore_rolls_back_automatically() {
	zbst_seed_site();
	$good = Backup::create( 'manual' );
	global $wpdb;
	$wpdb->query( "UPDATE wp_options SET option_value = 'Current name' WHERE option_name = 'blogname'" );
	$current = zbst_snapshot();

	// A backup that is valid on disk but fails half way: the first table restores, then a statement errors.
	$sql = gzdecode( file_get_contents( Backup::path( $good ) ) );
	$sql = str_replace( "\n-- table: wp_posts\n", "\n-- table: wp_posts\nINSERT INTO `no_such_table` (`a`) VALUES ('1');\n", $sql );
	$bad = Backup::create( 'manual' );
	file_put_contents( Backup::path( $bad ), gzencode( $sql ) );
	$manifest           = Backup::get( $bad['id'] );
	$manifest['sha256'] = hash_file( 'sha256', Backup::path( $bad ) );
	file_put_contents( Backup::dir() . '/' . $bad['id'] . '.json', json_encode( $manifest ) );

	$GLOBALS['zbst_expect_db_error'] = true;
	$result                          = Backup::restore( $bad['id'] );
	unset( $GLOBALS['zbst_expect_db_error'] );
	check( is_wp_error( $result ) );
	check( false !== strpos( $result->get_error_message(), 'rolled back automatically' ), $result->get_error_message() );
	check_same( $current, zbst_snapshot(), 'the database is exactly as it was before the restore' );
	check( false !== strpos( end( WP_Stub::$mail )['subject'], 'restore failed' ) );
}

function test_tampered_or_truncated_backups_are_refused() {
	zbst_seed_site();
	$m    = Backup::create( 'manual' );
	$path = Backup::path( $m );
	file_put_contents( $path, gzencode( Backup::HEADER . "\nDROP TABLE wp_options;\n" . Backup::END . "\n" ) );
	$r = Backup::restore( $m['id'] );
	check( is_wp_error( $r ) && 'zbst_checksum' === $r->get_error_code() );
	global $wpdb;
	check( null !== $wpdb->get_var( "SELECT COUNT(*) FROM wp_options" ), 'nothing ran' );

	$m2 = Backup::create( 'manual' );
	$sql = gzdecode( file_get_contents( Backup::path( $m2 ) ) );
	file_put_contents( Backup::path( $m2 ), gzencode( substr( $sql, 0, (int) ( strlen( $sql ) / 2 ) ) ) );
	$manifest           = Backup::get( $m2['id'] );
	$manifest['sha256'] = hash_file( 'sha256', Backup::path( $m2 ) );
	file_put_contents( Backup::dir() . '/' . $m2['id'] . '.json', json_encode( $manifest ) );
	$r = Backup::restore( $m2['id'] );
	check( is_wp_error( $r ) && 'zbst_incomplete' === $r->get_error_code() );

	check( is_wp_error( Backup::restore( '../../etc/passwd' ) ) );
	check( false === Backup::delete( '../x' ) );
}

function test_pruning_keeps_the_newest_and_the_one_being_restored() {
	update_option( Settings::OPTION, array_merge( Settings::all(), array( 'backup_keep' => 2 ) ) );
	Settings::flush();
	zbst_seed_site();
	$first = Backup::create( 'manual' );
	sleep( 1 );
	Backup::create( 'manual' );
	check_same( 2, count( Backup::all() ) );
	// Restoring the oldest of a full set: the safety backup must not prune it away mid-restore.
	sleep( 1 );
	$r = Backup::restore( $first['id'] );
	check( is_array( $r ), is_wp_error( $r ) ? $r->get_error_message() : '' );
	sleep( 1 );
	Backup::create( 'manual' );
	check_same( 2, count( Backup::all() ) );
}

function test_backup_lock_prevents_overlap() {
	zbst_seed_site();
	set_transient( 'zbst_backup_lock', 1, 60 );
	$r = Backup::create( 'manual' );
	check( is_wp_error( $r ) && 'zbst_busy' === $r->get_error_code() );
}

function test_backup_before_updates_runs_once() {
	zbst_seed_site();
	check_same( 'passthrough', Backup::before_update( 'passthrough' ) );
	Backup::before_update( true );
	$all = Backup::all();
	check_same( 1, count( $all ) );
	check_same( 'pre-update', $all[0]['trigger'] );
}

function test_import_checks_the_file() {
	zbst_seed_site();
	$tmp = tempnam( sys_get_temp_dir(), 'zbst' );
	file_put_contents( $tmp, gzencode( "<?php echo 'hi';\n" ) );
	check( is_wp_error( Backup::import( $tmp ) ) );
	file_put_contents( $tmp, 'not gzip at all' );
	check( is_wp_error( Backup::import( $tmp ) ) );
	file_put_contents( $tmp, gzencode( Backup::HEADER . "\n-- format: 1\n-- site: https://other.example\n-- created: x\n-- prefix: other_\n" . Backup::END . "\n" ) );
	$r = Backup::import( $tmp );
	check( is_wp_error( $r ) && 'zbst_prefix' === $r->get_error_code() );

	$m = Backup::create( 'manual' );
	copy( Backup::path( $m ), $tmp );
	$imported = Backup::import( $tmp );
	check( is_array( $imported ) && 'uploaded' === $imported['trigger'] );
	check_same( 'https://example.com', $imported['site'] );
	zbst_vandalize();
	check( is_array( Backup::restore( $imported['id'] ) ) );
	check_same( 'Toko Budi', $GLOBALS['wpdb']->get_var( "SELECT option_value FROM wp_options WHERE option_name = 'blogname'" ) );
	unlink( $tmp );
}

function test_backup_list_survives_a_restore() {
	zbst_seed_site();
	$key = basename( Backup::dir() );
	$m   = Backup::create( 'manual' );
	check( is_array( Backup::restore( $m['id'] ) ) );
	check_same( $key, basename( Backup::dir() ) );
	check_same( 2, count( Backup::all() ), 'the backup and its safety backup' );
}

<?php
/**
 * Database backups: create, verify, restore (with automatic rollback), list, prune.
 *
 * A backup is a gzip-compressed SQL file with one statement per line, plus a JSON manifest that
 * records its SHA-256 checksum. Text that is not plain printable ASCII is written as a hex
 * literal (X'..'), which keeps every statement on one line and restores the exact bytes whatever
 * the connection character set.
 *
 * @package ZenZeiTenBastion
 */

namespace ZenZeiTenBastion;

defined( 'ABSPATH' ) || exit;

/**
 * Backup files and the operations on them.
 */
final class Backup {

	const FORMAT     = 1;
	const HEADER     = '-- ZenZeiTen Bastion database backup';
	const END        = '-- end of backup';
	const BATCH      = 262144;
	const ROWS       = 500;
	const ID_PATTERN = '/^db-\d{8}-\d{6}-[a-z0-9]{8}$/';

	/**
	 * Folder that holds the backups, created and protected on first use.
	 *
	 * @return string|\WP_Error
	 */
	public static function dir() {
		$key = get_option( 'zbst_backup_key' );
		if ( ! is_string( $key ) || ! preg_match( '/^[a-z0-9]{16}$/', $key ) ) {
			$key = strtolower( wp_generate_password( 16, false, false ) );
			update_option( 'zbst_backup_key', $key, false );
		}
		$uploads = wp_upload_dir( null, false );
		$dir     = rtrim( (string) apply_filters( 'zbst_backup_dir', trailingslashit( $uploads['basedir'] ) . 'zbst-backups-' . $key ), '/\\' );
		if ( ! is_dir( $dir ) && ! wp_mkdir_p( $dir ) ) {
			return new \WP_Error( 'zbst_backup_dir', __( 'Could not create the backup folder. Check that the uploads folder is writable.', 'zenzeiten-bastion' ) );
		}
		// The folder name is random, and these files keep web servers that read them from listing
		// or serving it. Nginx ignores them, so the random name is what protects it there.
		$guards = array(
			'.htaccess'  => "# Backups are private.\n<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n",
			'index.php'  => "<?php\n// Silence is golden.\n",
			'web.config' => "<?xml version=\"1.0\"?>\n<configuration><system.webServer><authorization><deny users=\"*\" /></authorization></system.webServer></configuration>\n",
		);
		foreach ( $guards as $name => $content ) {
			if ( ! file_exists( $dir . '/' . $name ) ) {
				file_put_contents( $dir . '/' . $name, $content ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- local file in our own folder.
			}
		}
		return $dir;
	}

	/**
	 * Tables to back up: every table with the site's prefix, minus the security log when the
	 * settings exclude it.
	 *
	 * @return string[]
	 */
	public static function tables() {
		global $wpdb;
		$prefix = isset( $wpdb->base_prefix ) ? $wpdb->base_prefix : $wpdb->prefix;
		$tables = $wpdb->get_col( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $prefix ) . '%' ) );
		if ( Settings::get( 'backup_exclude_logs' ) ) {
			$tables = array_diff( $tables, array( Log::table() ) );
		}
		sort( $tables );
		return array_values( (array) apply_filters( 'zbst_backup_tables', $tables ) );
	}

	/**
	 * Create a backup.
	 *
	 * @param string $trigger scheduled, manual, pre-update, pre-restore, cli or uploaded.
	 * @param string $protect ID of a backup that pruning must keep (the one about to be restored).
	 * @return array|\WP_Error Manifest.
	 */
	public static function create( $trigger = 'manual', $protect = '' ) {
		global $wpdb;
		if ( get_transient( 'zbst_backup_lock' ) ) {
			return new \WP_Error( 'zbst_busy', __( 'Another backup or restore is running. Try again in a few minutes.', 'zenzeiten-bastion' ) );
		}
		$dir = self::dir();
		if ( is_wp_error( $dir ) ) {
			return $dir;
		}
		set_transient( 'zbst_backup_lock', 1, 15 * MINUTE_IN_SECONDS );
		self::long_running();

		$id   = 'db-' . gmdate( 'Ymd-His' ) . '-' . strtolower( wp_generate_password( 8, false, false ) );
		$file = $dir . '/' . $id . '.sql.gz';
		$gz   = gzopen( $file, 'wb6' );
		if ( ! $gz ) {
			delete_transient( 'zbst_backup_lock' );
			return new \WP_Error( 'zbst_write', __( 'Could not write the backup file.', 'zenzeiten-bastion' ) );
		}

		$tables = self::tables();
		$rows   = 0;
		try {
			gzwrite( $gz, self::HEADER . "\n-- format: " . self::FORMAT . "\n-- site: " . home_url() . "\n-- created: " . gmdate( 'c' ) . "\n-- prefix: " . $wpdb->prefix . "\n" );
			foreach ( $tables as $table ) {
				$rows += self::dump_table( $gz, $table );
			}
			gzwrite( $gz, self::END . "\n" );
		} catch ( \Throwable $e ) {
			gzclose( $gz );
			wp_delete_file( $file );
			delete_transient( 'zbst_backup_lock' );
			Log::add( self::event( __( 'Backup failed', 'zenzeiten-bastion' ) . ': ' . $e->getMessage(), Log::SEVERITY_HIGH ) );
			Alerts::send_now( __( 'Database backup failed', 'zenzeiten-bastion' ), $e->getMessage() );
			return new \WP_Error( 'zbst_backup_failed', $e->getMessage() );
		}
		gzclose( $gz );

		$manifest = array(
			'id'        => $id,
			'file'      => $id . '.sql.gz',
			'created'   => time(),
			'trigger'   => sanitize_key( $trigger ),
			'tables'    => count( $tables ),
			'rows'      => $rows,
			'size'      => (int) filesize( $file ),
			'sha256'    => hash_file( 'sha256', $file ),
			'site'      => home_url(),
			'prefix'    => $wpdb->prefix,
			'wp'        => isset( $GLOBALS['wp_version'] ) ? (string) $GLOBALS['wp_version'] : '',
			'plugin'    => ZBST_VERSION,
		);
		file_put_contents( $dir . '/' . $id . '.json', wp_json_encode( $manifest ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- local file in our own folder.
		delete_transient( 'zbst_backup_lock' );

		/* translators: 1: number of tables, 2: number of rows, 3: what started the backup */
		Log::add( self::event( sprintf( __( 'Backup created: %1$d tables, %2$d rows (%3$s)', 'zenzeiten-bastion' ), $manifest['tables'], $rows, $manifest['trigger'] ), Log::SEVERITY_LOW ) );
		update_option( 'zbst_last_backup', array( 'time' => time(), 'id' => $id, 'ok' => 1 ), false );
		self::prune( $protect );
		return $manifest;
	}

	/**
	 * Write one table's structure and rows.
	 *
	 * @param resource $gz    Output.
	 * @param string   $table Table.
	 * @return int Rows written.
	 * @throws \RuntimeException When the table cannot be read.
	 */
	private static function dump_table( $gz, $table ) {
		global $wpdb;
		$name   = self::quote_name( $table );
		$create = $wpdb->get_row( 'SHOW CREATE TABLE ' . $name, ARRAY_N ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- quoted identifier.
		if ( ! $create || empty( $create[1] ) ) {
			/* translators: %s: table name */
			throw new \RuntimeException( sprintf( __( 'Could not read the structure of table %s.', 'zenzeiten-bastion' ), $table ) );
		}
		gzwrite( $gz, "\n-- table: {$table}\nDROP TABLE IF EXISTS {$name};\n" . preg_replace( '/\s*[\r\n]+\s*/', ' ', trim( $create[1] ) ) . ";\n" );

		$total  = 0;
		$offset = 0;
		do {
			$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$name} LIMIT %d OFFSET %d", self::ROWS, $offset ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- quoted identifier.
			if ( '' !== (string) $wpdb->last_error ) {
				throw new \RuntimeException( $table . ': ' . $wpdb->last_error );
			}
			$batch = '';
			$head  = '';
			foreach ( $rows as $row ) {
				if ( '' === $head ) {
					$head = 'INSERT INTO ' . $name . ' (' . implode( ', ', array_map( array( __CLASS__, 'quote_name' ), array_keys( $row ) ) ) . ') VALUES ';
				}
				$values = '(' . implode( ', ', array_map( array( __CLASS__, 'literal' ), array_values( $row ) ) ) . ')';
				if ( '' !== $batch && strlen( $batch ) + strlen( $values ) > self::BATCH ) {
					gzwrite( $gz, $head . $batch . ";\n" );
					$batch = '';
				}
				$batch .= ( '' === $batch ? '' : ', ' ) . $values;
			}
			if ( '' !== $batch ) {
				gzwrite( $gz, $head . $batch . ";\n" );
			}
			$count   = count( $rows );
			$total  += $count;
			$offset += self::ROWS;
		} while ( self::ROWS === $count );
		return $total;
	}

	/**
	 * Quote a table or column name.
	 *
	 * @param string $name Name.
	 * @return string
	 */
	public static function quote_name( $name ) {
		return '`' . str_replace( '`', '``', (string) $name ) . '`';
	}

	/**
	 * SQL literal for a value that MySQL and SQLite read back byte for byte.
	 *
	 * @param mixed $value Value.
	 * @return string
	 */
	public static function literal( $value ) {
		if ( null === $value ) {
			return 'NULL';
		}
		$value = (string) $value;
		if ( '' === $value ) {
			return "''";
		}
		if ( preg_match( '/^[\x20-\x7E]*$/', $value ) && false === strpos( $value, '\\' ) ) {
			return "'" . str_replace( "'", "''", $value ) . "'";
		}
		return "X'" . bin2hex( $value ) . "'";
	}

	/**
	 * All backups, newest first.
	 *
	 * @return array Manifests.
	 */
	public static function all() {
		$dir = self::dir();
		if ( is_wp_error( $dir ) ) {
			return array();
		}
		$out = array();
		foreach ( (array) glob( $dir . '/db-*.json' ) as $path ) {
			$manifest = json_decode( (string) file_get_contents( $path ), true ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local file.
			if ( is_array( $manifest ) && isset( $manifest['id'] ) && preg_match( self::ID_PATTERN, (string) $manifest['id'] ) && file_exists( $dir . '/' . $manifest['id'] . '.sql.gz' ) ) {
				$out[] = $manifest;
			}
		}
		usort(
			$out,
			function ( $a, $b ) {
				return strcmp( $b['id'], $a['id'] );
			}
		);
		return $out;
	}

	/**
	 * One backup's manifest.
	 *
	 * @param string $id Backup ID.
	 * @return array|null
	 */
	public static function get( $id ) {
		if ( ! preg_match( self::ID_PATTERN, (string) $id ) ) {
			return null;
		}
		foreach ( self::all() as $manifest ) {
			if ( $manifest['id'] === $id ) {
				return $manifest;
			}
		}
		return null;
	}

	/**
	 * Path of a backup's SQL file.
	 *
	 * @param array $manifest Manifest.
	 * @return string
	 */
	public static function path( array $manifest ) {
		$dir = self::dir();
		return is_wp_error( $dir ) ? '' : $dir . '/' . $manifest['id'] . '.sql.gz';
	}

	/**
	 * Check a backup is whole and unchanged: checksum, header and end marker.
	 *
	 * @param array $manifest Manifest.
	 * @return true|\WP_Error
	 */
	public static function verify( array $manifest ) {
		$path = self::path( $manifest );
		if ( '' === $path || ! is_readable( $path ) ) {
			return new \WP_Error( 'zbst_missing', __( 'The backup file is missing.', 'zenzeiten-bastion' ) );
		}
		if ( ! hash_equals( (string) $manifest['sha256'], (string) hash_file( 'sha256', $path ) ) ) {
			return new \WP_Error( 'zbst_checksum', __( 'The backup file does not match its checksum. It may be damaged or altered.', 'zenzeiten-bastion' ) );
		}
		$gz    = gzopen( $path, 'rb' );
		$first = $gz ? rtrim( (string) gzgets( $gz, 1 << 26 ), "\n" ) : '';
		$last  = '';
		while ( $gz && ! gzeof( $gz ) ) {
			$line = gzgets( $gz, 1 << 26 );
			if ( false === $line ) {
				break;
			}
			if ( '' !== trim( $line ) ) {
				$last = rtrim( $line, "\n" );
			}
		}
		if ( $gz ) {
			gzclose( $gz );
		}
		if ( self::HEADER !== $first || self::END !== $last ) {
			return new \WP_Error( 'zbst_incomplete', __( 'The backup file is incomplete.', 'zenzeiten-bastion' ) );
		}
		return true;
	}

	/**
	 * Restore a backup. A safety backup of the current database is made first; if any statement
	 * fails, the safety backup is restored automatically so the site is never left half-restored.
	 *
	 * @param string $id       Backup ID.
	 * @param bool   $rollback Whether to make and use a safety backup (false only for the rollback itself).
	 * @return array|\WP_Error Keys: statements, safety (ID of the safety backup).
	 */
	public static function restore( $id, $rollback = true ) {
		$manifest = self::get( $id );
		if ( ! $manifest ) {
			return new \WP_Error( 'zbst_unknown', __( 'That backup does not exist.', 'zenzeiten-bastion' ) );
		}
		$valid = self::verify( $manifest );
		if ( is_wp_error( $valid ) ) {
			return $valid;
		}
		self::long_running();

		$safety = null;
		if ( $rollback ) {
			$safety = self::create( 'pre-restore', $id );
			if ( is_wp_error( $safety ) ) {
				/* translators: %s: error message */
				return new \WP_Error( 'zbst_safety', sprintf( __( 'Restore cancelled: the safety backup of the current database failed (%s).', 'zenzeiten-bastion' ), $safety->get_error_message() ) );
			}
		}

		// The backup folder's name is kept in an option, which the restore overwrites.
		$key = get_option( 'zbst_backup_key' );
		set_transient( 'zbst_backup_lock', 1, 30 * MINUTE_IN_SECONDS );
		$result = self::run_file( self::path( $manifest ) );
		update_option( 'zbst_backup_key', $key, false );
		delete_transient( 'zbst_backup_lock' );

		if ( is_wp_error( $result ) ) {
			if ( $safety ) {
				$back = self::restore( $safety['id'], false );
				$note = is_wp_error( $back )
					/* translators: %s: error message */
					? sprintf( __( 'Automatic rollback also failed: %s. Restore the safety backup by hand.', 'zenzeiten-bastion' ), $back->get_error_message() )
					: __( 'The database was rolled back automatically to how it was before the restore.', 'zenzeiten-bastion' );
				self::after_restore();
				Log::add( self::event( __( 'Restore failed', 'zenzeiten-bastion' ) . ': ' . $result->get_error_message() . ' ' . $note, Log::SEVERITY_HIGH, 'restore' ) );
				Alerts::send_now( __( 'Database restore failed', 'zenzeiten-bastion' ), $result->get_error_message() . "\n\n" . $note );
				return new \WP_Error( 'zbst_restore_failed', $result->get_error_message() . ' ' . $note );
			}
			return $result;
		}

		self::after_restore();
		if ( $rollback ) {
			/* translators: 1: backup ID, 2: safety backup ID */
			Log::add( self::event( sprintf( __( 'Database restored from %1$s (safety backup %2$s)', 'zenzeiten-bastion' ), $id, $safety['id'] ), Log::SEVERITY_MEDIUM, 'restore' ) );
			/* translators: 1: backup ID, 2: safety backup ID */
			Alerts::send_now( __( 'Database restored', 'zenzeiten-bastion' ), sprintf( __( 'The database was restored from backup %1$s. The database as it was just before is saved as backup %2$s.', 'zenzeiten-bastion' ), $id, $safety['id'] ) );
		}
		return array(
			'statements' => $result,
			'safety'     => $safety ? $safety['id'] : '',
		);
	}

	/**
	 * Run every statement in a backup file.
	 *
	 * @param string $path File.
	 * @return int|\WP_Error Statements run.
	 */
	private static function run_file( $path ) {
		global $wpdb;
		$gz = gzopen( $path, 'rb' );
		if ( ! $gz ) {
			return new \WP_Error( 'zbst_read', __( 'Could not open the backup file.', 'zenzeiten-bastion' ) );
		}
		$count    = 0;
		$suppress = $wpdb->suppress_errors( true );
		while ( ! gzeof( $gz ) ) {
			$line = gzgets( $gz, 1 << 26 );
			if ( false === $line ) {
				break;
			}
			$line = rtrim( $line, "\r\n" );
			if ( '' === $line || 0 === strpos( $line, '--' ) ) {
				continue;
			}
			$wpdb->last_error = '';
			$ok               = $wpdb->query( rtrim( $line, ';' ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- statements from a verified backup.
			if ( false === $ok || '' !== (string) $wpdb->last_error ) {
				$error = '' !== (string) $wpdb->last_error ? $wpdb->last_error : __( 'unknown database error', 'zenzeiten-bastion' );
				gzclose( $gz );
				$wpdb->suppress_errors( $suppress );
				/* translators: 1: statement number, 2: database error */
				return new \WP_Error( 'zbst_statement', sprintf( __( 'Statement %1$d failed: %2$s', 'zenzeiten-bastion' ), $count + 1, Request::clip( $error, 300 ) ) );
			}
			++$count;
		}
		gzclose( $gz );
		$wpdb->suppress_errors( $suppress );
		return $count;
	}

	/**
	 * Clear caches that may hold values from before the restore.
	 */
	private static function after_restore() {
		wp_cache_flush();
		Settings::flush();
		Blocklist::reset();
		Blocklist::rebuild_index();
		// The restored options may name another schema version; make sure our tables exist.
		Installer::install();
	}

	/**
	 * Add an uploaded backup file (made by this plugin, on this or another site).
	 *
	 * @param string $tmp Uploaded file path.
	 * @return array|\WP_Error Manifest.
	 */
	public static function import( $tmp ) {
		global $wpdb;
		$gz   = @gzopen( $tmp, 'rb' ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- an unreadable upload is reported below.
		$head = array();
		for ( $i = 0; $gz && $i < 6; $i++ ) {
			$head[] = rtrim( (string) gzgets( $gz, 4096 ), "\n" );
		}
		if ( $gz ) {
			gzclose( $gz );
		}
		if ( ! $head || self::HEADER !== $head[0] ) {
			return new \WP_Error( 'zbst_not_backup', __( 'That file is not a backup made by ZenZeiTen Bastion.', 'zenzeiten-bastion' ) );
		}
		$meta = array();
		foreach ( $head as $line ) {
			if ( preg_match( '/^-- (site|prefix): (.*)$/', $line, $m ) ) {
				$meta[ $m[1] ] = $m[2];
			}
		}
		if ( isset( $meta['prefix'] ) && $meta['prefix'] !== $wpdb->prefix ) {
			/* translators: 1: table prefix in the backup, 2: this site's table prefix */
			return new \WP_Error( 'zbst_prefix', sprintf( __( 'That backup uses the table prefix %1$s, but this site uses %2$s, so restoring it would not change this site.', 'zenzeiten-bastion' ), $meta['prefix'], $wpdb->prefix ) );
		}
		$dir = self::dir();
		if ( is_wp_error( $dir ) ) {
			return $dir;
		}
		$id = 'db-' . gmdate( 'Ymd-His' ) . '-' . strtolower( wp_generate_password( 8, false, false ) );
		if ( ! copy( $tmp, $dir . '/' . $id . '.sql.gz' ) ) {
			return new \WP_Error( 'zbst_write', __( 'Could not write the backup file.', 'zenzeiten-bastion' ) );
		}
		$path     = $dir . '/' . $id . '.sql.gz';
		$manifest = array(
			'id'      => $id,
			'file'    => $id . '.sql.gz',
			'created' => time(),
			'trigger' => 'uploaded',
			'tables'  => 0,
			'rows'    => 0,
			'size'    => (int) filesize( $path ),
			'sha256'  => hash_file( 'sha256', $path ),
			'site'    => isset( $meta['site'] ) ? esc_url_raw( $meta['site'] ) : '',
			'prefix'  => isset( $meta['prefix'] ) ? $meta['prefix'] : '',
			'wp'      => '',
			'plugin'  => ZBST_VERSION,
		);
		file_put_contents( $dir . '/' . $id . '.json', wp_json_encode( $manifest ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- local file in our own folder.
		$valid = self::verify( $manifest );
		if ( is_wp_error( $valid ) ) {
			self::delete( $id );
			return $valid;
		}
		return $manifest;
	}

	/**
	 * Delete a backup.
	 *
	 * @param string $id Backup ID.
	 * @return bool
	 */
	public static function delete( $id ) {
		$dir = self::dir();
		if ( is_wp_error( $dir ) || ! preg_match( self::ID_PATTERN, (string) $id ) ) {
			return false;
		}
		foreach ( array( '.sql.gz', '.json' ) as $ext ) {
			if ( file_exists( $dir . '/' . $id . $ext ) ) {
				wp_delete_file( $dir . '/' . $id . $ext );
			}
		}
		return true;
	}

	/**
	 * Keep the newest backups and delete the rest.
	 *
	 * @param string $protect ID of a backup to keep regardless.
	 */
	public static function prune( $protect = '' ) {
		$keep = (int) Settings::get( 'backup_keep' );
		foreach ( array_slice( self::all(), max( 1, $keep ) ) as $manifest ) {
			if ( $manifest['id'] !== $protect ) {
				self::delete( $manifest['id'] );
			}
		}
	}

	/**
	 * Before WordPress installs an update, take a backup (at most one every 30 minutes, so a bulk
	 * update makes one).
	 *
	 * @param mixed $response Upgrader response, passed through.
	 * @return mixed
	 */
	public static function before_update( $response ) {
		if ( Settings::get( 'backup_before_updates' ) && ! get_transient( 'zbst_preupdate' ) ) {
			set_transient( 'zbst_preupdate', 1, 30 * MINUTE_IN_SECONDS );
			self::create( 'pre-update' );
		}
		return $response;
	}

	/**
	 * Room to finish on large databases.
	 */
	private static function long_running() {
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 0 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- may be disabled by the host.
		}
		ignore_user_abort( true );
	}

	/**
	 * A backup or restore log event.
	 *
	 * @param string $details  Text.
	 * @param int    $severity Severity.
	 * @param string $type     Event type.
	 * @return array
	 */
	private static function event( $details, $severity, $type = 'backup' ) {
		return array(
			'type'     => $type,
			'severity' => $severity,
			'score'    => 0,
			'ip'       => '',
			'method'   => '',
			'uri'      => '',
			'details'  => $details,
		);
	}
}

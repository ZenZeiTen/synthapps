<?php
/**
 * Test bootstrap: a small stand-in for WordPress and a $wpdb that runs on SQLite.
 *
 * The plugin's queries are written to run on MySQL and SQLite alike, so the real classes run here
 * unchanged. Only WordPress core functions are stubbed. The CI workflow additionally runs the
 * plugin inside real WordPress with MySQL.
 *
 * @package ZenZeiTenBastion
 */

// phpcs:disable

error_reporting( E_ALL );
// Errors the plugin records with error_log() would otherwise clutter the test output.
ini_set( 'error_log', '/dev/null' );
set_error_handler(
	function ( $severity, $message, $file, $line ) {
		throw new ErrorException( $message, 0, $severity, $file, $line );
	}
);

define( 'ABSPATH', __DIR__ . '/wp/' );
define( 'MINUTE_IN_SECONDS', 60 );
define( 'HOUR_IN_SECONDS', 3600 );
define( 'DAY_IN_SECONDS', 86400 );
define( 'OBJECT', 'OBJECT' );
define( 'ARRAY_A', 'ARRAY_A' );
define( 'ARRAY_N', 'ARRAY_N' );

// -------------------------------------------------------------------------------------------------
// Test state.
// -------------------------------------------------------------------------------------------------

final class WP_Stub {
	public static $options    = array();
	public static $transients = array();
	public static $filters    = array();
	public static $mail       = array();
	public static $cron       = array();
	public static $users      = array();
	public static $user       = null;
	public static $home       = 'https://example.com';
	public static $uploads    = '';
	public static $is_404     = false;
	/** True while simulating code that runs before after_setup_theme, when translating is an error. */
	public static $early      = false;
	/** How often the plugin asked WordPress for the current user (which settles it for the request). */
	public static $current_user_lookups = 0;

	public static function reset() {
		self::$options    = array();
		self::$transients = array();
		self::$filters    = array();
		self::$mail       = array();
		self::$cron       = array();
		self::$users      = array();
		self::$user       = null;
		self::$is_404     = false;
		self::$early      = false;
		self::$current_user_lookups = 0;
	}
}

/**
 * Thrown where WordPress would end the request, so tests can see it.
 */
final class Zbst_Stop extends Exception {
	public $status;
	public function __construct( $status, $message = '' ) {
		parent::__construct( $message );
		$this->status = $status;
	}
}

// -------------------------------------------------------------------------------------------------
// $wpdb on SQLite.
// -------------------------------------------------------------------------------------------------

final class Fake_Wpdb {
	public $prefix    = 'wp_';
	public $insert_id = 0;
	public $last_error = '';
	public $pdo;

	public function __construct( $dsn = 'sqlite::memory:' ) {
		$this->pdo = new PDO( $dsn );
		$this->pdo->setAttribute( PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION );
	}

	public function get_charset_collate() {
		return 'DEFAULT CHARSET=utf8mb4';
	}

	public function esc_like( $text ) {
		return addcslashes( $text, '_%\\' );
	}

	/**
	 * Same placeholders as wpdb::prepare(): %d, %f, %s and %% , with args inline or as one array.
	 */
	public function prepare( $query, ...$args ) {
		if ( 1 === count( $args ) && is_array( $args[0] ) ) {
			$args = $args[0];
		}
		$i   = 0;
		$out = preg_replace_callback(
			'/%%|%d|%f|%s/',
			function ( $m ) use ( &$i, $args ) {
				if ( '%%' === $m[0] ) {
					return '%';
				}
				if ( ! array_key_exists( $i, $args ) ) {
					throw new RuntimeException( 'prepare(): not enough arguments for ' . $m[0] );
				}
				$v = $args[ $i++ ];
				if ( '%d' === $m[0] ) {
					return (string) (int) $v;
				}
				if ( '%f' === $m[0] ) {
					return (string) (float) $v;
				}
				return $this->pdo->quote( (string) $v );
			},
			$query
		);
		if ( $i !== count( $args ) ) {
			throw new RuntimeException( 'prepare(): ' . count( $args ) . ' arguments for ' . $i . ' placeholders in ' . $query );
		}
		return $out;
	}

	public $suppress = false;

	/**
	 * MySQL-only statements the plugin uses, in SQLite terms.
	 */
	private function translate( $sql ) {
		if ( preg_match( "/^SHOW TABLES LIKE '((?:[^']|'')*)'$/", trim( $sql ), $m ) ) {
			return "SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'sqlite_sequence' AND name LIKE '" . $m[1] . "' ESCAPE '\\' ORDER BY name";
		}
		// SQLite stores X'..' as a BLOB; MySQL stores it as text in a text column. Rewrite hex
		// literals outside quoted strings only.
		if ( false === strpos( $sql, "X'" ) ) {
			return $sql;
		}
		$out = '';
		$len = strlen( $sql );
		for ( $i = 0; $i < $len; $i++ ) {
			$c = $sql[ $i ];
			if ( "'" === $c ) {
				$end = $i + 1;
				while ( $end < $len ) {
					if ( "'" === $sql[ $end ] ) {
						if ( $end + 1 < $len && "'" === $sql[ $end + 1 ] ) {
							$end += 2;
							continue;
						}
						break;
					}
					++$end;
				}
				$out .= substr( $sql, $i, $end - $i + 1 );
				$i    = $end;
				continue;
			}
			if ( 'X' === $c && $i + 1 < $len && "'" === $sql[ $i + 1 ] && preg_match( "/\\GX'([0-9a-f]*)'/", $sql, $m, 0, $i ) ) {
				$out .= "CAST(X'" . $m[1] . "' AS TEXT)";
				$i   += strlen( $m[0] ) - 1;
				continue;
			}
			$out .= $c;
		}
		return $out;
	}

	private function run( $sql ) {
		$this->last_error = '';
		return $this->pdo->query( $this->translate( $sql ) );
	}

	public function suppress_errors( $suppress = true ) {
		$old            = $this->suppress;
		$this->suppress = (bool) $suppress;
		return $old;
	}

	/**
	 * Like wpdb::query(): returns false and sets last_error on a database error.
	 */
	public function query( $sql ) {
		try {
			$st = $this->run( $sql );
		} catch ( PDOException $e ) {
			$this->last_error = $e->getMessage();
			if ( ! $this->suppress && empty( $GLOBALS['zbst_expect_db_error'] ) ) {
				throw $e;
			}
			return false;
		}
		return $st->rowCount();
	}

	public function get_results( $sql, $output = OBJECT ) {
		$st = $this->run( $sql );
		return $st->fetchAll( ARRAY_A === $output ? PDO::FETCH_ASSOC : PDO::FETCH_OBJ );
	}

	public function get_row( $sql, $output = OBJECT ) {
		if ( preg_match( '/^SHOW CREATE TABLE `((?:[^`]|``)+)`$/', trim( $sql ), $m ) ) {
			$name = str_replace( '``', '`', $m[1] );
			$st   = $this->pdo->prepare( "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name = ?" );
			$st->execute( array( $name ) );
			$row = $st->fetch( PDO::FETCH_NUM );
			return false === $row ? null : $row;
		}
		$st  = $this->run( $sql );
		$row = $st->fetch( ARRAY_A === $output ? PDO::FETCH_ASSOC : ( ARRAY_N === $output ? PDO::FETCH_NUM : PDO::FETCH_OBJ ) );
		return false === $row ? null : $row;
	}

	public function get_var( $sql ) {
		$st  = $this->run( $sql );
		$row = $st->fetch( PDO::FETCH_NUM );
		return false === $row ? null : $row[0];
	}

	public function get_col( $sql ) {
		return $this->run( $sql )->fetchAll( PDO::FETCH_COLUMN, 0 );
	}

	public function insert( $table, array $data ) {
		$this->last_error = '';
		$cols = array_keys( $data );
		$vals = array();
		foreach ( $data as $v ) {
			$vals[] = null === $v ? 'NULL' : ( is_int( $v ) ? (string) $v : $this->pdo->quote( (string) $v ) );
		}
		try {
			$this->run( "INSERT INTO {$table} (" . implode( ',', $cols ) . ') VALUES (' . implode( ',', $vals ) . ')' );
		} catch ( PDOException $e ) {
			if ( false !== strpos( $e->getMessage(), 'UNIQUE' ) ) {
				$this->last_error = $e->getMessage();
				return false;
			}
			throw $e;
		}
		$this->insert_id = (int) $this->pdo->lastInsertId();
		return 1;
	}

	public function update( $table, array $data, array $where ) {
		$set = array();
		foreach ( $data as $k => $v ) {
			$set[] = $k . ' = ' . ( null === $v ? 'NULL' : ( is_int( $v ) ? (string) $v : $this->pdo->quote( (string) $v ) ) );
		}
		$cond = array();
		foreach ( $where as $k => $v ) {
			$cond[] = $k . ' = ' . ( is_int( $v ) ? (string) $v : $this->pdo->quote( (string) $v ) );
		}
		return $this->query( "UPDATE {$table} SET " . implode( ', ', $set ) . ' WHERE ' . implode( ' AND ', $cond ) );
	}

	public function delete( $table, array $where ) {
		$cond = array();
		foreach ( $where as $k => $v ) {
			$cond[] = $k . ' = ' . ( is_int( $v ) ? (string) $v : $this->pdo->quote( (string) $v ) );
		}
		return $this->query( "DELETE FROM {$table} WHERE " . implode( ' AND ', $cond ) );
	}

	/**
	 * Turn the plugin's dbDelta() statements into SQLite DDL.
	 */
	public function create_from_dbdelta( $statements ) {
		foreach ( (array) $statements as $sql ) {
			preg_match( '/CREATE TABLE (\S+) \((.*)\)[^)]*;$/s', trim( $sql ), $m );
			$table   = $m[1];
			$columns = array();
			$indexes = array();
			foreach ( preg_split( '/,\n/', trim( $m[2] ) ) as $line ) {
				$line = trim( $line );
				if ( preg_match( '/^PRIMARY KEY/', $line ) ) {
					continue;
				}
				if ( preg_match( '/^(UNIQUE )?KEY (\w+) \(([^)]+)\)$/', $line, $k ) ) {
					$indexes[] = 'CREATE ' . ( $k[1] ? 'UNIQUE ' : '' ) . "INDEX {$table}_{$k[2]} ON {$table} ({$k[3]})";
					continue;
				}
				if ( preg_match( '/AUTO_INCREMENT/', $line ) ) {
					$columns[] = preg_replace( '/^(\w+).*$/', '$1 INTEGER PRIMARY KEY AUTOINCREMENT', $line );
					continue;
				}
				$columns[] = preg_replace( array( '/\bunsigned\b/', '/\(\d+\)/' ), '', $line );
			}
			$this->pdo->exec( "CREATE TABLE {$table} (" . implode( ', ', $columns ) . ')' );
			foreach ( $indexes as $index ) {
				$this->pdo->exec( $index );
			}
		}
	}
}

// -------------------------------------------------------------------------------------------------
// WordPress function stubs.
// -------------------------------------------------------------------------------------------------

function add_action( $hook, $cb, $priority = 10, $args = 1 ) { WP_Stub::$filters[ $hook ][] = $cb; return true; }
function add_filter( $hook, $cb, $priority = 10, $args = 1 ) { WP_Stub::$filters[ $hook ][] = $cb; return true; }
function remove_all_filters( $hook ) { unset( WP_Stub::$filters[ $hook ] ); }
function apply_filters( $hook, $value, ...$args ) {
	foreach ( WP_Stub::$filters[ $hook ] ?? array() as $cb ) {
		$value = $cb( $value, ...$args );
	}
	return $value;
}
function do_action( $hook, ...$args ) {
	foreach ( WP_Stub::$filters[ $hook ] ?? array() as $cb ) {
		$cb( ...$args );
	}
}
function add_shortcode( $tag, $cb ) {}
function shortcode_atts( $pairs, $atts, $shortcode = '' ) { return array_merge( $pairs, array_intersect_key( (array) $atts, $pairs ) ); }
function do_shortcode( $content ) { return $content; }
function register_activation_hook( $file, $cb ) {}
function register_deactivation_hook( $file, $cb ) {}
function register_rest_route( $ns, $route, $args ) { return true; }
function register_setting( ...$args ) {}
function load_plugin_textdomain( ...$args ) { return true; }
function plugin_dir_path( $file ) { return dirname( $file ) . '/'; }
function wp_doing_cron() { return false; }
function wp_doing_ajax() { return false; }

function get_option( $name, $default = false ) { return array_key_exists( $name, WP_Stub::$options ) ? WP_Stub::$options[ $name ] : $default; }
function update_option( $name, $value, $autoload = null ) { WP_Stub::$options[ $name ] = $value; return true; }
function add_option( $name, $value = '', $deprecated = '', $autoload = 'yes' ) {
	if ( array_key_exists( $name, WP_Stub::$options ) ) {
		return false;
	}
	WP_Stub::$options[ $name ] = $value;
	return true;
}
function delete_option( $name ) { unset( WP_Stub::$options[ $name ] ); return true; }
function get_transient( $name ) {
	if ( ! isset( WP_Stub::$transients[ $name ] ) ) {
		return false;
	}
	list( $value, $expires ) = WP_Stub::$transients[ $name ];
	return $expires && $expires < time() ? false : $value;
}
function set_transient( $name, $value, $ttl = 0 ) { WP_Stub::$transients[ $name ] = array( $value, $ttl ? time() + $ttl : 0 ); return true; }
function delete_transient( $name ) { unset( WP_Stub::$transients[ $name ] ); return true; }
function wp_using_ext_object_cache() { return false; }

function is_user_logged_in() { ++WP_Stub::$current_user_lookups; return null !== WP_Stub::$user; }
function get_current_user_id() { return WP_Stub::$user ? WP_Stub::$user->ID : 0; }
function wp_get_current_user() { ++WP_Stub::$current_user_lookups; return WP_Stub::$user ? WP_Stub::$user : (object) array( 'ID' => 0, 'roles' => array() ); }
function wp_roles() {
	return new class() {
		public function get_names() {
			return array( 'administrator' => 'Administrator', 'editor' => 'Editor', 'subscriber' => 'Subscriber' );
		}
	};
}
function translate_user_role( $name ) { return $name; }

function wp_unslash( $value ) { return is_array( $value ) ? array_map( 'wp_unslash', $value ) : ( is_string( $value ) ? stripslashes( $value ) : $value ); }
function sanitize_text_field( $s ) { return trim( preg_replace( '/[\r\n\t ]+/', ' ', strip_tags( (string) $s ) ) ); }
function sanitize_key( $s ) { return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $s ) ); }
function sanitize_email( $s ) { return filter_var( trim( (string) $s ), FILTER_SANITIZE_EMAIL ); }
function is_email( $s ) { return false !== filter_var( (string) $s, FILTER_VALIDATE_EMAIL ) ? $s : false; }
function absint( $n ) { return abs( (int) $n ); }
function wp_strip_all_tags( $s ) { return strip_tags( (string) $s ); }
function wp_kses_post( $s ) { return $s; }
function esc_url_raw( $url, $protocols = null ) {
	$url = trim( (string) $url );
	if ( '' === $url || ! preg_match( '#^https?://#i', $url ) || false === filter_var( $url, FILTER_VALIDATE_URL ) ) {
		return '';
	}
	return str_replace( array( ' ', '"', "'", '<', '>' ), array( '%20', '%22', '%27', '%3C', '%3E' ), $url );
}
function esc_url( $url ) { return htmlspecialchars( (string) $url, ENT_QUOTES ); }
function esc_html( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES ); }
function esc_attr( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES ); }
function esc_textarea( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES ); }
function __( $s, $d = null ) { zbst_i18n_check( $s ); return $s; }
function _e( $s, $d = null ) { zbst_i18n_check( $s ); echo $s; }
function _n( $single, $plural, $n, $d = null ) { zbst_i18n_check( $single ); return 1 === (int) $n ? $single : $plural; }
function esc_html__( $s, $d = null ) { zbst_i18n_check( $s ); return esc_html( $s ); }
function esc_attr__( $s, $d = null ) { zbst_i18n_check( $s ); return esc_attr( $s ); }
function esc_html_e( $s, $d = null ) { zbst_i18n_check( $s ); echo esc_html( $s ); }
function esc_attr_e( $s, $d = null ) { zbst_i18n_check( $s ); echo esc_attr( $s ); }
function wp_json_encode( $data, $flags = 0 ) { return json_encode( $data, $flags ); }
function wp_parse_url( $url, $component = -1 ) { return parse_url( (string) $url, $component ); }
function home_url( $path = '' ) { return WP_Stub::$home . ( '' !== $path ? '/' . ltrim( $path, '/' ) : '' ); }
function site_url( $path = '' ) { return home_url( $path ); }
function rest_url( $path = '' ) { return home_url( 'wp-json/' . ltrim( $path, '/' ) ); }
function admin_url( $path = '' ) { return home_url( 'wp-admin/' . ltrim( $path, '/' ) ); }
function add_query_arg( ...$args ) {
	if ( is_array( $args[0] ) ) {
		$params = $args[0];
		$url    = $args[1] ?? '';
	} else {
		$params = array( $args[0] => $args[1] );
		$url    = $args[2] ?? '';
	}
	return $url . ( false === strpos( $url, '?' ) ? '?' : '&' ) . http_build_query( $params );
}
function remove_query_arg( $keys, $url = '' ) { return $url; }
function wp_nonce_url( $url, $action ) { return add_query_arg( '_wpnonce', 'nonce', $url ); }
function wp_create_nonce( $action ) { return 'nonce'; }
function number_format_i18n( $n, $decimals = 0 ) { return number_format( (float) $n, $decimals ); }
function wp_timezone() { return new DateTimeZone( 'Asia/Jakarta' ); }
function wp_date( $format, $ts = null ) { return ( new DateTimeImmutable( '@' . ( $ts ?? time() ) ) )->setTimezone( wp_timezone() )->format( $format ); }
function human_time_diff( $from, $to = 0 ) { return abs( $to - $from ) . ' secs'; }
function get_bloginfo( $what = '' ) { return 'Example Site'; }
function wp_specialchars_decode( $s, $q = ENT_NOQUOTES ) { return htmlspecialchars_decode( $s, $q ); }
function wp_mail( $to, $subject, $body ) { WP_Stub::$mail[] = compact( 'to', 'subject', 'body' ); return true; }
function checked( $a, $b = true, $echo = true ) { $r = (string) $a === (string) $b ? ' checked="checked"' : ''; if ( $echo ) { echo $r; } return $r; }
function selected( $a, $b = true, $echo = true ) { $r = (string) $a === (string) $b ? ' selected="selected"' : ''; if ( $echo ) { echo $r; } return $r; }
function settings_fields( $group ) { echo '<input type="hidden" name="option_page" value="' . esc_attr( $group ) . '" />'; }
function submit_button( $text = 'Save', $type = 'primary', $name = 'submit', $wrap = true ) { echo '<button>' . esc_html( $text ) . '</button>'; }
function wp_nonce_field( $action ) { echo '<input type="hidden" name="_wpnonce" value="nonce" />'; }
function wp_die( $message = '', $title = '', $args = array() ) { throw new RuntimeException( 'wp_die: ' . $message ); }
function wp_print_inline_script_tag( $js, $attrs = array() ) { echo '<script>' . $js . '</script>'; }
function is_preview() { return false; }
function is_customize_preview() { return false; }
function is_feed() { return false; }
function is_robots() { return false; }
function is_trackback() { return false; }


function plugin_dir_url( $file ) { return 'https://example.com/wp-content/plugins/zenzeiten-bastion/'; }
function plugin_basename( $file ) { return 'zenzeiten-bastion/zenzeiten-bastion.php'; }
function is_admin() { return false; }
function wp_validate_auth_cookie( $cookie = '', $scheme = '' ) { return WP_Stub::$user ? WP_Stub::$user->ID : false; }
function user_can( $user_id, $cap ) { return WP_Stub::$user && (int) WP_Stub::$user->ID === (int) $user_id && zbst_role_can( WP_Stub::$user, $cap ); }
function zbst_role_can( $user, $cap ) {
	if ( in_array( 'administrator', $user->roles, true ) ) {
		return true;
	}
	return 'unfiltered_html' === $cap && in_array( 'editor', $user->roles, true );
}
function current_user_can( $cap ) {
	++WP_Stub::$current_user_lookups;
	if ( ! WP_Stub::$user ) {
		return false;
	}
	if ( in_array( 'administrator', WP_Stub::$user->roles, true ) ) {
		return true;
	}
	return 'unfiltered_html' === $cap && in_array( 'editor', WP_Stub::$user->roles, true );
}
function get_userdata( $id ) { return false; }
function get_users( $args = array() ) {
	$out = array();
	foreach ( WP_Stub::$users as $u ) {
		if ( empty( $args['role'] ) || in_array( $args['role'], $u->roles, true ) ) {
			$out[] = $u;
		}
	}
	return $out;
}
function wp_next_scheduled( $hook ) { return isset( WP_Stub::$cron[ $hook ] ) ? WP_Stub::$cron[ $hook ][0] : false; }
function wp_get_schedule( $hook ) { return isset( WP_Stub::$cron[ $hook ] ) ? WP_Stub::$cron[ $hook ][1] : false; }
function wp_schedule_event( $time, $recurrence, $hook ) { WP_Stub::$cron[ $hook ] = array( $time, $recurrence ); return true; }
function wp_clear_scheduled_hook( $hook ) { unset( WP_Stub::$cron[ $hook ] ); return 1; }
function nocache_headers() {}
function did_action( $hook ) { return 'after_setup_theme' === $hook ? ( WP_Stub::$early ? 0 : 1 ) : 1; }
function wp_schedule_single_event( $time, $hook ) { WP_Stub::$cron[ $hook ] = array( $time, false ); return true; }
/**
 * WordPress 6.7+ warns when a plugin translates before after_setup_theme.
 */
function zbst_i18n_check( $text ) {
	if ( WP_Stub::$early ) {
		throw new LogicException( 'Translated before after_setup_theme: ' . $text );
	}
}
function status_header( $status ) { throw new Zbst_Stop( $status ); }
function wp_safe_redirect( $url, $status = 302 ) { throw new Zbst_Stop( $status, $url ); }
function check_admin_referer( $action ) { return 1; }
function is_404() { return WP_Stub::$is_404; }
function is_wp_error( $thing ) { return $thing instanceof WP_Error; }
function trailingslashit( $s ) { return rtrim( $s, '/\\' ) . '/'; }
function wp_upload_dir( $time = null, $create = true ) { return array( 'basedir' => WP_Stub::$uploads, 'baseurl' => 'https://example.com/wp-content/uploads' ); }
function wp_mkdir_p( $dir ) { return is_dir( $dir ) || mkdir( $dir, 0777, true ); }
function wp_delete_file( $file ) { if ( file_exists( $file ) ) { unlink( $file ); } }
function wp_generate_password( $length = 12, $special = true, $extra = false ) { return substr( str_shuffle( str_repeat( 'abcdefghijklmnopqrstuvwxyz0123456789', 4 ) ), 0, $length ); }
function wp_cache_flush() { return true; }
function size_format( $bytes, $decimals = 0 ) { return number_format( $bytes / 1024, $decimals ) . ' KB'; }
function paginate_links( $args ) { return '<span class="page-numbers">' . (int) $args['current'] . '</span>'; }
function wp_localize_script( ...$args ) {}
function wp_enqueue_script( ...$args ) {}
function wp_enqueue_style( ...$args ) {}

final class WP_Error {
	private $code;
	private $message;
	public function __construct( $code = '', $message = '', $data = '' ) { $this->code = $code; $this->message = $message; }
	public function get_error_code() { return $this->code; }
	public function get_error_message() { return $this->message; }
}

final class WP_REST_Request {
	private $params;
	private $route;
	public function __construct( $params = array(), $route = '' ) { $this->params = $params; $this->route = $route; }
	public function get_param( $k ) { return isset( $this->params[ $k ] ) ? $this->params[ $k ] : null; }
	public function get_route() { return $this->route; }
}

final class WP_REST_Response {
	public $data;
	public $status;
	public $headers = array();
	public function __construct( $data = null, $status = 200 ) { $this->data = $data; $this->status = $status; }
	public function header( $k, $v ) { $this->headers[ $k ] = $v; }
	public function get_data() { return $this->data; }
	public function get_status() { return $this->status; }
}

// -------------------------------------------------------------------------------------------------
// Load the plugin.
// -------------------------------------------------------------------------------------------------

$GLOBALS['wpdb']       = new Fake_Wpdb();
$GLOBALS['wp_version'] = '6.8';
$_SERVER               = array( 'REMOTE_ADDR' => '127.0.0.1', 'REQUEST_METHOD' => 'GET', 'REQUEST_URI' => '/' );
require dirname( __DIR__ ) . '/zenzeiten-bastion/zenzeiten-bastion.php';
require dirname( __DIR__ ) . '/zenzeiten-bastion/includes/admin/class-admin.php';

use ZenZeiTenBastion\Blocklist;
use ZenZeiTenBastion\Installer;
use ZenZeiTenBastion\Request;
use ZenZeiTenBastion\Settings;

/**
 * Fresh database, options, uploads folder and request state.
 */
function zbst_test_reset( array $settings = array() ) {
	WP_Stub::reset();
	$GLOBALS['wpdb'] = new Fake_Wpdb();
	if ( WP_Stub::$uploads && is_dir( WP_Stub::$uploads ) ) {
		zbst_rmdir( WP_Stub::$uploads );
	}
	WP_Stub::$uploads = sys_get_temp_dir() . '/zbst-test-' . getmypid() . '-' . mt_rand();
	mkdir( WP_Stub::$uploads, 0777, true );
	Installer::install();
	update_option( Settings::OPTION, array_merge( Settings::defaults(), $settings ) );
	update_option( 'admin_email', 'owner@example.com' );
	Settings::flush();
	Request::reset();
	Blocklist::reset();
	Blocklist::rebuild_index();
	$_GET    = array();
	$_POST   = array();
	$_COOKIE = array();
	$_FILES  = array();
	$_SERVER = array( 'REMOTE_ADDR' => '203.0.113.10', 'REQUEST_METHOD' => 'GET', 'REQUEST_URI' => '/', 'HTTP_USER_AGENT' => 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' );
	// Guard::deny() ends the request; in tests it throws instead.
	add_action(
		'zbst_deny',
		function ( $status ) {
			throw new Zbst_Stop( $status );
		}
	);
}

function zbst_rmdir( $dir ) {
	foreach ( array_merge( glob( $dir . '/*' ), glob( $dir . '/.htaccess' ) ) as $f ) {
		is_dir( $f ) ? zbst_rmdir( $f ) : unlink( $f );
	}
	rmdir( $dir );
}

register_shutdown_function(
	function () {
		if ( WP_Stub::$uploads && is_dir( WP_Stub::$uploads ) ) {
			zbst_rmdir( WP_Stub::$uploads );
		}
	}
);

/**
 * Simulate a request from a client.
 */
function zbst_request( $ip, array $get = array(), array $server = array(), array $post = array() ) {
	$_GET    = $get;
	$_POST   = $post;
	$_SERVER = array_merge(
		array(
			'REMOTE_ADDR'     => $ip,
			'REQUEST_METHOD'  => $post ? 'POST' : 'GET',
			'REQUEST_URI'     => '/page/' . ( $get ? '?' . http_build_query( $get ) : '' ),
			'HTTP_USER_AGENT' => 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
		),
		$server
	);
	Request::reset();
}

/**
 * Run the per-request guard; returns the HTTP status it stopped with, or 0 when the request passed.
 */
function zbst_run_guard() {
	try {
		ZenZeiTenBastion\Guard::early();
	} catch ( Zbst_Stop $stop ) {
		return $stop->status;
	}
	return 0;
}

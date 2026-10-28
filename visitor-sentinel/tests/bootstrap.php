<?php
/**
 * Test bootstrap: a small stand-in for WordPress and a $wpdb that runs on SQLite.
 *
 * The plugin's queries are written to run on MySQL and SQLite alike, so the real Repository,
 * Tracker and Fraud_Service code runs here unchanged. Only WordPress core functions are stubbed.
 * The CI workflow additionally runs the plugin inside real WordPress with MySQL.
 *
 * @package VisitorSentinel
 */

// phpcs:disable

error_reporting( E_ALL );
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

// -------------------------------------------------------------------------------------------------
// Test state.
// -------------------------------------------------------------------------------------------------

final class WP_Stub {
	public static $options    = array();
	public static $transients = array();
	public static $filters    = array();
	public static $mail       = array();
	public static $user       = null;
	public static $home       = 'https://example.com';

	public static function reset() {
		self::$options    = array();
		self::$transients = array();
		self::$filters    = array();
		self::$mail       = array();
		self::$user       = null;
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

	private function run( $sql ) {
		$this->last_error = '';
		return $this->pdo->query( $sql );
	}

	public function query( $sql ) {
		$st = $this->run( $sql );
		return $st->rowCount();
	}

	public function get_results( $sql, $output = OBJECT ) {
		$st = $this->run( $sql );
		return $st->fetchAll( ARRAY_A === $output ? PDO::FETCH_ASSOC : PDO::FETCH_OBJ );
	}

	public function get_row( $sql ) {
		$st  = $this->run( $sql );
		$row = $st->fetch( PDO::FETCH_OBJ );
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
function plugin_dir_url( $file ) { return 'https://example.com/wp-content/plugins/visitor-sentinel/'; }
function plugin_basename( $file ) { return 'visitor-sentinel/visitor-sentinel.php'; }
function is_admin() { return false; }
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

function is_user_logged_in() { return null !== WP_Stub::$user; }
function get_current_user_id() { return WP_Stub::$user ? WP_Stub::$user->ID : 0; }
function wp_get_current_user() { return WP_Stub::$user ? WP_Stub::$user : (object) array( 'ID' => 0, 'roles' => array() ); }
function current_user_can( $cap ) { return WP_Stub::$user && in_array( 'administrator', WP_Stub::$user->roles, true ); }
function get_userdata( $id ) { return false; }
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
function __( $s, $d = null ) { return $s; }
function _e( $s, $d = null ) { echo $s; }
function _n( $single, $plural, $n, $d = null ) { return 1 === (int) $n ? $single : $plural; }
function esc_html__( $s, $d = null ) { return esc_html( $s ); }
function esc_attr__( $s, $d = null ) { return esc_attr( $s ); }
function esc_html_e( $s, $d = null ) { echo esc_html( $s ); }
function esc_attr_e( $s, $d = null ) { echo esc_attr( $s ); }
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
function wp_next_scheduled( $hook ) { return false; }
function wp_schedule_event( ...$args ) { return true; }
function wp_clear_scheduled_hook( $hook ) { return 0; }
function nocache_headers() {}
function wp_die( $message = '', $title = '', $args = array() ) { throw new RuntimeException( 'wp_die: ' . $message ); }
function wp_print_inline_script_tag( $js, $attrs = array() ) { echo '<script>' . $js . '</script>'; }
function is_preview() { return false; }
function is_customize_preview() { return false; }
function is_feed() { return false; }
function is_robots() { return false; }
function is_trackback() { return false; }

final class WP_REST_Request {
	private $body;
	public function __construct( $body ) { $this->body = $body; }
	public function get_body() { return $this->body; }
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

$GLOBALS['wpdb'] = new Fake_Wpdb();
$_SERVER         = array( 'REMOTE_ADDR' => '127.0.0.1', 'REQUEST_METHOD' => 'GET' );
require dirname( __DIR__ ) . '/visitor-sentinel/visitor-sentinel.php';
require dirname( __DIR__ ) . '/visitor-sentinel/includes/admin/class-admin.php';

/**
 * Fresh database, options and request state.
 */
function vsen_test_reset( array $settings = array() ) {
	WP_Stub::reset();
	$GLOBALS['wpdb'] = new Fake_Wpdb();
	VisitorSentinel\Repository::reset();
	VisitorSentinel\Settings::flush();
	VisitorSentinel\Request_Context::reset();
	$repo = VisitorSentinel\Repository::instance();
	$GLOBALS['wpdb']->create_from_dbdelta( VisitorSentinel\Installer::schema( $repo, '' ) );
	update_option( 'vsen_secret', str_repeat( 'k', 64 ) );
	update_option( VisitorSentinel\Settings::OPTION, array_merge( VisitorSentinel\Settings::defaults(), $settings ) );
	VisitorSentinel\Settings::flush();
	VisitorSentinel\Protection::rebuild_index();
}

/**
 * Simulate a request from a client and post a tracker payload to the collect endpoint.
 */
function vsen_collect( array $payload, array $server = array() ) {
	$_SERVER = array_merge(
		array(
			'REMOTE_ADDR'          => '203.0.113.10',
			'REQUEST_METHOD'       => 'POST',
			'HTTP_USER_AGENT'      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
			'HTTP_ACCEPT_LANGUAGE' => 'en-US,en;q=0.9',
		),
		$server
	);
	VisitorSentinel\Request_Context::reset();
	$response = ( new VisitorSentinel\Tracker() )->collect( new WP_REST_Request( json_encode( $payload ) ) );
	return array( $response->get_status(), $response->get_data() );
}

/**
 * Simulate a server-side page request (template_redirect) with query parameters.
 */
function vsen_visit( array $get, array $server = array() ) {
	$_GET    = $get;
	$_SERVER = array_merge(
		array(
			'REMOTE_ADDR'          => '203.0.113.10',
			'REQUEST_METHOD'       => 'GET',
			'REQUEST_URI'          => '/landing/?' . http_build_query( $get ),
			'HTTP_USER_AGENT'      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
			'HTTP_ACCEPT_LANGUAGE' => 'en-US,en;q=0.9',
		),
		$server
	);
	VisitorSentinel\Request_Context::reset();
	( new VisitorSentinel\Tracker() )->capture_landing();
	$_GET = array();
}

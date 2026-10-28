#!/usr/bin/env bash
# Build a throwaway WordPress site with SQLite for end-to-end tests, and link the plugin into it.
#
#   tests/e2e/setup-wordpress.sh <site-dir>
#
# WordPress comes from the @wp-playground/wordpress-builds npm package (WordPress 6.5 and the
# SQLite integration plugin), so no MySQL server and no access to wordpress.org are needed.
# That build leaves out some wp-admin stylesheets, so admin screens look unstyled; that does
# not affect the tests.
set -euo pipefail

SITE="${1:?usage: setup-wordpress.sh <site-dir>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PLUGIN="$(cd "$HERE/../../plugin/contextchat" && pwd)"
PKG="https://registry.npmjs.org/@wp-playground/wordpress-builds/-/wordpress-builds-0.9.19.tgz"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

rm -rf "$SITE"
mkdir -p "$SITE"
curl -fsSL "$PKG" -o "$WORK/builds.tgz"
tar xzf "$WORK/builds.tgz" -C "$WORK" package/src/wordpress/wp-6.5.zip package/src/sqlite-database-integration/sqlite-database-integration.zip
unzip -q "$WORK/package/src/wordpress/wp-6.5.zip" -d "$SITE"
unzip -q "$WORK/package/src/sqlite-database-integration/sqlite-database-integration.zip" -d "$WORK/sqlite"
mv "$WORK"/sqlite/* "$SITE/wp-content/plugins/sqlite-database-integration"

sed -e "s#{SQLITE_IMPLEMENTATION_FOLDER_PATH}#$SITE/wp-content/plugins/sqlite-database-integration#" \
    -e "s#{SQLITE_PLUGIN}#sqlite-database-integration/load.php#" \
    "$SITE/wp-content/plugins/sqlite-database-integration/db.copy" > "$SITE/wp-content/db.php"

cat > "$SITE/wp-config.php" <<'PHP'
<?php
define( 'DB_NAME', 'wordpress' );
define( 'DB_USER', '' );
define( 'DB_PASSWORD', '' );
define( 'DB_HOST', '' );
define( 'DB_CHARSET', 'utf8' );
define( 'DB_COLLATE', '' );
define( 'DB_DIR', __DIR__ . '/wp-content/database/' );
define( 'DB_FILE', '.ht.sqlite' );
foreach ( array( 'AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY', 'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT' ) as $k ) {
	define( $k, 'contextchat-e2e-' . $k );
}
$table_prefix = 'wp_';
define( 'WP_DEBUG', true );
define( 'WP_DEBUG_LOG', __DIR__ . '/wp-content/debug.log' );
define( 'WP_DEBUG_DISPLAY', false );
define( 'CONCATENATE_SCRIPTS', false );
define( 'DISABLE_WP_CRON', true );
define( 'AUTOMATIC_UPDATER_DISABLED', true );
define( 'WP_HTTP_BLOCK_EXTERNAL', true );
if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', __DIR__ . '/' );
}
require_once ABSPATH . 'wp-settings.php';
PHP

rm -f "$SITE/wp-content/database/.ht.sqlite"   # the build ships a pre-installed database
ln -s "$PLUGIN" "$SITE/wp-content/plugins/contextchat"
cp "$HERE/fake-woocommerce.php" "$SITE/wp-content/plugins/fake-woocommerce.php"
echo "WordPress ready in $SITE"

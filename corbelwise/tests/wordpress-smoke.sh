#!/usr/bin/env bash
# Smoke test on the current WordPress release with MySQL (run in CI): install the theme and the
# toolkit, create the starter pages through the real admin form, load every public page and admin
# screen, check WordPress.org update offers, and validate every pattern and template in the block
# editor.
#
# Needs php, curl, node (with `npm ci` done in corbelwise/ and Chromium for Playwright) and a MySQL server.
# Environment: DB_HOST (127.0.0.1)  DB_USER (root)  DB_PASS (root)  DB_NAME (wordpress)  WORK (./.wp-smoke)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CORBELWISE="$(cd "$HERE/.." && pwd)"
WORK="${WORK:-$CORBELWISE/.wp-smoke}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_USER="${DB_USER:-root}"
DB_PASS="${DB_PASS:-root}"
DB_NAME="${DB_NAME:-wordpress}"
PORT="${PORT:-8089}"
URL="http://127.0.0.1:$PORT"

mkdir -p "$WORK"
cd "$WORK"
[ -f wp-cli.phar ] || curl -sSLo wp-cli.phar https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar
wp() { php "$WORK/wp-cli.phar" --path="$WORK/wp" "$@"; }

rm -rf wp
wp core download --quiet
wp config create --dbname="$DB_NAME" --dbuser="$DB_USER" --dbpass="$DB_PASS" --dbhost="$DB_HOST" --skip-check \
	--extra-php <<'PHP'
define( 'WP_DEBUG', true );
define( 'WP_DEBUG_LOG', true );
define( 'WP_DEBUG_DISPLAY', false );
PHP
wp db reset --yes >/dev/null 2>&1 || wp db create
wp core install --url="$URL" --title="Smoke Studio" --admin_user=admin --admin_password=admin --admin_email=admin@example.com --skip-email
# The site is served from the WordPress folder itself, so both addresses are the bare URL. Some
# WP-CLI and WordPress combinations store a guessed site address, which WordPress then redirects to.
wp option update home "$URL" >/dev/null
wp option update siteurl "$URL" >/dev/null
wp rewrite structure '/%postname%/' --hard >/dev/null
echo "WordPress $(wp core version), PHP $(php -r 'echo PHP_VERSION;'), home $(wp option get home), siteurl $(wp option get siteurl)"

ln -s "$CORBELWISE/theme/corbelwise" wp/wp-content/themes/corbelwise
ln -s "$CORBELWISE/plugin/corbelwise-toolkit" wp/wp-content/plugins/corbelwise-toolkit
wp theme activate corbelwise
wp plugin activate corbelwise-toolkit
wp post create --post_type=post --post_status=publish --post_title='How we keep projects on time' --post_content='<!-- wp:paragraph --><p>Plans, habits and honest updates.</p><!-- /wp:paragraph -->' >/dev/null

php -S "127.0.0.1:$PORT" -t wp >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do curl -s -o /dev/null "$URL/" && break; sleep 0.2; done

fail() { echo "FAIL: $*"; [ -f wp/wp-content/debug.log ] && cat wp/wp-content/debug.log; exit 1; }
# Show what a page returned, for a failure that is not a PHP error.
show() {
	echo "--- $1: HTTP $(curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}' "$1") ---"
	head -c 2500 <<<"$2"
	echo
	echo "--- end ---"
}
# grep reads a string, not a pipe: with pipefail, `curl | grep -q` fails when grep exits early.
contains() { grep -q -- "$2" <<<"$1"; }

# A logged-in session for curl and the browser: cookies plus the matching nonces.
SESSION=$(wp eval '
	$expire  = time() + HOUR_IN_SECONDS;
	$token   = WP_Session_Tokens::get_instance( 1 )->create( $expire );
	$auth    = wp_generate_auth_cookie( 1, $expire, "auth", $token );
	$logged  = wp_generate_auth_cookie( 1, $expire, "logged_in", $token );
	$_COOKIE[ LOGGED_IN_COOKIE ] = $logged;
	wp_set_current_user( 1 );
	echo wp_json_encode( array(
		"header" => AUTH_COOKIE . "=" . $auth . "; " . LOGGED_IN_COOKIE . "=" . $logged,
		"cookies" => array( array( "name" => AUTH_COOKIE, "value" => $auth, "url" => home_url( "/" ) ), array( "name" => LOGGED_IN_COOKIE, "value" => $logged, "url" => home_url( "/" ) ) ),
		"home" => wp_create_nonce( "corbelwise_create_home" ),
	), JSON_UNESCAPED_SLASHES );')
json() { php -r 'echo json_decode( $argv[1], true )[ $argv[2] ] ?? "";' "$SESSION" "$1"; }
COOKIES=$(json header)

# The getting-started page creates the starter pages through its real form.
ADMIN=$(curl -s -b "$COOKIES" "$URL/wp-admin/themes.php?page=corbelwise")
contains "$ADMIN" 'corbelwise-admin' || fail "Appearance → Corbelwise did not render"
LOCATION=$(curl -s -o /dev/null -w '%{redirect_url}' -b "$COOKIES" -d "action=corbelwise_create_home&_wpnonce=$(json home)&set_front_page=1" "$URL/wp-admin/admin-post.php")
contains "$LOCATION" 'corbelwise-home=created' || fail "starter pages form did not complete (redirect: $LOCATION)"
[ "$(wp option get show_on_front)" = "page" ] || fail "front page not set"
for SLUG in about services pricing contact; do
	[ -n "$(wp post list --post_type=page --name="$SLUG" --field=ID)" ] || fail "starter page $SLUG missing"
done

# Public pages render with the theme's markup and the toolkit's tags, without errors.
POST_URL=$(wp post list --post_type=post --posts_per_page=1 --field=url)
for PAGE in "/" "/about/" "/services/" "/pricing/" "/contact/" "$POST_URL" "/?s=projects"; do
	TARGET="$PAGE"
	case "$PAGE" in http*) ;; *) TARGET="$URL$PAGE" ;; esac
	HTML=$(curl -s "$TARGET")
	contains "$HTML" 'data-color-scheme="auto"' || { show "$TARGET" "$HTML"; fail "$PAGE: no colour scheme attribute"; }
	contains "$HTML" 'corbelwise-header' || { show "$TARGET" "$HTML"; fail "$PAGE: theme header missing"; }
	contains "$HTML" 'application/ld+json' || [ "$PAGE" = "/?s=projects" ] || { show "$TARGET" "$HTML"; fail "$PAGE: no structured data"; }
	if contains "$HTML" 'critical error' || contains "$HTML" 'Fatal error'; then fail "$PAGE: PHP error"; fi
done
[ "$(curl -s -o /dev/null -w '%{http_code}' "$URL/no-such-page/")" = "404" ] || fail "404 page status"
HEADERS=$(curl -sI "$URL/")
contains "$HEADERS" 'X-Content-Type-Options: nosniff' || fail "security headers missing"

# Every admin screen of the toolkit renders.
for TAB in modules performance security seo business advanced; do
	HTML=$(curl -s -b "$COOKIES" "$URL/wp-admin/admin.php?page=cwtk&tab=$TAB")
	contains "$HTML" "name=\"cwtk_settings\\[_tab\\]\" value=\"$TAB\"" || fail "toolkit tab $TAB did not render"
done
[ "$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIES" "$URL/wp-admin/site-editor.php")" = "200" ] || fail "Site Editor did not load"

# WordPress.org must not offer another theme or plugin as an update for these folders.
wp theme update-check >/dev/null 2>&1 || true
echo "WordPress.org raw offer for the theme folder: $(wp eval '$t = get_option( "_site_transient_update_themes" ); echo is_object( $t ) && isset( $t->response["corbelwise"] ) ? "version " . $t->response["corbelwise"]["new_version"] : "none";')"
[ "$(wp theme list --name=corbelwise --field=update)" = "none" ] || fail "WordPress offers an update for corbelwise"
[ "$(wp plugin list --name=corbelwise-toolkit --field=update)" = "none" ] || fail "WordPress offers an update for corbelwise-toolkit"

# Every pattern and template is valid in this WordPress version's block editor.
CORBELWISE_BASE="$URL" CORBELWISE_COOKIES="$(php -r 'echo json_encode( json_decode( $argv[1], true )["cookies"] );' "$SESSION")" \
	node "$HERE/e2e/editor-validation.js" || fail "block validation in the editor"

if [ -f wp/wp-content/debug.log ] && grep -i 'corbelwise' wp/wp-content/debug.log; then
	fail "PHP notices from the theme or the toolkit"
fi
echo "WordPress smoke test passed on WordPress $(wp core version)"

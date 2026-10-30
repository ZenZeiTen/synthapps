#!/usr/bin/env bash
# Smoke test in real WordPress with MySQL: firewall, automatic blocking, login lockout,
# enumeration, the live endpoint, every admin screen, and a backup and restore round trip with
# awkward data, through both WP-CLI and the admin screens.
#
# Needs php, curl and a MySQL server. Environment:
#   DB_HOST (127.0.0.1)  DB_USER (root)  DB_PASS (root)  DB_NAME (wordpress)  WORK (./.wp-smoke)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PLUGIN="$(cd "$HERE/../zenzeiten-bastion" && pwd)"
WORK="${WORK:-$HERE/../.wp-smoke}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_USER="${DB_USER:-root}"
DB_PASS="${DB_PASS:-root}"
DB_NAME="${DB_NAME:-wordpress}"
PORT="${PORT:-8090}"
URL="http://127.0.0.1:$PORT"

mkdir -p "$WORK"
cd "$WORK"
[ -f wp-cli.phar ] || curl -sSLo wp-cli.phar https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar
wp() { php "$WORK/wp-cli.phar" --path="$WORK/wp" "$@"; }

rm -rf wp
wp core download --quiet
wp config create --dbname="$DB_NAME" --dbuser="$DB_USER" --dbpass="$DB_PASS" --dbhost="$DB_HOST" --dbcharset=utf8mb4 --skip-check \
	--extra-php <<'PHP'
define( 'WP_DEBUG', true );
define( 'WP_DEBUG_LOG', true );
define( 'WP_DEBUG_DISPLAY', false );
PHP
wp db reset --yes >/dev/null 2>&1 || wp db create
wp core install --url="$URL" --title=Smoke --admin_user=admin --admin_password=admin --admin_email=admin@example.com --skip-email
ln -s "$PLUGIN" wp/wp-content/plugins/zenzeiten-bastion
wp plugin activate zenzeiten-bastion

fail() { echo "FAIL: $*"; [ -f wp/wp-content/debug.log ] && cat wp/wp-content/debug.log; exit 1; }
# grep reads a string, not a pipe: with pipefail, `curl | grep -q` fails when grep exits early.
contains() { grep -q -- "$2" <<<"$1"; }
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

[ "$(wp eval 'echo wp_next_scheduled( "zbst_hourly" ) && wp_next_scheduled( "zbst_backup" ) ? "yes" : "no";')" = "yes" ] || fail "cron not scheduled on activation"

# The plugin is not on WordPress.org; WordPress must never offer to replace it.
UPDATE=$(wp plugin list --name=zenzeiten-bastion --field=update)
[ "$UPDATE" = "none" ] || fail "WordPress offers an update for zenzeiten-bastion ($UPDATE)"

# Requests reach the test server from 127.0.0.1, which is never blocked. Trust it as a proxy so
# X-Forwarded-For can play different visitors (this also tests the proxy handling).
wp eval '$s = get_option( "zbst_settings" ); $s["trusted_proxies"] = "127.0.0.1"; $s["proxy_header"] = "X-Forwarded-For"; update_option( "zbst_settings", $s );'

php -S "127.0.0.1:$PORT" -t wp >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do curl -s -o /dev/null "$URL/" && break; sleep 0.2; done

as() { local ip=$1; shift; curl -s -H "X-Forwarded-For: $ip" -A 'Mozilla/5.0 (X11; Linux x86_64) Chrome/126.0' "$@"; }
code_as() { local ip=$1; shift; status -H "X-Forwarded-For: $ip" -A 'Mozilla/5.0 (X11; Linux x86_64) Chrome/126.0' "$@"; }

# --- The site still renders ------------------------------------------------------------------------
# A blank page with status 200 would pass a status check, so look for the page itself.
COOKIES=$(wp eval 'echo AUTH_COOKIE . "=" . wp_generate_auth_cookie( 1, time() + 3600, "auth" ) . "; " . LOGGED_IN_COOKIE . "=" . wp_generate_auth_cookie( 1, time() + 3600, "logged_in" );')
front_ok() {
	local label=$1 html code
	shift
	code=$(curl -s -o "$WORK/front.html" -w '%{http_code}' "$@" "$URL/")
	html=$(cat "$WORK/front.html")
	echo "front page ($label): HTTP $code, $(wc -c <"$WORK/front.html") bytes"
	if [ "$code" != "200" ] || ! contains "$html" '</html>' || ! contains "$html" '<title>'; then
		echo "--- start of response ---"; head -c 2000 <<<"$html"; echo; echo "--- end ---"
		fail "front page blank or broken ($label)"
	fi
}
front_ok "visitor, default theme" -A 'Mozilla/5.0 (X11; Linux x86_64) Chrome/126.0' -H 'X-Forwarded-For: 198.51.100.200'
front_ok "administrator, default theme" -b "$COOKIES"
front_ok "visitor with typical cookies" -A 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' \
	-H 'X-Forwarded-For: 198.51.100.201' \
	-b '_ga=GA1.1.123456789.1700000000; _fbp=fb.1.1700000000000.123456789; __cf_bm=abc.def-1700000000-1.0.1.1-xyz; CookieConsent={stamp:%27k7Gm3Tq==%27%2Cnecessary:true%2Cpreferences:false%2Cstatistics:true%2Cmarketing:false%2Cmethod:%27explicit%27%2Cver:1%2Cutc:1700000000000%2Cregion:%27id%27}; wordpress_test_cookie=WP%20Cookie%20check'

# The other plugins and theme from this repository, which sites often run together with Bastion.
REPO="$(cd "$HERE/../.." && pwd)"
ln -s "$REPO/corbelwise/plugin/corbelwise-toolkit" wp/wp-content/plugins/corbelwise-toolkit
ln -s "$REPO/visitor-sentinel/zenzeiten-visitor-guard" wp/wp-content/plugins/zenzeiten-visitor-guard
ln -s "$REPO/contextchat/plugin/contextchat" wp/wp-content/plugins/contextchat
ln -s "$REPO/corbelwise/theme/corbelwise" wp/wp-content/themes/corbelwise
wp plugin activate corbelwise-toolkit zenzeiten-visitor-guard contextchat
wp theme activate corbelwise
front_ok "visitor, Corbelwise with the repository's plugins" -A 'Mozilla/5.0 (X11; Linux x86_64) Chrome/126.0' -H 'X-Forwarded-For: 198.51.100.202'
front_ok "administrator, Corbelwise with the repository's plugins" -b "$COOKIES"
wp plugin deactivate corbelwise-toolkit zenzeiten-visitor-guard contextchat
wp theme activate "$(wp theme list --field=name --status=inactive | grep '^twenty' | head -n1)"

# --- Firewall and automatic blocking -------------------------------------------------------------
[ "$(code_as 198.51.100.7 "$URL/?s=shoes")" = "200" ] || fail "normal request refused"
[ "$(code_as 198.51.100.7 "$URL/?id=1%20UNION%20SELECT%20user_pass%20FROM%20wp_users")" = "403" ] || fail "SQL injection not blocked"
BODY=$(as 198.51.100.7 "$URL/?id=1%20UNION%20SELECT%201")
contains "$BODY" 'blocked by the site firewall' || fail "firewall page text"
[ "$(code_as 198.51.100.7 "$URL/?s=shoes")" = "403" ] || fail "repeat attacker not blocked automatically"
[ "$(code_as 198.51.100.8 "$URL/?s=shoes")" = "200" ] || fail "an innocent visitor was blocked"
[ "$(code_as 198.51.100.9 "$URL/?file=../../../../etc/passwd")" = "403" ] || fail "path traversal not blocked"
[ "$(code_as 198.51.100.9 "$URL/" -A 'sqlmap/1.7.2#stable')" = "403" ] || fail "scanner not blocked"
BLOCKS=$(wp db query "SELECT COUNT(*) FROM wp_zbst_blocks WHERE ip = '198.51.100.7' AND source = 'auto'" --skip-column-names)
[ "$BLOCKS" = "1" ] || fail "expected one automatic block, got $BLOCKS"

# --- Login protection ----------------------------------------------------------------------------
for i in 1 2 3 4 5; do
	code_as 198.51.100.20 -b 'wordpress_test_cookie=WP%20Cookie%20check' --data 'log=admin&pwd=wrong'"$i"'&testcookie=1' "$URL/wp-login.php" >/dev/null
done
[ "$(code_as 198.51.100.20 "$URL/wp-login.php")" = "403" ] || fail "brute force not locked out"
LOCK=$(wp db query "SELECT source FROM wp_zbst_blocks WHERE ip = '198.51.100.20'" --skip-column-names)
[ "$LOCK" = "login" ] || fail "lockout not recorded as a login block ($LOCK)"
ERR=$(as 198.51.100.21 -b 'wordpress_test_cookie=WP%20Cookie%20check' --data 'log=admin&pwd=wrong&testcookie=1' "$URL/wp-login.php")
contains "$ERR" 'The username or password is incorrect' || fail "login error message not generic"

# --- User enumeration ----------------------------------------------------------------------------
[ "$(code_as 198.51.100.30 "$URL/?author=1")" = "302" ] || fail "author scan not redirected"
[ "$(code_as 198.51.100.30 "$URL/?rest_route=/wp/v2/users")" = "401" ] || fail "REST user list visible to visitors"

# --- Admin screens and the live endpoint ---------------------------------------------------------
# The auth cookies come from WP-CLI, which is sturdier than posting the login form.
COOKIES=$(wp eval 'echo AUTH_COOKIE . "=" . wp_generate_auth_cookie( 1, time() + 3600, "auth" ) . "; " . LOGGED_IN_COOKIE . "=" . wp_generate_auth_cookie( 1, time() + 3600, "logged_in" );')
admin_page() {
	local html
	html=$(curl -s -b "$COOKIES" "$URL/wp-admin/admin.php?page=$1")
	if ! contains "$html" "$2"; then
		echo "--- start of $1 response ---"; head -c 3000 <<<"$html"; echo; echo "--- end ---"
		fail "admin page $1 did not render"
	fi
	printf '%s' "$html"
}
DASH=$(admin_page zbst-dashboard 'zbst-feed')
admin_page zbst-events 'sqli-union' >/dev/null
admin_page "zbst-events&type=login_failed" 'zbst-wrap' >/dev/null
admin_page zbst-blocks '198.51.100.7' >/dev/null
admin_page zbst-settings 'zbst[firewall_mode]' >/dev/null
BACKUPS=$(admin_page zbst-backups 'Back up now')

# Read the nonce from the plugin's own settings; WordPress prints other nonces (heartbeat) too.
REST_NONCE=$(grep 'var zbstAdmin' <<<"$DASH" | sed -n 's/.*"nonce":"\([a-z0-9]*\)".*/\1/p' | head -n1)
[ -n "$REST_NONCE" ] || fail "no REST nonce on the dashboard"
LIVE=$(curl -s -b "$COOKIES" -H "X-WP-Nonce: $REST_NONCE" "$URL/?rest_route=/zenzeiten-bastion/v1/live&after=0")
contains "$LIVE" '"events"' && contains "$LIVE" '198.51.100.7' || fail "live endpoint: $LIVE"
[ "$(status "$URL/?rest_route=/zenzeiten-bastion/v1/live")" = "401" ] || fail "live endpoint open to visitors"

# --- Backup and restore --------------------------------------------------------------------------
# Awkward content: quotes, backslashes, newlines, emoji (4-byte UTF-8), and a serialized array.
wp eval '
$content = "it'"'"'s \"quoted\" back\\\\slash \\\\n not-a-newline\nreal newline\r\n tab\t emoji 🚀 日本語 <b>html</b> %s";
$id = wp_insert_post( array( "post_title" => "Tricky", "post_content" => "x", "post_status" => "publish" ), true );
// Written directly, so WordPress does not unslash or filter it.
$GLOBALS["wpdb"]->update( $GLOBALS["wpdb"]->posts, array( "post_content" => $content ), array( "ID" => $id ) );
clean_post_cache( $id );
update_option( "zbst_smoke_md5", md5( $content ) );
update_option( "zbst_smoke_array", array( "a" => "x\ny", "b" => "é" ) );
update_option( "zbst_smoke_post", $id );
'
EXPECT=$(wp eval 'echo md5( get_post( get_option( "zbst_smoke_post" ) )->post_content );')
[ "$EXPECT" = "$(wp option get zbst_smoke_md5)" ] || fail "test post not stored as written"

wp bastion backup
wp bastion backups
ID=$(wp bastion backups --format=json | php -r 'echo json_decode( stream_get_contents( STDIN ), true )[0]["id"];')
wp bastion verify "$ID"

# Damage the site, then restore with WP-CLI.
wp option update blogname 'HACKED'
wp post delete "$(wp option get zbst_smoke_post)" --force
wp user create intruder intruder@example.com --role=administrator
wp bastion restore "$ID" --yes
[ "$(wp option get blogname)" = "Smoke" ] || fail "blogname not restored"
[ "$(wp eval 'echo md5( get_post( get_option( "zbst_smoke_post" ) )->post_content );')" = "$EXPECT" ] || fail "post content not restored byte for byte"
[ "$(wp eval '$a = get_option( "zbst_smoke_array" ); echo $a["a"] === "x\ny" && $a["b"] === "é" ? "ok" : "bad";')" = "ok" ] || fail "serialized option not restored"
[ "$(wp user list --role=administrator --field=user_login | tr '\n' ' ')" = "admin " ] || fail "intruder account survived the restore"
[ "$(wp db query "SELECT COUNT(*) FROM wp_zbst_blocks WHERE ip = '198.51.100.7'" --skip-column-names)" = "1" ] || fail "blocks table lost"

# Back up and restore through the admin screens.
NONCE=$(grep -o 'value="zbst_backup_now" />[^>]*name="_wpnonce" value="[a-f0-9]*"' <<<"$(tr -d '\n\t' <<<"$BACKUPS")" | sed 's/.*value="\([a-f0-9]*\)"$/\1/')
[ -n "$NONCE" ] || fail "no backup nonce on the backups page"
[ "$(status -b "$COOKIES" --data "action=zbst_backup_now&_wpnonce=$NONCE" "$URL/wp-admin/admin-post.php")" = "302" ] || fail "Back up now"
COUNT=$(wp bastion backups --format=json | php -r 'echo count( json_decode( stream_get_contents( STDIN ), true ) );')
[ "$COUNT" -ge 3 ] || fail "expected at least 3 backups (CLI, safety, admin), got $COUNT"

BACKUPS=$(admin_page zbst-backups 'zbst_restore')
FLAT=$(tr -d '\n\t' <<<"$BACKUPS")
LATEST=$(wp bastion backups --format=json | php -r 'echo json_decode( stream_get_contents( STDIN ), true )[0]["id"];')
DL=$(grep -o 'admin-post.php?action=zbst_download[^"]*' <<<"$FLAT" | head -n1 | sed 's/&#038;/\&/g; s/&amp;/\&/g')
curl -s -b "$COOKIES" -o "$WORK/download.sql.gz" "$URL/wp-admin/$DL"
[ "$(head -c 2 "$WORK/download.sql.gz" | od -An -tx1 | tr -d ' \n')" = "1f8b" ] || fail "download is not a gzip file"
[ "$(status "$URL/wp-admin/$DL")" != "200" ] || fail "download works without logging in"

RNONCE=$(grep -o 'value="zbst_restore" /><input type="hidden" name="id" value="'"$LATEST"'" /><input type="hidden" id="_wpnonce" name="_wpnonce" value="[a-f0-9]*"' <<<"$FLAT" | sed 's/.*value="\([a-f0-9]*\)"$/\1/' | head -n1)
[ -n "$RNONCE" ] || fail "no restore nonce on the backups page"
wp option update blogname 'HACKED AGAIN'
[ "$(status -b "$COOKIES" --data "action=zbst_restore&id=$LATEST&_wpnonce=$RNONCE" "$URL/wp-admin/admin-post.php")" = "302" ] || fail "restore from the admin screen"
[ "$(wp option get blogname)" = "Smoke" ] || fail "blogname not restored from the admin screen"

# --- Deactivate, reactivate, uninstall keeps data by default -------------------------------------
wp plugin deactivate zenzeiten-bastion
[ "$(wp eval 'echo wp_next_scheduled( "zbst_hourly" ) ? "yes" : "no";')" = "no" ] || fail "cron left behind on deactivation"
wp plugin activate zenzeiten-bastion
[ "$(wp eval 'echo wp_next_scheduled( "zbst_hourly" ) ? "yes" : "no";')" = "yes" ] || fail "cron not rescheduled"

if [ -f wp/wp-content/debug.log ] && grep -i 'zenzeiten-bastion' wp/wp-content/debug.log; then
	fail "PHP notices from the plugin"
fi
echo "WordPress smoke test passed"

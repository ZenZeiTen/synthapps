#!/usr/bin/env bash
# Smoke test in real WordPress with MySQL: switch from the old Visitor Sentinel folder, record a
# server-side and a browser-reported ad landing, run cron, then load every admin screen as an
# administrator.
#
# Needs php, curl and a MySQL server. Environment:
#   DB_HOST (127.0.0.1)  DB_USER (root)  DB_PASS (root)  DB_NAME (wordpress)  WORK (./.wp-smoke)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PLUGIN="$(cd "$HERE/../zenzeiten-visitor-guard" && pwd)"
WORK="${WORK:-$HERE/../.wp-smoke}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_USER="${DB_USER:-root}"
DB_PASS="${DB_PASS:-root}"
DB_NAME="${DB_NAME:-wordpress}"
PORT="${PORT:-8089}"
URL="http://127.0.0.1:$PORT"
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

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
wp core install --url="$URL" --title=Smoke --admin_user=admin --admin_password=admin --admin_email=admin@example.com --skip-email
# Before 1.1.0 the plugin was Visitor Sentinel in the visitor-sentinel folder. Start from such a
# copy (same classes and data, old folder and file name) to test the switch to the new folder.
OLD=wp/wp-content/plugins/visitor-sentinel
cp -r "$PLUGIN" "$OLD"
mv "$OLD/zenzeiten-visitor-guard.php" "$OLD/visitor-sentinel.php"
sed -i 's/^ \* Plugin Name: .*/ * Plugin Name: Visitor Sentinel/; s/^ \* Version: .*/ * Version: 1.0.0/' "$OLD/visitor-sentinel.php"
wp plugin activate visitor-sentinel
ln -s "$PLUGIN" wp/wp-content/plugins/zenzeiten-visitor-guard
wp plugin activate zenzeiten-visitor-guard

php -S "127.0.0.1:$PORT" -t wp >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do curl -s -o /dev/null "$URL/" && break; sleep 0.2; done

fail() { echo "FAIL: $*"; [ -f wp/wp-content/debug.log ] && cat wp/wp-content/debug.log; exit 1; }
# grep reads a string, not a pipe: with pipefail, `curl | grep -q` fails when grep exits early.
contains() { grep -q -- "$2" <<<"$1"; }

# The auth cookies come from WP-CLI, which is sturdier than posting the login form.
COOKIES=$(wp eval 'echo AUTH_COOKIE . "=" . wp_generate_auth_cookie( 1, time() + 3600, "auth" ) . "; " . LOGGED_IN_COOKIE . "=" . wp_generate_auth_cookie( 1, time() + 3600, "logged_in" );')

# While the old copy is active the new one waits and asks for the old one to be removed.
PLUGINS_HTML=$(curl -s -b "$COOKIES" "$URL/wp-admin/plugins.php")
contains "$PLUGINS_HTML" 'ZenZeiTen Visitor Guard replaces Visitor Sentinel' || fail "no notice while the old copy is active"
wp plugin uninstall visitor-sentinel --deactivate
[ "$(wp eval 'global $wpdb; echo get_option( "vsen_db_version" ) && $wpdb->get_var( "SHOW TABLES LIKE \"{$wpdb->prefix}vsen_clicks\"" ) ? "kept" : "lost";')" = "kept" ] || fail "data lost when the old copy was deleted"
[ "$(wp eval 'echo wp_next_scheduled( "vsen_hourly" ) ? "yes" : "no";')" = "yes" ] || fail "hourly cron not rescheduled after the switch"

# WordPress.org hosts unrelated plugins in folders named like this one's past and present names.
# WordPress must not offer them as updates, because updating would replace this plugin.
UPDATE=$(wp plugin list --name=zenzeiten-visitor-guard --field=update)
echo "WordPress.org raw offer: $(wp eval '$t = get_option( "_site_transient_update_plugins" ); $f = "zenzeiten-visitor-guard/zenzeiten-visitor-guard.php"; $r = is_object( $t ) && isset( $t->response[ $f ] ) ? $t->response[ $f ] : null; echo $r ? "version " . $r->new_version : "none";')"
[ "$UPDATE" = "none" ] || fail "WordPress offers an update for zenzeiten-visitor-guard ($UPDATE)"

# The tracker is on public pages.
HOME_HTML=$(curl -s -A "$UA" "$URL/")
contains "$HOME_HTML" 'zenzeiten-visitor-guard/assets/js/tracker.js' || fail "tracker script not enqueued"

# A client without JavaScript lands from an ad: recorded on the server.
curl -s -o /dev/null -A 'curl/8.4.0' "$URL/?gclid=SMOKESERVER0001"

# A browser reports a paid landing through the REST endpoint.
REPLY=$(curl -s -A "$UA" -H 'Accept-Language: en' -H 'Content-Type: text/plain' \
	--data "{\"e\":\"pv\",\"u\":\"$URL/?gclid=SMOKEBROWSER001\",\"r\":\"https://www.google.com/\",\"ti\":\"Home\",\"v\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"s\":\"\",\"sw\":1920,\"sh\":1080,\"wd\":0}" \
	"$URL/?rest_route=/visitor-sentinel/v1/collect")
echo "collect reply: $REPLY"
contains "$REPLY" '"ok":true' || fail "collect endpoint"

CLICKS=$(wp db query "SELECT COUNT(*) FROM wp_vsen_clicks WHERE click_type = 'ad_landing'" --skip-column-names)
[ "$CLICKS" = "2" ] || fail "expected 2 ad landings, got $CLICKS"

wp db query "UPDATE wp_vsen_clicks SET created_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR)"
wp eval 'VisitorSentinel\Cron::run();'
FRAUD=$(wp db query "SELECT COUNT(*) FROM wp_vsen_clicks WHERE status = 2" --skip-column-names)
[ "$FRAUD" = "1" ] || fail "expected the no-JavaScript landing to be fraudulent, got $FRAUD"
echo "server landing scored: $(wp db query "SELECT fraud_score, fraud_reasons FROM wp_vsen_clicks WHERE status = 2" --skip-column-names)"

# Every admin screen loads for an administrator without PHP errors.
admin_page() {
	local html
	html=$(curl -s -b "$COOKIES" "$URL/wp-admin/admin.php?page=$1")
	if ! contains "$html" "$2"; then
		echo "--- start of $1 response ---"
		head -c 3000 <<<"$html"
		echo
		echo "--- end ---"
		fail "admin page $1 did not render"
	fi
}
for PAGE in vsen-dashboard vsen-visitors vsen-fraud vsen-blocklist vsen-settings "vsen-dashboard&range=today" "vsen-fraud&view=fraud" "vsen-visitors&view=bots"; do
	admin_page "$PAGE" 'vsen-wrap'
done
VISITOR=$(wp db query "SELECT id FROM wp_vsen_visitors LIMIT 1" --skip-column-names)
admin_page "vsen-visitors&visitor=$VISITOR" 'vsen-timeline'

if [ -f wp/wp-content/debug.log ] && grep -i 'zenzeiten-visitor-guard\|visitor-sentinel' wp/wp-content/debug.log; then
	fail "PHP notices from the plugin"
fi
echo "WordPress smoke test passed"

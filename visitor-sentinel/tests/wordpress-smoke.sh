#!/usr/bin/env bash
# Smoke test in real WordPress with MySQL: install, activate, record a server-side and a
# browser-reported ad landing, run cron, then load every admin screen as an administrator.
#
# Needs php, curl and a MySQL server. Environment:
#   DB_HOST (127.0.0.1)  DB_USER (root)  DB_PASS (root)  DB_NAME (wordpress)  WORK (./.wp-smoke)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PLUGIN="$(cd "$HERE/../visitor-sentinel" && pwd)"
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
ln -s "$PLUGIN" wp/wp-content/plugins/visitor-sentinel
wp plugin activate visitor-sentinel

php -S "127.0.0.1:$PORT" -t wp >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do curl -s -o /dev/null "$URL/" && break; sleep 0.2; done

fail() { echo "FAIL: $*"; [ -f wp/wp-content/debug.log ] && cat wp/wp-content/debug.log; exit 1; }
# grep reads a string, not a pipe: with pipefail, `curl | grep -q` fails when grep exits early.
contains() { grep -q -- "$2" <<<"$1"; }

# The tracker is on public pages.
HOME_HTML=$(curl -s -A "$UA" "$URL/")
contains "$HOME_HTML" 'visitor-sentinel/assets/js/tracker.js' || fail "tracker script not enqueued"

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
JAR="$WORK/cookies.txt"
rm -f "$JAR"
curl -s -c "$JAR" -b 'wordpress_test_cookie=WP%20Cookie%20check' -o /dev/null \
	--data 'log=admin&pwd=admin&testcookie=1&rememberme=forever' "$URL/wp-login.php"
for PAGE in vsen-dashboard vsen-visitors vsen-fraud vsen-blocklist vsen-settings "vsen-dashboard&range=today" "vsen-fraud&view=fraud" "vsen-visitors&view=bots"; do
	HTML=$(curl -s -b "$JAR" "$URL/wp-admin/admin.php?page=$PAGE")
	contains "$HTML" 'vsen-wrap' || fail "admin page $PAGE did not render"
done
VISITOR=$(wp db query "SELECT id FROM wp_vsen_visitors LIMIT 1" --skip-column-names)
HTML=$(curl -s -b "$JAR" "$URL/wp-admin/admin.php?page=vsen-visitors&visitor=$VISITOR")
contains "$HTML" 'vsen-timeline' || fail "visitor page"

if [ -f wp/wp-content/debug.log ] && grep -i 'visitor-sentinel' wp/wp-content/debug.log; then
	fail "PHP notices from the plugin"
fi
echo "WordPress smoke test passed"

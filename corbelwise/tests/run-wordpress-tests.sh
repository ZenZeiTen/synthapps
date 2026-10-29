#!/usr/bin/env bash
# Build a throwaway WordPress site with the Corbelwise theme and toolkit, then run the block validator,
# the browser tests and the integration tests against it.
#
#   tests/run-wordpress-tests.sh [screenshot-dir]
#
# Needs php (with pdo_sqlite), node and the packages from `npm ci` in corbelwise/.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
SITE="$WORK/site"
PORT="${CORBELWISE_PORT:-8891}"
BASE="http://127.0.0.1:$PORT"

"$HERE/e2e/setup-wordpress.sh" "$SITE" >/dev/null
php -S "127.0.0.1:$PORT" -t "$SITE" "$HERE/e2e/router.php" >"$WORK/server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; rm -rf "$WORK"' EXIT

php "$HERE/e2e/install.php" "$SITE" "$BASE" >/dev/null 2>&1
for _ in $(seq 1 50); do
	curl -fs -o /dev/null "$BASE/" && break
	sleep 0.1
done

status=0
echo "== Block markup (WordPress 6.5 editor validation)"
php "$HERE/tools/dump-markup.php" "$SITE" >"$WORK/markup.json"
node "$HERE/tools/validate-blocks.js" "$WORK/markup.json" || status=1

echo "== Browser"
CORBELWISE_BASE="$BASE" CORBELWISE_SITE="$SITE" CORBELWISE_SHOTS="${1:-}" node --test --test-concurrency=1 "$HERE/e2e/browser.test.js" || status=1

echo "== Integration"
php "$HERE/wordpress/run.php" "$SITE" || status=1

# PHP notices or warnings from the theme or the toolkit fail the run.
if grep -v "already registered" "$SITE/wp-content/debug.log" 2>/dev/null | grep -i "corbelwise"; then
	echo "PHP notices or warnings from Corbelwise (above)." >&2
	status=1
fi
exit $status

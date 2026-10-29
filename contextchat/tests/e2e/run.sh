#!/usr/bin/env bash
# Build a fresh WordPress site, start PHP's server and run the browser tests against it.
#
#   tests/e2e/run.sh [screenshot-dir]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
SITE="$WORK/site"
PORT="${CTXC_PORT:-8899}"
BASE="http://127.0.0.1:$PORT"

"$HERE/setup-wordpress.sh" "$SITE" >/dev/null
php -S "127.0.0.1:$PORT" -t "$SITE" "$HERE/router.php" >"$WORK/server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; rm -rf "$WORK"' EXIT

php "$HERE/install.php" "$SITE" "$BASE" 2>/dev/null
for _ in $(seq 1 50); do
	curl -fs -o /dev/null "$BASE/" && break
	sleep 0.1
done

status=0
CTXC_BASE="$BASE" CTXC_SITE="$SITE" CTXC_SHOTS="${1:-}" node --test --test-concurrency=1 "$HERE/browser.test.js" || status=$?
if [ -n "${WP_CLI:-}" ] || command -v wp >/dev/null; then
	"$HERE/update-offer-check.sh" "$SITE" || status=1
else
	echo "skip - update offer check (needs WP-CLI: set WP_CLI or put wp on PATH)"
fi
php "$HERE/uninstall-check.php" "$SITE" || status=1

# PHP notices or warnings from the plugin fail the run.
if grep -v "already registered" "$SITE/wp-content/debug.log" 2>/dev/null | grep -i "contextchat"; then
	echo "PHP notices or warnings from ContextChat (above)." >&2
	exit 1
fi
exit $status

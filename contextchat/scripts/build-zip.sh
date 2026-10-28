#!/usr/bin/env bash
# Package the plugin as an installable zip: dist/contextchat-<version>.zip
# Upload it under Plugins → Add New → Upload Plugin.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(sed -n 's/^ \* Version: *//p' "$ROOT/plugin/contextchat/contextchat.php" | tr -d '[:space:]')"
OUT="$ROOT/dist/contextchat-$VERSION.zip"

mkdir -p "$ROOT/dist"
rm -f "$OUT"
( cd "$ROOT/plugin" && zip -qr "$OUT" contextchat -x '*.DS_Store' )
echo "$OUT"

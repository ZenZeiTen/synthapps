#!/usr/bin/env bash
# Build the release files in corbelwise/dist/:
#   corbelwise-<version>.zip          the theme (upload under Appearance → Themes)
#   corbelwise-toolkit-<version>.zip  the plugin (upload under Plugins)
#   corbelwise-package-<version>.zip  both zips plus the user guide, for marketplaces
set -euo pipefail

CORBELWISE="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$CORBELWISE/dist"
THEME_VERSION="$(sed -n 's/^Version: *//p' "$CORBELWISE/theme/corbelwise/style.css" | tr -d '[:space:]')"
PLUGIN_VERSION="$(sed -n 's/^ \* Version: *//p' "$CORBELWISE/plugin/corbelwise-toolkit/corbelwise-toolkit.php" | tr -d '[:space:]')"

rm -rf "$DIST"
mkdir -p "$DIST/package"
(cd "$CORBELWISE/theme" && zip -qr "$DIST/corbelwise-$THEME_VERSION.zip" corbelwise -x '*.DS_Store')
(cd "$CORBELWISE/plugin" && zip -qr "$DIST/corbelwise-toolkit-$PLUGIN_VERSION.zip" corbelwise-toolkit -x '*.DS_Store')

# WordPress installs a zip into its top folder, which must be the theme or plugin slug.
# grep reads a here-string, not a pipe: with pipefail, `unzip | grep -q` fails when grep exits early.
THEME_FILES="$(unzip -Z1 "$DIST/corbelwise-$THEME_VERSION.zip")"
PLUGIN_FILES="$(unzip -Z1 "$DIST/corbelwise-toolkit-$PLUGIN_VERSION.zip")"
grep -qx 'corbelwise/style.css' <<<"$THEME_FILES"
grep -qx 'corbelwise/screenshot.png' <<<"$THEME_FILES"
grep -qx 'corbelwise-toolkit/corbelwise-toolkit.php' <<<"$PLUGIN_FILES"

cp "$DIST"/corbelwise-*.zip "$CORBELWISE/docs/USER-GUIDE.md" "$CORBELWISE/LICENSE.txt" "$DIST/package/"
(cd "$DIST/package" && zip -qr "$DIST/corbelwise-package-$THEME_VERSION.zip" .)
rm -rf "$DIST/package"
ls -l "$DIST"

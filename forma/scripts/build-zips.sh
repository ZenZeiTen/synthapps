#!/usr/bin/env bash
# Build the release files in forma/dist/:
#   zenzeiten-forma-<version>.zip          the theme (upload under Appearance → Themes)
#   zenzeiten-forma-toolkit-<version>.zip  the plugin (upload under Plugins)
#   zenzeiten-forma-package-<version>.zip  both zips plus the user guide, for marketplaces
set -euo pipefail

FORMA="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$FORMA/dist"
THEME_VERSION="$(sed -n 's/^Version: *//p' "$FORMA/theme/zenzeiten-forma/style.css" | tr -d '[:space:]')"
PLUGIN_VERSION="$(sed -n 's/^ \* Version: *//p' "$FORMA/plugin/zenzeiten-forma-toolkit/zenzeiten-forma-toolkit.php" | tr -d '[:space:]')"

rm -rf "$DIST"
mkdir -p "$DIST/package"
(cd "$FORMA/theme" && zip -qr "$DIST/zenzeiten-forma-$THEME_VERSION.zip" zenzeiten-forma -x '*.DS_Store')
(cd "$FORMA/plugin" && zip -qr "$DIST/zenzeiten-forma-toolkit-$PLUGIN_VERSION.zip" zenzeiten-forma-toolkit -x '*.DS_Store')

# WordPress installs a zip into its top folder, which must be the theme or plugin slug.
# grep reads a here-string, not a pipe: with pipefail, `unzip | grep -q` fails when grep exits early.
THEME_FILES="$(unzip -Z1 "$DIST/zenzeiten-forma-$THEME_VERSION.zip")"
PLUGIN_FILES="$(unzip -Z1 "$DIST/zenzeiten-forma-toolkit-$PLUGIN_VERSION.zip")"
grep -qx 'zenzeiten-forma/style.css' <<<"$THEME_FILES"
grep -qx 'zenzeiten-forma/screenshot.png' <<<"$THEME_FILES"
grep -qx 'zenzeiten-forma-toolkit/zenzeiten-forma-toolkit.php' <<<"$PLUGIN_FILES"

cp "$DIST"/zenzeiten-forma-*.zip "$FORMA/docs/USER-GUIDE.md" "$FORMA/LICENSE.txt" "$DIST/package/"
(cd "$DIST/package" && zip -qr "$DIST/zenzeiten-forma-package-$THEME_VERSION.zip" .)
rm -rf "$DIST/package"
ls -l "$DIST"

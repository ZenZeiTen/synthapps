#!/usr/bin/env bash
# Check that WordPress never offers a WordPress.org plugin as an update to ContextChat.
#
#   tests/e2e/update-offer-check.sh <site-dir>
#
# WordPress matches updates by folder name, so a WordPress.org plugin in a folder named
# "contextchat" would be offered here, and "update now" would replace ContextChat with it.
# The test site cannot reach WordPress.org, so the check caches such an offer itself, exactly as
# WordPress would store it, then asks WP-CLI what the Plugins screen would show.
# Needs WP-CLI: set WP_CLI to its command (CI uses "php wp-cli.phar"), or have "wp" on PATH.
set -euo pipefail

SITE="${1:?usage: update-offer-check.sh <site-dir>}"
read -r -a WP <<< "${WP_CLI:-wp}"
WP+=(--path="$SITE")
[ "$(id -u)" = 0 ] && WP+=(--allow-root)   # throwaway test site; CI does not run as root

"${WP[@]}" eval '
$t               = new stdClass();
$t->last_checked = time();
$t->checked      = array_map( function ( $d ) { return $d["Version"]; }, get_plugins() );
$t->response     = array(
	"contextchat/contextchat.php" => (object) array(
		"slug"        => "contextchat",
		"plugin"      => "contextchat/contextchat.php",
		"new_version" => "9.9.9",
		"package"     => "https://downloads.wordpress.org/plugin/contextchat.9.9.9.zip",
	),
);
$t->no_update    = array();
$t->translations = array();
update_option( "_site_transient_update_plugins", $t );
'

RAW=$("${WP[@]}" eval '$t = get_option( "_site_transient_update_plugins" ); echo isset( $t->response["contextchat/contextchat.php"] ) ? "present" : "missing";')
[ "$RAW" = "present" ] || { echo "Could not cache a WordPress.org offer to test against." >&2; exit 1; }

UPDATE=$("${WP[@]}" plugin list --name=contextchat --field=update)
if [ "$UPDATE" != "none" ]; then
	echo "WordPress offers an update for contextchat ($UPDATE); updating would replace this plugin." >&2
	exit 1
fi
echo "ok - a cached WordPress.org offer for the contextchat folder is not shown (update: none)"

=== ZenZeiTen Forma Toolkit ===
Contributors: zenzeiten
Tags: performance, security, seo, schema, ai
Requires at least: 6.5
Tested up to: 6.5
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Switchable modules for a fast, secure business site, with an optional AI assistant powered by Claude.

== Description ==

Made for the ZenZeiTen Forma theme, and works with any theme. Switch on only the modules you need under the Forma menu. A module that is off adds nothing to your pages.

* Performance: removes the emoji script, unused header tags and other extras; calms background requests; limits revisions.
* Security: protective browser headers, login guessing protection, one error message for wrong usernames and passwords, hidden usernames, and optional XML-RPC and file editor switches.
* SEO and sharing: a search description field on every page, preview cards for social networks, structured data (business, website, articles, breadcrumbs) and noindex for search results. Steps aside when Yoast SEO, Rank Math or another SEO plugin is active.
* Business details: name, address, phone, email, opening hours and social profiles, entered once. Shortcodes: [forma_business field="phone"], [forma_business field="address"], [forma_business field="hours"], [forma_social_links].
* Announcement bar: a message at the top of every page with optional dates; visitors can close it.
* AI assistant (off by default): a writing assistant in the editor and an optional visitor chat that answers from your own pages and business details. Uses your own Anthropic API key. Shortcode for the chat inside a page: [forma_ai_chat].

== Installation ==

1. Plugins → Add New Plugin → Upload Plugin, choose zenzeiten-forma-toolkit.zip, Install Now, Activate.
2. Open the Forma menu and switch modules on or off.

== Frequently Asked Questions ==

= What does the AI assistant cost? =

The plugin is included with the theme. Anthropic bills API usage to your own account. The settings let you choose a lower-cost model and cap the number of chat messages per visitor and per day.

= What is sent to Anthropic? =

Only when the AI module is on and a feature is used: for the writing assistant, the text you ask it to work on; for the visitor chat, the visitor's messages plus your business details, your instructions and excerpts of your public pages. The plugin does not store chat conversations.

= Is my API key safe? =

It is stored encrypted with your site's secret keys. For extra safety, define ZZFT_ANTHROPIC_API_KEY in wp-config.php instead; the settings field then shows that the key comes from there.

= What happens to my settings when I delete the plugin? =

They are kept, so you can reinstall without losing anything, unless you tick "Delete all toolkit settings and data" under Forma → Advanced first.

== Changelog ==

= 1.0.0 =
* First release.

A WordPress plugin with a chat button for WhatsApp. It fills in each message with what the visitor was looking at — the page, the product and its price, the campaign they came from — and sends it to the right person on your team.

## Install

Download `contextchat-1.1.0.zip` below. In WordPress go to **Plugins → Add New → Upload Plugin**, upload the zip and activate it. Then open **ContextChat** in the admin menu and enter your WhatsApp number with country code, or add agents.

Requires WordPress 6.2 or newer and PHP 7.4 or newer. WooCommerce is optional.

## What's new in 1.1.0

Fixes:

- **Analytics follow your site time zone.** Days were counted in UTC. On a site in Jakarta (UTC+7), chats started before 07:00 appeared under the previous day, and "Last 7 days" began at 07:00. The report, the chart and the CSV export now use days in the time zone set under Settings → General. Clicks already recorded are kept and simply shown on the right day.
- **Messages are sent as written.** The clean-up that removes the traces of empty placeholders also ran over everything else, so a visitor who typed "Thanks :)" sent "Thanks:)", and "Is that possible ?" lost its space. Now only the spot where a placeholder was empty is cleaned. What visitors type, the wording of your templates and the values themselves are left alone.
- **Empty placeholders leave less behind.** `{greeting}, I need help` with no greeting now gives "I need help" instead of ", I need help", and `("{product_name}")` disappears whole.
- **A delayed button no longer depends on the script.** With "Appear after (seconds)" set, the button never appeared for visitors whose browser did not run the script. It now appears after the delay either way.
- **Hiding the button while offline** looks at the agents the button offers on that page. Before, one "always available" agent anywhere kept the button on pages where that agent is not offered.
- **Settings screen.** Saving with an empty required field on another tab (for example a new agent without a number) did nothing and showed no reason; it now opens that tab. Fields in newly added rules no longer share an ID.
- **Filters.** A `contextchat_should_display` filter that shows the button on a page without agents no longer causes PHP warnings. Agents added through `contextchat_agents` are checked and completed, so a missing key cannot break the panel.
- **Networks (multisite).** Deleting the plugin removes its data from every site, and the daily clean-up of old clicks is scheduled on every site.

New:

- A **Remove photo** button for agents. Before, a photo could only be removed with a right click.
- The settings tabs can be used from the keyboard (arrow keys, Home, End).
- Placeholder tooltips on the settings screen can be translated, and are in the Indonesian translation.
- A `contextchat_client_ip` filter for sites behind a proxy or CDN that does not pass on the visitor's address. Without it, all visitors of such a site share one limit of 20 counted clicks a minute.

Changed, in case you rely on it:

- A template is no longer "corrected" outside empty placeholders. If a template contains a typing slip such as `Hello , there`, it is now sent that way; before, the space was removed. The preview under each template on the settings screen shows exactly what will be sent.

### Updating

1. Download `contextchat-1.1.0.zip` below.
2. In WordPress go to **Plugins → Add New → Upload Plugin**, upload the zip and click **Install Now**.
3. WordPress says the plugin is already installed. Click **Replace current with uploaded**.

Your settings, agents, rules and click analytics stay as they are. Do not delete ContextChat first: deleting it removes its settings and statistics.

## What's in 1.0.2

- A maintenance release built from the same code as 1.0.1. No new features and no fixes.

## What's new in 1.0.1

- ContextChat opts out of WordPress.org updates. It is not hosted on WordPress.org, and WordPress matches updates by folder name, so a WordPress.org plugin that also used the folder `contextchat` would have been offered here as an "update", and accepting it would have replaced ContextChat. The plugin now tells WordPress not to ask WordPress.org about it, and removes any such offer already stored on the site.
- If WordPress shows "A new version is available" for ContextChat, do not update from that notice. New versions of ContextChat come only as zips from this page.

## What's in 1.0.0

- Message templates with placeholders such as `{page_title}`, `{page_url}`, `{product_name}`, `{product_price}` and `{utm_source}`, with fallbacks: `{utm_source|your website}`.
- Context rules that give pages, categories, products, the home page or search results their own message and agents. Any page can also set its own message.
- Agents with roles and photos, opening hours in your site time zone, and an offline note.
- A panel where visitors see and can edit the message before WhatsApp opens; a bottom sheet on phones.
- A WooCommerce "Ask about this product" button, a `[contextchat]` shortcode and a block.
- Click analytics with CSV export. No IP addresses, cookies or message text are stored.
- Indonesian (Bahasa Indonesia) translation, used automatically when the site language is Indonesian.

## Not yet covered by automated tests

- The product button was tested against a stand-in for WooCommerce, not a real store.
- Drag-to-reorder, the media-library photo picker and the block inside the editor were not exercised.
- The tests run on a single site with an SQLite database. Networks (multisite) and MySQL or MariaDB were not exercised.

WhatsApp is a trademark of WhatsApp LLC. This plugin is not affiliated with or endorsed by WhatsApp LLC.

A WordPress plugin with a chat button for WhatsApp. It fills in each message with what the visitor was looking at — the page, the product and its price, the campaign they came from — and sends it to the right person on your team.

Version 2.0.0 adds an optional **SI assistant**: a chat in the panel that answers questions, gives estimates from your price table and hands the visitor to your team with a summary. It is **off until you turn it on**, so nothing changes for visitors when you update.

## Install

Download `contextchat-2.0.0.zip` below. In WordPress go to **Plugins → Add New → Upload Plugin**, upload the zip and activate it. Then open **ContextChat** in the admin menu and enter your WhatsApp number with country code, or add agents.

Requires WordPress 6.2 or newer and PHP 7.4 or newer. WooCommerce is optional. The SI assistant needs an Anthropic API key; your site pays Anthropic directly.

## What's new in 2.0.0

### For visitors, once you turn the SI chat on

- **A chat in the panel.** The SI assistant answers from your knowledge entries, in Indonesian or English, in the voice you set. It is told not to name staff (the names you list are blocked outright) and not to promise what your team has not confirmed.
- **Estimates calculated in code.** The SI collects the details (document, languages, pages, destination, deadline), then shows an estimate card worked out by the plugin from your price table. The model never calculates a price. The card shows:
  - the translation fee;
  - Apostille, or ministry and embassy legalisation, chosen from the destination country;
  - any express surcharge and volume discount;
  - the total and the 50% deposit;
  - a reference and how long the estimate is valid.
- **Handoff to your team** on WhatsApp or by email, with a summary the visitor can edit first. The handoff is offered:
  - when the visitor asks for a person;
  - when they hesitate about the price;
  - when the job needs the team (express, interpreting, a pair you don't offer);
  - when they stay quiet after an estimate.
- **Safe by default.** Messages with ID numbers, documents or file links are refused before anything is stored or sent. Every reply is checked for amounts, names, promises and length; a reply that fails is written again by the stronger model or replaced by a fixed reply.
- **Just your name in the window.** The chat shows your business name, with no notice and no mention of SI or the service behind it. It introduces itself as your business, never claims to be a person, and says the chat is answered automatically if a visitor asks. You can add a notice on the Voice tab, and your privacy policy describes the rest.

### For administrators

New tabs and screens under **ContextChat**:

- **SI**:
  - the API key, stored encrypted or set in `wp-config.php`;
  - model routing: Claude Haiku 5.5, with Claude Sonnet 5.5 when a reply fails a check;
  - the daily spending cap, USD 10 by default;
  - Test connection;
  - turning the SI chat on, the business name, the handoff email and agents, and the idle time.
- **Knowledge**: the entries the SI answers from, with import, export and the bundled set.
- **Voice**: the voice guide, example replies, fixed replies, banned words and the staff names to block.
- **Prices**:
  - the price table, with import, export and a warning when prices are older than 90 days;
  - the Apostille member list, with a yearly review warning.
- **Privacy**:
  - how long chats are kept (365 days by default);
  - the privacy policy address;
  - rate limits;
  - refused file-sharing hosts;
  - optionally, asking visitors to agree before the chat starts. Their agreement is recorded.
- **Conversations**:
  - read each chat with its summary, estimates and processing record;
  - export it as JSON;
  - delete it.
- **Analytics**:
  - an SI section with the funnel from chat started to team contacted;
  - refusals and errors;
  - model cost;
  - a CSV export without message text.

WordPress's **Settings → Privacy → Policy Guide** offers a suggested privacy policy section for the SI chat. It was checked against Indonesia's Personal Data Protection Law (UU 27/2022) and its implementing regulation (PP 33/2026, in force from 16 January 2027). It is a starting point with parts to fill in, not legal advice.

### Before you turn the SI chat on

1. On **SI**, save your Anthropic API key and press **Test connection**.
2. Check **Knowledge**, **Voice** (add your staff names to block) and **Prices** against your own business. The bundled data is Nusalexia's.
3. Set the handoff agents and email on **SI**, and the keep-for period and privacy policy address on **Privacy**.
4. Publish a privacy policy that covers the chat, and have it reviewed. The open questions are listed in `docs/privacy-draft.md` in the repository; the most important is sending chat text to Anthropic outside Indonesia.
5. Tick **Turn on the SI chat**.

The plugin contacts Anthropic only after you save a key and either press **Test connection** or turn the SI chat on. What is sent, and when, is under *External services* in `readme.txt`.

### Updating from 1.1.0 or 2.0.0-dev

1. Download `contextchat-2.0.0.zip` below.
2. In WordPress go to **Plugins → Add New → Upload Plugin**, upload the zip and click **Install Now**.
3. WordPress says the plugin is already installed. Click **Replace current with uploaded**.

Your settings, agents, rules and click analytics stay as they are, and the new tables and options are created on the first page load. Do not delete ContextChat first: deleting it removes its settings, statistics and chats. To go back, upload `contextchat-1.1.0.zip` the same way; the SI tables are then left unused.

### Not yet tested

- **Real Anthropic API calls.** The automated tests use a stand-in for the API. Before relying on the chat:
  - press **Test connection**;
  - run the golden conversations against the real API (`npm run eval`, see the README). It plays 30 conversations and has Claude Haiku grade the tone; it needs your key and costs a little.
- **A real WooCommerce store and MySQL/MariaDB.** The browser tests run on SQLite with a stand-in for WooCommerce.
- **The legal questions** in `docs/privacy-draft.md`. They need a lawyer, not a test.

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

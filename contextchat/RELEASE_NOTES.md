A WordPress plugin with a chat button for WhatsApp. It fills in each message with what the visitor was looking at — the page, the product and its price, the campaign they came from — and sends it to the right person on your team.

## Install

Download `contextchat-1.0.1.zip` below. In WordPress go to **Plugins → Add New → Upload Plugin**, upload the zip and activate it. Then open **ContextChat** in the admin menu and enter your WhatsApp number with country code, or add agents.

Requires WordPress 6.2 or newer and PHP 7.4 or newer. WooCommerce is optional.

## What's new in 1.0.1

- ContextChat no longer accepts updates from WordPress.org. WordPress pairs updates with plugins by folder name, so an unrelated WordPress.org plugin in a folder named `contextchat` could otherwise be offered as an "update", and accepting it would replace ContextChat.

To update from 1.0.0, upload the 1.0.1 zip in **Plugins → Add New → Upload Plugin** and choose **Replace current with uploaded**. Your settings, agents and click statistics stay. Do not delete ContextChat first: deleting it removes its settings and statistics.

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

WhatsApp is a trademark of WhatsApp LLC. This plugin is not affiliated with or endorsed by WhatsApp LLC.

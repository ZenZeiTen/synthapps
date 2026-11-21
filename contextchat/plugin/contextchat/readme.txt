=== ContextChat – Smart Chat Button for WhatsApp ===
Contributors: nsxsft
Tags: whatsapp, chat, click to chat, woocommerce, contact
Requires at least: 6.2
Tested up to: 6.5
Requires PHP: 7.4
Stable tag: 2.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

A chat button for WhatsApp that tells you what the visitor was looking at before they wrote to you.

== Description ==

Most chat buttons open WhatsApp with an empty message, and the first reply is always "Which product do you mean?". ContextChat pre-fills every message with the page, product and campaign the visitor came from, and sends it to the right person.

* **Context in every message.** Placeholders such as {page_title}, {page_url}, {product_name}, {product_price}, {utm_source} and {referrer}, with fallbacks: {product_name|your services}.
* **Context rules.** Give pages their own message and agents: by address, page, content type, post or product category, product pages, home page or search. The first matching rule wins. Any page can also set its own message in the editor.
* **Agents.** Up to 20 people or teams, with photo, role, and an "always available" option. Rules decide who is offered where.
* **Opening hours.** A weekly schedule in your site time zone, including shifts past midnight. Outside hours, agents show as offline, the panel shows your offline note, and messages can carry a note such as "(Sent outside business hours.)". You can also hide the button while everyone is offline.
* **Visitors see what they send.** The panel shows the pre-filled message and lets the visitor edit it before opening WhatsApp.
* **WooCommerce.** An "Ask about this product" button under Add to cart, sending the product name, price, SKU and link.
* **Shortcode and block.** [contextchat] and a "ContextChat button" block for any page, using the same context and routing.
* **Analytics without tracking people.** Clicks by day, page, agent, button and device, with CSV export. No IP addresses, cookies or message text are stored. Optional events for Google Analytics and Tag Manager.
* **SI assistant (optional, new in 2.0).** A chat in the panel, powered by Anthropic's Claude models through your own API key. It answers from your knowledge entries, collects what your team needs, gives estimates calculated in code from your price table (never by the model), and hands the visitor to your team on WhatsApp or by email with a summary. It refuses ID numbers, documents and file links, keeps chats for a period you set, and has screens to read, export and delete chats. Off until you turn it on.
* **Bahasa Indonesia included.** Full Indonesian translation, used automatically when the site language is Indonesian.
* **Fast and accessible.** One small script and stylesheet with no jQuery, loaded only where a button appears. Every button is a real link that works before the script loads. Keyboard and screen reader friendly, respects reduced motion, has a dark mode, and turns into a bottom sheet on phones.

WhatsApp is a trademark of WhatsApp LLC. This plugin is not affiliated with or endorsed by WhatsApp LLC.

== Installation ==

1. Upload the plugin zip under Plugins → Add New → Upload Plugin, then activate it.
2. Open ContextChat in the admin menu.
3. Enter your WhatsApp number with country code, or add agents under "Agents & context".
4. Optional: add context rules, opening hours and the WooCommerce button.

== Frequently Asked Questions ==

= Which placeholders can I use? =

Page: {page_title}, {page_url}, {site_name}, {post_type}, {category}, {search_query}.
Product: {product_name}, {product_price}, {product_sku}, {product_stock}.
Visit: {agent_name}, {utm_source}, {utm_medium}, {utm_campaign}, {referrer}, {date}, {time}.

Empty placeholders disappear cleanly, including brackets and quotes around them. Add a fallback with a bar: {utm_source|your website}.

= Does it work with page caching? =

Yes. Page details are built into the page, and everything that depends on the visitor or the clock (campaign tags, referrer, opening hours) is worked out in the browser.

= What is stored about visitors? =

For each click: the time, the page path, the agent, the rule, the button and whether it was a phone or a computer. Nothing that identifies a person. Data older than the retention period (180 days by default) is deleted daily.

When the SI chat is on, each chat is stored too: the messages, the details collected, the estimates, the page path, the language and the device, under a chat reference. No IP address is stored, and messages containing ID numbers, documents or file links are refused and not stored. Chats are deleted after the period set under Privacy (365 days by default). Administrators can read, export and delete single chats under ContextChat → Conversations.

= What does the SI assistant cost, and what does it need? =

An Anthropic API key, which your site pays for directly. A daily spending cap (USD 10 by default) stops the chat for the rest of the day when it is reached; visitors are then offered WhatsApp or email. Analytics shows the cost per chat.

= Does it help with privacy rules? =

WordPress shows a suggested privacy policy section for the SI chat under Settings → Privacy → Policy Guide. It was checked against Indonesia's Personal Data Protection Law (UU 27/2022) and its implementing regulation (PP 33/2026). It is a starting point with parts for you to fill in, not legal advice. Have it reviewed before you publish it. An option asks visitors to agree before the chat starts, with your privacy policy link, and records their agreement.

= How do I add my own placeholders? =

Use the `contextchat_context` filter:

`add_filter( 'contextchat_context', function ( $vars ) { $vars['member_level'] = 'Gold'; return $vars; } );`

Other filters: `contextchat_message`, `contextchat_agents`, `contextchat_should_display`. The browser fires a `contextchat:click` event on `document` for every chat started.

== External services ==

ContextChat 2.0 adds an SI (Synthesized Intelligence) assistant that uses Anthropic's Claude API. It is off by default and needs the site's own API key.

* **Service:** Anthropic API, https://api.anthropic.com/v1/messages
* **What is sent:**
  * **When an administrator presses "Test connection":** the test message typed on the SI screen.
  * **When the SI chat is on:** each visitor message that passed ContextChat's checks, the last 20 messages of that conversation, the address of the page the chat started on, the details collected so far, and the assistant's instructions (the voice guide, the knowledge entries and the price table set in ContextChat).
  * **Always:** the site's API key, in a request header.
* **What is never sent:** messages that ContextChat blocks (file links, ID and card numbers), IP addresses and cookies.
* **When:** nothing is sent until an administrator adds an API key and either turns on the SI chat or runs the connection test.
* **Where:** Anthropic, PBC is based in the United States. Describe this in your privacy policy; the suggested text under Settings → Privacy → Policy Guide does. The chat window itself shows only your business name unless you add a notice on the Voice tab.
* Anthropic's terms: https://www.anthropic.com/legal/commercial-terms
* Anthropic's privacy policy: https://www.anthropic.com/legal/privacy

== Shortcode ==

`[contextchat text="Chat with us" agent="rina" message="Hi! About {page_title}..."]`

All attributes are optional. Without `agent` the button follows your context rules; without `message` it uses the rule or default message.

== Changelog ==

= 2.0.0 =
* New: an SI (Synthesized Intelligence) assistant in the chat panel, on Anthropic's Claude models with your own API key. Off until you turn it on.
* New: estimates calculated in code from a price table you edit, with the Apostille or ministry-and-embassy route by destination country, express surcharges, volume discounts and the deposit; the model never works out a price.
* New: the SI answers from knowledge entries you edit and writes in the voice you set; every reply is checked for amounts, names, promises and length before the visitor sees it.
* New: handoff to your team on WhatsApp or by email with a summary the visitor can edit.
* New: ID numbers, documents and file links are refused before anything is stored or sent; rate limits; a daily spending cap.
* New: screens for Prices, Privacy (keep-for period, rate limits, refused hosts, policy link, optional agreement before the chat) and Conversations (read, export, delete).
* New: SI analytics with a funnel and a CSV export without message text.
* New: suggested privacy policy text under Settings → Privacy → Policy Guide, checked against UU 27/2022 and PP 33/2026 (not legal advice).
* Nothing changes for visitors until the SI chat is turned on: the button and panel work as in 1.1.0.

= 1.1.0 =
* Fix: analytics count days in your site time zone. They were counted in UTC, so on a site in Jakarta chats started before 07:00 appeared under the previous day.
* Fix: messages are sent as written. Text a visitor types, such as ":)" or "Is that possible ?", is no longer changed, and neither is the wording of your templates. Clean-up now happens only where a placeholder was empty.
* Fix: empty placeholders leave less behind: a comma after an empty value and nested brackets or quotes around it are removed too.
* Fix: with "Appear after (seconds)" set, the button also appears for visitors whose browser does not run the script.
* Fix: "Hide the floating button" while offline looks at the agents offered on that page, not at all agents.
* Fix: saving the settings with an empty required field on another tab now opens that tab instead of doing nothing.
* Fix: no PHP warnings when a filter shows the button on a page without agents; agents added through the `contextchat_agents` filter are checked and completed.
* Fix: on a network (multisite), deleting the plugin removes its data from every site, and the daily clean-up of old clicks is scheduled on every site.
* New: a "Remove photo" button for agents, and keyboard navigation for the settings tabs.
* New: placeholder tooltips are translatable and translated into Indonesian.
* New: `contextchat_client_ip` filter for sites behind a proxy or CDN.

= 1.0.2 =
* Maintenance release built from the current code. It behaves the same as 1.0.1: no new features and no fixes. Sites already on 1.0.1 do not need to update.

= 1.0.1 =
* Fix: WordPress can no longer offer an unrelated plugin from WordPress.org as an "update" to ContextChat. WordPress matches updates by folder name, so a WordPress.org plugin also named "contextchat" would have replaced this one. The plugin now opts out of WordPress.org updates and removes any such offer already cached on the site.

= 1.0.0 =
* First release.

=== ContextChat – Smart Chat Button for WhatsApp ===
Contributors: nsxsft
Tags: whatsapp, chat, click to chat, woocommerce, contact
Requires at least: 6.2
Tested up to: 6.5
Requires PHP: 7.4
Stable tag: 1.0.0
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

= How do I add my own placeholders? =

Use the `contextchat_context` filter:

`add_filter( 'contextchat_context', function ( $vars ) { $vars['member_level'] = 'Gold'; return $vars; } );`

Other filters: `contextchat_message`, `contextchat_agents`, `contextchat_should_display`. The browser fires a `contextchat:click` event on `document` for every chat started.

== Shortcode ==

`[contextchat text="Chat with us" agent="rina" message="Hi! About {page_title}..."]`

All attributes are optional. Without `agent` the button follows your context rules; without `message` it uses the rule or default message.

== Changelog ==

= 1.0.0 =
* First release.

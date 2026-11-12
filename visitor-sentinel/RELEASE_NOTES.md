A WordPress plugin that records who visits your site and what they do there, and flags ad clicks that do not come from people. Formerly called Visitor Sentinel.

## Install

Download `zenzeiten-visitor-guard-1.2.0.zip` below. In WordPress go to **Plugins → Add New → Upload Plugin**, upload the zip and activate it. Then open **Visitor Guard → Settings**:

- If the site is behind Cloudflare, tick **This site is behind Cloudflare** so the real visitor IP and country are recorded.
- Under **Ad elements**, list the CSS selectors of your ad units, or wrap ad code in `[vsen_ad label="sidebar"]…[/vsen_ad]`.

Requires PHP 7.4 or newer. The plugin header asks for WordPress 6.0 or newer; the automated tests ran on the current WordPress release with MySQL 8.

## What's new in 1.2.0

Fixes:

- **Email alerts missed late fraud.** A paid visit that no browser confirms gets its final score 15 minutes later. If a newer click had been emailed in the meantime, the older one was never reported. Each click is now reported once, whenever it turns fraudulent.
- **Reviewed clicks held up the hourly job.** A click you marked valid or fraudulent before its final score came back for scoring every hour. Enough of them stopped newer clicks from being scored.
- **False "same ad clicked again".** Ad clicks that belonged to no visitor were treated as one person, so clicks from different IPs on the same ad raised each other's score.
- **Cached pages without ads.** A page built for a blocked visitor has the ads taken out. A page cache could store that page and serve it to everyone. These pages are now marked as not cacheable.
- **Bots could pass as active.** After the page layout changes, browsers send a mouse move for a pointer that has not moved. The tracker counted it as activity, so a client with no pointer could escape the "no activity before the click" rule. A move now counts only when the pointer changes position.
- **Prefetched pages counted as bots.** A page the browser fetches ahead of time, or for a link preview, was recorded as an ad visit that never ran the page. These requests are no longer counted, and the tracker waits until a prerendered page is shown.

Improvements:

- The tracker stops reporting as soon as a visitor withdraws consent.
- The hourly job scores a backlog in batches instead of stopping at 500 clicks.
- CSV exports are written in parts, so large tables do not need to fit in memory. No notices on PHP 8.4.
- A visitor over the rate limit costs one database read per request and no writes.
- An alert email that ends with "and more" is not followed by further emails about the same clicks.

Updating from 1.1.0: upload `zenzeiten-visitor-guard-1.2.0.zip` under **Plugins → Add New → Upload Plugin** and choose **Replace current with uploaded**. The plugin adds one column to its clicks table on the next page load. Settings and data stay.

### Switching from Visitor Sentinel 1.0.0

Since 1.1.0 the plugin is called ZenZeiTen Visitor Guard and lives in the folder `zenzeiten-visitor-guard`, because an unrelated WordPress.org plugin uses the old name and folder.

1. In **Visitor Sentinel → Settings**, make sure **Delete all tables and settings when the plugin is deleted** is not ticked. It is off unless you turned it on.
2. Upload `zenzeiten-visitor-guard-1.2.0.zip` and activate it. Until the old plugin is gone, it shows a notice and leaves the work to the old one.
3. Deactivate and delete **Visitor Sentinel**.

Your settings, recorded visitors, clicks and blocklist carry over. Do not accept the "update" to Visitor Sentinel 3.0.3. If you already did, deactivate and delete that plugin, then install this zip.

## What it does

- **IP address tracking.** Records IP, browser, operating system and device for each visitor, plus country when the site is behind Cloudflare or a geolocation service is hooked in. Reads the real client address behind Cloudflare and other proxies, believing forwarded-for headers only from proxies you trust. IPs can be stored in full, masked or not at all.
- **Page activity tracking.** Records pageviews, sessions, referrers, UTM campaigns, time on page, scroll depth, interactions, outbound links, downloads and custom events. Includes a live "who is on the site now" panel and an activity timeline for each visitor. Works with page caching.
- **Fraudulent click detection.** Scores every paid ad visit (Google, Microsoft, TikTok, LinkedIn and others) and every click on an ad on your pages from 0 to 100, using 16 rules: bots and automated browsers, clicks made by script, visits that never ran the page, a reused ad click ID, too many clicks from one IP, repeat clicks, clicks too soon after loading, and visitors who leave at once. Clicks inside ad iframes such as AdSense are detected too.
- **Protection.** Blocks IPs automatically at a score you choose, with an expiry. Blocked IPs are only recorded, shown your site without ads (the default), or refused the site. Administrators, the login page and search or ad crawlers are never blocked automatically.
- **Reports.** A dashboard, a fraud review list and CSV exports. The blocklist exports in Google Ads "IP exclusions" format. An hourly email reports new fraudulent clicks.
- **Privacy.** Honors Do Not Track and Global Privacy Control, can wait for consent through the WP Consent API, sets no cookies, deletes old data automatically and adds suggested privacy policy text.

## Limits

- No plugin can stop an ad network from charging for a click that already happened. Visitor Guard finds the click, hides ads from its source, and gives you evidence plus an IP exclusion list.
- Clicks inside third-party ad iframes cannot be seen directly. They are inferred when the page loses focus while the pointer is over the ad, which can miss or double-count in rare cases.
- The check for visits that never ran the page needs the uncached page. Most page caches skip URLs carrying ad click IDs, but check yours.

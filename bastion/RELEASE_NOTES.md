ZenZeiTen Bastion 1.1.0 checks that crawlers and AI agents are who they say they are, and blocks scanners that probe slowly over a day.

**What is new**

- **Crawler and AI agent checks.** Search crawlers and AI agents say who they are, and anyone can copy that. When a visitor claims to be Googlebot, Bingbot, GPTBot, ClaudeBot, PerplexityBot or another known agent, Bastion now checks its address against the list the crawler's owner publishes. A false claim is recorded as a "Spoofed agent". This starts in **Log only** mode: it records and scores, and refuses nobody.
- **Slow scanners are blocked.** Until now an address was blocked at 20 points within 60 minutes. A scanner that probed once every few hours never got there. A second window now blocks at 20 points within 24 hours, counting only high and critical attacks. Failed logins are not counted in it, so mistyping a password many times in one day never causes a block.
- **Two optional traps.** A link people never see, to an address that robots.txt forbids, and a fake key in the page source. Anything that opens the link or uses the key is scored as a critical attack. The traps are off until you tick them.
- **New commands:** `wp bastion agents status`, `refresh`, `check` and `traps`.

**What is fixed**

- Probes for `/.git` without a slash at the end are now caught, as are `/.svn` and `/.hg`.
- Real crawlers no longer count as a "404 flood" when they follow old links, and are spared the rate limit. A crawl ceiling (120 requests per minute) covers them instead.
- If your site is behind Cloudflare but "This site is behind Cloudflare" is not ticked, Bastion sees Cloudflare's address in place of each visitor's. An automatic block of such an address now lasts one hour at most, and a notice in wp-admin asks you to check the setting.

**Update**

1. Download `zenzeiten-bastion-1.1.0.zip` below.
2. In WordPress, go to **Plugins > Add New > Upload Plugin**, choose the zip, click **Install Now**, then choose **Replace current with uploaded**.
3. If you use a page-cache plugin (Jetpack Boost, WP Rocket, LiteSpeed Cache, or the page cache in an SEO or speed suite), clear its cache.
4. Open your site in a private window and on your phone, where you are not logged in, and check that it shows normally.
5. Open **Bastion > Settings**. Check that "Your address as Bastion sees it" is your own address. If your site is behind Cloudflare, tick "This site is behind Cloudflare" and save.
6. In the new **Agents** section, the table of address lists fills in by itself within a few minutes. Click **Refresh lists now** if you do not want to wait.

Your settings, log, blocks and backups are kept. The database tables do not change.

**After one week**

Open **Bastion > Attack log** and filter by "Spoofed agent". If no real Googlebot, Bingbot or ClaudeBot address appears there, set **Bastion > Settings > Agents > Mode** to **Protect**. From then on, visitors that falsely claim to be a known crawler are refused.

**Good to know**

- Once a day the plugin downloads the public address lists of Google, Microsoft, OpenAI, Anthropic and Perplexity. It sends nothing about your site or your visitors. Setting the Agents mode to Off stops the downloads.
- In Log only mode, events still add to an address's threat score, so an address that keeps offending is blocked automatically, as with the firewall's Log only mode.
- If you see a yellow "ZenZeiTen Bastion skipped a security check" notice in wp-admin, copy its details and send them to the developer.

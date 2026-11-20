ZenZeiTen Bastion 1.2.0 makes the live feed easier to read: it shows who each address belongs to, and it says plainly what Bastion did about each event.

**What is new**

- **Network owner and country.** Under each address in the live feed you now see who it belongs to, for example "TELKOMNET-AS-AP PT Telekomunikasi Indonesia · Indonesia". It appears a few seconds after the row does.
- **An Action column.** It says what Bastion did: **Blocked** (the request was refused or the address was blocked), **Allow** (a successful administrator login) or **Logged** (the event was only recorded). The attack log uses the same words.
- **Clearer link.** The link next to an address used to read "Block", which looked as if the visitor had been blocked. It now reads **Block this IP** and still opens the form to block that address. Your own address is marked "(your address)" and has no block link.
- **New command:** `wp bastion network <address>` shows an address's owner and country.

**Update**

1. Download `zenzeiten-bastion-1.2.0.zip` below.
2. In WordPress, go to **Plugins > Add New > Upload Plugin**, choose the zip, click **Install Now**, then choose **Replace current with uploaded**.
3. If you use a page-cache plugin (Jetpack Boost, WP Rocket, LiteSpeed Cache, or the page cache in an SEO or speed suite), clear its cache.
4. Open your site in a private window and on your phone, where you are not logged in, and check that it shows normally.
5. Open **Bastion > Live monitor**. If the feed looks unchanged, reload the page once with Ctrl+F5 so your browser loads the new script.

Your settings, log, blocks and backups are kept. The database tables do not change.

**Good to know**

- To find an owner, Bastion sends the address, and nothing else, to Team Cymru's IP-to-network service through your server's DNS. If that gives nothing, it asks the address registries through rdap.org. This happens only while you have the live monitor open, never while a visitor waits. Answers are kept for 30 days.
- To switch the lookups off, untick **Show who each address belongs to in the live feed** in **Bastion > Settings > Live monitor**.
- The country is where the network is registered. It is usually, but not always, where the visitor is.
- Some servers cannot make DNS lookups, and some addresses have no public record. Those rows show no owner.
- If you see a yellow "ZenZeiTen Bastion skipped a security check" notice in wp-admin, copy its details and send them to the developer.

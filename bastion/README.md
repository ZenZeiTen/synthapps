# ZenZeiTen Bastion

A WordPress security plugin: a firewall, real-time attack monitoring, automatic detection and blocking of attacking IP addresses, identity checks for crawlers and AI agents, login protection, and automatic database backups with verified restore and automatic rollback.

The plugin is in [`zenzeiten-bastion/`](zenzeiten-bastion/). Its [`readme.txt`](zenzeiten-bastion/readme.txt) lists every feature and answers common questions for site owners.

## How it works

| Part | File | What it does |
|---|---|---|
| Guard | `includes/class-guard.php` | Runs first on every request: refuses blocked addresses, judges agents, applies the rate limit, runs the firewall, adds up threat scores and blocks addresses that cross a threshold. Two score windows: 60 minutes over all events, and 24 hours over high and critical events only. |
| Agents | `includes/class-agents.php` | A registry of known crawlers and AI agents. A request that names one is checked against the vendor's published address list and gets a verdict: verified, spoofed or unknown. Spoofed agents, misbehaving verified agents and trap hits are reported through `Guard::report()`. The lists are fetched by a daily cron job (`zbst_agents_refresh`) into the option `zbst_agent_lists`; a list older than 3 days gives unknown, never spoofed. |
| Firewall | `includes/class-firewall.php` | 18 signature rules over the URL, query, form and JSON fields, cookies, user agent and upload names, with URL-decoded, comment-stripped and entity-decoded variants. `inspect()` is pure and unit tested. |
| Blocklist | `includes/class-blocklist.php` | Automatic and manual blocks with escalation (1 h, 1 day, 1 week, 30 days). A compact index in an autoloaded option makes the per-request check free of database queries. |
| Hardening | `includes/class-hardening.php` | Login lockout, generic login errors, user enumeration, XML-RPC, 404 floods and the rate limit. Verified agents are spared the last two. |
| Backup | `includes/class-backup.php` | Pure-PHP SQL dumps, one statement per line and gzip-compressed. Text that is not printable ASCII is written as a hex literal, which restores the exact bytes on any connection character set. Restores are verified (SHA-256, header and end marker), preceded by a safety backup, and rolled back automatically on failure. |
| Live monitor | `includes/admin/class-admin.php`, `assets/js/admin.js` | A REST route returns events newer than the last one the browser has; the dashboard polls it every 4 seconds and renders rows as text. |
| WP-CLI | `includes/class-cli.php` | `wp bastion status|backup|backups|verify|restore|block|unblock|blocks`, and `wp bastion agents status|refresh|check|traps`. |

Prefix `zbst_` (options, tables, cron hooks, admin pages), namespace `ZenZeiTenBastion`, REST namespace `zenzeiten-bastion/v1`. Access to every screen and action is controlled by the `zbst_capability` filter (default `manage_options`). The plugin header has `Update URI: false` and the plugin removes any WordPress.org update offer for its folder, so a same-named plugin elsewhere can never replace it.

### Agent verdicts and events

| Verdict | Condition |
|---|---|
| none | The user-agent names no agent in the registry. |
| verified | It names one, and the address is in that agent's list, fetched in the last 3 days. |
| spoofed | It names one, the list is fresh, and the address is not in it. |
| unknown | The list is missing or stale, or the vendor publishes none. Never scored. |

| Event | When | Severity | Points |
|---|---|---|---|
| `agent_spoof` | Verdict spoofed; one row per address per 10 minutes | High | 5 |
| `agent_abuse` | A verified agent POSTs to `wp-login.php` or `xmlrpc.php`, opens `wp-admin`, or passes the crawl ceiling | Medium | 3 |
| `agent_trap` | The trap URL is opened or the fake key is used | Critical | 10 |
| `agent_trap` | The same, by a fetcher acting for a person (ChatGPT-User, Perplexity-User, Google's user-triggered fetchers and Google-Agent) | Info | 0 |
| `agent_list` | A list could not be refreshed; the previous copy is kept | Info | 0 |

Rules the code keeps:

- `Agents::check()` runs on `plugins_loaded`, so it never translates and never asks WordPress for the current user.
- A request that also breaks a firewall rule is logged by the firewall only, so one request never scores twice.
- A verified agent is never refused `robots.txt`, even from a blocked address or over the ceiling.
- Logged-in users, allowlisted addresses and the addresses administrators sign in from are skipped.
- A request with `Sec-Purpose: prefetch` or `Purpose: prefetch` is never scored by a trap.
- The module ships in Log-only mode (`agent_mode` = `log`). Web Bot Auth signatures and reverse-DNS checks are not implemented.

## What it does not do

Be clear about this with site owners. Compared with commercial security suites, Bastion has:

- **No threat-intelligence feed.** It blocks addresses based on what they do on your site, not on attacks seen across other sites.
- **No malware or file-change scanner,** and no country blocking.
- **No pre-WordPress firewall.** The firewall runs as early as a regular plugin can, after WordPress loads its plugins. It does not install an `auto_prepend_file`.
- **Database only.** Backups cover the database, not uploads, themes or plugins.
- **No CAPTCHA or two-factor login.**

## Tests

```bash
php tests/run.php                  # unit, integration and view tests on a stub WordPress with SQLite
node tests/e2e/browser.test.cjs    # Chromium against the real dashboard, admin.js and Guard
bash tests/wordpress-smoke.sh      # real WordPress + MySQL (needs a MySQL server; runs in CI)
python3 scripts/make-pot.py        # regenerate languages/zenzeiten-bastion.pot
```

The smoke test covers the firewall, automatic blocking, agent identity in Protect mode and the traps, login lockout, enumeration, the live endpoint, every admin screen and a backup-and-restore round trip with awkward data (quotes, backslashes, newlines, emoji, serialized arrays) through both WP-CLI and the admin screens. CI (`.github/workflows/bastion.yml`) runs all of these, lints and tests on PHP 7.4 to 8.4, checks the slug is still free on WordPress.org, and builds the zip.

## Release

Change the version in the plugin header, `ZBST_VERSION`, `Stable tag` in `readme.txt`, the changelog and `RELEASE_NOTES.md` together, then run `python3 scripts/make-pot.py`. Then run the workflow with "Publish a release" ticked on `main`, or push a tag `bastion-v<version>`.

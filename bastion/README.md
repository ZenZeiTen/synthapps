# ZenZeiTen Bastion

A WordPress security plugin: a firewall, real-time attack monitoring, automatic detection and blocking of attacking IP addresses, login protection, and automatic database backups with verified restore and automatic rollback.

The plugin is in [`zenzeiten-bastion/`](zenzeiten-bastion/). Its [`readme.txt`](zenzeiten-bastion/readme.txt) lists every feature and answers common questions for site owners.

## How it works

| Part | File | What it does |
|---|---|---|
| Guard | `includes/class-guard.php` | Runs first on every request: refuses blocked addresses, applies the rate limit, runs the firewall, adds up threat scores and blocks addresses that cross the threshold. |
| Firewall | `includes/class-firewall.php` | 18 signature rules over the URL, query, form and JSON fields, cookies, user agent and upload names, with URL-decoded, comment-stripped and entity-decoded variants. `inspect()` is pure and unit tested. |
| Blocklist | `includes/class-blocklist.php` | Automatic and manual blocks with escalation (1 h, 1 day, 1 week, 30 days). A compact index in an autoloaded option makes the per-request check free of database queries. |
| Hardening | `includes/class-hardening.php` | Login lockout, generic login errors, user enumeration, XML-RPC, 404 floods and the rate limit. |
| Backup | `includes/class-backup.php` | Pure-PHP SQL dumps, one statement per line and gzip-compressed. Text that is not printable ASCII is written as a hex literal, which restores the exact bytes on any connection character set. Restores are verified (SHA-256, header and end marker), preceded by a safety backup, and rolled back automatically on failure. |
| Live monitor | `includes/admin/class-admin.php`, `assets/js/admin.js` | A REST route returns events newer than the last one the browser has; the dashboard polls it every 4 seconds and renders rows as text. |
| WP-CLI | `includes/class-cli.php` | `wp bastion status|backup|backups|verify|restore|block|unblock|blocks`. |

Prefix `zbst_` (options, tables, cron hooks, admin pages), namespace `ZenZeiTenBastion`, REST namespace `zenzeiten-bastion/v1`. Access to every screen and action is controlled by the `zbst_capability` filter (default `manage_options`). The plugin header has `Update URI: false` and the plugin removes any WordPress.org update offer for its folder, so a same-named plugin elsewhere can never replace it.

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

The smoke test covers the firewall, automatic blocking, login lockout, enumeration, the live endpoint, every admin screen and a backup-and-restore round trip with awkward data (quotes, backslashes, newlines, emoji, serialized arrays) through both WP-CLI and the admin screens. CI (`.github/workflows/bastion.yml`) runs all of these, lints on PHP 7.4 to 8.3, checks the slug is still free on WordPress.org, and builds the zip.

## Release

Change the version in the plugin header, `ZBST_VERSION`, `Stable tag` in `readme.txt`, the changelog and `RELEASE_NOTES.md` together. Then run the workflow with "Publish a release" ticked on `main`, or push a tag `bastion-v<version>`.

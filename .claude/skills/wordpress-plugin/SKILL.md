---
name: wordpress-plugin
description: "Build, test, release and support a WordPress plugin: naming and slug checks, structure, code that runs on every request, security, a SQLite test harness, a real WordPress smoke test in CI, release zips, upgrades and renames, and diagnosing user reports such as a blank site. Use when creating or changing a WordPress plugin, publishing a plugin zip, or answering a user's plugin error."
---

# WordPress plugins

Lessons from building Visitor Sentinel (now ZenZeiTen Visitor Guard), ContextChat and ZenZeiTen Bastion in the GitHub repository `ZenZeiTen/synthapps`. File paths below are in that repository.

- The Visitor Guard code (`visitor-sentinel/`) is the worked example for most sections.
- Bastion (`bastion/`) is the worked example for code that runs on every request (section 3a), tests that the site still renders, and the blank-site diagnosis in section 6.

Read the matching file before you write your own version. Without access to the repository, follow the rules as written.

## 1. Pick a name that cannot collide (do this first)

WordPress pairs update offers with plugins by **folder name** (the slug). If WordPress.org hosts a plugin with the same slug, every site running yours is offered that plugin as an "update", and accepting it replaces yours. Visitor Sentinel 1.0.0 hit exactly this: an unrelated `visitor-sentinel` 3.0.3 on WordPress.org replaced it on a live site, and its own admin pages (`visise-*`) then confused everyone.

- Before naming, check that the slug is free: `https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&request[slug]=<slug>` should return an error. If this environment cannot reach api.wordpress.org, say so and check in CI.
- Prefer a distinctive, prefixed slug, such as `zenzeiten-visitor-guard` rather than `visitor-guard`. The folder, main file and text domain all use the slug.
- Every plugin that is not hosted on WordPress.org gets `Update URI: false` in its header, plus a `site_transient_update_plugins` filter that removes any offer for its own basename. The filter also clears an offer the site has already cached. Example: `drop_wporg_update()` in `visitor-sentinel/zenzeiten-visitor-guard/includes/class-plugin.php`.
- Renaming after release costs a migration (section 7), so get the name right the first time.

## 2. Structure

Follow `visitor-sentinel/zenzeiten-visitor-guard/`:

- **Main file:** a header with `Requires at least`, `Requires PHP`, `Update URI` and `Text Domain`. It defines constants, requires the classes and calls `Plugin::instance()->boot()`. It does nothing else at load time.
- **One prefix for everything:** constants, options, tables, cron hooks, admin page slugs, CSS and JS handles (`vsen_`, `vsen-`), plus a PHP namespace.
- **Capability through a filter** (`vsen_capability`, default `manage_options`), so site owners can widen access without editing code.
- **Uninstall keeps data** unless the user ticks an explicit "delete on uninstall" setting. A user deleting a plugin to reinstall it must not lose their data.
- **Cron:** schedule on activation, clear on deactivation, and re-check on `init`. The `init` check covers sites where activation never ran for this copy.
- **Database:** use `dbDelta` with a stored schema version, and run `maybe_upgrade` on `plugins_loaded`.

## 3. Security and robustness

- Public REST endpoints used by front-end JavaScript must work behind full-page caches, so they cannot rely on nonces. Protect them instead with:
  - an HMAC token issued per page
  - a check that URLs belong to this site's host
  - payload size limits
  - per-IP rate limits
- Client IP: only believe forwarded-for headers from proxies you trust. Walk the header right to left. Cloudflare ranges can be built in, behind a setting.
- Sanitize every setting on save and clamp numbers to their range. Drop CSS selectors that could break out of a `<style>` block.
- CSV exports: prefix cells that start with `= + - @` with a quote, except plain negative numbers.
- Never trust that admin screens are only reached through the menu. Check capabilities in each handler.

## 3a. Code that runs on every request

A plugin that hooks `plugins_loaded` (a firewall, a block check, a rate limit) runs before other plugins have finished loading. Bastion 1.0.0 broke on three counts here. Follow `bastion/zenzeiten-bastion/includes/class-guard.php`:

- **Don't settle the current user early.** `current_user_can()`, `is_user_logged_in()` and `wp_get_current_user()` on `plugins_loaded` fix the user for the whole request before other plugins hook into that decision. Page caches, Jetpack and membership plugins rely on it. Read the cookie instead: `wp_validate_auth_cookie( '', 'logged_in' )`, then `user_can( $id, $cap )`. See `Guard::cookie_user_id()`.
- **Don't translate before `after_setup_theme`.** From WordPress 6.7, `__()` and its variants log a notice on every request when called that early. On the early path:
  - Store and show plain English.
  - Translate labels only on admin screens (`Firewall::labels()`).
  - Hand emails that need translations to a one-off cron event (`Alerts::queue_block()`).
- **Fail open.** Wrap every hook that runs for visitors so an `Error` inside it is caught and the check skipped, while the page carries on (`Guard::wrap()`). Record the error once a minute in an option and the PHP error log, and show it to administrators in a wp-admin notice with a "clear" button. Catch `\Error`, not `\Throwable`, if the tests stop requests by throwing an exception.
- **Log every refusal.** Anything that blocks or redirects a request writes a log entry. Then "the log is empty" rules the plugin's blocking out during a diagnosis.

## 4. Tests: three layers, all in CI

1. **Unit and integration tests on a stub WordPress with a SQLite `$wpdb`** (`visitor-sentinel/tests/bootstrap.php`, `run.php`).
   - Write every query so it runs on both MySQL and SQLite.
   - Turn PHP warnings and notices into failures.
   - Hook lists reset between tests, so a test that needs hooks calls `Plugin::instance()->boot()` or `register()` itself.
   - Prove each new test fails without the fix, for example by checking out the old file and running `php tests/run.php <name>`.
   - Guard the rules in section 3a with stubs. Count calls to `current_user_can()`, `is_user_logged_in()` and `wp_get_current_user()`, and fail if the early path makes any. Make the translation stubs throw while a test flag says the code is running early (`bastion/tests/bootstrap.php`).
2. **Browser end to end with Playwright** against the real PHP endpoint (`tests/e2e/`). Chromium is preinstalled here; never run `playwright install` locally.
3. **Real WordPress and MySQL smoke test with WP-CLI** (`tests/wordpress-smoke.sh`), run in GitHub Actions with a MySQL service. Downloading WordPress or WP-CLI is blocked in this cloud environment, so this layer runs only in CI. In the script:
   - Get auth cookies from `wp eval` with `wp_generate_auth_cookie`. Do not post the login form.
   - With `set -o pipefail`, `curl | grep -q` fails falsely. Read the page into a variable and grep a here-string (the `contains()` helper).
   - Load every admin screen and assert on a marker in the page, then grep `debug.log` for the plugin's name.
   - **Check that the public site renders, not just its status code.** A blank page with status 200 passes a status check, which is how Bastion 1.0.0 shipped.
     - Load the home page as a visitor, an administrator, a visitor on IPv6, and a visitor with typical analytics and consent cookies.
     - Require `<title>` and `</html>` in each response.
     - Repeat with the repository's other plugins and theme active, since site owners run them together. See the `front_ok` helper in `bastion/tests/wordpress-smoke.sh`.
   - Read a REST nonce from the plugin's own localized settings line (`grep 'var <object>'`). WordPress prints other nonces on the page, such as the heartbeat nonce.
   - Run curl with `-g` for any URL that contains `[` or `]`, such as the WordPress.org API. Without it, curl treats them as a glob range and fails before sending the request.
   - Assert that `wp plugin list --name=<slug> --field=update` is `none`.
   - Test the user's real upgrade path, not just a fresh install: install the old version or folder, switch, and check that data and cron survive.
4. Lint every PHP file on each PHP version you support. The CI matrix is 7.4 to 8.4. Run the smoke test on the newest PHP that sites use (8.4), not an older one.

Running a downloaded WordPress in this environment is refused by its safety check, even when cloned from GitHub. Reproduce real-WordPress problems in CI instead.

## 5. Release

- When bumping the version, change all of these together, then grep for the old version: the `Version:` header, the version constant, `Stable tag` in `readme.txt`, the changelog, and the release notes.
- If CI checks the translation template, regenerate it after the last code edit. Its line references go stale when any line moves.
- The zip's top folder must equal the slug. CI checks this with `unzip -l ... | grep ' <slug>/<slug>.php$'`.
- The release workflow (`.github/workflows/visitor-sentinel.yml`) works two ways. The **Run workflow** button with "Publish a release" ticked on main tests, builds and publishes. Pushing a tag does the same, and the job refuses a tag that does not match the version.
- Release notes must give upgrade steps a non-developer can follow: upload the zip, choose **Replace current with uploaded**, and note what happens to their data. Also tell them to clear any page cache and then check the site in a private window.
- After a pull request merges, GitHub deletes its branch. Start follow-up work from `main` on the same branch name and push it as a new branch: `git fetch --prune` first, or the push fails with "stale info".
- Merge and publish only after CI is green on the final commit, and only with the user's go-ahead for this specific release.

## 6. Diagnosing a user's report

Users send screenshots, often in Indonesian. Read every detail before answering:

- Check the plugin **version, author and description** on the Plugins page. A different version or author means it is a different plugin, even when the name is the same.
- Check the admin page slug in the URL. If it isn't one of ours, the code isn't ours.
- Messages:
  - "Maaf, Anda tak diizinkan mengakses laman ini" ("Sorry, you are not allowed to access this page") means WordPress does not know that page slug, or the user lacks the capability.
  - "Tersedia versi baru … perbarui sekarang" ("A new version is available … update now") for one of our plugins means a WordPress.org slug collision (section 1). Tell the user **not** to update.
- Do not trust version numbers the user types ("WordPress 7.14") without a screenshot. Say what you can and cannot verify.
- You cannot reach the user's site from this environment. Ask for the exact error text or `wp-content/debug.log` after setting `WP_DEBUG`, `WP_DEBUG_LOG` and `WP_DEBUG_DISPLAY false`.
- On the Plugins page, "Nonaktifkan" (Deactivate) under a plugin means it is **active**. Scan the list for page caches: Jetpack Boost, WP Rocket, LiteSpeed Cache, W3 Total Cache, and SEO or speed suites with a "page cache" feature.

### The site is blank or down after installing the plugin

This happened with Bastion on a live site. It took three releases to find that the visitors' blank page came from **another plugin's page cache**: the ZenZeiTen SEO Suite (Site Doctor) was serving a stale copy. Work in this order and ask one thing at a time:

1. **Get the site back first.** Have the user deactivate the plugin, or rename its folder in the hosting File Manager. Nothing is lost.
2. **Who sees it?** Logged-out visitors only, or everyone? Logged-out only points at a page cache, or at code that skips administrators.
3. **What exactly do they see?**
   - A blank white page.
   - The plugin's own "Access denied" page.
   - WordPress's "There has been a critical error".
4. **If only logged-out visitors see a blank page, suspect a page cache before writing any code.** Have the user turn the plugin back on, clear every page cache, and reload in a private window. Many cache plugins clear themselves when another plugin is deactivated, which is why switching yours off appears to fix it.
5. **Evidence that needs no developer tools:**
   - The plugin's own log of refused requests.
   - An outside status check of the home page, such as httpstatus.io. `200` means the server is answering, so the page is not blocked.
   - **Ctrl+U** on the blank page: empty source, or full HTML that is not showing?
6. **If CI cannot reproduce the problem,** the cause is on the user's site. Call any change you ship "hardening" and say the cause is unconfirmed; do not present a guess as the fix. Ask before releasing again.

## 7. Renaming a released plugin

Keep internal names (namespace, option and table prefix, REST route, public JS API) so data carries over without migration. Change the folder, main file, display name and text domain. Then:

- If an old copy is active, the new main file must return early. Otherwise both copies define the same classes and the site hits a fatal error. While waiting, it shows an admin notice asking for the old copy to be deactivated and deleted.
- Removing the old copy runs its deactivation hook, which clears shared cron events. The new copy must reschedule them on `init`.
- Tell users to make sure "delete data on uninstall" is off **before** they delete the old copy.
- In CI, simulate the old copy by copying the plugin into the old folder with the old main-file name.

## 8. Working style that paid off

- Build the zip and send it to the user as soon as a fix exists. Then open the draft pull request, watch CI, and merge or release only when the user agrees.
- When the user proposes a fix (for example "change the name"), explain what it does and does not solve. If there is a real choice between options, ask once with options and a recommendation.
- Users often answer only one of several questions. Lead with the single cheapest test that splits the likely causes, and keep each request to a few short steps.
- When the trouble is in another plugin that is not in this repository, say so. Explain what that plugin should change, and ask for access to its repository rather than working around it in yours.

## 9. Security and backup plugins

Follow `bastion/zenzeiten-bastion/`:

- **Database dumps are portable and byte-exact.** Write one statement per line. Quote plain printable ASCII as `'..'`, and write everything else as a hex literal `X'..'` (`Backup::literal()`).
- **Verify before restoring:** the SHA-256 checksum, the header line and the end marker.
- **Restores need a safety net:**
  - Take a safety backup first, and restore it automatically if any statement fails.
  - Don't let the safety backup's pruning delete the backup being restored.
  - Keep any option that locates the backups (such as a folder key) across the restore.
- **Store backups privately.** Use a randomly named folder under uploads, with `.htaccess`, `index.php` and `web.config` guards. Nginx ignores those files, so the random name is what protects it there.
- **Never block your own way in.** Exempt the loopback address and an allowlist from blocking. Spare addresses administrators signed in from. Refuse a manual block that covers the administrator's own address.
- **Add WP-CLI commands for recovery,** such as `wp <prefix> restore latest --yes` and `unblock`. They still work when the admin area is broken.
- **Tell users what the plugin does not do.** Bastion has no threat-intelligence feed, no malware scanner, no firewall that runs before WordPress, and backs up the database only.

---
name: wordpress-plugin
description: "Build, test, release and support a WordPress plugin in this repository: naming and slug checks, structure, security, a SQLite test harness, a real WordPress smoke test in CI, release zips, upgrades and renames, and diagnosing user reports. Use when creating or changing a WordPress plugin, publishing a plugin zip, or answering a user's plugin error."
---

# WordPress plugins

Lessons from building Visitor Sentinel, now ZenZeiTen Visitor Guard (`visitor-sentinel/`), and ContextChat (`contextchat/`). The Visitor Guard code is the worked example for every section below. Read the matching file before you write your own version.

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

## 4. Tests: three layers, all in CI

1. **Unit and integration tests on a stub WordPress with a SQLite `$wpdb`** (`visitor-sentinel/tests/bootstrap.php`, `run.php`).
   - Write every query so it runs on both MySQL and SQLite.
   - Turn PHP warnings and notices into failures.
   - Hook lists reset between tests, so a test that needs hooks calls `Plugin::instance()->boot()` or `register()` itself.
   - Prove each new test fails without the fix, for example by checking out the old file and running `php tests/run.php <name>`.
2. **Browser end to end with Playwright** against the real PHP endpoint (`tests/e2e/`). Chromium is preinstalled here; never run `playwright install` locally.
3. **Real WordPress and MySQL smoke test with WP-CLI** (`tests/wordpress-smoke.sh`), run in GitHub Actions with a MySQL service. Downloading WordPress or WP-CLI is blocked in this cloud environment, so this layer runs only in CI. In the script:
   - Get auth cookies from `wp eval` with `wp_generate_auth_cookie`. Do not post the login form.
   - With `set -o pipefail`, `curl | grep -q` fails falsely. Read the page into a variable and grep a here-string (the `contains()` helper).
   - Load every admin screen and assert on a marker in the page, then grep `debug.log` for the plugin's name.
   - Assert that `wp plugin list --name=<slug> --field=update` is `none`.
   - Test the user's real upgrade path, not just a fresh install: install the old version or folder, switch, and check that data and cron survive.
4. Lint every PHP file on each PHP version you support (CI matrix 7.4 to 8.3).

## 5. Release

- When bumping the version, change all of these together, then grep for the old version: the `Version:` header, the version constant, `Stable tag` in `readme.txt`, the changelog, and the release notes.
- The zip's top folder must equal the slug. CI checks this with `unzip -l ... | grep ' <slug>/<slug>.php$'`.
- The release workflow (`.github/workflows/visitor-sentinel.yml`) works two ways. The **Run workflow** button with "Publish a release" ticked on main tests, builds and publishes. Pushing a tag does the same, and the job refuses a tag that does not match the version.
- Release notes must give upgrade steps a non-developer can follow: upload the zip, choose **Replace current with uploaded**, and note what happens to their data.
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

## 7. Renaming a released plugin

Keep internal names (namespace, option and table prefix, REST route, public JS API) so data carries over without migration. Change the folder, main file, display name and text domain. Then:

- If an old copy is active, the new main file must return early. Otherwise both copies define the same classes and the site hits a fatal error. While waiting, it shows an admin notice asking for the old copy to be deactivated and deleted.
- Removing the old copy runs its deactivation hook, which clears shared cron events. The new copy must reschedule them on `init`.
- Tell users to make sure "delete data on uninstall" is off **before** they delete the old copy.
- In CI, simulate the old copy by copying the plugin into the old folder with the old main-file name.

## 8. Working style that paid off

- Build the zip and send it to the user as soon as a fix exists. Then open the draft pull request, watch CI, and merge or release only when the user agrees.
- When the user proposes a fix (for example "change the name"), explain what it does and does not solve. If there is a real choice between options, ask once with options and a recommendation.

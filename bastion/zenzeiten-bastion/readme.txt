=== ZenZeiTen Bastion ===
Contributors: zenzeiten
Tags: security, firewall, brute force, ip blocking, backup
Requires at least: 6.0
Requires PHP: 7.4
Stable tag: 1.0.2
License: MIT
License URI: https://opensource.org/licenses/MIT

Website security: a firewall, real-time attack monitoring, automatic IP blocking, login protection and automatic database backups with one-click restore.

== Description ==

= Firewall =

Every request from a visitor is checked against 18 attack signatures before your site does any work: SQL injection, cross-site scripting, path traversal and system file access, PHP stream wrappers, command injection, PHP code and object injection, template and JNDI (Log4Shell-style) injection, null bytes, script file uploads, probes for files such as .env, .git and database dumps, and known attack tools such as sqlmap, Nikto and WPScan.

* Query strings, form fields, JSON bodies, cookies, user agents and upload file names are inspected, including double-encoded and comment-obfuscated forms.
* Three modes: Protect (block), Log only (record without blocking, useful for the first days), and Off.
* Each rule can be switched off on its own if it ever blocks something legitimate.
* Administrators and editors, who may post any HTML, are never inspected.

= Real-time attack monitoring =

* A live attack feed in the dashboard that updates every few seconds without reloading the page.
* Attacks per hour for the last 24 hours, headline counters, and the top attacking IP addresses.
* A searchable attack log with filters by event type, severity and IP address.
* Email alerts when addresses are blocked (batched, at most one email every 15 minutes), when a new administrator account appears, and when a backup or restore fails.

= Automatic IP detection and blocking =

* Every attack adds to the attacking address's threat score (critical 10, high 5, medium 3, failed login 2). When the score reaches the threshold (20 points in 60 minutes by default), the address is blocked automatically.
* Repeat offenders are blocked for longer: 1 hour, then 1 day, 1 week and 30 days.
* Brute-force protection: 5 failed logins in 15 minutes locks the address out for 60 minutes (all adjustable). XML-RPC password logins and system.multicall are refused by default.
* 404 floods (scanners guessing file names) and, optionally, too many requests per minute count as attacks.
* User enumeration through ?author=N and the REST API user list is stopped, and login errors no longer reveal whether a username exists.
* Block or unblock addresses and CIDR ranges by hand, IPv4 and IPv6.
* Addresses administrators signed in from are spared from automatic blocks, and an allowlist covers offices and services you trust.
* Works behind Cloudflare and other proxies: forwarded-for headers are believed only from proxies you trust, so attackers cannot fake their address.

= Automatic database backup and recovery =

* Scheduled backups every day or every week, a backup before WordPress installs updates, and "Back up now".
* Each backup is a compressed SQL file with a SHA-256 checksum, kept in a private, randomly named folder.
* One-click restore. A safety backup of the current database is taken first, and if any part of the restore fails, the safety backup is restored automatically, so the site is never left half restored.
* Backups are checked for damage or tampering before a restore.
* Download backups, and upload one to restore it on a new server.
* WP-CLI commands restore the database even when the admin area is broken: `wp bastion restore latest --yes`.

== Installation ==

1. In WordPress, go to Plugins > Add New > Upload Plugin and upload the zenzeiten-bastion zip file.
2. Activate the plugin. The address you activate it from is protected from automatic blocks.
3. Open Bastion > Settings. If your site is behind Cloudflare, tick "This site is behind Cloudflare" and check that "Your address as Bastion sees it" shows your real address.
4. Open Bastion > Backups and click "Back up now" for a first backup.
5. If you use a page-cache plugin, clear its cache, then check the site in a private window.

== Frequently Asked Questions ==

= Visitors see a blank page after I install or update Bastion =

A page-cache plugin (Jetpack Boost, WP Rocket, LiteSpeed Cache, or the page cache in an SEO or speed suite) may still be serving a copy of the page saved before or during the change. Clear that plugin's cache, then reload the site in a private window.

= I locked myself out =

Wait for the block to expire, or sign in from another network (for example your phone's mobile data) and lift the block under Bastion > Blocked IPs. With WP-CLI: `wp bastion unblock 203.0.113.7`. As a last resort, rename the plugin's folder over FTP to deactivate it.

= Does the firewall run before WordPress? =

It runs as early as a regular plugin can: after WordPress loads its plugins and before any of them does its work. It does not need changes to php.ini or .htaccess.

= Where are backups stored? =

In wp-content/uploads/zbst-backups-<random>/. The folder has rules that deny web access on Apache, LiteSpeed and IIS; on Nginx, the random name keeps it private. Download copies regularly and store them elsewhere too, because a backup on the same server does not help if the server is lost.

= My database is large. Anything to know? =

A restore from the admin screen runs inside one web request. On hosts that stop long requests, restore large databases with WP-CLI instead (`wp bastion restore <id> --yes`), which has no time limit. Backups run in the background through WordPress cron.

= Does it back up files? =

No. It backs up the database: posts, pages, users, settings, orders and everything else WordPress stores there. Use your host's backups for uploaded files, themes and plugins.

= Does it slow my site down? =

Blocked addresses are checked from a small cached list without a database query. The firewall reads each request once with bounded-length patterns. Database writes happen only when something is logged.

= What happens to my data if I delete the plugin? =

Nothing, unless you tick "Delete the log, blocks, settings and all backups when the plugin is deleted" in Settings first.

== Changelog ==

= 1.0.2 =
* Docs: after installing or updating, clear any page cache; a stale cached page can show visitors a blank page.
* Fix: pages could show blank to visitors who were not logged in, alongside plugins that cache pages or decide who the visitor is (for example Jetpack and Jetpack Boost). The firewall now recognises logged-in editors from their login cookie instead of asking WordPress for the current user before other plugins have loaded.

= 1.0.1 =
* Fix: a security check that hits an error is now skipped and reported, instead of leaving visitors with a blank page. Administrators see the error details in a notice in wp-admin.
* Tested on PHP 8.4.

= 1.0.0 =
* First release: firewall, live attack monitor, automatic IP blocking with escalation, login protection, user enumeration and XML-RPC hardening, email alerts, administrator account watch, and database backups with verified restore and automatic rollback, plus WP-CLI commands.

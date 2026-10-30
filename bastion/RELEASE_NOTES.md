ZenZeiTen Bastion 1.0.2 fixes a problem where visitors who were not logged in could see a blank white page while the plugin was active.

**What changed**

- Bastion checked who the visitor was very early, before your other plugins had finished loading. On sites with plugins that cache pages or decide who the visitor is, such as Jetpack and Jetpack Boost, that could leave logged-out visitors with a blank page. Bastion now reads the login cookie itself and leaves that decision to WordPress.
- If one of Bastion's checks runs into an error, it now skips that check and lets the page load, instead of stopping the page. The error is shown to administrators in a yellow notice in wp-admin, with the details to send to the developer.
- Bastion is now tested on PHP 8.4, and the tests check that the public site actually shows its pages to visitors, including visitors on phones and IPv6 networks.

**Update**

1. Download `zenzeiten-bastion-1.0.2.zip` below.
2. In WordPress, go to **Plugins > Add New > Upload Plugin**, choose the zip, click **Install Now**, then choose **Replace current with uploaded**.
3. Activate the plugin.
4. If you use a page-cache plugin (Jetpack Boost, WP Rocket, LiteSpeed Cache, or the page cache in an SEO or speed suite), clear its cache. A copy of a page saved earlier can otherwise keep showing visitors a blank page.
5. Open your site in a private window or on your phone, where you are not logged in, and check that it shows normally.

Your settings, log, blocks and backups are kept.

If you see a yellow "ZenZeiTen Bastion skipped a security check" notice in wp-admin, copy its details and send them to the developer.

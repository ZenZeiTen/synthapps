ZenZeiTen Bastion 1.0.1 fixes a problem where visitors who were not logged in could see a blank white page while the plugin was active.

**What changed**

- If one of Bastion's checks runs into an error, it now skips that check and lets the page load, instead of stopping the page. The error is shown to administrators in a yellow notice in wp-admin, with the details to send to the developer.
- Bastion is now tested on PHP 8.4, and the tests check that the public site actually shows its pages to visitors, including visitors on phones and IPv6 networks.

**Update**

1. Download `zenzeiten-bastion-1.0.1.zip` below.
2. In WordPress, go to **Plugins > Add New > Upload Plugin**, choose the zip, click **Install Now**, then choose **Replace current with uploaded**.
3. Activate the plugin, then open your site in a private window or on your phone, where you are not logged in, and check that it shows normally.

Your settings, log, blocks and backups are kept.

If you see a yellow "ZenZeiTen Bastion skipped a security check" notice in wp-admin, copy its details and send them to the developer.

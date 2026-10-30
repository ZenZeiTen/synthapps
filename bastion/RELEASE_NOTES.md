ZenZeiTen Bastion 1.0.0 is the first release.

**What it does**

- **Firewall:** blocks SQL injection, cross-site scripting, path traversal, command and code injection, malicious uploads, probes for files like `.env`, and known attack tools.
- **Live attack monitor:** a dashboard feed that updates every few seconds, attacks per hour, the top attacking addresses and a searchable log.
- **Automatic IP blocking:** attacking addresses are blocked automatically, for longer each time they come back. Brute-force logins are locked out. You can block or unblock addresses and ranges yourself.
- **Database backups:** daily or weekly, before updates, and on demand. Restore takes one click; if anything goes wrong, the plugin puts the database back exactly as it was.

**Install**

1. Download `zenzeiten-bastion-1.0.0.zip` below.
2. In WordPress, go to **Plugins > Add New > Upload Plugin**, choose the zip and click **Install Now**, then **Activate**.
3. Open **Bastion > Settings**. If your site uses Cloudflare, tick **This site is behind Cloudflare**, save, and check that "Your address as Bastion sees it" shows your real address.
4. Open **Bastion > Backups** and click **Back up now**.

To update later, upload the new zip the same way and choose **Replace current with uploaded**. Your settings, log, blocks and backups are kept.

**If you lock yourself out**, wait for the block to end or sign in from another network (for example mobile data) and lift it under **Bastion > Blocked IPs**.

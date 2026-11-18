Keyhold is a password manager that encrypts everything on your device. It works offline, and can sync through a server you run.

## New in 1.2.0

- **Search filters**: `type:card`, `folder:work`, `tag:bank`, `is:favorite`, `is:expired`, `has:totp`, `"exact phrase"`, `-word`.
- **Select several items** (Ctrl+click, Shift+click, Ctrl+A) and move, tag, favorite, export or trash them together.
- **Put an earlier password back** from an item's previous values.
- **Import skips what you already have**, and Keyhold's own CSV export now imports back with cards, identities and Wi-Fi details intact.
- **Trash can empty itself** after 7, 30 or 90 days (off by default). A note at unlock tells you when change reminders are overdue.
- **Password health** also lists logins whose website address is plain `http://`.

## Fixed

- The change-reminder date moved one day earlier each time an item was edited, in time zones east of UTC.
- Ctrl+C on a selected item replaced what you had copied with the item's password.
- A sync or save in the background reset the edit form and lost what was being typed.
- The health report did not show breach-check results or changes from other devices until something else changed.
- Locking cleared the clipboard even when Keyhold had copied nothing.
- "Sign in and merge" could leave the vault half switched to the account's keys when the server failed; a failed master-password change recorded a change date anyway.
- Sync server: a sign-up interrupted half way blocked that username for ever. `keyhold serve` now finishes running requests when stopped.
- Smaller fixes: the list of previous values closing when one was revealed, success messages after a failed folder change, a sync timer added at every unlock, saves that could wait for ever when browser storage was full.

## Download

**Windows:** download `Keyhold.exe` and double-click it. No installer, no administrator rights. (`Keyhold-arm64.exe` for Windows on ARM; `keyhold.exe` is the command-line version for running a sync server.)

**Linux and macOS:** `keyhold-linux-*` and `keyhold-macos-*`, same program.

Check downloads against `SHA256SUMS.txt`. The executables are not code-signed, so Windows SmartScreen may ask you to confirm the first time.

Coming from Password Safe? Export your database as XML (File › Export To › XML format) and import it in Settings › Backup.

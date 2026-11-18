Keyhold is a password manager that encrypts everything on your device. It works offline, and can sync through a server you run.

## Fixed in 1.3.1

- **The Windows app is back.** In the 1.3.0 downloads, `Keyhold.exe` was missing and `keyhold.exe` was the command-line version, which opens a console window next to the app. 1.3.1 has both again: `Keyhold.exe` is the app, and the command-line version is now called `keyhold-cli.exe`, so the two can never be confused. Nothing else changed; vaults need no conversion.

## Keyhold on your phone (new in 1.3.0)

- **Android app** (`Keyhold-*.apk`). The vault is kept encrypted on the phone. Copied passwords are marked sensitive and cleared after use, screenshots are blocked, links open in your browser, and the back button works as you expect. It can sync with your Keyhold server.
- **Installable web app** (`keyhold-web.zip`). Put it on any HTTPS web host, or use your sync server's address, and install it from the browser. Without a server it keeps the vault in that browser, with the last 30 versions as automatic backups, and works offline.
- The sync server accepts the Android app without any setting.

Uninstalling the app or clearing the browser's data deletes a vault kept there. Keep encrypted backups (Settings › Backup) or connect a sync server.

## Download

**Android:** download `Keyhold-<version>.apk` on the phone and open it. Android asks once to allow installs from your browser or file manager.

**Windows:** download `Keyhold.exe` and double-click it. No installer, no administrator rights. (`Keyhold-arm64.exe` for Windows on ARM; `keyhold-cli.exe` is the command-line version for running a sync server.)

**Linux and macOS:** `keyhold-linux-*` and `keyhold-macos-*`, same program.

**Web app:** host the files in `keyhold-web.zip` on any HTTPS web server, open the address and choose Install app.

Check downloads against `SHA256SUMS.txt`. The executables are not code-signed, so Windows SmartScreen may ask you to confirm the first time.

Coming from Password Safe? Export your database as XML (File › Export To › XML format) and import it in Settings › Backup.

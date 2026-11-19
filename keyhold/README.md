# Keyhold

A password manager for Windows (also Linux and macOS) that keeps working offline and, if you
want, syncs through a server you control. Everything is encrypted on your device before it is
saved or sent; the file on disk and the sync server only ever hold data they cannot read.

Keyhold runs as a Windows program (also Linux and macOS), as an Android app, and as an
installable web app in any modern browser.

Keyhold was designed after a close look at Password Safe 3.73: it keeps what that program does
well (one master password, a single encrypted file, no account needed) and adds what it lacks:
structured item types, a health report, recovery codes, automatic backups, and sync between
devices with a phone-friendly web app. See [ANALYSIS.md](ANALYSIS.md) for the comparison and the
security design.

## Get started on Windows

1. Download `Keyhold.exe` (see [Releases](#builds) below). No installer and no administrator rights are needed.
2. Double-click it. Keyhold opens in its own window (a Microsoft Edge app window, or your default browser).
3. Choose a master password and save the recovery code it shows you.

Your vault is stored in `%APPDATA%\Keyhold\vault.keyhold`, with the last 30 versions in
`%APPDATA%\Keyhold\backups`. Start Keyhold again at any time; if it is already running, the same
window comes back. It stops on its own a few minutes after you close the window.

Windows may show a SmartScreen warning the first time, because the program is not code-signed.
Choose "More info" › "Run anyway", after checking the file against `SHA256SUMS.txt`.

## On a phone or tablet

**Android app.** Download `Keyhold-<version>.apk` from the release on your phone and open it.
Android asks once to allow installs from your browser or file manager. The vault is kept,
encrypted, inside the app on that phone. Copied passwords are marked as sensitive (keyboards
and the clipboard preview hide them), screenshots of Keyhold are blocked, and links open in
your browser. Uninstalling the app deletes its vault, so keep encrypted backups (Settings ›
Backup) or connect a sync server.

**Web app (any phone, tablet or computer).** Either open your sync server's address and
choose *Install app* / *Add to Home Screen*, or put the files of `keyhold-web.zip` on any
HTTPS web host (GitHub Pages, Netlify, your own server) and open that address. Without a
Keyhold server behind it the web app keeps the vault in that browser, with the last 30
versions as automatic backups, and works offline once it has been opened.

To sync either of them with a server, use Settings › Sync, as on Windows. The server accepts
the Android app without any setting; a web app on another host needs that host in
`--cors-origins` (the page tells you which).

### Moving from Password Safe

In Password Safe choose **File › Export To › XML format…**. In Keyhold open **Settings › Backup ›
Import a file…** and pick that XML file. Groups become folders; usernames, passwords,
websites, email, notes, two-factor (TOTP) keys, password history, expiry dates and custom fields
come across. Delete the XML file afterwards: it is not encrypted.

To go back, Settings › Backup › Export everything… › Password Safe XML writes a file that Password Safe opens with
**File › Import From › XML format**. Item types Password Safe does not have keep their details as custom fields.

CSV files from Bitwarden, 1Password, KeePass, LastPass, Chrome, Edge and Firefox, and Password
Safe's plain-text export, are accepted too. Entries that are already in your vault are skipped, so
importing the same file twice does not create duplicates. Keyhold's own CSV export imports back
with every item type intact (cards, identities, Wi-Fi and so on).

## What you can keep

| Type | Fields |
|---|---|
| Login | username, password, website, email, two-factor code (TOTP) |
| Payment card | name on card, number, expiry, security code, PIN, brand |
| Identity | name, email, phone, address, date of birth, ID or passport number |
| Bank account | bank, holder, account number / IBAN, sort code / SWIFT, PIN |
| Wi-Fi | network name, password, security |
| API key | service, key ID, secret, endpoint |
| SSH key | host, public key, private key, passphrase |
| Secure note | text |

Every item can also have a folder (nested, like `Work/Clients`), tags, a favorite star, notes,
extra fields (visible or hidden), and a date to remind you to change it. Changing a password
keeps the old one in the item's history.

## Day to day

- **Search** with `/`; it looks at names, usernames, websites, folders, tags and notes, never at passwords.
  Filters narrow it down: `type:card`, `folder:work`, `tag:bank`, `is:favorite`, `is:expired`, `has:totp`, `"two words"` for a phrase and `-word` to leave something out (the full list is in Settings › Display).
- **Select several items** with Ctrl+click, Shift+click or `Ctrl+A`, then move, tag, favorite, export or trash them together.
- **Copy** with one click; the clipboard is cleared after 30 seconds (adjustable).
- **Generate** random passwords or word passphrases (EFF word list) from any password field.
- **Two-factor codes** are shown live with a countdown.
- **Password health** lists weak, reused, old, breached and due-for-change passwords, and logins whose website address is plain `http://`.
  The breach check is optional and sends only the first 5 characters of a SHA-1 hash (k-anonymity).
- **Lock** with `Ctrl+Shift+L`; Keyhold also locks itself after 5 minutes without activity, and can lock whenever the window is hidden.
- **Trash** with undo; emptying it removes items on every device. Settings › Entries can empty old trash for you after 7, 30 or 90 days.
- **Previous values**: every changed password stays in the item's history, and one click puts an earlier one back.
- **Right-click any item** for its actions: copy, show only some characters of the password (for "enter characters 2, 5 and 9" prompts), open the website, move to a folder, protect it from changes, export it.
- **List or table**: switch the item list to a table with sortable columns (created, changed, expires, last used…).
- **Folders** nest and fold; right-click a folder to rename it, add one inside or delete it.
- **Saved filters**: save a search (with its type, folder or tag) to the sidebar; a built-in view lists items with a change reminder.
- **Password policies**: named rules such as "PIN: 6 digits" or "Bank: 12 characters, no symbols", with minimum counts per character type, your own symbol set, easy-to-read, pronounceable or hexadecimal passwords. Pick one per item; its Generate button follows it.
- **Read-only mode**: open the vault read-only from the unlock screen, or switch in the status bar, to look things up without any risk of changing them.
- **Status bar**: items shown, last save, time until auto-lock, Clear clipboard.
- **Keyboard**: `N` new, `↑ ↓` move, `E` edit, `C` copy password, `U` copy username, `Delete` trash, `Shift+F10` item menu, `Ctrl+A` select all, `Ctrl+S` save, `Esc` cancel.

Settings are grouped like Password Safe's Options (Security, Display, Entries, Policies, Backup, Vault). [PASSWORD_SAFE_MAP.md](PASSWORD_SAFE_MAP.md)
lists every Password Safe screen and section and what Keyhold does there.

## Use it online: run a sync server

The same program is also the sync server. Run it on a machine you control:

```bash
keyhold serve --data /srv/keyhold --addr :8443 --tls-cert cert.pem --tls-key key.pem --invite-code "choose-a-code"
```

Then either:

- **Open the server address in any browser** (computer or phone), create an account with the
  invite code, and use Keyhold there. The web app works offline once it has opened your vault in
  that browser, and catches up when the connection returns. On a phone, "Add to Home Screen"
  makes it an app.
- **Connect the Windows app**: Settings › Sync › enter the address and a username, then
  "Create account with this vault" (or "Sign in and merge" to join an account you already have).

Server options:

| Option | Meaning |
|---|---|
| `--data DIR` | Where accounts and vaults are stored (required). Back this folder up. |
| `--addr :8443` | Address to listen on. |
| `--tls-cert`, `--tls-key` | Serve HTTPS directly. Without them, put the server behind an HTTPS reverse proxy (Caddy, nginx) and add `--trust-proxy`. Browsers only allow the app's encryption on HTTPS or `localhost`. |
| `--invite-code CODE` | New accounts need this code. |
| `--open-signup` | Anyone can create an account. Without this or an invite code, sign-up is closed. |
| `--history 50` | Earlier versions kept per vault. |
| `--cors-origins` | Which web pages may call the API. The default allows the Keyhold desktop and Android apps. |

Changes from different devices are merged item by item: the newest edit of an item wins, and a
password replaced by a newer edit from another device is kept in that item's history.

## Builds

`./scripts/build.sh` builds every platform into `dist/` (needs Go 1.24):

| File | For |
|---|---|
| `Keyhold.exe` | Windows (64-bit Intel/AMD): the app, no console window |
| `Keyhold-arm64.exe` | Windows on ARM |
| `keyhold-cli.exe` | Windows command line (`keyhold-cli serve`, `keyhold-cli version`) |
| `keyhold-linux-amd64`, `keyhold-linux-arm64` | Linux desktop or server |
| `keyhold-macos-arm64`, `keyhold-macos-amd64` | macOS |

GitHub Actions also builds the Android app (`Keyhold.apk`) and the web app (`keyhold-web.zip`)
on every change. To publish everything as a release: raise `version` in `main.go`, merge to
`main`, then on GitHub open **Actions › keyhold › Run workflow**, keep the branch `main`, tick
**Publish a release** and run it. It creates release `keyhold-v<version>` (and its tag) on that
commit, and refuses if that version was already released. Pushing a `keyhold-v<version>` tag
does the same.

### The Android app

`android/` is a small native app (one Java file, no libraries) around the same `web/` files,
which are packed into the APK unchanged. To build it yourself you need the Android SDK
(platform 36) and Java 17 or newer:

```bash
cd android && ./gradlew assembleDebug    # app/build/outputs/apk/debug/app-debug.apk
```

Releases must be signed with the same key every time, or Android will not install an update
over the earlier version. Make the key once and keep it safe (losing it means users must
reinstall, which deletes their vault):

```bash
keytool -genkeypair -v -keystore keyhold-release.jks -alias keyhold -keyalg RSA -keysize 4096 -validity 10000
```

Then add four secrets to the GitHub repository (Settings › Secrets and variables › Actions):
`KEYHOLD_ANDROID_KEYSTORE` (the output of `base64 -w0 keyhold-release.jks`),
`KEYHOLD_ANDROID_KEYSTORE_PASSWORD`, `KEYHOLD_ANDROID_KEY_ALIAS` (`keyhold`) and
`KEYHOLD_ANDROID_KEY_PASSWORD`. Without them, CI makes a debug build, good for trying the app
but not for keeping it updated.

## Command line

```text
keyhold [desktop] [--data DIR] [--port N] [--no-browser] [--stay-open]
keyhold serve --data DIR [--addr :8443] [--tls-cert F --tls-key F] [--invite-code C | --open-signup]
keyhold version
```

`KEYHOLD_HOME` sets the desktop data folder too.

## Tests

```bash
go test ./...                       # storage, desktop API, sync server
node --test test/core.test.mjs      # encryption, TOTP, generator, merge, importers, sync
node test/e2e.mjs [screenshot-dir]  # the real program in Chromium: desktop, sync server, phone, offline, web app, Android page
```

## License and credits

MIT, like the rest of this repository. Passphrase words: [EFF Large Wordlist](https://www.eff.org/dice)
(CC BY 3.0 US). Breach data: [Have I Been Pwned](https://haveibeenpwned.com/Passwords).
Keyhold contains no code from Password Safe.

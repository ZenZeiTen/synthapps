# Keyhold

A password manager for Windows (also Linux and macOS) that keeps working offline and, if you
want, syncs through a server you control. Everything is encrypted on your device before it is
saved or sent; the file on disk and the sync server only ever hold data they cannot read.

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

### Moving from Password Safe

In Password Safe choose **File › Export To › XML format…**. In Keyhold open **Settings › Backup &
import › Import a file…** and pick that XML file. Groups become folders; usernames, passwords,
websites, email, notes, two-factor (TOTP) keys, password history, expiry dates and custom fields
come across. Delete the XML file afterwards: it is not encrypted.

CSV files from Bitwarden, 1Password, KeePass, LastPass, Chrome, Edge and Firefox, and Password
Safe's plain-text export, are accepted too.

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
- **Copy** with one click; the clipboard is cleared after 30 seconds (adjustable).
- **Generate** random passwords or word passphrases (EFF word list) from any password field.
- **Two-factor codes** are shown live with a countdown.
- **Password health** lists weak, reused, old, breached and due-for-change passwords.
  The breach check is optional and sends only the first 5 characters of a SHA-1 hash (k-anonymity).
- **Lock** with `Ctrl+Shift+L`; Keyhold also locks itself after 5 minutes without activity, and can lock whenever the window is hidden.
- **Trash** with undo; emptying it removes items on every device.
- **Keyboard**: `N` new, `↑ ↓` move, `E` edit, `C` copy password, `U` copy username, `Ctrl+S` save, `Esc` cancel.

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
| `--cors-origins` | Which web pages may call the API. The default allows only the Keyhold desktop app. |

Changes from different devices are merged item by item: the newest edit of an item wins, and a
password replaced by a newer edit from another device is kept in that item's history.

## Builds

`./scripts/build.sh` builds every platform into `dist/` (needs Go 1.24):

| File | For |
|---|---|
| `Keyhold.exe` | Windows (64-bit Intel/AMD): the app, no console window |
| `Keyhold-arm64.exe` | Windows on ARM |
| `keyhold.exe` | Windows command line (`keyhold serve`, `keyhold version`) |
| `keyhold-linux-amd64`, `keyhold-linux-arm64` | Linux desktop or server |
| `keyhold-macos-arm64`, `keyhold-macos-amd64` | macOS |

GitHub Actions builds these on every change and publishes them as a release for each
`keyhold-v*` tag.

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
node test/e2e.mjs [screenshot-dir]  # the real program in Chromium: desktop, sync server, phone, offline
```

## License and credits

MIT, like the rest of this repository. Passphrase words: [EFF Large Wordlist](https://www.eff.org/dice)
(CC BY 3.0 US). Breach data: [Have I Been Pwned](https://haveibeenpwned.com/Passwords).
Keyhold contains no code from Password Safe.

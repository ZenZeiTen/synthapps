# Analysis: Password Safe 3.73.0 and the design of Keyhold

## 1. What was examined

The file supplied was `pwsafe64-3.73.0.exe` (SHA-256
`e65224b1a4cf20988f258e551da341f909894fe622e3030daa21ad3656f53ea1`, 18.5 MB). It was unpacked
with 7-Zip and examined without running it.

| Finding | Evidence |
|---|---|
| Installer: NSIS 3.05, requests administrator rights (`requireAdministrator`) | Installer manifest |
| Program: native Windows (MFC) GUI `pwsafe.exe` plus `pwsafe-cli.exe`, both x86-64 | `file`, PE headers |
| 23 language DLLs, CHM help files, on-screen keyboard (`pws_osk.dll`), autotype helper (`pws_at.dll`) | Unpacked files |
| Cryptography in the binary: Twofish, HMAC-SHA256, HMAC-SHA1 based HOTP/TOTP, YubiKey configuration | C++ type names in `pwsafe.exe` (`TwoFish`, `HMAC<SHA256>`, `TOTP<HMAC<SHA1>>`, `CYubiCfgDlg`) |
| Data model: one entry shape (group, title, username, password, URL, email, notes, autotype, run command, TOTP key, history, password policy, custom fields) | Bundled `pwsafe.xsd` |
| No sync service: the database is one local file; the bundled README and release notes describe no online access, only manual Compare/Merge/Synchronize between files | `README.md`, `ReleaseNotes.md` |
| 3.73.0 fixes an out-of-bounds write when reading a crafted V4 database with attachments | `ReleaseNotes.md` |
| License: Artistic License 2.0, copyright Rony Shapiro and contributors | `LICENSE` |

The file format (`.psafe3`) is publicly documented by the project: the master password is
stretched with iterated SHA-256, the data is encrypted with Twofish in CBC mode, and an
HMAC-SHA256 protects integrity.

## 2. Strengths worth keeping

- One encrypted file, no account, works fully offline.
- The whole database is encrypted, including titles and groups.
- Key stretching makes guessing the master password slow.
- Password history, expiry dates, TOTP, custom fields, clipboard clearing, auto-lock.

## 3. Gaps that Keyhold addresses

| Area | Password Safe 3.73 | Keyhold |
|---|---|---|
| Installation | NSIS installer needing administrator rights (an MSI and a zip are also offered) | One file, runs as the user, no installer |
| Platforms | Native per platform (Windows MFC; separate Linux/macOS builds) | One program for Windows, Linux, macOS; any browser and phones through the sync server |
| Online access | None built in; copy the file yourself | Optional self-hosted sync server; web app that also works offline |
| Merging between copies | Manual "Compare/Merge/Synchronize" | Automatic, per item; nothing typed on any device is lost |
| Item structure | One entry type for everything; cards or bank details go into notes or custom fields | 8 typed item kinds with proper fields, plus custom fields |
| Organisation | Groups (tree) | Nested folders, tags, favorites, sort, live search |
| Forgotten master password | Database is lost | Optional recovery code (160 random bits) |
| Mistakes and corruption | Backup-on-save settings in the options (`COptionsBackup`) | Atomic writes, the last 30 versions kept automatically, encryption self-check before every save, history on the server |
| Password quality | Generator and policies | Generator and passphrases, strength meter, health report (weak, reused, old, breached, due) |
| Parsing untrusted files | Native C++ parsers (3.73.0 fixed an out-of-bounds write) | Memory-safe languages only (Go, JavaScript); the XML reader refuses DTDs and external entities |
| Third-party code | Not assessed in this review | None: Go standard library and the browser's Web Crypto API |

## 4. Keyhold's security design

**Keys.** The master password is stretched with PBKDF2-SHA256 (600,000 rounds, 16-byte random
salt; the OWASP 2023 recommendation for PBKDF2-SHA256). HKDF splits the result into two
independent keys: a *key-encryption key* that never leaves the device, and a *sign-in key* that
is sent to the sync server, which hashes it again (PBKDF2, per-account salt) before storing it.
Knowing the sign-in key does not help decrypt the vault.

**Data.** The vault contents are encrypted with a random 256-bit data key using AES-256-GCM with
a fresh random IV on every save. The data key is stored wrapped by the key-encryption key, and
optionally by a recovery code. The vault's id is bound into every GCM tag, so encrypted pieces
cannot be swapped between vaults. Nothing is stored in clear: no titles, no item counts.

**Changing the master password** re-wraps the data key; on a sync server the change and the new
sign-in hash are written in one step, and every other device's session is signed out.

**The desktop program** listens on `127.0.0.1` only, requires a random per-launch key on every
API call, rejects requests whose `Host` header is not its own (DNS rebinding) and requests from
other web origins, and sends a strict Content-Security-Policy (no inline script, no third-party
script).

**The sync server** stores only encrypted vaults; rate-limits by address; delays sign-in after
repeated failures; answers unknown usernames with plausible parameters so it does not reveal
which accounts exist; keeps sessions in memory as hashes; keeps earlier versions; and limits
request sizes.

**In the app**: auto-lock after inactivity (and optionally when hidden), clipboard clearing,
re-entering the master password before showing a plain-text export or changing keys, and
neutralising spreadsheet formulas in exported CSV.

## 5. Known limits (stated plainly)

- **PBKDF2 is not memory-hard.** Argon2id resists GPU guessing better, but browsers' Web Crypto
  API does not offer it, and adding it would mean shipping third-party code. A long master
  password matters more than the algorithm; the app warns about weak ones.
- **JavaScript cannot guarantee secrets are wiped from memory.** Keyhold drops its keys and
  zeroes the raw data key on lock, but copies may remain until the browser reuses that memory.
  Password Safe, as native code, can do better here.
- **Not yet included**: auto-type into other windows, a browser extension for filling web forms,
  YubiKey or other hardware keys, and file attachments.
- **`.psafe3` files are not read directly**; Password Safe's XML export is the bridge.
- The Windows executable is not code-signed, so SmartScreen warns on first run.
- The Windows build is checked by automated tests on Windows in CI; it was built and tested on
  Linux during development, where the same code runs.

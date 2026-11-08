# Password Safe 3.73 → Keyhold: feature map

To build this list, Password Safe 3.73.0 (`pwsafe.exe` from the supplied installer) was run
under Wine 9.0 on a virtual screen. A test database was created and every screen was clicked
through and screenshotted: the master password screens, the main window, all five menus and
their submenus, the right-click menu of an entry, the five tabs of the Add Entry dialog, the
seven sections of Options, the password generator and the database properties.

Each row below is one thing seen in Password Safe and what Keyhold does there.

- **Same**: the feature exists in Keyhold.
- **Added**: added to Keyhold after this walkthrough.
- **Differs**: done another way, with the reason.
- **Not included**: left out, with the reason.

## Start-up

| Password Safe | Keyhold | |
|---|---|---|
| Master Password Entry: choose a database, master password, Show | Unlock screen with show/hide | Same |
| "Open as read-only" | "Open read-only" on the unlock screen | Added |
| New… database, choose a file name | Create your vault (one vault per data folder) | Differs: one vault, stored automatically, no file picking |
| Master Password Setup with confirmation; field turns pink when weak | New master password with confirmation and a strength meter; weak ones need confirming | Same |
| On-screen keyboard (needs a Unicode font) | — | Not included: keystroke protection a browser cannot provide |
| — | Recovery code | Keyhold only |

## Main window

| Password Safe | Keyhold | |
|---|---|---|
| Nested Tree of groups (`Banking.Online`) | Nested folders (`Banking/Online`) in the sidebar | Same |
| Expand All / Collapse All, initial tree state | Expand-all and collapse-all buttons, open/closed arrows, "Folders when the vault opens" setting | Added |
| Flattened List with sortable columns (Title, User Name, URL, E-mail, Created, Password Modified, Last Accessed, Password Expiry Date, Last Modified…) | Table view: Name, Username, Website, Folder, Type, Created, Secret changed, Last changed, Expires, Last used; click a header to sort | Added |
| Status bar: R/W, item count | Status bar: shown/total items, last saved, auto-lock countdown, Clear clipboard, Read-write/Read-only switch | Added |
| Toolbar, Customize Toolbar, Classic/New toolbar | Top bar: search, New, Settings, Lock | Differs: fixed, simpler bar |
| Dragbar (drag a field into another program) | Copy buttons on every field | Not included: dragging data out of a browser page is unreliable |
| Find (Ctrl+F) and "Last Find results" | Live search over names, usernames, sites, folders, tags and notes (`/`) | Same |
| Subviews › Entries with expiry dates | Sidebar › Views › "With an expiry date" | Added |
| Filters: New/Edit, Apply, Manage | "Save this view": saves the current search plus type/folder/tag as a sidebar filter; right-click to remove | Added |
| Change Font | — | Not included: uses the system font; zoom works |
| Dark display mode | Light, dark or system theme | Same |
| System tray icon, minimise to tray | — | Not included: the app window closes; the program stops by itself |

## Entry right-click menu

| Password Safe | Keyhold | |
|---|---|---|
| Copy Username / Password / URL to Clipboard | Copy username, password (or the item's main secret), website address, two-factor code | Added (menu); copy buttons already existed |
| Display subset of Password | "Show characters of password…": positions such as `1, 3, 8`, ranges `2-4`, `-1` for the last | Added |
| Browse to URL | Open website | Same |
| Browse to URL + AutoType, Perform AutoType | "Copy password and open website" | Differs: browsers cannot type into other windows |
| Edit, Rename, Duplicate, Delete | Edit, Duplicate, Move to trash (with undo), Move to folder… | Same |
| Protect Entry | "Protect from changes": blocks editing, moving and deleting until unprotected | Added |
| Create Shortcut (alias entry) | — | Not included yet |
| Export Entry To ▸ | "Export this item…" as CSV or Password Safe XML | Added |
| Add Entry, Add Group | New item, New folder (also in the folder right-click menu: new folder inside, rename, delete) | Added (folder menu) |

## Add/Edit Entry dialog

| Tab | Password Safe | Keyhold | |
|---|---|---|---|
| Basic | Group, Title, Username, Password + Confirm, Show, Generate, URL (Go), E-mail (Send), Notes, Custom Fields | Name, folder, tags, type-specific fields with show/generate/strength, notes, extra fields (visible or hidden) | Same, plus 8 item types instead of one |
| Additional | Autotype, Run Cmd, double-click actions per entry, keyboard shortcut | Double-click action is a global setting | Differs: autotype, run command and hotkeys need OS access |
| Additional | Authenticator Secret (TOTP key) | Two-factor field with a live code | Same |
| Additional | Password History: keep N | "Password history" setting (none, 3–50) and "Clear the history of every item" | Added (setting) |
| Dates and Times | Password expiry: on a date, in N days (recurring), never | "Reminder to change it on" plus a default reminder for every new password | Added (default) |
| Attachment | One file per entry | — | Not included yet |
| Password Policy | Named policy or per-entry rules | "Password policy" per item; Generate follows it | Added |
| — | First username saved: "Set as default username?" | Same prompt; "Default username" setting | Added |

## Manage menu and Options

| Password Safe | Keyhold | |
|---|---|---|
| Change Master Password | Settings › Security › Change master password | Same |
| Unlock Difficulty slider | Unlock difficulty when changing the master password: 600,000 / 1,000,000 / 2,000,000 rounds | Added |
| Make Backup / Restore from Backup | Download encrypted backup; automatic backups (last 30) and server versions with "Bring back items"; Merge a vault file | Same |
| Password Policies | Settings › Policies: create, edit, delete; length, character types with minimum counts, own symbol set, easy-to-read, pronounceable, hexadecimal | Added |
| Generate Password (Ctrl+P) | Generator with policy picker, "Change rules…", "Save as policy…", and a word-passphrase mode | Added (policies) |
| Yubikey | — | Not included: no hardware-key support yet |
| Change Language (23 languages) | English only | Not included yet |
| Options › Backups (save after every change, intermediate backups, naming, folder) | Every change is saved at once; the previous 30 versions are kept automatically | Differs: no configuration needed |
| Options › Display (username/password in tree, notes as tooltips, highlight changed, warn N days before expiry, transparency) | Settings › Display: show username, notes as tooltips, folders open/closed, expiry warning window, theme | Added |
| Options › Misc (confirm delete, record last access, Escape behaviour, double-click, default autotype, default username, alternate browser/editor) | Settings › Entries: ask before trash, record last use, double-click action, default username | Added |
| Options › Password History (default expiry days, apply to all entries) | Settings › Entries: change reminders, history count, clear all history | Added |
| Options › Security (clear clipboard on minimise/exit, exclude from clipboard history and screen capture, lock on minimise/workstation lock/idle, unlock difficulty) | Clipboard cleared after N seconds and on lock; Clear clipboard now; lock when hidden or after idle minutes | Same (screen-capture exclusion is not available to web pages) |
| Options › Shortcuts (rebind keys, per-entry hotkeys) | Fixed shortcuts, listed in Settings › Display | Differs |
| Options › System (tray, recent databases, multiple instances, start at login) | One instance; reopening shows the running window | Differs |

## File menu

| Password Safe | Keyhold | |
|---|---|---|
| Save / Save As | Saved automatically after every change, atomically | Differs |
| Lock (Ctrl+Shift+L) | Lock (Ctrl+Shift+L) | Same |
| Export To: v1/v2/v4 formats, Plain Text, XML, filtered entries | Export everything or the current view as CSV or **Password Safe XML** (opens in Password Safe via File › Import From › XML) | Added |
| Import From: Plain Text, XML, KeePass v1 TXT/CSV | Password Safe XML and text, CSV from Bitwarden, 1Password, KeePass, LastPass and browsers | Same |
| Reports (a log for each import, export, merge, etc.) | Import report after each import | Added |
| Merge… / Compare… / Synchronize… | "Merge a vault file" and automatic sync between devices | Added (merge); Same (sync) |
| Change to R-O | Read-write / Read-only switch in the status bar | Added |
| Properties (format, counts, last saved by/on, master password set on, ID, Name, Description) | Settings › Vault: name and description, counts, created, master password last set, last saved, storage, format, ID, recovery code | Added |

## Help

| Password Safe | Keyhold | |
|---|---|---|
| Get Help (CHM), website, About | README, Settings › About | Differs: no help file |

Lintas is a fast, secure desktop browser (Chromium engine) that works online and offline, with a built-in Translation Management System, Claude AI features, Chrome extensions and a Claude Desktop (MCP) connection.

## New in 0.5.1

- **Fixed: signing in to Claude in Chrome.** claude.ai hands the sign-in to the extension with a direct message from the page, which Lintas did not support, so Claude stayed signed out. Pages that an extension allows (its "externally_connectable" list) can now message it, as in Chrome.
- **Fixed: "A JavaScript error occurred in the main process"** (`Cannot read properties of undefined (reading 'isDestroyed')`) when an extension restarted, for example Claude in Chrome after signing in. A tab whose page ends now reloads, and a tab showing the extension's own page closes, as in Chrome.

## New in 0.5.0

- **AI Oracle in the side panel.** It replaces the Assistant. Oracle is an agent about the page in the active tab: it reads and searches the page, can search the web, checks your translation memory, termbases and its own memory, and lists your tabs and offline library. It needs your own Claude API key, as before.
- **It asks before it changes anything.** Opening a tab, saving a page offline, changing translation projects or remembering something each wait for you to click Allow.
- **Council of Minds.** The mascot shows which part is working (Research, Planning, Memory or Action), and a part lights up only while that work really happens.
- **Jade Wisp companion** with Day and Night looks. It stays quiet when you choose reduced motion.
- **Memory view** to see what Oracle remembers, and forget one item or all of it.
- Oracle has not yet been tested against the live Claude API by the developers. Please report anything that does not work.

## New in 0.4.0

- **Claude in Chrome works in Lintas.** The Claude extension's panel now opens beside the page, like Chrome's side panel, instead of in a separate tab, so you can watch Claude work on the page. A panel opened for one tab shows while that tab is active, as in Chrome.
- **Tab groups.** Extensions can group tabs (Claude puts the tabs it works in into an orange "Claude" group). A group shows as a coloured line under its tabs.
- **Extension keyboard shortcuts**, such as Claude's Ctrl+E to open and close its panel.
- **Connection to Claude Desktop and Claude Code (native messaging).** Lintas now finds the programs these apps register for Chrome or Edge, and passes long messages and non-English text through intact. Before, long messages broke the connection.
- Signing in to Claude in the extension and letting Claude act on pages have not been tested with a real account. If something does not work, please report what you see.

## New in 0.3.0

- **Gmail and Google Calendar in the side panel**, like the sidebar apps in Opera and Edge: click the envelope or calendar icon at the top of the side panel. They use your normal browsing profile, so signing in to Gmail there signs you in to Google in your tabs too (private tabs stay separate). Each keeps its place when you switch, and *Open in a tab* moves it to a full tab.
- **Sign-in popups work.** "Sign in with Google" (and Microsoft, Apple and payment popups) stuck on "Processing your request…" because Lintas opened every popup as a tab, cutting its link back to the page that opened it. Sized popups now open as real popup windows and can hand the result back.
- **Extension sign-in** (`chrome.identity.launchWebAuthFlow`) opens in a popup window, as in Chrome, and a silent check no longer opens a visible tab.

## New in 0.2.1

- **Google sign-in:** Google refused Lintas with "This browser or app may not be secure". On Google's sign-in pages only, Lintas now identifies itself as Firefox, which Google accepts. Signing in with a real account has not been tested; if Google still refuses, please report it.

## New in 0.2.0

- **Import from another browser** (Settings > General): bookmarks, history, search engine and home page from Chrome, Edge, Firefox, Brave, Vivaldi or Opera, or a bookmarks HTML file.
- **Minimize to the notification area** (Settings > General, off by default).
- **Fixed:** an error when closing some tabs ("conversion failure from null").
- **Fixed:** the Extensions, Claude Desktop and About buttons in Settings appeared to do nothing.
- **Fixed:** a long file path ran under the buttons in Settings > Claude Desktop.
- **Chrome extensions:** added `debugger`, `offscreen`, `alarms` and `sidePanel` (a side panel opens as a tab). The Claude extension now starts and its button opens its panel; signing in to it has not been tested.

## Download for Windows

Windows 10 or 11, 64-bit.

| File | What it is |
|---|---|
| `Lintas-Setup-<version>-x64.exe` | Installer for most PCs (Intel and AMD) |
| `Lintas-Setup-<version>-arm64.exe` | Installer for ARM PCs (Snapdragon) |
| `Lintas-Portable-<version>-x64.exe` | Runs without installing, Intel and AMD |
| `Lintas-Portable-<version>-arm64.exe` | Runs without installing, ARM |

The installer:
- installs for your user account only, without admin rights, unless you choose all users;
- adds Start menu and desktop shortcuts;
- lists Lintas in **Settings > Apps > Default apps**, so you can make it your default browser. You can also go to Lintas **Settings > General > Default browser**.

Uninstall from **Settings > Apps**. Your bookmarks, history, translation projects and offline pages stay in `%APPDATA%\Lintas` unless you delete that folder.

## Windows SmartScreen

These builds are not code-signed yet, so Windows may show "Windows protected your PC" the first time. Choose **More info > Run anyway**. Check the file first against the SHA-256 checksums below, for example in PowerShell:

```powershell
Get-FileHash .\Lintas-Setup-<version>-x64.exe -Algorithm SHA256
```

## Known limits

- No automatic updates yet: download the new version from this page and install it over the old one. Your data is kept.
- Chrome extensions: many work, but not all. Network rule sets (declarativeNetRequest) are accepted but not applied. Background workers get Lintas's extra Chrome APIs only with the normal sandbox. Smartling Context Capture loads and captures pages; signing in to Smartling has not been tested.
- AI features need your own Claude API key (Settings > AI).

Full details: [lintas/README.md](https://github.com/ZenZeiTen/synthapps/blob/main/lintas/README.md).

# Kempt

Honest care for a Windows PC. Kempt frees space taken by caches and leftovers, finds your
largest files and exact duplicates, manages the programs that start with Windows, updates your
apps with winget, checks the PC's health and switches off Windows' advertising and suggestions.
It explains every step, records every change, and leaves out the features that do not help.

It was designed after a look at IObit's Advanced SystemCare Free; [ANALYSIS.md](ANALYSIS.md)
compares the two.

| Screen | What it does |
|---|---|
| **Overview** | One bar for your system drive: what is in use, what can go, what is free. **Tidy up** removes the caches chosen in Automatic care and shows a receipt. Below it: what needs a look. |
| **Clean up** | Each kind of cache with its size, what it is, why removing it is safe, what you give up, and its largest files. Temporary files, Windows temporary files, crash dumps, error reports, thumbnails, and the caches of Chrome, Edge, Brave and Firefox. The Recycle Bin is listed but never emptied unless you choose it. |
| **Large files** | The biggest files in a folder you pick, largest first. Move what you no longer need to the Recycle Bin. |
| **Duplicates** | Files with identical contents. The oldest copy is kept; you choose which copies go. Kempt will not move every copy. |
| **Startup** | Programs that start when you sign in, with publisher and location. On or off with the same switch Task Manager uses. |
| **App updates** | Programs with a newer version, from winget. Update the ones you tick. |
| **Health** | Free space, drive health, antivirus, firewall, Windows updates, pending restart, battery wear, memory and the programs using it. "Check and repair Windows" runs SFC and DISM. |
| **Privacy** | Advertising ID, suggestions in Start and Settings, tips, welcome screens, lock-screen promotions and automatic installation of suggested apps, each linked to its Settings page. |
| **Automatic care** | A daily or weekly Task Scheduler task that runs the same cleanup. No background program. |
| **History** | Everything Kempt changed. Startup and privacy changes can be undone. |
| **Settings** | **Start at Windows startup** opens Kempt when you sign in. **Minimize to desktop and stick to taskbar** makes that startup window open minimized on the taskbar. Both are off by default. |
| **What Kempt won't do** | Why there is no registry cleaner, RAM booster, internet booster, driver updater or PC score. |

## Get started on Windows

1. Download `Kempt.exe` from the [releases](https://github.com/ZenZeiTen/synthapps/releases?q=kempt).
   No installer and no administrator rights are needed.
2. Double-click it. Kempt opens in its own window and measures your PC. Nothing changes until
   you press a button.
3. To also clean the Windows Temp folder and the error reports of all users, choose
   **Restart as administrator** at the bottom left.

Kempt keeps its settings and history in `%LOCALAPPDATA%\Kempt`. It runs only while its window
is open (or when the automatic-care task starts it), starts with Windows only if you turn
that on in Settings, and sends nothing anywhere.

Windows may show a SmartScreen warning the first time, because the program is not code-signed.
Choose "More info", then "Run anyway", after checking the file against `SHA256SUMS.txt`.

## Command line

`kempt-cli.exe` does the same from a terminal:

```
kempt-cli scan                 how much each kind of cache holds
kempt-cli clean                what would be removed (nothing is removed)
kempt-cli clean --yes          remove it
kempt-cli clean --only chrome,user-temp --yes
kempt-cli health               the checkup
kempt-cli startup              startup programs
kempt-cli updates              programs with a newer version
kempt-cli recycle FILE...      move files to the Recycle Bin
```

Add `--json` to `scan`, `health`, `startup` or `updates` for machine-readable output.

## Linux

The Linux build cleans thumbnail and browser caches, finds large files and duplicates, manages
XDG autostart entries, empties the trash on request and runs the basic health checks. App
updates, privacy settings and scheduling are Windows features; for a schedule, add
`0 11 * * 0 kempt care` to your crontab.

## Build and test

Go 1.24 or newer, no other dependencies.

```bash
go vet ./... && go test ./...
node test/e2e.mjs [screenshot-dir]   # needs Playwright with Chromium
./scripts/build.sh                   # all builds into dist/
```

To publish a release, raise `version` in `main.go`, update [RELEASE_NOTES.md](RELEASE_NOTES.md),
then run the **kempt** workflow on `main` with "Publish a release" ticked.

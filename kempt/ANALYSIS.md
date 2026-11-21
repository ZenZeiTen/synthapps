# Analysis: Advanced SystemCare Free and the design of Kempt

## 1. What was examined

The Microsoft Store listing for **Advanced SystemCare Free** by IObit
(store id `xpffgss4z9m2tx`, read on 20 November 2026 with the region set to Indonesia):
<https://apps.microsoft.com/detail/xpffgss4z9m2tx?hl=en-US&gl=ID>.

Only the listing was examined. The program itself was not installed or run for this
analysis, so nothing below describes its behaviour beyond what the listing says. Where this
document says something about Windows in general, it is marked as background, not as a claim
about IObit's product.

### What the listing states

| Item | From the listing |
|---|---|
| Promise | "Clean, optimize, speed up, and protect your PC, as well as guard your privacy." |
| One-click mode | "AI Mode", which builds "a personalized scan and fix solution" from your habits |
| Feature claims | "Up to 300% Internet Speedup with Internet Booster", "Up to 200% Quicker PC Startup", "Deep Windows Registry Clean to Prevent System Crash", "RAM Clean with Real-time Optimization" |
| Breadth | "23 effective tools", including Smart RAM, Internet Booster, Win Fix, FaceID (photographs people who use the PC), Large File Finder, DNS Protector, Anti-Spyware, driver and software updaters |
| Scheduling | "Auto Care for PC as Scheduled (Available in Pro edition only)" |
| Payment | "In-App Purchases" |
| Declared capability | "Uses all system resources" |
| "What's new" | Software Updater support for "Google Chrome 108.0, Edge 108.0, Firefox 108" (versions from December 2022, so the notes are about four years old) |
| Ratings | "There aren't any reviews yet." |
| Requirements | "Windows 10 version 0.0 or higher"; 36 languages, Indonesian among them |

## 2. What it gets right

These are real needs, and Kempt keeps them:

- **Reclaiming disk space** from temporary files, caches and leftovers.
- **Startup programs**: fewer programs at sign-in make the desktop ready sooner.
- **Large files**: most space problems are a few big downloads or videos.
- **Outdated programs**: old versions carry known security holes.
- **One place, one click** for people who do not want to learn where Windows hides each setting.
- **A schedule**, so care happens without remembering.

## 3. Where it falls short, and what Kempt does instead

| Area | Advanced SystemCare Free (per the listing) | Kempt |
|---|---|---|
| Registry cleaning | Advertised as preventing crashes | Not offered. Microsoft does not support registry cleaners ([KB2563254](https://support.microsoft.com/en-us/help/2563254/microsoft-support-policy-for-the-use-of-registry-cleaning-utilities)); the possible gain is a few kilobytes and the risk is a broken program |
| Memory | "RAM Clean", "Smart RAM" releases memory automatically | Not offered. Shows which programs use the most memory and says when memory is actually full. Background: Windows keeps spare memory as a file cache and releases it on demand, so emptying it makes the next things you open slower |
| Internet | "Up to 300%" speed-up | Not offered. Background: Windows has tuned TCP automatically since Vista; speed is set by the provider, the Wi-Fi signal and the remote site |
| Drivers | Driver updater (sold separately as Driver Booster) | Not offered: Windows Update supplies drivers tested for the hardware |
| Scheduled care | Pro only | Free: a Windows Task Scheduler task with no background program |
| One-click mode | "AI Mode", personalised scan and fix | "Tidy up" removes a fixed, documented set of caches. The overview shows the exact amount first |
| Explanations | Feature names and percentages | Each kind of file says what it is, why removing it is safe and what you give up; each health finding says what was measured and what to do |
| Undo | Not described | Startup and privacy changes are recorded in History and can be undone. Your own files go to the Recycle Bin, never straight to deletion |
| What it may touch | Declares "Uses all system resources" | Runs as you; only two kinds of file need administrator rights, and it asks Windows for them only when you choose "Restart as administrator". It never follows links, junctions or OneDrive placeholders, and refuses drive roots and your home folder as places to clean |
| Startup switch | Own startup optimizer | The same StartupApproved switch Task Manager uses, so Task Manager shows the same state and nothing is deleted |
| Software updates | Own updater and database (release notes name 2022 browser versions) | winget, the package manager built into Windows, using Microsoft's own sources |
| Health | Scan results and a fix button | Real measurements: free space per drive, drive health as the drive reports it, Defender or other antivirus, firewall per profile, last Windows update, pending restart, battery wear, memory. "Check and repair Windows" runs Microsoft's own SFC and DISM in a window you can watch |
| Privacy | Clears traces, "anti-tracking" | The per-account Windows switches the Settings app writes (advertising ID, suggestions, silent app installs and others), each linked to its Settings page and undoable |
| Size and install | Store package with in-app purchases | One 7 MB program, no installer, no account, nothing sent anywhere |
| Language | 36 languages | English and Indonesian, with Windows terms checked against the Microsoft Terminology Collection |

## 4. How Kempt is built

- **One Go program** using only the standard library, with the window built in plain
  JavaScript and embedded in the program. It opens as a Microsoft Edge app window with its own
  profile in `%LOCALAPPDATA%\Kempt\window`, so it does not lock or join your Edge profile.
- **Loopback only.** The program listens on `127.0.0.1`, requires a random key from the
  launch on every API call, rejects other host names (DNS rebinding) and other web origins,
  and sends a strict Content-Security-Policy.
- **Windows access** goes through Windows PowerShell scripts with fixed text. Data from Kempt
  (paths, names) is passed as base64-encoded JSON and read with `ConvertFrom-Json`, so it
  never becomes script code.
- **Deleting** happens only in folders from Kempt's catalog, only to regular files, only to
  files older than each kind's age limit, and only after a second check just before deletion.
  Files a program has open are skipped. Browser caches are skipped while the browser runs.
- **Recycling** your own files (from Large files and Duplicates) is accepted only for paths
  that a search in the same session showed you, and never every copy of a duplicate.
- **Records**: every change goes into `journal.jsonl`; startup and privacy changes store the
  previous state for undo.

## 5. Known limits

- Two languages, English and Indonesian. Every string lives in `internal/i18n/locales/*.json`;
  adding a language means adding one file there (and its plural rule in `internal/i18n`). The
  command line stays in English.
- Kempt does not measure how much each startup program delays sign-in (Task Manager's
  "Startup impact" comes from data Windows does not expose to other programs).
- The Windows-specific parts (PowerShell scripts, Recycle Bin, Task Scheduler) are tested on a
  Windows runner in CI. The development machine for this version was Linux, so the window was
  reviewed there, in Chromium.
- Drive health is what the drive reports through Windows (`Get-PhysicalDisk`); a drive can
  fail without warning.
- The program is not code-signed, so Windows SmartScreen warns on first launch.

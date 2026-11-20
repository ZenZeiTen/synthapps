# kempt: notes for Claude

Honest PC care: one Go program (standard library only) that embeds a vanilla-JS window.
`README.md` is for users, `ANALYSIS.md` compares it with Advanced SystemCare and explains the
design, this file is for whoever changes the code.

## Check every change

From `kempt/`:

```bash
go vet ./... && GOOS=windows go vet ./... && go test ./...
node test/e2e.mjs [screenshot-dir]   # builds the binary and drives the window in Chromium
./scripts/build.sh
```

CI (`.github/workflows/kempt.yml`) also runs every PowerShell script on a real Windows runner
through `kempt-cli` and the desktop API. That is the only place they run: keep the smoke test
in step when a script changes.

## Rules

- **Never add a feature from the "won't do" list** (registry cleaning, RAM freeing, network
  "boosts", driver downloads, scores) without changing `ANALYSIS.md` and the Why page with evidence.
- **Deleting**: only through `clean.Engine` (catalog folders, `fsx.CheckRoot`, age limit, second
  `Lstat` before removing) or `fsx.Recycle` for a person's own files. The API recycles only
  paths a search in this session returned (`server.allow`). `fsx.WalkFiles` never follows links,
  junctions or reparse points (OneDrive placeholders); keep it that way.
- **The Recycle Bin is never part of automatic care** (`CareIDs` drops it; a test checks).
- **PowerShell**: fixed script text only. Pass data with `shell.PSData` (base64-encoded
  JSON). Scripts print one JSON value; read it with `shell.PowerShellJSON`.
- **Windows changes use Windows' own mechanisms**: StartupApproved values (as Task Manager),
  the HKCU values the Settings app writes, Task Scheduler, winget, SFC/DISM. Every startup and
  privacy change writes a journal entry with `Undo`.
- **No third-party code**, Go or JS. The CSP forbids inline script and style attributes: build
  DOM with `h()`/`fill()` from `web/js/ui.js`; set sizes through `el.style` (CSSOM), not strings.
- Sizes: Go `health.GB` and JS `bytes()` format the same way (MB whole, GB one decimal).
- The version is set once, in `main.go`.

## Layout

| Path | Role |
|---|---|
| `main.go` | CLI (`scan`, `clean`, `care`, `health`, `startup`, `updates`, `recycle`), embedded `web/` |
| `desktop.go`, `platform_*.go` | Loopback server, per-launch key, single instance, Edge app window with its own profile, restart as administrator, opening Settings pages, `--startup` and the minimized window |
| `internal/clean` | Catalog of cache kinds (Windows and Linux), scan and clean, browser lock detection |
| `internal/files` | Large files, duplicates (size, then first/last 64 KB, then full SHA-256) |
| `internal/fsx` | Safe walking and deleting, Recycle Bin (SHFileOperationW) / freedesktop trash |
| `internal/startup` | StartupApproved (Windows, via PowerShell) and XDG autostart |
| `internal/health` | Measurements and findings |
| `internal/apps` | winget table parser and upgrades |
| `internal/privacy` | Per-user Windows switches |
| `internal/schedule` | Task Scheduler task for `Kempt.exe care` |
| `internal/autostart` | Kempt's own "Start at Windows startup" entry (HKCU Run value / XDG file) |
| `internal/journal` | `journal.jsonl` with undo |
| `internal/jobs` | Background jobs with progress for the window |
| `internal/api` | HTTP API: key, Host and Origin checks, routes |
| `web/js/app.js` | Every screen |
| `web/js/ui.js` | DOM helpers, API client, jobs, toasts |

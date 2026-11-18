# keyhold: notes for Claude

A password manager: one Go program (standard library only) that embeds a vanilla-JS web app,
plus an Android app (`android/`, Java, Android SDK only) that packs the same `web/` files.
`README.md` is for users, `ANALYSIS.md` explains the design and its limits, `PASSWORD_SAFE_MAP.md`
maps every Password Safe screen to Keyhold; this file is for whoever changes the code.

## Check every change

From `keyhold/`:

```bash
go vet ./... && go test ./...
node --test test/core.test.mjs
node test/e2e.mjs [screenshot-dir]   # builds the binary, runs desktop + sync server in Chromium
./scripts/build.sh                   # all platforms into dist/
(cd android && ./gradlew assembleDebug)  # needs the Android SDK; CI builds it in any case
```

CI: `.github/workflows/keyhold.yml` (tests on Ubuntu and Windows, the browser run, a smoke test of
the built `keyhold.exe` on Windows, the Android and web-app builds). A release is published by
"Run workflow" on `main` with "Publish a release" ticked, or by a `keyhold-v<version>` tag; both
take the version from `main.go`.

## Rules

- **Plaintext never reaches Go.** All encryption is in `web/js/crypto.js`. The Go side validates
  the envelope's shape only (`store.ValidateVault`). Do not add server-side features that need
  the contents.
- **No third-party code**, in Go or JS. No CDN, no npm runtime dependencies. The CSP forbids
  inline scripts and styles: no `innerHTML`, no `style=""` strings built from data, no `onclick=""`.
  Build DOM with `h()` / `fill()` from `web/js/ui.js` (native `append` does not flatten arrays).
- **Changing the vault format** means bumping `v` in the envelope and keeping a reader for v1.
- New files under `web/` must be added to the cache list in `web/sw.js`; bump its `CACHE` name with every release.
- The page has three modes, decided by `/api/mode` at start: `desktop` (Go program), `server`
  (sync server), `device` (no Keyhold server: plain web host, or the Android app, which answers
  `{"mode":"device","platform":"android"}` itself). Device mode keeps the vault in
  `BrowserStore('@device', { keep: 30 })`. Use `app.isLocal()` for "desktop or device".
- Android bridge (`window.KeyholdAndroid`, see `ui.js` and `MainActivity.java`): `copy`,
  `clearClipboard` (returns `cleared`/`other`/`later`), `saveFile`, `openUrl`. The app calls
  `keyholdBack()` and `keyholdResume()` in the page. Go through `ui.openUrl`, `ui.download`,
  `ui.copyText` or `app.copy` rather than `window.open` or the clipboard API, so the app works.
- The version is set once, in `main.go`; the Android build reads it from there.
- `renderDetail()` leaves an open edit form alone on purpose (background saves and syncs emit `changed`). Set `state.editing = null`, or a new `state.editing`, to replace the form.
- Dates the user picks are local calendar days: show them with `model.localDay`, never `iso.slice(0, 10)`.
- Read-only mode is enforced in `Session.change()` (only `touch()` passes `allowReadOnly`); the UI also disables controls.
- Every write goes through `Session.change()` (serialised, encryption self-check, local conflict
  merge, then sync). Merge rules live in `model.mergePayloads` and must stay order-independent.

## Layout

| File | Role |
|---|---|
| `main.go` | CLI, `serve` mode, embedded `web/` |
| `desktop.go`, `platform_*.go` | Desktop mode: loopback server, per-launch token, single instance via `instance.json`, Edge app window, exit when the window is gone |
| `internal/store` | One vault on disk: revisions, atomic writes, rotating backups |
| `internal/api/local.go` | Desktop API (`/api/local/*`): token, Host and Origin checks |
| `internal/api/sync.go` | Sync server (`/api/v1/*`): accounts, hashed sign-in keys, sessions, rate limits, history, CORS for loopback origins |
| `web/js/crypto.js` | PBKDF2 → HKDF → AES-GCM envelope, recovery code, password change |
| `web/js/model.js` | Item types and fields, search and its filters (`parseQuery`), folders, health report, merge, import de-duplication |
| `web/js/session.js` | Open vault: save, local conflicts, sync, key changes, linking to a server |
| `web/js/storage.js` | Desktop file, IndexedDB vault with automatic versions (device mode) or offline copy (server mode), sync-server client |
| `web/js/importers.js` | Password Safe XML/text, CSV from other managers, CSV export |
| `web/js/app.js` | Start screens, unlock, main window (sidebar, list, detail, edit form), multi-select and bulk actions, auto-lock, keyboard |
| `web/js/workbench.js` | Item and folder right-click menus, table view, status bar, show-characters dialog, password policy editor |
| `web/js/views.js` | Settings (arranged like Password Safe's Options), generator, health report, export/merge/import report |
| `web/js/ui.js` | DOM helpers (`h`, `fill`, `modal`, toasts); links, downloads and copying that also work in the Android app |
| `android/app/src/main/java/.../MainActivity.java` | The Android app: WebView serving `web/` from the APK, file picker, sensitive clipboard, back button, `FLAG_SECURE` |

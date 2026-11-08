# keyhold: notes for Claude

A password manager: one Go program (standard library only) that embeds a vanilla-JS web app.
`README.md` is for users, `ANALYSIS.md` explains the design and its limits; this file is for
whoever changes the code.

## Check every change

From `keyhold/`:

```bash
go vet ./... && go test ./...
node --test test/core.test.mjs
node test/e2e.mjs [screenshot-dir]   # builds the binary, runs desktop + sync server in Chromium
./scripts/build.sh                   # all platforms into dist/
```

CI: `.github/workflows/keyhold.yml` (tests on Ubuntu and Windows, the browser run, a smoke test of
the built `keyhold.exe` on Windows, release on `keyhold-v*` tags).

## Rules

- **Plaintext never reaches Go.** All encryption is in `web/js/crypto.js`. The Go side validates
  the envelope's shape only (`store.ValidateVault`). Do not add server-side features that need
  the contents.
- **No third-party code**, in Go or JS. No CDN, no npm runtime dependencies. The CSP forbids
  inline scripts and styles: no `innerHTML`, no `style=""` strings built from data, no `onclick=""`.
  Build DOM with `h()` / `fill()` from `web/js/ui.js` (native `append` does not flatten arrays).
- **Changing the vault format** means bumping `v` in the envelope and keeping a reader for v1.
- New files under `web/` must be added to the cache list in `web/sw.js`.
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
| `web/js/model.js` | Item types and fields, search, folders, health report, merge |
| `web/js/session.js` | Open vault: save, local conflicts, sync, key changes, linking to a server |
| `web/js/storage.js` | Desktop file, IndexedDB copy, sync-server client |
| `web/js/importers.js` | Password Safe XML/text, CSV from other managers, CSV export |
| `web/js/app.js`, `views.js`, `ui.js` | Interface |

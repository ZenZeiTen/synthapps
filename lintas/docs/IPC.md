# Lintas Browser — renderer ⇄ main contract

Lintas is an Electron desktop browser. The **main process** owns tabs (each web
tab is a sandboxed `WebContentsView`), security, the offline library, the
Translation Management System (TMS) data and the Claude client. The **browser
chrome renderer** (`app/renderer/index.html`) draws the window UI: tab strip,
toolbar/omnibox, bookmarks bar, side panel, and every internal page
(new tab, TMS, offline library, history, downloads, settings).

The renderer has no Node access. The preload script exposes exactly one object,
`window.lintas`, described below. Every call returns a Promise; failures reject
with an `Error` whose `message` is plain language suitable for the user.

## Layout handshake

The web page of the active tab is a native view drawn *on top of* the renderer,
so the renderer must tell main where it may draw it:

- `lintas.view.setBounds({ x, y, width, height })` — the content rectangle in CSS
  pixels (below the toolbar/bookmarks bar, left of an open side panel). Call it on
  load, on every resize and whenever bars/panels open or close
  (a `ResizeObserver` on the content element is ideal).
- `lintas.view.setVisible(bool)` — hide the native page while a renderer overlay
  must sit above it (menus, dialogs, the omnibox dropdown, permission prompts),
  show it again afterwards. Internal tabs never show a native view.

## Tabs

`Tab`:
```
{ id, kind: "web"|"internal", url, title, favicon|null, loading: bool,
  canGoBack, canGoForward, active: bool, pinned: bool, private: bool, muted: bool, audible: bool,
  security: "secure"|"insecure"|"internal"|"offline-copy"|"error"|"file",
  blocked: number,           // trackers/ads blocked on this page
  zoom: number,              // 1 = 100 %
  error: { code, description }|null,   // navigation failure (renderer shows an error page)
  offlineCopy: { id, savedAt }|null }  // a saved copy exists for this URL
```
Internal URLs: `lintas://newtab`, `lintas://tms`, `lintas://tms/project/<id>`,
`lintas://tms/file/<projectId>/<fileId>`, `lintas://offline`, `lintas://history`,
`lintas://downloads`, `lintas://bookmarks`, `lintas://settings`.

| Call | Returns |
|---|---|
| `tabs.list()` | `Tab[]` in strip order |
| `tabs.create({ url?, active=true, private=false })` | `Tab` (no url → `lintas://newtab`) |
| `tabs.close(id)` / `tabs.activate(id)` / `tabs.move(id, toIndex)` | `void` |
| `tabs.pin(id, bool)` / `tabs.mute(id, bool)` / `tabs.duplicate(id)` / `tabs.reopenClosed()` | `void` / `Tab` |
| `nav.go(id, input)` | `void` — `input` is whatever the user typed; main decides URL vs search (HTTPS first) |
| `nav.back(id)` / `nav.forward(id)` / `nav.reload(id, { hard })` / `nav.stop(id)` | `void` |
| `nav.zoom(id, "in"|"out"|"reset")` | `number` |
| `nav.find(id, text, { forward=true, findNext=false })` / `nav.stopFind(id)` | `{ matches, active }` |
| `nav.print(id)` / `nav.devtools(id)` | `void` |

Events (subscribe with `lintas.on(event, handler)`, which returns an unsubscribe function):

| Event | Payload |
|---|---|
| `tabs` | `Tab[]` — full list after any change (create/close/title/loading/url…) |
| `find` | `{ tabId, matches, active }` |
| `permission` | `{ requestId, tabId, origin, permission: "media"|"geolocation"|"notifications"|"clipboard-read"|"midi"|"pointerLock", detail }` |
| `download` | `Download` (see below), on every progress change |
| `context` | `{ action: "lookup"|"add-term"|"translate"|"ask", tabId, selection, pageURL }` — after the user chose a Lintas item in the native context menu that needs UI (e.g. "Add to termbase") |
| `online` | `{ online: bool }` |
| `shortcut` | `{ name }` — keyboard shortcuts caught in a web page: `focus-omnibox`, `find`, `new-tab`, `close-tab`, `reopen-tab`, `next-tab`, `prev-tab`, `toggle-panel`, `open-tms` |
| `toast` | `{ kind: "info"|"success"|"error", message }` |

`permissions.answer(requestId, { allow: bool, remember: bool })` answers a prompt.

## Omnibox

| Call | Returns |
|---|---|
| `omnibox.suggest(text)` | `[{ type: "url"|"search"|"history"|"bookmark"|"tab"|"offline"|"tms", title, url, detail }]` (≤ 8) |

## Bookmarks, history, downloads

| Call | Returns |
|---|---|
| `bookmarks.list()` | `[{ id, title, url, folder|null, createdAt }]` |
| `bookmarks.toggle({ url, title })` | `{ bookmarked: bool }` |
| `bookmarks.remove(id)` | `void` |
| `history.list({ q?, limit=200 })` | `[{ url, title, visitedAt, visits }]` newest first |
| `history.clear({ since? })` | `void` |
| `downloads.list()` | `Download[]` |
| `downloads.open(id)` / `downloads.show(id)` / `downloads.cancel(id)` | `void` |

`Download`: `{ id, filename, url, state: "progressing"|"completed"|"cancelled"|"interrupted", received, total, savePath }`

## Offline library

Pages can be saved as a complete single file (MHTML) and opened without a
network. When a page fails to load and a saved copy exists, the tab's `error`
is set and `offlineCopy` filled so the error page can offer "Open saved copy".
With *Auto-save visited pages* on (setting), every page you finish loading is
saved too.

| Call | Returns |
|---|---|
| `offline.save(tabId)` | `OfflinePage` |
| `offline.list({ q? })` | `OfflinePage[]` |
| `offline.open(id, { newTab=false })` | `void` |
| `offline.remove(id)` | `void` |

`OfflinePage`: `{ id, url, title, savedAt, bytes, lang|null, words }`

## Settings and status

| Call | Returns |
|---|---|
| `app.status()` | `{ version, online, hasApiKey, model, models:[{id,label,note}], platform, dataDir, sandbox }` — `sandbox` is false when started with `--no-sandbox` |
| `app.defaultBrowser()` | `{ isDefault, canSetDirectly }` — on Windows `canSetDirectly` is false |
| `app.makeDefault()` | Windows: opens Settings > Default apps and returns `{ ..., openedSettings: true }`; macOS and Linux: registers for http and https |
| `importer.detect()` | `[{ id, name, kind: 'chromium'\|'firefox', profiles: [{ id, name, path }] }]` — browsers found on this computer |
| `importer.run({ browserId, profileId, bookmarks, history, settings })` | `{ source, bookmarks, history, settings: [keys] }` — counts of what was added |
| `importer.fromFile()` | Same result, from a bookmarks HTML file the user picks; `null` if cancelled |

Setting `minimizeToTray` (boolean): minimizing hides the window to the notification area.
| `settings.get()` | `Settings` |
| `settings.set(partial)` | `Settings` |
| `settings.setApiKey(key)` | `{ hasApiKey }` (`""` removes it; the key is encrypted with the OS keychain and never returned) |
| `privacy.clearData({ cache, cookies, history, offline })` | `void` |

`Settings`:
```
{ searchEngine: "duckduckgo"|"google"|"bing"|"startpage"|"brave", homepage: "lintas://newtab",
  httpsOnly: bool, blockTrackers: bool, blockThirdPartyCookies: bool, sendDoNotTrack: bool,
  autoSaveOffline: bool, showBookmarksBar: bool, theme: "system"|"light"|"dark",
  model: string, effort: "low"|"medium"|"high", restoreSession: bool,
  uiLanguage: "en", defaultSourceLang: "en", defaultTargetLang: "id" }
```

## Translation Management System

All TMS data lives on the computer and works offline. Only AI actions need a network.

`Project`: `{ id, name, client|null, sourceLang, targetLang, dueDate|null, createdAt, updatedAt,
  tmIds:[id], termbaseIds:[id], stats: Stats, fileCount }`

`Stats`: `{ segments, words, byStatus: { new, draft, translated, reviewed, approved }, progress (0..1) }`

`File`: `{ id, projectId, name, format, origin: "import"|"web"|"text", url|null, createdAt, stats: Stats }`

`Segment`: `{ id, n, source, target, status: "new"|"draft"|"translated"|"reviewed"|"approved",
  locked: bool, key|null, note|null, comment|null, matchScore|null (0..100, best TM match when last looked up),
  origin: null|"tm"|"mt-ai"|"human", updatedAt|null }`

`TmMatch`: `{ score (0..100), source, target, tmId, tmName, diff: [{ op: "eq"|"del"|"ins", text }] }`
(`diff` compares the TM source with the current segment source.)

`TermHit`: `{ entryId, termbaseId, source, target, status: "preferred"|"admitted"|"forbidden", note, start, end }`
(`start`/`end` are character offsets in the segment source.)

`Issue`: `{ check, severity: "minor"|"major"|"critical", message, segmentId }`

| Call | Returns |
|---|---|
| `tms.dashboard()` | `{ projects: Project[], tms: Tm[], termbases: Termbase[], totals: { words, segments, approved } }` |
| `tms.createProject({ name, sourceLang, targetLang, client?, dueDate? })` | `Project` (creates and attaches a project TM and termbase) |
| `tms.updateProject(id, partial)` / `tms.deleteProject(id)` | `Project` / `void` |
| `tms.getProject(id)` | `Project & { files: File[] }` |
| `tms.importFiles(projectId)` | `File[]` — main shows the native file picker (txt md html docx srt vtt po xliff json csv tmx) |
| `tms.importText(projectId, { name, text })` | `File` |
| `tms.capturePage(tabId, projectId)` | `File` — text of the open web page becomes a file (`origin: "web"`) |
| `tms.deleteFile(projectId, fileId)` | `void` |
| `tms.getFile(projectId, fileId, { offset=0, limit=500, status?, q? })` | `{ file: File, total, segments: Segment[] }` |
| `tms.updateSegment(projectId, fileId, segId, { target?, status?, locked?, comment? })` | `Segment` — setting status `translated`+ writes the pair to the project TM |
| `tms.lookup(projectId, text)` | `{ matches: TmMatch[] (≤5, ≥50 %), terms: TermHit[] }` |
| `tms.pretranslate(projectId, fileId, { minScore=100, useAi=false })` | `{ filled, fromTm, fromAi }` — fills empty targets; AI part needs a key and network |
| `tms.analyze(projectId)` | `{ bands: [{ band: "101%"|"100%"|"95-99%"|"85-94%"|"75-84%"|"50-74%"|"No match"|"Repetitions", segments, words }], words }` |
| `tms.qa(projectId, fileId?)` | `{ checked, issues: Issue[], summary: { [check]: count } }` |
| `tms.export(projectId, fileId, type)` | `{ savedTo }` — native save dialog. `type`: `"original"` (translated file in its own format), `"xliff"`, `"tmx"`, `"csv"`, `"po"`, `"json"`, `"txt"` |

Translation memories (`Tm`: `{ id, name, sourceLang, targetLang, units, updatedAt }`):

| Call | Returns |
|---|---|
| `tms.listTms()` / `tms.createTm({ name, sourceLang, targetLang })` / `tms.deleteTm(id)` | `Tm[]` / `Tm` / `void` |
| `tms.importTmx(tmId)` | `{ added }` — native picker |
| `tms.exportTm(tmId)` | `{ savedTo }` — TMX |
| `tms.searchTm(tmId, { q, limit=100 })` | `[{ id, source, target, createdAt, usage }]` |

Termbases (`Termbase`: `{ id, name, sourceLang, targetLang, entries, updatedAt }`;
`Term`: `{ id, source, target, status: "preferred"|"admitted"|"forbidden", note, pos|null, createdAt }`):

| Call | Returns |
|---|---|
| `tms.listTermbases()` / `tms.createTermbase({...})` / `tms.deleteTermbase(id)` | |
| `tms.listTerms(termbaseId, { q? })` | `Term[]` |
| `tms.addTerm(termbaseId, { source, target, status?, note? })` / `tms.updateTerm(termbaseId, termId, partial)` / `tms.deleteTerm(termbaseId, termId)` | `Term` / `Term` / `void` |
| `tms.importTermbase(termbaseId)` | `{ added }` — TBX or CSV via native picker |
| `tms.exportTermbase(termbaseId)` | `{ savedTo }` — TBX |

## AI (Claude, through the user's own API key)

Every AI call rejects with a clear message when there is no key or no network.
Results are suggestions; nothing is written to a file until the user accepts it.

| Call | Returns |
|---|---|
| `ai.suggest(projectId, fileId, segId)` | `{ target, rationale, usedMatches: number, usedTerms: number }` — uses TM matches, termbase and neighbouring segments as context |
| `ai.review(projectId, fileId, segId)` | `{ verdict: "ok"|"revise", issues: [{ category, severity, explanation, suggestion }], revised|null }` (MQM-style) |
| `ai.translatePage(tabId, { targetLang, projectId? })` | `{ translated, fromTm, fromAi }` — translates the open page in place (text nodes replaced; `ai.restorePage(tabId)` undoes). With `projectId`, approved TM matches are used first and termbase terms are enforced |
| `ai.restorePage(tabId)` | `void` |
| `ai.ask(tabId, question, { history? })` | `{ answer (markdown), citations: [{ n, quote }] }` — answers about the open page; cites paragraph numbers as `[3]`; `ai.highlight(tabId, n)` scrolls the page to paragraph n and flashes it |
| `ai.extractTerms(projectId, fileId)` | `{ terms: [{ source, target, note, frequency }] }` — proposals only; the user adds them |
| `ai.usage()` | `{ inputTokens, outputTokens, requests, since }` this session |

## Native context menu items (main builds the menu)

Web pages get the usual Back / Forward / Reload / Copy / Paste / Save image /
Open link in new tab / Inspect, plus a **Lintas** group when text is selected:
*Look up in TM and termbase*, *Add to termbase…*, *Translate selection*,
*Ask Claude about this*. Items that need UI emit the `context` event with
`action` set to `"lookup"`, `"add-term"`, `"translate"` or `"ask"`; the renderer
opens the side panel on the matching view.

## Additions (implemented in main)

- `Tab` also has `bookmarked: bool` (drives the omnibox star) and `translated: { targetLang }|null` (page is currently shown translated; offer *Show original*).
- `nav.allowHttp(tabId)` — after an HTTPS-only failure, load the page over plain HTTP for this host (session only). Show it on error pages whose `error.url` starts with `https://` when `settings.httpsOnly` is on.
- More `shortcut` names: `bookmark` (Ctrl/Cmd+D), `downloads` (Ctrl/Cmd+J), `history` (Ctrl/Cmd+H), `print` (Ctrl/Cmd+P), `save-offline` (Ctrl/Cmd+S), `new-private-tab` (Ctrl/Cmd+Shift+N), `toggle-bookmarks-bar` (Ctrl/Cmd+Shift+B), `tab-1` … `tab-9`. Reload, back/forward, zoom and devtools are handled in main directly.
- `context` event action `"translate-page"` (from the page context menu).
- Events `translate-progress` `{ tabId, done, total }` and `pretranslate-progress` `{ projectId, fileId, done, total }` while AI work runs; `settings` `Settings` after any settings change.
- `ai.translateText(text, { targetLang, projectId? })` → `{ text }` (translate a selection; uses the project termbase when given).
- `ai.selection(tabId)` → the current text selection in the page.
- `omnibox.suggest` items may carry `tabId` (type `tab`: switch to it) or `offlineId` (type `offline`: `offline.open(offlineId)`).

## Chrome extensions and Claude Desktop

| Call | Returns |
|---|---|
| `extensions.list()` | `[{ id, name, version, description, manifestVersion, source: "store"\|"unpacked", optionsUrl\|null, permissions:[string] }]` |
| `extensions.installFromStore(linkOrId)` | the installed extension |
| `extensions.loadUnpacked()` | `{ id, name }` or `null` if cancelled (native folder picker) |
| `extensions.remove(id)` / `extensions.openOptions(id)` | `void` |
| `claude.status()` | `{ enabled, running, configured, configPath, configError, entry }` |
| `claude.connect()` | writes the `lintas` entry into Claude Desktop's config (with a backup), turns access on; returns status |

The toolbar hosts `<browser-action-list partition="persist:lintas">`, defined by the
preload bundle (`app/preload/chrome.bundle.cjs`, generated by `npm run build:preload`).
Setting `claudeDesktop: bool` starts or stops the local MCP bridge.

# Lintas

A fast, secure desktop web browser (Chromium engine) that works online and
offline, with a built-in **Translation Management System** and AI features
powered by Claude. Built for translators, localizers and linguists who also
write code.

![Lintas TMS editor](docs/screenshots/editor-light.png)

## Features

**Browser**
- Chromium engine (Electron 45), every tab sandboxed, lazy session restore, private tabs.
- Tracker blocking, HTTPS-first with an optional HTTPS-only mode, third-party cookie
  stripping, Do Not Track and Global Privacy Control, per-site permission prompts.
- Tab strip, omnibox with suggestions, bookmarks bar, side panel, find in page, zoom,
  downloads, history and the usual keyboard shortcuts.

**Offline**
- Save any page as one MHTML file. Ctrl/Cmd+S saves the current page.
- When a page fails to load, the error page offers the saved copy.
- Optional auto-save of every page you visit.
- The whole TMS works without a network.

**Translation Management System**
- Projects with a language pair. Import TXT, Markdown, HTML, DOCX, SRT, VTT, PO,
  XLIFF, JSON, CSV or TMX, or capture the open web page.
- Segment editor with statuses (new, draft, translated, reviewed, approved),
  locking, comments, filters and standard CAT shortcuts.
- Translation memory with fuzzy matching: 101 % (exact in context), 100 %, 99 %
  (case or punctuation only) and edit-distance scores, with word-level diffs. Every
  confirmed segment updates the TM. TMX import and export.
- Termbases with preferred, admitted and forbidden terms, recognised in every
  segment, including short inflected suffixes such as Indonesian *-nya*.
  TBX and CSV import, TBX export.
- QA checks:
  - numbers, locale-aware (1,000.50 = 1.000,50)
  - placeholders and tags
  - end punctuation and spacing
  - length ratio
  - missing and forbidden terms
  - inconsistent translations
- Match-band analysis report, pre-translation from the TM, and export back to the
  original format (PO, XLIFF, JSON, CSV, SRT/VTT, DOCX, HTML, TXT/MD) or to XLIFF,
  TMX, PO, JSON or CSV.

**AI (Claude, with your own API key)**
- Segment suggestions that use TM matches, the termbase and the neighbouring segments.
- MQM-style review and term extraction.
- Translate the open page in place: TM matches first, termbase enforced, one click
  to restore the original.
- Ask about the page and get answers with clickable paragraph citations.
- The key is stored encrypted with the operating system's keychain and is sent only
  to `api.anthropic.com`. Everything else in Lintas works without a key.

## Run from source

Requires Node.js 20 or later.

```bash
cd lintas
```

```bash
npm install
```

```bash
npm start
```

On first run, a sample English → Indonesian project is created so the TMS has
something to show. Add your Anthropic API key under Settings → AI to use the AI
features. The default model is Claude Opus 5.5; you can switch to Sonnet 5.5,
Haiku 5.5 or Fable 5.2 there.

Linux containers or CI running as root need `npm start -- --no-sandbox`, because
Chromium refuses to sandbox as root. Each page keeps its own sandbox.

## Build installers

```bash
npm run dist:linux
```

`dist:win` and `dist:mac` build the Windows (installer and portable) and macOS
(dmg and zip) versions on those systems. The `lintas` GitHub workflow builds all
three on every change and keeps them as downloadable artifacts. The builds are
not code-signed.

## Tests

```bash
npm test
```

runs the unit tests for the text engine, parsers, TM, QA, TMS and security
rules.

```bash
xvfb-run -a node test/app.smoke.mjs
```

starts the real app and checks, end to end:
- browsing and tracker blocking
- history
- offline save and open, and the error page's saved-copy offer
- the TMS through the app's internal interface
- in-page translation and restoring the original page
- that AI features refuse to run without an API key

The end-to-end test needs Playwright.

## Layout

```
app/main/       Electron main process: tabs, security, offline library, Claude client
app/preload/    the only bridge to the interface (window.lintas)
app/renderer/   browser interface and TMS screens (vanilla JS, no network access)
core/           text engine, file formats, translation memory, QA and the TMS
docs/           IPC.md (interface contract), DESIGN.md, ANALYSIS.md (Opera Neon comparison)
```

## Known limits

- DOCX export keeps paragraphs but not run formatting (bold, styles).
- Third-party cookie blocking strips cookies on cross-site requests. It does not
  partition storage the way Chrome or Firefox do.
- There is no extension support and no sync between devices.

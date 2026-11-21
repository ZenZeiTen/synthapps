# Lintas — interface design rationale

**Goal.** A browser that feels familiar on day one (the conventions of Chrome, Edge, Firefox and Safari) with a
professional CAT tool living inside it. One calm visual language covers both, so moving from a web page to a
segment editor never feels like switching apps.

## Structure

| Layer | What it is | Convention followed |
|---|---|---|
| Tab strip (40 px, window title bar) | Rounded tabs that merge into the toolbar; favicon, title, spinner, audio, close; pinned icon tabs; shrink → scroll overflow; drag to reorder; middle-click closes; private tabs carry a mask icon and tint the frame violet | Chrome / Edge |
| Toolbar (44 px) | Back, forward, reload/stop, home · pill omnibox · translate, save offline, side panel, downloads (progress ring), ⋮ menu | Chrome |
| Omnibox | Security chip at the left (padlock / "Not secure" / "Offline copy" / "Lintas"), host emphasised until focus, suggestion dropdown with arrow-key navigation, tracker shield with per-page count, bookmark star | Chrome + Firefox shield |
| Bookmarks bar (optional) | Chips, folders as menus, overflow chevron | all |
| Content | Native web view (main) or an internal `lintas://` page / error page (renderer). Find bar docks top-right | all |
| Side panel (320–640 px, resizable) | Assistant · Translate · Terms · Offline; sits *beside* the page so the page never has to be hidden | Edge / Chrome side panel |
| Prompts | Permission bubble anchored under the omnibox (Allow / Block / Remember), downloads bubble, site-info bubble | Chrome |

The TMS follows what translators know from Phrase, memoQ, Trados and Smartcat: project cards with language-pair
chips and due dates; a file table with status-split progress bars; a standard analysis report; and a
two-column segment grid with a CAT pane (TM matches with diff, term hits, AI, comment, QA) and the usual
shortcuts (Ctrl+Enter, Ctrl+1–5, Ctrl+Shift+S, Ctrl+↑/↓, Ctrl+Shift+L).

## Design system (`styles/base.css`)

- **Colour.** Cool neutral greys and one accent, *Selat teal* (`#0B7A75` light, `#56CFC6` dark), used for
  focus, selection, primary actions and progress only. Semantic colours (danger, warn, ok) are reserved for meaning.
  Light and dark are the same tokens re-valued under `:root[data-theme]`; `settings.theme = "system"` follows
  `prefers-color-scheme`. Text/background pairs meet WCAG AA.
- **Segment statuses** never rely on colour alone — each has its own icon shape:
  new ○ grey · draft ✎ amber · translated ✓ blue · reviewed ✓✓ violet · approved ⊙✓ green.
  Term statuses: preferred (green edge), admitted (blue edge), forbidden (red, struck through, not insertable).
  Diff: deletions red + strike-through, insertions green + underline.
- **Type.** System UI stack for chrome (13 px base; scale 11 · 12 · 13 · 14 · 15 · 16 · 20 · 24 · 32).
  Editor text is 15 px / 1.55 for long sessions. Segment and user text is `dir="auto"` with `lang` set, so mixed
  scripts and RTL render correctly. Numbers use tabular figures.
- **Space and shape.** 8 px grid (4 px half-step). Radii 6 / 8 / 12 / 16 / pill. 1 px dividers; three elevation
  levels (cards, bubbles, dialogs).
- **Motion.** 120 ms hover, 160 ms panels, 200 ms dialogs, one easing curve `cubic-bezier(.2,0,0,1)`; all
  disabled under `prefers-reduced-motion`.
- **Icons.** One hand-drawn inline-SVG set (`lib/icons.js`): 24 px grid, 1.75 px round strokes. No icon fonts.
- **Focus.** 2 px accent ring on `:focus-visible` everywhere; menus, dialogs and the omnibox list are fully
  keyboard-operable and trap/restore focus.

## Engineering choices that shape the UX

- **No framework, no build, no network.** ES modules, one `h()` element helper; data only ever reaches the DOM
  as text nodes or attributes. Assistant markdown goes through a small tokenising renderer with a fixed
  element whitelist. Strict CSP in `index.html`.
- **Native view handshake.** `#viewport` is observed with a `ResizeObserver` and reported via
  `view.setBounds`; every menu, bubble, dialog and the omnibox dropdown takes a "hold" that calls
  `view.setVisible(false)` and releases it on close. The find bar and side panel reduce the rectangle instead
  of covering the page.
- **Large files.** The editor pages segments through `getFile(offset, limit)` (100 per page) and rows use
  `content-visibility: auto`, so only what is on screen is laid out; typing saves are debounced and never
  rebuild the active row.
- **Offline first.** Offline state is visible (toolbar chip, new-tab status) and never a dead end: error
  pages offer the saved copy, the offline library and the TMS.
- **Preview mode.** Without the Electron preload, `mock.js` implements the whole contract with
  Indonesian–English sample data so the interface can be developed and reviewed in any browser.

# AI Oracle — build contract

AI Oracle replaces the **Assistant** view of Lintas's side panel (`app/renderer/ui/sidepanel.js`,
`viewAssistant`). It is an agentic chat about the page in the active tab. Claude works through tools,
and the interface shows which of four roles is working.

Source brief: the user's document "Build Agentic AI Chat Bot in the browser":
- the Neo-Oriental Fusion look, "Digital Sage Meets Premium Tech";
- the Jade Wisp mascot;
- the Council of Minds.

## Ground rules (all agents)

- **Honesty.** The interface shows only real activity. A role lights up only while its tool runs, or
  while Claude is planning between tool calls. No fake progress, no invented agents.
- **Stack.** Lintas is Electron and plain ES modules: no React, Next.js, Three.js or bundler for the
  renderer.
  - The CSP is `default-src 'self'; img-src 'self' data: https: http:; style-src 'self' 'unsafe-inline'; script-src 'self'`.
    So there are no web fonts from the internet and no external scripts.
  - The mascot is SVG + CSS (transform/opacity animations only, so they run on the GPU). Canvas is
    allowed if needed; WebGL is not needed.
- **Fonts.** Use local stacks only:
  - English: `Inter, "SF Pro Display", Manrope, var(--font-ui)`.
  - Asian accent: `"Noto Serif SC", "Noto Serif JP", "Noto Serif TC", "Songti SC", "Yu Mincho", serif`.
    Use it for headers and decorative labels only.
- **Themes.** Light is the "Day" theme (parchment ivory, watercolor mountains). Dark is the "Night"
  theme (black lacquer, golden constellations). The theme follows `:root[data-theme="light"|"dark"]`.
- **Reduced motion** (`@media (prefers-reduced-motion: reduce)`) turns off the float, the particles and
  the dragon. Role states stay visible through shape and icon, never through color alone.
- **Plain language** in all text the user sees. Sound is muted by default.
- **Space.** The side panel is 320–900 px wide (default 384) and as tall as the window. Use the
  mascot's "mobile" size: 75 px, above the composer, bottom-right of the panel.

## Palette tokens (in `app/renderer/styles/oracle.css`, scoped to `.oracle`)

| Group | Tokens |
|---|---|
| Primary | `--o-obsidian:#0F0F12` `--o-jade:#2F8F83` `--o-gold:#D4AF37` |
| Secondary | `--o-ivory:#F5F3EE` `--o-burgundy:#6D1F2B` `--o-navy:#19233C` |
| Accent | `--o-cyan:#4FD7FF` `--o-amber:#F2A65A` |
| Jade core | `#3CBF9A` / `#4FD8C8` / glow `#A8FFF2` |
| Gold | `#D4AF37` / highlight `#F4D96B` / shadow `#83621A` |

Message bubbles:
- **User:** dark jade bubble, white text, rounded rectangle.
- **AI:** ivory background, gold accent border, dark ink text, gentle shadow. In the Night theme, use a
  dark lacquer surface, keep the gold border, and use ivory text with enough contrast (WCAG AA).

## Roles (the Council)

| Role id | Label shown | Lights up while | Mascot visual |
|---|---|---|---|
| `research` | Researcher gathering evidence | reading the page or tabs, searching the page, web search, offline list | blue constellation particles ✦ ✧ ✦, extra halo |
| `planning` | Strategist forming a plan | Claude is generating between tool calls (thinking or a planning turn) | golden triangles and hexagons rotating |
| `memory` | Memory recalling context | memory recall/save, translation memory and termbase lookups, TMS reads | ancient glyph fragments, memory threads |
| `action` | Agent taking action | tools that change something: open a tab, save offline, TMS writes | energy streams toward the interface |

**Council mode.** When two or more roles have been active in one answer, the mascot shows four orbiting
spirit fragments, one per role, with the active ones lit.

## Backend → renderer protocol (owned by the backend agent)

### Renderer API (preload namespace `oracle`, in `app/preload/chrome.cjs`)

| Call | What it does |
|---|---|
| `oracle.ask(tabId, text, { history })` | Returns `{ runId }`. `history`: `[{ role: 'user'\|'assistant', content }]` |
| `oracle.approve(runId, callId, allow: boolean)` | Answers an approval request |
| `oracle.stop(runId)` | Stops a run |
| `oracle.memory()` | Returns `[{ id, text, savedAt }]` |
| `oracle.forget(id)` | Removes one memory; `id` `'*'` clears all |

### Events: `lintas.on('oracle', ev)` with `ev.runId` on every event

| `ev.type` | Fields | Meaning |
|---|---|---|
| `role` | `role`, `state: 'active'\|'idle'`, `detail` | Plain-language description of the current step, e.g. "Reading the page" |
| `tool` | `callId`, `name`, `title`, `status: 'running'\|'done'\|'error'\|'denied'`, `summary?` | A tool call started or finished |
| `approval` | `callId`, `name`, `title`, `detail` | Needs `oracle.approve` before it runs |
| `text` | `delta` | Streamed answer text |
| `done` | `answer`, `citations: [{ n, quote }]`, `usage: { inputTokens, outputTokens }`, `roles: string[]` | Final answer; `roles` lists those used |
| `error` | `message` | Plain-language error |

Citations keep the existing format: `[n]` refers to paragraph `n` of the attached tab's page.
`ai.highlight(tabId, n)` scrolls to it.

## Renderer modules

| File | Owner | Purpose |
|---|---|---|
| `app/renderer/styles/oracle.css` | design | All Oracle styles, linked from `index.html` |
| `app/renderer/ui/oracle-wisp.js` | design | `createWisp({ size })` and `createCouncil()`, described below |
| `app/renderer/ui/oracle.js` | frontend execution | `viewOracle(body, tab, intent)`: chat, streaming, approvals, memory list. Called from `sidepanel.js` in place of `viewAssistant` |
| `docs/oracle-design.md` | design | Markup contract: class names and DOM structure for header, log, bubbles, approval card, composer, council strip, background layers |

### `createWisp({ size })`

Returns `{ el, setState, setRoles, manifest, destroy }`:
- `setState(s)`: `s` is `'idle' | 'thinking' | 'speaking' | 'error'`.
- `setRoles(active: Set<role>)`.
- `manifest()`: plays the dragon, but only if allowed. It is rate-limited to once per 15 minutes and is
  skipped with reduced motion.

### `createCouncil()`

Returns `{ el, update(states: { [role]: 'idle'|'active'|'done' }), reset() }`. This is the "Wisdom Council
Convening" strip: glowing seals appear one by one, each with its role label.

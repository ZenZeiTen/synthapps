# AI Oracle — design and markup contract

Files: `app/renderer/styles/oracle.css` (all styles), `app/renderer/ui/oracle-wisp.js` (mascot and council),
`docs/oracle-preview.html` (static mock; serve the repo and open it, see the query string notes on the page).
Read `docs/oracle-contract.md` first: this file only adds the look and the DOM.

## Rationale

**Neo-Oriental Fusion, quietly.** The panel is a clean modern chat first (the 40 % Apple/Anthropic share):
system sans text, one column, generous spacing. The "sage" layer is carried by four restrained things:
a serif accent for the title and small labels, a thin gold trim, jade as the only saturated colour, and
low-opacity ink motifs behind the content. Nothing is drawn as an ornament on top of text.

**Day and Night.** Day is parchment ivory with rice-paper grain, blurred watercolor ridges and a seal-red
sun at the bottom of the panel. Night is black lacquer with golden constellations and slow gold motes.
Both follow `:root[data-theme]`. All motifs are CSS gradients or inline SVG data URIs (several used as
masks so they take the theme colour); there are no image files.

**Bubbles.** The user speaks in dark jade (`#1F6B62`, white text, 6.3:1). The Oracle answers on an ivory
card (lacquer at night) with a gold hairline border and a gold accent bar. Gold is never used for body
text: labels use `--o-gold-ink` (dark gold by day, pale gold at night) to stay above WCAG AA.

**Honest activity.** Tool steps and the council strip show only what the backend reports. A council seal
does not exist on screen until its role has really been active; then it stays as "Done". Each role has
its own shape (star, hexagon, seal tablet, arrow in a circle) and a text state, so colour is never the
only signal.

**Jade Wisp.** Silhouette: glowing orb, three rings (engraved gold, glyph segments, energy ellipse) and
an energy tail. Every ring is its own layer animated with `transform` only. Speed changes (thinking,
hover) are applied through `playbackRate`, so the rings ease instead of jumping. With reduced motion the
float, particles, motes and dragon are off; states stay readable through shape and labels.

## Tokens

All tokens are defined on `.oracle` and `.o-wisp` and re-declared for night. Contract palette:
`--o-obsidian --o-jade --o-gold --o-ivory --o-burgundy --o-navy --o-cyan --o-amber --o-jade-a --o-jade-b
--o-jade-glow --o-gold-hi --o-gold-lo`. Semantic (use these in new rules): `--o-bg --o-surface --o-surface-2
--o-glass --o-ink --o-ink-2 --o-ink-3 --o-line --o-gold-line --o-gold-ink --o-jade-deep --o-jade-ink
--o-danger --o-danger-soft --o-r-research --o-r-planning --o-r-memory --o-r-action --o-font --o-serif`.

## Markup contract

Mount this inside `.sp-body` (it is `flex: 1` and fills the panel). Icons marked *(icon)* are the usual
Lintas `icon()` SVGs (`svg.ic`); everything else is drawn by CSS, so leave those elements empty.

```
div.oracle [data-state="idle|running"] [data-view="chat|memory"]
├─ div.o-bg [aria-hidden="true"]                      background layers, keep all five, in this order
│   ├─ i.o-bg-paper    i.o-bg-scene    i.o-bg-motes
│   └─ i.o-bg-corner.tl    i.o-bg-corner.br
├─ header.o-head
│   ├─ span.o-crest [aria-hidden]                     geometric crest, empty
│   ├─ div.o-title
│   │   ├─ h2.o-name            "AI Oracle"
│   │   └─ span.o-tag           "Many Minds. One Guiding Light."
│   ├─ div.o-actions                                  actions slot
│   │   └─ button.o-act [aria-label] [aria-pressed?]  (icon) + span "Memory" / "New"
│   └─ i.o-trim [aria-hidden]                         gold trim line, empty
├─ div.o-context                                      page-context line
│   ├─ favicon (existing favicon()/.fav-letter)
│   ├─ span.o-context-title [dir=auto]
│   └─ span.o-context-host
├─ div.o-note.warn                                    "needs API key" note (omit when a key exists)
│   └─ b + text + button.o-btn "Open settings"
├─ div.o-log [role="log"] [aria-live="polite"]        conversation log (scrolls)
│   ├─ div.o-empty                                    empty state
│   │   ├─ span.o-empty-kicker  "Ancient Wisdom. Infinite Intelligence."
│   │   ├─ h3                   "Ask about this page"
│   │   ├─ p
│   │   └─ div.o-chips > button.o-chip                prompt chips
│   ├─ div.o-msg.user [dir=auto]                      user bubble (plain text)
│   ├─ div.o-steps [role="list"]                      tool steps of one run
│   │   └─ div.o-step [role="listitem"] [data-status="running|done|error|denied"]
│   │       ├─ span.o-step-ic [aria-hidden]           empty; CSS draws spinner / check / cross / ban
│   │       ├─ span.o-step-title                      ev.title, e.g. "Reading the page…"
│   │       └─ span.o-step-sum                        optional ev.summary
│   ├─ div.o-approval [role="group"] [aria-label="Permission needed"] [data-state="pending|allowed|denied"]
│   │   ├─ span.o-approval-kicker   "Permission needed"
│   │   ├─ div.o-approval-head      ev.title
│   │   ├─ p.o-approval-detail      ev.detail
│   │   ├─ div.o-approval-actions
│   │   │   ├─ button.o-btn.primary "Allow"
│   │   │   └─ button.o-btn         "Don't allow"
│   │   └─ div.o-approval-result    "Allowed" / "Not allowed" (shown when state is not pending)
│   ├─ div.o-msg.ai [data-streaming?]                 AI bubble
│   │   ├─ div.o-who                "Oracle"
│   │   ├─ div.o-body.md            renderMarkdown() output; inline citations stay button.cite
│   │   └─ div.o-cites              optional
│   │       └─ button.o-cite [title="Show on the page"] > b "[n]" + span [dir=auto] "“quote”"
│   └─ div.o-msg.err [role="alert"]                   error message
├─ div.o-memory                                       memory list view (shown when data-view="memory")
│   ├─ div.o-memory-head > h3 + button.o-btn.danger "Forget all"
│   ├─ p.o-memory-hint
│   ├─ ul.o-memory-list
│   │   └─ li.o-memory-item
│   │       ├─ p.o-memory-text [dir=auto]
│   │       ├─ time.o-memory-date
│   │       └─ button.o-icon-btn [aria-label="Forget this"]   (icon)
│   └─ div.o-memory-empty           when the list is empty
└─ div.o-foot
    ├─ div.o-wisp-slot              append wisp.el here (absolute, bottom-right, above the footer)
    ├─ council.el                   (section.o-council) insert before the composer
    └─ form.o-composer
        ├─ textarea [rows=1] [dir=auto] [aria-label]
        ├─ button.o-send [type=submit] [aria-label="Send"]     empty; CSS draws the arrow
        └─ button.o-stop [type=button] [aria-label="Stop"]     empty; CSS draws the square
```

### State classes and attributes

| Element | Attribute | Effect |
|---|---|---|
| `.oracle` | `data-state="running"` | shows `.o-stop`, hides `.o-send`. Set it from `oracle.ask` until `done`/`error`. |
| `.oracle` | `data-view="memory"` | shows `.o-memory`, hides `.o-log` and `.o-foot`. Any other value shows the chat. |
| `.o-act` | `aria-pressed="true"` | pressed look (use on "Memory" while the list is open). Labels inside `<span>` hide below 440 px. |
| `.o-step` | `data-status` | `running` spinner + bold title · `done` check · `error` cross, red summary · `denied` dashed ban, struck title. |
| `.o-approval` | `data-state` | `pending` shows the buttons; `allowed`/`denied` hides them and shows `.o-approval-result` (set its text). |
| `.o-msg.ai` | `data-streaming` | jade caret after the last block of `.o-body`. Remove on `done`. Before any text arrives use `<span class="o-caret">` inside an empty `.o-body`. |
| `.o-send` | `disabled` | dimmed (empty input, or no API key). |

Notes:
- The log has 122 px of bottom padding so the newest message scrolls clear of the mascot. Keep `.o-empty`
  as the only child while there are no messages (it centres itself vertically).
- Put `.o-steps` and `.o-approval` in the log in the order events arrive, before the answer bubble they
  belong to. Add steps on `tool` `running`, then update `data-status` on the same element by `callId`.
- `.o-btn` (`.primary`, `.danger`), `.o-icon-btn` and `.o-chip` are Oracle's own buttons; base `.btn`
  also works but will look like the rest of Lintas.
- Focus rings come from `.oracle :focus-visible`; do not remove outlines.

## `oracle-wisp.js`

```js
import { createWisp, createCouncil } from './oracle-wisp.js';

const wisp = createWisp({ size: 75 });       // { el, setState, setRoles, manifest, destroy }
slot.append(wisp.el);                        // slot = .o-wisp-slot
const council = createCouncil();             // { el, update, reset }
foot.insertBefore(council.el, composer);
```

**Wisp** (`div.o-wisp`, `aria-hidden="true"`, decorative).
- `setState('idle' | 'thinking' | 'speaking' | 'error')` → `data-state` on `el`. Idle floats; thinking
  speeds the rings and pulses the core; speaking orbits slowly and pulses; error stops the float, greys
  the core, adds a burgundy ring and a "!" mark.
- `setRoles(active)` takes a `Set` or array of role ids currently active (empty when none). One role →
  its effect layer (research: blue halo and stars; planning: gold triangle, hexagon and route; memory:
  glyph fragments and threads; action: amber arrows toward the composer). The wisp remembers every role
  it was given during the run; from the second distinct role on it switches to **council mode**: four
  fragments in a diamond (research top, planning right, memory bottom, action left), active ones lit.
  The memory resets when `setState('thinking')` is called from `idle` or `error`, i.e. at the start of a
  run — so call `setState('thinking')` when a run starts and `setState('idle')` when it ends.
- `manifest()` → `boolean` (true if it played). Enforces once per 15 minutes itself, and skips with
  reduced motion, a hidden window or a detached element. Call it only on `done` of a long run
  (suggested: 3 or more tool calls, or more than 20 s). It lasts 4.2 s, never blocks input.
- `destroy()` removes listeners and the element. Call it when the view is torn down.
- Extra exports: `ROLES`, `ROLE_LABELS`, and `resetManifestLimit()` (preview and tests only).

**Council** (`section.o-council`, hidden until a role has worked).
- `update({ research, planning, memory, action })` with `'idle' | 'active' | 'done'`; missing keys are
  left as they are. Map `role` events: `state: 'active'` → `'active'`; `state: 'idle'` → `'done'` if the
  role was active in this run. A seal appears the first time its role is active and stays until
  `reset()`. The title reads "Wisdom Council Convening" while any role works, then "The council has
  spoken".
- `reset()` hides everything; call it when a new question is sent.
- Screen readers: role changes are spoken through a visually hidden `aria-live="polite"` line inside the
  strip ("Researcher gathering evidence." / "Researcher finished."). Labels are real text.

Both elements stop their animations while `document.hidden`.

## Deviations from the brief

- Float amplitude is 12 % of the mascot size (±9 px at 75 px, ±12 px at 100 px) instead of a fixed
  ±12 px, so it stays calm in a narrow panel.
- The council shows the four contract roles only, each lit by real events (no Analyst, no scripted lines).
- User bubble uses `--o-jade-deep` (#1F6B62) rather than `--o-jade` (#2F8F83): white text on #2F8F83 is
  3.9:1 and fails AA.
- `oracle.css` is about 38 KB unminified (target was 30 KB); most of the extra is inline SVG art.
- Unprefixed `mask` is used (Electron 45 / current Chromium supports it).

# Multimodal LQA — Screenshots, Video, In-Build

Review of a spreadsheet catches mistranslation. Only review of the rendered asset catches
truncation, wrong-context reuse, font fallback, and audio-visual mismatch. Different asset types
expose different defect families, so run the protocol that matches the asset.

Severity and scoring use the MQM model in `game-loc-ops` (`references/lqa-mqm.md`). Do not invent
a second scale.

## Contents

1. Before you start
2. Screenshot and image protocol
3. Video and cinematic protocol
4. In-build protocol
5. Defect families and how to name them
6. Writing a bug the engineer can act on
7. Coverage planning

---

## 1. Before you start

Confirm four things or the pass is not reproducible:

1. **Build or asset version.** Version, date, and where it came from.
2. **Locale and device.** Language, region setting, device model or resolution, font size setting.
3. **Account state.** Level, VIP tier, unlocked systems, event participation — many strings only
   render under specific state.
4. **Scope.** Which screens, which flows, which event, and the time box.

Redact build IDs, debug overlays, account identifiers and unreleased content before attaching
evidence (`game-loc-ops` Gate 0).

---

## 2. Screenshot and image protocol

Work through each image in this order. Order matters: display defects mask linguistic ones.

**Pass A — display integrity**
- Truncation, clipping at the container edge, forced ellipsis
- Overlap with adjacent elements or artwork
- Overflow outside the container
- Wrong wrapping — a two-word label breaking across three lines, orphaned single characters
- Vertical clipping of ascenders and descenders (common with diacritics)
- Missing glyphs rendered as boxes (tofu) or blanks
- Mojibake — encoding corruption
- Font fallback mismatch inside one label — two typefaces in one string
- Size inconsistency between parallel elements
- Text baked into artwork that was never externalized

**Pass B — content correctness**
- Wrong string in the slot (a common symptom of ID reuse)
- Untranslated fragments, including placeholder names left raw
- Placeholder rendered literally (`{0}`, `%s`, `{player_name}` visible to the player)
- Number, date, time and currency formatting against the locale rule
- Terminology against the termbase
- Register consistent with the screen's role

**Pass C — context and function**
- Does the label describe what the control actually does on this screen?
- Does the button verb match the destination?
- Are parallel items grammatically parallel?
- Does a shared string read correctly in *this* context, given it is reused elsewhere?
- Is the reading order correct for the target script?

**Pass D — cultural and compliance**
- Symbols, gestures, colours, flags, maps in the image (see `cultural-risk.md`)
- Gambling register in monetization surfaces
- Missing disclosure where the market requires it

---

## 3. Video and cinematic protocol

Run passes A–D on every frame containing text, then add:

**Pass E — timing and legibility**
- Subtitle reading speed. A common working ceiling is roughly 17–20 characters per second for
  Latin scripts and lower for logographic scripts; confirm the client's spec rather than assuming.
  **Inference** unless the client publishes a figure.
- Minimum on-screen duration — very short cues are unreadable regardless of accuracy
- Line count and line length per subtitle
- Line breaks that split a syntactic unit
- Subtitle appearing before or after the corresponding audio
- On-screen text that leaves before it can be read at target length
- Text colliding with UI motion, transitions or particle effects
- Contrast against a moving background

**Pass F — audio-visual consistency**
- Subtitle matches the delivered VO line, not an earlier script revision
- Speaker attribution correct
- VO register matches the character bible
- Lip-sync claims the script cannot support (if the build claims sync)
- Audio referencing an on-screen element that the localized build changed
- Sound effects or music with cultural or regional implications
- Silence where a localized VO line should exist

**Pass G — asset parity**
- Every localized video exists for every declared language
- Localized artwork matches the localized text
- Trailers and store videos match the in-game build's terminology

---

## 4. In-build protocol

Everything above, plus the defects only a running game exposes:

- **Runtime variable data.** Real player names, guild names, item names and quantities entering
  placeholders. Gender and plural agreement breaks here, not in the spreadsheet.
- **Concatenation at runtime.** Sentences assembled from fragments.
- **State-dependent strings.** Locked/unlocked, owned/not owned, sufficient/insufficient.
- **Shared-string collisions.** One ID rendering in two screens with incompatible readings.
- **Dynamic layout.** Containers that resize, scroll or reflow with content length.
- **Device font size setting.** Accessibility text scaling breaking layouts.
- **Deep links.** Push and mail CTAs landing on the wrong screen.
- **Timezone rendering.** Whether displayed reset and settlement times match the stated frame.
- **Error and edge states.** Network loss, insufficient currency, purchase failure, maintenance.

Reproduce every finding twice before filing. A defect you cannot reproduce is a note, not a bug.

---

## 5. Defect families and how to name them

Use a consistent family label so the report aggregates cleanly.

| Family | Covers |
|---|---|
| DISPLAY | Truncation, overlap, clipping, wrapping, overflow |
| FONT | Missing glyphs, tofu, fallback mismatch, mojibake, diacritic clipping |
| VARIABLE | Placeholder visible, wrong placeholder, unfilled, wrong resolved value |
| CONTEXT | Right words, wrong screen or function; shared-string collision |
| ACCURACY | Mistranslation, omission, addition, wrong mechanic |
| TERMINOLOGY | Termbase violation, internal inconsistency, do-not-translate breached |
| STYLE | Register, tone, voice, style-guide breach |
| FORMAT | Number, date, time, currency, unit, capitalization, punctuation |
| UNLOCALIZED | Source text remaining, untranslated asset, missing localized video |
| AV | Subtitle timing, VO mismatch, speaker error, missing audio |
| CULTURE | Cultural, religious, political, regional risk |
| COMPLIANCE | Disclosure, rating, platform policy, dark pattern |
| SOURCE | The defect exists in the source and affects every locale |

**SOURCE is the important one.** A defect that is present in every locale is a source defect and
must be routed as such, otherwise every locale team fixes it separately and inconsistently.

---

## 6. Writing a bug the engineer can act on

Minimum fields — see `assets/lqa-multimodal-report-template.csv`:

- Bug ID, date, reporter
- Build or asset version
- Locale, device, resolution, account state
- Location: screen path, or video timestamp, or image filename plus coordinates
- String ID (retrieve it; "the button on the left" costs someone an hour)
- Family and MQM category
- Severity
- Source text, current target text, proposed target text
- Steps to reproduce, numbered
- Expected vs actual
- Evidence: redacted screenshot or clip
- Root-cause hypothesis: text, layout, font, code, or source
- Whether it reproduces in other locales

**Root-cause hypothesis matters.** "Text is cut off" routed to the localization team when the
container is 96px wide wastes a cycle. If the target is the shortest reasonable form and it still
does not fit, say so and route to UI.

---

## 7. Coverage planning

You will not test everything. Choose deliberately:

1. **Monetization and event surfaces first.** Highest cost of failure.
2. **New content in this drop.** Regression on unchanged content is lower yield.
3. **Longest-expanding locales first** for display defects — a truncation that appears in German
   or Vietnamese often exists latently everywhere.
4. **Shared strings and reused IDs** — highest defect density per string reviewed.
5. **First-session and first-purchase flows** — highest player exposure.
6. **Error and edge states** — routinely untested and routinely broken.

Report coverage explicitly: what you tested, what you did not, and what risk that leaves. A pass
that does not state its own gaps invites a false sense of completeness.

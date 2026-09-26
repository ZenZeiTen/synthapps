# Gate 1 — Internationalization Readiness Audit

Run this before a single string is sent for translation. Every finding here is cheap now and
expensive later: the same defect found during LQA costs a code change *plus* retranslation
*plus* a retest across every shipped locale.

## Contents

1. [Severity model for audit findings](#severity-model)
2. [Text externalization](#1-text-externalization)
3. [Sentence assembly and concatenation](#2-sentence-assembly-and-concatenation)
4. [Placeholders and rich-text tags](#3-placeholders-and-rich-text-tags)
5. [Plurals, gender, and ordinals](#4-plurals-gender-and-ordinals)
6. [Text expansion budgets](#5-text-expansion-budgets)
7. [Fonts, glyphs, and shaping](#6-fonts-glyphs-and-shaping)
8. [Encoding](#7-encoding)
9. [Bidirectional and RTL layout](#8-bidirectional-and-rtl-layout)
10. [Locale conventions](#9-locale-conventions)
11. [Pseudo-localization as a CI gate](#10-pseudo-localization-as-a-ci-gate)
12. [Engine notes: Unity and Unreal](#11-engine-notes)
13. [Audit checklist](#12-audit-checklist)

---

## Severity model

| Severity | Meaning | Gate effect |
|---|---|---|
| BLOCKER | Cannot be fixed by translation; requires a code or asset change | Gate fails |
| MAJOR | Will produce visible defects in at least one target locale | Fix before G3 |
| MINOR | Degrades quality or increases LQA cost | Fix when convenient |
| NOTE | Informational, or a decision the team must record | No gate effect |

---

## 1. Text externalization

Every player-visible string lives in a resource file — string table, PO, CSV, JSON — never in
code, never baked into a texture, never assembled from a switch statement.

Common misses, all BLOCKER:

- debug and error text that ships to players
- text rendered into image assets (splash screens, tutorial overlays, signage textures)
- storefront metadata, achievement/trophy names and descriptions, EULA and legal screens
- platform-facing strings: save-data descriptions, activity names, rich-presence text
- text in shipped video subtitles burned into the video track
- profanity filters and moderation word lists (these need per-locale lists, not a translation)

Also flag as MAJOR: **string reuse across contexts.** "Save" as a verb on a button and "Save"
as a noun in a menu header are the same English string and different strings in most target
languages. One ID per context, even when the source text is identical.

Mark non-localizable strings explicitly (`@DNT`, `translate="no"`, or a dedicated column) so
they are not sent for translation and not flagged as untranslated during QA.

## 2. Sentence assembly and concatenation

Concatenation is the defect that most reliably survives to launch, because it looks correct
in the source language.

BLOCKER patterns:

```
// Broken — word order and agreement are language-specific
label = itemName + " destroyed by " + attackerName;
message = "You found " + count + " " + itemPlural;
```

Correct pattern — one string, one complete sentence, named placeholders:

```
"{Attacker} destroyed {Item}"
"{Count}|plural(one=You found {Count} {Item}, other=You found {Count} {Items})"
```

Why it matters beyond word order: many languages inflect the noun according to the verb, the
number, or the case. A fragment cannot be inflected because the translator never sees what it
attaches to. Japanese, Korean, and Tamil place the verb at the end, so a "prefix + suffix"
assembly is structurally untranslatable.

Also BLOCKER: building a sentence from a UI list ("Equip" + item name) where the item name
needs a different grammatical case than the standalone form.

## 3. Placeholders and rich-text tags

**Rules:**

- Use **named** placeholders (`{PlayerName}`), not positional (`{0}`, `%s`). Named placeholders
  survive reordering and tell the translator what the value is.
- Placeholders must be reorderable. If the format string is positional and the code assumes
  order, that is a BLOCKER for any language with different constituent order.
- Document what each placeholder resolves to, including sample values and maximum realistic
  length. `{PlayerName}` can be 16 characters of Cyrillic or 3 of Japanese; the layout must
  survive both.
- Rich-text and markup tags (`<b>`, `<color=#FF0000>`, `<sprite=12>`, `[icon:gold]`) must be
  preserved exactly. Tags that wrap translated text must be allowed to move; tags that wrap a
  placeholder must move with it.
- Never place a placeholder immediately adjacent to a case-sensitive particle without allowing
  the translator to restructure. Korean postpositions are the classic case — Unreal provides
  Hangul post-position modifiers for exactly this.

`scripts/locstring_lint.py` checks placeholder multiset equality and tag balance between
source and target. It cannot check semantic correctness — a human still confirms that
`{Attacker}` and `{Victim}` were not swapped.

## 4. Plurals, gender, and ordinals

**Never branch on `count == 1` in code.** CLDR defines up to six cardinal plural categories:
`zero`, `one`, `two`, `few`, `many`, `other`. Which categories a language uses is a property
of the language, not of your UI.

Approximate shape of the problem (verify against CLDR for the engine's ICU version):

| Language family | Typical required cardinal categories |
|---|---|
| Japanese, Korean, Chinese, Thai, Vietnamese, Indonesian, Malay | `other` only |
| English, German, Dutch, Spanish, Italian, Turkish, Hungarian, Finnish | `one`, `other` |
| French, Portuguese (BR) | `one`, `other` (+ `many` for large/compact numbers) |
| Romanian | `one`, `few`, `other` |
| Croatian, Serbian, Bosnian | `one`, `few`, `other` |
| Russian, Ukrainian, Polish, Czech, Slovak, Lithuanian | `one`, `few`, `many`, `other` |
| Slovenian | `one`, `two`, `few`, `other` |
| Arabic | `zero`, `one`, `two`, `few`, `many`, `other` |

French treats 0 as singular. English does not. That single difference breaks every
hand-rolled pluralization helper ever written.

**Ordinals** ("1st", "2nd") use a *separate* CLDR rule set from cardinals. Leaderboards and
race placements need ordinal handling, not cardinal.

**Gender** applies to the referent, not just the player: adjectives and past participles agree
with the subject in Romance and Slavic languages. If any string describes a character, the
system must expose that character's gender to the formatter. Retrofitting this after launch
means retranslating every affected string.

Engine syntax examples appear in [Engine notes](#11-engine-notes).

## 5. Text expansion budgets

Design targets, not guarantees. Actual expansion depends on register, string length, and the
specific wording chosen. Use these to size containers; verify with pseudo-localization.

| Target from English | Typical running-text change | Notes |
|---|---|---|
| German | +30% to +35% | Compound nouns cannot be line-broken like English phrases |
| Dutch | ~+35% | Same compounding problem |
| Finnish, Hungarian | High, variable | Agglutination; single words get very long |
| Russian, Ukrainian | +20% to +40% | Cyrillic also renders wider per character |
| French, Spanish, Italian, Portuguese | +15% to +30% | |
| Polish, Turkish | +20% to +30% | |
| Arabic, Hebrew | +15% to +30% | Plus full RTL layout mirroring |
| Japanese, Chinese, Korean | −10% to −55% character count | But larger glyph box; needs more line height and inter-character space, so **vertical** expansion |

**The short-string rule matters more than the average.** A one-word button label can expand
100–300%. "Submit" → "Absenden" is mild; menu verbs and status labels routinely double.

Practical budgets:

- Sentences and paragraphs: size for **+35%** horizontal.
- Labels of 10 characters or fewer: size for **+100%**, or allow two lines.
- CJK: size for **+30% line height**, not width.
- Never use fixed-width containers for translated text. Use minimum-width with growth,
  and let the layout system reflow.
- Where a hard limit genuinely exists (fixed HUD element, platform-imposed field), publish the
  limit in the LocKit as a per-string `max_length` and enforce it in lint — do not discover it
  during LQA.

## 6. Fonts, glyphs, and shaping

Tofu (▯) in a shipped game is a pipeline failure, not a font failure: it means a coverage
decision was deferred until QA found it.

- **Coverage.** One font family will not cover every market. Audit the glyph set against the
  actual character inventory of each target locale, including punctuation and currency symbols.
- **Fallback chains are ordered, and the order is a correctness issue.** Renderers take the
  first font that supplies a glyph. Because of Han unification, a Japanese font placed above a
  Simplified Chinese font will render Chinese text with Japanese glyph shapes — legible, wrong,
  and immediately noticeable to native players. Ship per-language font assets (SC / TC / JP / KR)
  and switch the chain with the locale. Font families that ship regional variants (for example
  the Noto Sans and Source Han Sans families) make this tractable.
- **Atlases.** A static atlas with full CJK coverage is impractical on most platforms — the
  texture memory is not available. Use dynamic atlas generation for CJK, accept the
  predictability tradeoff, and test memory under worst-case text load.
- **Shaping.** Arabic joining, Indic conjunct formation, and mark positioning require an
  OpenType shaping engine (HarfBuzz or equivalent) processing GSUB/GPOS tables. Without
  shaping, Arabic renders as disconnected letterforms. This is a BLOCKER for those locales.
- **Test at display size**, not in an editor preview. Hinting and atlas resolution problems
  only appear at the size the player sees.

## 7. Encoding

UTF-8 end to end, verified at every boundary. Common failure points:

- source files saved as Windows-1252 or Shift-JIS and read as UTF-8 (mojibake: `Ã©`, `ï¿½`)
- database columns with non-Unicode collation
- string manipulation that treats bytes as characters, splitting multi-byte sequences
- JSON/XML parsers mishandling the byte order mark
- length limits enforced in bytes rather than characters or display width

Flag any `U+FFFD` replacement character in delivered content as BLOCKER — it means data was
already lost upstream.

## 8. Bidirectional and RTL layout

Arabic, Hebrew, Persian, and Urdu need more than reversed text direction:

- full UI mirroring: navigation, progress bars, back/forward affordances, tab order
- directional icons flip; representational icons do not (a right-pointing arrow flips; a
  photograph does not)
- mixed-direction strings (Arabic containing an English item name or a number) need proper
  bidi isolation, or the numbers land in the wrong place
- HUD elements anchored to a screen corner may need to swap corners

Both major engines support RTL, but only if it is enabled and configured deliberately — it is
not automatic.

## 9. Locale conventions

Never format these manually:

- numbers (decimal and grouping separators), currency, percentages
- dates and times, including 12/24-hour and week-start day
- name order and address formats
- sorting and collation (alphabetical order is locale-specific; so is case folding)
- units of measurement, where the game surfaces real-world units
- keyboard input, IME support in chat and name-entry fields, and text-input validation that
  must not reject non-ASCII names

Also: **use language names, not flags**, in language pickers. A flag denotes a country, not a
language, and the mismatch is a recurring source of player complaints.

## 10. Pseudo-localization as a CI gate

Pseudo-localization produces a fake locale that is still readable in English while exposing
the structural defects real translation would hit. It costs nothing in translation fees and
should run on every build, before any real locale exists.

What each transformation exposes:

| Transformation | Exposes |
|---|---|
| Bracket wrapping `⟦…⟧` | Truncation (missing closing bracket) and concatenation (two bracket pairs in one visual string) |
| Accented character substitution | Font coverage gaps and encoding failures |
| Length padding | Layout breakage under expansion, before translators are involved |
| Untransformed text | **Hardcoded strings** — anything still plain English was never externalized |

Use `scripts/pseudoloc.py`. It preserves placeholders and markup tags so the pseudo build
still runs.

Wire it into CI: a build whose pseudo-locale pass produces new clipped elements or new plain
English strings has regressed, and that is a merge blocker.

## 11. Engine notes

### Unreal Engine

- Text uses `FText` with `LOCTEXT`/`NSLOCTEXT`; namespace + key identifies the string.
- ICU-based argument modifiers are built in:
  - plural: `"There {NumCats}|plural(one=is,other=are) {NumCats} {NumCats}|plural(one=cat,other=cats)"`
  - ordinal plural forms are supported alongside cardinal
  - gender: `"{Gender}|gender(Le,La) {Gender}|gender(guerrier,guerrière) est {Gender}|gender(fort,forte)"`
  - Hangul post-positions: values given as `[consonant, vowel]`, selected by the preceding value
- Categories available are those defined for the culture by CLDR data — define every category
  the target culture requires, and let the engine select.
- **Import ≠ compile.** Importing PO files updates text data but does not regenerate the
  compiled `.locres`. The build keeps loading the old translations until Compile runs. Add
  compilation to build automation.
- `#undef LOCTEXT_NAMESPACE` at the end of every `.cpp`. A leaked namespace silently assigns
  the wrong namespace to strings in later translation units.

### Unity

- The Localization package uses String Tables per locale, addressed by table collection + key.
- Tables load asynchronously by default; a string requested before its table loads is not
  immediately available. Enable Preload for tables needed at startup or during a loading screen.
- Smart Strings (a modified SmartFormat) provide pluralization, gender conjugation, list
  formatting, and conditional logic with named placeholders. Mark an entry Smart to enable it;
  entries are not smart by default, which is a common silent failure.
- TextMeshPro handles rendering. Its fallback list is ordered and stops at the first font
  supplying a glyph — see the Han unification warning in [Fonts](#6-fonts-glyphs-and-shaping).
  Build per-language TMP font assets and switch the fallback order with the locale.

## 12. Audit checklist

Report each item as PASS / FAIL / N/A with evidence.

**Externalization**
- [ ] All player-visible strings in resource files
- [ ] No text baked into image or video assets
- [ ] Platform-facing strings (trophies, saves, rich presence) externalized
- [ ] Non-localizable strings explicitly marked
- [ ] One string ID per context; no cross-context reuse

**Structure**
- [ ] No runtime sentence concatenation
- [ ] Named placeholders throughout; reorderable
- [ ] Placeholder inventory documented with sample values and max lengths
- [ ] Markup tags documented and preservable
- [ ] Plural handling via ICU/CLDR, not `count == 1`
- [ ] Ordinal handling present where ranks or placements are shown
- [ ] Gender exposed to the formatter for every gendered referent

**Layout**
- [ ] No fixed-width containers on translated text
- [ ] +35% horizontal headroom on sentences; +100% on short labels
- [ ] +30% line-height headroom for CJK
- [ ] RTL mirroring implemented and enabled
- [ ] Bidi isolation for mixed-direction strings

**Rendering**
- [ ] Glyph coverage verified per locale at display size
- [ ] Per-language font assets for SC / TC / JP / KR with correct fallback order
- [ ] Shaping engine present for Arabic and Indic scripts
- [ ] Dynamic atlas strategy for CJK; memory tested under worst case

**Data**
- [ ] UTF-8 verified at every pipeline boundary
- [ ] No `U+FFFD` in any delivered file
- [ ] Length limits counted in characters or display width, not bytes
- [ ] Locale-aware number/date/currency/collation formatting

**Process**
- [ ] Pseudo-localization runs in CI on every build
- [ ] Pseudo pass produces zero plain-English strings
- [ ] Layout regression check across pseudo and one high-expansion locale

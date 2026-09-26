# Gate 2 — LocKit and Terminology Specification

A LocKit turns guessing into deciding. A translator working from a raw string dump makes
hundreds of micro-decisions per hour without the information needed to make any of them well;
the resulting defects surface at LQA, where they cost ten times as much to fix.

Professional projects bill a **familiarisation** phase for exactly this reason — linguists
read the glossary, scripts, and reference material before translating a word. Budget for it.

## 1. LocKit contents

| Component | Required | Purpose |
|---|---|---|
| String table | Yes | The translatable content plus per-string metadata |
| Glossary / termbase | Yes | Approved targets for recurring terms; consistency across the title and its sequels |
| Do-not-translate list | Yes | Proper nouns, platform terms, licensed brands, code identifiers |
| Style guide | Yes | Register, tone, formality, punctuation, profanity policy |
| Character bible | If narrative | Voice, relationships, forms of address, speech quirks |
| Screenshots / in-context preview | Yes | The single highest-value context artifact |
| Variable inventory | Yes | What each placeholder resolves to, with sample values |
| Platform terminology set | If console | Mandated first-party terms per platform and locale |
| Prior-title TM | If sequel | Continuity with what players already learned |
| Audio script + timing sheet | If VO | Line IDs, character, timing constraints, direction notes |

## 2. String table schema

Minimum columns. Add columns freely; never remove these.

| Column | Description | Why it matters |
|---|---|---|
| `string_id` | Stable unique key | Survives source-text edits; the join key for every downstream tool |
| `source` | Source-language text | |
| `target` | Target-language text | One column per locale, or one file per locale |
| `context` | What this string is and where it appears | The most-skipped and most-needed field |
| `max_length` | Hard character limit, if any | Empty means "no hard limit", not "unlimited space" |
| `screen_ref` | Screen name, UI element, or screenshot filename | Lets the translator see it |
| `speaker` | Character ID for dialogue | Drives register, gender agreement, and voice |
| `addressee` | Who is being addressed | Drives formality (T–V distinction) and honorifics |
| `string_type` | UI / dialogue / tutorial / legal / system / achievement | Different types take different registers |
| `placeholders` | List of variables with sample values | Prevents blind placeholder handling |
| `dnt` | Do-not-translate flag | Keeps fixed strings out of the translation scope |
| `status` | new / changed / unchanged / deprecated | Drives incremental delivery for live service |
| `notes_dev` | Free-text from the developer | Where the "actually this button toggles, not saves" comment lives |

**String ID conventions.** Use a hierarchical, human-readable key that encodes location:

```
UI.MAINMENU.BTN.CONTINUE
DLG.CH03.MERCHANT.GREETING_01
ITEM.WEAPON.IRONSWORD.NAME
ITEM.WEAPON.IRONSWORD.DESC
SYS.ERROR.SAVE_FAILED_DISK_FULL
```

Rules that pay for themselves:

- IDs are **immutable**. Changing an ID orphans the translation memory.
- IDs encode **context**, so a partial delivery is still interpretable.
- Never reuse one ID in two places. If the same English word appears in two contexts, that is
  two IDs.
- Deprecate rather than delete; deleted IDs make regression comparison impossible.

## 3. Context notes: what actually helps

Bad context: `Button label.`
Good context: `Confirm button on the character-deletion dialog. Destructive action. Appears next to "Cancel". Max 12 chars at 1080p.`

Write context for the four questions a translator cannot answer alone:

1. **Part of speech / function.** Is "Save" a verb on a button or a noun in a header?
2. **Physical constraint.** How much room is there, and what happens if it overflows?
3. **Grammatical environment.** What precedes and follows this string at runtime?
4. **Tone and stakes.** Is this a cheerful tutorial hint or a data-loss warning?

For dialogue, order the lines **in the sequence they are spoken**, and keep each conversation
contiguous. A dialogue tree flattened into alphabetical order by ID is unusable.

## 4. Glossary and termbase

Build during development, not at handoff. A glossary assembled after the script is written is
a glossary that documents inconsistencies rather than preventing them.

Include, at minimum:

- character names and how they decline or transliterate
- place names
- items, weapons, abilities, resources, currencies
- game-system terms (stats, statuses, damage types, rarity tiers)
- UI vocabulary that must stay consistent across every screen
- anything whose mistranslation breaks a puzzle, quest, or crafting recipe

Each entry carries: source term, approved target, part of speech, definition, forbidden
alternatives, and a usage example. "Forbidden alternatives" is the field that stops a sword
becoming a blade three chapters later.

**Do-not-translate list** covers: studio and publisher names, licensed IP, platform product
names, code identifiers appearing in strings, and any term the client has fixed by contract.

For glossary construction and maintenance as a standalone task, hand off to a
dedicated terminology skill, if one is installed.

## 5. Style guide

Decisions that must be made once and written down, or they will be made inconsistently by
every linguist independently:

- **Register**: formal, neutral, casual, archaic, or period-specific
- **Formality (T–V)**: does the game address the player as *du/vous/tú/usted/ты/вы*? Does the
  answer change between UI and dialogue? Between characters?
- **Honorifics**: retained, adapted, or dropped for Japanese and Korean source content
- **Profanity policy**: match source intensity, soften, or intensify — and note that this
  choice interacts with age ratings (see `compliance.md`)
- **Capitalization**: many languages do not use English title case in UI. Specify per locale.
- **Punctuation**: quotation marks, ellipses, dashes, and spacing rules differ per locale
  (French requires a space before `!`, `?`, `:`, `;`)
- **Numerals**: digits or words, and how large numbers are abbreviated
- **Measurement**: metric, imperial, or fictional units
- **Text speed / reading rate** for timed subtitles and auto-advancing dialogue

## 6. Character bible

For any narrative title, provide per character:

- role, age, background, and social position
- speech register and any verbal tic, dialect, or idiolect
- relationship to and form of address for every other significant character
- gender as exposed to the formatter (needed for agreement in Romance and Slavic targets)
- how the character's speech **changes** over the story arc

Without this, a character who is deferential in Act I and defiant in Act III becomes uniformly
neutral in translation, and the arc disappears.

## 7. Platform terminology

Console platform holders mandate exact terminology for hardware, system UI, and account
concepts, per language. These lists are distributed to licensed developers under NDA.

Handling rule: **the licensee supplies the current terminology set; this skill applies it.**
Never reconstruct platform terminology from memory or from a public source — it changes
between hardware generations and system updates, and using a stale term is a certification
finding. Treat it as a locked glossary layer that overrides all other terminology decisions,
including client preference.

## 8. Variable inventory

For every placeholder appearing anywhere in the string table:

| Field | Example |
|---|---|
| Token | `{PlayerName}` |
| Resolves to | Player-chosen display name |
| Type | String |
| Sample values | `Ari`, `Владислав`, `さくら`, `Bartholomew-the-Third` |
| Max realistic length | 16 characters |
| Grammatical role | Subject; may need case inflection in Slavic targets |
| Can be reordered | Yes |

The "grammatical role" row is what lets a translator raise the case-inflection problem *before*
it ships rather than filing it as an LQA bug.

## 9. Delivery format

Whatever the team already uses is usually correct. Preferences, in order:

1. The engine's native format (Unreal PO, Unity String Table export) — no round-trip loss
2. Bilingual XLIFF — carries context and state natively, tool-agnostic
3. CSV/TSV with the schema above — universal, but fragile on embedded delimiters and newlines
4. Spreadsheets — acceptable for small titles; version control is manual and will fail at scale

Whatever the format: UTF-8, one file per locale or one column per locale (pick one and hold
it), and a `status` field so incremental drops are possible.

`assets/lockit-template.csv` provides a ready-to-fill string table using this schema.

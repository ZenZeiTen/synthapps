---
name: game-loc-ops
description: End-to-end video game and PC game localization pipeline governance across six gates — confidentiality and IP custody, internationalization readiness (string externalization, placeholders, ICU plurals, text-expansion budgets, font/glyph coverage, RTL), LocKit and terminology packaging, in-context LQA scored with a game-adapted MQM error typology, and release compliance (platform certification, age ratings, regional content risk, AI-voice consent). Ships offline string-lint and pseudo-localization scripts. ALWAYS trigger when the user mentions game localization, loc kit or lockit, LQA, localization bugs, truncation or tofu or mojibake, string tables, Unity or Unreal localization, translating a game, EFIGS or CJK builds, Steam or console store languages, culturalization, age-rating content risk, or says "is this build loc-ready", "cek LQA", "siapkan lokalisasi game", "kenapa teksnya kepotong". Prefer this over general translation-QA skills whenever the artifact is a game.
---

# Game Localization Operations (game-loc-ops)

Game localization fails for reasons that have almost nothing to do with translation quality.
A perfect German string still ships broken if the button is 90px wide, the font atlas has no
`ß` at display size, the plural form was hardcoded as `count == 1`, or the store page declares
a language the build does not actually contain. This skill treats localization as a **pipeline
with gates**, not as a translation job with a deadline.

## Operating model

Six gates. Each gate has entry criteria, an artifact it produces, and an exit condition.
Do not advance a gate whose exit condition is unmet — say so plainly and name the blocker.

| Gate | Name | Artifact produced | Exit condition |
|---|---|---|---|
| G0 | Custody & confidentiality | Handling protocol | Approved tooling + NDA scope confirmed |
| G1 | i18n readiness | Readiness audit report | Zero BLOCKER findings |
| G2 | LocKit & terminology | LocKit package | Every string has context + constraint |
| G3 | Translation & adaptation | Translated string set | Lint clean, glossary conformant |
| G4 | LQA in build | Scored bug report | 0 critical, agreed threshold met |
| G5 | Release compliance | Compliance sign-off | Cert + ratings + parity confirmed |

Live-service titles run G2→G5 as a loop per content drop, with G1 re-run whenever the UI
layout or text system changes.

**Always state which gate you are operating in.** A user asking "why is this text cut off"
is at G4 but the root cause is usually a G1 defect; say that, because fixing it at G4 is
the expensive place to fix it.

## Gate 0 — Custody and confidentiality (never skip)

Pre-release game content is embargoed intellectual property. Narrative strings are also
spoilers, which makes them commercially sensitive in a way most localization content is not.

Before touching content, confirm four things:

1. **Tooling scope.** Which MT/AI engines are contractually approved? Consumer-grade engines
   that retain or train on submitted text are not acceptable for unreleased builds. If the
   client prohibits external AI processing, that prohibition binds this skill too — process
   nothing outside approved tooling and say so.
2. **Build custody.** Who may hold the build, on which machines, for how long, and what
   happens to it at project end.
3. **Capture rules.** Screenshots and video for LQA evidence leak build IDs, debug overlays,
   account names, and unreleased content. Redact before attaching.
4. **Segmentation.** Spoiler-bearing narrative strings go to need-to-know linguists only.

Read `references/security-protocol.md` before any engagement involving an unreleased build,
a devkit, user-generated content, or synthetic voice.

**Refusal boundaries.** This skill does not help evade age-rating disclosure obligations,
misdeclare supported languages to a storefront, clone a performer's voice without documented
consent, or route confidential client content through tooling the client has excluded.

## Gate 1 — Internationalization readiness

This is the highest-leverage gate. Defects caught here cost a code change; the same defects
caught at G4 cost a code change *plus* a retranslation *plus* a retest cycle across every locale.

Run the audit in `references/i18n-readiness.md`. It covers:

- string externalization and hardcoded-text detection
- concatenation and sentence assembly
- placeholder and rich-text-tag integrity
- ICU plural/gender/ordinal handling (and why `count == 1` is a bug, not a shortcut)
- text-expansion budgets per locale, with separate rules for short labels
- font pipeline, glyph coverage, CJK fallback ordering, shaping for Arabic and Indic scripts
- encoding end-to-end, RTL mirroring, locale-aware number/date/currency/sorting
- pseudo-localization as a CI gate

Two scripts automate the mechanical parts:

```bash
# Generate a pseudo-locale to expose truncation, concatenation, and hardcoded strings
python scripts/pseudoloc.py strings.csv --mode full --out strings_pseudo.csv

# Lint a source/target string set for structural defects
python scripts/locstring_lint.py strings.csv --locale de --report lint_report.json
```

Both run offline with the standard library only. Run `--help` on either for the full option
set and supported formats (CSV, JSON, gettext PO).

## Gate 2 — LocKit and terminology

A translator working from a raw string dump is being asked to make hundreds of decisions
without the information needed to make them. The LocKit is what converts guessing into
deciding.

Assemble per `references/lockit-spec.md`. Minimum viable LocKit:

- string table with **string ID, source, context note, max length, speaker, screen reference**
- glossary / termbase with approved targets and do-not-translate list
- style guide: register, profanity policy, honorifics, formality (T–V), platform terminology
- character bible: voice, relationships, how each character addresses others
- screenshots or in-context previews for every UI surface
- variable inventory: what each placeholder resolves to at runtime, with sample values

If the user has an existing glossary workflow, hand terminology work to a terminology skill
and keep this gate focused on packaging and context.

## Gate 3 — Translation and adaptation

This skill governs *constraints*, not prose. Actual translation belongs to
a translation skill; source-English cleanup belongs to a controlled-language skill.

Constraints this gate enforces:

- length budgets honored per string, not per file average
- placeholders preserved in count, name, and order — reordering is legal, dropping is not
- plural and gender forms complete for the target locale's CLDR categories
- glossary conformance, including sequel continuity with prior titles
- platform-mandated terminology used verbatim (button names, system menus, account terms)
- register and formality consistent with the style guide, per character

Run `locstring_lint.py` against the delivered target file before it goes anywhere near a build.

## Gate 4 — LQA in build

Linguistic review in a spreadsheet and LQA in a build are different activities that catch
different defects. Review catches mistranslation cheaply; only LQA catches truncation,
overlap, wrong-context strings, font fallback errors, and VO/subtitle desync.

Use `references/lqa-mqm.md` for:

- the game-adapted MQM error typology (7 core dimensions + 5 game-specific extensions)
- severity model: neutral 0 / minor 1 / major 5 / critical 25, with **any critical = fail**
- scoring formula, denominator choice, and why cross-project score comparison is invalid
- the bug report schema and required diagnostic fields
- test-pass structure and coverage planning across locales

Default deliverable is a bug report using `assets/lqa-bug-report-template.csv`, plus a
readiness scorecard per locale. Every validated fix must be written back to the translation
memory and glossary, or it will be re-imported and re-broken on the next drop.

## Gate 5 — Release compliance

Read `references/compliance.md`. Four independent gates that are frequently confused:

1. **Platform certification** — Sony TRC, Microsoft Xbox Title Requirements, Nintendo
   Lotcheck. Localization requirements are embedded inside these, not separate from them.
   A localization failure resets the same submission queue as any other failure.
2. **Store/build language parity** — every language declared on the storefront must actually
   be present and complete in the build. This is a common and entirely avoidable cert failure.
3. **Age ratings and content descriptors** — ESRB, PEGI, CERO, USK, GRAC, ACB, ClassInd, and
   the China NPPA/ISBN process apply different standards to identical content. A localized
   script that intensifies profanity or sexual content can invalidate a rating obtained on
   the source script.
4. **Culturalization and regional content** — religious imagery, political references,
   historical symbols, violence thresholds. Decide per market: adapt, remove, or keep with
   disclosure. Decide in pre-production, not at submission.

Voice work adds a fifth: performer consent for any synthetic or replica voice. See the
AI-voice section of `references/compliance.md`.

## Output format

Default to this structure unless the user asks otherwise:

```
## Gate: <G0–G5> — <name>
## Verdict: PASS / PASS WITH FINDINGS / BLOCKED
## Findings
| ID | Severity | Category | Locale | String ID / Location | Issue | Fix |
## Blockers
## Next gate
```

For LQA output, use the bug report schema in `references/lqa-mqm.md` instead — it has the
diagnostic fields engineering needs and this one does not.

Label every claim that is not directly observable from supplied artifacts as **Inference**
or **Speculation**. Expansion percentages, cert behavior, and rating outcomes are planning
heuristics, not guarantees — say so when you use them.

## When NOT to use this skill

Defer, and say which skill you are deferring to:

- Raw translation or transcreation prose → a general translation skill, if installed
- Marketing/transcreation copy or screenshot review outside a game build → a transcreation QA skill, if installed
- Non-game document translation QA → a document translation-QA skill, if installed
- Building or maintaining a glossary as the primary task → a terminology skill, if installed
- Writing VO or narration scripts → a voice-script skill, if installed
- Cleaning up ambiguous source English before translation → a controlled-language skill, if installed
- Secrets, tokens, or credential hygiene → a secrets-management skill, if installed
- Building the game itself → `game-creator-2d`

This skill is the pipeline and its gates. It calls on those skills; it does not replace them.

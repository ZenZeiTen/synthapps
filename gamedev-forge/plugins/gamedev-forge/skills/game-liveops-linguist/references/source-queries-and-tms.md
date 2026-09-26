# Source Queries and TMS / QA Platform Discipline

Two halves. The first is how to turn a defective source into a PM-actionable query. The second is
how to make the localization platform do the mechanical work so your attention goes to the things
only a linguist can catch.

## Contents

**Part A — Source queries**
1. The eight defect types
2. How to write a query that gets answered in one pass
3. Query batching and timing
4. When to proceed under assumption

**Part B — TMS and QA platforms**
5. The four levers, by tool
6. QA profile settings that matter for game content
7. Checks that produce noise on game strings
8. Termbase discipline
9. Writeback — the regression killer

---

# Part A — Source queries

## 1. The eight defect types

| Type | What it looks like | Impact if guessed wrong |
|---|---|---|
| **Ambiguity** | "Increases damage by 20%" with no scaling base; "Select up to 3 heroes" where *up to* may mean exactly | Player makes a wrong build or purchase decision |
| **Logic conflict** | Rule says top 100, reward table lists 120 tiers; cap stated twice with different numbers | Rule text contradicts the game; support wave |
| **Terminology inconsistency** | Source uses Gear / Equipment / Kit for one system across three files | Target inherits three terms; UI feels machine-made |
| **Missing context** | Isolated "Open" with no screen, speaker, part of speech or length | Wrong part of speech in target; wrong register |
| **Variable defect** | `{0}` here and `{count}` in the sibling string; unit baked into source outside the variable; gender-dependent noun in a variable | Runtime grammar breaks; ungrammatical output |
| **Concatenation** | "You gained " + N + " of " + item | Ungrammatical in most target languages; unfixable at string level |
| **Source error** | Wrong number, wrong date, wrong tier name, misspelt proper noun, stale copy from a past event | Error propagates to every locale |
| **Cultural landmine in source** | Imagery or phrasing that will not clear a market | Rating, store or legal exposure |

The last two are the highest-value finds. A source error caught by one linguist saves every
other locale team the same defect, and a cultural landmine caught pre-translation is orders of
magnitude cheaper than one caught at cert.

## 2. How to write a query that gets answered in one pass

A PM triaging forty queries gives each one about fifteen seconds. Structure accordingly.

**Required fields** (see `assets/source-query-log-template.csv`):

- String ID and file
- The exact span in question, quoted
- Defect type
- The competing readings, numbered
- **Your recommended reading** — this is what makes the query answerable rather than a discussion
- Impact if the recommendation is wrong
- Whether you are blocked or proceeding under assumption
- Affected locales (yours only, or all)

**Good query:**

> `SKILL_HERO_0421` — "Increases ATK by 30% for 2 turns."
> Ambiguity: scaling base unspecified. Reading 1: +30% of base ATK. Reading 2: +30% of current
> ATK including other buffs. Reading 3: +30 percentage points to an existing ATK bonus.
> Recommend Reading 1, consistent with `SKILL_HERO_0418` in the same set.
> If wrong, players mis-evaluate this hero against the featured banner unit. Not blocked —
> proceeding on Reading 1, will revise on confirmation. Affects all locales.

**Bad query:** "What does this mean?"

**Rules**
- One query per defect. Do not bundle three questions into a paragraph.
- Never ask a question you can answer from the LocKit or the build. Check first.
- If the same defect appears in fifteen strings, file one query listing all fifteen IDs.
- Quote the span. Do not paraphrase it.
- Say whether you are blocked. PMs triage blocked queries first, and mislabelling costs you
  credibility on the next batch.

## 3. Query batching and timing

- **Pre-translation sweep** — read the batch before drafting and file the structural queries
  (ambiguity, logic conflict, source errors, cultural flags) as one set. This is the single
  highest-value hour in the delivery.
- **Mid-delivery** — file only blockers.
- **At delivery** — file the residual non-blocking queries with the delivery, marked as
  "resolved by assumption", so the reviewer knows which choices are provisional.

Filing forty queries the day before deadline is a process failure regardless of how good they are.

## 4. When to proceed under assumption

Proceed, do not block, when: the string is not monetization or rule text, a defensible reading
exists, and the cost of being wrong is a revision rather than a player-facing harm.

Block when: money, odds, limits, expiry, legal wording, or a rating-relevant element depends on
the answer.

When proceeding, mark the string in the delivery, state the assumption, and label it
**Inference**. Never deliver a guess silently.

---

# Part B — TMS and QA platforms

## 5. The four levers, by tool

Every platform gives you the same four levers under different names. Learn the lever, then find
its name in whatever tool the client uses.

| Lever | memoQ | Phrase | Trados Studio | Crowdin |
|---|---|---|---|---|
| Tag / placeholder protection | Inline tags, tag QA in the QA settings profile | Tags and placeholders, protected in the editor | Tag verification, QA Checker | Placeholder validation, custom placeholder patterns |
| Terminology enforcement | Term bases with forbidden terms and match settings | Term bases with forbidden/preferred flags | MultiTerm plus Terminology Verifier | Glossary with term highlighting |
| Automated QA profile | QA settings profile, LQA models, regex-based auto-QA | QA checks, custom QA rules | QA Checker 3.0, Terminology Verifier, Tag Verifier | QA checks per project, custom checks |
| Context linking | Preview, images attached to segments, context ID | Screenshots and context per key | Preview and context match | Screenshots with tagged strings, context field |

Also common to all four: pseudo-translation, filtered views for review, change tracking, and an
export path for the QA report.

**Working rules independent of tool**

- Never edit tags manually if the tool can insert them. Manual tag editing is the top source of
  broken builds from a linguist's delivery.
- Filter before you review. Reviewing 4,000 segments linearly is a way to miss things; reviewing
  by class, by term, by numeric mismatch, and by tag error finds more in less time.
- Use the preview or screenshot link on every UI string. Untethered UI strings are guesses.
- Lock what should not change: do-not-translate terms, product names, legal wording.

## 6. QA profile settings that matter for game content

Turn these on and tune them:

- **Number and unit consistency** — source-to-target numeric match, including percentages,
  decimals and separators. Highest-yield single check for game content.
- **Tag and placeholder integrity** — presence, count, name and pairing. Order changes are legal;
  drops are not.
- **Terminology** — including forbidden terms and the do-not-translate list.
- **Length limits** — feed the max-length column into the tool rather than eyeballing it.
- **Inconsistency** — same source segment translated two ways, and the inverse.
- **Repeated words, double spaces, leading/trailing whitespace** — whitespace matters because
  strings concatenate.
- **Empty and untranslated segments.**
- **Regex custom checks** — build project-specific ones for the client's placeholder syntax,
  rich-text tag syntax, and any string-ID conventions.

## 7. Checks that produce noise on game strings

Tune these down rather than ignoring the whole report:

- **Punctuation-at-end checks** — UI labels legitimately drop terminal punctuation where the
  source has it, and vice versa.
- **Capitalization checks** — title case in source rarely maps to title case in the target.
- **Length checks on non-UI strings** — narrative and mail strings do not carry UI budgets.
- **Terminology checks on homographs** — a term entry for a mechanic will fire on the ordinary
  word. Add context or forbid-in-context conditions.
- **Repeated-word checks** on languages with legitimate reduplication.

**The habit that matters:** tune the profile once per project, then run it to zero. Every
accepted false positive should result in a profile change, not a mental note. A QA report with
hundreds of standing warnings is a report that hides the one real defect.

## 8. Termbase discipline

- One entry per **concept**, not per word. Record the mechanic in the definition field so the
  next linguist knows which system the term belongs to.
- Record **forbidden** targets, not only approved ones. "Do not use X for Y" prevents more errors
  than "use Z".
- Record the **do-not-translate** list explicitly, including product names, faction names, and
  any English term the player community already uses.
- Record the **decision rationale** for contested terms. A term without a rationale gets
  relitigated by every new reviewer.
- Version it. When a term changes, note the date and update the affected TM segments; otherwise
  old segments keep pre-translating the retired term.

Building or restructuring the termbase as the primary task belongs to a dedicated terminology skill,
if one is installed. Hand off and say so.

## 9. Writeback — the regression killer

Live-service localization regresses for one reason above all others: **validated fixes are not
written back**, so the next content drop pre-translates from a TM that still contains the defect.

After every LQA cycle:

1. Update the TM segments for every accepted fix.
2. Update the termbase for every terminology decision.
3. Update the style guide for every systemic finding.
4. Update the QA profile for every recurring false positive and every recurring real defect.
5. Route source defects to the source owner, not to the locale teams individually.

If this loop is not closed, LQA becomes a per-drop tax that finds the same bugs forever. Say so
explicitly when a client's process lacks the writeback step — it is the highest-leverage process
recommendation a senior linguist can make.

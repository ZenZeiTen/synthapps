# Gate 4 — LQA with a Game-Adapted MQM Typology

## 1. Linguistic review is not LQA

Two different activities, catching two different defect classes. Running one is not running
the other.

| | Linguistic review | LQA in build |
|---|---|---|
| Environment | CAT tool or spreadsheet | Playable build on target hardware |
| Catches | Mistranslation, terminology drift, register, grammar | Truncation, overlap, wrong-context strings, font fallback errors, VO/subtitle desync, placeholder blowups |
| Cost | Low | High |
| Timing | During G3 | After integration |

Skipping LQA because review passed is the most common cause of visible launch-day quality
failures. Review cannot see a button.

Where no build is available, **partial LQA** (screenshot review, or spreadsheet review with
screen references) catches a useful subset — but say explicitly which class of defect remains
unverified.

## 2. The MQM foundation

MQM (Multidimensional Quality Metrics) is an open framework for analytic translation quality
evaluation. It supplies a hierarchical error typology and a scoring model, and it works for
human, machine, and AI-generated translation alike.

MQM Core organizes error types under seven high-level dimensions:

1. **Terminology** — wrong term, inconsistent term, glossary violation
2. **Accuracy** — mistranslation, omission, addition, untranslated
3. **Linguistic conventions** — grammar, spelling, punctuation, typography
4. **Style** — register, awkwardness, unidiomatic phrasing, inconsistent voice
5. **Locale conventions** — number, date, currency, address, measurement formats
6. **Audience appropriateness** — content unsuitable or offensive for the target audience
7. **Design and markup** — markup, truncation, and presentation defects

Severity levels and their conventional penalty multipliers:

| Severity | Multiplier | Definition |
|---|---|---|
| Neutral | 0 | A different solution would be preferable, but the translator is not penalized |
| Minor | 1 | Distracts, does not mislead |
| Major | 5 | Misleads, confuses, or visibly degrades the experience |
| Critical | 25 | Renders content unusable, unsafe, or non-compliant |

**Any critical error greater than zero is an automatic fail**, regardless of the computed
score. Track the Critical Error Count separately and report it first.

⚠️ **MQM scores are only comparable when the metric configuration, severity weights, and
thresholds are identical.** A 95 from one vendor does not mean the same as a 95 from another.
Always publish the configuration alongside the score, and never benchmark across projects
whose configurations differ.

## 3. Game-specific extensions

MQM Core does not cover the defect classes that dominate game LQA. Add these five dimensions,
and record that you have done so as part of the metric configuration.

### G-1. Rendering and layout
| Error type | Typical severity |
|---|---|
| Truncation — text cut off | Major, or Critical if it hides required information |
| Overflow — text escapes its container | Major |
| Overlap — text collides with other elements | Major |
| Tofu — missing glyph renders as box | Critical |
| Mojibake — garbled characters from encoding failure | Critical |
| Wrong regional glyph shape (Han unification / fallback order) | Major |
| Line-break or wrap failure | Minor to Major |
| RTL mirroring incorrect | Major |
| Text illegible against background at target resolution | Major |

### G-2. Variable and markup integrity
| Error type | Typical severity |
|---|---|
| Placeholder missing from target | Critical |
| Placeholder name altered — will not resolve | Critical |
| Placeholder count mismatch | Critical |
| Raw token visible to the player (`{0}`, `%s`) | Critical |
| Markup tag broken or unbalanced | Major |
| Plural or gender form missing for the locale | Major |
| Placeholder grammatically incompatible in context (case, agreement) | Major |

### G-3. Context and functional linguistics
| Error type | Typical severity |
|---|---|
| String correct in isolation, wrong for its on-screen context | Major |
| Quest, puzzle, or crafting instruction now unsolvable in target | Critical |
| Tutorial instruction does not match actual controls or UI labels | Critical |
| UI label inconsistent with the term used in dialogue for the same thing | Major |
| Character voice inconsistent with the character bible | Minor to Major |
| Input prompt names a control that does not exist on this platform | Critical |

### G-4. Platform and store compliance
| Error type | Typical severity |
|---|---|
| Platform-mandated terminology not used | Critical (certification finding) |
| Build language set does not match declared store languages | Critical |
| Legal, EULA, or age-gate text missing or untranslated | Critical |
| Achievement/trophy text exceeds platform character limits | Major |
| Store metadata inconsistent with in-game terminology | Minor |

### G-5. Audio and timing
| Error type | Typical severity |
|---|---|
| Subtitle does not match the delivered VO line | Major |
| Subtitle exceeds readable duration at the scripted reading rate | Major |
| VO line exceeds the animation or cutscene time slot | Major |
| Lip-sync or gesture-sync visibly broken | Minor to Major |
| Wrong take, wrong character, or wrong language asset shipped | Critical |
| Audio missing for a shipped locale that declares full VO | Critical |

## 4. Scoring

Compute in this order:

```
ETPT (per error type)  = Σ (error_count × severity_multiplier)
APT (absolute penalty) = Σ ETPT across all error types
```

Then normalize. **Declare the denominator** — the choice materially changes the number:

```
Per-word    OQS = 100 − (APT / word_count) × 100
Per-string  OQS = 100 − (APT / string_count) × 100
```

Per-word normalization is the MQM convention and suits dialogue-heavy content. **UI-heavy
string sets should normalize per string** — a five-word button label carries the same layout
risk as a fifty-word codex entry, and per-word scoring understates UI defects badly.

Report the trio, never the score alone:

```
Locale: de-DE
Configuration: MQM-Core + game extensions G1–G5, weights 0/1/5/25, per-string normalization
Sample: 1,240 strings evaluated (of 8,900 total) — UI 60%, dialogue 30%, system 10%
Critical Error Count: 2   ← automatic FAIL
APT: 96   OQS: 92.3
Verdict: FAIL — 2 critical (G-2 placeholder missing; G-1 tofu on ß at 24px)
```

### Default gate thresholds

Project-configurable. Agree them with the client **before** testing starts, or the argument
happens after the report lands.

| Content class | Critical allowed | Minimum OQS |
|---|---|---|
| Legal, age gate, safety, platform-mandated | 0 | 99 |
| UI, HUD, tutorial, system messages | 0 | 97 |
| Main-path narrative and dialogue | 0 | 95 |
| Optional/flavor content, ambient barks | 0 | 92 |
| Store metadata and marketing surfaces | 0 | 97 |

## 5. Bug report schema

Every row must let an engineer reproduce and a linguist adjudicate without asking a follow-up
question. Use `assets/lqa-bug-report-template.csv`.

| Field | Required | Notes |
|---|---|---|
| `bug_id` | Yes | Stable identifier |
| `locale` | Yes | BCP-47 (`pt-BR`, not "Portuguese") |
| `build_id` | Yes | Exact build; a bug without one cannot be verified as fixed |
| `platform` | Yes | Including device/hardware revision for mobile and handheld |
| `string_id` | Yes where known | The join key back to the string table and TM |
| `location` | Yes | Screen, menu path, quest, or timestamp |
| `repro_steps` | Yes | Numbered, from a known state |
| `mqm_dimension` | Yes | Core dimension or game extension G1–G5 |
| `error_type` | Yes | From the typology above |
| `severity` | Yes | neutral / minor / major / critical |
| `priority` | Yes | P0–P4, set by the developer, not the tester |
| `current_text` | Yes | Exactly as rendered, including whitespace |
| `corrected_text` | Yes for linguistic bugs | Must fit the same constraint |
| `explanation` | Yes | Why it is wrong, in terms a non-speaker can act on |
| `evidence` | Yes | Screenshot or clip, **redacted** per `security-protocol.md` |
| `is_source_defect` | Yes | Flags bugs that exist in the source and affect all locales |
| `status` | Yes | open / fixed / verified / rejected / duplicate / deferred |

**Severity is the tester's call; priority is the developer's.** Conflating them causes the
argument where a linguist insists a minor style issue is P0.

`is_source_defect` earns its place: source defects must be routed to the source owner and
fixed once, not patched in twelve locales independently.

## 6. Test-pass structure

1. **Goal setting** — scope, locales, coverage target, thresholds, schedule.
2. **Pre-test preparation** — testers receive the LocKit, style guide, glossary, prior-version
   notes, expected play hours, and the areas to cover. Testers who have not read the LocKit
   file bugs against decisions that were made deliberately.
3. **Scripted pass** — defined test cases with explicit pass/fail criteria. Example:
   *Pass: no truncation or overlap in any tested menu or dialogue box. Fail: text truncated,
   overlapping, or misaligned.*
4. **Free-play pass** — unscripted, catches what the test cases did not anticipate.
5. **Triage** — deduplicate, adjudicate rejections, assign priority.
6. **Fix and retest** — regression-gate every critical and major; verify the fix did not break
   the layout elsewhere.
7. **Write-back** — push validated corrections into the TM, glossary, and source string table.
   Skip this and the same defect returns on the next content drop.
8. **Retrospective** — recurring UI pain points, terminology that confused testers, cultural
   flags that surprised the team. Feed into the next LocKit.

### Coverage planning

Full coverage in every locale is rarely affordable. Allocate by risk:

- **Full pass**: highest-revenue locales, and any locale where the script was transcreated
  rather than translated
- **Targeted pass**: locales sharing a script and layout profile with a fully tested one —
  test the deltas (expansion, terminology, culturalization), not the whole game
- **Automated only**: pseudo-locale layout regression plus lint, for locales below the
  business threshold — and disclose that this is the coverage level

Assign linguistic cases to linguists and functional cases to technical testers. A native
speaker who does not play the genre will miss context errors; a functional tester who does not
speak the language will miss all of them.

## 7. Reporting metrics that are worth tracking

- **Defect density per locale** — normalized per 1,000 strings, not raw counts
- **Acceptance rate** — share of filed bugs accepted as valid; a low rate means the testers
  lack context, which is a LocKit failure, not a tester failure
- **Source-defect share** — high share means G1/G2 were under-invested
- **Fix verification rate** — bugs marked fixed that actually pass retest
- **Recurrence rate** — bugs that reappear after a content drop; nonzero means write-back is
  broken
- **Coverage** — strings, UI surfaces, VO lines, and critical flows actually exercised

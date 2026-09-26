# String Class Playbooks

Six classes, six rulebooks. Applying the wrong one is the most common senior-level error.
Read the class you are working in; do not read all six.

## Contents

1. C1 — UI chrome
2. C2 — System text
3. C3 — Event rules
4. C4 — Monetization
5. C5 — Narrative
6. C6 — Push, mail, popup
7. Cross-class checklist

---

## 1. C1 — UI chrome

Buttons, tabs, labels, headers, tooltips, empty states, error messages, confirm dialogs.

**Governing constraint:** the length budget, then consistency. A UI string that does not fit is
wrong regardless of how good it is.

### Rules

- **Nominal for labels, imperative for actions.** Tabs and headers are noun phrases. Buttons are
  verbs or verb phrases. Do not mix inside one screen.
- **Budget is per string.** Use the max-length column. If there is none, request it; if it is not
  coming, estimate from the reference screenshot and label the estimate as an assumption.
- **Expansion planning.** Targets that expand relative to English need the shortest natural form
  first, not the most elegant. Where the natural target exceeds budget, the options in order are:
  shorter synonym, accepted abbreviation, restructure, then request a UI change. Truncating with
  an ellipsis is not a translation decision — it is a defect.
- **Parallelism.** Items in the same list, menu or tab bar must share grammatical shape.
- **One concept, one label, everywhere.** The same action in a button, a tooltip, a push
  notification and a store description uses the same term.
- **Error messages state cause and remedy.** "Failed" is not a message. If the source is that
  thin, log a query; do not invent a cause.
- **Confirm dialogs for destructive actions must state what is lost.** Non-negotiable.

### Failure modes

Truncation, overlap, two labels for one action, a verb used where the target reads it as a noun,
error text with no remedy, tooltips that restate the label instead of explaining it.

### Verification

Character count against budget; termbase pass; visual check in the reference screenshot or build.

---

## 2. C2 — System text

Skill and buff descriptions, stat tooltips, building descriptions, troop stats, equipment effects,
research nodes, talent trees.

**Governing constraint:** mechanical fidelity. The sentence describes a computation. If the
sentence is beautiful and the computation is wrong, the string has failed.

### The six-slot skill grammar

Every skill or effect description encodes some subset of:

1. Trigger — when
2. Target — who
3. Effect — what changes
4. Magnitude — how much, and scaled off what
5. Duration — how long
6. Stacking — how it interacts with itself and with other sources

Before drafting, write these out. If a slot is present in source and absent from your draft, the
draft is wrong. If a slot is absent from source and the mechanic requires it, that is a query.

### Rules

- **Fix a target term per stat and per status effect.** Attack, defence, HP, damage, lethality,
  health, crit rate, crit damage, penetration, block, dodge, accuracy, resistance are separate.
  Stun, silence, freeze, root, slow, burn, poison, bleed are separate.
- **Preserve the scaling base.** "of base attack", "of current HP", "of the target's max HP",
  "of damage dealt" — never drop the qualifier for flow.
- **Keep percentage semantics exact.** Percentage point vs percent of value is not stylistic.
- **Preserve conditional structure.** If–then in source stays if–then. Do not convert a
  conditional into a statement of fact.
- **Preserve probability language.** "has a chance to" is not "will".
- **Duration units.** Turns, seconds, rounds and waves are different. Do not normalize.
- **Number formatting.** Follow the locale rule for decimal and thousands separators, and check
  what the runtime formatter actually emits — a target that expects a comma decimal in a build
  that hardcodes a period is a display defect to log, not a translation to force.
- **Parallel effect lines.** Multi-line effect blocks share a template. Keep the template.

### Failure modes

Wrong scaling base; probability turned into certainty; two statuses merged into one term;
stacking rule dropped; a numeric unit silently changed; a hero's skill described in a different
sentence pattern from every other hero's.

### Verification

`scripts/rulecheck.py`; six-slot audit; termbase pass; comparison against a sibling skill in the
same file for template consistency.

---

## 3. C3 — Event rules

Event terms, mission rules, ranking rules, exchange rules, settlement notices.

**Governing constraint:** logical completeness. Rules text is quasi-contractual. A missing
component produces support load and, in some markets, a consumer complaint.

### The eight rule components

A complete rule set answers all eight. Check the source; if a component is missing there, query it.

| # | Component | Question answered |
|---|---|---|
| 1 | Eligibility | Who can participate — server, level, region, account age |
| 2 | Window | Start and end, with an explicit time reference (server time, UTC offset, local) |
| 3 | Accrual | What action earns progress and how much |
| 4 | Cap and limits | Daily cap, total cap, per-account limit, stock limit |
| 5 | Ranking | Scoring formula and how ties are broken |
| 6 | Settlement | When results are finalized and how rewards are delivered |
| 7 | Expiry | When event currency, tickets or unclaimed rewards vanish |
| 8 | Dispute and exclusion | Cheating, refunds, account bans, right to amend |

### Rules

- **Never soften a limit.** "Up to 5 times daily" is not "several times a day".
- **Never drop the time reference.** Reset and settlement times without a frame are defects.
- **Preserve inclusive/exclusive boundaries.** "Above 100" and "100 or more" differ. "Until
  23:59" and "until 24:00" differ.
- **Preserve conjunction logic.** and / or / and-or are not interchangeable. Where the target
  language's conjunction is ambiguous, restructure into a list.
- **Preserve retroactivity.** "Progress counts from the event start" versus "from the moment you
  join" is a different event.
- **Keep rewards tables aligned.** Tier names, thresholds and reward quantities must match the
  reward table asset exactly. A mismatch is a Blocker query.
- **Legal-register clauses stay in legal register.** "The publisher reserves the right to..."
  does not become friendly copy. If the client's target-market legal wording exists, use it.

### Failure modes

Missing timezone; ambiguous tiebreak; cap dropped; inclusive boundary flipped; "or" rendered as
"and"; reward tier name inconsistent with the reward table; retroactivity assumption inverted.

### Verification

`scripts/rulecheck.py --classes C3 --strict`; eight-component checklist; cross-check every number
and tier name against the reward table.

---

## 4. C4 — Monetization

Gift packs, bundles, top-up, first-charge offers, battle pass, VIP, subscriptions, gacha banner
copy, shop items, limited-time offers.

**Governing constraint:** disclosure accuracy. This class carries legal and platform-policy
exposure. See `events-and-monetization.md` for market-specific obligations.

### Rules

- **Price, contents, quantity, expiry and purchase limit are uneditable facts.** Reproduce
  exactly. If a number cannot be verified, it is a Blocker query.
- **Do not create an implied discount.** "Value 5000, price 500" claims a reference price. If the
  source makes that claim, the client must be able to support it. If the target language's natural
  phrasing manufactures a discount claim the source did not make, rephrase.
- **"Free" means free.** Not "free with purchase", not "free trial that auto-renews". If there is
  a condition, the condition travels with the word.
- **Limited-time and limited-stock claims must be true.** A permanent offer described as limited
  is a dark pattern in several jurisdictions.
- **Gacha odds copy is transcription, not translation.** Base rate, consolidated rate, pity
  threshold, rate-up behaviour and counter carry-over must match the published rate table.
- **Subscription and auto-renewal terms** need renewal period, price, cancellation route and what
  happens to unclaimed benefits. Do not compress.
- **Paid vs free premium currency** stays distinguished.
- **Urgency and scarcity language** — keep it proportional to the source. Intensifying urgency in
  the target is a compliance risk the client did not sign off on.

### Failure modes

Value claim invented by target phrasing; "free" applied to a conditional benefit; odds copy that
drifts from the rate table; auto-renewal buried; per-account purchase limit dropped; currency
symbol or amount transposed.

### Verification

`scripts/rulecheck.py --classes C4 --strict`; the disclosure checklist in
`events-and-monetization.md`; cross-check against the rate table and price list.

---

## 5. C5 — Narrative

Lore, dialogue, character lines, item flavour text, cinematic subtitles, world descriptions.

**Governing constraint:** voice and register. This is the only class with real transcreation
latitude, and the only class where a literal rendering is usually the wrong answer.

### Rules

- **Character consistency over line-level elegance.** Follow the character bible: how the
  character speaks, how they address others, their register, their verbal tics.
- **Address forms are a system, not a per-line choice.** Formality, honorifics and pronoun
  selection between each pair of characters should be decided once and recorded.
- **Names, factions and place names follow the do-not-translate list.** Where a name is
  translated, it stays translated everywhere including UI, store copy and push.
- **Cultural references** — adapt where the reference is opaque in the target and the adaptation
  does not contradict the visuals. If the scene shows the referenced object, you cannot swap it.
- **Humour and wordplay** — recreate the function, not the words. Note the change in the delivery
  so the reviewer does not "fix" it back.
- **Subtitles** obey reading-speed limits and line-break rules, not prose rules.
- **Do not add lore.** Filling a gap with invented world detail is a defect even when it reads
  well.

### Failure modes

Register drift across a long quest chain; a character's speech pattern lost; an address form that
contradicts the relationship shown in the art; a joke translated literally; invented lore.

### Verification

Character bible pass; read the whole quest chain in order, not string by string; check names
against the do-not-translate list.

---

## 6. C6 — Push, mail, popup

Push notifications, in-game mail, banners, interstitials, system announcements.

**Governing constraint:** length, timing, and a single unambiguous action.

### Rules

- **Push is hard-capped** by the OS and truncated silently. Front-load the payload; the first
  clause must carry the message.
- **One call to action.** Two CTAs in a push is a design defect worth flagging.
- **Time-sensitive content must survive delivery lag.** "Ends in 1 hour" fails if the push queues.
  Prefer absolute framing where the source allows it, and flag the risk where it does not.
- **Mail is retained and re-read.** It can be longer, and it must be self-contained: a player
  reading it three days later has lost the context.
- **Announcements carry rule text.** Treat any embedded rule as C3 and any embedded offer as C4.
- **Do not localize a variable that will be filled with an untranslated value.** If
  `{item_name}` resolves to an English item name in the target build, that is a defect to log.

### Failure modes

Truncation at the OS cap; relative time that expires in transit; a push whose CTA does not match
the destination screen; mail that assumes context the reader no longer has.

### Verification

Character count against platform caps; deep-link destination check; preview at device width.

---

## 7. Cross-class checklist

Run before delivering any batch:

- [ ] Every string classified; mixed strings governed by the stricter class
- [ ] Termbase pass clean, including the do-not-translate list
- [ ] `rulecheck.py` clean or every finding explained
- [ ] Length budgets met, with over-budget strings listed rather than truncated
- [ ] All placeholders present, correctly named, order legal for the target grammar
- [ ] All numbers, units, percentages, currencies and dates match source
- [ ] Timezone references preserved
- [ ] Queries logged with a proposed reading and an impact statement
- [ ] Termbase and style-guide amendments listed for writeback

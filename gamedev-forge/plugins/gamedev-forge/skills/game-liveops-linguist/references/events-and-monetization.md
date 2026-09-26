# Event Rules and Monetization Text

The two highest-risk string classes. Errors here produce support load, refund waves, store
takedowns and regulatory exposure — not just bad reviews.

**Currency of this file.** Regulatory statements were verified against public sources in
September 2026. Rules in this area change fast. Treat every regulatory line as
**needs re-verification against the current published rule before it governs a delivery**, and
say so when you rely on one. Nothing here is legal advice; it is a linguist's flag list telling
you when to escalate to the client's legal or compliance owner.

## Contents

1. Event rule wording — the eight components
2. Rule grammar traps
3. Monetization copy rules
4. Gacha and loot box disclosure by market
5. Age rating and content classification touchpoints
6. Platform policy touchpoints
7. Dark pattern flags
8. Escalation triggers

---

## 1. Event rule wording — the eight components

A rule set is complete when all eight are answered. Check the source. A missing component in
source is a query, not something to fill in.

| # | Component | What must be explicit |
|---|---|---|
| 1 | Eligibility | Server, account level, region, account creation date, prior participation |
| 2 | Window | Start and end datetime **with an explicit time reference** — server time, UTC offset, or device local time |
| 3 | Accrual | The qualifying action, the points or progress it grants, whether it counts retroactively |
| 4 | Caps and limits | Per day, per account, per alliance; stock limits; purchase limits |
| 5 | Ranking | The scoring formula and the tiebreak rule (earliest to reach the score is the most common) |
| 6 | Settlement | When results freeze, when rewards are issued, delivery channel (mail, direct, claim) |
| 7 | Expiry | When event currency, tickets and unclaimed rewards disappear, and whether they convert |
| 8 | Exclusion and amendment | Cheating, banned accounts, refunded purchases, publisher's right to amend |

**Tiebreak is the single most commonly omitted component** and the one that generates the most
support volume. If source has a leaderboard and no tiebreak clause, log it.

---

## 2. Rule grammar traps

These convert a correct-sounding sentence into a different rule.

| Trap | Wrong | Right |
|---|---|---|
| Boundary inclusion | "above 100 points" for a threshold meaning 100 and up | "100 points or more" |
| Time boundary | "until 23:59" where source says "before 00:00 the next day" | Match the source boundary exactly |
| Conjunction | "and" where source has "or" — or a target conjunction that reads as both | Restructure into a bulleted list |
| Quantifier | "several" for "up to 5" | Keep the number |
| Modality | "will receive" for "may receive" | Keep the modality |
| Retroactivity | Silence implying progress counts from account creation | State the accrual start |
| Distributive scope | "each player receives 100" vs "players receive 100 in total" | Make the distribution explicit |
| Per-unit scope | "per day" vs "per event" vs "per account" vs "per device" | Never generalize to "per player" |
| Currency of measure | Event points vs premium currency vs soft currency | Use the exact currency term |
| Reset frame | "daily" without a reset time | Carry the reset time and its frame |

**Rule for the target language.** Where the target's natural phrasing cannot carry a distinction
the source makes, restructure — split into two sentences, use a table, use a bulleted list. Do
not accept ambiguity because the language "works that way". Rules text is allowed to be less
elegant than narrative text.

---

## 3. Monetization copy rules

### Uneditable facts

Price, currency, contents, quantity, duration, purchase limit, expiry, renewal terms, and any
probability figure. Reproduce exactly. A number you cannot verify against a source-of-truth asset
(price list, pack table, rate table) is a **Blocker** query.

### Claim discipline

- **Value and discount claims** ("worth 5,000 gems", "80% off") assert a reference price. If the
  target phrasing manufactures a comparison the source did not make, rewrite. If the source makes
  a comparison you cannot substantiate, flag it — unsubstantiated reference pricing is actionable
  under general consumer law in most markets.
- **"Free"** carries no conditions. Free-with-purchase, free-for-new-players, free-trial-then-
  charged are not "free" without the qualifier attached in the same visual unit.
- **"Limited"** must be true — limited time with a stated end, or limited stock with a stated
  quantity. A permanently available offer described as limited is a dark pattern flag.
- **"Exclusive"** must mean not available elsewhere.
- **"Guaranteed"** in a randomized context must map to an actual guarantee mechanic (hard pity,
  batch guarantee), not to a high probability.
- **Urgency intensity** stays proportional to source. Do not add pressure in translation.

### Subscription and auto-renewal

Must carry: renewal period, renewal price, cancellation route, what happens to unclaimed daily
benefits, and whether benefits are lost immediately on cancellation. Compression here is a
frequent source of store-policy violations.

### Currency handling

- Preserve the paid/free premium currency distinction wherever the source makes it.
- Currency symbol placement, decimal separator and thousands separator follow the target locale,
  but must match what the client's price formatter actually emits. A mismatch is a defect to log,
  not a translation to force.
- Never convert prices. Prices are set per storefront.

### Top-up and recharge copy

- "Top-up", "recharge", "purchase" and "deposit" carry different connotations. "Deposit" implies
  refundability in several markets — avoid it unless the client's legal wording uses it.
- First-charge and cumulative-recharge offers must state exactly what counts: which currencies,
  whether refunded purchases subtract, and whether the counter resets.

---

## 4. Gacha and loot box disclosure by market

**Fact (verified Sept 2026), subject to change.** This is a flag list. Whether a specific title
must disclose, in what format, and where, is the client's compliance decision.

| Market | Position | What it means for text |
|---|---|---|
| **South Korea** | Statutory. Game Industry Promotion Act Art. 33 amendment in force since 22 March 2024. Disclosure required **in-game, on the official website, and in advertising**, in Korean. Backed by corrective orders; a 2025 amendment added punitive damages with reversed burden of proof, and further penalty increases were under consideration in 2026. | Every probability figure in Korean-facing text must match the published table. Advertising copy showing a randomized mechanic must carry odds. Regulator case studies of violations exist — the standard is exact figures, not ranges |
| **China** | Statutory disclosure regime dating from the 2016 MOC notice: publish name, content, quantity and draw probability of every obtainable item, plus minors' spending and playtime limits under NPPA notices | Per-item probability, not rounded ranges. Any China-facing text is subject to the client's licence conditions — escalate, do not interpret |
| **Japan** | Kompu gacha (complete gacha) prohibited since 2012 under the Premiums and Representations Act; probability disclosure via JOGA/CESA industry self-regulation | Disclosure format is less prescribed than Korea's, but a mechanic that reads as complete-gacha in the target is a Blocker flag |
| **Taiwan** | Disclosure of probabilities as percentages, displayed on the website main page, login page, purchase page or packaging | Confirm placement, not just presence |
| **Belgium** | Gaming Commission has treated paid loot boxes as gambling since 2018 | Title-level market decision; flag any Belgium-facing gacha copy |
| **Netherlands** | 2022 Council of State ruling — loot boxes not standalone gambling | Lower risk, still subject to general consumer law |
| **European Union** | No loot-box statute. CPC network consumer-protection principles on in-game virtual currency (2025); a Digital Fairness Act proposal was expected late 2026 | Virtual-currency pricing transparency and dark-pattern rules are the live risk, not loot boxes as such |
| **United States** | No federal loot box statute. FTC Act deception standard applies; the 2025 Cognosphere settlement is the reference enforcement action | Obscured or omitted material information is the risk — including odds presentation, currency pricing, and minors' purchases |
| **United Kingdom** | Industry-led (DCMS 2022 response, Ukie principles 2023) | Self-regulatory; general consumer law still applies |
| **Australia** | Mandatory M / R18+ classification for games with paid loot boxes, in force for new releases from 2024 | A rating consequence, not a text consequence — but see section 5 |
| **Indonesia** | No dedicated loot-box statute identified. Gambling simulation content is an IGRS classification factor — see section 5 | Framing matters: copy that presents a randomized purchase in gambling register raises the classification risk |

**Linguist's rule.** Never translate a probability figure loosely, never round, never convert a
fraction to a percentage or vice versa, and never merge base rate with consolidated rate. If the
banner copy and the rate table disagree, that is a Blocker query addressed to the PM, not a
choice between two numbers.

---

## 5. Age rating and content classification touchpoints

Localized text can change a rating obtained on the source script. The usual triggers: profanity
intensity, sexual language, drug and alcohol references, gambling register, and violence
description.

**Indonesia — IGRS.** Fact (verified Sept 2026): the Indonesia Game Rating System, established
under MOCDA (formerly MOCI) Regulation No. 2 of 2024 on game classification, has been enforced
since 24 January 2026. All games distributed or accessible in Indonesia must display an IGRS
rating: 3+, 7+, 13+, 15+, 18+, or RC (Refused Classification). Classification factors include
tobacco and e-cigarettes, alcohol, narcotics, violence, blood and gore, language, character
appearance, pornography, **gambling**, horror, and online interaction. Gambling simulation is an
18+ factor; pornography is an RC factor, and an RC title cannot be sold or advertised in
Indonesia. Non-compliance can lead to reclassification, suspension, access blocking or takedown.

Practical consequence for the linguist: in Indonesian-facing copy, avoid importing gambling
register into gacha and pack text — *judi*, *taruhan*, *jackpot* and their near-synonyms carry
weight that the English source usually does not. Neutral mechanic vocabulary is both more
accurate and lower risk. Flag any source copy that leans into gambling framing.

Other rating boards (ESRB, PEGI, CERO, USK, GRAC, ACB, ClassInd) apply different thresholds to
identical content. Rating strategy is `game-loc-ops` Gate 5 — flag the linkage and hand off.

---

## 6. Platform policy touchpoints

Independent of national law, storefronts impose their own rules. Verify against the current
published policy before relying on any of these.

- Apple and Google both require disclosure of loot-box odds for apps offering them, and both
  regulate the presentation of in-app purchases, subscriptions and auto-renewal.
- Store listing text and in-app text must be consistent. A pack described one way in the store
  and another way in-game is a policy risk and a player-trust problem.
- Declared languages must actually exist in the build (`game-loc-ops` Gate 5).
- Regional pricing and currency display are storefront-controlled. Do not restate a price in text
  that the storefront renders dynamically.

---

## 7. Dark pattern flags

Flag these when you see them in source. You are not the decision-maker, but a senior linguist who
does not raise them is not doing the job.

- Countdown timers that reset, or that are not tied to a real expiry
- Scarcity claims without a real stock limit
- Reference prices that never applied
- Confirm dialogs where the accept action is visually dominant and the decline action is hidden
  or worded as a loss ("No, I don't want to get stronger")
- Currency layering that obscures the real-money price of an item
- Purchase flows that omit the total cost until after confirmation
- Odds presented only as "chance to obtain" without figures where figures are required
- Auto-renewal presented as a one-time purchase
- Minors-facing copy that encourages spending

Report as: the pattern, the string ID, the market where it is highest risk, and the smallest
change that removes the risk.

---

## 8. Escalation triggers

Stop and escalate to the PM or compliance owner — do not resolve in translation:

1. Banner copy and rate table disagree on any number
2. A probability figure is missing where the target market requires one
3. A price, quantity or expiry cannot be verified against a source-of-truth asset
4. Source copy presents a randomized purchase in gambling register for a market where that
   affects classification
5. Source omits a rule component whose absence changes what the player is buying
6. Source claims a discount, guarantee, or exclusivity you have reason to doubt
7. Auto-renewal or subscription terms are compressed below what the platform requires
8. A rule text change arrives after the event has started

Escalation format: what, which string, which market, what breaks, what you recommend. One
paragraph. Do not attach an analysis the PM has to read twice.

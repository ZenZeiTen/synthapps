# Live-Service Game Systems — Mechanical Reference

What each system actually does, the vocabulary that attaches to it, and the disambiguation traps.
Use this before choosing a target term, not after a reviewer disputes one.

## Contents

1. Production, buildings and queues
2. Resources and economy
3. Troops, combat and battle math
4. Heroes, skills, buffs and debuffs
5. Alliances and guilds
6. Gacha, banners and pity
7. Equipment and progression
8. Energy, gating and timers
9. Events and seasons
10. Shared UI vocabulary
11. The disambiguation trap list

---

## 1. Production, buildings and queues

**Mechanic.** The player's base contains buildings that either produce a resource over time,
unlock a system, or gate an upgrade. Buildings occupy a **construction queue** with a finite
number of slots. Upgrading a building takes wall-clock time, reducible with **speedups**.

Vocabulary and what it means:

| Term | Mechanic | Trap |
|---|---|---|
| Level / Lv. | Building tier; gates other upgrades | Distinguish from account level and hero level — three different "level" scales in one UI |
| Requirement / Prerequisite | Condition to start an upgrade | Not the same as *cost* |
| Construction queue / Build slot | Concurrent upgrade capacity | "Queue" implies sequence; some games run parallel slots. Confirm which |
| Speedup | Consumable reducing remaining time | Distinguish *speedup item* from *speed bonus* (a rate buff) |
| Output / Production rate | Resource per hour | Per hour vs per cycle changes the number's meaning |
| Capacity / Storage | Cap before overflow | *Capacity* also used for troop capacity — different system |
| Protected resources | Amount safe from raiding | Legally distinct from *Storage* in most SLGs |
| Boost | Percentage increase to a rate | Additive to other boosts, or multiplicative? Query if unstated |

**Wording note.** Building strings are usually noun phrases in a card layout. Keep them nominal;
do not turn them into sentences to sound natural. The card has no room and the parallel list
breaks visually if one entry is a clause.

---

## 2. Resources and economy

Typical layers, which behave differently and must not share a term:

1. **Basic resources** — food, wood, stone, ore, coin. Farmed, raided, capped by storage.
2. **Premium currency** — gems, diamonds, crystals. Purchased with real money. Usually two
   sub-types: paid and free/earned, tracked separately for refund and regulatory reasons.
3. **Soft currency** — gold, silver. Earned in-game, spent on upgrades.
4. **Event currency** — points, tokens, medals. Time-limited, expires at event end.
5. **Consumables** — speedups, shields, teleports, resource packs, revival items.

**The paid/free split matters.** In several markets the balance shown at checkout, refund
eligibility, and expiry rules differ between paid and earned premium currency. If the source
distinguishes them, the target must too, with two distinct terms. Never collapse them.

**Numbers.** Abbreviated magnitudes (1K, 1.5M, 2B) are locale-sensitive. Some locales expect a
different abbreviation set or none at all. Confirm what the client's number formatter supports
before choosing — a target abbreviation the formatter cannot emit is a wasted decision.

---

## 3. Troops, combat and battle math

**Mechanic.** Units exist in **tiers** (T1–T12 or similar), belong to **types** (infantry,
ranged, cavalry, siege) with a rock-paper-scissors counter relationship, and are trained in a
building at a resource and time cost. Combat resolves as a batch calculation, not a per-unit
simulation, in most SLGs.

| Term | Mechanic | Trap |
|---|---|---|
| Tier / T-level | Unit power grade | Distinct from *rarity* and from building level |
| Type / Class | Counter relationship group | Some games call this *branch* or *arm* |
| March | A dispatched force and its slot | *March* is both the act and the object. Split the terms if the target needs to |
| Rally | Multi-player attack led by one player | Not a synonym for *march* or *attack* |
| Reinforcement / Garrison | Troops sent to defend another's base | Two different mechanics in many games — confirm |
| Power / Might | Aggregate strength score | Not a stat; it is a derived display number |
| Wounded / Severely wounded / Dead | Troop loss states with different recovery | Three states; collapsing to two loses information the player needs |
| Healing / Hospital capacity | Recovery of wounded troops | Capacity overflow converts wounded to dead — say so if source does |
| Load | Resource-carrying capacity of a march | Distinct from troop capacity |
| Stamina | Cost to launch actions on the world map | Distinct from energy in the PvE sense |

**Battle math wording.** Damage, defence, attack, HP, lethality, and health are separate stats in
most SLGs even where common speech conflates them. Fix one target term per stat and enforce it.
"Attack" as a stat and "Attack" as a button are different strings and may need different targets.

---

## 4. Heroes, skills, buffs and debuffs

**Mechanic.** Heroes carry active skills (triggered), passive skills (always on), and are
upgraded through level, star or ascension tiers, and skill levels — three independent tracks.

The **skill description grammar** is where most senior-level errors live. A skill line typically
encodes six things, and dropping any one is a mistranslation even if the sentence reads well:

1. **Trigger** — when it fires (on attack, on turn start, with probability X%, on condition)
2. **Target** — who it affects (self, ally, all allies, enemy, all enemies, random N)
3. **Effect** — what changes (damage, stat modifier, status)
4. **Magnitude** — the number and its scaling base
5. **Duration** — turns, seconds, until dispelled, permanent
6. **Stacking rule** — stacks to N, refreshes, does not stack, overrides

**Scaling base is the most common ambiguity.** "Increases attack by 30%" can mean 30% of base
attack, 30% of current attack, or +30 percentage points to an attack bonus. These are different
numbers in play. If the source does not say, that is a query, not a judgement call.

**Buff and debuff vocabulary.** Keep a fixed target term per status: stun, silence, freeze, root,
slow, burn, poison, bleed, shield, immunity, cleanse, dispel, taunt, invisibility, reflect,
lifesteal, crit, penetration, block, dodge, accuracy, resistance. Many targets have near-synonyms;
pick one per status and lock it. Players learn these as system labels, not as prose.

**Immunity vs resistance** is a recurring failure. Immunity is binary; resistance is a
probability or magnitude reduction. If the target language blurs them, disambiguate explicitly.

---

## 5. Alliances and guilds

| Term | Mechanic | Trap |
|---|---|---|
| Alliance / Guild / Clan | The player group | Whichever the client uses, one term everywhere, including UI, mail, push and store copy |
| Rank / Title | In-alliance role with permissions | *Rank* also means leaderboard position — split the terms |
| Alliance Help | Others reduce your build timer | Not a donation and not a gift |
| Donation / Contribution | Resources given to alliance stock | Contribution often also a score. Two meanings, two terms |
| Alliance Tech / Research | Shared upgrade tree | Distinct from personal research |
| Territory / Zone / Region | Map control unit | Territory wording carries political sensitivity in some markets — see cultural-risk.md |
| War / Rally / Siege | Group combat events | Distinct events with distinct rules |
| Kick / Leave / Transfer leadership | Membership actions | Irreversible actions need unambiguous confirm-dialog wording |

Alliance strings are heavy in chat, mail and push. They are read fast and often out of context.
Prefer the plainest formulation the register allows.

---

## 6. Gacha, banners and pity

**Mechanic.** The player spends currency for a randomized draw from a defined pool. Modern
implementations layer several rules, all of which are disclosure-relevant.

| Term | Mechanic | Why the wording is load-bearing |
|---|---|---|
| Banner / Pool / Wish / Summon | The draw instance and its item pool | Fixed term per client; players cross-reference community guides |
| Rate / Probability / Drop rate | Chance per draw | Must match the published rate table exactly, including base vs consolidated rate |
| Base rate vs consolidated rate | Rate ignoring pity vs including it | Different numbers. Mixing them misstates odds |
| Pity / Guarantee | Guaranteed outcome after N draws | Soft pity (rising rate) and hard pity (certain) are different. Do not merge |
| Rate-up / Featured | Increased chance for specific items | State whether the featured item is guaranteed on the rate-up trigger |
| 50/50 | Chance the guaranteed pull is the featured item | Community term; check whether the client uses it officially |
| Carry-over | Counter persistence across banners | Frequently omitted from source. Query it |
| Multi / 10-pull | Batch draw, sometimes with its own guarantee | The batch guarantee is separate from pity |
| Duplicate conversion | What happens on a repeat | Players decide spend on this. Never leave it vague |

**Rule.** Any number in gacha copy is regulated content in at least one market. Treat it as
uneditable. Confirm every rate, counter and threshold against the source and against the rate
table asset if one exists. Discrepancy between the rate table and the banner copy is a
**Blocker** query, not a preference note.

See `events-and-monetization.md` for disclosure obligations by market.

---

## 7. Equipment and progression

Multiple stacked tracks, each with its own verb. The verbs are frequently conflated in translation
and the result is a player who cannot find the button:

| Track | Typical verb | What it does |
|---|---|---|
| Enhance / Upgrade | Enhance | Raises level using materials, usually reversible or safe |
| Refine / Reforge | Refine | Rerolls or improves sub-stats, usually random |
| Ascend / Awaken / Promote | Ascend | Raises the tier ceiling, usually consumes duplicates |
| Star up / Rank up | Star up | Raises star grade |
| Evolve | Evolve | Changes the item or hero identity |
| Inherit / Transfer | Inherit | Moves progress from one item to another |
| Dismantle / Salvage / Recycle | Dismantle | Destroys for materials |
| Lock | Lock | Prevents accidental dismantling |
| Set / Suit | — | Bonus for wearing matched pieces |
| Sub-stat / Main stat | — | Fixed vs random attribute lines |

**Rule.** One verb per track, never reused. If the target language has fewer natural verbs than
the source has tracks, coin a consistent distinction and record it in the termbase with a note
explaining the mechanic. A reviewer will otherwise "correct" it back into ambiguity.

**Destructive actions** — dismantle, overwrite, reset, transfer — need confirm-dialog wording that
states what is lost. If the source dialog omits it, that is a source-defect query with a player
harm consequence attached.

---

## 8. Energy, gating and timers

- **Energy / Stamina / AP** — consumable gating PvE attempts, regenerating over time.
- **Attempts / Challenges remaining** — discrete daily counts, distinct from energy.
- **Cooldown** — per-ability or per-action wait.
- **Reset** — daily, weekly, seasonal. Always has a timezone. Server time and local time are
  different and the string must say which.
- **Expiry** — items and event currency that vanish. Expiry wording is consumer-facing and must
  be exact.

**Timezone rule.** If the source says "daily reset at 00:00", the target must carry the same
reference frame (server time, UTC offset, or local). Silently dropping "server time" is a defect
that generates support tickets on every reset.

---

## 9. Events and seasons

Common event archetypes and what their rules must specify:

| Archetype | Must specify |
|---|---|
| Login / check-in | Consecutive vs cumulative, missed-day behaviour, reset time |
| Mission / task | Whether progress counts retroactively, whether it resets |
| Ranking / leaderboard | Scoring formula, tiebreak, settlement time, reward delivery method |
| Exchange / shop | Currency source, expiry of unspent currency, stock limits |
| Milestone / cumulative spend | What counts toward it, whether refunds subtract |
| Time-limited banner | Start and end, timezone, carry-over of counters |
| Server-merge or cross-server | Eligibility, which server's time applies |

Full rule-component checklist in `events-and-monetization.md`.

---

## 10. Shared UI vocabulary

Fix these once and never vary: Claim, Collect, Receive, Get, Go, Go to, Use, Equip, Unequip,
Confirm, Cancel, Back, Close, Details, More, View, Buy, Purchase, Recharge/Top-up, Free, Limited,
Sold out, Owned, Locked, Unlocked, Available, Insufficient, Max, Auto, Skip, Retry, Sweep, Claim
all, Select all.

**Claim vs Collect vs Receive vs Get** are often four source words for one action. Decide whether
the client actually distinguishes them. If not, unify in the target and record the decision —
four target terms for one action makes the UI feel machine-made.

**Free** is a regulated word in monetization contexts. See `events-and-monetization.md`.

---

## 11. The disambiguation trap list

Same source word, different mechanic. Always ask which one before translating:

- **Level** — building / account / hero / skill / equipment
- **Rank** — alliance role / leaderboard position / equipment grade
- **Capacity** — storage / troop / march / hospital
- **Power** — displayed might score / a stat / an energy resource
- **Charge** — attack action / battery-style meter / top-up payment
- **Boost** — rate buff / consumable item / marketing intensifier
- **Chest** — loot container / equipment slot
- **Guard** — defensive stat / unit type / verb
- **Skill** — hero ability / player proficiency / talent-tree node
- **Point** — event currency / score / a location on the map / an attribute point
- **Recruit** — gacha pull / troop training / alliance invitation
- **Draw** — gacha pull / a tie in PvP
- **Shield** — protection item / defensive stat / a status effect
- **Speed** — march speed / a stat / speedup consumable
- **Star** — rarity grade / progression tier / rating
- **Pack** — purchasable bundle / troop group / resource item
- **Season** — battle pass cycle / competitive cycle / narrative arc
- **Rate** — probability / production per hour / exchange ratio
- **Slot** — equipment slot / queue slot / gacha banner position
- **Support** — reinforcement / customer service / a hero role

When the answer is not in the LocKit or the build, it is a query. Log it.

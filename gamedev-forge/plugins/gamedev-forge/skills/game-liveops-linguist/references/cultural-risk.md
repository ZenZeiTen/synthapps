# Cultural Risk Review — Text, Image, Video

Purpose: give a PM a decision, not an essay. Every finding names the risk, the affected markets,
a severity, and options with consequences.

**You report; the PM decides.** Do not sanitize content unilaterally, and do not present a
judgement call as a rule. Label every finding **Fact** (a documented rule, rating criterion or
published platform policy), **Inference** (pattern from comparable incidents), or **Speculation**.

**Currency.** Regulatory and rating statements verified September 2026. Re-verify before relying
on any of them for a delivery decision.

## Contents

1. Ten risk domains
2. Severity model and the options frame
3. Reviewing images and video
4. Indonesia annex
5. Short market notes
6. What is not a cultural risk

---

## 1. Ten risk domains

Scan text, image and video against each. Most incidents come from the first four.

**1. Religion.** Sacred symbols used as decoration or loot; deities as playable characters;
scripture as flavour text; prayer postures as emotes; religious architecture as destructible
terrain; food and drink prohibitions rendered as rewards; the word for a deity used as an
interjection.

**2. National and political symbols.** Flags, national emblems, currency, uniforms, anthems.
Flag misuse is regulated in several countries. Fictional flags that closely resemble real ones
carry the same risk.

**3. Historical trauma.** Wars, occupations, genocides, colonial periods, coups, famines. A
faction, uniform, insignia or campaign name that maps onto a real atrocity is a high-severity
finding regardless of intent. Insignia resembling banned symbols is a legal issue in some
markets, not only a taste issue.

**4. Gestures and body language.** Hand signs, pointing, foot display, head touching, beckoning,
thumbs-up, the OK sign, crossed fingers. Meaning inverts across regions. Idle animations and
emotes are the usual carriers.

**5. Colour and number symbolism.** Mourning colours; unlucky numbers in pricing, tier names and
floor counts; colour-coded rarity tiers that read differently by market.

**6. Gender and body depiction.** Costume coverage, proportions, camera framing, age-ambiguous
characters. Age ambiguity combined with sexualized framing is the highest-severity item in this
domain across every market and every platform policy.

**7. Gambling framing.** Slot-machine visuals, casino chips, jackpot language, spinning wheels,
card-draw imagery attached to paid randomized mechanics. Affects classification in several
markets — see the Indonesia annex and `events-and-monetization.md`.

**8. Sexuality and LGBTQ depiction.** Legal exposure in some markets, community expectation in
others. This is a market-strategy decision with real consequences in both directions; report the
positions, do not advocate.

**9. Minority and ethnic depiction.** Stereotyped accents, names, professions, magic systems
drawn from living traditions, indigenous imagery used as aesthetic.

**10. Maps and territorial claims.** Disputed borders, place names, sea names, island depictions.
Map assets have caused market bans. Any map in a game shipping to Greater China, India, South
Korea, Japan, Turkey, Israel or the Gulf gets a specific check.

---

## 2. Severity model and the options frame

| Level | Meaning | Default action |
|---|---|---|
| **Blocker** | Store rejection, legal exposure, rating refusal, or credible boycott risk | Do not ship in market; escalate same day |
| **High** | Predictable community backlash or a rating change | Change before launch |
| **Medium** | Reads as tone-deaf; erodes trust | Change if cost is low; log if not |
| **Low** | Suboptimal but defensible | Note only |

For every Blocker and High finding, give options in this shape:

```
Option 1 — Change globally.     Cost: X. Consequence: Y.
Option 2 — Change in market N.  Cost: X. Consequence: divergent asset set.
Option 3 — Ship as is.          Consequence: Z. Who accepts this risk.
```

Three options, one line of consequence each. If Option 3 is genuinely untenable, say why in one
sentence rather than omitting it — a PM needs to see the rejected option to trust the other two.

---

## 3. Reviewing images and video

Text review misses most of the risk. Work through the asset systematically.

**Images.** Foreground subject; background detail (signage, posters, architecture, books);
clothing and insignia; hand and body position; colour scheme; any script or writing visible;
any map; any food, drink or substance; any symbol on a shield, banner, tattoo or wall.

Background detail is where most incidents originate. Concept artists place plausible-looking
signage and symbols without checking what they mean.

**Video.** Everything above per scene, plus: gestures in animation; ritual actions; music and
instrumentation with religious or national associations; sound effects; on-screen text; anything
a single frame shows that the moving image hides.

**Character and faction naming.** Names, titles, faction names and place names may map onto real
groups, historical figures or slurs in a language nobody on the team speaks. Check against the
target language and the languages of neighbouring markets.

---

## 4. Indonesia annex

The most detailed annex here because it is the working market for this desk. Everything below is
a flag list for a PM decision, not a legal opinion.

### Regulatory frame

**Fact (verified Sept 2026).** The Indonesia Game Rating System (IGRS), established under MOCDA
(formerly MOCI) Regulation No. 2 of 2024 on game classification, has been enforced since
24 January 2026. Every game distributed or accessible in Indonesia must carry an IGRS rating:
3+, 7+, 13+, 15+, 18+, or RC (Refused Classification). Classification is by publisher
self-assessment followed by review by certified IGRS examiners; ratings must be displayed on
descriptions, packaging and advertisements, and games must be reclassified annually if updated.
Non-compliance can lead to reclassification, suspension, access blocking or takedown. Separately,
online game operators are within the PSE electronic system provider registration regime.

Classification factors include: tobacco and e-cigarettes, alcohol, narcotics, violence, blood and
gore, language, character appearance, pornography, gambling, horror, and online interaction.
**Gambling simulation is an 18+ factor. Pornography is an RC factor**, and an RC title may not be
sold or advertised in Indonesia.

Practical consequence for a linguist working into Indonesian:

- **Do not import gambling register into monetization copy.** *Judi*, *taruhan*, *jackpot*,
  *undian berhadiah* and near-synonyms carry weight the English source usually does not intend,
  and gambling framing is a live classification factor. Neutral mechanic vocabulary is both more
  accurate and lower risk. Flag source copy that leans into casino framing.
- **Flag alcohol, tobacco and narcotics references** in item names, flavour text and art. These
  are explicit classification factors.
- **Flag horror intensity and gore** in event and seasonal content, which is where it usually
  arrives unannounced.
- **Chat and online interaction** is itself a classification factor. Moderation-adjacent strings
  matter more here than in markets without this criterion.

### Cultural sensitivities

**Religion.** Indonesia is majority Muslim with substantial Christian, Hindu, Buddhist and
Confucian populations, and religion is socially and legally salient. High-attention items:
Quranic text or Arabic calligraphy used decoratively; mosque architecture as destructible terrain;
pig and pork imagery in food and reward assets; alcohol as a reward or healing item; deity
depiction; prayer or prostration postures used as defeat or mockery animations; the crescent and
star and their close variants; the word *Allah* and religious interjections used casually.
Blasphemy is prosecutable in Indonesia — **Fact**, and reason to treat this domain as Blocker-
class by default.

**National symbols.** The red-and-white flag, Garuda Pancasila, and the national anthem carry
statutory protection. Fictional flags closely resembling the national flag are a real risk.

**Historical trauma.** The 1965–66 mass killings and the communist symbol (hammer and sickle)
are exceptionally sensitive; display of communist symbols is legally constrained. Colonial-era
references, the Papua question and separatist symbolism (Morning Star flag) are high-severity.
Aceh and East Timor references need care.

**Maps.** Territorial depiction involving Papua, the Natuna waters and Indonesian archipelagic
boundaries is a specific check. Any world map in the build gets reviewed.

**Gestures and body language.** Left hand for giving, receiving or pointing is impolite. Pointing
with the index finger is impolite; the thumb is the polite alternative. Showing the sole of the
foot is offensive. Touching an adult's head is offensive.

**Language register.** Indonesian has a wide formality range and game UI conventionally sits in
neutral-to-casual register. Two decisions that must be made once and recorded in the style guide:
second-person address (*kamu* vs *Anda* vs avoidance by rephrasing) and whether the target uses
established English loanwords that players already know from the community. Over-translating
familiar mechanic terms into unfamiliar Indonesian coinages makes a build feel foreign to its own
players — a real player-experience cost, not a purity question.

**Profanity.** Indonesian profanity is heavily regional and some terms are far stronger than
their English glosses suggest. Anything that could function as an ethnic slur (including the
SARA-sensitive categories — suku, agama, ras, antargolongan) is Blocker-class.

**Practical positive note.** Indonesian players are a large, community-driven, guide-reading
audience. Terminology consistency and a stable, recognizable term set matter more to perceived
quality here than elegant prose.

---

## 5. Short market notes

Brief flags only. Escalate to a market specialist for anything above Medium.

- **Malaysia, Brunei** — similar religious sensitivities to Indonesia; alcohol, pork, gambling,
  and religious imagery. Racial/religious content is legally constrained.
- **Thailand** — lèse-majesté; Buddha imagery used decoratively or as a floor asset; head and
  feet symbolism.
- **Vietnam** — territorial maps (South China Sea), historical war content, government licensing.
- **Philippines** — religious imagery; colonial history.
- **MENA and the Gulf** — religious content, alcohol, pork, gambling, nudity, LGBTQ depiction,
  Israel-related content, and territorial naming (Arabian/Persian Gulf). Frequent asset divergence.
- **Greater China** — licensing regime, maps and territorial depiction, skeletons and blood
  colour, superstition and occult content, historical figures, minors' protection rules.
- **South Korea** — historical content involving Japan; territorial naming (East Sea/Sea of
  Japan, Dokdo); statutory gacha disclosure.
- **Japan** — kompu gacha prohibition; historical and imperial imagery; expression conventions.
- **Germany** — unconstitutional symbols; historical content thresholds; USK gambling criteria.
- **Brazil** — ClassInd criteria; racial depiction; religious syncretism.
- **Russia and CIS** — legal restrictions on LGBTQ depiction and on certain historical and
  extremist symbols.
- **India** — religious imagery (especially Hindu deities and cow imagery), maps and borders,
  caste depiction.
- **Turkey** — Atatürk and national symbols; Armenian and Kurdish historical content.

---

## 6. What is not a cultural risk

Do not inflate the report. These are not findings:

- A translation choice you would have made differently
- Content that is unusual in the target market but not offensive
- Fictional religions, nations and conflicts that do not map onto real ones
- Violence at a level already established by the game's rating
- Anything already cleared by a documented client decision — cite the decision instead of
  reopening it

A cultural risk report that flags everything is functionally the same as one that flags nothing.
Rank by severity, keep the Blocker list short, and make it defensible.

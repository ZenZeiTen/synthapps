# Gate 5 — Release Compliance

Four independent gates that teams routinely collapse into one and then fail separately.
Passing certification does not confer a rating. Holding a rating does not make content legal
in every market. Legal content can still fail store parity.

⚠️ **Scope discipline.** This reference describes *how the gates work* and *what they test*.
It is not a substitute for the platform's own requirement documentation (which is NDA-bound
and version-specific), a rating board's current criteria, or legal advice. Where a specific
requirement matters, get it from the licensee's official channel. Never reconstruct a
requirement from memory or from a public secondary source.

## Contents

1. [Platform certification](#1-platform-certification)
2. [Store and build language parity](#2-store-and-build-language-parity)
3. [Age ratings and content descriptors](#3-age-ratings-and-content-descriptors)
4. [Culturalization and regional content](#4-culturalization-and-regional-content)
5. [Monetization disclosure](#5-monetization-disclosure)
6. [Voice work, AI replicas, and consent](#6-voice-work-ai-replicas-and-consent)
7. [Compliance sign-off checklist](#7-compliance-sign-off-checklist)

---

## 1. Platform certification

Each console platform holder runs its own approval process before a title can be sold:

| Platform | Process | Common name |
|---|---|---|
| Sony PlayStation | Technical Requirements Checklist | TRC |
| Microsoft Xbox | Xbox Title Requirements (historically XR / TCR) | XR |
| Nintendo | Lotcheck | Lotcheck |

**Localization requirements live inside these frameworks, not beside them.** They cover, in
broad terms: correct text rendering across the character sets the title declares (CJK,
Cyrillic, Arabic), consistency between the store listing and the build, UI behavior under
regional system settings, platform-mandated terminology, and completeness of every declared
language.

Two properties of certification drive the entire schedule:

1. **A localization failure is a certification failure.** It occupies the same resubmission
   queue as a crash. Reported queue resets run in the multi-week range, and each failed
   submission adds meaningful direct rework cost before counting the lost launch window.
2. **Cost of late detection is non-linear.** Integrating certification checks from early
   development is consistently reported to reduce late-cycle rework by a large multiple versus
   discovering the same issues at submission.

Practical implications for the localization pipeline:

- Run a **mock certification pass** against the platform's own baseline test plan before real
  submission. Treat it as a real submission.
- Name a **single cert owner**. Vendor fragmentation with no named owner is a recurring root
  cause of certification failure on outsourced titles.
- Test on **devkits**, not just PC. PC-native assumptions about text rendering, input prompts,
  and system-locale behavior do not survive contact with console hardware.
- Structure the LQA bug report to **match the platform's failure-report format**, so fixes map
  one-to-one onto findings and resubmission is mechanical.

## 2. Store and build language parity

Every language declared on a storefront product page must actually be present and complete in
the build, at the level of support declared (interface / subtitles / full audio).

This is the most avoidable cert failure in the list. Checks:

- [ ] Declared languages ↔ shipped language packs match exactly, both directions
- [ ] Support level per language is accurate (interface-only is not "full audio")
- [ ] Store description, screenshots, and trailers exist for each declared language
- [ ] Terminology in store metadata matches terminology in the build
- [ ] Age-rating art and descriptors correct for each territory's storefront
- [ ] Regional pricing and availability set for every declared territory
- [ ] Post-launch content drops do not silently regress a declared language

For live-service titles, add parity to the release checklist for **every** content drop. A
drop that ships English-only strings into a build declaring twelve languages is a regression.

## 3. Age ratings and content descriptors

Different boards apply different standards to identical content, so a single build rarely
satisfies every market:

| Board | Territory | Broad tendency |
|---|---|---|
| ESRB | US / Canada | Comparatively permissive on violence, stricter on sexual content; runs post-release verification with substantial penalties for misrepresenting content |
| PEGI | Europe (30+ countries) | Flags discrimination explicitly; active on randomized-purchase disclosure |
| USK | Germany | Restricts unconstitutional symbols and glorification of war; German law (StGB §86a) has historically driven content changes |
| CERO | Japan | More permissive on sexual content; sensitive to certain historical and nuclear themes |
| GRAC | South Korea | Statutory; separate submission |
| ACB | Australia | Can refuse classification outright, which bans sale |
| ClassInd | Brazil | Separate criteria and submission |
| NPPA | Mainland China | Licence/ISBN approval; restricts content involving superstition, certain political themes, and depictions of gore |

**Why this is a localization gate, not just a legal one.** Ratings are granted against
submitted content. The localized script *is* content:

- intensifying profanity beyond the source register can push a rating band
- a euphemism rendered literally can introduce a descriptor the source did not carry
- culturally-loaded terminology can trigger a discrimination descriptor
- localized store descriptions and trailers are also rated material in some territories

Rule: **the localized script must be reviewed against the target board's criteria before
submission**, and any deliberate intensification or softening must be a recorded decision with
a named owner — not a translator's unilateral choice.

Content descriptors must remain accurate for every locale. If the German build removes a
content element, its descriptors change with it.

## 4. Culturalization and regional content

Culturalization goes beyond translation: it is the deliberate review of game content against
the norms, laws, and sensitivities of each target market.

Risk categories, each weighted differently per market:

- religious imagery, deities, sacred texts and sites, rituals
- political references, contested territory, maps, flags, national symbols
- historical symbols and events
- violence thresholds, gore, dismemberment, depictions of death
- sexual content and nudity
- racial and ethnic representation
- gambling and gambling-adjacent mechanics
- drug and alcohol references
- disability representation

**Decision framework.** For each flagged element, pick one of three and record it:

| Option | Use when | Cost |
|---|---|---|
| **Adapt** | The element can be changed without breaking design intent | Asset + code work; per-market build variance |
| **Remove** | The element is non-essential and the risk is material | Content loss; possible narrative gap |
| **Keep with disclosure** | The element is essential and the risk is acceptable | Higher rating band; possible refusal in some territories |

Do this in **pre-production**, as a defined pipeline stage with named owners — ideally a
cultural consultant, a legal reviewer, and a regional ratings specialist working alongside
the localization team. Handled at submission, the same decisions become emergency asset work
against a locked launch date.

Feed the outcome back into the LocKit as a sensitivity note per affected string, so linguists
do not reintroduce a removed reference through a colorful idiom.

## 5. Monetization disclosure

Increasingly, this is a localization deliverable rather than purely a business one:

- Randomized-purchase (loot box) probability disclosure is contractually required under PEGI's
  code of conduct — disclosed before purchase, transparent, and equal for all players. That
  disclosure text must be **translated, findable, and accurate in every locale**.
- Several territories require in-game spending, age assurance, or identity verification
  controls; the associated UI text is legally-sensitive content and belongs in the "0 critical,
  OQS ≥ 99" class from `lqa-mqm.md`.
- Subscription, refund, and consumer-rights text is jurisdiction-specific. Do not translate a
  US refund policy into German and assume it is compliant.

## 6. Voice work, AI replicas, and consent

If the project involves synthetic, cloned, or AI-generated voice, consent is a gate, not a
formality.

The landscape as of the last verified update:

- **SAG-AFTRA's 2025 Interactive Media Agreement** — ratified after the year-long video game
  performers' strike — governs voice, motion capture, and stunt performance for signatory
  studios and carries AI-specific protections. It applies nationwide in the US regardless of
  where a studio incorporates.
- **California AB 2602** voids contract provisions permitting a digital replica to replace
  work the performer would otherwise have done, where the provision lacks a reasonably specific
  description of the intended use and the performer was not represented by counsel or a union.
  **AB 1836** requires estate consent for digital replicas of deceased performers.
- Comparable statutes have been enacted or proposed in other US states (Tennessee's ELVIS Act,
  and legislation in New York, Illinois, Florida, and Texas among others).
- Sector agreements covering digital voice replicas typically require: transparency about what
  the replica will produce, per-project consent, time limits on availability without further
  consent and payment, limits on confidentiality terms, and data-security protections for the
  voice model itself.

**Operating rules for this skill:**

1. Do not assist in creating, training, or deploying a voice replica without documented,
   project-specific consent. "The contract has a broad AI clause" is precisely the thing these
   statutes were written to void.
2. Consent documentation must name the project, the use cases, the media, the term, and the
   territory. A generic release is not consent.
3. Treat the voice model as protected data under `security-protocol.md`, with the same custody
   rules as an unreleased build.
4. Localized synthetic voice inherits every one of these constraints — a cloned voice speaking
   a different language is still that performer's voice.
5. Some markets require disclosure that content is AI-generated. Check per territory; where it
   applies, the disclosure string is legally-sensitive content.

None of this is legal advice. Where a specific obligation matters, route it to counsel.

## 7. Compliance sign-off checklist

**Certification**
- [ ] Current platform requirement documentation obtained through official channels
- [ ] Named cert owner assigned
- [ ] Mock certification pass completed on devkit for every target platform
- [ ] Platform-mandated terminology applied per platform per locale
- [ ] Bug report structured to match platform failure-report format

**Parity**
- [ ] Declared store languages = shipped languages, both directions
- [ ] Support level accurate per language
- [ ] Store metadata localized and terminology-consistent with the build
- [ ] Parity check added to the recurring content-drop checklist

**Ratings**
- [ ] Localized script reviewed against each target board's criteria
- [ ] Deliberate register changes recorded with a named owner
- [ ] Content descriptors accurate for every regional build variant
- [ ] Rating art and descriptors correct on every storefront

**Culturalization**
- [ ] Sensitivity review completed in pre-production
- [ ] Adapt / remove / keep-with-disclosure decision recorded per flagged element
- [ ] Decisions propagated to the LocKit as per-string sensitivity notes
- [ ] Per-market build variance documented and version-controlled

**Monetization and legal**
- [ ] Randomized-purchase odds disclosed and translated where required
- [ ] Age assurance / spending controls localized
- [ ] Consumer-rights and refund text jurisdiction-checked, not just translated

**Voice**
- [ ] Performer consent documented per project for any replica or synthetic voice
- [ ] Consent names project, use, media, term, territory
- [ ] Voice models held under build-grade custody
- [ ] AI-disclosure obligations checked per territory

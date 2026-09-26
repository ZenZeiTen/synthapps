# [Title] — [Target Locale] Style Guide

Version: 0.1 · Owner: · Last updated: · Supersedes:

This guide binds every linguist and reviewer on the title. Where it conflicts with a personal
preference, this guide wins. Where it conflicts with the client's platform terminology or a legal
wording requirement, those win — record the exception here rather than leaving it undocumented.

---

## 1. Product and audience

- Title, genre, platform, storefronts
- Target market and player profile
- Age rating held in this market, and what that constrains
- Community conventions: which English terms the player base already uses and expects

## 2. Register and voice

- Overall register (formal / neutral / casual) and where it shifts
- Second-person address form, and the decision rationale
- Whether the game addresses the player, the character, or both
- System voice vs character voice
- Humour policy
- Profanity policy and the ceiling set by the age rating

## 3. Address and honorifics

- Player-facing address form
- Character-to-character address matrix (from the character bible)
- Titles, ranks and honorifics: translate, transliterate, or keep

## 4. Terminology

- Termbase location and version
- Do-not-translate list
- Forbidden terms and why
- Escalation route for a new term
- Sequel and franchise continuity constraints

## 5. Numbers, dates, time, currency

- Decimal and thousands separators, and what the runtime formatter emits
- Large-number abbreviation set, or none
- Date format, long and short
- Time format, 12h or 24h
- Time reference convention (server time / UTC / local) and how it is worded
- Currency symbol placement and spacing
- Ordinal and ranking formats
- Units of measure

## 6. Capitalization and punctuation

- Headline and button capitalization
- Terminal punctuation in UI labels
- Quotation marks
- Ellipsis, dash and spacing conventions
- List punctuation

## 7. Placeholders, variables and tags

- Placeholder syntax in use
- Which placeholders may be reordered
- Gender and plural handling, and the CLDR categories that apply
- Rich-text tag syntax and what may sit inside a tag
- Concatenation constraints and known concatenation strings

## 8. UI conventions

- Buttons: imperative, and the standard verb set
- Tabs and headers: nominal
- Length budgets: source of truth and what to do when a string will not fit
- Error message pattern: cause plus remedy
- Confirm dialog pattern for destructive actions
- Empty state pattern
- Tooltip pattern

## 9. Event rules and monetization

- Rule-component checklist in force
- Legal wording that must be used verbatim
- Disclosure requirements applying in this market
- Words that may not be used (see the market's classification factors)
- Escalation triggers

## 10. Narrative

- Character bible location
- Name policy: translated, transliterated, or kept
- Faction and place name policy
- Subtitle spec: reading speed, line count, line length, break rules

## 11. Cultural constraints for this market

- Domains requiring pre-clearance
- Known prior decisions and their rationale
- Assets that diverge in this market and why

## 12. QA and delivery

- QA profile in force and its tuning notes
- Checks deliberately disabled, and why
- Delivery format and naming
- Writeback obligations after each LQA cycle

## 13. Decision log

| Date | Decision | Rationale | Decided by | Supersedes |
|---|---|---|---|---|
| | | | | |

A decision without a rationale gets relitigated by the next reviewer. Fill this in.

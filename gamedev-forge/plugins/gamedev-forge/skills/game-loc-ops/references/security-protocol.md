# Gate 0 — Custody and Confidentiality Protocol

Game localization handles some of the most leak-sensitive material in the software industry.
An unreleased build is simultaneously: unpublished intellectual property, a marketing asset
whose reveal timing has been paid for, and — for narrative titles — a spoiler payload whose
premature disclosure directly damages commercial value.

The localization supply chain is also unusually long: publisher → vendor → project manager →
translators → editors → LQA testers → localization engineers, often across several countries.
Every hop is an exposure point. One weak link is enough.

This gate runs **before** content is touched, not after something goes wrong.

## 1. Scope confirmation — the four questions

Confirm all four in writing before opening a file.

### 1.1 What tooling is approved?

The critical distinction is **retention and training**, not whether a tool is "AI".

| Category | Acceptable for unreleased builds |
|---|---|
| Consumer/free MT and chat endpoints that retain or train on submitted text | **No** |
| Enterprise MT/LLM with contractual no-retention and no-training terms | Only if named in the contract |
| Self-hosted or on-premise engines inside the client's or vendor's network | Generally yes |
| CAT tool with client-owned TM, no third-party MT plugin enabled | Yes |

If the client prohibits external AI processing of their content — a common and reasonable
clause in game and clinical work alike — **that prohibition binds this skill.** Do not paste,
summarize, or process the content through anything outside the approved set, and say so
directly rather than quietly working around it.

Watch for the silent leak: a CAT tool with an MT plugin enabled by default will send every
segment to an external engine without anyone choosing to. Audit plugin configuration per
project, not per tool.

### 1.2 Who may hold the build?

- named individuals, not "the team"
- named machines, with disk encryption confirmed
- devkit custody logged; devkits are individually identifiable and traceable
- no personal cloud storage, no personal devices, no shared consumer file-transfer links
- no work over unencrypted public networks — VPN required for remote linguists, which is the
  normal working arrangement for freelance game linguists
- a defined end-of-project action: return or certified destruction of all copies, including
  local caches, cloud copies, and backups

### 1.3 What may be captured?

LQA generates screenshots and video. Every capture is a potential leak vector carrying more
than the bug it documents.

Redact before attaching:

- build identifiers, branch names, internal version strings
- debug overlays, console output, performance HUDs, developer menus
- account names, gamertags, PSN/Nintendo IDs, tester email addresses
- unreleased content visible in the frame but outside the bug's scope — a minimap revealing an
  unannounced region, an inventory containing an unannounced item
- anything in an adjacent window if the capture is full-screen

Prefer cropped captures over full-screen. Where the platform supports it, apply a per-tester
watermark so a leaked asset is traceable to its source; this changes behavior more reliably
than a policy document.

### 1.4 Who needs to see what?

Narrative strings are spoilers. Apply need-to-know segmentation:

- split narrative content by act or chapter where the workflow allows
- reveal-critical content (final boss, twist, post-credits, unannounced characters) goes to a
  reduced, individually-NDA'd group
- LQA testers on story content are inside the spoiler perimeter by necessity — count them in
  the exposure model rather than pretending they are not

## 2. Contractual layer

An NDA is the floor, not the structure.

- **Define confidential information explicitly.** "Game design documents, source code, art
  assets, unreleased roadmaps, build binaries, narrative scripts, voice models, player data,
  technical architecture" beats "all confidential information".
- **Flow NDAs down the whole chain.** Every individual who touches content signs — including
  freelance linguists and LQA testers, not just the vendor entity.
- **NDA ≠ IP assignment.** An NDA restricts disclosure; it does not transfer ownership of
  anything created during the project. Translations are creative works. A separate assignment
  or work-for-hire clause is required, and its absence is discovered at the worst possible
  moment.
- **Specify return or destruction on termination**, with written certification.
- **Governing law and jurisdiction matter**, and enforceability varies by the vendor's
  jurisdiction. Cross-border chains need this decided deliberately.
- **Security certifications are evidence, not guarantees.** ISO 27001 (information security
  management) and ISO 17100 (translation service processes, including confidentiality
  requirements) indicate a managed process exists. Verify scope — a certificate covering a
  head office says little about a subcontracted linguist's laptop.

## 3. Personal data in game content

Game strings are not always authored content. Watch for:

- user-generated content submitted for moderation or translation
- player reports, support tickets, and chat logs used as reference material
- beta feedback and survey responses
- test accounts containing real names and email addresses
- crash logs and telemetry attached to bug reports

All of these can carry personal data, which brings data-protection obligations independent of
the NDA. Minimize before sending to linguists: strip identifiers, replace with tokens, and
send only what the linguistic task actually requires. A translator does not need the reporter's
email address to translate a support macro.

## 4. Credential hygiene

Devkit credentials, build-server tokens, TMS API keys, and storefront partner logins circulate
through localization channels more often than anyone intends.

- Never paste credentials into a chat, a bug report, a spreadsheet cell, or a translation
  segment.
- Never commit them to a LocKit.
- Redact them from screenshots and terminal captures before attaching.
- If a credential has been exposed, rotate first and investigate second.

For anything beyond this, use a dedicated secrets-management tool or skill.

## 5. Refusal boundaries

This skill declines to:

- process client content through tooling the client has excluded, however convenient
- reconstruct NDA-bound platform requirement documentation from memory or public sources
- help create or deploy a voice replica without documented, project-specific performer consent
- assist in misdeclaring supported languages, content descriptors, or monetization odds to a
  storefront or rating board
- help circumvent a territory's content restrictions rather than making a recorded
  adapt/remove/disclose decision
- reproduce or summarize embargoed narrative content into any channel outside the agreed
  perimeter

When declining, name the specific constraint and offer the compliant alternative. "I can't run
this through that engine, but here is what a self-hosted pass would need" is more useful than
a refusal alone.

## 6. Gate 0 checklist

- [ ] Approved tooling list confirmed in writing; MT plugins audited per project
- [ ] No-retention / no-training terms verified for any external engine in use
- [ ] Build custody defined: named holders, named machines, encrypted disks, VPN
- [ ] Devkit custody logged
- [ ] End-of-project return or certified destruction scheduled
- [ ] Capture and redaction rules communicated to every LQA tester
- [ ] Watermarking enabled where the platform supports it
- [ ] Spoiler segmentation applied; reveal-critical content perimeter defined
- [ ] NDAs flowed down to every individual in the chain
- [ ] IP assignment / work-for-hire clause present and separate from the NDA
- [ ] Personal data in source content identified and minimized
- [ ] Credential hygiene briefed; no secrets in LocKits, bug reports, or captures

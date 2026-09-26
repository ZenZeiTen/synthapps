# Sanitization record

The twelve specialist skills in `gamedev-forge` started as private working skills. They
were written while building real games, so they carried details that belong to their
author and their host, not to a public plugin. This file records what kinds of detail
were removed or changed, and how the release check keeps them out.

It describes each change by category on purpose. Repeating the removed names here would
publish them.

## What was changed

| Category | What it was | What it became | Skills affected |
|---|---|---|---|
| Personal identity | A person's initials and pronoun, used as "the user" | "the user", they/them | browser-arcade, dos-game, game-music |
| Personal defaults | One user's preferred cultural setting and music flavour, applied to every game | Use the setting the user names; with none, pitch one original setting. Cultural detail kept as an example, not a default | browser-arcade, dos-game, game-music |
| Private projects | Titles of three private games used as provenance ("the workflow used for ...") | Generic descriptions ("a remake of a mid-90s DOS platformer") | godot-forge, browser-arcade, game-music |
| Reference-game pairing | Public game titles paired with the private remakes | Era and genre descriptions | godot-forge |
| Vendor account details | One music vendor's credit price, tool IDs and job-polling tool names; a note about another vendor's missing scope on one account | "A music-generation connector"; state the cost before generating; check scope once | game-music, browser-arcade |
| Subscription statements | "Fine under the user's subscription" for a named stock library | "Under the user's own subscription"; check the licence before shipping in a build | game-music |
| Host-only tools | Tool names that exist only in one host: a file-send tool and its size limit, a question tool, an artifact-publish tool, a linked-device shell, a named cloud workspace | "The host's question tool, if it has one", "publish as an artifact if the host supports it, otherwise hand over the file", "your delivery channel's size limit" | godot-forge, browser-arcade, dos-game, game-music |
| Unbundled skills | Hand-offs to nine translation, controlled-language, terminology, voice-script, secrets and Unity skills that are not in this plugin | "A <kind> skill, if installed". One host skill, `artifact-design`, stays as an example of "a page-design skill, if the host has one" | game-loc-ops, game-liveops-linguist, game-music, browser-arcade, dos-game |
| Template sample data | A reviewer's initials in example rows of two CSV templates | `REVIEWER` | game-liveops-linguist |

## What was kept on purpose

- **Regional knowledge.** The Indonesia annexes in the live-ops skill (rating system,
  cultural-risk notes) and the Indonesian unit map are domain content for any studio
  shipping there, not personal data.
- **Indonesian trigger phrases** in skill descriptions (for example "bikin game DOS").
  They help Indonesian-speaking users reach the right skill and identify no one.
- **Public facts.** Engine versions, API changes, public game titles used as style
  references, and dates of public releases.
- **Measured findings.** Numbers such as archive sizes, timing steps and API behaviour,
  with the private project names removed.

## Fixes made along the way

These were not privacy issues, but were found during the review:

- `hd2d-forge` pointed to six support files (four references, a three.js module, a
  normal-map script) that did not exist in the source. The pointers were removed, the
  description no longer promises engine recipes, and a "Scope of this edition" section
  says what the skill does not include.
- `hd2d-forge` described a game's October 2026 release in the past tense; it now says
  "scheduled".

## The release check

`tools/sanitize_scan.py` runs over both plugins and the marketplace manifest. It reports:

| Code | Finds |
|---|---|
| `secret` | private-key blocks, common API-key shapes, full bearer tokens, credentials assigned in plain text |
| `personal` | e-mail addresses (except `example.com`), absolute home-folder paths |
| `host` | account, session, skill and plugin IDs; links to private sessions; hard-coded `mcp__server__tool` names |
| `private` | any term from a private deny-list (see below) |
| `skill` | a SKILL.md whose name does not match its folder, with no description, or with listing text over 1,536 characters |
| `handoff` | a skill that tells Claude to hand off to a skill the plugin does not bundle |

The test suite also checks that every support file a skill mentions exists.

### The private deny-list

Names of people, clients and private projects cannot sit in the scanner's source without
being published by it. The scanner reads them from a local file instead:

```bash
# one term per line, case-insensitive, whole word; lines starting with # are comments
python gamedev-forge/tools/sanitize_scan.py --denylist ~/private/gamedev-forge-deny.txt
# or
export GAMEDEV_FORGE_DENYLIST=~/private/gamedev-forge-deny.txt
python -m unittest discover -s gamedev-forge/tests -t gamedev-forge
```

A file named `gamedev-forge/.sanitize-denylist` is also read by default, and
`.gitignore` keeps it out of the repository. Findings name the rule and the term's line
number in the deny-list, never the term, so a CI log does not leak it.

### Limits

The scanner matches known shapes. It will not catch a secret in an unusual format, a
name that is not on the deny-list, or identifying detail in prose. Read the diff before
publishing a new version.

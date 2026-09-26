# Gamedev Forge: design

## Goal

Help one person, or a small team, take a game from idea to a build that someone else can
play, using Claude Code. The plugin should:

1. pick the right approach for the game instead of one generic workflow;
2. use real tools (engines, editors, generators) when the user has them, and still work
   when they do not;
3. never ship other people's content, other people's keys, or unverified claims.

## Shape: a director plus specialists

```
                         ┌──────────────────────────────┐
  idea / request ──────► │ game-director                │
                         │  game brief · originality    │
                         │  track · routing · connectors│
                         └──────────────┬───────────────┘
              ┌─────────────────────────┼──────────────────────────┐
              ▼                         ▼                          ▼
     build tracks                 asset specialists           ship and support
  browser-arcade-game-forge     aseprite-pixel-forge         game-loc-ops
  game-creator-2d               blender-game-asset-forge     game-liveops-linguist
  dos-game-forge                blender-2d-forge             release-check
  threejs-retro-forge           game-music-forge             playtest-auditor (agent)
  hd2d-forge
  godot-forge
```

- **One entry point.** `game-director` is the skill Claude reaches for when a request is
  about a game but does not say how. It writes a one-page Game Brief, applies the
  originality check, picks one of six build tracks, and hands each job to the skill that
  owns it. It carries no engine details itself, so it stays short (about 2,600 tokens
  when loaded).
- **Specialists own their domain.** Each specialist skill carries tested, versioned
  knowledge ("facts checked on <date>") and its own verification steps. The specialists
  already name each other in "who owns what" tables; the director's routing table
  matches those, so a job goes to the same place whichever skill Claude starts from.
- **Commands for moments with side effects.** `new-game` and `release-check` set
  `disable-model-invocation: true`: they create files or pass judgment on a release, so
  the user starts them by name.
- **An independent reviewer.** `playtest-auditor` is a subagent with read-only tools. The
  skill that built the game is the one most likely to miss its own gaps, so the release
  check asks a separate context for a second pass, with evidence for every finding.

## The six build tracks

| Track | Best for | Output | Verified by |
|---|---|---|---|
| Browser arcade | a playable toy in minutes | one HTML file | headless browser run |
| Browser 2D | multi-level console-style 2D | one HTML file | headless run and screenshots |
| DOS-era | period-true PC games, or a real .EXE | HTML file or DOS program | bundled audit script, DOSBox |
| three.js retro | 3D web with a period look | HTML plus modules | headless render checks |
| HD-2D | pixel sprites in a lit 3D world | engine project or spec | engine-specific checks |
| Godot 4 | desktop builds, larger projects | Godot project and exports | headless engine, input harness, exported-build test |

The director prefers the track that gives a playable result soonest and names the
upgrade path, because a fun loop found in a browser prototype is cheap to port and an
unfun one is expensive to polish.

## Connectors: use when present, degrade when not

Tools reach Claude in three ways, and the plugin treats them differently:

| Kind | Examples | Where it comes from | Plugin's stance |
|---|---|---|---|
| Local tool servers | Blender, Godot | `gamedev-forge-connectors` plugin (opt-in) | bundled, no keys |
| Documentation | Context7 | `gamedev-forge-connectors` plugin (opt-in) | bundled, anonymous tier |
| Account connectors | Figma, ElevenLabs, stock music, Sentry, Linear, GitHub, DeepL, web hosts | the user's own account or official plugins | described by capability only; never bundled, never given keys |

Rules that follow from this:

- **Match by capability, not by name.** Tool names differ between hosts and versions. The
  director's `references/connectors.md` lists what each capability unlocks and the
  fallback, and tells Claude never to invent a tool name. The release scanner rejects
  hard-coded `mcp__server__tool` names in skill text.
- **Every connector has a fallback.** Blender MCP → headless `bpy`. Godot MCP → the Godot
  binary in a shell. Aseprite MCP → Aseprite CLI → the bundled pure-Python
  `asefile.py`. Music generator → code-written chiptune. Missing tools lower quality;
  they never stop work.
- **Say which connector would help, once.** Not on every turn.

### Why two plugins

A plugin's MCP servers start automatically when the plugin is enabled. Bundling Blender,
Godot and Context7 into the core plugin would mean every user, including someone who only
wants a browser game, spawns `uvx` and `npx` processes and opens a connection to a
third-party documentation service at every session start. Splitting them keeps the core
plugin free of processes and network connections, and makes the servers an explicit
choice. The connectors plugin needs no API keys: Blender and Godot are local, and
Context7 works without a key at a lower rate limit.

Aseprite has no published MCP package (the known server must be cloned and pointed at a
local path), so it is documented but not bundled.

### Security notes for the connectors

- The Blender MCP add-on runs Python that it receives over a local socket. Keep it bound
  to `localhost` (the default) and stop the add-on's server when you are not using it.
- Server versions are not pinned: `uvx mcp-for-blender` and `npx @coding-solo/godot-mcp`
  fetch the current release. Pin a version in your own MCP config if you need
  reproducible sessions.

## Shared rules (enforced by the director and the release check)

1. **Originality.** Remakes keep mechanics and replace all content. Reference games are
   named for feel only.
2. **Credits ledger.** Every asset not written as code in the project gets a
   `CREDITS.md` line with source, tool, date and licence.
3. **Cost gate.** State the cost before paid generation; ask before spending more than a
   small amount.
4. **Secrets.** Keys live in the host's connector settings or the user's environment,
   never in project files, commits, screenshots or reports.
5. **Honest verification.** Run the skill's checks, show evidence, and name what only a
   human can judge (feel, audio by ear, balance).

## Known limits

- The specialists' "facts checked on" notes (engine versions, API changes) date from
  September 2026. They tell Claude to re-check facts older than about three months;
  Context7 makes that cheap.
- Several verification steps need tools that are not always present (a Godot binary, a
  headless browser, `ffmpeg`). Skills say so plainly when a check could not run.
- The plugin has not been through Anthropic's review for the official directory; this
  marketplace is self-hosted.
- The sanitization scanner is a safety net, not a proof: it catches known shapes of
  secrets and personal data and the terms on its deny-list. A person should still read a
  release diff before it is published.

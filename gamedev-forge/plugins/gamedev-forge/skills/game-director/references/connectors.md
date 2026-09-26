# Connector check

Tool names differ between hosts (Claude Code, the Claude apps, other clients) and change
between versions. Match on what a tool does, not on an exact name, and never invent a tool
name. Run this check once per session, before planning work that needs a tool.

## How to check

1. Look at the tools available in this session. In Claude Code, MCP tools appear as
   `mcp__<server>__<tool>`; some hosts load them on demand through a tool search.
2. For each row below, note present / missing.
3. Tell the user, in one short list, which missing connector would most improve this
   project, and continue with the fallback. Do not stop work because a connector is missing.

## Local tool servers (from the `gamedev-forge-connectors` plugin, or configured by the user)

| Capability | Server | Used by | Fallback when missing |
|---|---|---|---|
| Drive a running Blender: build, render, export | Blender MCP (`uvx mcp-for-blender`, needs the Blender add-on running) | `blender-game-asset-forge`, `blender-2d-forge` | headless `bpy` (the Python module), or scripts the user runs |
| Launch, run and inspect Godot projects | Godot MCP (`npx @coding-solo/godot-mcp`, needs Godot installed) | `godot-forge`, `hd2d-forge` | the Godot binary in a shell (`godot --headless`) |
| Draw and export in Aseprite | an Aseprite MCP server (not bundled: there is no published package) | `aseprite-pixel-forge` | Aseprite CLI, then the bundled `scripts/asefile.py` |
| Current engine and library docs | Context7 (remote, no key needed) | every skill that carries "facts checked on" notes | the official docs on the web, or the user's installed version |

## Account connectors (the user's own; never bundled, never given keys by this plugin)

| Capability | Examples | Used for |
|---|---|---|
| UI and HUD mockups, style frames | Figma | menus, HUD layout, store art drafts |
| Voice, SFX and music generation | ElevenLabs, vidIQ music, other generators | `game-music-forge`, VO placeholders |
| Licensed music and SFX | Epidemic Sound or another stock library | trailers; builds only when the licence covers it |
| Image and 2D asset generation | image generators in the user's account | concept art and references, cleaned up in `aseprite-pixel-forge` |
| Crash and error reports from players | Sentry | triage after release |
| Issues and milestones | Linear, GitHub, Asana | tracking the brief's milestones and LQA bugs |
| Machine translation for drafts | DeepL, LILT | first drafts only; `game-loc-ops` gates still apply |
| Hosting web builds | Vercel, Netlify, GitHub Pages | sharing browser builds |
| 3D preview in chat | a three.js viewer connector | quick look at a scene or model |

## Rules

- Generated or licensed assets go in `CREDITS.md` with their source and licence.
- State the cost before paid generation; ask before spending more than a small amount.
- Keys and tokens stay in the host's connector settings or the user's environment, never
  in project files, commits or reports.

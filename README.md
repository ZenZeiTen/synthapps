# synthapps
A curated ecosystem of innovative applications, automation tools, and developer solutions built to simplify complex workflows.

## Projects

| Project | Description |
|---|---|
| [agent-sandbox](agent-sandbox/) | Design and reference kernel for a contained virtual world where AI agents interact in humanoid form, with layered guardrails against escape |
| [nalara](nalara/) | An AI-native operating system where Claude is the kernel: intent in, agent swarm and workspace out, around a live Neural Core with a knowledge-graph view, with platform-enforced approvals, undo, kill switch and audit |
| [reality-js](reality-js/) | A scene language and physically based path tracer for the browser: photoreal stills and motion video from a few lines of text, with a physical sky, a physical camera and exact motion blur |
| [gamedev-forge](gamedev-forge/) | Claude Code plugins for game development: a director skill that plans a game and routes work to 12 specialist skills, plus optional Blender, Godot and Context7 connectors |

## Claude Code plugins

This repository is also a Claude Code plugin marketplace:

```
/plugin marketplace add ZenZeiTen/synthapps
/plugin install gamedev-forge@synthapps
/plugin install reality-js@synthapps
```

| Plugin | What it adds |
|---|---|
| `gamedev-forge` | A game director skill and 12 specialist skills, plus optional connectors (`gamedev-forge-connectors`). |
| `reality-js` | A skill for writing, checking, rendering and speeding up reality.js scenes. |

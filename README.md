# synthapps
A curated ecosystem of innovative applications, automation tools, and developer solutions built to simplify complex workflows.

## Projects

| Project | Description |
|---|---|
| [agent-sandbox](agent-sandbox/) | Design and reference kernel for a contained virtual world where AI agents interact in humanoid form, with layered guardrails against escape |
| [reality-js](reality-js/) | A scene language and physically based path tracer for the browser: photoreal stills and motion video from a few lines of text, with a physical sky, a physical camera and exact motion blur |
| [gamedev-forge](gamedev-forge/) | Claude Code plugins for game development: a director skill that plans a game and routes work to 12 specialist skills, plus optional Blender, Godot and Context7 connectors |
| [playcanvas-design](playcanvas-design/) | Deterministic headless rendering for PlayCanvas: frame-exact video and seamless loops, turntables, 8-direction sprite sheets, icons and GLB exports from code scenes or Editor projects |

## Claude Code plugins

This repository is also a Claude Code plugin marketplace:

```
/plugin marketplace add ZenZeiTen/synthapps
/plugin install gamedev-forge@synthapps
/plugin install reality-js@synthapps
/plugin install playcanvas-design@synthapps
```

| Plugin | What it adds |
|---|---|
| `gamedev-forge` | A game director skill and 12 specialist skills, plus optional connectors (`gamedev-forge-connectors`). |
| `reality-js` | A skill for writing, checking, rendering and speeding up reality.js scenes. |
| `playcanvas-design` | A skill plus zero-dependency scripts that render PlayCanvas scenes frame-exactly and turn them into video, sprite sheets and GLB assets. |

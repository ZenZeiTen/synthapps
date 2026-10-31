# synthapps
A curated ecosystem of innovative applications, automation tools, and developer solutions built to simplify complex workflows.

## Projects

| Project | Description |
|---|---|
| [agent-sandbox](agent-sandbox/) | Design and reference kernel for a contained virtual world where AI agents interact in humanoid form, with layered guardrails against escape |
| [nalara](nalara/) | An AI-native operating system where Claude is the kernel: intent in, agent swarm and workspace out, around a live Neural Core with a knowledge-graph view, with platform-enforced approvals, undo, kill switch and audit |
| [reality-js](reality-js/) | A scene language and physically based path tracer for the browser: photoreal stills and motion video from a few lines of text, with a physical sky, a physical camera and exact motion blur |
| [gamedev-forge](gamedev-forge/) | Claude Code plugins for game development: a director skill that plans a game and routes work to 12 specialist skills, plus optional Blender, Godot and Context7 connectors |
| [playcanvas-design](playcanvas-design/) | Deterministic headless rendering for PlayCanvas: frame-exact video and seamless loops, turntables, 8-direction sprite sheets, icons and GLB exports from code scenes or Editor projects |
| [contextchat](contextchat/) | A WordPress plugin: a chat button for WhatsApp that pre-fills each message with the page, product and campaign the visitor came from, routes it to the right agent, follows opening hours and counts chats without tracking people |
| [visitor-sentinel](visitor-sentinel/) | ZenZeiTen Visitor Guard (formerly Visitor Sentinel): a WordPress plugin for visitor analytics with IP address tracking, page activity tracking and fraudulent click detection for paid and on-site ads, with automatic blocking and a Google Ads IP exclusion export |
| [corbelwise](corbelwise/) | Corbelwise: a fast, elegant WordPress block theme for any business (six style variations, ready-made pages, light and dark mode), with a companion plugin of switchable modules: performance, security, SEO and schema, business details, an announcement bar and an optional AI writing assistant and visitor chat powered by Claude |
| [gamepilot](gamepilot/) | An agent that plays Steam and emulated games the way a person does: Claude reads screenshots and drives a virtual Xbox controller or keyboard and mouse with frame-accurate timing, with frame-by-frame play in RetroArch and guardrails against anti-cheat bans |
| [bastion](bastion/) | ZenZeiTen Bastion: a WordPress security plugin with a firewall, a live attack monitor, automatic detection and blocking of attacking IP addresses, login protection, and automatic database backups with verified restore and automatic rollback |
| [retroglot](retroglot/) | Play retro games from the DOS era to the PlayStation era, as a Windows app or in the browser, with a game library, save states and live on-screen translation by Claude: dialogue boxes are covered by their translation, with auto-translate, a glossary and an exportable script |

## Claude Code plugins

This repository is also a Claude Code plugin marketplace:

```
/plugin marketplace add ZenZeiTen/synthapps
/plugin install gamedev-forge@synthapps
/plugin install reality-js@synthapps
/plugin install playcanvas-design@synthapps
/plugin install gamepilot@synthapps
```

| Plugin | What it adds |
|---|---|
| `gamedev-forge` | A game director skill and 12 specialist skills, plus optional connectors (`gamedev-forge-connectors`). |
| `reality-js` | A skill for writing, checking, rendering and speeding up reality.js scenes. |
| `playcanvas-design` | A skill plus zero-dependency scripts that render PlayCanvas scenes frame-exactly and turn them into video, sprite sheets and GLB assets. |
| `gamepilot` | A skill for setting up, running and troubleshooting gamepilot: install, automatic game detection, settings files, goals and free play, costs, safety and known errors. |

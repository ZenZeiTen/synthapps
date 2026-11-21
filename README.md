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
| [keyhold](keyhold/) | Keyhold: a password manager for Windows, Linux and macOS that encrypts everything on the device, with structured item types (logins, cards, identities, bank accounts, Wi-Fi, API and SSH keys, notes), a password health report, recovery codes and automatic backups; works offline and syncs through a self-hosted, zero-knowledge server with a phone-friendly web app. Single-file Windows app, no installer |
| [kempt](kempt/) | Kempt: honest care for a Windows PC. Frees space from caches and leftovers, finds large and duplicate files, manages startup programs with Task Manager's own switch, updates apps with winget, checks drive, security and update health, and turns off Windows advertising and suggestions; every change is explained, recorded and, where it can be, undoable. Single-file Windows app, no installer |
| [retroglot](retroglot/) | Play retro games from the DOS era to the PlayStation, Nintendo DS and PSP era, as a Windows app or in the browser, with a game library, save states and live on-screen translation by Claude: dialogue boxes are covered by their translation, with auto-translate, a glossary and an exportable script |
| [vitalis](vitalis/) | Vitalis: a private health tracker for blood pressure, heart rate, blood glucose and uric acid, with trend charts, plain-language insights, questions and lab tests to raise with a doctor, and a PDF report; an offline PWA and an Android app |
| [protogames](protogames/) | ProtoGames: a collection of game prototypes, gameplay experiments and development frameworks, including an EGA-style parser adventure, a first-person party dungeon crawler, side-scrolling platformers and sword games, and a 90s-anime-style poker battle |
| [termextrax](termextrax/) | TermExtrax: a local web app for translators and localizers. It aligns source and target texts sentence by sentence (from text, Word, Excel or PowerPoint files), lets you fix the alignment in a side-by-side editor, extracts terminology, and exports a translation memory (TMX, CSV) and a termbase (TBX, CSV) |
| [scan2doc](scan2doc/) | Scan2Doc: converts PDF scans into editable Word, Excel and PowerPoint files and their OpenDocument equivalents, entirely on your own machine (PDFium and Tesseract compiled to WebAssembly), in 27 languages including Indonesian, Japanese, Korean, Chinese, Thai, Arabic, Hindi and Russian. Quality checks flag pages that were read poorly, and an MCP server hands them to Claude to repair. Single-file Windows app |
| [kamus-dwibahasa](kamus-dwibahasa/) | Kamus Dwibahasa: a bilingual Indonesian–English dictionary web app built with Next.js, TypeScript and Tailwind CSS |
| [raycaster](raycaster/) | A modular 3.5D raycasting game engine in TypeScript on the HTML5 Canvas, with a playable dungeon-crawler demo in the style of King's Field, a Blender sprite-baking pipeline and an ElevenLabs audio pipeline. Includes a Claude skill |
| [lang-forge](lang-forge/) | A Claude skill for designing new programming languages from start to finish: intent, formal spec, grammar, semantics, an implementation scaffold in Python, Rust or JavaScript, and example programs, for language designers and researchers |
| [lintas](lintas/) | Lintas: a fast, secure desktop browser (Chromium engine) that works online and offline, with a built-in Translation Management System (projects, segment editor, fuzzy translation memory, termbases, QA, analysis, export to the original format) and Claude-powered suggestions, review, in-page translation and page Q&A |

## Claude Code plugins

This repository is also a Claude Code plugin marketplace:

```
/plugin marketplace add ZenZeiTen/synthapps
/plugin install gamedev-forge@synthapps
/plugin install reality-js@synthapps
/plugin install playcanvas-design@synthapps
/plugin install gamepilot@synthapps
/plugin install nsx-backdrop@synthapps
```

| Plugin | What it adds |
|---|---|
| `gamedev-forge` | A game director skill and 12 specialist skills, plus optional connectors (`gamedev-forge-connectors`). |
| `reality-js` | A skill for writing, checking, rendering and speeding up reality.js scenes. |
| `playcanvas-design` | A skill plus zero-dependency scripts that render PlayCanvas scenes frame-exactly and turn them into video, sprite sheets and GLB assets. |
| `nsx-backdrop` | A backdrop picker mod for the Desktop and mobile apps: a sky that follows the clock, a per-project look, a sumi-e ink wash and a pixel-noir skyline, each with matching Code tab colors. `/nsx-backdrop <name>` sets one; `/nsx-plain` clears it. |
| `gamepilot` | A skill for setting up, running and troubleshooting gamepilot: install, automatic game detection, settings files, goals and free play, costs, safety and known errors. |

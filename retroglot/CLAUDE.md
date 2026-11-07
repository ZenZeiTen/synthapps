# retroglot: notes for Claude

A game library and browser emulator (EmulatorJS) with live screen translation by Claude.
`README.md` is for players; this file is for whoever changes the code.

## Check every change

From `retroglot/`:

```bash
npm test                 # unit tests, no network, no browser (test/run.js lists the files; Node 20 has no --test globs)
npm run test:e2e         # real emulator in headless Chromium, mock Claude API
```

The browser tests need `npm run setup` (or at least `install-runtime --cores dosbox_pure,fceumm,melonds`) and
Playwright with Chromium; they skip themselves otherwise. In this sandbox Playwright is
preinstalled globally; in CI the workflow installs `playwright@1.63.0`. To look at the UI,
`node test/helpers/shots.mjs <dir>` writes screenshots (library, overlay, subtitles, saves,
phone width) using the mock Claude.

CI: `.github/workflows/retroglot.yml` (unit tests on Ubuntu and Windows, Node 20 and 22; the
browser job on Ubuntu).

## Layout

| File | Role |
|---|---|
| `src/systems.js` | System table (name, core, threads), detection from names and bytes (discs, PSP EBOOTs, zips), cue parsing |
| `src/runtime.js` | Downloads EmulatorJS and cores from the npm registry (own tar reader, sha512 check, no npm needed); maps `/ejs/...` URLs to files |
| `src/store.js` | Data folder: library scan, uploads, settings, save states, covers, BIOS lookup |
| `src/memory.js` | Per-game translation memory: script, glossary, screen cache, usage; CSV/TMX/TXT export |
| `src/translate.js` | The only code that calls Claude: prompt, JSON schema, error mapping, cost estimate |
| `src/server.js` | HTTP server and API, emulator page generation, host and origin guards |
| `bin/retroglot.js` | Command line |
| `src/credentials.js` | API key typed into Settings: file store (0600) for the command line |
| `web/emu-bridge.js` | Runs inside the emulator iframe: screenshot, states, pause, game rectangle, hotkeys, in-game save sync, screen shape |
| `web/player.js` | Player page: translation flow, auto-translate loop, saves, side panel |
| `web/frames.js`, `web/overlay.js` | Frame decode/hash/enlarge/compare; drawing boxes and subtitles |
| `web/library.js`, `web/home.css` | Home screen: system rail, hero, shelf, keyboard and controller navigation |
| `web/glow.js`, `web/sound.js`, `web/gamepad.js` | Background light, menu sounds, controller polling |
| `web/player.css` | Full-window player, boot screen, auto-hiding bar, slide-over panel |
| `web/fonts/` | Outfit and Inter (OFL), bundled so the app looks the same offline |
| `src/enhance.js` | Per-game picture enhancements (N64 resolution, smoothing, texture packs; PS1 HD renderer) mapped to core options |
| `web/shaders/` | xBR-lv2 and ScaleFX (MIT, unmodified from libretro/glsl-shaders), turned into EmulatorJS presets in `server.js` |
| `src/art.js` | Box art, title and snap pictures from libretro-thumbnails, cached in `<home>/art`; player-chosen pictures |
| `demo/build_demo.py` | Builds `demo/HOSHI.COM` (needs Pillow, nasm, Unifont) |

## Desktop app (`desktop/`)

Electron wrapper for Windows (`npm run dist:win` builds an NSIS installer and a portable exe).
`stage.mjs` copies `src/`, `web/`, `demo/` into `desktop/app/core`; `main.js` imports the same
server, listens on 127.0.0.1:47923 (fixed, so the page origin and the emulator's in-browser
saves survive restarts; random port if taken) and opens it in a window. Differences from the
command line: the runtime goes to `%APPDATA%/Retroglot/runtime`, downloads use `net.fetch`
(system proxy), the API key is encrypted with `safeStorage` (`secrets.js`), and the library
starts the emulator download by itself (`status.desktop`). Data stays in `~/.retroglot`, shared
with the command line.

`npm run smoke` (or `electron . --smoke`) runs `smoke.js`: library, cross-origin isolation,
emulator download, demo boot, missing-key answer; writes `smoke-out/result.json` and
screenshots and exits 0 or 1. CI (`.github/workflows/retroglot-desktop.yml`) builds on
`windows-latest`, runs the smoke test on the built `win-unpacked/Retroglot.exe` and uploads the
installer and portable exe as the `Retroglot-Windows` artifact.

Building the NSIS installer on Linux needs Wine; without it, electron-builder still produces
`dist/win-unpacked`. In this sandbox `npm install` cannot fetch the Electron binary (undici
through the proxy); download the zip with curl and unpack it into
`node_modules/electron/dist` (write `electron` into `node_modules/electron/path.txt`), and use
`-c.electronDist=<unpacked win32 zip>` for Windows builds. Run Electron as root with
`--no-sandbox`, under `xvfb-run`. The registry stand-in for the smoke test forwards with Node's
fetch (`RETROGLOT_REGISTRY=http://127.0.0.1:PORT`).

## Rules this code keeps

- The browser side has no build step and no dependencies: plain ES modules.
- The server's only dependency is `@anthropic-ai/sdk`. EmulatorJS and cores are downloaded
  into `runtime/` (git-ignored) and never committed; they are GPL and partly non-commercial.
- Every response is cross-origin isolated (COOP/COEP): DOSBox Pure only ships threaded builds
  and needs `SharedArrayBuffer`. Everything the emulator loads must come from this server.
- The emulator frame stays offline: `emu-bridge.js` answers EmulatorJS's update check
  locally. Do not set `EJS_gameID` to a number (it turns on netplay to emulatorjs.org).
- Claude requests: model from `MODELS` only (default `claude-opus-5-5`), structured output
  via `output_config.format` json_schema, `effort` from settings (default `low`), no
  `thinking` field, no forced `tool_choice`, `fallbacks: "default"` with the
  `server-side-fallback-2026-07-01` beta for Opus and Sonnet (not Haiku). Map SDK errors to
  `TranslationError` with a hint the player can act on.
- Boxes come back in pixels of the enlarged screenshot and are stored as fractions (0..1) of
  the game picture. The overlay places them over the rectangle `gameRect()` reports.
- Screen cache key: SHA-256 of the native-resolution pixels + target language + style.
- Files are never overwritten (`freePath`); uploads are restricted to game extensions and
  kept inside the library folder. The server answers only to local host names and refuses
  state changes from other origins.
- A hidden element must really be hidden: `[hidden]` is forced to `display: none`. A
  `display: grid` overlay with `hidden` once swallowed every click on the game.

## Look and feel

The home screen is lit by the system being browsed (`--sys`, from `SYSTEM_LIGHT` in
`common.js`); everything else stays quiet. Display type is Outfit, text is Inter. Committed
screenshots (`docs/`) use made-up games (`SHOTS_FICTIONAL=1 node test/helpers/shots.mjs docs`) so
no third-party box art is stored in the repository. Picture modes map to EmulatorJS shaders
(`DISPLAY_SHADERS` in `server.js`): `crt` = crt-easymode, `smooth` = sabr, `sharp` = none,
`xbr` and `scalefx` = our presets from `web/shaders`; translation screenshots are taken before
the shader, so overlay positions do not change.

## Picture enhancements

`src/enhance.js` lists the choices per system (`ENHANCEMENTS`, first choice = default) and
`enhancementPlan()` turns a game's stored `enhance` into core options. It always writes every
option a feature manages, so turning a feature off resets it. The player's Picture tab saves
the choices, then "Apply and restart" saves a state to the hidden slot 0 and reloads with
`?slot=0` (only when the core stays the same; states do not carry across cores).

- Core options must be in place before the core starts (resolution changes do not apply at
  run time). EmulatorJS writes the options file from the per-game entry it keeps in
  localStorage (`ejs-1-<system>-<title>-settings`) and ignores `EJS_defaultOptions` once
  that entry exists, so `emu-bridge.js` writes the managed options (and `shader`) into that
  entry before `loader.js` runs (`window.RETROGLOT.coreOptions`).
- PS1 HD switches `EJS_core` to `mednafen_psx_hw` and pins `retroarch_core` (EmulatorJS
  otherwise reuses a remembered core). Beetle accepts only certain BIOS names
  (`PSX_HD_BIOS`), by disc region; without one the game stays on PCSX ReARMed.
- N64 texture packs live in `<home>/textures/<id>.{zip,hts,htc}` and are mounted with
  `EJS_externalFiles`: a key ending in `/` unpacks a zip there. GLideN64 reads
  `/Mupen64plus/hires_texture/<ROM internal name>/` (subfolders too) and
  `/Mupen64plus/cache/<name>_HIRESTEXTURES.hts`. The internal name is header bytes
  0x20..0x33 in any of the three byte orders.
- Shaders: many cores run WebGL 1 (GLSL ES 1.00). `glslForWebgl1()` drops `#version 130`
  and rewrites `mul(mat4x3(...), v)` (non-square matrices are ES 3.00 only) as dot products.
  Resource names must not contain `/` (EmulatorJS writes them straight into `/shader/`).

## Saves

- In-game saves (SRAM, memory cards, the PSP memory stick) live in EmulatorJS's `/data/saves`
  (IndexedDB). EmulatorJS writes them every 5 minutes and in `beforeunload`, which in our
  iframe is lost when the player leaves. So the server keeps the real copy in
  `<home>/saves/<id>/ingame/<path under /data/saves>` (PSP: the shared
  `_psp-memory-stick` scope, folder `PPSSPP/PSP/SAVEDATA`), with `ingame-previous/` for the
  version each write replaced. `emulatorPage` embeds them (`RETROGLOT.ingame.files`, base64);
  `emu-bridge.js` catches `window.EJS_emulator` as the loader sets it and writes them on
  EmulatorJS's `saveDatabaseLoaded` event, i.e. before the ROM loads and the core reads SRAM.
- The bridge syncs every 4 s and on `flushSaves()`: `functions.saveSaveFiles()` (core → file),
  then every file next to `getSaveFilePath()` with the same stem (`X.srm`, `X.sav`,
  `X.pure.zip`) plus the shared folder, hashed against what the server has; changed ones
  go to `PUT /api/games/:id/ingame`. Files in the browser that the server lacks (made by
  versions before this) are uploaded on the first sync.
- Leaving the player (Back, Apply and restart, closing the desktop window via
  `window.retroglotBeforeClose`) awaits `flushSaves()` and the Autosave (state slot 0),
  with a time limit. `pagehide` sends small saves with `keepalive` as a last resort.
- Screen shape (`original` / `wide` / `fill`) scales EmulatorJS's canvas with a CSS
  transform about its centre; `gameRect()` applies the same scale, so the overlay follows.

## Lessons from building

- EmulatorJS's npm package has no minified files; set `EJS_DEBUG_XX = true` so the loader
  uses `src/*.js` directly (it also disables ROM caching in IndexedDB, which is what we want
  since the server is local).
- `gameManager.screenshot()` is written from RetroArch's main loop: on a paused game it never
  finishes. The bridge resumes for one capture, then pauses again, with a timeout.
- DOS cannot start `Hoshifuri (Japan) (Demo).com`; the emulator gets an 8.3 name
  (`romUrlName`).
- Keyboard focus: the parent must focus the iframe, then the bridge focuses EmulatorJS's own
  element (`elements.parent`), which is where its key listener is.
- The SDK (1.x) sends beta requests to `/v1/messages` with an `anthropic-beta` header.
- melonDS starts DS programs without a BIOS (FreeBIOS), but treats ROM offsets 0x4000-0x7fff as
  the encrypted secure area: test ROMs put their code at 0x8000 (`test/helpers/nds.js`). With
  only 2D engine A powered, a DS shows it on the lower screen and the upper one stays white.
- PPSSPP needs threads and WebGL 2, and loads `cores/ppsspp-assets.zip` next to the core
  (`resolveRuntimePath` maps `<core>-assets.zip` into the core's folder).
- `.pbp` is shared by PSP games and PlayStation games sold for the PSP: `sniffPbp` reads
  PARAM.SFO (category `ME` = PlayStation) and DATA.PSAR (`PSISOIMG`). PSP discs have
  `PSP GAME` in their volume descriptor.
- The player downloads a missing core itself (`downloadCore` in `player.js`), so systems added
  after a user's first emulator download still work for them.
- No 3DS: EmulatorJS has no 3DS core, and translation depends on running in the browser.
- Not yet verified: a real HD texture pack in a real game; the PS1 HD renderer booting a disc;
  real DS and PSP games (only homebrew/test programs).
- Not yet verified: a live Claude call (tests use `test/helpers/mock-claude.js`), and cores
  other than DOSBox Pure and FCEUmm in the browser.

---
name: "browser-arcade-game-forge"
description: "Build an original one-screen browser arcade game as a published artifact, including a remake-in-spirit of a classic, with generated background music. Use for 'remake X game', 'make a retro game', 'add music to my game'."
---

# Browser Arcade Game Forge

A proven end-to-end workflow for small browser arcade games. Follow it in order.

## 1. Originality gate (always first)
- A request to "remake" a named commercial game means: an ORIGINAL game in the same spirit (genre, pacing, one-screen arcade feel).
- Never reproduce the original's characters, mascots, sprites, music, level layouts or names. Say this once, in one sentence, then offer the original concept.
- Invent a new hero, setting and hazards. Use the setting the user names. If they name none, propose one fresh, specific setting (a real place, craft or culture described with care) and let them change it.
- Put a footer note on the page: "An original game inspired by [genre] of the [era]. Character, setting and levels are new."

## 2. Engine question
Ask once (use the host's question tool if it has one): Browser (recommended, playable as an artifact and on phone) / Godot 4 / Unity 6 / Multi-engine. If no answer, pick Browser.

## 3. Build (browser path)
- If the host has a page-design or artifact skill (for example `artifact-design`), load it before writing.
- One self-contained HTML file: `<title>` = the game's name; fonts from Google Fonts only; no other external assets.
- Canvas at a low logical resolution (e.g. 400x225, 16:9), CSS-scaled with `image-rendering: pixelated`; procedural pixel art drawn with fillRect (no image files).
- Fixed 60 Hz update step with an accumulator; coyote time, jump buffer, variable jump height, one-way platforms, drop-through.
- Game states: title / play / paused / clear / over, shown in an HTML overlay (add `[hidden]{display:none!important}` so the overlay really hides).
- Controls: arrows/WASD + Space, P pause, M mute; on-screen touch buttons under `@media (pointer:coarse)`.
- HUD in HTML above the canvas (crisp text): level, collectibles, lives, score, best.
- WebAudio SFX (short oscillator tones). Best score in localStorage wrapped in try/catch.
- Difficulty ramps per level through a config function; announce new hazards on the level-clear screen.
- Respect prefers-reduced-motion (no screen shake).

## 4. Check once, then publish
- One headless Playwright run: load, press Space, hold a direction, screenshot, collect page errors. Fix what it shows, then deliver the file: publish it as an artifact if the host supports that, otherwise hand over the HTML file.
- Tell the user honestly what was not tested (balance, audio by ear).

## 5. Background music
Load the `game-music-forge` skill and follow its Browser path: code chiptune fallback first, then a generated original track (any music-generation connector the user has), crossfade-looped, embedded as base64, B toggles music, credit in the footer.

## 6. Report
Short summary: what was built, what was checked, what wasn't, and one next step (e.g. Godot port).
---
name: "dos-game-forge"
description: "Build, fix, reskin or audit DOS-era PC games (1981-96) in any genre, with CGA/EGA/VGA/text-mode graphics and PC speaker or FM sound, as playable browser artifacts or real DOS .EXE files. Use for 'DOS game', 'MS-DOS style', '90s PC game', 'EGA/VGA', 'mode 13h', 'DOSBox', 'bikin game DOS'."
---

# DOS Game Forge

Make games that feel like they ran on an IBM-compatible PC between 1981 and 1996, in any genre, and ship them as a playable artifact (default) or a real DOS program.

## The core idea: the machine sets the look

A DOS game's style is not a decoration. It is what a specific machine could do: a fixed palette, a 320x200 grid shown on a 4:3 tube, one square-wave speaker, a CPU that could redraw so many pixels per frame. Pick the machine first, write it down as a **Profile Card**, and hold it. The engine below enforces most of it for you: a CGA screen physically cannot show a colour outside its four, a VGA palette entry snaps to the 18-bit DAC, the PC speaker has one voice.

Mixing eras (a 256-colour raycaster with a PC-speaker soundtrack, an EGA adventure with a VGA title screen) is allowed when it is a choice, written on the card. Drift by accident is the failure: a smooth-alpha glow in an EGA game, a 30-voice orchestra behind a CGA screen, a TrueType font in the HUD.

## Stay in lane

| Request | Use |
|---|---|
| NES / SNES / Mega Drive console look | `game-creator-2d` |
| Quick one-screen arcade game with no DOS framing | `browser-arcade-game-forge` |
| PS1/N64 3D, three.js, CRT shaders on 3D | `threejs-retro-forge` |
| HD-2D | `hd2d-forge` |
| A generated or licensed music track | `game-music-forge` (this skill writes device-voiced code music and SFX only) |
| Translating game text | `game-loc-ops` / `game-liveops-linguist` |

If the user says "DOS", "PC", "EGA/VGA", "shareware" or names a DOS classic, this skill leads and the others are called for their piece.

## Workflow

Pick the mode first: **BUILD** (new game), **EXTEND/FIX** (existing DOS-style code), **RESKIN/PORT** (make a modern game DOS-style), **AUDIT** (is this faithful and working?), **NATIVE** (a real .EXE). All modes pass through steps 1, 2 and 5.

### 1. Originality gate
- "Make Doom / Keen / Monkey Island" means an ORIGINAL game in that spirit: same genre, era and feel. Never reproduce characters, mascots, sprites, maps, level layouts, music, fonts, logos, title names, or a HUD face or layout lifted from the original. Say this once, in one sentence, then pitch an original concept.
- In-game text uses generic hardware names: "PC Speaker", "FM Synth card", "FM + Digital card", "VGA". No MS-DOS, Microsoft, Sound Blaster, AdLib, Roland, Sierra, LucasArts, id, Apogee or DOS/4GW names or screens on the page (the audit flags them).
- Setting: use the one the user names. With none, pitch an original world with specific, respectful cultural detail and let the user change it.
- Footer line: "An original game in the style of [decade] PC games. Characters, levels and music are new."

### 2. Profile Card (write it in the reply before building)
```
PROFILE: <name>        YEAR: 1991         CPU: 386 class
VIDEO:  vga (320x200, 256 of 262,144)     LOGIC: 35 Hz tick
SOUND:  fm music + digital sfx, speaker fallback
INPUT:  keyboard (arrows, Space fire, Z use), mouse: no
MEDIA:  "fits on two 1.44 MB floppies" -> ~12 levels, 3 tilesets
GENRE:  raycast maze shooter (adapter row below)
DELIBERATE BREAKS: touch buttons on phones; save to browser
```
Use the Era table to fill it. When the user gives nothing, default by genre (Genre table), year about 1992, VGA, FM + digital.

### 3. Build (BUILD / EXTEND / RESKIN)
1. If the host has a page-design or artifact skill (for example `artifact-design`), load it first (page contract). The page shell in Appendix A already meets it: title is the game's name, colour tokens with light/dark, pixelated 4:3 canvas, phone gutter, touch pad under `pointer:coarse`.
2. Write the files: shell (Appendix A), engine (Appendix B) inlined into the first `<script>`, raycaster add-on (Appendix C) only if the genre needs it, then the game script. One self-contained HTML file; Google Fonts is the only allowed external request, and the engine needs none.
3. Game code rules:
   - All drawing goes through the indexed framebuffer (`S.rect`, `S.blit`, `S.text`, `S.con`). Never draw on the canvas context directly: that bypasses the palette and breaks the audit.
   - HUD and menus live INSIDE the framebuffer in the 8x8 font (a status bar, a text box, a panel), as they did. Keep the HTML bar for a short controls hint only.
   - Author sprites as strings with `DOS.sprite([...rows], key)`. For painted scenes or title art, run `dos_palette.py` (Appendix E) and load with `DOS.unpack`; auto-conversion is a draft, so hand-fix faces and key objects.
   - Logic runs on the fixed tick from the card (`DOS.run(S, {update, draw, hz})`): 70 Hz VGA refresh, 35 Hz for raycasters and heavy scenes, 18.2 Hz for a timer-driven turn game feel.
   - Transitions: `S.fadeOut/fadeIn` (palette), `S.fizzle(colour)` (blocking dissolve), `S.cycle(a,b)` for water, lava and signs. Respect `prefers-reduced-motion`: skip screen shake and fast cycling.
   - Ritual screens (Presentation section): title, SETUP sound selection, help on F1, pause, a game-over and quit screen.
   - Save through `DOS.save/DOS.load` only (try/catch built in, per-viewer).
   - End the script with `window.__game = DOS.run(S, {...})` so the audit can count frames.
4. For EXTEND/FIX: read the whole file first, keep its engine and conventions, and change the least. If it has no engine, port it onto this one only when the user agrees.
5. For RESKIN/PORT: keep the game's rules and level data; replace rendering with the framebuffer, recolour through `S.nearest()` or `dos_palette.py`, and re-voice sounds through `DOS.audio.sfx`.

### 4. Sound
- One SFX vocabulary, three voicings: `DOS.audio.sfx('jump' | 'coin' | 'shoot' | 'hit' | 'explode' | 'select' | 'door' | 'powerup' | 'die')` sounds different on each device. Add more with `DOS.audio.defineSfx(name, {spk:[f0,ms,f1], fm:[hz,sec,patch], pcm:()=>Float32Array})`.
- Devices: `speaker` (one square voice; pitches snap to the 1,193,182 Hz timer divisors; a new sound cuts the old one), `fm` (OPL-style two-operator FM, 9 channels, sine/half/abs/quarter waveforms, patches `lead bass organ brass bell pluck pad`), `digital` (FM music plus 8-bit, 11 kHz PCM effects), `off`.
- Music: `DOS.music.play({bpm, rpb, patches, speakerArp, tracks:['C4 E4 G4 --', ...]})`. `--` holds, `.` rests. Speaker plays track 0, or arpeggiates chords when `speakerArp` is true (the real trick for fake polyphony). Keep FM songs to 8 tracks so channel 9 stays free for SFX. Compose original tunes only; never transcribe a known melody.
- Audio starts on the first key or click (browser rule); `music.play` called earlier starts itself then.
- A generated full track (or an MT-32 / General MIDI "premium card" sound) goes to `game-music-forge`; do not claim a code-synth is an MT-32.

### 5. Check, then publish
1. Run the audit (Appendix D) with keys that reach gameplay:
   `python3 dos_check.py game.html --keys "Digit2,Space,ArrowRight*hold900,Space" --shot shot.png`
   It fails on page errors, a stopped loop, colour indices beyond the mode, VGA palette values off the 6-bit DAC, external assets, a missing `<title>` or `image-rendering: pixelated`; it warns on brand names and raw localStorage.
2. Look at `shot.png` yourself (Read it). Check: 4:3 shape, crisp pixels, HUD readable, the genre's layout (Genre table), nothing modern-looking.
3. Deliver: publish as an artifact if the host supports it (icon `game`), otherwise hand over the HTML file. Report in a few lines: what was built, the Profile Card, what was checked, what was not (audio by ear, difficulty balance, phone feel), one next step.

## Era table

| Profile | Years | Grid and colours | Shown as | Refresh | Notes that shape the look |
|---|---|---|---|---|---|
| `text` | 1981+ | 80x25 cells, 16 fg / 8 bg (16 with blink off) | 720x400 on VGA (engine: 8x16 cells, 640x400) | 70 Hz | Box-drawing and shade characters are the art. Engine font covers ASCII, single and double box lines, and █▀▄▌▐░▒▓. |
| `text40` | 1981+ | 40x25 cells, 16 colours | 320x200 | 70 Hz | Big-letter games, edutainment, early CGA. |
| `cga` | 1981-87 | 320x200, 4 colours: palette 0 (green/red/brown) or 1 (cyan/magenta/white), low or high intensity, any background | 4:3, pixels 1.2x tall | 60 Hz | `DOS.cga(n, hi, bg)`; `n=5` gives cyan/red/white. Dither for extra shades. Flip-screen, few sprites. |
| Tandy/PCjr | 1984-88 | 320x200, 16 colours; 3 square voices + noise | 4:3 | 60 Hz | No dedicated engine device: use `ega` plus 3-track `fm` songs with `pluck`, and say it is an approximation. |
| `ega` | 1984-91 | 320x200, the 16 fixed RGBI colours (200-line modes cannot use the 64-colour palette) | 4:3 | 60 Hz | Tile games, smooth scrolling from about 1990. Brown is colour 6. |
| `ega350` | 1984-91 | 640x350, any 16 of 64 | 4:3 | 60 Hz | Strategy maps, business-sim screens, sharper text. |
| `vga` (mode 13h) | 1987-96 | 320x200, 256 of 262,144 (6 bits per channel) | 4:3, pixels 1.2x tall | 70 Hz | The classic 90s look: palette ramps, fades, cycling, light tables. |
| `modex` | 1991-96 | 320x240, 256 colours, square pixels | 4:3 | 60 Hz | Smooth-scrolling action, page flipping. |
| `vga640` | 1987-96 | 640x480, 16 of 262,144 | 4:3 | 60 Hz | GUI-style sims and strategy. |
| `svga` | 1994-96 | 640x480, 256 colours (VESA) | 4:3 | 60 Hz | Late strategy, sim, adventure; costs CPU, use for slower genres. |

**CPU class, honestly held:** 8088: text, CGA, flip-screen, a handful of sprites. 286: EGA, tile scrolling late. 386: VGA 256, parallax, raycasting in a reduced window. 486: full-screen textured raycasting, light tables, many sprites. Pentium: SVGA, rich sprites, polygon 3D. Budgets matter more than dates: a "386" game that throws 400 bullets breaks the card.

**Media:** 360 KB and 1.2 MB 5.25", 720 KB and 1.44 MB 3.5" floppies. Use them as a content budget ("three episodes, 10 levels each, one tileset per episode"). Shareware structure (episode one free, the rest by mail) is a framing option; never imitate a real publisher's order screen.

**Pixel aspect:** 320x200 and 640x400 fill a 4:3 tube, so pixels are 1.2x taller than wide. The engine always displays 4:3. Draw circles as circles in the framebuffer and they will look slightly tall, as they did; for art that must be round on screen, squash it vertically by 5/6.

## Genre table

| Genre | Default profile | Engine pieces | Input | Layout convention | Trap |
|---|---|---|---|---|---|
| Platformer / run-and-gun | `ega`, 1991 | tile map, `sprite`, `blit` flip | arrows + Space jump, Z/X fire | full-screen playfield, status popup or bottom bar | Console-smooth physics; DOS jumps were stiffer. Pre-1990 = flip-screen. |
| Vertical/horizontal shmup | `vga` | sprite pool, `cycle` for starfields | arrows + Space | playfield plus side panel (score, lives, weapon) | Bullet counts beyond the CPU class. |
| First-person maze shooter | `vga`, 35 Hz | raycaster (Appendix C), `shadeTable`, billboard sprites | arrows turn/move, Space fire, E or Enter use | reduced view window + thick status bar (original portrait, ammo, keys) | Looking up/down, slopes, room-over-room: not in a raycaster. Copying a known HUD. |
| Dungeon crawler (grid step) | `vga` or `ega` | raycaster with 90-degree turns and tile-snapped moves | arrows or numpad, mouse on icons | small first-person window, party portraits, compass, message log | Smooth movement kills the genre. |
| Top-down CRPG / party RPG | `ega` 16x16 tiles, later `vga` | tile map, `con`-style text boxes in graphics | letter commands (early), arrows + menus (later) | map window, stats column, 3-line message log | Menu sprawl; keep commands few. |
| Roguelike | `text` 80x25 | `S.con` | arrows, hjkl, numpad | map 80x21, message line, status line | Glyphs outside the font subset; fix to what the font has. |
| Text adventure (parser) | `text` | `S.con` + parser | typed VERB NOUN | inverse status line on top, scrolling transcript, `>` prompt | Guess-the-verb. Ship synonyms, HELP, HINT, EXAMINE on everything named. |
| Graphic adventure | `ega` (parser, 1984-88), `vga` (verbs 1987+, icon bar 1990+) | scene art via `dos_palette.py` + `unpack`, walkbox polygons (`poly`), mouse | mouse, or typed parser | scene 320x136-160, verb/icon bar or parser line, inventory strip | Dead ends. Decide and state the policy: no unwinnable states by default. |
| Falling-block / grid puzzle | `ega` or `vga` | `rect`, `dither`, sprites | arrows, Space | well centred, next piece and score panels | Over-decoration; the grid is the art. |
| Real-time strategy | `vga` | tile map, mouse box select, `frame`, fog with `dither` | mouse + hotkeys | map left, 64-80 px command panel right, minimap | Unit counts past the CPU class; pathing jitter. |
| Turn-based strategy / 4X / wargame | `ega350` or `vga640` | grid/hex drawn with `poly`, `line` | mouse + keyboard, End Turn | map, side info panel, advisor text box | Hidden rules; show combat odds. |
| Sim / management / tycoon | `vga` or `svga` | top-down or isometric tiles, charts with `rect/line` | mouse | top menu bar like a DOS GUI app, tool palette, overlays | Real-time numbers too fast to read; add speed settings. |
| Racing | `vga` | pseudo-3D road: project road segments per scanline, curves shift x, hills shift y; `poly` for road bands | arrows, Space | road view + dashboard strip | Using real 3D. The period trick is scanline projection. |
| Flight / space sim | `vga` | flat-shaded polygons (`poly`), wireframe (`line`), painter's sort | keyboard, joystick-style arrows | cockpit frame over view, radar | Too many polygons for the CPU class. |
| Fighting / beat-'em-up | `vga` | large sprites, hit/hurt boxes | two players split on one keyboard | health bars top, timer centre | Key ghosting on shared keyboards; offer rebinding. |
| Sports | `vga` | top-down or side sprites, simple AI | keyboard, 2-player split | scoreboard strip | Physics that only a modern CPU could run. |
| Pinball | `vga` or `modex` | tall scrolling table, physics substeps (4-8 per tick) | Left/Right Shift flippers, Space plunger | table + LED-style score strip at top | Tunnelling; substep. |
| Card / board / casual | `ega` or `vga640` | `rect`, `frame`, text | mouse | green felt, menu bar | None era-specific; keep it snappy. |
| Edutainment / quiz | `ega` or `text40` | big text, `con` | keyboard + mouse | large prompts, mascot corner (original) | Talking down; keep feedback kind. |
| Illustrated story / VN | `vga` | scenes via `unpack`, text box in framebuffer | Space/Enter, mouse | picture top 2/3, text box bottom | Walls of text; 3-4 lines per box. |

**Genres DOS never had** (battle royale, deckbuilder, idle, rhythm, survival-craft, open world): keep the core loop and express it with period means: turn or tick based systems, text menus, hotseat instead of online, save to disk, one-screen maps linked by exits. Put the translation on the Profile Card.

## Presentation and ritual

These screens are what make it feel like a DOS game rather than a pixel game.
- **SETUP screen** on first run: pick sound device (1 PC Speaker, 2 FM Synth card, 3 FM + Digital card, 4 None) and controls; remember with `DOS.save`. Generic names only.
- **Title**: palette fade-in, name in the 8x8 font or converted title art, "Press SPACE"; optional attract mode (a demo loop after 20 s idle).
- **Help on F1**: keys and goal in a boxed panel (`S.con.box` in text mode, `S.frame` in graphics).
- **Status bar** in the framebuffer, not HTML. Numbers zero-padded (`String(n).padStart(5,'0')`).
- **Transitions**: fade between screens; fizzle for death or level end; palette cycling for life on still screens.
- **Pause** (P), **mute** (M), **music** (B), **Esc** menu with Quit. Quit shows a short text-mode "thanks for playing" screen with credits, then returns to the title.
- **Loading or "installing" screens**: at most one second and skippable, or none. No fake copy protection.
- **Touch**: `DOS.touchPad(el, {label: code})` builds buttons that press virtual keys; show them only under `pointer:coarse`.

## Engine API (Appendix B)

```
S = DOS.screen(canvas, {mode:'vga', palette?, scanlines?:0.12})   modes: text text40 cga ega ega350 vga modex vga640 svga
S.W S.H S.fb   S.cls(c)  S.pset/pget  S.rect  S.frame  S.line  S.circle  S.poly([[x,y]..],c)  S.dither(x,y,w,h,c1,c2,level)
S.blit(spr,x,y,{flip,color})   S.text(str,x,y,c,bg?)  S.textW(str)
S.con: put print fill box(x,y,w,h,fg,bg,double) clear render      (text modes: call render() at the end of draw)
S.setPal(i,[r,g,b]) S.setPalette(list) S.getPalette() S.nearest([r,g,b])   (values snap to the mode's hardware gamut)
S.fadeOut(t) S.fadeIn(t) S.fadeTo(pal,t) S.cycle(a,b,every) S.stopCycles() S.fizzle(c,ticks) S.busy()   (promises)
S.mouse {x,y,down,clicked}  (framebuffer coordinates)
DOS.sprite(rows,key) DOS.unpack(json) DOS.shadeTable(S,levels,fog) DOS.cga(n,hi,bg) DOS.vgaDefault() DOS.RGBI DOS.EGA64
DOS.key(...codes) DOS.pressed(...codes) DOS.touchPad(el,map)   (KeyboardEvent.code names)
DOS.audio: setDevice('speaker'|'fm'|'digital'|'off') sfx(name) defineSfx beep(f,ms,f2) fmAt(ch,hz,t,dur,patch) pcm(f32,rate) mute()
DOS.music: play(song) stop() toggle()      DOS.run(S,{update,draw,hz})   DOS.save(k,v) DOS.load(k,def)
DOS.raycaster(S,{viewH,fov,shade,ceil,floor}).render(player,map,textures,sprites)  DOS.gridMap(rows)   (Appendix C)
```
VGA default palette layout (`DOS.vgaDefault()`): 0-15 the EGA colours, 16-31 a grey ramp, 32-247 nine blocks of 24 hues (high, medium, low brightness x high, medium, low saturation), 248-255 black. For your own ramps, overwrite a block and keep 0-15 for UI text.

## Landmines (found while building and testing this skill)

- **Draw every frame or freeze.** Games redraw the whole framebuffer each frame, so a pixel effect applied "once" is erased next frame. `S.fizzle` therefore blocks `draw()` until it ends, and resumes with the game's new state. Change state first, then fizzle.
- **Gamut is enforced.** In `ega` or `cga`, `setPal(i, anyColour)` snaps to the nearest RGBI colour, so fades step instead of gliding (authentic). Want smooth fades: use `vga`.
- **Auto-converted art loses hue in 16 colours** (greens can go grey). Hand-pick or hand-dither the important areas.
- **Text mode** uses `S.con` and needs `S.con.render()` at the end of `draw`; the font has ASCII plus box and shade characters only.
- **Ctrl and Alt were the period fire/jump keys, but browsers own them.** Ctrl+W closes the tab and cannot be blocked; Alt focuses menus. Default to Space/Z/X/Enter and offer rebinding; never pair Ctrl with WASD.
- **Audio needs a gesture.** Nothing plays before the first key or click; the engine unlocks on the first input and starts any pending song.
- **16-bit C (NATIVE):** `320*200` overflows a 16-bit `int`. Use `64000U`, a `far` back buffer, and `(unsigned)y * 320` offsets.

## NATIVE mode: a real DOS program

Verified toolchain (Sep 2026, in a Linux cloud container): Open Watcom v2 snapshot from GitHub releases (`open-watcom-v2/releases/download/Current-build/ow-snapshot.tar.xz`) and DOSBox 0.74 from apt. DJGPP also downloads, but its DPMI host (CWSDPMI) was not reachable from that container, so prefer Open Watcom 16-bit real mode.
```
export WATCOM=/tmp/ow PATH=/tmp/ow/binl64:$PATH INCLUDE=/tmp/ow/h
wcl -q -bt=dos -ml -ox -fe=GAME.EXE GAME.C
SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy timeout 40 dosbox -c "mount c ." -c "c:" -c "GAME.EXE /T" -c "exit"
```
The skeleton (Appendix F) sets mode 13h, programs the DAC, draws into a far back buffer, flips on vsync, beeps through the PIT, and with `/T` dumps `FRAME.RAW` (64000 indices + 768 palette bytes) so you can convert it to PNG on the host and look at it. Deliver the .C source, the .EXE, and a README with the DOSBox command. Running the .EXE inside a browser page (js-dos) was not tested; say so if asked.

## Appendix A: page shell (`game.html`)
Replace `{{TITLE}}`, `{{CONTROLS}}`, `{{FOOTER}}`, paste Appendix B (and C if used) into the first script and the game into the second.
```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{TITLE}}</title>
<style>
  :root { --bg:#0b0b12; --panel:#15151f; --ink:#c8c8d0; --dim:#7a7a88; --accent:#55ffff; }
  @media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) { --bg:#e9e7e1; --panel:#dcd9d0; --ink:#1b1b22; --dim:#55535c; --accent:#0000aa; } }
  :root[data-theme="dark"] { --bg:#0b0b12; --panel:#15151f; --ink:#c8c8d0; --dim:#7a7a88; --accent:#55ffff; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.5 "IBM Plex Mono", ui-monospace, monospace; }
  main { max-width: 960px; margin: 0 auto; padding: 16px; }
  .crt { background:#000; border-radius:10px; padding:10px; box-shadow: 0 0 0 2px var(--panel), 0 10px 40px rgba(0,0,0,.45); }
  canvas { display:block; width:100%; height:auto; aspect-ratio:4/3; image-rendering:pixelated; touch-action:none; outline:none; }
  .bar { display:flex; gap:12px; flex-wrap:wrap; justify-content:space-between; color:var(--dim); font-size:12px; margin-top:10px; }
  .pad { display:none; gap:8px; justify-content:center; flex-wrap:wrap; margin-top:12px; }
  .pad button { min-width:56px; min-height:48px; font:inherit; background:var(--panel); color:var(--ink); border:1px solid var(--dim); border-radius:8px; user-select:none; -webkit-user-select:none; touch-action:none; }
  @media (pointer:coarse) { .pad { display:flex; } }
  footer { color:var(--dim); font-size:12px; margin-top:14px; }
</style>
</head>
<body>
<main>
  <div class="crt"><canvas id="screen" tabindex="0" aria-label="{{TITLE}} game screen"></canvas></div>
  <div class="bar"><span>{{CONTROLS}}</span><span>M mute · B music · P pause</span></div>
  <div class="pad" id="pad"></div>
  <footer>{{FOOTER}}</footer>
</main>
<script>
/*__ENGINE__*/
</script>
<script>
/*__GAME__*/
</script>
</body>
</html>
```

## Appendix B: engine (`dos-engine.js`)
```js
/* DOS FORGE ENGINE v1.0 — indexed-colour DOS-era runtime for one-file browser games.
   Font: font8x8 by Daniel Hepper, public domain (derived from public-domain IBM VGA fonts). */
const DOS = (() => {
  'use strict';
  const up6 = v => ((v & 63) << 2) | ((v & 63) >> 4);            // 6-bit DAC -> 8-bit
  const hex = s => [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];

  // ---------- palettes ----------
  const RGBI = ['000000','0000AA','00AA00','00AAAA','AA0000','AA00AA','AA5500','AAAAAA',
                '555555','5555FF','55FF55','55FFFF','FF5555','FF55FF','FFFF55','FFFFFF'].map(hex);
  const EGA64 = Array.from({ length: 64 }, (_, i) => [[2, 5], [1, 4], [0, 3]].map(([p, s]) =>
    ((i >> p) & 1) * 0xAA + ((i >> s) & 1) * 0x55));             // rgbRGB bits
  function cga(n = 1, hi = true, bg = 0) {                        // n: 0 grn/red/brn, 1 cyn/mag/wht, 5 cyn/red/wht
    const sets = { 0: [2, 4, 6], 1: [3, 5, 7], 5: [3, 4, 7] }[n];
    return [RGBI[bg], ...sets.map(c => RGBI[c + (hi ? 8 : 0)])];
  }
  function vgaDefault() {
    const p = RGBI.slice();
    [0,5,8,11,14,17,20,24,28,32,36,40,45,50,56,63].forEach(g => p.push([up6(g), up6(g), up6(g)]));
    const L = [[0,16,31,47,63],[31,39,47,55,63],[45,49,54,58,63],[0,7,14,21,28],[14,17,21,24,28],
               [20,22,24,26,28],[0,4,8,12,16],[8,10,12,14,16],[11,12,13,15,16]];
    const H = [[0,0,4],[1,0,4],[2,0,4],[3,0,4],[4,0,4],[4,0,3],[4,0,2],[4,0,1],[4,0,0],[4,1,0],[4,2,0],[4,3,0],
               [4,4,0],[3,4,0],[2,4,0],[1,4,0],[0,4,0],[0,4,1],[0,4,2],[0,4,3],[0,4,4],[0,3,4],[0,2,4],[0,1,4]];
    L.forEach(l => H.forEach(h => p.push(h.map(k => up6(l[k])))));
    while (p.length < 256) p.push([0, 0, 0]);
    return p;
  }
  const GAMUT = {                                                  // what the hardware could physically show
    rgbi: c => nearest(RGBI, c), ega64: c => nearest(EGA64, c), vga18: c => c.map(v => up6(Math.round(v * 63 / 255)))
  };
  function nearest(list, [r, g, b]) {
    let best = list[0], bd = 1e9;
    for (const q of list) { const d = (q[0]-r)**2*3 + (q[1]-g)**2*4 + (q[2]-b)**2*2; if (d < bd) { bd = d; best = q; } }
    return best.slice();
  }

  // ---------- modes ----------
  const MODES = {
    cga:    { w: 320, h: 200, colors: 4,   gamut: 'rgbi',  hz: 60 },
    ega:    { w: 320, h: 200, colors: 16,  gamut: 'rgbi',  hz: 60 },
    ega350: { w: 640, h: 350, colors: 16,  gamut: 'ega64', hz: 60 },
    vga:    { w: 320, h: 200, colors: 256, gamut: 'vga18', hz: 70 },
    modex:  { w: 320, h: 240, colors: 256, gamut: 'vga18', hz: 60 },
    vga640: { w: 640, h: 480, colors: 16,  gamut: 'vga18', hz: 60 },
    svga:   { w: 640, h: 480, colors: 256, gamut: 'vga18', hz: 60 },
    text:   { w: 640, h: 400, colors: 16,  gamut: 'rgbi',  hz: 70, cols: 80, rows: 25 },
    text40: { w: 320, h: 200, colors: 16,  gamut: 'rgbi',  hz: 70, cols: 40, rows: 25 }
  };

  // ---------- font (8x8, cp437-style subset) ----------
  const FONT_CHARS = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~─│┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬█▀▄▌▐░▒▓';
  const FONT_B64 = 'AAAAAAAAAAAYPDwYGAAYADY2AAAAAAAANjZ/Nn82NgAMPgMeMB8MAABjMxgMZmMAHDYcbjszbgAGBgMAAAAAABgMBgYGDBgABgwYGBgMBgAAZjz/PGYAAAAMDD8MDAAAAAAAAAAMDAYAAAA/AAAAAAAAAAAADAwAYDAYDAYDAQA+Y3N7b2c+AAwODAwMDD8AHjMwHAYzPwAeMzAcMDMeADg8NjN/MHgAPwMfMDAzHgAcBgMfMzMeAD8zMBgMDAwAHjMzHjMzHgAeMzM+MBgOAAAMDAAADAwAAAwMAAAMDAYYDAYDBgwYAAAAPwAAPwAABgwYMBgMBgAeMzAYDAAMAD5je3t7Ax4ADB4zMz8zMwA/ZmY+ZmY/ADxmAwMDZjwAHzZmZmY2HwB/RhYeFkZ/AH9GFh4WBg8APGYDA3NmfAAzMzM/MzMzAB4MDAwMDB4AeDAwMDMzHgBnZjYeNmZnAA8GBgZGZn8AY3d/f2tjYwBjZ297c2NjABw2Y2NjNhwAP2ZmPgYGDwAeMzMzOx44AD9mZj42ZmcAHjMHDjgzHgA/LQwMDAweADMzMzMzMz8AMzMzMzMeDABjY2Nrf3djAGNjNhwcNmMAMzMzHgwMHgB/YzEYTGZ/AB4GBgYGBh4AAwYMGDBgQAAeGBgYGBgeAAgcNmMAAAAAAAAAAAAAAP8MDBgAAAAAAAAAHjA+M24ABwYGPmZmOwAAAB4zAzMeADgwMD4zM24AAAAeMz8DHgAcNgYPBgYPAAAAbjMzPjAfBwY2bmZmZwAMAA4MDAweADAAMDAwMzMeBwZmNh42ZwAODAwMDAweAAAAM39/a2MAAAAfMzMzMwAAAB4zMzMeAAAAO2ZmPgYPAABuMzM+MHgAADtuZgYPAAAAPgMeMB8ACAw+DAwsGAAAADMzMzNuAAAAMzMzHgwAAABja39/NgAAAGM2HDZjAAAAMzMzPjAfAAA/GQwmPwA4DAwHDAw4ABgYGAAYGBgABwwMOAwMBwBuOwAAAAAAAAAAAAD/AAAACAgICAgICAgAAAAA+AgICAAAAAAPCAgICAgICPgAAAAICAgIDwAAAAgICAj4CAgICAgICA8ICAgAAAAA/wgICAgICAj/AAAACAgICP8ICAgAAAD/AP8AABQUFBQUFBQUAAAA/AT0FBQAAAAfEBcUFBQUFPQE/AAAFBQUFxAfAAAUFBT0BPQUFBQUFBcQFxQUAAAA/wD3FBQUFBT3AP8AABQUFPcA9xQU////////////////AAAAAAAAAAD/////Dw8PDw8PDw/w8PDw8PDw8FUAqgBVAKoAVapVqlWqVar/qv9V/6r/VQ==';
  const FONT = (() => { const raw = atob(FONT_B64), m = new Map();
    [...FONT_CHARS].forEach((ch, i) => { const g = []; for (let r = 0; r < 8; r++) g.push(raw.charCodeAt(i * 8 + r)); m.set(ch, g); });
    return m; })();
  const glyph = ch => FONT.get(ch) || FONT.get('?');

  // ---------- screen ----------
  const screens = [];
  function screen(canvas, opt = {}) {
    const M = MODES[opt.mode || 'vga'];
    if (!M) throw new Error('unknown mode ' + opt.mode);
    const W = M.w, Hh = M.h, fb = new Uint8Array(W * Hh);
    const small = document.createElement('canvas'); small.width = W; small.height = Hh;
    const sctx = small.getContext('2d'), img = sctx.createImageData(W, Hh), px = new Uint32Array(img.data.buffer);
    const kx = Math.ceil(1600 / W);                                   // display is always 4:3, like the CRT
    canvas.width = W * kx; canvas.height = Math.round(W * kx * 3 / 4);
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
    const S = { mode: opt.mode || 'vga', W, H: Hh, fb, M, canvas, scanlines: opt.scanlines ?? 0.12 };
    // palette with hardware gamut enforcement
    let pal = [], lut = new Uint32Array(256), dirty = true;
    S.setPal = (i, rgb) => { if (i < 0 || i >= M.colors) return; pal[i] = GAMUT[M.gamut](rgb); dirty = true; };
    S.setPalette = list => { pal = []; list.slice(0, M.colors).forEach((c, i) => S.setPal(i, c)); while (pal.length < M.colors) pal.push([0,0,0]); dirty = true; };
    S.getPalette = () => pal.map(c => c.slice());
    S.setPalette(opt.palette || (M.colors === 4 ? cga(1) : M.colors === 16 ? RGBI : vgaDefault()));
    S.nearest = rgb => { let bi = 0, bd = 1e9; pal.forEach((q, i) => { const d = (q[0]-rgb[0])**2*3+(q[1]-rgb[1])**2*4+(q[2]-rgb[2])**2*2; if (d < bd) { bd = d; bi = i; } }); return bi; };
    // drawing (all colours are palette indices)
    const clampC = c => c % M.colors;
    S.cls = (c = 0) => fb.fill(clampC(c));
    S.pset = (x, y, c) => { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < W && y < Hh) fb[y * W + x] = clampC(c); };
    S.pget = (x, y) => (x >= 0 && y >= 0 && x < W && y < Hh) ? fb[(y | 0) * W + (x | 0)] : 0;
    S.rect = (x, y, w, h, c) => { const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0), x1 = Math.min(W, (x + w) | 0), y1 = Math.min(Hh, (y + h) | 0);
      c = clampC(c); for (let j = y0; j < y1; j++) fb.fill(c, j * W + x0, j * W + x1); };
    S.frame = (x, y, w, h, c) => { S.rect(x, y, w, 1, c); S.rect(x, y + h - 1, w, 1, c); S.rect(x, y, 1, h, c); S.rect(x + w - 1, y, 1, h, c); };
    S.line = (x0, y0, x1, y1, c) => { x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0; const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy;
      for (;;) { S.pset(x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } } };
    S.circle = (cx, cy, r, c, fill = true) => { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) { const d = x * x + y * y; if (fill ? d <= r * r + r : Math.abs(d - r * r) <= r) S.pset(cx + x, cy + y, c); } };
    S.poly = (pts, c) => {                                          // filled polygon, even-odd scanline fill
      const ys = pts.map(p => p[1]), y0 = Math.max(0, Math.ceil(Math.min(...ys))), y1 = Math.min(Hh - 1, Math.floor(Math.max(...ys)));
      for (let y = y0; y <= y1; y++) { const xs = [];
        for (let i = 0; i < pts.length; i++) { const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
          if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + (y - ay) * (bx - ax) / (by - ay)); }
        xs.sort((a, b) => a - b); for (let k = 0; k + 1 < xs.length; k += 2) S.rect(Math.ceil(xs[k]), y, Math.ceil(xs[k + 1]) - Math.ceil(xs[k]), 1, c); } };
    S.blit = (spr, x, y, o = {}) => { x |= 0; y |= 0; const { w, h, data } = spr;
      for (let j = 0; j < h; j++) { const yy = y + j; if (yy < 0 || yy >= Hh) continue;
        for (let i = 0; i < w; i++) { const xx = x + i; if (xx < 0 || xx >= W) continue;
          const v = data[j * w + (o.flip ? w - 1 - i : i)]; if (v >= 0) fb[yy * W + xx] = o.color ?? v; } } };
    S.text = (str, x, y, c, bg = -1) => { let cx = x;
      for (const ch of String(str)) { if (ch === '\n') { cx = x; y += 9; continue; } const g = glyph(ch);
        for (let r = 0; r < 8; r++) for (let b = 0; b < 8; b++) { const on = (g[r] >> b) & 1; if (on) S.pset(cx + b, y + r, c); else if (bg >= 0) S.pset(cx + b, y + r, bg); }
        cx += 8; } };
    S.textW = str => String(str).length * 8;
    S.dither = (x, y, w, h, c1, c2, level = 0.5) => { const B = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) S.pset(x + i, y + j, (B[((y + j) & 3) * 4 + ((x + i) & 3)] + 0.5) / 16 < level ? c2 : c1); };
    // text-mode console (only meaningful in text/text40, but usable anywhere)
    const cols = M.cols || (W >> 3), rows = M.rows || (Hh >> 3), cellH = M.cols ? Hh / rows : 8;
    const cells = new Uint16Array(cols * rows), attrs = new Uint8Array(cols * rows).fill(0x07);
    const charIdx = new Map([...FONT_CHARS].map((c, i) => [c, i]));
    S.con = { cols, rows,
      put(x, y, ch, fg = 7, bg = 0) { if (x < 0 || y < 0 || x >= cols || y >= rows) return; const k = y * cols + x; cells[k] = charIdx.get(ch) ?? 0; attrs[k] = ((bg & 15) << 4) | (fg & 15); },
      print(x, y, s, fg = 7, bg = 0) { [...String(s)].forEach((ch, i) => this.put(x + i, y, ch, fg, bg)); },
      fill(x, y, w, h, ch = ' ', fg = 7, bg = 0) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.put(x + i, y + j, ch, fg, bg); },
      box(x, y, w, h, fg = 7, bg = 0, dbl = false) { const [tl, tr, bl, br, hz, vt] = dbl ? '╔╗╚╝═║' : '┌┐└┘─│';
        this.fill(x, y, w, h, ' ', fg, bg); for (let i = 1; i < w - 1; i++) { this.put(x + i, y, hz, fg, bg); this.put(x + i, y + h - 1, hz, fg, bg); }
        for (let j = 1; j < h - 1; j++) { this.put(x, y + j, vt, fg, bg); this.put(x + w - 1, y + j, vt, fg, bg); }
        this.put(x, y, tl, fg, bg); this.put(x + w - 1, y, tr, fg, bg); this.put(x, y + h - 1, bl, fg, bg); this.put(x + w - 1, y + h - 1, br, fg, bg); },
      clear(bg = 0) { cells.fill(0); attrs.fill((bg & 15) << 4 | 7); },
      render() { const chars = [...FONT_CHARS];
        for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) { const k = cy * cols + cx, a = attrs[k], g = glyph(chars[cells[k]]);
          for (let r = 0; r < cellH; r++) { const gr = g[Math.floor(r * 8 / cellH)], base = (cy * cellH + r) * W + cx * 8;
            for (let b = 0; b < 8; b++) fb[base + b] = ((gr >> b) & 1) ? (a & 15) : (a >> 4); } } } };
    // palette effects: fades and cycling operate on the palette, as the hardware did
    let fade = null; const cycles = [];
    S.fadeTo = (target, ticks = 35) => new Promise(res => { fade = { from: S.getPalette(), to: target.map(c => c.slice()), t: 0, n: ticks, res }; });
    S.fadeOut = (ticks = 35) => { S._saved = S.getPalette(); return S.fadeTo(pal.map(() => [0, 0, 0]), ticks); };
    S.fadeIn = (ticks = 35, target = S._saved) => S.fadeTo(target, ticks);
    S.cycle = (from, to, every = 4) => cycles.push({ from, to, every, t: 0 });
    S.stopCycles = () => { cycles.length = 0; };
    // LFSR fizzle: dissolve the frozen screen to colour c, pixel by pixel, in pseudo-random order.
    // While it runs, DOS.run() skips draw() — the transition is blocking, as it was on real hardware.
    const lfsrMask = { 16: 0xB400, 17: 0x12000, 18: 0x20400, 19: 0x40023, 20: 0x90000 };
    let fz = null;
    S.busy = () => !!fz;
    S.fizzle = (c = 0, ticks = 70) => new Promise(res => { let n = 16; while ((1 << n) - 1 < W * Hh) n++; fz = { c, s: 1, m: lfsrMask[n], per: Math.ceil(((1 << n) - 1) / ticks), res }; });
    S._tickFx = () => {
      if (fade) { fade.t++; const k = Math.min(1, fade.t / fade.n);
        fade.to.forEach((c, i) => { const f = fade.from[i] || [0,0,0]; pal[i] = GAMUT[M.gamut](c.map((v, j) => f[j] + (v - f[j]) * k)); }); dirty = true;
        if (k >= 1) { const r = fade.res; fade = null; r(); } }
      for (const cy of cycles) if (++cy.t >= cy.every) { cy.t = 0; const last = pal[cy.to]; for (let i = cy.to; i > cy.from; i--) pal[i] = pal[i - 1]; pal[cy.from] = last; dirty = true; }
      if (fz) { for (let k = 0; k < fz.per; k++) { const lsb = fz.s & 1; fz.s >>>= 1; if (lsb) fz.s ^= fz.m; const p = fz.s - 1; if (p < W * Hh) fb[p] = fz.c; if (fz.s === 1) { fb.fill(fz.c); const r = fz.res; fz = null; r(); break; } } }
    };
    S.present = () => {
      if (dirty) { for (let i = 0; i < 256; i++) { const c = pal[i] || [0, 0, 0]; lut[i] = 0xFF000000 | (c[2] << 16) | (c[1] << 8) | c[0]; } dirty = false; }
      for (let i = 0; i < fb.length; i++) px[i] = lut[fb[i]];
      sctx.putImageData(img, 0, 0); ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
      if (S.scanlines > 0) { const sy = canvas.height / Hh; ctx.fillStyle = `rgba(0,0,0,${S.scanlines})`;
        for (let y = 0; y < Hh; y++) ctx.fillRect(0, Math.floor(y * sy + sy * 0.66), canvas.width, Math.max(1, Math.floor(sy / 3))); }
    };
    // mouse in framebuffer coordinates
    S.mouse = { x: 0, y: 0, down: false, clicked: false };
    const toFb = e => { const r = canvas.getBoundingClientRect(); S.mouse.x = Math.floor((e.clientX - r.left) / r.width * W); S.mouse.y = Math.floor((e.clientY - r.top) / r.height * Hh); };
    canvas.addEventListener('pointermove', toFb);
    canvas.addEventListener('pointerdown', e => { toFb(e); S.mouse.down = true; S.mouse.clicked = true; audio.unlock(); });
    addEventListener('pointerup', () => { S.mouse.down = false; });
    screens.push(S);
    return S;
  }

  // ---------- sprites, maps, light tables ----------
  function sprite(rows, key = {}) {                                // rows: ['..1..'], key {'1': 15}; '.' or ' ' = transparent
    const h = rows.length, w = Math.max(...rows.map(r => r.length)), data = new Int16Array(w * h).fill(-1);
    rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch !== '.' && ch !== ' ') data[j * w + i] = key[ch] ?? parseInt(ch, 36); }));
    return { w, h, data };
  }
  function unpack(o) {                                              // JSON from dos_palette.py -> sprite (+ its palette)
    const raw = atob(o.data), data = new Int16Array(o.w * o.h);
    for (let i = 0; i < data.length; i++) data[i] = raw.charCodeAt(i);
    return { w: o.w, h: o.h, data, pal: o.pal };
  }
  function shadeTable(S, levels = 16, fog = [0, 0, 0]) {           // Doom-style colormap: [level][index] -> index
    const P = S.getPalette(), t = [];
    for (let l = 0; l < levels; l++) { const k = l / (levels - 1), row = new Uint8Array(256);
      P.forEach((c, i) => { row[i] = S.nearest(c.map((v, j) => v + (fog[j] - v) * k)); }); t.push(row); }
    return t;
  }

  // ---------- input ----------
  const held = new Set(), edge = new Set(), BLOCK = new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space']);
  addEventListener('keydown', e => { if (BLOCK.has(e.code)) e.preventDefault(); if (!held.has(e.code)) edge.add(e.code); held.add(e.code); audio.unlock(); });
  addEventListener('keyup', e => held.delete(e.code));
  addEventListener('blur', () => held.clear());
  const key = (...codes) => codes.some(c => held.has(c)), pressed = (...codes) => codes.some(c => edge.has(c));
  function touchPad(el, map) {                                     // map: {label: code}; buttons press virtual keys
    Object.entries(map).forEach(([label, code]) => { const b = document.createElement('button'); b.textContent = label; b.type = 'button';
      const on = e => { e.preventDefault(); if (!held.has(code)) edge.add(code); held.add(code); audio.unlock(); }, off = e => { e.preventDefault(); held.delete(code); };
      b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off); el.appendChild(b); });
  }

  // ---------- audio: period sound devices ----------
  const audio = (() => {
    let ac = null, out = null, device = 'fm', muted = false;
    const A = { get ctx() { return ac; } };
    A.unlock = () => { if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); out = ac.createGain(); out.gain.value = 0.5; out.connect(ac.destination); build(); music.restart(); } catch (e) { ac = null; } };
    A.setDevice = d => { device = d; };                             // 'speaker' | 'fm' | 'digital' (FM music + 8-bit PCM sfx) | 'off'
    A.device = () => device;
    A.mute = m => { muted = m ?? !muted; if (out) out.gain.value = muted ? 0 : 0.5; return muted; };
    const PIT = 1193182, pitQ = f => PIT / Math.max(1, Math.round(PIT / f));   // speaker pitches snap to timer divisors
    let spk = null, spkGain = null, waves = {};
    function build() {
      spk = ac.createOscillator(); spk.type = 'square'; spkGain = ac.createGain(); spkGain.gain.value = 0;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000;
      spk.connect(spkGain).connect(lp).connect(out); spk.start();
      const shapes = { sine: t => Math.sin(t), half: t => Math.max(0, Math.sin(t)), abs: t => Math.abs(Math.sin(t)), quarter: t => (t % Math.PI) < Math.PI / 2 ? Math.abs(Math.sin(t)) : 0 };
      for (const [k, f] of Object.entries(shapes)) { const N = 1024, H = 32, re = new Float32Array(H), im = new Float32Array(H);
        for (let h = 1; h < H; h++) { let a = 0, b = 0; for (let n = 0; n < N; n++) { const t = 2 * Math.PI * n / N, v = f(t); a += v * Math.cos(h * t); b += v * Math.sin(h * t); } re[h] = 2 * a / N; im[h] = 2 * b / N; }
        waves[k] = ac.createPeriodicWave(re, im); }
    }
    // PC speaker: ONE square voice. New sounds interrupt old ones, exactly like the real thing.
    A.beep = (freq, ms = 80, freq2 = null) => { if (!ac || muted || device === 'off') return; const t = ac.currentTime;
      spk.frequency.cancelScheduledValues(t); spk.frequency.setValueAtTime(pitQ(freq), t);
      if (freq2) spk.frequency.linearRampToValueAtTime(pitQ(freq2), t + ms / 1000);
      spkGain.gain.cancelScheduledValues(t); spkGain.gain.setValueAtTime(0.18, t); spkGain.gain.setValueAtTime(0, t + ms / 1000); };
    A.speakerAt = (freq, t, dur) => { if (!ac) return; spk.frequency.setValueAtTime(pitQ(freq), t); spkGain.gain.setValueAtTime(0.16, t); spkGain.gain.setValueAtTime(0, t + dur * 0.92); };
    // OPL-style 2-operator FM voice, 9 channels max
    const PATCH = {
      lead:  { wave: 'sine', mwave: 'sine', ratio: 1, index: 1.6, a: 0.01, d: 0.15, s: 0.6, r: 0.1, gain: 0.22 },
      bass:  { wave: 'half', mwave: 'sine', ratio: 0.5, index: 2.2, a: 0.005, d: 0.2, s: 0.5, r: 0.08, gain: 0.28 },
      organ: { wave: 'abs', mwave: 'sine', ratio: 2, index: 0.8, a: 0.02, d: 0.05, s: 0.9, r: 0.15, gain: 0.16 },
      brass: { wave: 'sine', mwave: 'sine', ratio: 1, index: 3.0, a: 0.06, d: 0.2, s: 0.7, r: 0.12, gain: 0.18 },
      bell:  { wave: 'sine', mwave: 'sine', ratio: 3.5, index: 4.0, a: 0.002, d: 0.8, s: 0, r: 0.6, gain: 0.16 },
      pluck: { wave: 'quarter', mwave: 'sine', ratio: 2, index: 1.2, a: 0.002, d: 0.25, s: 0, r: 0.1, gain: 0.2 },
      pad:   { wave: 'sine', mwave: 'sine', ratio: 1.01, index: 0.6, a: 0.3, d: 0.4, s: 0.7, r: 0.6, gain: 0.12 }
    };
    A.patches = PATCH;
    const chans = new Array(9).fill(null);
    A.fmAt = (ch, freq, t, dur, patch = 'lead') => { if (!ac) return; const P = typeof patch === 'string' ? PATCH[patch] : patch; ch = ch % 9;
      if (chans[ch]) { try { chans[ch].stop(t); } catch (e) {} }
      const car = ac.createOscillator(), mod = ac.createOscillator(), mg = ac.createGain(), vg = ac.createGain();
      car.setPeriodicWave(waves[P.wave]); mod.setPeriodicWave(waves[P.mwave]);
      car.frequency.value = freq; mod.frequency.value = freq * P.ratio;
      const idx = freq * P.index; mg.gain.setValueAtTime(idx, t); mg.gain.exponentialRampToValueAtTime(Math.max(1, idx * 0.3), t + P.a + P.d);
      mod.connect(mg).connect(car.frequency); car.connect(vg).connect(out);
      const end = t + Math.max(dur, P.a + 0.01);
      vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(P.gain, t + P.a);
      vg.gain.linearRampToValueAtTime(P.gain * Math.max(P.s, 0.0001), t + P.a + P.d);
      vg.gain.setValueAtTime(P.gain * Math.max(P.s, 0.0001), end); vg.gain.linearRampToValueAtTime(0, end + P.r);
      car.start(t); mod.start(t); car.stop(end + P.r + 0.02); mod.stop(end + P.r + 0.02); chans[ch] = car; };
    // 8-bit PCM ("digital sound card"): mono, 256 levels, low sample rate
    A.pcm = (samples, rate = 11025, vol = 0.5) => { if (!ac || muted || device === 'off') return; const b = ac.createBuffer(1, samples.length, rate), d = b.getChannelData(0);
      for (let i = 0; i < samples.length; i++) d[i] = Math.round(Math.max(-1, Math.min(1, samples[i])) * 127) / 127;
      const s = ac.createBufferSource(), g = ac.createGain(); g.gain.value = vol; s.buffer = b; s.connect(g).connect(out); s.start(); };
    const gen = (sec, fn, rate = 11025) => { const n = Math.floor(sec * rate), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = fn(i / rate, i / n); return a; };
    // one SFX vocabulary, three device voicings
    const SFX = {
      jump:    { spk: [300, 90, 700],  fm: [520, 0.12, 'pluck'], pcm: () => gen(0.14, (t, k) => Math.sign(Math.sin(2 * Math.PI * (300 + 900 * k) * t)) * (1 - k)) },
      coin:    { spk: [990, 60, 1320], fm: [1320, 0.12, 'bell'],  pcm: () => gen(0.18, (t, k) => Math.sin(2 * Math.PI * (k < 0.3 ? 988 : 1319) * t) * (1 - k)) },
      shoot:   { spk: [1200, 70, 300], fm: [880, 0.08, 'brass'], pcm: () => gen(0.16, (t, k) => (Math.random() * 2 - 1) * (1 - k) * 0.6 + Math.sin(2 * Math.PI * (1400 - 1100 * k) * t) * (1 - k) * 0.5) },
      hit:     { spk: [180, 120, 90],  fm: [110, 0.15, 'bass'],  pcm: () => gen(0.2, (t, k) => (Math.random() * 2 - 1) * Math.pow(1 - k, 2)) },
      explode: { spk: [120, 250, 40],  fm: [55, 0.4, 'bass'],    pcm: () => { let v = 0; return gen(0.6, (t, k) => { if (Math.random() < 0.3 + 0.7 * (1 - k)) v = Math.random() * 2 - 1; return v * Math.pow(1 - k, 1.5); }); } },
      select:  { spk: [660, 40],       fm: [660, 0.06, 'pluck'], pcm: () => gen(0.05, t => Math.sign(Math.sin(2 * Math.PI * 660 * t)) * 0.6) },
      door:    { spk: [90, 200, 140],  fm: [98, 0.3, 'organ'],   pcm: () => gen(0.35, (t, k) => Math.sin(2 * Math.PI * (70 + 40 * k) * t) * 0.8 * (1 - k) + (Math.random() - 0.5) * 0.2) },
      powerup: { spk: [400, 300, 1600], fm: [784, 0.3, 'lead'],  pcm: () => gen(0.35, (t, k) => Math.sign(Math.sin(2 * Math.PI * (400 + 1200 * k) * t)) * 0.5) },
      die:     { spk: [600, 500, 60],  fm: [196, 0.5, 'brass'],  pcm: () => gen(0.6, (t, k) => Math.sin(2 * Math.PI * (500 - 430 * k) * t) * (1 - k)) }
    };
    const pcmCache = {};
    A.sfx = name => { const s = SFX[name]; if (!s || !ac || muted || device === 'off') return;
      if (device === 'speaker') A.beep(...s.spk);
      else if (device === 'fm') A.fmAt(8, s.fm[0], ac.currentTime, s.fm[1], s.fm[2]);
      else A.pcm(pcmCache[name] || (pcmCache[name] = s.pcm())); };
    A.defineSfx = (name, def) => { SFX[name] = def; delete pcmCache[name]; };
    return A;
  })();

  // ---------- music: tracker-style patterns, voiced per device ----------
  const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
  const noteHz = tok => { const m = /^([A-G]#?)-?(\d)$/.exec(tok); if (!m) return 0; return 440 * Math.pow(2, (NOTE[m[1]] + 12 * (+m[2] + 1) - 69) / 12); };
  const music = (() => {
    let song = null, row = 0, next = 0, timer = null, on = true;
    const M = {};
    M.play = s => { M.stop(); song = s; row = 0; if (!audio.ctx) return; next = audio.ctx.currentTime + 0.05; timer = setInterval(pump, 25); };  // before first key: starts on unlock
    M.stop = () => { if (timer) clearInterval(timer); timer = null; };
    M.toggle = () => { on = !on; return on; };
    M.restart = () => { if (song && !timer) M.play(song); };
    function pump() { const ac = audio.ctx; if (!ac || !song) return; const dev = audio.device();
      const tracks = song.tracks.map(t => t.trim().split(/\s+/)), len = Math.max(...tracks.map(t => t.length));
      const step = 60 / song.bpm / (song.rpb || 4);
      while (next < ac.currentTime + 0.12) {
        if (on && dev !== 'off') {
          const notes = tracks.map(t => t[row % t.length]);
          if (dev === 'speaker') {                                   // one voice: melody, or fast arpeggio of the chord
            const hz = notes.map(noteHz).filter(Boolean);
            if (song.speakerArp && hz.length > 1) { const sub = step / hz.length; hz.forEach((f, i) => audio.speakerAt(f, next + i * sub, sub)); }
            else if (noteHz(notes[0])) audio.speakerAt(noteHz(notes[0]), next, step * (song.gate ?? 0.9));
          } else notes.forEach((n, ch) => { const f = noteHz(n); if (f) { let d = 1; const t = tracks[ch];
              while (d < 16 && t[(row + d) % t.length] === '--') d++;               // '--' holds the note
              audio.fmAt(ch, f, next, step * d * (song.gate ?? 0.9), (song.patches || [])[ch] || 'lead'); } });
        }
        next += step; row = (row + 1) % len;
      } }
    return M;
  })();

  // ---------- loop ----------
  function run(S, { update, draw, hz }) {
    const dt = 1 / (hz || S.M.hz); let acc = 0, last = performance.now(), frames = 0;
    function frame(now) { acc += Math.min(0.25, (now - last) / 1000); last = now;
      while (acc >= dt) { update(dt); S._tickFx(); edge.clear(); S.mouse.clicked = false; acc -= dt; }
      if (!S.busy()) draw(); S.present(); frames++; requestAnimationFrame(frame); }
    requestAnimationFrame(frame);
    return { get frames() { return frames; } };
  }

  // ---------- persistence (per-viewer convenience only) ----------
  const save = (k, v) => { try { localStorage.setItem('dosforge:' + k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  const load = (k, d = null) => { try { const v = localStorage.getItem('dosforge:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };

  return { MODES, RGBI, EGA64, cga, vgaDefault, screens, screen, sprite, unpack, shadeTable, key, pressed, touchPad, audio, music, noteHz, run, save, load, glyph };
})();
```

## Appendix C: raycaster add-on (`dos-ray.js`, paste after the engine)
Map rows use `.` for floor and `1`-`9`, `a`-`z` for wall textures (any other character is wall 1). Textures are `{w,h,data:Int16Array}` of palette indices; sprites are `{x,y,spr,scale}`.
```js
/* DOS FORGE raycaster add-on: grid-DDA walls, textured, light-table shading, billboard sprites. */
DOS.raycaster = function (S, { viewH = S.H, fov = 0.66, shade = null, ceil = 8, floor = 7 } = {}) {
  const W = S.W, fb = S.fb, zbuf = new Float32Array(W);
  const lvl = d => shade ? Math.min(shade.length - 1, Math.floor(d * 1.6)) : 0;
  function render(p, map, tex, sprites = []) {                     // p {x,y,a}; map {w,h,at(x,y)->wall id 0=empty}
    const dx = Math.cos(p.a), dy = Math.sin(p.a), px = -dy * fov, py = dx * fov, half = viewH >> 1;
    for (let y = 0; y < viewH; y++) fb.fill(y < half ? ceil : floor, y * W, y * W + W);
    for (let x = 0; x < W; x++) {
      const cam = 2 * x / W - 1, rx = dx + px * cam, ry = dy + py * cam;
      let mx = Math.floor(p.x), my = Math.floor(p.y);
      const ddx = Math.abs(1 / rx), ddy = Math.abs(1 / ry), sx = rx < 0 ? -1 : 1, sy = ry < 0 ? -1 : 1;
      let sdx = (rx < 0 ? p.x - mx : mx + 1 - p.x) * ddx, sdy = (ry < 0 ? p.y - my : my + 1 - p.y) * ddy, side = 0, id = 0, guard = 0;
      while (!id && guard++ < 64) { if (sdx < sdy) { sdx += ddx; mx += sx; side = 0; } else { sdy += ddy; my += sy; side = 1; } id = map.at(mx, my); }
      const dist = Math.max(0.0001, side ? sdy - ddy : sdx - ddx); zbuf[x] = dist;
      if (!id) continue;
      const T = tex[(id - 1) % tex.length], hgt = Math.floor(viewH / dist);
      let wx = side ? p.x + dist * rx : p.y + dist * ry; wx -= Math.floor(wx);
      let tx = Math.floor(wx * T.w); if ((side === 0 && rx > 0) || (side === 1 && ry < 0)) tx = T.w - 1 - tx;
      const y0 = Math.max(0, half - (hgt >> 1)), y1 = Math.min(viewH, half + (hgt >> 1)), L = shade ? shade[Math.min(shade.length - 1, lvl(dist) + side * 2)] : null;
      for (let y = y0; y < y1; y++) { const ty = Math.floor((y - half + hgt / 2) * T.h / hgt); let c = T.data[Math.min(T.h - 1, Math.max(0, ty)) * T.w + tx];
        if (c < 0) continue; fb[y * W + x] = L ? L[c] : c; }
    }
    // billboard sprites, far to near, clipped against the wall z-buffer
    const inv = 1 / (px * dy - dx * py);
    sprites.map(s => ({ s, d: (s.x - p.x) ** 2 + (s.y - p.y) ** 2 })).sort((a, b) => b.d - a.d).forEach(({ s }) => {
      const rx = s.x - p.x, ry = s.y - p.y, tX = inv * (dy * rx - dx * ry), tY = inv * (-py * rx + px * ry);
      if (tY <= 0.1) return;
      const scx = Math.floor(W / 2 * (1 + tX / tY)), size = Math.floor(viewH / tY * (s.scale || 1)), spr = s.spr, L = shade ? shade[lvl(tY)] : null;
      const y0 = half + Math.floor(viewH / tY / 2) - size;
      for (let i = 0; i < size; i++) { const x = scx - (size >> 1) + i; if (x < 0 || x >= W || tY >= zbuf[x]) continue;
        const tx = Math.floor(i * spr.w / size);
        for (let j = 0; j < size; j++) { const y = y0 + j; if (y < 0 || y >= viewH) continue; const c = spr.data[Math.floor(j * spr.h / size) * spr.w + tx]; if (c >= 0) fb[y * W + x] = L ? L[c] : c; } }
    });
  }
  return { render, zbuf };
};
DOS.gridMap = rows => ({ w: rows[0].length, h: rows.length, at(x, y) { const r = rows[y]; if (!r || x < 0 || x >= r.length) return 1; const c = r[x]; if (c === '.' || c === ' ') return 0; const v = parseInt(c, 36); return isNaN(v) ? 1 : v; } });
```

## Appendix D: audit (`dos_check.py`, needs Playwright)
Keys: comma list; `Name*5` presses five times, `Name*hold900` holds for 900 ms. Games must expose `window.__game = DOS.run(...)` so the audit can count frames.
```python
#!/usr/bin/env python3
"""dos_check.py — static + live audit of a DOS FORGE game page.
usage: python3 dos_check.py game.html [--keys "Space,ArrowRight*30,Space"] [--shot out.png] [--wait 1500]
Exit code 1 if any FAIL."""
import argparse, json, pathlib, re, sys
from playwright.sync_api import sync_playwright

TRADEMARKS = ['MS-DOS', 'Microsoft', 'Sound Blaster', 'SoundBlaster', 'AdLib', 'Ad Lib', 'Roland', 'Gravis', 'Sierra',
              'LucasArts', 'SCUMM', 'id Software', 'Apogee', 'Epic MegaGames', 'DOS/4GW', 'Creative Labs', 'IBM PC', 'Tandy']

def static(html):
    out = []
    for tm in TRADEMARKS:
        if re.search(re.escape(tm), html, re.I): out.append(('WARN', f'trademark/brand "{tm}" appears - use generic labels in-game (PC Speaker, FM Synth card, Digital card)'))
    for src in re.findall(r'(?:src|href)=["\'](https?://[^"\']+)', html):
        if not re.match(r'https://fonts\.(googleapis|gstatic)\.com', src): out.append(('FAIL', f'external asset {src} - keep the game one self-contained file'))
    if 'image-rendering:pixelated' not in html.replace(' ', ''): out.append(('FAIL', 'canvas lacks image-rendering: pixelated'))
    if re.search(r'localStorage\.(get|set)Item', html.replace('DOS FORGE', '')) and 'dosforge:' not in html: out.append(('WARN', 'raw localStorage use - go through DOS.save/DOS.load (try/catch)'))
    if '<title>' not in html: out.append(('FAIL', 'missing <title>'))
    return out

JS_PROBE = """() => { const S = DOS.screens[0]; if (!S) return null; const used = new Set(S.fb); const P = S.getPalette();
  return { mode: S.mode, w: S.W, h: S.H, colorsAllowed: S.M.colors, gamut: S.M.gamut, used: [...used].sort((a,b)=>a-b),
           pal: P, frames: window.__game ? window.__game.frames : -1 }; }"""

def live(path, keys, shot, wait):
    out, errors = [], []
    with sync_playwright() as pw:
        b = pw.chromium.launch(); pg = b.new_page(viewport={'width': 1000, 'height': 900})
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        pg.goto(pathlib.Path(path).resolve().as_uri()); pg.wait_for_timeout(600)
        pg.click('canvas')
        for k in [k.strip() for k in keys.split(',') if k.strip()]:
            name, _, n = k.partition('*')
            if n.startswith('hold'):                       # e.g. ArrowRight*hold800
                pg.keyboard.down(name); pg.wait_for_timeout(int(n[4:] or 500)); pg.keyboard.up(name)
            else:
                for _ in range(int(n or 1)): pg.keyboard.press(name); pg.wait_for_timeout(40)
        pg.wait_for_timeout(wait)
        info = pg.evaluate(JS_PROBE)
        if shot: pg.locator('canvas').screenshot(path=shot)
        b.close()
    for e in errors: out.append(('FAIL', 'page error: ' + e[:200]))
    if not info: return out + [('FAIL', 'no DOS screen found - did the game call DOS.screen()?')], None
    if info['frames'] < 10: out.append(('FAIL', f"only {info['frames']} frames rendered - loop not running"))
    over = [i for i in info['used'] if i >= info['colorsAllowed']]
    if over: out.append(('FAIL', f"indices beyond the mode's {info['colorsAllowed']} colours: {over[:8]}"))
    six = lambda v: ((v >> 2) << 2 | (v >> 6)) == v
    bad = [i for i in info['used'] if info['gamut'] == 'vga18' and not all(six(c) for c in info['pal'][i])]
    if bad: out.append(('FAIL', f'palette entries off the 18-bit VGA DAC: {bad[:8]}'))
    if len(info['used']) < 2: out.append(('WARN', 'screen uses a single colour - blank frame?'))
    return out, info

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('html'); ap.add_argument('--keys', default='Space'); ap.add_argument('--shot'); ap.add_argument('--wait', type=int, default=1500)
    a = ap.parse_args(); html = pathlib.Path(a.html).read_text(encoding='utf-8')
    findings = static(html); lf, info = live(a.html, a.keys, a.shot, a.wait); findings += lf
    if info: print(f"mode={info['mode']} {info['w']}x{info['h']} colours used={len(info['used'])}/{info['colorsAllowed']} frames={info['frames']}")
    for lvl, msg in findings: print(f'{lvl}: {msg}')
    print('RESULT:', 'FAIL' if any(l == 'FAIL' for l, _ in findings) else 'PASS')
    sys.exit(1 if any(l == 'FAIL' for l, _ in findings) else 0)
```

## Appendix E: art converter (`dos_palette.py`, needs Pillow + numpy)
`python3 dos_palette.py art.png title --mode vga --dither bayer` writes `title.json` (load with `DOS.unpack(json)`; for VGA also `S.setPalette(pic.pal)`) and `title_preview.png`. `--size 32x32` for sprites, `--dither fs` for photos, `--reserve 16` keeps the EGA colours at 0-15 in VGA palettes. A full 320x200 image is about 85 KB of base64: fine for a few scenes, too much for dozens.
```python
#!/usr/bin/env python3
"""dos_palette.py — convert art to a DOS video mode's real palette and pixel grid.
usage: python3 dos_palette.py in.png out_prefix --mode ega [--size 320x200] [--dither bayer|fs|none] [--cga 1] [--reserve 16]
writes out_prefix.json ({w,h,pal,data} for DOS.unpack) and out_prefix_preview.png (4:3 corrected, 4x)."""
import argparse, base64, json
import numpy as np
from PIL import Image

RGBI = [(0,0,0),(0,0,170),(0,170,0),(0,170,170),(170,0,0),(170,0,170),(170,85,0),(170,170,170),
        (85,85,85),(85,85,255),(85,255,85),(85,255,255),(255,85,85),(255,85,255),(255,255,85),(255,255,255)]
EGA64 = [tuple(((i >> p) & 1) * 170 + ((i >> s) & 1) * 85 for p, s in ((2, 5), (1, 4), (0, 3))) for i in range(64)]
BAYER = np.array([[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]]) / 16 - 0.5
up6 = lambda v: (v << 2) | (v >> 4)

def cga(n, hi):
    sets = {0: [2, 4, 6], 1: [3, 5, 7], 5: [3, 4, 7]}[n]
    return [RGBI[0]] + [RGBI[c + (8 if hi else 0)] for c in sets]

def pick_palette(img, mode, args):
    if mode == 'cga': return cga(args.cga, True)
    if mode in ('ega', 'text'): return RGBI
    if mode == 'ega350':                                   # the 16 of the 64 EGA colours this image needs most
        px = np.asarray(img, np.float32).reshape(-1, 3); E = np.array(EGA64, np.float32)
        near = (((px[:, None] - E[None]) ** 2) * (3, 4, 2)).sum(-1).argmin(1)
        return [EGA64[i] for i in np.argsort(-np.bincount(near, minlength=64))[:16]]
    n = 256 - args.reserve if mode in ('vga', 'modex') else 16   # vga640 = 16 colours from the 18-bit DAC
    q = img.quantize(n, method=Image.Quantize.MEDIANCUT).getpalette()[:n * 3]
    pal = [tuple(up6(round(v * 63 / 255)) for v in q[i:i + 3]) for i in range(0, len(q), 3)]
    return ([RGBI[i] for i in range(16)] + pal)[:256] if args.reserve >= 16 else pal

def remap(arr, pal, dither):
    P = np.array(pal, dtype=np.float32); h, w, _ = arr.shape; a = arr.astype(np.float32)
    if dither == 'fs':
        out = np.zeros((h, w), np.int32)
        for y in range(h):
            for x in range(w):
                old = a[y, x]; i = int(np.argmin(((P - old) ** 2 * (3, 4, 2)).sum(1))); out[y, x] = i; e = old - P[i]
                if x + 1 < w: a[y, x + 1] += e * 7 / 16
                if y + 1 < h:
                    if x > 0: a[y + 1, x - 1] += e * 3 / 16
                    a[y + 1, x] += e * 5 / 16
                    if x + 1 < w: a[y + 1, x + 1] += e * 1 / 16
        return out
    if dither == 'bayer':
        spread = 255 / max(2, len(pal) ** (1 / 3))
        a = a + (np.tile(BAYER, (h // 4 + 1, w // 4 + 1))[:h, :w, None] * spread)
    d = ((a[:, :, None, :] - P[None, None]) ** 2 * np.array([3, 4, 2])).sum(-1)
    return d.argmin(-1)

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('src'); ap.add_argument('out')
    ap.add_argument('--mode', default='vga', choices=['cga', 'ega', 'ega350', 'vga', 'modex', 'vga640', 'text'])
    ap.add_argument('--size'); ap.add_argument('--dither', default='bayer', choices=['bayer', 'fs', 'none'])
    ap.add_argument('--cga', type=int, default=1); ap.add_argument('--reserve', type=int, default=16, help='VGA: keep the 16 EGA colours at 0-15 for UI text')
    a = ap.parse_args()
    dims = {'cga': (320, 200), 'ega': (320, 200), 'ega350': (640, 350), 'vga': (320, 200), 'modex': (320, 240), 'vga640': (640, 480), 'text': (320, 200)}
    w, h = map(int, a.size.split('x')) if a.size else dims[a.mode]
    img = Image.open(a.src).convert('RGB').resize((w, h), Image.LANCZOS)
    pal = pick_palette(img, a.mode, a)
    idx = remap(np.asarray(img), pal, a.dither).astype(np.uint8)
    json.dump({'w': w, 'h': h, 'mode': a.mode, 'pal': [list(c) for c in pal], 'data': base64.b64encode(idx.tobytes()).decode()}, open(a.out + '.json', 'w'))
    prev = Image.fromarray(np.array(pal, np.uint8)[idx]); full = dims[a.mode]
    prev.resize((w * 4, round(h * 4 * (full[0] * 3 / 4) / full[1])), Image.NEAREST).save(a.out + '_preview.png')
    print(f'{a.mode} {w}x{h}: {len(set(idx.flatten()))} of {len(pal)} palette colours used -> {a.out}.json, {a.out}_preview.png')
```

## Appendix F: native skeleton (`GAME.C`, Open Watcom, 16-bit)
```c
/* DOS FORGE native skeleton: VGA mode 13h, 16-bit real mode, Open Watcom.
   Build: wcl -bt=dos -ml -ox -fe=GAME.EXE GAME.C        Run: GAME.EXE   (GAME.EXE /T = self-test dump) */
#include <conio.h>
#include <dos.h>
#include <stdio.h>
#include <string.h>

#define W 320
#define H 200
static unsigned char far *vga = (unsigned char far *)MK_FP(0xA000, 0);
static unsigned char far back[64000U];                 /* draw here, copy once per vsync: no tearing */

static void set_mode(unsigned char m) { union REGS r; r.h.ah = 0; r.h.al = m; int86(0x10, &r, &r); }
static void set_pal(unsigned char i, unsigned char r, unsigned char g, unsigned char b) { /* 6-bit DAC */
  outp(0x3C8, i); outp(0x3C9, r); outp(0x3C9, g); outp(0x3C9, b); }
static void vsync(void) { while (inp(0x3DA) & 8); while (!(inp(0x3DA) & 8)); }
static void flip(void) { _fmemcpy(vga, back, 64000U); }
static void rect(int x, int y, int w, int h, unsigned char c) { int j;
  if (x < 0) { w += x; x = 0; } if (y < 0) { h += y; y = 0; } if (x + w > W) w = W - x; if (y + h > H) h = H - y;
  for (j = 0; j < h; j++) _fmemset(back + (unsigned)(y + j) * W + x, c, w); }
static void speaker(unsigned hz) {                /* PIT channel 2 -> speaker; hz 0 = off */
  if (!hz) { outp(0x61, inp(0x61) & 0xFC); return; }
  { unsigned d = (unsigned)(1193182L / hz); outp(0x43, 0xB6); outp(0x42, d & 0xFF); outp(0x42, d >> 8); outp(0x61, inp(0x61) | 3); } }

int main(int argc, char **argv) {
  int x = 150, y = 90, run = 1, frame = 0, i, selftest = argc > 1 && (argv[1][1] == 'T' || argv[1][1] == 't');
  set_mode(0x13);
  for (i = 0; i < 64; i++) set_pal(32 + i, i, i / 2, 63 - i);          /* custom ramp at 32-95 */
  while (run) {
    for (i = 0; i < H; i++) _fmemset(back + (unsigned)i * W, 32 + (i * 63 / H), W);  /* sky ramp */
    rect(0, 170, W, 30, 6); rect(x, y, 12, 12, 14);
    if (kbhit()) { int k = getch(); if (k == 0 || k == 0xE0) k = 256 + getch();
      if (k == 27) run = 0; if (k == 256 + 75) x -= 4; if (k == 256 + 77) x += 4; if (k == 256 + 72) y -= 4; if (k == 256 + 80) y += 4;
      speaker(440 + x); }
    else speaker(0);
    vsync(); flip();
    if (selftest && ++frame == 3) {                                     /* dump frame + palette for the host to inspect */
      FILE *f = fopen("FRAME.RAW", "wb"); int c;
      fwrite(back, 1, 64000U, f);
      for (c = 0; c < 256; c++) { unsigned char rgb[3]; outp(0x3C7, c); rgb[0] = inp(0x3C9); rgb[1] = inp(0x3C9); rgb[2] = inp(0x3C9); fwrite(rgb, 1, 3, f); }
      fclose(f); run = 0; }
  }
  speaker(0); set_mode(0x03);
  return 0;
}
```
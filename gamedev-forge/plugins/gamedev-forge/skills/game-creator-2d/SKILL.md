---
name: game-creator-2d
description: >
  Build polished NES/SNES/SEGA-style 2D web games — playable as a Claude Artifact, exportable as
  standalone HTML. Tile worlds, pixel-art sprites, parallax scrolling, per-level chiptune BGM + SFX,
  era palettes, screen transitions. Genres: platformer, top-down shooter/RPG, shmup, beat-em-up,
  puzzle. All assets hand-crafted via Canvas (no libraries). Every game includes looping background
  music, SFX, keyboard controls, score/health HUD, win/lose, and level splashes.
  ALWAYS trigger when user says: make a game, build a game, retro game, platformer, shooter, puzzle,
  RPG, shmup, beat-em-up, add levels, add enemies, add music, change art, tweak mechanics, NES/SNES/
  SEGA style, "something playable", "a game about X", or pastes game code to fix/extend/reskin.
  When in doubt, trigger — game building always benefits from this workflow.
---

# 2D Retro Web Game Creator

Build polished NES/SNES/SEGA-style 2D games playable as a Claude Artifact and exportable as a
standalone HTML file. Everything rendered via Canvas — no libraries, no external assets.
Full chiptune BGM (per level) + SFX are always included by default.

---

## Phase 1 — Understand the Request

Extract or confirm before writing code:

| Item | Default if unspecified |
|---|---|
| **Genre** | Platformer, top-down, shmup, beat-em-up, puzzle — ask if truly ambiguous |
| **Era target** | NES (8-bit, 4-color sprites, tight feel) / SNES (16-bit, more colors, Mode 7 tricks) / SEGA (fast, bold palette, momentum physics) — default: **SNES** |
| **Theme / setting** | Characters, enemies, world — one sentence is enough |
| **Win condition** | What does beating the game mean? |
| **Level count** | Default: **3 levels** (or 1 boss stage if requested) |

If the user gives enough context ("make a SNES-style platformer with 3 levels"), proceed directly —
state assumptions in one line and start building. For **iteration requests**, skip to Phase 8.

---

## Phase 2 — Retro Visual System

### Era Palette Rules

Pick the palette that matches the target era. Stick to it throughout the entire game.

| Era | Colors per sprite | Total on-screen | Feel |
|---|---|---|---|
| **NES** | 4 (1 transparent + 3) | ~25 | Hard edges, bright primaries, no gradients |
| **SNES** | 16 per sprite, 256 total | Rich but dithered | Softer outlines, subtle shading, Mode 7 floor |
| **SEGA MD** | 16 per sprite, 64 total | Bold, saturated | High contrast, fast animation, strong silhouettes |

**Always define a named palette constant at the top of the script:**
```js
const PAL = {
  // SNES-style example
  bg1:'#1a1a2e', bg2:'#16213e',       // sky layers
  tile1:'#4a4e69', tile2:'#2d2d44',   // platform tiles
  p1:'#e94560', p2:'#f5a623',         // player colors
  e1:'#0f3460', e2:'#533483',         // enemy colors
  ui:'#f0e6d3', uiDark:'#8b7355',     // HUD text
  accent:'#e94560', black:'#000', white:'#fff'
};
```

### Sprite Drawing — Pixel Art via Canvas

All sprites are drawn as **pixel art functions** using `ctx.fillRect` per pixel block.
Use a `SCALE` constant (default `2` for NES, `2–3` for SNES, `2` for SEGA) so art scales cleanly.

```js
const SCALE = 2;

function drawSprite(ctx, x, y, pixels, palette, flipX) {
  const cols = pixels[0].length;
  pixels.forEach((row, ry) => {
    row.forEach((col, rx) => {
      if (col === '_') return;
      ctx.fillStyle = palette[col] || col;
      const dx = flipX ? (cols - 1 - rx) : rx;
      ctx.fillRect(x + dx * SCALE, y + ry * SCALE, SCALE, SCALE);
    });
  });
}
```

**Always define sprites as pixel arrays:**
```js
const SPR = {
  player_idle: [
    ['_','p2','p2','_'],
    ['p1','p1','p1','p1'],
    ['_','p1','p1','_'],
    ['p1','_','_','p1'],
  ],
  player_run1: [ /* frame 2 */ ],
  player_run2: [ /* frame 3 */ ],
};
```

### Animation System

Use a global frame counter to cycle sprite frames:
```js
let frameCount = 0; // increment every game loop tick

function animFrame(frames, fps = 8) {
  return frames[Math.floor(frameCount / (60 / fps)) % frames.length];
}
// Usage: drawSprite(ctx, e.x, e.y, animFrame([SPR.run1, SPR.run2]), PAL, e.facingLeft);
```

Always animate: player walk (2–4 frames), enemy movement (2 frames min), hit flash (white override).

### Hit Flash
```js
// When entity.hitFlash > 0, override all sprite colors with white
function getSpriteColor(key, hitFlash) {
  return hitFlash > 0 ? '#fff' : PAL[key];
}
```

### Parallax Backgrounds

For platformers and shmups, use 2–3 layers:
```js
const bgLayers = [
  { drawFn: drawFarBg,  speed: 0.2 },
  { drawFn: drawMidBg, speed: 0.5 },
];
function drawParallax(camX) {
  bgLayers.forEach(l => {
    const offset = (camX * l.speed) % W;
    // draw twice side-by-side to fill screen during scroll
    l.drawFn(-offset);
    l.drawFn(W - offset);
  });
}
```

### Tile Map System

```js
const T = { AIR:0, SOLID:1, PLATFORM:2, SPIKE:3, LADDER:4,
            COIN:6, ITEM:7, SPAWN:8, DOOR:9 };

const TW = 16, TH = 16; // tile size in base pixels (multiply by SCALE for canvas)

function tileAt(map, tx, ty) {
  return map[ty] ? map[ty][tx] || T.AIR : T.AIR;
}

function isSolid(map, tx, ty) {
  return tileAt(map, tx, ty) === T.SOLID;
}

// Tile-based collision: convert pixel coords to tile coords
function tileCoord(px) { return Math.floor(px / (TW * SCALE)); }
```

---

## Phase 3 — Audio System (Always Required)

### Background Music — Per-Level Chiptune (MANDATORY)

Every game **must** have looping chiptune BGM. Each level gets its own theme.
Music plays on gameplay start, pauses with P, stops on game over / win.
**M** toggles mute. Show mute status in HUD.

```js
const MUSIC = [
  // Level 1: bright, upbeat major
  { root:261.63, mel:[0,4,7,12,7,4,0,7],   bass:[0,0,7,4], bpm:155, wave:'square'   },
  // Level 2: minor, urgent
  { root:220,    mel:[0,3,7,10,12,7,3,0],  bass:[0,7,3,7], bpm:172, wave:'square'   },
  // Level 3: dark descending
  { root:196,    mel:[0,3,6,10,12,6,3,0],  bass:[0,0,6,3], bpm:148, wave:'sawtooth' },
  // Boss: ominous, fast
  { root:130.81, mel:[0,3,7,10,14,10,7,3], bass:[0,0,10,7],bpm:200, wave:'sawtooth' },
];

let mBeat=0, mTimer=null, mMuted=false, mNodes=[];
let aCtx=null;
function getACtx(){if(!aCtx)aCtx=new(window.AudioContext||window.webkitAudioContext)();return aCtx;}

function st(base,n){return base*Math.pow(2,n/12);}

function playOsc(f,wave,gain,dur){
  try{
    const a=getACtx(),o=a.createOscillator(),g=a.createGain();
    o.type=wave; o.frequency.setValueAtTime(f,a.currentTime);
    g.gain.setValueAtTime(gain,a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,a.currentTime+dur);
    o.connect(g); g.connect(a.destination);
    o.start(); o.stop(a.currentTime+dur); mNodes.push(o);
  }catch(e){}
}

function playKick(){
  try{
    const a=getACtx(),o=a.createOscillator(),g=a.createGain();
    o.type='sine'; o.frequency.setValueAtTime(110,a.currentTime);
    o.frequency.exponentialRampToValueAtTime(40,a.currentTime+.06);
    g.gain.setValueAtTime(.2,a.currentTime);
    g.gain.exponentialRampToValueAtTime(.001,a.currentTime+.08);
    o.connect(g); g.connect(a.destination);
    o.start(); o.stop(a.currentTime+.08); mNodes.push(o);
  }catch(e){}
}

function musicTick(i){
  if(mMuted||phase!=='playing')return;
  const th=MUSIC[Math.min(i,MUSIC.length-1)];
  const ms=60000/th.bpm;
  playOsc(st(th.root*2, th.mel[mBeat%th.mel.length]), th.wave, .07, ms*.0009);
  if(mBeat%2===0) playOsc(st(th.root, th.bass[Math.floor(mBeat/2)%th.bass.length]), 'triangle', .10, ms*.0018);
  if(mBeat%4===0||mBeat%4===2) playKick();
  mBeat=(mBeat+1)%16;
  mNodes=mNodes.filter(n=>{try{return n.context.state!=='closed';}catch(e){return false;}});
  mTimer=setTimeout(()=>musicTick(i),ms);
}

function startMusic(i){stopMusic();mBeat=0;musicTick(i);}
function stopMusic(){clearTimeout(mTimer);mNodes.forEach(n=>{try{n.stop();}catch(e){}});mNodes=[];}
```

### SFX Reference

| Sound | Pattern |
|---|---|
| Jump | 400→800 Hz, square, 0.10s |
| Land | 150→80 Hz, sine, 0.07s |
| Shoot | 900→300 Hz, square, 0.07s |
| Enemy hit | 200→100 Hz, sawtooth, 0.12s |
| Player hurt | 300→150 Hz, sawtooth, 0.15s |
| Coin collect | 660 Hz + 990 Hz sine, 0.08s each, 80ms apart |
| Power-up | 440→880→1320 Hz triangle, 0.1s each |
| Level clear | 523→659→784→1047 Hz sine, 0.18s each |
| Game over | 380→280→190→140 Hz sawtooth, 0.22s each |
| Boss roar | 80→40 Hz sawtooth, 0.4s, gain 0.3 |
| Explosion | white noise via buffer, 0.3s |

---

## Phase 4 — Code Architecture

Every game is a **single self-contained HTML file**. Structure:

```
game.html
├── <style>      — Full-screen canvas layout, crisp rendering
├── <canvas>     — id="gc", native resolution set in JS
├── <script>
│   ├── CONFIG       — SCALE, BASE_W, BASE_H, FPS, TW, TH
│   ├── PALETTE      — PAL{} named color object
│   ├── SPRITES      — SPR{} pixel arrays + drawSprite()
│   ├── TILESET      — T{} tile legend, drawTile(), isSolid()
│   ├── AUDIO        — AudioContext, SFX functions, music engine
│   ├── LEVELS       — Array of { map[][], enemies[], music:idx, name, bg }
│   ├── ENTITIES     — Player, Enemy, Bullet, Pickup — state machines
│   ├── PHYSICS      — Gravity, tile collision response, platform logic
│   ├── ENGINE       — rAF loop, update(), render(), camera, screen shake
│   ├── INPUT        — Key map (WASD + arrows + ZX + Space)
│   ├── UI           — HUD, menus, splash, transitions, floating score text
│   └── INIT         — Bootstrap, level load, full reset
```

### Canvas Setup (always use this pattern)
```js
const cv = document.getElementById('gc');
const ctx = cv.getContext('2d');
const BASE_W = 320, BASE_H = 224, SCALE = 2;
cv.width = BASE_W; cv.height = BASE_H;
cv.style.width  = BASE_W * SCALE + 'px';
cv.style.height = BASE_H * SCALE + 'px';
ctx.imageSmoothingEnabled = false; // CRITICAL — always set
```

### Camera
```js
const cam = { x:0, y:0, shake:0 };

function updateCamera(levelPixelW, levelPixelH) {
  cam.x = Math.max(0, Math.min(player.x - BASE_W/2, levelPixelW - BASE_W));
  cam.y = Math.max(0, Math.min(player.y - BASE_H*0.55, levelPixelH - BASE_H));
}

function applyCamera() {
  const sx = cam.shake > 0 ? (Math.random()-.5)*4 : 0;
  const sy = cam.shake > 0 ? (Math.random()-.5)*4 : 0;
  if(cam.shake > 0) cam.shake--;
  ctx.save();
  ctx.translate(Math.round(-cam.x + sx), Math.round(-cam.y + sy));
}
// After drawing world: ctx.restore(); then draw HUD
```

### Screen Transitions
```js
let fadeAlpha = 1, fadingIn = true;

function updateFade() {
  if(fadingIn) { fadeAlpha = Math.max(0, fadeAlpha - .05); }
  else         { fadeAlpha = Math.min(1, fadeAlpha + .05); }
}

function drawFade() {
  if(fadeAlpha <= 0) return;
  ctx.fillStyle = `rgba(0,0,0,${fadeAlpha})`;
  ctx.fillRect(0, 0, BASE_W, BASE_H);
}
// On level complete: fadingIn=false → when fadeAlpha===1 → load next level → fadingIn=true
```

### Controls (always support both schemes + show in HUD)
| Action | Keys |
|---|---|
| Move | WASD + Arrow keys |
| Jump / Confirm | Space + Z |
| Attack / Shoot | X + J |
| Pause | P + Escape |
| Mute music | M |

---

## Phase 5 — Genre Mechanics

See `references/genre-patterns.md` for full code. Summary:

**Platformer (NES/SNES/SEGA)**
- Variable jump height: release Space early to cut vertical velocity
- Coyote time (6 frames) + jump buffering (8 frames)
- One-way platforms: hold ↓ + jump to drop through
- SEGA feel: higher top speed, faster accel, spin-dash charge

**Side-Scroller (Contra / Castlevania / Megaman X style)**
- Lead-ahead smooth camera: centre at ~38% from left, eases to player
- 3-layer parallax: far sky (~0.15×), mid (~0.40×), near tiles (1.0×)
- Run-and-gun: 8-direction aim independent of movement
- Castlevania variant: whip arc hitbox (timed, not a bullet), sub-weapons
- Megaman X variant: dash, wall-slide, wall-jump
- Region-based enemy spawn triggers keyed to camera X
- Checkpoints + mid-level boss gate (lock camera, seal exit, swap music)

**Top-Down Shooter**
- 8-direction movement with diagonal normalization
- Bullet pool (64 pre-allocated slots)
- Enemy FSM: idle → patrol → alert → chase → attack

**Overhead RPG (Final Fantasy / Chrono Trigger / Secret of Mana style)**
- Three map layers: overworld → town → dungeon with transitions + per-map music
- Tile-locked grid movement with smooth visual lerp between tiles
- NPC dialogue: typewriter effect, press A to advance
- Shop system: item list, cursor, gold
- Turn-based combat: party vs enemy group, ATB or menu-select, enemy AI turn
- Action RPG variant: real-time swing, charge attack, knockback arc (Zelda/Mana feel)
- XP + level-up: exponential curve, stat gains, full HP restore
- Inventory: 4×4 grid, item use, qty tracking
- Overworld map: location icons, "Press Z to Enter" tooltip
- Status effects: poison, burn, frozen, regen — tick timers, HUD indicators

**Shmup (Shoot-em-up)**
- Auto-scroll (vertical or horizontal)
- Formation patterns: V-shape, diamond, spiral
- Power system: P/B/S pickups; bomb = screen clear

**Beat-em-up (SNES/SEGA style)**
- Pseudo-3D: Y axis = depth; player and enemies share a ground plane
- Combo system: jab → cross → uppercut; grab → throw

**Puzzle**
- 2D array grid, JSON undo stack, smooth tile slide via lerp
- Win check after every move; move counter + timer in HUD

---

## Phase 6 — Retro Polish (Always Apply)

These details make the difference between a generic browser game and authentic retro feel:

| Detail | Implementation |
|---|---|
| **NES flicker** (invincibility) | Toggle entity visibility every 4 frames — hard on/off, not fade |
| **Screen shake** | `cam.shake = 14` on big hits; random ±2px translate for N frames |
| **Squash & stretch** | Scale sprite Y on jump takeoff (0.7×) and landing (1.3×) for 4 frames |
| **Death animation** | 4-frame "pop" sprite before removing entity; never instant-delete |
| **Floating score** | On kill: spawn text at enemy position, float up +1px/frame, fade over 40 frames |
| **Item bob** | `y + Math.sin(frameCount * 0.08) * 2 * SCALE` for all pickups |
| **Pixel text** | `ctx.font = (8*SCALE)+'px monospace'; imageSmoothingEnabled=false` |
| **Tile shading** | Draw a 1px-dark border on tile edges for depth |
| **Enemy alert** | Show `!` sprite above enemy when it spots player (12-frame display) |
| **Combo display** | Show hit counter ("x3 HIT!") on multi-kills, styled in HUD accent color |

---

## Phase 7 — Artifact + Export Delivery

**Step 1 — Artifact**: Output the full single-file game as an HTML Artifact.
- `imageSmoothingEnabled = false` always set
- Zero external dependencies
- CSS scales canvas to fill Artifact panel

**Step 2 — Export offer**: After Artifact, offer:
> "Want the standalone `.html` file to run locally or host anywhere?"

If yes: save to `/mnt/user-data/outputs/<game-name>.html` and call `present_files`.

---

## Phase 8 — Iteration

1. **Classify the change**: mechanic / level / art+palette / audio / polish / bug fix
2. **State what changed** before code: "Adding: coyote time (PHYSICS), new slime sprite (SPRITES), level 3 tile map (LEVELS)."
3. **Re-deliver** full Artifact (always complete — no partial diffs)
4. **Offer export** as before

---

## Quality Checklist (self-review before every delivery)

- [ ] `imageSmoothingEnabled = false` — pixels are always crisp
- [ ] `PAL{}` palette constant defined and used everywhere (no raw hex in draw calls)
- [ ] Background music plays on game start, loops, pauses with P, mutes with M
- [ ] Music indicator visible in HUD
- [ ] All sprites use pixel array + `drawSprite()` pattern
- [ ] Player has at least 2-frame walk animation
- [ ] Hit flash (white) on damage for all entities
- [ ] NES-style flicker during invincibility frames
- [ ] Death animation before entity removal
- [ ] Floating score numbers on enemy kills
- [ ] Full game loop: menu → splash → gameplay → win/lose → restart
- [ ] HUD: score, lives/health (pixel art style), level name, mute status
- [ ] Camera clamped to level bounds
- [ ] Screen transition (fade) between levels
- [ ] Controls shown on menu and in HUD

---

## Tone When Responding

- Lead with one sentence: genre + era + key assumption.
- After Artifact: 2–3 line play guide (goal + controls).
- After iteration: bullet list of what changed.
- Let the game speak — keep commentary tight.

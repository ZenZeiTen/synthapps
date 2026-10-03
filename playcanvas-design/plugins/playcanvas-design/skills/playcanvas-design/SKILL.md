---
name: playcanvas-design
description: Make visual deliverables with PlayCanvas, either authored in the live Editor through the PlayCanvas MCP or written as code scenes. Deliverables include animated videos (MP4/WebM/GIF/WebP), product/hero turntables, 8-direction sprite sheets with alpha and PlayCanvas atlas data, icons and thumbnails, GLB exports of composed assets, and scripted gameplay or trailer captures. Rendering is deterministic, frame-exact and headless. Use this whenever the user wants a PlayCanvas scene turned into video, animation, frames, sprites, a turntable, a GIF, a GLB or other game assets, or asks to design, animate, light or render something in PlayCanvas, even if they don't say "render". Pairs with the PlayCanvas Editor MCP server (@playcanvas/editor-mcp-server) for Editor projects.
---

# playcanvas-design

A method for turning PlayCanvas scenes into finished media and game assets. It was built
and measured on 2026-10-02 against engine 2.23.0 (code scenes) and 2.22.6 (an Editor
static build of a small rolling-ball physics demo), Chrome 154, Blender 5.2.2 and Pillow 12.2.

The core is one renderer that works for both authoring routes:

```
author (Editor via MCP  |  code scene)  →  render.mjs (headless Chrome, frame-exact PNGs)
   →  review.py (blank/frozen/missing check + contact sheet)
   →  encode.py (MP4/WebM via ffmpeg or Blender; GIF/WebP/APNG via Pillow)
   |  spritesheet.py (atlas PNG + generic JSON + PlayCanvas atlas frames)
   |  __renderSave (GLB export via pc.GltfExporter, any file)
```

Skill path below is `<skill>` = `~/.claude/skills/playcanvas-design`.

## Why the renderer is built this way

Screen recording a live app gives dropped frames, wall-clock jitter and a different result
every run. `render.mjs` serves the page, injects `recorder.js` before every other script,
and holds back the engine's own `requestAnimationFrame` loop. It then calls `app.tick()`
with fake timestamps exactly `1000/fps` ms apart, so every update gets `dt = 1/fps`. After
each tick it saves the canvas as a PNG. The same scene always gives byte-identical frames
(measured: 90/90). Frame k shows scene time `k/fps` exactly (frame 18 at 30 fps = 0.600 s).
Physics, anim components, particles and `dt`-driven scripts all follow, because they all
run inside `app.update(dt)`.

## Workflow

### 1. Pick the route

| The user has / wants | Route |
|---|---|
| An Editor project (they mention the Editor, a scene id, entities they built) | **Editor route**: author with MCP tools, then `download_build` (static) and render the unzipped build |
| A one-off clip, motion graphic, icon set, or sprites from a GLB | **Code route**: copy `templates/code-scene` or `templates/turntable` and render it |
| Sprites/turntable of an Editor asset | Download the asset (`download_asset`) or a GLB export (step 5), then use the turntable template |

Read `references/editor-mcp.md` before using the MCP tools: connection prerequisites, what
verifies reliably, and cleanup rules. Read `references/look-and-motion.md` before designing
lighting, camera moves or timing; it is the difference between "renders" and "looks good".

### 2. Author

**Code route.** Copy the template folder into the project or a scratch folder and edit
`buildScene()` in `scene.mjs`. The engine import is `/__engine/playcanvas.mjs`, which the
render server provides (see Files below for where it looks: `npm i playcanvas` in the
scene folder is enough). Animate with `timeline.mjs`:

```js
tl.position(e, [[0, [0, 0.5, 0]], [0.6, [0, 1.6, 0], 'outCubic'], [1.2, [0, 0.5, 0], 'inQuad']]);
tl.euler(e, ...); tl.scale(e, ...); tl.color(material, 'diffuse', ...); tl.value(v => ..., keys); tl.call(t, fn);
```

A key is `[seconds, value, easeIntoThisKey]`. `tl.duration` is the last key time, and the
template copies it to `window.__duration` for `--duration auto`. Every track takes
`{ offset, period }`: use `offset: i * 0.1` to stagger, and `period: 1` to repeat a 1 s cycle
inside a longer loop. Set the shot length with `tl.setDuration(4)` when repeating tracks
make `tl.duration` short. `sample(keys, t)` is exported for hand-made tracks.

Put async loads (GLB via `loadContainer(url)`) inside `buildScene()`; the template exports
it as `window.__renderReady`, and the recorder waits for it before frame 0.

The template also:
- sets `window.pc`, so hooks can use `pc.*`;
- names its materials, so the names survive GLB export;
- takes a `parent` in `primitive()`, so you can group what you'll export;
- has `exportGlb(entity, file)`, a no-op in preview.

**Editor route.** Build the scene with `create_entities` / `add_components` /
`create_assets` (material) / `set_material_properties`. To animate without writing a new
script, upload `editor-scripts/keyframe-animator.js`:

1. `create_assets` with type script, filename `keyframe-animator.js`, text = the file.
2. `script_parse`.
3. `attach_script` with scriptName `keyframeAnimator` and attributes `{ timeline: '<json>' }`.

The timeline JSON uses the same keys, with props `position`/`euler`/`scale`/`enabled`/
`material.<field>`/`<component>.<field>`. Its `lookAt` attribute (an entity) turns it into
a camera rig. The key format and every prop are documented in the file header. Verify the
look with `launch_start` + `capture_runtime` before rendering.

### 3. Render

```bash
node <skill>/scripts/render.mjs --root <folder> --out <frames> --width 1920 --height 1080 --fps 30 --duration 4
```

| Flag | Meaning |
|---|---|
| `--frames N` / `--duration S` | length (frames = round(S × fps)) |
| `--duration auto` | read `window.__duration` (seconds) from the page once it is ready |
| `--extra 1` | render one frame past the duration. For a loop, frame N must equal frame 0 (review.py `--loop` checks it; encode.py drops extra frames) |
| `--alpha` | transparent background. The camera clear colour also needs alpha 0 (templates do this; Editor: set the camera clearColor alpha to 0) |
| `--page "index.html?a=b"` | page plus query (the turntable is configured this way) |
| `--warmup N` | ticks to run before frame 0 is captured (settle physics, fill particle systems) |
| `--hook hook.js` | per-frame script: `window.__renderHook = async (k, seconds, app, info) => {}`, called **before** tick k, plus once more after the last tick with `info.final = true` (to read the final frame). It has `__renderKey('down'\|'up', key)` for keyboard input, `__renderLog(msg)` and `__renderSave(name, data)` |
| `--serve` | preview only, at a printed URL, without capture. Open it in any browser, or the host's built-in browser if it has one |
| `--device webgl2` | default. WebGPU canvases are not read back reliably |
| `--headed` | show the Chrome window (debugging) |

Editor static builds need no edits. The recorder traps `window.CONTEXT_OPTIONS` to force
webgl2 and preserveDrawingBuffer (plus alpha with `--alpha`), and patches `config.json`.
Page errors and `console.warn/error` print as `[page] ...`. `manifest.json` records
fps, size and ok.

Speed measured on the template scene (laptop RTX 4050): about 2.4 s to start, then about
29 frames/s at 1920×1080 (300 frames in 12.8 s). Heavy scenes are slower; render 30 frames
first and extrapolate before a long job.

### 4. Check the frames (every time, before encoding)

```bash
python <skill>/scripts/review.py <frames> --out contact.png
```

It reports missing frames (against the manifest), blank frames, frozen runs and motion per
frame, and exits 1 on missing or all-blank frames. For loops, render with `--extra 1` and
add `--loop`. It then proves frame N == frame 0 and compares the wrap step with normal steps
(exit 1 on a pop or hold). Use `--sprite` for index-only labels. **Look at the contact sheet** (Read the
PNG). Then confirm one number from the scene: log a position or time at a key frame through
`__renderLog` and compare it with the key you authored. A frozen run usually means a pose was
set after the system that uses it (see `references/measured-facts.md` #9) or symmetric
animation.

### 5. Deliver

- Video: `python <skill>/scripts/encode.py <frames> out.mp4 [--crf 18] [--scale 0.5]`. GIF,
  WebP and APNG get cumulative-rounded frame delays and are read back. The printed
  duration must match frames/fps. GIF stores centiseconds, so a naive 33 ms delay plays
  10% fast. Output format is
  `.mp4`/`.mov`/`.mkv`/`.webm`. It uses ffmpeg when on PATH, otherwise Blender's FFmpeg in
  background mode (about 3.5 s for 90 frames at 640×360). For autoplaying web loops use
  `.webp --quality 85` (small, alpha) or `.gif --scale 0.5` (big, 256 colours).
- Sprites: `python <skill>/scripts/spritesheet.py <frames> sheet.png --trim [--names S,SW,W,NW,N,NE,E,SE --per-row K] [--pow2]`.
  `--trim` crops all frames to one shared box, so the pivot stays registered.
  `sheet.playcanvas.json` holds PlayCanvas atlas `frames` (rect y counted from the **bottom**;
  verified by rendering the sheet back).
  - Editor: upload the PNG as `textureatlas`, then `modify_sprite_asset {frames}`.
  - Code: convert arrays to vectors first, or the sprite renders blank:
    `rect: new pc.Vec4(...f.rect), pivot: new pc.Vec2(...f.pivot), border: new pc.Vec4(...f.border)`.
  - `--names` takes one name per frame, or row names with `--per-row`. `--cell WxH --fit`
    gives fixed cells.
- GLB: `await __renderSave('x.glb', await new pc.GltfExporter().build(entity, { maxTextureSize: 1024 }))`.
  - Code scenes: call `exportGlb(group, 'x.glb')` in `buildScene()` before the timeline moves
    anything (rest pose).
  - Editor builds: from a hook (`pc` is global).
  - `__renderSave` exists only while capturing; the template's helper guards it.
  - The file is rewritten on every render into that `--out`.
  - A demo-level export re-imported in Blender with all 9 meshes, 3 materials and entity
    names intact.
- Show the user the result: send the MP4/GIF/sheet with the host's file-send tool if it has
  one, otherwise give the paths. Say what was measured
  (frame count, duration, size) and what was only looked at.

Game-asset recipes (8-dir sprites, icons, turntables, trailer capture, Blender → PlayCanvas)
are in `references/game-assets.md`.

## Rules that keep renders honest

- **Scripts must use `dt`.** Anything driven by `Date.now()`/`performance.now()` or by
  per-frame impulses that ignore `dt` renders differently from the live game. Measured: the
  demo project's movement script adds a fixed impulse every frame, so the ball is slower at
  30 fps than live at about 165 fps. Fix the script or render at the live rate; don't hide it.
- **Frame 0 runs `dt = 0`** (the engine's first-tick rule). A hook at k sees the state
  *before* tick k; log at k+1 to read frame k.
- **Never leave Editor-project side effects.** Download builds create build jobs. Delete them
  (`delete_build`), and remove temporary scripts and entities, when done. If the Editor stops
  answering, tell the user what is left to clean up.
- **Measure one thing per render.** At least one logged value at a known key, plus
  review.py, before calling the output done. See `references/measured-facts.md` for the facts
  this skill rests on, and re-measure when engine, Chrome or Blender versions change.

## Files

- `scripts/render.mjs`: server, Chrome launcher and frame sink (zero dependencies, Node 22+).
  It looks for `playcanvas/build/playcanvas.mjs` at `--engine`, then `$PLAYCANVAS_ENGINE`,
  then in `node_modules` folders walking up from the scene folder, then from the current
  directory, then from the skill folder. If none is found, run `npm i playcanvas` in the
  scene folder.
- `scripts/recorder.js`: injected clock driver, key/log/save helpers
- `scripts/encode.py`, `scripts/spritesheet.py`, `scripts/review.py`: Python 3 + Pillow
- `templates/code-scene/`: lit, shadowed, tone-mapped starter with `timeline.mjs`
- `templates/turntable/`: N-direction × M-frame sprite/turntable rig for any GLB, plays all clips
- `editor-scripts/keyframe-animator.js`: the timeline for Editor projects (classic script)
- `references/`: editor-mcp, look-and-motion, game-assets, measured-facts

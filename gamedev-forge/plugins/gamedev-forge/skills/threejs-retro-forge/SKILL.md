---
name: threejs-retro-forge
description: Design and build retro-fused 3D web experiences in three.js — PS1/N64/arcade-era 3D looks, CRT/VHS signal chains, and 80s/90s/2000s web aesthetics (Web 1.0, Y2K chrome, Frutiger Aero gloss, vaporwave, demoscene) — recombined into new styles rather than copied. Ships a constraint-budget design system, an era matrix, a cross-era fusion protocol, verified three.js r18x / TSL / WebGPU API notes, and working GLSL + TSL modules (vertex jitter, affine warp, ordered dither, palette quantize, CRT mask, pixelation). ALWAYS trigger when the user wants to build a three.js / WebGL / WebGPU scene, game, or creative site; wants a retro, pixelated, lo-fi, PSX, N64, CRT, VHS, Y2K, vaporwave, or nostalgic look; wants stylized/NPR shaders; or says "retro game in the browser", "make it look old", "PS1 style", "CRT effect", "creative coding", "bikin game 3D", "efek retro". Prefer this over generic frontend skills whenever three.js or a period aesthetic is involved.
---

# Three.js Retro Forge

Build period-accurate and period-*fused* real-time web graphics. The output is either a
playable/browsable artifact or a design spec that another agent can implement.

## The core idea: aesthetics are downstream of constraint budgets

Nobody in 1997 chose "the PS1 look." They chose it the way you choose weather. Texture
warping, vertex jitter, banded skies, tiled backgrounds, `<table>` layouts — every one of
those is a *side effect of a resource limit*, not a decoration.

That is the leverage. **Do not assemble a checklist of retro decorations.** Instead pick a
constraint budget, hold it honestly, and let the look fall out. A held budget produces
coherence for free — every surface in the scene agrees, because they are all obeying the
same limit. A decoration checklist produces the uncanny "asset-store retro" look, where a
4K normal-mapped rock sits next to a 64px dithered wall.

And because budgets are *numbers*, they can be blended. Blending two eras' budgets yields
looks that never existed, which is the point: nobody shipped Frutiger Aero gloss on
affine-warped PS1 geometry in 2006, because gloss wasn't affordable on that silicon. You
can. See `references/fusion-protocol.md`.

## Workflow

1. **Read the brief for register, not just topic.** A portfolio site, a horror game, and a
   product landing page want different amounts of hostility from the same era. Retro is
   loud; decide how loud before choosing anything.
2. **Set the Constraint Budget** (six dials, below). Write the numbers down explicitly in
   your response — they are the spec.
3. **If fusing eras, run the fusion protocol** — `references/fusion-protocol.md`. Do not
   improvise a blend; unowned dials are what make fusions read as mistakes.
4. **Pick the renderer and pipeline** — `references/threejs-r18x.md`. Read this before
   writing any three.js code. Training data on three.js is reliably stale: `EffectComposer`
   → `RenderPipeline`, `Clock` → `Timer`, TSL renames, and WebGPU import paths have all
   moved recently.
5. **Check what three.js already ships before writing a shader.** r185 ships a complete PS1
   pass (`retroPass` — vertex snapping + affine warp + low-res nearest target) and most of the
   CRT chain (`barrelUV`, `scanlines`, `vignette`, `colorBleeding`, `barrelMask`), plus
   `posterize`, `pixelationPass`, `rgbShift`, `dotScreen`, `film`. Inventory and exact import
   paths: `references/threejs-r18x.md`. Reimplementing these wastes effort and drifts from
   maintained code.
6. **Implement the gaps**, composing from `assets/retro-glsl.js` (WebGLRenderer — all seven
   programs compile and link on a real driver) or `assets/retro-tsl.js` (WebGPURenderer/TSL —
   node graph verified against r185). Effect selection and gotchas:
   `references/shader-cookbook.md`.
7. **Run the gates** — perf and accessibility, below. Non-negotiable. A CRT flicker effect
   that ships without a reduced-motion path is a defect, not a style.

## The Constraint Budget

Six dials. Set all six. Everything else in the scene is derived.

### 1. `res` — internal render resolution

The single most decisive dial. Everything else is calibrated against it.

| Value | Feel | Notes |
|---|---|---|
| 256×224 / 320×240 | 5th-gen console, arcade | Vertex jitter becomes *visible motion*, not a subtlety |
| 320×180 / 480×270 | modern lo-fi, "pixel 3D" | Readable text still possible at 2 lines |
| 640×360 / 640×480 | Dreamcast/early-PC, Y2K | Jitter reads as instability, not style |
| native | Frutiger Aero, Vectordelia | Retro must come from palette/shape, not pixels |

Rule: render to an offscreen target at `res`, upscale **nearest**, prefer **integer scale**.
Non-integer upscaling of a pixel grid produces uneven pixel widths — the single most common
tell of fake-retro. If the viewport isn't an integer multiple, letterbox rather than
stretch.

### 2. `color` — depth, palette, dither

| Value | Levels/channel | Historic anchor |
|---|---|---|
| RGB555 + 4×4 ordered dither | 32 | PS1 framebuffer (its actual hardware behaviour) |
| RGB565 | 32/64/32 | Many 90s handhelds/PC modes |
| Fixed palette, 4–64 entries | n/a | Game Boy, C64, CGA/EGA, PICO-8, web-safe 216 |
| 8-bit/channel, no dither | 256 | Y2K / Aero / anything post-2000 |

Palette tables: `references/era-matrix.md`. Dither and quantize belong to the *virtual
device* — apply them at `res`, before upscaling. Getting this on the wrong side of the
upscale is the second most common tell.

### 3. `vertex` — position precision

| Value | Effect |
|---|---|
| snap to `res` pixel grid | PS1 wobble. Vertices round to integer screen pixels; small camera moves make them jump |
| snap to a coarser grid (e.g. `res`/2) | exaggerated, stylized wobble |
| subpixel (off) | N64, Saturn, Dreamcast, everything modern |

Snap in the **vertex stage after projection**, in NDC, then restore `w`. Guard `w <= 0`
(vertices behind the camera) or geometry explodes across the screen.

### 4. `surface` — texel density, filtering, perspective

| Dial | Options |
|---|---|
| texel density | 16–64 px per game-metre (PS1) → 256+ (modern) |
| filtering | nearest (PS1/arcade) · bilinear · 3-point (N64's distinctive soft-but-not-blurry look) |
| perspective correction | **off** = affine warp (PS1, Saturn) · **on** = N64 and everything later |

Affine warp is the loudest single PS1 signature and the fastest way to date a scene to
1994–1999. It is also the one most often faked wrong — see the cookbook; `noperspective`
does **not** exist in GLSL ES, so the HLSL/Unity approach from most tutorials will not
compile in WebGL.

### 5. `light` — lighting model

| Value | Reads as |
|---|---|
| vertex-lit (Gouraud), no specular | PS1/N64. Lighting lives in the *vertex colours*; bake shadows into geometry |
| quantized lambert (2–4 bands) | cel/toon, arcade, Dreamcast |
| lambert + unclamped specular blob | Y2K chrome |
| PBR + bloom + high-key gradients | Frutiger Aero |

Vertex-lit + baked vertex-colour shadows is not just cheaper — it is *why* those games look
like that. Per-pixel lighting on low-poly geometry reads as modern-indie, not as period.

### 6. `signal` — the display chain

| Value | Components |
|---|---|
| none | direct RGB, LCD-clean |
| composite | chroma bleed, dot crawl, slight horizontal blur, no mask |
| RGB monitor | mild scanlines, sharp, no bleed |
| CRT TV | barrel warp + scanlines + shadow/aperture mask + halation + vignette |
| VHS | composite + tracking noise + head-switch tear at the bottom + chroma lag |

Signal is applied at **output** resolution, after upscaling — it belongs to the physical
display, not the virtual device. Phosphor masks need ≥3× output scale to resolve; below
that they produce moiré and a screen-door look rather than a CRT look, so on low-DPI
displays prefer scanlines + halation and skip the mask.

## Pipeline order (get this wrong and nothing else matters)

```
1. Render scene → offscreen RT at `res`      (nearest filter, no MSAA, HalfFloat)
   ├─ vertex stage: snap, affine UV setup, vertex lighting
   └─ fragment stage: texture, vertex-colour modulate, hard fog
2. Tone map + encode to display space         (dither must happen in display space)
3. Dither + palette quantize                  ← AT `res`, virtual-device side
4. Upscale to output                          (nearest, integer scale, letterbox remainder)
5. Signal chain                               ← AT output res, physical-display side
   (barrel → scanlines → mask → halation → noise → vignette)
6. Present
```

Steps 3 and 5 are on opposite sides of the upscale for a physical reason: the console
dithered into its own framebuffer; the television then imposed its own structure on top of
the already-dithered image. Collapsing them into one pass is the difference between "CRT"
and "CRT sticker."

## Hard gates

Run these before declaring anything done.

**Accessibility**
- No full-screen luminance flash faster than 3 Hz (WCAG 2.3.1). CRT roll, interlace flicker,
  and VHS tracking noise all violate this at default settings — clamp them.
- Honour `prefers-reduced-motion`: disable jitter, flicker, noise, and camera shake; keep
  static palette/scanline styling.
- Ship a visible toggle that drops `signal` to `none` and `vertex` to subpixel. Someone
  needs to read your text.
- Text over dither is a contrast trap. Measure contrast on the *quantized* output, not the
  source colour — quantization can push a passing pair below 4.5:1.

**Performance**
- Low `res` is a huge win — use it. A 320×240 target is ~3% of the pixels of 1080p.
- Draw calls, not triangles, are the budget on the web. Period-accurate scenes are naturally
  low-poly but often high-draw-call; merge static geometry, use `InstancedMesh`/`BatchedMesh`.
- Every full-screen pass costs a full-resolution read+write. Fold the signal chain into one
  fragment shader unless a pass genuinely needs a separate buffer (bloom does; scanlines
  don't).
- Test on a mid-tier phone. Nearest-filtered low-res is fast; barrel-warped 4K with a
  three-tap chroma split is not.

**Craft**
- One anachronism, deliberately chosen and named. Fusions read as *new* when exactly one
  element is impossible for the base era, and as *broken* when three are.
- Hold the budget everywhere. One un-budgeted asset destroys the illusion for the whole scene.

## Files

Read on demand — do not preload all of these.

| File | Read when |
|---|---|
| `references/era-matrix.md` | Choosing/validating a budget; need palettes, poly counts, real hardware numbers |
| `references/fusion-protocol.md` | Blending two or more eras — the creative engine |
| `references/threejs-r18x.md` | **Before writing any three.js code.** Renderer choice, current API, stale-knowledge traps |
| `references/shader-cookbook.md` | Implementing a specific effect; debugging one that looks wrong |
| `references/web-craft.md` | The non-3D layer: type, layout, CSS, motion, UI chrome per era |
| `assets/retro-glsl.js` | WebGLRenderer path — PSX material + full pipeline. Compiles and links on a real driver; drop-in |
| `assets/retro-tsl.js` | WebGPURenderer/TSL path — composes shipped nodes, adds exact dither + palette + phosphor mask |
| `assets/scaffold.html` | Single-file runnable starting point wiring the whole pipeline |
| `scripts/palette_lut.py` | Turn a hex palette into a LUT PNG for shader-side quantization |

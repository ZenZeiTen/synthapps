---
name: hd2d-forge
description: Design and build HD-2D games — pixel-art billboard sprites inside fully 3D, dynamically lit environments, in the register of Octopath Traveler, Triangle Strategy and Final Fantasy Resonance. Ships the six-dial Pixel Density Contract, the render-pass order, the three-layer sprite shadow strategy, normal-mapped sprite lighting, bokeh and tilt-shift depth of field, engine recipes for Godot 4, Unity URP, Unreal 5 and three.js, a tested three.js module and a sprite normal-map generator. ALWAYS trigger when the user wants to build, art-direct or debug an HD-2D or HD2D game; wants pixel sprites in a lit 3D world; mentions billboard sprites, sprite normal maps, diorama look, tilt-shift game camera, 2.5D JRPG or Sea of Stars; or says "make it look like Octopath", "my sprites look flat", "my sprites look like they are floating", "bikin game HD-2D", "sprite piksel di dunia 3D". Prefer over generic 2D or 3D game skills whenever pixel sprites and a lit 3D environment appear in one scene.
---

# HD-2D Forge

Build games where 2D pixel-art characters stand inside a real 3D world and are lit by the
same lights that light the world. Output is either a running artifact or a spec another
agent can implement without re-deriving the tradeoffs.

## When NOT to use this skill

Precedence matters more here than usual, because three neighbouring skills overlap on
"retro" and "pixel":

| Situation | Skill |
|---|---|
| Sprites in a **lit 3D** scene; diorama; billboards | **this skill** |
| Pure 2D canvas game, tile world, no 3D camera | `game-creator-2d` |
| 3D characters + 3D world, PS1/N64/CRT signal register | `threejs-retro-forge` |
| three.js **API currency** (imports, renames, r18x/TSL/WebGPU) | `threejs-retro-forge/references/threejs-r18x.md` — read it before writing three.js code |
| Localising a finished game's strings/UI | `game-loc-ops` |

HD-2D and PS1-retro are opposites in intent, and mixing them is the most common way this
looks wrong. PS1-retro *simulates a constraint that existed*. HD-2D *spends a modern budget
on an old representation*. Vertex jitter, affine warp and 15-bit colour belong to the first
and will fight everything in this document.

---

## The core idea: one lighting model, two representations

The naive framing is "pixel sprites plus 3D backgrounds plus bloom." That framing produces
the asset-store version of this style, where sprites read as stickers pasted on a render.

The correct framing: **the renderer must not be able to tell a sprite from a mesh.** A
sprite writes albedo, a world-space normal, and depth, exactly like a mesh does. It receives
the same lights, casts into the same shadow map, sits in the same tone-mapping curve. What
makes it *look* 2D is only its texture and its silhouette — never a separate lighting path.

**Fact:** Acquire's HD-2D pipeline in Octopath Traveler was built on Unreal Engine 4's
default deferred renderer, chosen because deferred decouples lighting cost from geometry
and supports many dynamic point lights, which carry the style's high-contrast look. A point
light is deliberately placed into scenes so characters cast shadows onto the environment.
**Inference:** the "one lighting model" rule follows from that architecture rather
than being stated by the developers as a rule.

Everything below is downstream of two things: that rule, and the density contract.

---

## The Pixel Density Contract

Six dials. Set all six explicitly and write them into the spec. Every other decision
derives from them. Unset dials are where HD-2D scenes go wrong — not in shader quality.

### 1. `texel` — world size of one sprite texel

The master dial. Metres (or world units) per sprite texel. Pick this **first** and never
drift from it.

Everything visible is then measured in texels, not units. A 1.6 m character at
`texel = 0.02` is 80 texels tall. A doorway that should read as head-and-a-half is 120
texels. Working in texels is what keeps the world coherent when you later change scale.

### 2. `sprite_h` — character height in texels

| Range | Reads as | Cost |
|---|---|---|
| 32–40 | SNES chibi, ~2.5 heads | cheapest animation, weakest acting |
| 48–64 | Octopath Traveler I register | the default; expressive faces still legible |
| 64–96 | Octopath Traveler II register, smaller head-to-body ratio | more action fits in a frame; every frame costs more |
| >96 | drifts toward HD illustration, loses "pixel" reading | avoid unless deliberate |

**Fact:** Acquire raised the head-to-body ratio between Octopath Traveler and its
sequel specifically to fit more action into events and battles.

Whatever you choose, hold it for **every** character. Density mismatch between two
characters standing next to each other is the single most visible defect in this style.

### 3. `env_ratio` — environment texel density relative to sprite density

Environment textures must be an **integer ratio** of `texel`: 1× (same density) or 2×
(twice as fine). Never 1.37×.

- **1×** — strictest, most cohesive, hardest to build detail with. Ground, walls and
  characters share one grid.
- **2×** — the practical default. Environments carry more detail without characters looking
  under-resolved, because the eye reads 2× as "same family, finer weave."
- **>2×** — environments start reading as photographic and sprites become stickers.

**Fact:** Octopath Traveler II increased map resolution relative to the first game
while keeping characters pixelated, so the two densities are not required to match. **Inference:**
the integer-ratio rule is a working heuristic, not a documented Square Enix constraint.

### 4. `pitch` / `fov` — the camera contract

Two numbers, and they trade against each other.

- **`pitch`** — camera declination from horizontal. 25–40° is the HD-2D band. Below ~20°
  billboards start hiding each other and ground detail vanishes. Above ~45° billboards
  begin to shear thin (see failure modes) and the world reads as a tilemap again.
- **`fov`** — vertical field of view. Use a **long lens**: 20–35°. A narrow FOV flattens
  perspective, which is what lets flat sprites sit convincingly beside real geometry, while
  still preserving the parallax that an orthographic camera would throw away.

Do not use an orthographic camera. Orthographic kills the parallax that sells depth, and
kills depth-of-field falloff along with it.

**Fact:** Octopath Traveler II uses a tilt-shift camera setup with a wide field of
view described as flattening the viewpoint while keeping depth. **Speculation:**
public sources describe the intent but not the numeric FOV; the 20–35° band above is a
practical starting range, not a measured value from the shipped game.

### 5. `focus` — the miniature dial

Focal plane distance and aperture (circle-of-confusion scale). This is the dial that
decides how strongly the scene reads as a *diorama* rather than a place.

Turn it up for towns and set-piece rooms. Turn it **down** for dungeons and combat, where
readability beats charm. Excessive tilt-shift blur applied globally is a known
over-application of this style — it only makes literal sense when the world is meant to
read as miniature.

### 6. `lights` — key elevation and dynamic light count

- **Key elevation** — the sun/key angle above horizon. Keep it **below ~60°**. At high
  elevations a flat billboard has almost no shadow to cast and the illusion collapses.
- **Dynamic count** — how many point lights a scene may carry. This is the dial that
  decides whether you need a deferred/Forward+ pipeline or can stay forward. Torches,
  lamps and spell flashes are where the style's contrast comes from; budget them
  deliberately rather than adding them per-scene.

---

## Workflow

1. **Set all six dials.** Write the numbers in your response. They are the spec.
2. **Choose the pipeline** from the light budget — `references/rendering-pipeline.md`.
   Deferred, Forward+, or plain forward. This is the decision that is expensive to reverse.
3. **Establish the sprite contract before any art is made**: sheet layout, direction count,
   pivot at the feet, hard alpha edges, and the normal-map convention (including green-channel
   handedness). `references/art-production.md`.
4. **Build the sprite material**: billboard vertex transform, TBN construction, alpha-tested
   shadow casting. `references/rendering-pipeline.md` → *Sprite as first-class geometry*;
   settings per engine in `references/engine-recipes.md`.
5. **Ground the sprites** with the three-layer shadow strategy. Skipping this is why sprites
   float. `references/rendering-pipeline.md` → *Shadows*.
6. **Build the environment** as real geometry with pixel-art textures at `env_ratio` — not as
   a painted backdrop. `references/art-production.md`.
7. **Apply the post chain in the correct order.** Order is not cosmetic here; DoF before
   bloom and bloom before tone mapping produce a different image than any other permutation.
   `references/rendering-pipeline.md` → *Post order*.
8. **Run the gates** in *Non-negotiable gates* below, then walk the failure-mode checklist in
   `references/failure-modes.md`. Every entry is a defect that ships in amateur HD-2D and has
   a specific, known fix.
9. **Verify on real hardware at target resolution.** Density defects are invisible in an
   editor viewport at an arbitrary zoom.

---

## The render pass order

The short version. Full detail and the deferred-vs-forward argument:
`references/rendering-pipeline.md`. Engine settings: `references/engine-recipes.md`, checked
September 2026; re-check against current engine docs (Context7 or the official docs).

```
1. Shadow pass          — meshes write depth; sprites write depth via ALPHA-TESTED discard
2. Geometry / G-buffer  — meshes AND sprites write albedo + world normal + material
3. Lighting pass        — one model, all lights, world position reconstructed from depth
   3b. Contact shadows  — short screen-space ray march, fixes the floating-feet gap
4. Forward / translucent — water, glass, additive VFX (deferred cannot hold these)
5. Depth of field       — CoC from depth; golden-angle spiral gather; noise-rotated kernel
6. Bloom                — threshold above 1.0 in HDR, not on the tone-mapped image
7. Fog / volumetrics    — god rays, height fog
8. Tone map (ACES) + grade
9. UI                   — never blurred, never bloomed, never tone-mapped
```

Rule: **nothing after step 8 may touch the UI.** Post-processed UI is the fastest way to
make an HD-2D game look like a tech demo.

---

## Non-negotiable gates

Run these before calling any HD-2D work done.

**Density gate.** Screenshot at target resolution, crop 200% on a character standing on
ground next to a prop. Sprite texels, ground texels and prop texels must fall on a
recognisable common grid. If any element reads as "smoother than" its neighbours, `env_ratio`
has drifted.

**Grounding gate.** For every character, in every lighting condition: is there dark contact
where the feet meet the floor? If the shadow starts a visible gap away from the feet, you
have shadow bias detachment ("Peter Panning") and need contact shadows or a decal.

**Rotation gate.** If the camera rotates: orbit 360° around a character standing beside a
tree and a wall. Watch for billboards thinning, sprite/mesh sort order popping, and shadow
width pumping. All three are documented, fixable defects.

**Readability gate.** Turn the DoF off. If the scene reads *better* without it, the `focus`
dial is too high. Charm never outranks legibility in a dungeon.

**Motion gate.** Move the camera slowly across a textured floor. If the environment texture
crawls or shimmers, you have a texel-snapping problem, not an anti-aliasing problem.

**Accessibility gate.** Bloom intensity, depth of field, and camera shake each need a
reduced-motion / reduced-effects path. A tilt-shift blur with no way to disable it is an
accessibility defect, not a style.

---

## Bundled resources

| Path | What it is |
|---|---|
| `references/rendering-pipeline.md` | Pipeline choice by light budget, sprite as first-class geometry, billboard modes, tangent frames and normal-map conventions, the three-layer shadow strategy, contact shadows, sorting, DoF and tilt-shift, bloom and ACES, post order, texel snapping |
| `references/art-production.md` | Sprite sheet contract, direction counts, painting for dynamic light, normal-map methods, silhouette and outline rules, environment construction, pre-import checklist |
| `references/engine-recipes.md` | Godot 4, Unity 6 URP, Unreal 5 and three.js: the node, component and setting names for each part of the pipeline, and each engine's trap. Unconfirmed items are marked **check** |
| `references/failure-modes.md` | 25 named defects with symptom, cause, fix and the gate that catches them. Use as the review checklist |
| `assets/hd2d-threejs.js` | three.js module (`WebGLRenderer`, tested on r186 in headless Chromium): lit, normal-mapped, alpha-tested billboard sprite with a light-facing shadow proxy and blob decal; key light; long-lens camera rig with texel snap; HDR post chain (bokeh DoF with tilt-shift, bloom, ACES, sRGB) |
| `scripts/sprite_normalmap.py` | Normal map from a sprite or sheet (bevel from alpha plus luminance), per-frame with `--frame WxH`, OpenGL by default, `--flip-green` for DirectX. Pure Python, no dependencies |

---

## Reference titles

Use these to calibrate a brief when the user says "like X":

| Title | What it actually contributes |
|---|---|
| Octopath Traveler (2018) | The baseline. Heavy DoF, dramatic point lights, ~48px characters, deferred UE4 |
| Octopath Traveler II (2023) | Taller characters, higher map resolution, dynamic day/night, moving camera |
| Triangle Strategy (2022) | Tactical grid readability under the same style — the "how to keep it legible" case |
| Live A Live (2022) | Remake case: an existing 2D game re-rendered, useful when adapting rather than authoring |
| Dragon Quest III HD-2D Remake (2024) | The most restrained lighting of the family |
| Sea of Stars (2023) | Built in Unity, not Unreal; proof the style is not engine-locked |
| Final Fantasy Resonance (2026) | First HD-2D Final Fantasy; Square Enix + Lancarse; release scheduled for 22 Oct 2026 on Switch, Switch 2, PS5, Xbox Series X\|S and PC. Adapts the first arc of Final Fantasy Brave Exvius, reusing its sprites |

**Fact:** the Final Fantasy Resonance details above are from Square Enix's June 2026
announcement and subsequent coverage. This post-dates most model training data; verify
current details by search rather than from memory.

---

## Legal note

"HD-2D" is a Square Enix trademark. Square Enix does not own the art style itself, but do
not use the term as a marketing label for a shipped product without counsel. Describe the
look ("pixel-art characters in lit 3D environments") in store copy and keep "HD-2D" to
internal documents and this skill.

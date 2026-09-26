# HD-2D rendering pipeline

The long form of *The render pass order* in SKILL.md: which pipeline to pick, how a sprite
becomes first-class geometry, how it is shadowed, and how the post chain is ordered.
Engine-specific settings are in `engine-recipes.md`; the named defects are in
`failure-modes.md`.

Labels used below: **Fact** (from engine docs or measured in this skill's tests),
**Inference** (reasoned from facts), **Heuristic** (working practice, not a documented rule).

## Contents

1. Choose the pipeline from the light budget
2. Sprite as first-class geometry
3. Shadows: the three-layer strategy
4. Contact shadows
5. Sorting and transparency
6. Depth of field and tilt-shift
7. Bloom, tone mapping and colour
8. Post order and the UI rule
9. Texel snapping and the motion gate

---

## 1. Choose the pipeline from the light budget

Count the dynamic lights that can touch one object at once (dial 6, `lights`): torches in a
corridor, a spell flash, lamps in a town square. Then pick:

| Budget | Pipeline | Why |
|---|---|---|
| 1 key + up to ~8 local lights per object | Plain forward | Cheapest, simplest, MSAA available, transparency is easy |
| Many local lights, many objects | Forward+ (clustered forward) | Lights are binned into screen clusters; no G-buffer; transparency still forward |
| Many local lights, heavy post (SSAO, screen-space effects) | Deferred | Lighting cost decoupled from geometry; screen-space effects get normals for free |

**Fact:** Octopath Traveler's HD-2D look was built on Unreal Engine 4's default deferred
renderer, chosen for many dynamic point lights (see SKILL.md). **Fact:** Unreal defaults to
deferred; Unity URP offers Forward, Forward+, Deferred and Deferred+; Godot 4 offers Forward+
(clustered), Mobile and Compatibility (forward). Per-object light limits differ sharply
between these; see `engine-recipes.md`.

**Heuristic:** most HD-2D scenes are a key light, one fill or sky light, and a handful of
warm point lights. That fits Forward+ comfortably. Choose deferred only when you also want
the screen-space effects that need its G-buffer.

The decision is expensive to reverse because it changes what transparency, MSAA, decals and
contact shadows can do. Make it before the first environment is built.

## 2. Sprite as first-class geometry

The rule from SKILL.md: the renderer must not be able to tell a sprite from a mesh. In
practice that means the sprite is a quad drawn with the **same lit material model** as the
world, and it writes what a mesh writes: albedo, a world-space normal (from its normal map),
and depth.

### The quad

- **Pivot at the feet.** Offset the quad so its bottom edge sits on the object origin. Then
  the object's position is where it stands, shadows start at the feet, and sorting uses the
  right depth.
- **Size from the density contract.** World size = frame size in texels × `texel`. A
  32 × 48 frame at `texel = 1/32` is 1.0 × 1.5 units.
- **Alpha-tested, not blended.** Hard pixel edges come from alpha test (cutout). A
  cutout sprite writes depth, sorts correctly against the world, casts a cutout shadow, and
  can sit in a G-buffer. A blended sprite can do none of these reliably.

### Billboard mode

| Mode | Behaviour | Use |
|---|---|---|
| Cylindrical (rotate around world Y only) | Stays upright; faces the camera horizontally | **Default for characters and props.** Feet stay planted |
| Spherical (faces the camera fully) | Tilts back with camera pitch | Particles, VFX, floating icons. On characters it makes feet slide and shadows lean |
| Fixed (no billboarding) | A flat card in the world | Wall decorations, set dressing seen from a limited arc |

**Heuristic:** at a 25-40° pitch, a cylindrical billboard foreshortens by cos(pitch)
vertically (about 0.77-0.91). Art is authored for that: characters are drawn a little tall,
or the camera pitch is chosen with the art.

### Tangent frame and normal maps

A billboard rotates every frame, so its tangent frame must rotate with it. Two working ways:

- **Derived from UV derivatives in the fragment shader.** This is what three.js does when a
  mesh has no tangent attribute; it follows the rotated quad automatically.
- **Built from the billboard axes** in the vertex shader: tangent = camera-facing right
  vector, bitangent = world up (cylindrical) or camera up (spherical), normal = their cross
  product.

Either way, the normal map's **green-channel convention** must match the engine:

| Engine | Expects | Source |
|---|---|---|
| three.js | OpenGL (green = +Y, up) | **Fact:** measured in this skill's browser test; `normalScale.y = -1` flips |
| Godot 4 | OpenGL (green up) | **Fact:** class reference, `BaseMaterial3D.normal_texture`: "X+, Y+, and Z+"; the mesh needs tangents |
| Unity | OpenGL (Y+) | **Fact:** Unity manual, normal map page; importer has "Flip Green Channel" |
| Unreal | DirectX (green down) | Epic asset guidelines; the texture editor has "Flip Green Channel" |

`scripts/sprite_normalmap.py` writes OpenGL by default and DirectX with `--flip-green`.
A wrong convention shows as sprites lit from below when the light is above; see
`failure-modes.md`, *Inverted relief*.

### What the normal map is for

A flat billboard facing the camera has one normal for every pixel, so a light above or to
the side lights the whole sprite evenly or not at all. The normal map gives the silhouette a
rim that catches light from its side, and that is most of what makes the sprite look like it
belongs in the lit world. Keep it gentle: a bevel of 2-3 texels plus a small luminance term
(the script's defaults) reads as "cushion", not as "embossed".

## 3. Shadows: the three-layer strategy

A single shadow-map shadow is not enough for a billboard. Use three layers together.

| Layer | What it is | Fixes |
|---|---|---|
| 1. Shadow-map shadow from a **light-facing proxy** | A shadow-only copy of the sprite quad, alpha-tested with the same texture, rotated each frame to face the key light (around Y) | Shadow width pumping when the camera orbits |
| 2. **Blob or contact decal** | A soft dark ellipse on the ground under the feet, turned with the sprite so its long axis spans the figure's width | Floating feet in every light, including when shadow maps are off or low resolution |
| 3. **Receiving** | The sprite receives shadows like any mesh | Sprites standing in a building's shadow stay dark |

Why the proxy: the visible sprite faces the camera. When the camera is at 90° to the key
light, the visible quad is edge-on to the light and its shadow collapses to a line.
**Fact:** measured in this skill's browser test, a camera-facing sprite that casts its own
shadow lost the shadow entirely at that angle (0 luminance change at the shadow point); the
light-facing proxy kept the full shadow.

How to make the proxy invisible to the camera but visible to the shadow pass depends on the
engine: a shadows-only render mode (Godot `SHADOW_CASTING_SETTING_SHADOWS_ONLY`, Unity
"Shadows Only", Unreal "Hidden Shadow"-style settings; check your version), or a material
that writes neither colour nor depth (the three.js module does this).

**Bias.** Shadow-map bias pushes the shadow away from its caster. On a billboard standing on
the floor this shows as a gap under the feet (Peter Panning). Keep depth bias small, use
normal bias for acne, and let layer 2 cover the last few centimetres.

**Key elevation (dial 6).** Above about 60°, a vertical quad has almost no shadow to cast
from any angle. Keep the key below that and let local lights do the dramatic work.

## 4. Contact shadows

A contact shadow is a short screen-space ray march from each pixel toward the light, through
the depth buffer. It darkens the few centimetres where an object meets a surface, which is
exactly where shadow maps are weakest.

| Engine | Availability |
|---|---|
| Unreal 5 | **Fact:** per light, "Contact Shadow Length" (screen space by default, optional world-space units). Not supported by the Forward Shading renderer |
| Godot | **Fact:** not in 4.7 stable. The 4.8 development docs add a project setting `rendering/lights_and_shadows/contact_shadow/enabled` and per-light `shadow_contact_shadows_*` properties |
| Unity URP | No contact-shadow feature found in the URP docs (HDRP has one). "Screen Space Shadows" in URP is a different feature |
| three.js | Not shipped for `WebGLRenderer`. Use the blob decal |

Where contact shadows are missing, the blob decal is the substitute. It is cheaper and more
art-directable, and it works on every renderer.

## 5. Sorting and transparency

- Alpha-tested sprites are opaque to the renderer: they depth-test, depth-write and need no
  sorting. Keep characters and props this way.
- Soft effects (smoke, spell glows, water, glass) go in the forward/transparent pass after
  lighting. Deferred cannot store them in the G-buffer.
- Semi-transparent sprite pixels (anti-aliased edges, soft hair) break sorting against other
  sprites. Remove them from the art (see `art-production.md`) rather than fighting the sort.
- Sprite-over-sprite popping under camera rotation usually means two billboards share
  nearly the same depth. Offset them by a few texels in depth, or sort by feet position
  when they are transparent.

## 6. Depth of field and tilt-shift

Depth of field (dial 5, `focus`) is what makes the scene read as a diorama. Two forms:

- **Physical DoF.** Circle of confusion (CoC) from each pixel's distance to the focal plane.
  Blur grows in front of and behind the focus.
- **Tilt-shift.** Blur grows toward the top and bottom of the frame regardless of depth.
  Cheap, very "miniature", and easy to overdo.

A good gather for pixel art is a **golden-angle spiral**: samples at increasing radius,
rotated by the golden angle (≈137.5°), weighted so a sharp foreground is not smeared by a
blurred background (after D. Gustafsson, "Bokeh depth of field in a single pass", 2018).
Rotate the spiral's start angle per pixel with a small noise function to trade banding for
fine noise. `assets/hd2d-threejs.js` implements this.

Rules:
- Focus on the **characters' feet plane**, not on their heads. The ground they stand on must
  be sharp or they float.
- Keep the in-focus band wide enough to hold the playable area. **Heuristic:** if the player
  character leaves focus during normal movement, the focus scale is too high.
- Turn DoF down for dungeons and combat (readability gate), and provide an off switch
  (accessibility gate).
- Cost grows with the square of the maximum blur radius in pixels. Blur in screen pixels,
  not texels, so it does not change with window size by accident.

## 7. Bloom, tone mapping and colour

- Render the scene into a **linear HDR** target (16-bit float). Lights and emissive
  surfaces may exceed 1.0; that headroom is what bloom and tone mapping work on.
- **Bloom threshold above 1.0 in linear HDR.** Only genuinely bright things bloom: flames,
  magic, sun glints. A threshold below 1.0 blooms white walls and skin. Note that Unity URP
  states its Bloom threshold in gamma space (default 0.9); tune by eye there.
- **Tone map with ACES** (or AgX where the engine offers it), then encode to sRGB for the
  screen. Grade after tone mapping only if the engine's grading mode expects it.
- Author sprite and texture colours in sRGB; the renderer converts to linear for lighting.
  Normal maps are data: mark them as linear (non-colour) or lighting goes wrong.

## 8. Post order and the UI rule

```
scene (linear HDR) → contact shadows → transparent/forward → DoF → bloom → fog/volumetrics
→ tone map → grade → sRGB encode → UI
```

- DoF before bloom: bloom from a blurred highlight stays soft; bloom before DoF spreads
  sharp glow halos that then get blurred into mush.
- Bloom before tone mapping: bloom must see HDR values above 1.0.
- **Nothing after tone mapping touches the UI.** Draw the UI last, unblurred, unbloomed,
  un-tone-mapped. In a web build, keep the UI in HTML over the canvas.

## 9. Texel snapping and the motion gate

Pixel textures crawl and shimmer when the camera moves by fractions of a texel. Fixes, in
order of cost:

1. **Nearest filtering and no mipmaps on sprites.** Mipmaps blur pixel art into mush at a
   distance; nearest keeps the grid.
2. **Snap the camera target** to the environment texel grid while panning
   (`createCameraRig({ snap })` in the three.js module).
3. **Render at an integer fraction of the screen** and upscale with nearest filtering. This
   makes everything snap, including 3D geometry edges; it also changes the look toward
   classic pixel rendering, so decide it with the art direction.

Mipmaps on *environment* textures are a judgement call: they stop far-ground moiré, but they
soften the texel grid. **Heuristic:** keep mipmaps on large ground textures seen at grazing
angles, off on sprites and near props.

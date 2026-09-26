# HD-2D failure modes

Named defects with symptom, cause and fix. Use it as the review checklist in workflow step 8
of SKILL.md: walk the list against a screenshot at target resolution and an orbit of the
camera. Each entry names the gate (from *Non-negotiable gates*) that catches it.

Engine names and settings are in `engine-recipes.md`; the reasoning is in
`rendering-pipeline.md` and `art-production.md`.

## Lighting and materials

**1. Sticker sprites.** *Symptom:* characters look pasted on the render; lights do not
touch them. *Cause:* sprites drawn with an unlit or separate material. *Fix:* the same lit
material model as the world, with a normal map. *Gate:* density and grounding (visible in
any lit test scene).

**2. Engine-default unlit sprites.** *Symptom:* the scene looks fine in daylight and wrong
at night. *Cause:* the engine's sprite component defaults to unlit: Godot `Sprite3D.shaded`
is false, Paper2D sprites use an unlit masked material, Unity `Sprite-Lit-Default` is unlit
under the 3D Universal Renderer. *Fix:* a lit quad per `engine-recipes.md`. *Gate:* turn the
key light off; every sprite must go dark.

**3. Flat sprite under side light.** *Symptom:* a torch beside a character lights the whole
sprite evenly, or not at all. *Cause:* no normal map, so every pixel has the quad's normal.
*Fix:* a normal sheet (`scripts/sprite_normalmap.py`), same grid as the colour sheet.

**4. Inverted relief.** *Symptom:* sprites look lit from below when the light is above;
rims darken on the lit side. *Cause:* normal-map green convention does not match the engine
(OpenGL vs DirectX). *Fix:* regenerate with or without `--flip-green`, or flip on import
(`normalScale.y = -1` in three.js). *Test:* one light directly above; the top rim must be
brighter than the bottom rim.

**5. Painted light fights real light.** *Symptom:* a sprite has a highlight on the left
while the only light is on the right. *Cause:* directional light painted into the sprite.
*Fix:* repaint for form only (`art-production.md`, section 3). Mirrored frames make this
worse.

**6. Light budget overflow.** *Symptom:* torches pop on and off as the character walks, or
some lights stop affecting a mesh. *Cause:* per-object light limits in forward renderers
(8 additional lights per object in URP Forward; 8 omni and 8 spot per mesh in Godot Mobile
and Compatibility). *Fix:* Forward+ or deferred, or fewer overlapping lights per area.
*Gate:* walk the busiest room with every light on.

## Density and camera

**7. Density mismatch.** *Symptom:* two characters side by side have visibly different
pixel sizes. *Cause:* different `sprite_h` or `texel` per character, or a scaled node.
*Fix:* one `texel` for every sprite; never scale sprite nodes. *Gate:* density.

**8. Smoother neighbour.** *Symptom:* props or ground look finer or blurrier than the
characters beside them. *Cause:* environment texel density drifted off an integer
`env_ratio`, or mixed UV scales across a kit. *Fix:* re-UV to 1× or 2× the sprite density.
*Gate:* density (200% crop).

**9. Orthographic flatness.** *Symptom:* the world reads as a tilemap; depth of field has
nothing to work with. *Cause:* an orthographic camera. *Fix:* perspective with a long lens
(`fov` 20-35°).

**10. Billboard thinning.** *Symptom:* at steep camera angles characters look squashed or
sheared thin. *Cause:* `pitch` above ~45° with upright billboards. *Fix:* keep `pitch` in
25-40°; if the design needs a steep camera, author sprites for it.

**11. Sliding feet and leaning shadows.** *Symptom:* feet drift against the ground when the
camera tilts; shadows lean. *Cause:* spherical billboards on characters. *Fix:* cylindrical
(Y-only) billboards for anything that stands on the ground.

**12. Retro-signal contamination.** *Symptom:* the scene wobbles and swims like a PS1 game.
*Cause:* vertex jitter, affine texture warp or 15-bit colour borrowed from a retro shader
pack. *Fix:* remove them; HD-2D spends a modern budget on an old representation (see
SKILL.md, *When NOT to use this skill*).

## Shadows

**13. Floating feet (Peter Panning).** *Symptom:* a gap of light between the feet and the
start of the shadow. *Cause:* shadow depth bias pushes the shadow away from its caster.
*Fix:* smaller depth bias, normal bias for acne, and a blob decal or contact shadows for the
last few centimetres. *Gate:* grounding.

**14. Shadow width pumping.** *Symptom:* while the camera orbits, a character's shadow
narrows to a line and widens again. *Cause:* the camera-facing sprite casts its own shadow,
so its shadow depends on the camera angle. *Fix:* a shadow-only proxy that faces the key
light. *Gate:* rotation. (Measured in this skill's browser test: at 90° between camera and
light, the self-shadowing sprite cast no shadow at all; the proxy cast a full one.)

**15. Collapsed key shadow.** *Symptom:* characters under a high sun have almost no shadow.
*Cause:* key elevation above ~60°. *Fix:* lower the key; let local lights carry drama.

**16. Shadow pinholes.** *Symptom:* specks of light inside a character's shadow. *Cause:*
stray transparent or near-threshold pixels inside the body, cut by the alpha test. *Fix:*
clean the alpha to 0/255 with no holes (`art-production.md`, section 5).

## Edges, sorting and textures

**17. Nibbled or haloed edges.** *Symptom:* sprite outlines lose pixels or carry a light or
dark fringe. *Cause:* anti-aliased (soft) alpha under an alpha test, or linear filtering.
*Fix:* hard alpha, nearest filtering.

**18. Frame bleeding.** *Symptom:* a sliver of the neighbouring frame appears at a sprite's
edge. *Cause:* linear filtering or mipmaps sampling across the frame boundary. *Fix:* nearest
filtering, no mipmaps on sprites, transparent padding inside each frame.

**19. Sprite jitter.** *Symptom:* a character wobbles by a pixel between animation frames.
*Cause:* trimmed frames whose offsets are not re-applied, or feet not on the same pivot row.
*Fix:* fixed-grid sheets with a fixed pivot row (`art-production.md`, section 1).

**20. Sort popping.** *Symptom:* two nearby sprites swap which one is in front as the
camera turns. *Cause:* alpha-blended sprites sorted by object centre, or two quads at
nearly the same depth. *Fix:* alpha-tested sprites (depth-tested, no sorting), or a small
depth offset. *Gate:* rotation.

**21. Texture crawl.** *Symptom:* the ground shimmers or crawls while the camera pans.
*Cause:* sub-texel camera motion over nearest-filtered textures. *Fix:* snap the camera
target to the environment texel grid; consider mipmaps on large ground textures seen at
grazing angles. *Gate:* motion.

## Post-processing and UI

**22. Mushy diorama.** *Symptom:* the scene looks pretty in stills but the player loses
track of enemies and exits. *Cause:* depth of field or tilt-shift too strong, or focus set
on heads instead of the ground plane. *Fix:* focus on the feet plane, reduce the focus
scale in play areas, keep strong blur for towns and cutscenes. *Gate:* readability.

**23. Bloomed walls.** *Symptom:* white walls, skin and paper glow. *Cause:* bloom threshold
below 1.0 in HDR, or bloom applied after tone mapping. *Fix:* threshold above 1.0 on the
linear HDR image; only lights and emissives exceed it. (Unity URP states its threshold in
gamma space; tune by eye there.)

**24. Blurry or glowing UI.** *Symptom:* menus and text are softened, bloomed or tone
mapped. *Cause:* UI drawn before or inside the post chain. *Fix:* UI last, after tone
mapping; on the web, HTML over the canvas. *Gate:* the UI rule in SKILL.md.

**25. No reduced-effects path.** *Symptom:* players who get motion sickness or eye strain
cannot turn the blur, bloom or camera shake down. *Cause:* effects hard-wired. *Fix:*
settings for DoF, tilt-shift, bloom and shake; honour the OS reduced-motion preference on the
web. *Gate:* accessibility.

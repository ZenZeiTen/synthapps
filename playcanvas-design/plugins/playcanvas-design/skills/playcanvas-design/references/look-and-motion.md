# Look and motion: making renders read as designed

This is craft guidance (judgement, not measurement), tuned to what PlayCanvas's
StandardMaterial and clustered lighting do well. The code template already applies the
defaults below.

## Look

**Tone mapping and gamma.** Always set the camera to `toneMapping: TONEMAP_ACES` (or
`TONEMAP_NEUTRAL` for brand colours that must stay true) and `gammaCorrection: GAMMA_SRGB`.
Linear tone mapping clips highlights and looks "CG". In the Editor these are camera component
fields (`toneMapping` 3 = ACES, 5 = Neutral).

**Three lights, each with a job.**
- Key: a directional light with shadows (`shadowType PCF5_32F`, resolution 2048,
  `shadowDistance` just past the set). It sets form.
- Fill: a dim, cool directional light from the opposite side, intensity 0.2–0.35 of the key.
  It lifts the shadows.
- Rim: an omni or spot light behind the subject, warm, with a short range. It separates the
  subject from the background, and this is what makes the image look lit on purpose.
- Ambient: low (0.15–0.3) and slightly blue. Too much ambient flattens everything.

**Environment.** A skybox or prefiltered cubemap is what gives metals something to reflect.
- Editor: `create_cubemap_from_texture` on an equirect HDR, then `prefilter_cubemap`, then set
  it as the scene skybox (`modify_scene_settings`).
- Code: load a cubemap asset and set `app.scene.envAtlas` or `skybox`.
- Without an environment, keep metalness low or metals turn black.

**Materials.** Use metalness workflow: `useMetalness = true`, gloss 0.3–0.85. Never use
pure black or pure white diffuse; use 0.04–0.9. Emissive with `emissiveIntensity` > 1 plus
ACES gives a glow without bloom.

**Ground contact.** A subject floating without a shadow looks pasted on. Keep a receiving
ground plane in frame, or for alpha sprites accept no ground; never a half-visible plane.
Keep floor gloss ≤ 0.25 when there's an omni rim light behind the subject. At 0.35–0.4 the
rim shows as a big specular hotspot on the floor in front of it (the template now uses 0.25).

**A seamless "infinite" stage (no visible horizon).** Fog is tone-mapped, but the camera
clear colour is **not**. So fog set to the clear colour renders darker and leaves a band
where the floor meets the sky. Measured by the test run under ACES: fog pixels came out
(4,5,7) against a clear colour of (9,10,14). Three fixes:
1. Compensate the fog colour. Fog 0.062/0.07/0.094 rendered the same as clear colour
   0.035/0.04/0.055, to within 1/255. Re-measure for other colours: render, sample the
   horizon, nudge.
2. Use a cyclorama: a large curved backdrop mesh with the floor material, so everything
   in frame is tone-mapped geometry.
3. Pitch the camera down so the horizon stays out of frame.

**Palette.** Pick 1 hero hue, 1 accent and neutrals. Shift backgrounds toward the
complementary hue at low saturation (the template uses a blue-grey ground for a warm hero).

**Resolution.** Render at the delivery size; supersampling isn't built in. For crisp
small sprites, render at 2× and `spritesheet.py --scale 0.5` (Lanczos).

## Motion

**Easing is the whole craft.**
- Things that start: `outCubic` or `outBack` (a slight overshoot reads as energy).
- Things that land: `inQuad` into the contact, then a short `outBack` squash/settle.
- Camera moves: `inOutSine` or `inOutCubic`. Never linear (linear camera moves feel robotic).
- Loops: the first and last keys must have the same value, and the eases should be symmetric
  (`inOutSine`). Set duration = loop period, so frames = period × fps.
  - The last rendered frame must NOT equal the first, or the loop holds a frame.
  - Proof: render with `--extra 1`, then run `review.py --loop`. It checks that frame N
    (t = period) is byte-identical to frame 0, and that the wrap step (N−1 → 0) is an
    ordinary-sized step. encode.py drops the extra frame.
  - Staggered repeating elements: `{ period, offset }` on each track, with the shot length
    a multiple of the period.

**Timing.**
- 24 fps is cinematic; 30 fps is web and social.
- 60 fps suits UI-like motion and game trailers. Halve the work with 30 unless asked.
- Hold the hero pose for 0.3–0.5 s before and after a move. The eye needs a rest.
- Stagger related elements by 2–4 frames (0.07–0.13 s at 30 fps), not simultaneously.
- Anticipation: a small move opposite to the main action, about 0.1 s, before it.

**Camera.**
- FOV 30–40° for product and hero shots (less distortion), 50–60° for environments.
- Orbit with an angle track plus `lookAt` (template `tl.value(a => ...)`, or keyframe-animator
  with the `lookAt` entity).
- Keep the subject in the frame's thirds. A slow push-in (distance −10% over the shot)
  adds life to static subjects.
- Motion blur isn't available. Keep fast spins under about 15° per frame at 30 fps or they
  strobe.

**Lengths that land.** Logo sting 2–3 s. Product turntable 6–8 s per revolution. Social loop
3–6 s. Trailer beat 1.5–3 s per shot.

## Checking the look

Run `review.py --out contact.png` and actually look at it: silhouette readable at
thumbnail size? Subject separated from the background? Shadows present? Then encode a
short GIF (`--scale 0.5`) for a quick motion read before the full MP4.

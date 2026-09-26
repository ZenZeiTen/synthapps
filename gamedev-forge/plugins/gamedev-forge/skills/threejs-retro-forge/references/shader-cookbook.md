# Shader Cookbook

What each effect is, why it looks the way it does, and how it fails. Implementations live in
`assets/retro-glsl.js` and `assets/retro-tsl.js` — this file is for choosing and debugging.

**On WebGPU/TSL, check `references/threejs-r18x.md` § "What three.js already ships" first.**
r185 ships `retroPass` (snapping + affine in one node) and a CRT module covering barrel,
scanlines, vignette and colour bleeding. The entries below still tell you *why* each effect
behaves as it does and how to debug it — but do not hand-roll what is already maintained
upstream. The genuine gaps are exact ordered dithering, palette quantization, and the
phosphor mask.

**Contents**
- [Vertex snapping](#vertex-snapping)
- [Affine texture warping](#affine-texture-warping)
- [Ordered dithering](#ordered-dithering)
- [Palette quantization](#palette-quantization)
- [Vertex lighting](#vertex-lighting)
- [Hard fog](#hard-fog)
- [Stipple transparency](#stipple-transparency)
- [Sort-order instability](#sort-order-instability)
- [CRT signal chain](#crt-signal-chain)
- [VHS](#vhs)
- [Phosphor persistence](#phosphor-persistence)
- [3-point filtering](#3-point-filtering)
- [Chrome and gloss](#chrome-and-gloss)
- [Effect ordering summary](#effect-ordering-summary)

---

## Vertex snapping

**What it is.** The PS1 had no subpixel rasterization: a vertex whose true screen position was
at x=100.4 was drawn at x=100. As the camera moves, vertices jump between whole pixels rather
than sliding, so geometry appears to shiver.

**How.** In the vertex stage, after projection:

```glsl
vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
vec2 grid = uResolution * 0.5;          // NDC spans -1..1 across uResolution pixels
vec3 ndc  = clip.xyz / clip.w;
ndc.xy    = floor(ndc.xy * grid + 0.5) / grid;
clip.xyz  = ndc * clip.w;
gl_Position = clip;
```

**Failure modes.**
- *Geometry explodes / streaks across the screen.* You divided by a `w` at or below zero —
  vertices behind the camera. Guard it: only snap when `clip.w > 0.0`, pass through otherwise.
- *No visible effect.* `res` too high. At 1080p a one-pixel jump is invisible. Jitter needs a
  coarse grid to read; it is a `res`-dependent effect, not an independent one.
- *Everything jitters including the UI.* Snap only scene materials. UI belongs in a separate
  un-snapped pass.
- *Thin geometry disappears.* Two vertices snapping to the same pixel collapse the triangle.
  This is period-accurate. If unwanted, raise `res` or thicken the geometry.

Snapping in *world* or *view* space instead of NDC is a common mistake — it produces a
quantized-position look that reads as stop-motion, not as rasterization error, because the
step size no longer scales with distance.

---

## Affine texture warping

**What it is.** The PS1 interpolated UVs linearly in screen space, ignoring depth. On surfaces
viewed at a shallow angle this bends straight texture lines and makes the two triangles of a
quad visibly disagree along their shared diagonal.

**Why the obvious approach doesn't work in WebGL.** In HLSL you tag the varying
`noperspective` and the rasterizer does it for you. **GLSL ES has no `noperspective`
qualifier** — not in 1.00, not in 3.00. Every Unity tutorial's approach fails to compile.

**The portable trick, and why it's exact.** Hardware interpolates a varying `V`
perspective-correctly, which evaluates to:

```
V_pc = (Σ λᵢ Vᵢ / wᵢ) / (Σ λᵢ / wᵢ)          λ = screen-space barycentrics
```

Pass two varyings from the vertex stage: `vUVW = uv * clip.w` and `vW = clip.w`. Then:

```
vUVW interpolates to  (Σ λᵢ uvᵢ wᵢ / wᵢ) / (Σ λᵢ / wᵢ) = (Σ λᵢ uvᵢ) / (Σ λᵢ / wᵢ)
vW   interpolates to  (Σ λᵢ wᵢ / wᵢ)     / (Σ λᵢ / wᵢ) = 1 / (Σ λᵢ / wᵢ)
```

so in the fragment shader:

```glsl
vec2 affineUV = vUVW / vW;              // = Σ λᵢ uvᵢ  — exactly screen-linear
```

The two `(Σ λᵢ / wᵢ)` factors cancel, leaving pure barycentric interpolation of the UVs. This
is mathematically identical to `noperspective`, not an approximation.

**Failure modes.**
- *Warp invisible.* Texel density too high, or no shallow-angle surfaces in frame. Affine
  warp needs large flat floors/walls and low-frequency textures to show.
- *Warp everywhere, nauseating.* Period-accurate but hostile. Real games mitigated it by
  subdividing large polygons — tessellate floors into a grid and the warp becomes localized
  and charming rather than global and sickening. This subdivision is the actual historical
  fix and it's the single best control knob for the effect.
- *Warp on characters looks wrong.* It is wrong — characters were mostly viewed head-on, so
  warp barely showed. Apply affine selectively via a material flag.

---

## Ordered dithering

**What it is.** Adding a spatially-varying threshold before quantization, so that a colour
between two representable values alternates between them in a fixed pattern rather than
rounding uniformly. Converts banding into texture.

**Bayer matrix, closed form.** No texture lookup needed, and it reproduces the canonical
matrix exactly — GPU readback on an ANGLE driver matches element-for-element:

```glsl
float bayer2(vec2 a){ a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
#define bayer4(a) (bayer2(0.5 * (a)) * 0.25 + bayer2(a))
#define bayer8(a) (bayer4(0.5 * (a)) * 0.25 + bayer2(a))
```

`bayer2` reproduces `[[0,2],[3,1]] / 4` exactly; each recursion adds a level. `bayer4` yields
16 evenly-spaced values in `[0, 0.9375]`, `bayer8` yields 64.

**Apply centred, scaled by the quantization step:**

```glsl
float t = bayer4(gl_FragCoord.xy) - 0.5;    // centre so it doesn't shift brightness
color += t / levels;                         // levels = 32 for RGB555
color  = floor(color * (levels - 1.0) + 0.5) / (levels - 1.0);
```

**Choosing a matrix.** 4×4 is the PS1's actual hardware matrix and looks correct for that era.
8×8 gives smoother gradients and a finer, more "printed" texture — better for Game Boy-style
extreme quantization where 4×4 leaves visible chunk. Blue noise looks more modern and less
period; use it when you want dither texture without era signalling.

**Failure modes.**
- *Dither pattern is huge and blocky.* You applied it after upscaling. It must run at `res`.
- *Whole image got brighter or darker.* You forgot the `- 0.5` centring.
- *Dither invisible.* Applied in linear space before tone mapping, where the step sizes don't
  align with the display grid. Dither in display space, after sRGB encode.
- *Pattern crawls distractingly when the camera moves.* Screen-space dither is correct for
  console/CRT emulation — the real hardware's pattern was screen-locked and did crawl. If you
  want it stable, key the matrix off object-space UV instead, but know you've left accuracy.

---

## Palette quantization

Two approaches.

**Per-channel levels** (RGB555, RGB565, N-levels-per-channel). Cheap, no lookup, keeps hue
roughly intact. This is what actual framebuffers did.

**Nearest colour in a fixed palette** (Game Boy, C64, PICO-8). Requires a search. Options:
- Small palettes (≤16): unrolled loop over a `const vec3[]`, minimize squared distance.
- Larger or user-supplied: bake to a texture LUT — see `scripts/palette_lut.py`. Portable and
  avoids GLSL ES dynamic-indexing limits.

**Better than nearest-RGB:** searching in a perceptual space, or the two-closest-plus-dither
approach — find the two nearest palette entries and use the Bayer threshold to pick between
them per pixel. That produces genuine palette dithering (blended colours that don't exist in
the palette) rather than flat posterization, and is what good pixel artists did by hand.

Nearest-RGB distance is perceptually poor: it will happily swap a dark blue for a dark green
because they're close in RGB but far apart to a human eye. Weighting the distance roughly
`(0.3, 0.59, 0.11)` for luma, or comparing in Oklab, fixes most of it.

---

## Vertex lighting

Compute lighting per-vertex and interpolate the result, rather than interpolating the normal
and shading per-pixel. Produces visible faceting and the characteristic soft blotchy gradients
across large triangles.

```glsl
// vertex stage
vec3 n = normalize(normalMatrix * normal);
float d = max(dot(n, uLightDir), 0.0);
vColor = uAmbient + uLightColor * d;
```

Combine with baked vertex colours (`geometry.attributes.color`) for shadows — cut the shadow
shape into the mesh as extra geometry and darken those vertices. That is how those games did
it, and it reads correctly in a way that a real-time shadow map on low-poly geometry never
does: the shadow is *part of the world's shape*.

Per-pixel lighting on low-poly geometry is the strongest tell of modern-indie-pretending-to-be-
retro. If only one dial can be period-accurate, make it this one.

---

## Hard fog

Not atmospheric depth — a *draw distance concealer*. Sharp near/far, saturated colour matched
to the sky, and it should genuinely hide the end of the level.

```glsl
float f = clamp((uFogFar - vViewDepth) / (uFogFar - uFogNear), 0.0, 1.0);
color = mix(uFogColor, color, f);
```

Linear fog, not exponential — the hardware did linear. Then place level geometry so it fully
fades before it ends. Fog that doesn't hide anything reads as a filter.

---

## Stipple transparency

The PS1 had no alpha blending in the modern sense and no depth sorting for transparency.
Semi-transparent surfaces were faked with dithered discard patterns.

```glsl
if (bayer4(gl_FragCoord.xy) > uAlpha) discard;
```

This is both period-accurate *and* technically superior for a no-z-sort pipeline: discarded
fragments never enter the blend, so order doesn't matter. Use it for foliage, glass, fade-ins,
and ghost effects. It plays perfectly with the rest of the dither pipeline because it uses the
same matrix.

---

## Sort-order instability

The PS1 had no z-buffer; primitives were drawn in the order they were inserted into an
ordering table, so intersecting or coplanar geometry visibly flickers over which surface wins.

To emulate *without* creating an actual mess: keep the depth buffer on globally, but for a
chosen subset of objects set `material.depthWrite = false` and sort by object-centre distance
with a coarse quantization (e.g. bucket depth into 32 steps). The bucketing makes near-equal
objects swap order as the camera moves, which is the visible artefact, while everything else
stays sane.

Do not actually disable the depth buffer. That produces garbage, not nostalgia.

---

## CRT signal chain

Apply at output resolution, after upscaling. Order matters:

1. **Barrel distortion** — warp the sample UV, not the output. Coefficient ~0.02–0.10; the
   commonly cited range for realistic curvature is mild. Everything after this samples through
   the warped UV, so it must come first.
2. **Chroma offset** (composite only) — sample R/G/B at slightly different UV offsets, ~0.5–2
   output pixels horizontally. This is what dot crawl and colour fringing come from.
3. **Scanlines** — a periodic darkening in *virtual scanline* space, i.e. `res.y` lines, not
   output pixels. Brighter pixels should produce wider beams: modulate line width by luminance,
   which is what makes real CRTs look bright rather than dim.
4. **Phosphor mask** — RGB stripe (aperture grille / Trinitron), triangular (shadow mask), or
   slot mask. In *output device pixel* space.
5. **Halation / bloom** — bright areas bleed into neighbours. Separate blurred buffer, added
   back. This is the step that makes a CRT look *lit* rather than *printed*.
6. **Vignette** and slight corner darkening.

**Mask gating is mandatory.** A phosphor mask needs ≥3× output scale to resolve into
individual stripes. Below that it aliases into moiré and a screen-door effect that looks worse
than no mask. Check `devicePixelRatio × integerScale` and fall back to scanlines + halation
alone. Ship both paths; do not assume a high-DPI display.

**Brightness compensation.** Scanlines plus a mask can remove 50%+ of total luminance. Real
CRTs were bright. Multiply the whole result back up (typically 1.4–2.0×) and clamp, or the
scene just looks dim and muddy.

---

## VHS

Composite chain plus:
- **Chroma lag** — sample chroma from a UV offset several pixels to the left; luma stays put.
  This is the single most identifiable VHS artefact.
- **Head-switching noise** — a band of horizontal displacement in the bottom ~15 lines.
- **Tracking noise** — occasional horizontal bands of displacement + desaturation, drifting
  vertically over time.
- **Tape wow** — slow low-frequency horizontal offset, sub-pixel amplitude.

Keep tracking-noise frequency below 3 Hz and amplitude modest, or it becomes both an
accessibility hazard and unreadable. Gate the whole set behind `prefers-reduced-motion`.

---

## Phosphor persistence

For vector displays and long-persistence monitors: render into a persistent buffer, fade it
each frame rather than clearing.

```
accum = max(accum * decay, currentFrame)     // decay ≈ 0.85–0.95
```

Use `max` rather than `mix` so bright new content isn't dimmed by the old frame. Needs two
render targets ping-ponged. This is the effect that makes vector graphics feel *analogue*, and
it costs almost nothing.

---

## 3-point filtering

The N64's distinctive filter samples three texels of the bilinear quad rather than four,
choosing the triangle based on which side of the diagonal the sample falls. It keeps diagonals
crisper than bilinear while still being smooth.

```glsl
vec2 t = uv * texSize - 0.5;
vec2 f = fract(t);
vec2 base = (floor(t) + 0.5) / texSize;
// pick the triangle
vec2 o = (f.x + f.y > 1.0) ? vec2(1.0) : vec2(0.0);
vec4 c0 = texture2D(map, base + o / texSize);
vec4 c1 = texture2D(map, base + vec2(1.0, 0.0) / texSize);
vec4 c2 = texture2D(map, base + vec2(0.0, 1.0) / texSize);
vec2 w  = abs(f - o);
vec4 col = c0 + w.x * (c1 - c0) + w.y * (c2 - c0);
```

Set the texture to `NearestFilter` in three.js so the hardware doesn't filter first — you are
replacing hardware filtering, not layering on top of it.

---

## Chrome and gloss

Y2K and Frutiger Aero both need specular, but different specular.

**Y2K chrome:** a vertical gradient ramp sampled by the reflected view direction's Y
component, with a hard light/dark boundary near the horizon. Not physically based — it's a
matcap. `MeshMatcapMaterial` gets you most of the way; a hand-authored 128×128 chrome matcap
does the rest. Add a blown-out white specular blob with no roughness falloff.

**Frutiger Aero gloss:** broad, soft, high-key. Bright ambient, a large low-intensity
specular, a rim light, bloom on anything above ~0.9 luma, and a background that is a *light
source* rather than a colour — big soft diagonal gradients. Restraint is the whole aesthetic:
one glossy element against a calm field, not glossy everything.

---

## Effect ordering summary

```
VERTEX STAGE      snap → affine UV setup → vertex lighting → fog factor
FRAGMENT STAGE    3-point sample → vertex colour → fog mix → stipple discard
POST @ res        tone map → sRGB encode → dither → quantize
UPSCALE           nearest, integer
POST @ output     barrel → chroma offset → scanlines → mask → halation → vignette → brightness
UI                composited last, outside the whole chain
```

Two rules hold this together: **quantization belongs to the virtual device** (before upscale)
and **the signal chain belongs to the physical display** (after upscale). Everything else is
taste.

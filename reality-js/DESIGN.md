# reality.js design

This document explains how reality.js turns a `.real` file into images and
video, why it is built this way, how its correctness is checked, and what
it does not do.

## Goal

Make images and motion that read as photographs and film, from a short
text description, in a browser, with no build step and no dependencies.

"Reads as a photograph" comes down to a few physical things that
rasterisers approximate and a path tracer gets right by construction:

| What the eye notices | Where it comes from | In reality.js |
|---|---|---|
| Soft, correctly shaped shadows | Area lights and the sun's disk | Every light has a size; shadows are sampled, not mapped. |
| Light bouncing between surfaces | Global illumination | Paths bounce up to 64 times. |
| Glass and water that bend light | Refraction, Fresnel, absorption | Rough dielectric BSDF, Beer-Lambert tint. |
| Believable daylight | Atmospheric scattering | Rayleigh + Mie + ozone sky with a physical sun. |
| Camera character | Lens, aperture, shutter, sensor | Thin lens, aperture blades, shutter-time motion blur, rolling shutter, exposure triangle. |
| Film look | Tone response, grain, glare | AgX tone mapping, grain, bloom, halation, natural vignetting. |
| Real motion | Physics | Closed-form gravity, springs and pendulums as functions of time. |

## Where it sits next to three.js

three.js is a real-time scene graph over WebGL/WebGPU. It renders
interactive scenes at 60 fps by rasterising triangles and approximating
light (shadow maps, environment probes, screen-space effects). Path
tracing is available for it through third-party add-ons.

reality.js makes the opposite trade: it is a progressive path tracer.
A frame takes seconds to minutes instead of milliseconds, and in return
the light transport is physically based out of the box, the camera is a
physical camera, and motion blur is exact rather than a post effect.

Use three.js for games, product configurators, anything interactive.
Use reality.js for stills and rendered video where the look matters more
than the frame rate, especially when you want to describe a shot in a few
lines of text.

## Pipeline

```
 .real text
    │  lang/lexer.js      tokens (units resolved: 50mm -> 0.05)
    │  lang/parser.js     syntax tree
    │  lang/evaluator.js  nodes, with Signals for anything that depends on t
    ▼
 Scene (scene/scene.js)   checked against scene/nodes.js schemas
    │  sample(time)       plain numbers at one instant
    ▼
 Reality (reality.js)     per frame: sample at shutter open and close,
    │                     build meshes (geometry/), compute the sky (sky/),
    │                     pack into float textures (render/pack.js)
    ▼
 Renderer (render/)       WebGL2 passes:
    trace ×N  ─►  accumulate colour, normal+depth, albedo (+ luminance²)
    denoise   ─►  5 à-trous iterations on demodulated illumination
    resolve   ─►  exposed HDR
    bloom     ─►  6-level down/up pyramid
    film      ─►  vignette, aberration, halation, white balance, AgX, grain
    ▼
 canvas ─► PNG (canvas.toBlob) or WebM (WebCodecs + video/webm.js)
```

## Decisions

### The language

- **Declarative nodes, not a scene-graph API.** A scene is a list of
  `kind { property: value }`. Creative users write what they want, not
  how to build it. The same nodes are what the JavaScript API produces.
- **Units in literals.** `50mm`, `1/48s`, `800lm`, `2700K`. Photographic
  and lighting quantities are easy to get wrong by a factor of 1000
  without them.
- **Degrees everywhere,** including trigonometry, as in OpenSCAD. Mixing
  radians and degrees is the most common mistake in creative code.
- **Time as a value.** `t` is a Signal; any expression that touches it
  becomes a Signal. Scenes are functions of time without callbacks, and
  the renderer can evaluate any instant in any order, which exact motion
  blur and random-access video frames both need. Loops and `if` must not
  depend on time, so the set of objects is fixed.
- **Schemas drive checking, errors and documentation.** `nodes.js` is the
  single source of truth. Unknown properties, wrong types and typos are
  reported with a location and a "did you mean". The reference section of
  LANGUAGE.md is generated from it, and a test fails if they drift apart.

### Light transport (render/trace.glsl.js)

- **Unidirectional path tracing with next-event estimation** toward the
  sun, the environment and one randomly chosen area light at every
  vertex, combined with BSDF sampling by the power heuristic.
- **Surfaces** use one layered model: clearcoat over either metal or
  specular-over-diffuse, all GGX with visible-normal sampling (Heitz 2018).
  Lobes are chosen by roughness-aware Fresnel, so rough surfaces do not
  turn into mirrors at grazing angles.
- **Transmission** uses a rough dielectric (Walter et al. 2007) with exact
  Fresnel, total internal reflection, Beer-Lambert absorption inside the
  medium, and a thin-sheet mode for windows.
- **Fog** is a homogeneous layer below a height, traced with free-flight
  distance sampling and a Henyey-Greenstein phase function; it gets the
  same light sampling as surfaces, which is what produces light shafts.
- **Motion blur** is exact per path. Each object stores its inverse
  transform at shutter open and close; each path picks a time and
  interpolates. Camera motion works the same way. Interpolating inverse
  matrices is exact for translation and very close for rotation over a
  shutter interval.
- **Primitives are intersected in object space** (unit sphere, unit box,
  and so on) after one matrix transform, so every object can be moved,
  rotated and non-uniformly scaled at no extra cost. Meshes use a binned
  SAH BVH (geometry/bvh.js), also in object space, so they are instanced
  and motion-blurred the same way.
- **Environment lighting** is importance sampled from a luminance CDF
  (sky/envmap.js). The procedural sky is computed on the CPU into an
  equirectangular map (sky/atmosphere.js), and the sun is a separate
  light with its real angular size.

### Physical units

Everything is in SI and photometric units: metres, lumens, nits and lux.
The sky model outputs radiance in nits, with the sun at about 128,000 lux
above the atmosphere. Camera exposure follows the saturation-based EV
convention used in photography, so a manual camera at f/16, 1/100 s,
ISO 100 exposes a sunlit scene correctly (a unit test checks the "sunny
16" rule). A bulb in lumens next to the sun in lux has the right relative
brightness without tuning.

### Noise

Path tracing is noisy at low sample counts. Three things keep previews
usable:

- An **edge-aware à-trous denoiser** (Dammertz et al. 2010) on
  illumination divided by albedo, guided by normals and depth. Its
  luminance tolerance comes from the per-pixel variance of the mean, blurred
  3×3 (the SVGF idea), so it smooths hard at first and fades out by itself
  as samples accumulate.
- A **firefly clamp** on indirect light only, set in display units.
- **Adaptive preview batching** measured with a GPU sync, so the page
  stays responsive while rendering.

### Video

MediaRecorder timestamps frames by wall-clock time, which is wrong for
frames that take seconds each. reality.js encodes each finished frame with
WebCodecs (VP9, falling back to VP8) at its exact timestamp, and writes the
WebM container itself (video/webm.js, about 130 lines). Browsers without
WebCodecs get PNG frames instead.

## How correctness is checked

`npm test` (74 tests, about 1 second) covers the language, the scene
model, the physics helpers, camera and exposure maths, BVH construction
against brute force, mesh generation and OBJ parsing, the sky model, HDR
round trips, environment importance sampling (the pdf integrates to 1 and
a Monte Carlo estimate matches direct integration), GPU data packing, the
WebM writer, and that the documentation matches the code.

`npm run test:browser` (10 tests) renders in headless Chromium on
SwiftShader, so it needs no GPU:

- **White furnace tests.** A white diffuse, mirror, or glass sphere inside
  a uniform environment must be invisible. Energy gain or loss anywhere
  in the integrator makes the sphere show.
- The sky is blue at the zenith, manual exposure responds to ISO, motion
  blur widens a moving object, files load, errors are formatted, and the
  WebM output plays in a `<video>` element with the right size and length.

## Limitations

- **Speed.** It is a path tracer, not a real-time renderer. On SwiftShader
  (Chromium's CPU fallback, which the tests use) a 640×360 frame at 96
  samples took about 2 minutes for the golden-hour example. A hardware GPU
  should be far faster, but that has not been measured for this repository.
- **Scale.** Objects are tested one after another (there is no top-level
  BVH), so hundreds of objects are fine and tens of thousands are not.
  Put many small parts in one mesh.
- **Materials.** No subsurface scattering, sheen or anisotropy. Only base
  colour can come from an image; roughness and normal maps are procedural.
- **Light.** Caustics (light focused through glass onto a surface) come
  only from paths that happen to find the light, so they converge
  slowly. Glowing boxes, cylinders and meshes are not sampled directly.
- **Sky.** Single scattering only, so the sky is somewhat darker and more
  saturated than a real one. Night sky, moon and stars are not modelled.
- **Fog.** One homogeneous layer; no clouds or smoke.
- **Formats.** Wavefront OBJ and Radiance HDR only; no glTF yet.
- **Bias.** The denoiser and the firefly clamp trade a little accuracy for
  speed; turn both off (`film { denoise: false, clamp: 0 }`) for reference
  renders.

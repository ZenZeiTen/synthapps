---
name: reality-js
description: Write, check, render and speed up scenes in reality.js, the .real scene language and physically based path tracer for photoreal stills and rendered video in the browser. Use this whenever the user wants a photographic image or film-like clip described in text, mentions reality.js, .real files, the reality.js playground or live demo, or asks for a path-traced shot with real camera settings (lens, f-stop, shutter, ISO), a physical sky or golden hour, studio lighting, bokeh, god rays, fog, glass, water, motion blur, or physics motion (bounce, spring, pendulum, hand-held camera), even if they do not name reality.js. Also use it to fix scene errors, dark, blown-out or noisy renders, to cut render time, to embed the Reality JavaScript API in a page, or to extend the renderer (new properties, shader changes that must compile on Direct3D).
---

# reality.js

reality.js turns a short `.real` text file into images and video that behave
like photographs: path-traced light in real units, a physical camera, and
exact motion blur. It lives in the `reality-js/` folder of the synthapps
repository. It is an offline renderer: seconds to minutes per frame. For
anything interactive at 60 fps, three.js is the right tool instead.

The files you will use:

| Path (inside `reality-js/`) | What it is |
|---|---|
| `LANGUAGE.md` | The language guide and full reference (800 lines; read sections, not all). |
| `examples/*.real` | Seven working scenes. |
| `tools/render.mjs` | Command-line renderer (headless Chromium through Playwright). |
| `playground/`, `demo/` | Browser editor with live preview; the interactive benchmark page. |
| `src/index.js` | The JavaScript API. |

This skill adds, next to this file:

| Path | Use it for |
|---|---|
| `scripts/check.mjs` | Compile a scene in Node without a GPU. Reports errors with a caret and "did you mean", warns about exposure, lights, bounces and object count, lists the shader features the scene switches on, and estimates render time. |
| `references/cheatsheet.md` | Every property of every node kind, one line each (generated from the schemas, so it is exact). Read it instead of the long reference. |
| `templates/*.real` | Tested starting points: studio product, golden hour, night bokeh, interior sunbeams, turntable video, physics motion, landscape. |
| `references/embedding.md` | Using the JavaScript API in a page. |
| `references/extending.md` | Changing the language or the renderer without breaking it. |

## The working loop

Every scene goes through the same five steps. The check and the draft render
are cheap, so do them every time: they catch almost every mistake before an
expensive render does.

1. **Start from the closest template or example.** Copy it next to where the
   scene should live (inside `reality-js/`, because the renderer serves files
   from there). A template already has the exposure, lighting and render
   settings right for its kind of shot, which is most of the work.
2. **Edit the scene.** Look up exact property names in
   `references/cheatsheet.md` rather than guessing.
3. **Check it.**
   `node <skill>/scripts/check.mjs path/to/scene.real`
   Fix every error. Read every warning: each one names a real cause of a dark,
   noisy or slow render. The estimate tells you whether the final render fits
   the time you have.
4. **Draft render and look at it.**
   `node tools/render.mjs path/to/scene.real -o draft.png --samples 32 --size 480x270`
   Look at the image (read the PNG file) and judge framing, exposure, light
   direction and materials.
   Noise is expected at 32 samples; judge everything else. Iterate on steps
   2 to 4 until the draft looks right.
5. **Final render** at the size and quality asked for (see "Speed" below to
   choose samples). Tell the user the command, the file, and the time taken.

Run `render.mjs` from inside `reality-js/`. It uses the CPU renderer
(SwiftShader) unless you pass `--gpu`, which needs a real GPU that Chromium
can reach; cloud containers have none. If Playwright is missing, say so and
suggest `npm i -D playwright` rather than working around it.

## Writing scenes

A scene is a list of `kind { property: value }` nodes. Anything left out
takes a sensible default. The smallest useful scene:

```
sky { sun_elevation: 35 }
ground { }
sphere { position: [0, 1, 0], radius: 1, material: plastic { color: #d24a2c } }
```

Rules that matter most, because breaking them gives wrong results rather
than errors:

- **Units.** Lengths are metres; write units when it helps (`20cm`, `50mm`,
  `1/60s`, `800lm`, `2700K`). The camera `lens` without a unit is read as
  millimetres with a warning, so write `lens: 50mm`.
- **Angles are degrees everywhere,** including `sin()`/`cos()`: `sin(t * 90)`
  is a quarter turn per second.
- **Colours** in hex, `rgb()` and `hsl()` are sRGB; `gray(0.5)` and bare
  numbers are linear. Metals take named colours: `gold`, `copper`, `brass`,
  `chrome`, `aluminium`, `silver`, `iron`, `titanium`.
- **Comments** are `#` or `//`, but `#` followed by 3 or 6 hex digits is a
  colour, so always leave a space: `# abc` not `#abc`.
- **Choices** are bare words: `pattern: marble`, `exposure: manual`,
  `focus: auto`, `tonemap: aces`.
- **Reuse** with `let`: `let brass_trim = metal { color: brass }`. A named node
  used as a kind makes a copy with changes: `ball { position: [1, 0.2, 0] }`.
- **Loops and `if` must not depend on time** (`t`): they decide which objects
  exist. For values that change, use `cond ? a : b` or functions of `t`.
- **Settings nodes** (`camera`, `sky`/`hdri`/`background`, `fog`, `film`,
  `timeline`, `render`) appear once; a second one replaces the first.
- **Geometry of mesh kinds** (`torus`, `mesh`, `terrain`, `rock`: their radius,
  tube, size, seed and so on) is built once and must not change with `t`. Move,
  rotate or scale them instead, or put them in a `group` that moves.
- Axes: +Y is up, the default camera looks toward −Z. `sun_azimuth` 0 is north
  (−Z), 90 is east (+X), 180 is behind the default camera.

## Getting the look

Decide three things first, in this order, because they set everything else:
the light, the camera, the exposure.

**Light.** Pick the environment, then add practical lights.

| Shot | Environment and lights |
|---|---|
| Daylight exterior | `sky { sun_elevation: 30-50 }`. Hard shadows; add `sun_size: 3-8` for softer ones. |
| Golden hour | `sky { sun_elevation: 3-12, sun_azimuth: toward the side }`, `haze: 1.2-2`. Side or back light reads best. |
| Sunset | `sun_elevation: 0-2`. The sky model is daytime only; below 0 it goes dark, with no moon or stars. |
| Studio product | `background { intensity: 30-60 }` as a dim fill plus `softbox` key, fill and rim. Template `studio-product.real`. |
| Studio with a real HDR | `hdri { src: "file.hdr", rotate: ... }`. Paths are relative to the scene file. |
| Night or low light | `background { color: #1a2440, intensity: 0.1-1 }`, `bulb`s in lumens, and **manual exposure**. Template `night-bokeh.real`. |
| Sunbeams, haze, mist | `fog { density, anisotropy: 0.5-0.8, height }` below the roof line. Beams need the sun to pass through gaps. Template `interior-sunbeams.real`. |

Lights are in real units, so real-world numbers work: a 60 W bulb is about
800 lm, a desk lamp 400 lm, a photo softbox 4,000 to 10,000 lm; candle flame
1,800 K, tungsten 2,700 K, daylight 5,600 K. `bulb`, `softbox`, and a `light`
material on a `sphere`, `quad` or `disk` are sampled directly and converge
fast. Lights are visible to the camera like real ones, so keep softboxes
outside the frame (the frame-size rule below tells you where its edges are)
unless you want them in the shot. A glowing `box`, `cylinder`, or mesh also lights the scene, but noisily;
the checker warns about it.

**Camera.** Choose the lens as a photographer would.

| Shot | lens | aperture |
|---|---|---|
| Wide landscape, interior | 16-24mm | f/8-f/11 |
| Street, environmental | 35mm | f/4-f/8 |
| Natural view | 50mm | f/2.8-f/5.6 |
| Portrait, product | 85-105mm | f/1.4-f/2.8 for soft background, f/5.6-f/8 for all sharp |
| Compressed telephoto | 135-200mm | f/2.8-f/4 |

**Frame before you light.** At distance d, a lens of focal length f on the
default 36mm sensor shows a frame d × 36 / f wide, and 9/16 of that high at
16:9. An 85mm lens at 2 m frames only 0.85 m. Make the subject fill about a
third to two thirds of the frame, and set the distance from that before
anything else. It is the most common reason a first draft looks wrong.

Focus goes on `look_at` by default (`focus: auto`); set `focus: 2.4m` when the
subject is not at `look_at`. `blades: 6-9` turns out-of-focus highlights into
polygons, which sells the lens look at night.

**Exposure.** `exposure: auto` (the default) meters to mid-grey, which suits
daylight, studio and anything evenly lit. Use `exposure_compensation: -1`
to +1 to bias it. Use `exposure: manual` whenever darkness is part of the
picture, such as night, low-key or silhouettes: auto would lift it to
daylight. Starting points for manual exposure:

| Scene | aperture | shutter | iso |
|---|---|---|---|
| Sunny day ("sunny 16") | f/16 | 1/100s | 100 |
| Overcast or shade | f/8 | 1/250s | 400 |
| Bright interior | f/2.8 | 1/60s | 800 |
| Subject 1-2 m from a household bulb | f/1.4-f/2 | 1/60s | 400-800 |
| Night street, distant lamps | f/1.4-f/2 | 1/60s | 1600-3200 |

To work it out instead of guessing: a bulb of P lumens gives about
P / (12.6 d²) lux at d metres; light of E lux wants EV100 ≈ log2(E / 2.5);
a setting gives EV100 = log2(N² / shutter) − log2(iso / 100). For example,
800 lm at 1.4 m is about 32 lux, so EV100 3.7: f/1.4, 1/60s, iso 800. Each
stop off is a factor of 2 in iso.

**Film.** `film { }` is the lab: `tonemap: agx` (default, holds colour in
highlights), `white_balance` in kelvin (default 6,500; set about 3,200 to
make tungsten light look neutral, or leave it for a warm look), `grain: 0.1-0.3`,
`bloom`, `halation` and `vignette`. Keep these subtle; they are seasoning.

Bloom and halation scale with how bright the highlights are, and a lamp
seen directly is thousands of times brighter than the rest of the frame:

| Brightest thing in frame | bloom | halation |
|---|---|---|
| Daylight, studio, sun only in reflections | 0.02-0.08 | 0-0.2 |
| The sun itself, or bulbs, lamps and softboxes in view | 0.003-0.01 | 0 |

Too much of either spreads an orange haze over the whole frame. If a night
render looks foggy without fog, set bloom 0.005 and halation 0 first.

**Materials.** Use the named kinds, then tune. `matte` is paper, plaster and
clay. `plastic` is paint and ceramics. `metal { color: gold, roughness: 0.1-0.4 }`.
`glass { tint: #ffb870, tint_distance: 0.08 }` is coloured glass. `water`
has moving ripples built in. Use `clearcoat: 0.6-1` for car paint or
lacquer, and `thin: true` for window panes and bubbles. For surface
variety at no memory cost, use a `pattern` (`noise`, `marble`, `wood`,
`checker`, `grid`, `stripes`) with `color2`, or `bump` for fine relief.
Real-world roughness beats extremes: almost nothing is exactly 0 or 1.

## Motion and video

`t` is time in seconds. Anything computed from it moves, and motion blur is
exact because the renderer samples many instants inside each frame's
shutter.

- **Physics helpers** are free and look right: `bounce(t, height, restitution, start)`,
  `fall(t, height, start)`, `spring(t, from, to, frequency, damping, start)`,
  `pendulum(t, length, amplitude, start, damping)`,
  `orbit(t, center, radius, period, phase)`,
  `wobble(t, amount, frequency, seed)` (hand-held camera; 1-3cm).
- **Keyframes:** `position: keys { 0s: [0,0,0]  1.5s: [2,0,0] ease out  3s: [2,2,0] ease back_out }`.
- **Turntable:** put the object in `group { rotate: [0, t * 360 / seconds, 0] ... }`.
- `timeline { duration: 4s, fps: 24, time: 1.2s }`. `time` is the moment a
  still shows, so pick a frame with visible motion for previews.
- Leave `shutter` at its default (half a frame, the 180° film look) unless the
  user wants frozen action (`1/1000s`) or streaks (`1/15s`).
- Render video with `--video -o clip.webm`, or `--frames dir/` for PNGs.
  `--samples` sets samples per frame for video too. Check single frames
  first (`--time 1.2 --samples 32`), then a draft clip
  (`--video --size 480x270 --samples 16`), then the final one.

## Speed: budget before you render

The cost of a render is the number of light paths: width × height × samples,
times the frame count for video. The checker prints it with time estimates.
Measured throughput:

| Renderer | Paths per second |
|---|---|
| GPU (RTX 4050 laptop, Chrome, Direct3D 11) | 60-130 million (fog and glass at the low end) |
| CPU, SwiftShader (`render.mjs` without `--gpu`, cloud containers) | about 0.3 million |

So a 1280×720 still at 512 samples is 472 million paths: about 4-8 seconds
on that GPU, and about 26 minutes on the CPU. Plan for that difference.
With no GPU, draft at 480×270 and 32-64 samples, and keep final renders
modest unless the user has asked for high quality and accepts the time.

Estimate a planned render before starting it: pass the same overrides to the
checker, for example `check.mjs clip.real --size 320x180 --samples 16`.
The 0.3 million figure is for an idle machine; a shared CPU can be 3 to 5
times slower. So measure: `render.mjs` prints the time of your draft still,
and width × height × samples ÷ seconds is this machine's real speed. Pass it
to the checker as `--cpu-speed` (millions of paths per second) to get honest
estimates for the rest. When the user gives a time limit, choose size,
samples and clip length so the estimate at the measured speed is at most
half of it. A 3-second draft clip at 320×180 and 16 samples is about 66
million paths: 4 minutes on an idle CPU, 10 to 20 on a busy one.

The knobs, with the biggest effect first:

1. **Resolution.** Cost grows with pixel count: halving width and height cuts
   cost by 4x.
2. **Samples.** Typical needs: open daylight 128-256; studio 256-512;
   night with small bulbs, glass or caustics 512-1024; fog 512-2048. The
   denoiser (`film { denoise: true }`, on by default) makes low counts usable.
   Video frames need fewer (`video_samples: 32-64`), because motion hides
   noise.
3. **Features used.** The shader is compiled with only what the scene needs:
   `HAS_MESH` (torus, mesh, terrain, rock), `HAS_FOG`, `HAS_LIGHTS`
   (directly sampled lights), `HAS_TEXTURES`, `HAS_PATTERNS` (pattern or bump).
   Fog costs the most. Do not add fog for mood unless the shot needs air.
4. **Object count.** Every ray tests every object, because there is no
   top-level acceleration structure. Hundreds of objects are fine and
   thousands are not. Many small parts belong in one `.obj` `mesh`, which
   has its own BVH.
5. **Bounces.** The default of 8 is right for glass and interiors. Open
   exteriors look the same at 4-5. More than 12 costs time for nothing
   visible.

Noise that does not go away with more samples usually has a cause worth
fixing instead: a glowing box used as a lamp (use a `softbox`), a tiny
bright light seen only through glass (caustics; enlarge it or accept
some noise), or `film { clamp: 0 }` letting fireflies through (keep the
default 12).

## When something looks wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| Night scene looks like daylight | Auto exposure | `exposure: manual` with the night settings above. |
| Everything black or white | Manual exposure off by many stops, or lights 1000x off (lm vs W) | Check units; try auto exposure to confirm the scene is lit at all. |
| Harsh, contrasty studio | A single small light | Make the softbox larger, closer, or add a fill at 1/3 of its power. |
| Dull or flat | Light from the camera direction | Move the sun or key to the side or behind (`sun_azimuth` 60-120° off the camera axis). |
| Glass looks dark or flat | Too few bounces, or nothing around it to refract | `bounces: 8`, and give the glass something to show: a sky, lights, or patterned surroundings. A plain `background` makes clear glass nearly invisible. |
| Speckles (fireflies) | Small, bright lights reached indirectly | Keep `clamp` on, enlarge the light, add samples. |
| Object missing | Inside another object, below the ground, or behind the camera | Check positions: `ground` is at y = 0 and sphere positions are centres. |
| Nothing moves in the video | No `t` in the scene, or motion in a `repeat` range or `if` | Use `t` in property values. |
| `render.mjs`: "scene must be inside the reality-js folder" | Scene saved elsewhere | Move it under `reality-js/`. |
| Browser: the driver refused the shader | A GPU (often Direct3D) rejects the shader | The page reports the driver log; see `references/extending.md`. |

## Answering the user

Show the scene code (it is short, and it is the product), the command you
ran, where the files are, and the render time. If you rendered on the CPU,
say so and give the GPU estimate, so the user knows what their own machine
will do. If a warning from the checker still applies (for example, fog at
low samples), say what it means for the image in one line.

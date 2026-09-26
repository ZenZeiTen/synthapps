# three.js r18x — API state and stale-knowledge traps

Read this before writing three.js code. Model training data on three.js goes stale fast — the
library ships roughly monthly and has renamed large parts of its post-processing and shader
layers within the last several revisions.

**Contents**
- [Version check first](#version-check-first)
- [Which renderer](#which-renderer)
- [Verified rename table](#verified-rename-table)
- [Post-processing: RenderPipeline](#post-processing-renderpipeline)
- [What three.js already ships](#what-threejs-already-ships)
- [The low-res render target](#the-low-res-render-target)
- [Colour space and where dithering belongs](#colour-space-and-where-dithering-belongs)
- [GLSL ES constraints that break ported tutorials](#glsl-es-constraints-that-break-ported-tutorials)
- [Performance API notes](#performance-api-notes)
- [Confidence](#confidence)

---

## Version check first

Do this before anything else, and state the result:

```bash
npm ls three   # or check the importmap / CDN pin
```

The facts below are drawn from the official migration guide covering r152 → r185. If the
project is on an older revision, walk the guide *backwards* from the project's version rather
than assuming. If it's on a newer one, check the guide for entries above r185.

Anchor point: **`three@0.185.1` (r185) was the latest npm release as of 26 July 2026**, verified
against the npm registry; r184 shipped 16 April 2026. Do not hardcode a "latest version" claim
in a user-facing answer — re-check, since this moves roughly monthly:

```bash
curl -s https://registry.npmjs.org/three/latest | grep -o '"version":"[^"]*"'
```

---

## Which renderer

Two live paths. This decision drives everything downstream, so make it first.

### `WebGPURenderer` (from `three/webgpu`) — default choice for new work

- Automatically falls back to WebGL2 when WebGPU is unavailable, so choosing it is low-risk.
- **Required** for `NodeMaterial` and TSL. The legacy `WebGLNodeBuilder` that allowed limited
  node usage on `WebGLRenderer` was removed in r164 — nodes and `WebGLRenderer` do not mix.
- Shaders authored in TSL compile to both WGSL and GLSL, so one shader serves both backends.
- Since r181, `renderAsync()` / `computeAsync()` and friends are deprecated. Either let
  `renderer.setAnimationLoop()` initialize the renderer for you, or `await renderer.init()`
  explicitly before calling sync methods — the latter is needed for on-demand rendering or
  feature detection.

```js
import * as THREE from 'three/webgpu';
import { pass, uniform, vec3 } from 'three/tsl';
```

### `WebGLRenderer` (from `three`) — choose for maximum shader certainty

- Raw GLSL via `ShaderMaterial` / `RawShaderMaterial`. Every GLSL snippet on the internet
  works here; TSL node names change between revisions and shader snippets don't.
- No WebGL 1 support since r163.
- `PCFSoftShadowMap` deprecated since r182 — use `PCFShadowMap`, which is now soft.
- For this skill's purposes this is the **verified** path: `assets/retro-glsl.js` targets it
  and can be dropped in without checking node names.

**Recommendation for retro work specifically:** these effects are small, hand-written, and
artefact-dependent. Shader-level certainty is worth more than compute shaders you won't use.
Start on `WebGLRenderer` unless the project already needs WebGPU (compute, very high instance
counts, or an existing TSL codebase).

---

## Verified rename table

From the official migration guide. These are the ones most likely to appear wrong in
generated code.

| Old | New | Since |
|---|---|---|
| `PostProcessing` | `RenderPipeline` | r183 |
| `EffectComposer` (node path) | `RenderPipeline` | r183 |
| `Clock` | `Timer` (now in core, no add-on import) | deprecated r183; moved to core r179 |
| `RGBELoader` | `HDRLoader` | r180 |
| `RGBMLoader` | removed — use `EXRLoader` / `HDRLoader` / `UltraHDRLoader` | r180 |
| `PCFSoftShadowMap` (WebGL) | `PCFShadowMap` | deprecated r182 |
| `MeshGouraudMaterial` | `MeshLambertMaterial` | r173 |
| `CapsuleGeometry({ length })` | `CapsuleGeometry({ height })` | r176 |
| `WebGLMultipleRenderTargets` | render target `count` property | r162 |
| `Controls.connect()` | requires a DOM element argument | r175 |
| `outputEncoding` | `outputColorSpace` | r152 |
| `Texture.encoding` | `Texture.colorSpace` | r152 |
| `uv2` attribute | `uv1` (naming shifted down by one) | r152 |

TSL-specific renames. **Verified against `three@0.185.1` by inspecting the real module.** Note
the first two rows: the migration guide's wording is misleading and will send you to a
non-existent import.

| Old | New | Since | Verified reality in r185 |
|---|---|---|---|
| `varying()` | `toVarying()` | r173 | **Free function is still `varying`.** `toVarying` is the *chained method* (`node.toVarying()`). `import { toVarying }` **fails** |
| `vertexStage()` | `toVertexStage()` | r173 | Same shape: free function `vertexStage`, method `.toVertexStage()` |
| `label()` | `setName()` | r179 | Both present as methods; `label` deprecated |
| `TextureNode.uv()` | `TextureNode.sample()` | r172 | `.sample` present, `.uv` gone — clean rename |
| `viewportTopLeft` | `viewportUV` | r168 | `viewportTopLeft` gone — clean rename |
| `viewportBottomLeft` | `viewportUV.flipY()` | r168 | gone |
| `uniforms()` | `uniformArray()` | r168 | `uniforms` gone — clean rename |
| `burn/dodge/screen/overlay` | `blendBurn/blendDodge/blendScreen/blendOverlay` | r171 | old names gone — clean rename |
| `PI2` | `TWO_PI` | r181 | **both still exported**; `PI2` is a deprecated alias, not removed |
| `storageObject()` | `storage().setPBO(true)` | r171 | |
| `PassNode.setResolution()` | `setResolutionScale()` | r181 | **both still present**; old one deprecated |
| `PostProcessingUtils` | `RendererUtils` | r172 | |

The general lesson: the migration guide says "renamed" for both hard removals and soft
deprecations, and for both free functions and chained methods. Check the actual module before
trusting a rename:

```js
import * as TSL from 'three/tsl';
console.log('symbolName' in TSL);              // free function?
console.log(typeof TSL.float(1).methodName);   // chained method?
```

**TSL chaining was removed in r168** for tree-shaking. Effects are now free functions:

```js
// wrong (pre-r168)
outputPass.fxaa()
// right — and note fxaa is NOT in three/tsl, it is an addon:
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
fxaa( outputPass )
```

This composes nicely for signal chains, since the call order reads the same as the execution
order: `vignette( scanlines( barrel( scenePass ) ) )` runs barrel first.

Most display effects live in `three/addons/tsl/display/`, not in `three/tsl` — see the
inventory below before writing one yourself.

---

## Post-processing: RenderPipeline

WebGPU/TSL path only.

```js
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';

const renderPipeline = new THREE.RenderPipeline( renderer );
const scenePass = pass( scene, camera );
renderPipeline.outputNode = myRetroChain( scenePass );

// in the animation loop, instead of renderer.render():
renderPipeline.render();
```

Node graph rather than a linear chain, so multiple effects can read the same source without
re-rendering it. Useful here: the halation/bloom branch and the direct branch both read the
scene pass once.

For `WebGLRenderer`, do not reach for `EffectComposer` for a 4-effect retro chain. Hand-rolled
render targets plus one or two full-screen quads is less code, one fewer dependency, and gives
exact control over where the upscale happens — which for this skill is the whole game. See
`assets/retro-glsl.js`.

---

## What three.js already ships

**Check this before writing any retro effect from scratch.** r185 ships far more of this
than most training data reflects — `RetroPassNode` and `CRT.js` are recent additions. All
paths below were verified to resolve against `three@0.185.1`.

### A complete PS1 pass, already written

```js
import { retroPass } from 'three/addons/tsl/display/RetroPassNode.js';
const scenePass = retroPass( scene, camera );
scenePass.setResolutionScale( 0.25 );
```

`RetroPassNode` does vertex snapping, affine texture mapping, a 0.25-scale render target,
`UnsignedByteType`, and `NearestFilter` — in one node. Its internals confirm the affine
derivation in `references/shader-cookbook.md` independently:

```js
_affineUv.assign( uv().mul( defaultPosition.w ) );   // the uv * w varying
_w.assign( defaultPosition.w );                      // the w varying
```

One caveat: it does **not** guard `w <= 0`, so vertices behind the camera can streak. The
GLSL path in `assets/retro-glsl.js` does guard it. If you hit streaking on geometry that
crosses the near plane, that is why.

### CRT signal chain

```js
import { barrelUV, barrelMask, colorBleeding, scanlines, vignette }
  from 'three/addons/tsl/display/CRT.js';
```

| Export | Signature |
|---|---|
| `barrelUV( curvature = 0.1, coord = uv() )` | warped sample UV |
| `barrelMask( coord )` | 0 outside the tube — multiply at the end |
| `colorBleeding( colorNode, amount = 0.002 )` | composite chroma smear |
| `scanlines( color, intensity = 0.3, count = 240, speed = 0, coord = uv() )` | `speed > 0` gives CRT roll — an accessibility hazard, leave at 0 |
| `vignette( color, intensity = 0.4, smoothness = 0.5, coord = uv() )` | |

### Other display nodes worth knowing

`pixelationPass`, `rgbShift`, `dotScreen`, `film`, `sepia`, `sobel`, `outline`, `afterImage`,
`bloom`, `anaglyphPass`, `parallaxBarrierPass`, `lut3D`, `chromaticAberration`, `godrays`,
`motionBlur`, `sharpen`, `transition`, `smaa`, `fxaa`, `traa`, `ssaaPass`, `gtao`, `ssr`.
All under `three/addons/tsl/display/`.

`posterize( color, steps )` is in core `three/tsl` — that is your per-channel quantizer.

### What is NOT shipped — write these yourself

- **Arbitrary-palette quantization.** Nothing exists. `assets/retro-tsl.js` has it.
- **Phosphor / aperture mask.** `CRT.js` has no mask. `assets/retro-tsl.js` has it.
- **Exact ordered dithering.** `three/addons/tsl/math/Bayer.js` exports `bayerDither`, but
  read its source before using it: it computes `mod(floor(x+1)*floor(y+1)*17, 16)/16`, which
  the file itself labels a "Simplified Bayer matrix approximation." Measured on a real GL
  driver it resolves to **9 distinct thresholds out of 16** and biases along the diagonal:

  ```
  shipped bayerDither          canonical Bayer 4x4
  [ 1,  2,  3,  4]             [ 0,  8,  2, 10]
  [ 2,  4,  6,  8]             [12,  4, 14,  6]
  [ 3,  6,  9, 12]             [ 3, 11,  1,  9]
  [ 4,  8, 12,  0]             [15,  7, 13,  5]
  ```

  It was written to break up ray-marching banding, and it is fine for that. It is the wrong
  pattern for period-accurate console dithering, where the even dispersion of the real matrix
  is the whole point. Use the closed-form `bayer4` / `bayer8` in `assets/retro-tsl.js` or
  `assets/retro-glsl.js` instead — both reproduce the canonical matrix exactly.



```js
const rt = new THREE.WebGLRenderTarget( 320, 240, {
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
  type: THREE.HalfFloatType,       // headroom before quantization
  depthBuffer: true,
  stencilBuffer: false,            // false by default since r163 anyway
  samples: 0                       // MSAA defeats the entire point
} );
```

Notes:
- `NearestFilter` on both min and mag. A single `LinearFilter` anywhere silently softens the
  whole look.
- `HalfFloatType` gives room to tone map before quantizing. Quantizing an already-8-bit buffer
  wastes the dither.
- `samples: 0`. Anti-aliasing and pixel art are mutually exclusive by definition.
- Resize handling: recompute `res` from the output size divided by the integer scale factor,
  not from a fixed constant, or the aspect ratio drifts on window resize.

---

## Colour space and where dithering belongs

This trips up almost every retro pipeline.

Since r152/r155: `renderer.outputColorSpace` and inline tone mapping apply **only when
rendering to the screen**, not when rendering to a render target. So a scene rendered into an
RT arrives at your post shader in linear space, untone-mapped.

The console dithered into its *display* framebuffer, in display space. So the correct order is:

```
linear scene → tone map → encode to sRGB → dither + quantize → upscale → signal → present
```

Dithering in linear space produces a visibly wrong pattern distribution: the dither is uniform
in linear values but human perception (and the 8-bit display grid) is roughly perceptual, so
shadows get over-dithered and highlights under-dithered.

In a custom `ShaderMaterial` doing the final present, three.js will not add the sRGB encode
for you — do it explicitly at the end of the fragment shader. `assets/retro-glsl.js` includes
the conversion.

---

## GLSL ES constraints that break ported tutorials

Most retro-shader tutorials online are HLSL (Unity) or Godot's shading language. Three things
do not port:

1. **`noperspective` does not exist in GLSL ES** — not in 1.00, not in 3.00. Every
   Unity/HLSL affine-texture tutorial uses the `noperspective` interpolation qualifier. You
   cannot. Use the multiply-by-`w` / divide-by-`w` varying pair instead — see
   `references/shader-cookbook.md`, which derives why it is mathematically equivalent.

2. **Dynamic indexing of uniform arrays is restricted** in GLSL ES 1.00 fragment shaders on
   some drivers. Palette lookups over a `uniform vec3 palette[N]` with a computed index can
   fail to compile on mobile. Either unroll with a constant-bounded loop, or put the palette
   in a 1D texture (the portable option — `scripts/palette_lut.py` generates one).

3. **`ShaderMaterial` without `glslVersion` is written in ES 1.00 style** (`attribute` /
   `varying` / `gl_FragColor` / `texture2D`). On WebGL2 three.js does not pass that through —
   it *transpiles* by prepending `#define attribute in`, `#define varying out`,
   `#define texture2D texture`, and remapping `gl_FragColor` to a declared out variable
   (`WebGLProgram.js`). So ES 1.00 source is the well-supported default path, but understand
   that a translation layer is running. Set `glslVersion: THREE.GLSL3` to write ES 3.00
   directly. Do not mix the two — the prologues differ and a mismatch produces confusing
   "undeclared identifier" errors.

Also worth knowing: three.js injects a large prologue of `#define`s into `ShaderMaterial`
sources. When a shader errors, the reported line number will not match your source line —
subtract the prologue length or set `renderer.debug.checkShaderErrors = true` and read the
annotated dump.

---

## Performance API notes

- `InstancedMesh` has `frustumCulled = true` by default since r151. If you move instances,
  call `computeBoundingSphere()` or they will be culled incorrectly.
- `BatchedMesh` requires `addInstance()` after `addGeometry()` since r166 — geometry added
  without it renders nothing.
- `renderer.info.render` reports draw calls and triangles. Watch `calls` for retro scenes;
  they are naturally low-triangle and often accidentally high-draw-call.
- `GPUStatsPanel` was removed in r169. Use the `stats-gl` package for GPU timing.

---

## Confidence

Everything in this file was re-verified on 26 July 2026 against a real `three@0.185.1`
install, on real graphics drivers — not recalled.

Test environment: headless-gl (ANGLE, GLSL ES 1.00) under Xvfb for the WebGL path; Dawn via
`@kmamal/gpu` on a lavapipe software Vulkan device (Mesa 25.2.8 / LLVM 20.1.2) for the
WebGPU path.

- **Fact — machine-checked.** The rename table (each symbol probed for existence and for
  free-function vs chained-method shape), the shipped-node inventory (every import path
  resolved), `posterize` location, and the `WebGLProgram` transpile behaviour (read from
  source).
- **Fact — measured on a GL driver.** All seven shader programs in `assets/retro-glsl.js`
  compile and link. Affine vs perspective-correct UVs differ on 97.8% of covered pixels at a
  shallow angle. The closed-form Bayer matrices match the canonical reference exactly on GPU
  readback; the shipped `bayerDither` measures 9 distinct thresholds of 16 on the same driver.
- **Fact — measured on a WebGPU device.** `assets/retro-tsl.js` renders end-to-end through
  `WebGPURenderer` with zero Dawn validation errors. The TSL graph emits four shader modules,
  all compiling through Tint with **0 errors and 0 warnings**. The emitted WGSL contains the
  Bayer recursion verbatim. A quantization ladder on a gradient (signal chain disabled) gives
  2→3, 4→5, 8→9, 16→16, 32→30, 64→60 distinct output values — monotonic and bounded by the
  requested level count, with the +1 at low settings being expected dither spill.
- **Fact — specification.** `noperspective` is absent from the GLSL ES 1.00 and 3.00 grammars.
- **Inference.** The colour-space ordering guidance is reasoned from documented r152/r155
  behaviour (output colour space applies only on screen render) plus how the hardware worked.
  Well-founded, but a conclusion rather than a quoted line.
- **Untested.** Performance figures. A software rasterizer says nothing about frame times, so
  the budget guidance in `references/web-craft.md` is engineering judgement, not measurement.
  Profile on real hardware before committing to a `res` and signal chain.

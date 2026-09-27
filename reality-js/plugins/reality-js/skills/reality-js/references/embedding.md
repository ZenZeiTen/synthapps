# Embedding reality.js in a page

reality.js is plain ES modules with no build step. Import from
`reality-js/src/index.js` (relative to the page) and serve the folder over
HTTP (`node tools/serve.mjs 8080`); `file://` pages cannot load modules.

## Minimal page

```html
<canvas id="c" width="960" height="540"></canvas>
<pre id="err"></pre>
<script type="module">
  import { Reality, RealityError } from './reality-js/src/index.js';

  const canvas = document.getElementById('c');
  // baseUrl: where relative paths in the scene (mesh src, textures, hdri) resolve.
  const reality = new Reality(canvas, { baseUrl: new URL('./scenes/', location.href).href });
  reality.onStatus = (msg) => { document.getElementById('err').textContent = msg ?? ''; };

  const source = await (await fetch('./scenes/shot.real')).text();
  try {
    await reality.load(source);          // compiles, loads files, builds meshes and sky
  } catch (err) {
    document.getElementById('err').textContent =
      err instanceof RealityError ? err.format(source) : String(err);
    throw err;
  }
  reality.start();                       // progressive preview, refines every frame
</script>
```

## The calls you need

| Call | What it does |
|---|---|
| `new Reality(canvas, { baseUrl, width, height })` | Creates the WebGL2 renderer. Throws if WebGL2 or float render targets are missing. |
| `await reality.load(source)` | Compiles and loads a scene. Throws `RealityError`; `err.format(source)` gives the line, caret and hint. `reality.warnings` has the warnings. Calling it again with edited text reuses cached meshes, sky and files, so live editing is cheap. |
| `reality.start({ samples, samplesPerFrame })` / `reality.stop()` | Progressive preview in the animation loop. It adapts its batch size so the page stays responsive. |
| `reality.setTime(seconds)` | Moves an animated scene to a moment (a scrubber). Resets accumulation. |
| `reality.resize(w, h)` | Changes the render size. |
| `await reality.renderStill({ samples, onProgress })` | Renders the current time to `samples` and returns a PNG `Blob`. |
| `await renderVideo(reality, { fps, duration, samples, bitrate, format, onProgress, signal })` | Renders the timeline. Returns `{ blob, type }` (WebM through WebCodecs), or `{ frames, type: 'image/png' }` where WebCodecs is missing. `signal` is an `AbortSignal` to cancel. |
| `reality.onProgress = (samples, target) => ...` | Preview progress. |
| `reality.onStatus = (message \| null) => ...` | GPU problems: context loss and recovery, a driver refusing the shader. Show it to the user. |
| `reality.diagnostics()` | A plain object describing the GPU, errors and the shader probe. Save it when reporting a rendering bug. |

## Without a GPU (Node)

The language front end runs in Node: `compile(source, { imports })` returns a
`Scene` whose `sample(time)` gives plain numbers for every object, which is
how `scripts/check.mjs` works. Use it for validation, generating scenes, or
tests. Rendering itself needs WebGL2 in a browser; from Node, drive headless
Chromium like `tools/render.mjs` does.

## Generating scenes from code

A scene is text, so the simplest way to build one from data is to generate
the `.real` source (template strings) and `load()` it. Keep generated scenes
readable: emit `let` names for repeated materials and `repeat` loops for
regular layouts. Beyond a few hundred objects, write an `.obj` and use one
`mesh`, because every ray tests every top-level object.

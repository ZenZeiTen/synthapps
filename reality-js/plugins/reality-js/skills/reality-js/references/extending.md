# Extending reality.js

For changes to the language or the renderer itself. Read this before
editing anything under `reality-js/src/`.

## Where things live

| Change | Edit | Then |
|---|---|---|
| A new property or node kind | `src/scene/nodes.js` (the schema is the single source of truth for checking, errors and docs), then use it in `src/scene/scene.js` and `src/render/pack.js` | `node tools/gen-reference.mjs` (LANGUAGE.md) and `node tools/gen-cheatsheet.mjs` (this skill's cheat sheet) |
| A built-in function or colour name | `src/lang/builtins.js` | both generators |
| A unit | `src/lang/units.js` | both generators |
| Motion helper | `src/scene/animation.js` (closed-form in `t`: no state, so any instant can be sampled for motion blur) | both generators; add a test in `tests/physics.test.js` |
| Material or light transport | `src/render/trace.glsl.js`, plus the packed layout in `src/render/pack.js` (the texel layout comment at the top must match the shader fetches) | `npm test`, `npm run test:browser` |
| Post-processing (bloom, film) | `src/render/post.glsl.js` | same |

`npm test` fails if LANGUAGE.md or the cheat sheet drift from the schemas, if
an example stops compiling without warnings, or if a shader breaks one of the
portability rules below.

## Shader rules: the shader must compile everywhere

The path tracer compiles through ANGLE, which translates GLSL to HLSL on
Windows (Direct3D 11), to Metal on macOS, and runs on SwiftShader in tests.
Each translator rejects things the others accept, and the tests only run
SwiftShader. These rules come from real failures:

1. **Never mix integer and float arguments in a vector constructor.**
   `vec3(0, x, 0)` becomes an ambiguous HLSL overload
   (`error X3067: 'vec3_ctor_int_int'`) and nothing renders on Windows.
   Write `vec3(0.0, x, 0.0)`. `tests/shaders.test.js` checks the source for this.
2. **Loop bounds come from uniforms or constants,** not from data fetched in
   the loop. Unbounded or data-dependent loops time out or get unrolled
   badly by FXC.
3. **Keep one call site for big functions,** such as the shadow ray.
   HLSL inlines everything, so calling it from several places multiplies
   compile time and can exceed the driver's limit.
4. **Put new optional work behind a feature flag.** The shader is compiled
   per scene with `#define HAS_MESH/HAS_FOG/HAS_LIGHTS/HAS_TEXTURES/HAS_PATTERNS`
   (see `TRACE_FEATURES` and `traceFragment(features)`), so scenes that do
   not use a feature do not pay for it. To add a flag, extend
   `TRACE_FEATURES`, set it in `packScene`, and wrap the code in `#if`.
5. **Test for NaN by its bit pattern,** not `x != x`, which optimisers may
   remove.

When a GPU refuses a draw, the renderer probes shader variants and captures
the driver's info log and the translated source (`reality.diagnostics()`).
Ask the user for that report instead of guessing; the playground and demo
save it.

## Checking a renderer change

- **White furnace:** in a uniform `background`, a white diffuse, mirror or glass
  sphere must disappear. The browser tests do this. Any energy gain or loss
  shows as a visible sphere.
- Render the seven examples before and after at the same settings and
  compare them side by side.
- Measure speed on the demo's benchmark, not by eye, and record GPU,
  resolution and paths per second.

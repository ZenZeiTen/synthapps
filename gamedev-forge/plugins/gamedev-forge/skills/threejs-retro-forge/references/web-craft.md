# Web Craft

The layer around the canvas: CSS technique, page-level era craft, canvas/DOM integration, and
the gates. `references/era-matrix.md` has the palettes and type anchors; this is how to build
with them.

**Contents**
- [Canvas integration](#canvas-integration)
- [Pixel-accurate CSS](#pixel-accurate-css)
- [Era craft in CSS](#era-craft-in-css)
- [Motion](#motion)
- [UI that survives the pipeline](#ui-that-survives-the-pipeline)
- [Accessibility gate](#accessibility-gate)
- [Performance gate](#performance-gate)
- [Asset production](#asset-production)

---

## Canvas integration

Three ways to place 3D on a page, with different design consequences.

**Full-bleed canvas, DOM on top.** Default for games and immersive sites. DOM UI escapes the
retro pipeline, which is usually what you want for readability — but then the UI must be
*designed* to look period-correct rather than inheriting it from the shader.

**Inline canvases in a document flow.** The most interesting option and the least used. A
`<table>`-grid page with several 160×120 canvases reads as genuine early-web weirdness. Use
`IntersectionObserver` to only run the render loop for visible canvases, and share a single
`WebGLRenderer` across them by rendering into each canvas's 2D context via `drawImage` — dozens
of live GL contexts will exhaust the browser's limit (typically ~8–16).

**Canvas as background texture, DOM as content.** Cheapest to make accessible: the 3D is
decorative, so it can be aggressively degraded or disabled without losing content. Mark it
`aria-hidden="true"` and make sure the page reads correctly with it off.

---

## Pixel-accurate CSS

The upscale must be exact or the whole low-res illusion collapses.

```css
canvas {
  image-rendering: pixelated;      /* Chrome/Safari/Firefox */
  image-rendering: crisp-edges;    /* fallback keyword */
}
```

Integer scaling in JS, not CSS stretch:

```js
const scale = Math.max(1, Math.floor(Math.min(
  window.innerWidth  / VIRTUAL_W,
  window.innerHeight / VIRTUAL_H
)));
canvas.style.width  = (VIRTUAL_W * scale) + 'px';
canvas.style.height = (VIRTUAL_H * scale) + 'px';
```

Letterbox the remainder with a solid background. Stretching to fill produces uneven pixel
widths — some pixels 3 device-pixels wide, some 4 — which is instantly visible on any
regular pattern and is the most common giveaway of a fake-retro build.

Also set `renderer.setPixelRatio(1)` on the low-res target. Inheriting `devicePixelRatio`
there silently renders at 2× or 3× and defeats the budget.

---

## Era craft in CSS

### Web 1.0

Use the real mechanisms — they are the aesthetic, and modern equivalents read as pastiche:

- `<table>` layout with fixed pixel widths. Yes, actually.
- Tiled background images at 8–64px, `background-repeat: repeat`.
- Default link colours (`#0000EE` / `#551A8B`), underlined.
- Beveled buttons via `border-style: outset` / `:active { border-style: inset }` — that's how
  it was done and it still works.
- `font-family: "Times New Roman", serif` for body. Resist the urge to improve it.
- Content-driven widths, no responsive breakpoints, horizontal scroll allowed.

The register is *enthusiastic amateur*. Slight misalignment and inconsistent spacing are
load-bearing; a perfectly gridded Web 1.0 page reads as a design system wearing a costume.
`<blink>` and `<marquee>` are removed from browsers — reimplement with CSS animation if the
brief truly wants them, and gate behind reduced-motion.

### Y2K

- Metal via multi-stop linear gradients with a hard mid-stop, plus a 1px light top border and
  1px dark bottom border.
- Beveled/extruded type: layered `text-shadow` offsets, light above, dark below.
- Radial and orbital layouts (`transform: rotate()` on positioned elements), diagonal rules.
- Dark navy/black fields with cyan and silver accents.
- Tight tracking, small caps, thin horizontal rules.

### Frutiger Aero

- Backgrounds are *light sources*: large soft diagonal `linear-gradient` or `radial-gradient`,
  low contrast, aqua-to-white.
- Gloss on elements: a `::before` overlay with a white-to-transparent gradient covering the top
  ~50%, `border-radius` matching the parent.
- `backdrop-filter: blur()` for real Aero glass. Check support and provide a solid fallback.
- Generous rounding, soft large-radius shadows, no hard edges anywhere.
- Restraint is the aesthetic. One glossy hero against a calm field.

### Brutalist / anti-design

System font stack, default link styling, visible borders, no transitions, no easing. This is
the highest-value-per-effort register when the budget is small and it holds up on anything.

---

## Motion

Era-specific easing matters more than most people expect.

| Era | Motion character |
|---|---|
| Web 1.0 | None, or a GIF loop at 8–12 fps with hard frame steps |
| PS1/N64 game | 30 fps target; step animation at 30 fps even on a 60 fps display — smooth interpolation reads as modern |
| Y2K / Flash | Fast, overshooting, `cubic-bezier(.68,-.55,.27,1.55)`; things fly in |
| Frutiger Aero | Slow, soft, `ease-in-out`, long durations, gentle float loops |
| Demoscene | Continuous sine-driven motion, everything always moving, no rest state |

Step animation to a target framerate rather than lerping every frame:

```js
const STEP = 1 / 30;
let acc = 0;
function tick(dt) {
  acc += dt;
  while (acc >= STEP) { update(STEP); acc -= STEP; }
  render();   // render every frame; simulate at 30
}
```

Use `THREE.Timer` for the delta (`Clock` is deprecated since r183 and `Timer` is in core since
r179). Call `timer.connect(document)` if you want the Page Visibility behaviour that stops
huge deltas after a background tab — it's no longer automatic as of r174.

---

## UI that survives the pipeline

Text inside the retro pipeline is usually unreadable. Three workable approaches:

1. **DOM overlay** — most accessible, real text, real screen-reader support, no shader
   involvement. Style it to match the era manually. Default choice.
2. **Separate un-snapped canvas pass** — render UI geometry after the signal chain with
   subpixel positioning. Keeps it in-world without jitter.
3. **Bitmap font at the virtual resolution** — genuinely period-accurate and readable *if*
   drawn at exact integer positions in virtual pixels and upscaled with the rest. Requires the
   glyph grid to align to the virtual pixel grid; fractional positions destroy it.

Never rely on option 3 alone for essential content — provide a DOM equivalent for
accessibility even if it's visually hidden.

---

## Accessibility gate

Run every item. Retro aesthetics are unusually good at producing genuine accessibility
hazards, because several signature effects are literally flashing lights.

- **Flash rate.** No full-screen luminance change faster than 3 Hz (WCAG 2.3.1). CRT roll,
  interlace flicker, VHS tracking bands, and screen shake all violate this at typical
  "authentic" settings. Clamp frequencies and amplitudes; test with the effect at max.
- **`prefers-reduced-motion`.** Disable jitter, flicker, noise, shake, and auto-playing
  animation. Keep static styling — palette, scanline texture, layout. Reduced motion doesn't
  mean reduced aesthetic.

```js
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
```

- **A visible off switch.** One control that sets `signal` to none, `vertex` to subpixel, and
  raises `res`. Persist the choice.
- **Contrast measured post-quantization.** A text/background pair that passes at 4.5:1 in
  source colours can fail after quantizing to 16 colours. Sample the actual output.
- **Focus visibility.** Period-accurate CSS often strips outlines. Don't; or replace with
  something at least as visible.
- **Reduced transparency.** `prefers-reduced-transparency` — drop `backdrop-filter` glass.
- **Content parity.** Everything conveyed by the 3D layer must exist in the DOM. If the canvas
  is decorative, `aria-hidden="true"`; if it's content, provide a text equivalent.

---

## Performance gate

- **Low `res` is the biggest win available.** 320×240 is ~3.5% of the pixel count of 1080p.
  Spend the savings on effects, not on resolution.
- **Draw calls over triangles.** Check `renderer.info.render.calls`. Period-accurate geometry
  is low-poly but often high-draw-call. Merge static geometry; `InstancedMesh` for repeats;
  `BatchedMesh` for many distinct geometries sharing a material.
- **One full-screen pass, not five.** Each costs a full read+write at output resolution. Fold
  barrel + scanlines + mask + vignette into a single fragment shader. Halation genuinely needs
  its own downsampled buffer; nothing else does.
- **Halve the halation buffer.** Blur at quarter resolution and upsample — nobody can tell.
- **Texture memory.** Period textures are tiny by definition; don't accidentally ship 2K PNGs
  that get minified to 64px. Author at target size.
- **Test on a mid-tier phone.** Low-res nearest rendering is fast; a barrel-warped 4K output
  with three-tap chroma splitting is not.
- **Budget check:** if the effect can't hold 60 fps on the target device at output resolution,
  cut the signal chain before cutting the scene. Signal is the most expensive and the most
  replaceable part of the look.

---

## Asset production

- **Textures:** author at final size (32–128px), export as indexed PNG, `NearestFilter`,
  `generateMipmaps: false` for a truly hard look (mipmaps soften at distance — enable them
  only if you want the N64 result).
- **Models:** low-poly, hard edges, no smoothing groups across faces you want to read as
  faceted. Bake lighting into vertex colours rather than shipping lightmaps.
- **Colour:** author in the target palette from the start. Quantizing full-colour art after
  the fact produces muddy results because the source wasn't composed for the ramp.
- **Audio:** it carries more era signal than most visual dials and is usually forgotten.
  Tracker-style loops, low sample rates, short reverb tails, mono. `Web Audio` + a tiny
  synth beats a large sample library for both authenticity and file size.

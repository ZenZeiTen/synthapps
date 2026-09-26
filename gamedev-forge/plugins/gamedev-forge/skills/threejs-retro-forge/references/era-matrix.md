# Era Matrix

Constraint budgets, ready to paste into a spec. Every era below is expressed in the same six
dials so they can be diffed and blended.

**Contents**
- [How to read this](#how-to-read-this)
- [3D hardware eras](#3d-hardware-eras)
- [2D / graphic eras](#2d--graphic-eras)
- [Web design eras](#web-design-eras)
- [Palettes](#palettes)
- [Typography anchors](#typography-anchors)
- [Confidence notes](#confidence-notes)

---

## How to read this

Numbers marked **[hw]** are hardware/documented facts. Numbers marked **[typ]** are typical
shipped values, which varied widely by studio and are given as a workable centre of mass, not
a spec. Do not present **[typ]** figures to a user as hardware limits.

Poly counts especially: these were per-frame budgets negotiated against everything else on
screen. Treat them as *ratios* — a character being ~2% of the frame budget matters more than
the absolute number.

---

## 3D hardware eras

### PS1 / PSX (1994) — "the jitter era"

The most distinctive and most requested. Its look comes from three simultaneous omissions:
no subpixel precision, no perspective-correct texturing, no depth buffer.

| Dial | Value |
|---|---|
| `res` | 320×240 typical; 256×224 and 512×240 also common **[hw]** |
| `color` | 15-bit framebuffer, RGB555 (32 levels/channel), hardware 4×4 ordered dither **[hw]** |
| `vertex` | integer screen-pixel snapping — no subpixel rasterization **[hw]** |
| `surface` | affine texture mapping (no perspective correction) **[hw]**; nearest filtering; textures typically 64×64 or 128×128, 4-bit or 8-bit paletted **[typ]** |
| `light` | vertex-lit Gouraud, no per-pixel anything; shadows baked into vertex colours or blob sprites **[typ]** |
| `signal` | composite → CRT TV |

Secondary signatures worth including:
- **No z-buffer.** Sorting was per-primitive (painter's algorithm on an ordering table), so
  intersecting geometry visibly flips which surface is in front. Emulate by sorting draw
  order per-object and disabling depth-write on a chosen subset — do *not* actually disable
  the depth buffer globally, that just produces garbage.
- **Near-plane popping.** Triangles crossing the near plane were dropped rather than clipped,
  so large polygons vanish wholesale when the camera gets close.
- **Hard distance fog** to hide the tiny draw distance. Fog was a *design* device, not just
  atmosphere: it defines how far the level extends.
- Characters ~250–750 tris; whole frame ~500–5000 tris **[typ]**.

### N64 (1996) — "the soft era"

Often mis-described as "PS1 but blurry." It is the opposite console in almost every dial: it
got the maths right and paid for it in texture memory.

| Dial | Value |
|---|---|
| `res` | 320×240 typical, 640×480 in high-res mode; several games rendered at odd intermediate sizes and line-doubled **[typ]** |
| `color` | 15/16-bit output, heavy dithering **[hw]** |
| `vertex` | subpixel accurate — **no jitter** **[hw]** |
| `surface` | perspective-correct **[hw]**; 3-point (triangular) texture filtering, not bilinear **[hw]**; texture cache famously 4 KB, so textures are tiny (often 32×32, 4-bit) and stretched **[hw]** |
| `light` | vertex lighting, per-object anti-aliasing **[hw]** |
| `signal` | composite, with the console's own AA + line doubling adding softness before the TV even sees it |

The signature is **soft-but-straight**: edges are smooth, lines stay straight, but texture
detail is smeared because a 32×32 texture is covering a whole wall. Recreating it by blurring
a high-res texture is wrong — start from a genuinely tiny texture and let magnification do
the work.

3-point filtering samples 3 texels of the bilinear quad instead of 4, producing subtly
triangular interpolation. It keeps hard diagonal lines crisper than bilinear does.

### Saturn (1994)

Quadrilateral-based rather than triangle-based, warped sprites instead of textured polys,
even worse clipping than PS1. Distinctive but hard to emulate honestly in a triangle
rasterizer — the quad-warp artefacts are the whole look. Approximate with heavy affine warp
plus visible quad seams; be upfront that it's an approximation.

### Arcade / vector (1979–1985)

| Dial | Value |
|---|---|
| `res` | vector — no raster grid at all |
| `color` | monochrome or few-colour, additive |
| `vertex` | analogue, smooth |
| `surface` | none — lines only |
| `light` | emissive; brightness = beam dwell time, so corners and short segments glow brighter |
| `signal` | phosphor persistence (trails), bloom, no scanlines |

Implement as additive `LineSegments` with per-vertex brightness, a persistence buffer
(feedback with ~0.9 decay), and heavy bloom. Cheap to run and reads instantly.

### Dreamcast / early PC 3D (1998–2001)

Perspective-correct, subpixel, bilinear, per-pixel lighting arriving, 640×480, 16/24-bit
colour, real z-buffer. The look is "clean but low-poly" — the *absence* of artefacts is the
period marker. Pairs well with early-2000s web chrome.

---

## 2D / graphic eras

| Era | `res` | `color` | Notes |
|---|---|---|---|
| Game Boy (1989) | 160×144 | 4 shades, greenish LCD | No colour at all — value structure carries everything |
| NES (1983) | 256×240 | 25 on screen from 54 **[hw]**; 4 colours per 8×8 tile, 3 + shared bg | Tile-level palette limit is the real constraint |
| C64 (1982) | 320×200 / 160×200 | 16 fixed | Famous for its specific, slightly muddy palette |
| CGA (1981) | 320×200 | 4 from fixed modes | The cyan/magenta/white palette is instantly recognisable |
| EGA (1984) | 640×350 | 16 from 64 | |
| VGA (1987) | 320×200 | 256 from 262,144 | Enabled dithered gradients — the DOS-demo look |
| Amiga/demoscene (1985–95) | 320×256 | 32–4096 (HAM) | Copper gradients, plasma, starfields, sine scrollers |

---

## Web design eras

### Web 1.0 / Old Web (1994–2001)

The constraint stack: no usable CSS, 28.8 kbps dial-up, 640×480–800×600 displays, 256-colour
monitors, and a browser war where half of all tags worked in only one browser. Every visual
signature is downstream of one of those.

- Layout: nested `<table>` grids, framesets, fixed pixel widths, near-zero whitespace
- Colour: the 216-colour web-safe palette, saturated primaries, tiled background images
- Type: Times New Roman and Arial defaults, `<font>` tags, bitmap headline GIFs
- Motion: animated GIFs, `<marquee>`, `<blink>`, cursor trails, hit counters
- Chrome: beveled/raised GIF buttons, horizontal rule dividers, "under construction"

The register is *amateur enthusiasm*. Executed too cleanly it stops reading as Web 1.0 and
starts reading as a design system with retro paint. Deliberate asymmetry and slight
misalignment are load-bearing.

### Y2K Futurism (1997–2004)

Chrome, metal gradients, translucent plastic, lens flares, wireframe globes, techno-blue and
silver, extruded/beveled 3D type, orbital and radial layouts, Flash-era motion. Maximalist
and slightly hostile. Small caps, tight tracking, thin horizontal rules, "digital" glyph sets.

### Frutiger Aero / Web 2.0 Gloss (2004–2013)

The optimistic counter-swing to Y2K: glossy but *calm*. Aqua and green over silver, glass and
water, bokeh, aurora, lens bloom, skeuomorphic depth, rounded rectangles, tropical/nature
imagery paired with technology. Big soft gradients that read as *light* rather than as
colour — diagonal gradients feel more natural than vertical ones. Humanist sans type
(Frutiger, Myriad, Segoe). Named for Adrian Frutiger's typeface plus Windows Aero.

### Vaporwave (2010s, referencing 1984–1996)

Not a historical era — a *reinterpretation*, and it should be treated as one. Rules: Roman
busts, grid horizons, pastel cyan/magenta, Japanese type as texture, VHS artefacts,
deliberately obsolete UI chrome. Because it is already a remix, layering more remix on top
tends to mush. Use it as a `signal`+palette layer over a genuinely different geometry budget.

### Brutalist / anti-design web (2014–)

Not retro, but frequently what people actually mean by "make it look like the old web":
system fonts, default blue links, visible structure, no easing, hard edges. Cheap to build
and holds up on any device — a good fallback register when the budget is tight.

---

## Palettes

Ready to paste. All hex, sRGB.

**Game Boy DMG** (4 values, greenish LCD)
`#0f380f #306230 #8bac0f #9bbc0f`

**Game Boy Pocket** (neutral grey variant)
`#181818 #4a4a4a #949494 #d8d8d8`

**CGA mode 4 palette 1, high intensity**
`#000000 #55ffff #ff55ff #ffffff`

**CGA mode 4 palette 0, high intensity**
`#000000 #55ff55 #ff5555 #ffff55`

**PICO-8** (16, modern but designed under 8-bit rules — an excellent default)
`#000000 #1d2b53 #7e2553 #008751 #ab5236 #5f574f #c2c3c7 #fff1e8`
`#ff004d #ffa300 #ffec27 #00e436 #29adff #83769c #ff77a8 #ffccaa`

**Commodore 64** (16)
`#000000 #ffffff #880000 #aaffee #cc44cc #00cc55 #0000aa #eeee77`
`#dd8855 #664400 #ff7777 #333333 #777777 #aaff66 #0088ff #bbbbbb`

**Web-safe** (216): all combinations of `00 33 66 99 CC FF` per channel. Generate rather than
list. Historically accurate for Web 1.0; visually it forces a chunky, slightly sour look
because the steps are coarse and evenly spaced.

**Y2K chrome ramp** (not historical hardware — a working ramp)
`#0a0f1a #1b2a4a #3d5a8a #7fa3c9 #c8dced #ffffff` plus accent `#00e5ff`

**Frutiger Aero** (working palette)
`#e8f7ff #a8dff0 #4fc3e8 #1a9bd7 #0d6ba8` + greens `#8fd14f #4caf50` + white gloss `#ffffff`

**Vaporwave** (working palette)
`#1a0033 #2d1b69 #ff71ce #01cdfe #05ffa1 #b967ff #fffb96`

---

## Typography anchors

| Era | Faces | Substitutes available on the web |
|---|---|---|
| Web 1.0 | Times New Roman, Arial, Courier New | Actually use them — they are the point |
| Terminal/DOS | IBM VGA 8×16, Px437 | `ui-monospace`, or ship a bitmap webfont |
| PS1-era UI | condensed grotesques, bitmap fonts | Any pixel font at integer sizes only |
| Y2K | Eurostile, Bank Gothic, OCR-A, Handel Gothic | Michroma, Orbitron, Chakra Petch |
| Frutiger Aero | Frutiger, Myriad, Segoe UI | Source Sans 3, Inter, Public Sans |
| Demoscene | custom bitmap, heavy outline | Any pixel font + hard 1px outline |

Pixel fonts must be rendered at exact integer multiples of their design size with
`image-rendering: pixelated` on any scaled bitmap, or they turn to mush and immediately break
the illusion. Never letter-space a bitmap font by fractional pixels.

---

## Confidence notes

- **[hw]** items above (PS1 15-bit + no subpixel + affine; N64 3-point filtering + 4 KB
  texture cache + subpixel; NES/CGA/C64 palette structures) are well-documented and
  corroborated across emulator, hardware-documentation, and developer-retrospective sources.
- **[typ]** items (poly counts, texture sizes, render resolutions) varied enormously between
  titles even on the same hardware. Present them as ranges.
- Aesthetic era boundaries (Y2K vs Frutiger Aero vs vaporwave) are retroactive labels coined
  by online communities, not contemporaneous design movements. They are genuinely useful as
  shared vocabulary, but they are taxonomy imposed after the fact — say so if a user asks
  about provenance, and don't overstate the precision of the date ranges.

# Fusion Protocol

How to combine eras into something new instead of something muddy.

**Contents**
- [Why fusions fail](#why-fusions-fail)
- [The protocol](#the-protocol)
- [Dial ownership table](#dial-ownership-table)
- [The one-anachronism rule](#the-one-anachronism-rule)
- [Tension pairs](#tension-pairs)
- [Worked fusions](#worked-fusions)
- [Diagnosing a fusion that isn't working](#diagnosing-a-fusion-that-isnt-working)

---

## Why fusions fail

Two failure modes, and they look nothing alike.

**Mush.** Both eras get partial ownership of the same dial, so neither reads. A scene with
"some" vertex jitter and "some" bloom is not a fusion — it's a scene where the jitter looks
like a bug and the bloom looks like a default. The viewer's eye has no anchor.

**Pile-up.** Every era contributes its loudest signature simultaneously: affine warp *and*
chrome type *and* aurora gradients *and* VHS tracking. Individually each is legible; together
they cancel, because the viewer reads the loudest layer and dismisses the rest as noise.

Both come from the same root cause: **no dial has a single owner.** The protocol exists to
force ownership.

---

## The protocol

### 1. Name a Base era

The Base owns **geometry, `vertex`, `res`, and `signal`** — the *physics* of the image. This
is the era the scene appears to have been *rendered by*. Base ownership is what makes a
fusion feel like an artefact from a coherent world rather than a collage.

### 2. Name a Guest era

The Guest owns **`color`, `surface`, `light`, motion, and UI chrome** — the *taste* of the
image. This is the era the scene appears to have been *art-directed by*.

### 3. Assign every dial to exactly one owner

Six dials, six single owners. Write it out. If you catch yourself writing "a bit of both,"
you have found the exact place the fusion will fail — resolve it before implementing.

The default split is Base owns `res`/`vertex`/`signal`, Guest owns `color`/`surface`/`light`.
You may trade any single dial across that line, but every trade must be deliberate and
stated. Trading two or more usually means you actually want a different Base.

### 4. Pick exactly one anachronism

One element that is *impossible* for the Base era. Named explicitly. See below.

### 5. Resolve the collision list

Some Base/Guest pairs have direct technical contradictions. Resolve each explicitly rather
than letting the renderer decide — see [Tension pairs](#tension-pairs).

### 6. Sanity-check with the squint test

Squint until detail disappears. You should still be able to name the Base era from silhouette
and value structure alone, and name the Guest era from hue alone. If you can't name either,
it's mush. If you immediately name three, it's a pile-up.

---

## Dial ownership table

Copy this into the spec and fill it in.

| Dial | Owner | Value | Why |
|---|---|---|---|
| `res` | Base | | |
| `color` | Guest | | |
| `vertex` | Base | | |
| `surface` | Guest | | |
| `light` | Guest | | |
| `signal` | Base | | |
| Anachronism | — | | (exactly one) |

---

## The one-anachronism rule

A fusion reads as *new* — rather than as a failed period reconstruction — when exactly one
element could not possibly have existed in the Base era, and that element is confident and
central rather than incidental.

The reason is perceptual. One impossible element in an otherwise coherent world reads as
*intent*: the viewer concludes the world has different rules, and starts looking for them.
Three impossible elements read as *incompetence*: the viewer concludes there are no rules and
stops looking.

Good anachronisms are ones the Base era obviously *wanted* and couldn't afford:

| Base | Anachronism it was reaching for |
|---|---|
| PS1 | real-time soft shadows; smooth gradient skies without banding; transparency that isn't stippled |
| N64 | high-resolution textures on the same tiny geometry |
| Web 1.0 | fluid layout, smooth easing, webfonts |
| Arcade vector | colour, and volumetric glow |
| Game Boy | a second dimension of colour |

Bad anachronisms are ones that *contradict* the Base rather than extending it — e.g. adding
subpixel-accurate vertices to a PS1 base. That doesn't read as futuristic, it reads as the
jitter being broken.

---

## Tension pairs

Direct contradictions that need an explicit call.

**Affine warp × high texel density.** Affine warp is only visible on large, low-frequency
texture features viewed at shallow angles. Crank texel density and the warp becomes invisible
noise. *Resolve:* keep texel density low on floors and walls (where shallow angles happen) and
allow high density on props and characters (mostly viewed head-on). This is exactly what PS1
artists did.

**Vertex jitter × text/UI.** Jittering UI is unreadable. *Resolve:* render UI in a separate
un-snapped pass composited after the signal chain, or snap UI to the *virtual pixel grid*
rather than to sub-vertex positions so it moves in whole pixels.

**Palette quantization × bloom.** Bloom generates smooth gradients; quantization destroys
them into visible bands. *Resolve:* pick one. Either bloom *then* quantize + dither (bands
become dither texture — good, this is the DOS-demo look), or quantize then bloom (bloom
smears across quantized regions — usually muddy). Almost always the former.

**CRT mask × low-DPI display.** A phosphor mask needs ≥3× output scale to resolve; on a
standard 1080p display it produces moiré and a screen-door effect. *Resolve:* detect
`devicePixelRatio` and output size; below 3× use scanlines + halation only, above 3× enable
the mask. Ship both paths.

**Frutiger gloss × 15-bit colour.** Gloss depends on smooth specular falloff; RGB555 bands it
into rings. *Resolve:* this is actually a *great* fusion artefact if embraced — dither the
specular specifically, so gloss reads as animated dither texture. If not embraced, give
`color` to the Guest entirely and drop to 8-bit.

**No-z-buffer sorting × transparency.** PS1 had neither, and faked transparency with stipple
patterns. *Resolve:* if you want period-accurate transparency, use dither-stipple discard
rather than alpha blending. It solves the sort order problem the same way the hardware did,
and it looks correct.

---

## Worked fusions

Four fully-specified examples. Use them as templates, not as presets to copy.

### "Aero Wreck" — PS1 geometry, Frutiger Aero art direction

The premise: a 2006 corporate wellness portal, rendered by 1997 hardware.

| Dial | Owner | Value |
|---|---|---|
| `res` | Base PS1 | 320×240, integer upscale |
| `color` | Guest Aero | aqua/white/green ramp, 8-bit, **no** palette quantize |
| `vertex` | Base PS1 | snap to 320×240 grid |
| `surface` | Guest Aero | affine **on** (traded to Base — deliberate), but glossy specular map |
| `light` | Guest Aero | lambert + strong specular blob + high-key ambient |
| `signal` | Base PS1 | composite, mild scanlines, no mask |
| Anachronism | — | real-time bloom on the specular highlights |

Why it works: the aqua/white palette is high-key, so the jitter reads as *shimmer* rather
than as damage. The specular blob warps along with the affine UVs, which produces a liquid
smearing that neither era could produce alone.

### "Vector Aero" — arcade vector geometry, Y2K chrome direction

| Dial | Owner | Value |
|---|---|---|
| `res` | Base vector | native, no pixel grid |
| `color` | Guest Y2K | chrome ramp, additive, 8-bit |
| `vertex` | Base vector | analogue smooth |
| `surface` | Guest Y2K | none (lines) but with a chrome gradient along line length |
| `light` | Guest Y2K | emissive + fake environment reflection mapped to line direction |
| `signal` | Base vector | phosphor persistence + heavy bloom, no scanlines |
| Anachronism | — | volumetric depth fog through the line field |

### "Dial-Up Cathedral" — Web 1.0 layout, PS1 3D content

A `<table>`-grid page where every cell contains a live low-res WebGL canvas. The 3D obeys PS1
rules; the page obeys 1997 HTML rules; the anachronism is that the canvases are *live*.

| Dial | Owner | Value |
|---|---|---|
| `res` | Base Web 1.0 | canvases at 160×120, page at fixed 800px |
| `color` | Guest PS1 | RGB555 + 4×4 dither in the canvases; web-safe palette in the page chrome |
| `vertex` | Guest PS1 | snapped |
| `surface` | Guest PS1 | affine, 64px textures |
| `light` | Guest PS1 | vertex-lit |
| `signal` | Base Web 1.0 | none — a 1997 monitor showing a browser, not a TV |
| Anachronism | — | the images move |

Note the Base/Guest roles invert relative to the default split here, because the Base era is a
*medium* (the page) rather than a renderer. That's legitimate — what matters is that every
dial has one owner, not that the owner is always the same one.

### "Gameboy Cathedral" — 4-value palette, modern geometry and lighting

| Dial | Owner | Value |
|---|---|---|
| `res` | Guest modern | 480×270 |
| `color` | Base GB | 4 values, hard quantize, 8×8 Bayer dither |
| `vertex` | Guest modern | subpixel |
| `surface` | Guest modern | perspective-correct, high texel density |
| `light` | Guest modern | full PBR with shadows and AO |
| `signal` | Base GB | LCD ghosting (temporal smear), no scanlines |
| Anachronism | — | ray-marched volumetric light shafts |

Why it works: the 4-value palette destroys all colour information, so *form* has to carry
everything — which makes expensive modern lighting suddenly legible rather than decorative.
The dither pattern becomes the texture of the whole image.

---

## Diagnosing a fusion that isn't working

| Symptom | Likely cause | Fix |
|---|---|---|
| "Looks like a filter on a modern game" | `vertex` and `light` still modern; only `signal` is retro | Move geometry/lighting dials to the Base; signal alone is never enough |
| "Looks broken, not stylized" | Jitter or warp present but `res` too high to make it legible as motion | Drop `res` — artefacts need a coarse grid to read as intentional |
| "Muddy, can't tell what era" | Split ownership on `color` or `surface` | Reassign to a single owner |
| "Busy, hurts to look at" | Pile-up: more than one anachronism, or Guest signatures on Base-owned dials | Cut to one anachronism; re-run ownership table |
| "Retro but generic" | Using only the most-copied signatures (scanlines + CRT curve) | Reach for a *secondary* signature instead — sort-order flipping, near-plane popping, tile-palette limits, copper gradients |
| "Text is unreadable" | UI inside the constraint budget | UI belongs outside the pipeline — composite after signal |
| "Great still, bad in motion" | Dither pattern locked to screen space while the camera moves | Either lock dither to screen space *deliberately* (correct for CRT/console emulation — the pattern should crawl) or lock to object space (better for still-heavy sites). Choose consciously |

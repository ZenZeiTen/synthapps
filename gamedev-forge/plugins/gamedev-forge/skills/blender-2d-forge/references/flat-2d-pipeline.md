# The flat-mesh 2D pipeline

How to get a vector-cartoon look out of Blender without Grease Pencil, in a way that
renders fast, verifies numerically, and stays editable by the user afterwards.

## Why flat mesh and emission

Emission shaders ignore lighting entirely. A polygon with an Emission node at
strength 1.0 renders as exactly its input colour, every time, with no lights in the
scene and no shading to reason about. Combined with `view_transform = "Standard"`,
the pipeline is colour-exact: the hex you author is the hex that lands in the render.

That exactness is the foundation of everything else. It makes pixel probing a real
test rather than an approximation, and it means a palette defined once stays
consistent across every asset.

Practical consequences:

- Turn off shadows and raytracing in EEVEE. They contribute nothing and cost time.
- 16 TAA samples is plenty. There is nothing to converge.
- A seven-scene production fits comfortably in a few hundred polygons.

## Coordinate discipline

With an orthographic camera at `(0, 0, 20)` and rotation `(0, 0, 0)`:

```
visible x  ∈ [-ortho_scale/2, +ortho_scale/2]
visible y  ∈ [-half_width * res_y/res_x, +half_width * res_y/res_x]
```

At `ortho_scale = 16` and 1920×1080 that is x ∈ [−8, 8], y ∈ [−4.5, 4.5].

**Depth layering.** Assign z by role, not by accident:

| Layer | z | Contents |
|---|---|---|
| Backgrounds | −8 | Full-frame environment plates |
| Mid | 0 to 1 | Characters, props |
| Foreground | 2 to 3 | Captions, effects, text |

Flat coplanar polygons z-fight. Give each layer real separation.

**If the camera drifts, stage against the tightest shot.** A camera that pushes from
`ortho_scale` 16.0 to 13.9 has a smallest visible frame of x ∈ [−6.95, 6.95]. Anything
that must stay on screen has to sit inside that, not inside the widest shot.

## Building assets with `Art`

`Art` accumulates polygons with per-face material indices and bakes one mesh object.
One `Art` instance per logical object.

```python
a = Art("BG_Park", coll="Backgrounds", z=-8.0)
a.fill(rect(0, 1.5, 17, 5), "sky")
a.fill(circle(5.5, 3.2, 0.9), "sun")
a.fill(rect(0, -2.6, 17, 3.2), "grass")
a.fill(rect(0, -3.6, 17, 1.4), "grass2")
a.fill(rect(-4.2, -0.9, 0.5, 2.4), "trunk")
a.fill(circle(-4.2, 0.9, 1.4), "leaf")
park = a.build()
```

Methods:

| Method | Purpose |
|---|---|
| `fill(pts, cname, rgba=None, z=0.0)` | Solid polygon from a point list |
| `line(pts, w, cname, rgba=None, z=0.0, closed=False)` | Quad-strip polyline of width `w` |
| `outline(pts, w, z=0.0, cname="ink")` | Closed ink outline |
| `build(parent=None)` | Bake mesh, link to collection, optionally parent |

Shape generators return plain 2D point lists, so you can transform or splice them
before filling: `circle`, `ellipse`, `rect`, `rrect`, `arc`, `wedge`, `tri`, `star`,
`blob`, `drop`, `bubble_ring`.

`blob(cx, cy, r, bumps, amp, seed)` is the one to reach for when something should
look hand-drawn rather than geometric — germ characters, soap suds, foliage clumps.

## Palette discipline

Define every colour once, by name, in a single dictionary. Reference by name
everywhere. Never inline a hex value in an asset build.

Two reasons. First, the user can restyle the whole production by editing one dict.
Second, verification compares rendered pixels against palette entries — if colours are
scattered through the code, you have nothing clean to compare against.

Emission materials are cached by name in `emat()`, so repeated use of `"grass"` across
four backgrounds produces one shared material, not four.

## Character rigs

Parent every part to an Empty. Move and scale only the Empty for staging.

```
NIA_root      (Empty — the only thing you position)
├── NIA_legs
├── NIA_body
├── NIA_head   (origin at the neck)
├── NIA_armL   (origin at the shoulder)
└── NIA_armR   (origin at the shoulder)
```

Origins are what make rotation read as a joint. A head whose origin sits at its own
centre spins; a head whose origin sits at the neck tilts. Build the geometry offset
from the object origin rather than centring it.

When you parent after building, preserve the world transform:

```python
ob.parent = parent
ob.matrix_parent_inverse = parent.matrix_world.inverted()
```

**Record your rotation conventions in a comment or the delivery notes.** "+135° raises
the right arm up and to the right" is the kind of thing that is obvious while you are
building and completely opaque a day later.

## Collections

Keep a fixed layout. It makes the outliner navigable and gives you clean selection
sets for visibility passes.

```
Camera/         the render camera
Backgrounds/    one full-frame plate per location
Characters/     rigged part hierarchies
Props/          everything a character interacts with
Effects/        sparkles, bursts, caption band, text objects
Audio/          empty, waiting for the user's sound files
```

## Text

Text objects are FONT curves lying in the XY plane like everything else. They take
keyframes on scale and location normally.

Two things to watch:

- **Caption placement versus characters.** Decide the caption band's world-space span
  before staging anyone, then keep every character's feet above it. Probe the overlap
  zone to confirm rather than assuming.
- **Text is not verifiable by pixel probe the way shapes are.** A probe can tell you
  ink-coloured pixels exist where text should be; it cannot tell you the text is
  legible or correctly spelled. Render a contact sheet and let the user read it.

## Storing the toolkit in the file

Write the libraries into the .blend as text datablocks:

```python
for fname, src in libraries.items():
    t = bpy.data.texts.get(fname) or bpy.data.texts.new(fname)
    t.clear()
    t.write(src)
```

The user opens the Scripting workspace and has the entire construction toolkit,
editable and re-runnable. This turns a one-off delivery into something they can
extend without you.

Remove superseded versions before handoff. A file containing both `lib.py` and
`lib2.py` invites the user to read the wrong one.

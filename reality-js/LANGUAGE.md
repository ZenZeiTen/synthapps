# The reality.js scene language

A `.real` file describes what is in front of a camera: objects, what they
are made of, the light, the camera itself, and how all of it changes over
time. It reads like a list of things with their settings:

```
sky { sun_elevation: 20 }
ground { }
sphere {
  position: [0, 1, 0]
  radius: 1
  material: metal { color: gold, roughness: 0.15 }
}
```

Anything you leave out gets a sensible default. The [reference](#reference)
at the end lists every kind of thing and every property.

## Contents

- [Nodes and properties](#nodes-and-properties)
- [Values](#values)
- [Names, copies and imports](#names-copies-and-imports)
- [Expressions](#expressions)
- [Time and motion](#time-and-motion)
- [Loops and conditions](#loops-and-conditions)
- [Shooting like a photographer](#shooting-like-a-photographer)
- [Light](#light)
- [Errors](#errors)
- [Reference](#reference)

## Nodes and properties

`kind { ... }` makes a node. Inside the braces, `name: value` sets a
property. Commas and semicolons between properties are optional; line
breaks are enough.

Three families of nodes exist:

- **Settings** describe the shot: `camera`, `sky`, `hdri`, `background`,
  `fog`, `film`, `timeline`, `render`.
- **Objects** are things in the scene: `sphere`, `box`, `plane`, `ground`,
  `disk`, `quad`, `cylinder`, `torus`, `mesh`, `terrain`, `rock`, `group`,
  and the lights `bulb` and `softbox`.
- **Materials** describe surfaces and go in an object's `material`
  property: `material`, `matte`, `plastic`, `metal`, `mirror`, `glass`,
  `water`, `light`.

Comments start with `#` or `//` and run to the end of the line. `/* ... */`
comments can span lines. (A `#` directly followed by 3 or 6 hex digits is
a colour, so leave a space after `#` in comments.)

## Values

| Kind | Examples | Notes |
|---|---|---|
| Number | `1`, `-0.5`, `2e-3` | |
| Number with unit | `50mm`, `1.5m`, `30deg`, `1/48s`, `800lm`, `3200K`, `50%` | Converted to base units: metres, degrees, seconds, kelvin. |
| f-number | `f/2.8` | Written as on a lens. |
| Vector | `[0, 1.5, -2]` | Positions, sizes, colours. |
| Colour | `#ff8800`, `#f80`, `rgb(255, 136, 0)`, `hsl(30, 1, 0.5)`, `kelvin(2700)`, `gray(0.5)` | Colours are stored linear; hex, `rgb()` and `hsl()` are read as sRGB. A bare number is a grey. |
| Text | `"assets/vase.obj"` | Paths are relative to the scene file. |
| Yes/no | `true`, `false` | |
| Choice | `tonemap: aces`, `pattern: checker`, `focus: auto` | For properties with a fixed set of choices, write the word without quotes. |

**Angles are in degrees** everywhere, including `sin()` and `cos()`, as in
OpenSCAD. `rad` and `turn` convert: `0.5turn` is 180.

**Lengths are in metres.** The one exception is convenience: a camera
`lens` or `sensor` written without a unit is read as millimetres
(`lens: 50` means 50mm), with a warning.

## Names, copies and imports

`let` gives a value a name:

```
let brass_trim = metal { color: brass, roughness: 0.3 }
let r = 20cm
sphere { radius: r, material: brass_trim }
```

A named node can be **copied with changes** by using its name like a kind:

```
let ball = sphere { radius: 0.2, material: plastic { color: #e04b3a } }
ball { position: [0, 0.2, 0] }
ball { position: [1, 0.2, 0], material: plastic { color: #2f7fd6 } }
```

`import "materials.real"` runs another file in place, which is handy for a
shared library of materials.

## Expressions

The usual arithmetic works on numbers and, element by element, on
vectors: `+ - * / %` and `^` for powers. A number combines with every
element of a vector: `[1, 2, 3] * 2` is `[2, 4, 6]`.

Comparisons (`== != < > <= >=`), `&&`, `||`, `!` and `cond ? a : b` work
as in JavaScript. `v.x`, `v.y`, `v.z` (and `.r .g .b`, and swizzles like
`v.zyx`) read vector parts; `list[i]` indexes, with `list[-1]` the last
element. A node's property can be read with `.`: `ball.radius`.

The functions are listed in the reference. Some worth knowing:
`mix(a, b, k)`, `clamp(x, lo, hi)`, `smoothstep(a, b, x)`,
`random(seed, lo, hi)` (the same seed always gives the same number),
`noise(x, y, z)`, `normalize(v)`, `length(v)`.

## Time and motion

`t` is the time in seconds. Anything computed from `t` changes over time,
and the renderer samples it wherever it needs to, including many instants
inside one frame for motion blur:

```
timeline { duration: 4s, fps: 24 }
sphere { position: [sin(t * 90) * 2, 1, 0] }    # a quarter turn per second
```

**Keyframes** go through values at set times. Each key's `ease` shapes
the move that arrives at it (`in_out` if not given):

```
position: keys {
  0s: [0, 0, 0]
  1.5s: [2, 0, 0] ease out
  3s: [2, 2, 0] ease back_out
}
```

**Physical motion** helpers give real-world movement as plain functions
of time, so they cost nothing and blur correctly:

| Function | Motion |
|---|---|
| `bounce(t, height, restitution, start)` | Height of a ball dropped from `height`, keeping `restitution` of its speed each bounce (gravity 9.81 m/s²). |
| `fall(t, height, start)` | Free fall, stopping at the ground. |
| `spring(t, from, to, frequency, damping, start)` | Damped spring. `damping: 1` means no overshoot. Works on numbers and vectors. |
| `pendulum(t, length, amplitude, start, damping)` | Swing angle in degrees, with the large-swing period correction. |
| `orbit(t, center, radius, period, phase)` | A point circling `center` horizontally. |
| `wobble(t, amount, frequency, seed)` | Smooth random drift, like a hand-held camera. |

```
camera { position: [0, 1.7, 6] + wobble(t, 2cm) }
group { rotate: [0, 0, pendulum(t, 1.2, 30)]  sphere { position: [0, -1.2, 0], radius: 0.1 } }
```

`timeline` sets the length and frame rate of the animation, and which
moment a still image shows (`time`).

## Loops and conditions

```
repeat i in 0..10 {            # 0 to 9; use 0..=10 to include 10
  sphere { position: [i * 0.5, 0.2, 0], radius: 0.2 }
}

repeat c in [#e04b3a, #f2b233, #3aa55a] { ... }

if show_floor { ground { } } else { background { } }
```

Loop ranges and `if` conditions must be fixed: they decide what exists in
the scene, and that cannot change over time. For a value that changes,
use `cond ? a : b`.

`group { ... }` moves, rotates and scales the objects inside it together.

## Shooting like a photographer

The camera behaves like a real one.

- `lens` (focal length) and `sensor` (width) set the field of view. A 50mm
  lens on the default 36mm full-frame sensor sees what a 50mm lens sees.
- `aperture` is the f-number. It sets the depth of field: `f/1.8` blurs
  the background a lot, `f/11` keeps everything sharp. `focus` is the
  distance that is sharp (`auto` focuses on `look_at`).
- `blades` gives the aperture a polygon shape, so out-of-focus lights
  become hexagons or heptagons instead of discs.
- `shutter` is the exposure time. Moving things blur over it. It defaults
  to half a frame (1/48 s at 24 fps), the "180° shutter" of film cameras.
- `rolling_shutter` reads the sensor top to bottom over this many seconds,
  so fast motion leans, as with phone cameras.

**Exposure.** With `exposure: auto` (the default) the camera meters the
scene and aims for a mid-grey average, like a camera in program mode;
`exposure_compensation: -1` makes it one stop darker. With
`exposure: manual`, brightness comes from `aperture`, `shutter` and `iso`
exactly as on a real camera, because the scene is lit in real units:
sunlight is about 100,000 lux, so the "sunny 16" rule (f/16, 1/100 s,
ISO 100) exposes a sunny scene correctly. Night scenes need manual
exposure, or auto exposure will brighten them to daylight.

`film` controls what happens after the sensor: tone mapping (`agx` by
default, a film-like response that keeps colour in bright highlights),
white balance in kelvin, contrast and saturation, film grain, bloom (lens
glare), halation (the red glow around highlights on film), vignetting and
chromatic aberration.

## Light

Light is measured in real units, which is what makes mixing sources
predictable.

- `sky` is a physically based atmosphere. Move the sun with
  `sun_elevation` and `sun_azimuth`; the sky colour, the sun's colour and
  brightness, and the haze all follow. Low sun gives golden hour.
- `hdri` lights the scene with a panoramic HDR photo.
- `background` is a plain, evenly lit surrounding, in nits.
- `bulb` and `softbox` are lights in lumens (a 60 W incandescent bulb is
  about 800 lm) with a colour temperature in kelvin.
- Any object can glow with a `light` material (`power` in lumens or
  `intensity` in nits), or with `emission` on any material.
- `fog` fills everything below `height` with scattering air. With a high
  `anisotropy` it glows around the sun and shows light shafts.

Bulbs, softboxes, and `light` materials on spheres, quads and disks are
sampled directly and converge quickly. Glowing boxes, cylinders and meshes
also light the scene, but more noisily.

## Errors

Mistakes are reported with the line, a caret under the spot, and a
suggestion when one is close:

```
line 3, column 3: sphere has no property "colr"
   3 |   colr: #fff
         ^
  hint: did you mean "color"?
```

<!-- reference:start -->
<!-- Generated by tools/gen-reference.mjs from src/scene/nodes.js. Do not edit by hand. -->

## Reference

### Settings

At most one of each; if a scene has two, the last one wins. `sky`, `hdri` and `background` are alternatives.

#### `camera`

A physical camera. Settings behave like a real one: lens, aperture, shutter and ISO.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `position` | vec3 | [0, 1.6, 5] | Where the camera is, in metres. |
| `look_at` | vec3 | [0, 1, 0] | The point the camera looks at. |
| `up` | vec3 | [0, 1, 0] | Which way is up for the camera. |
| `roll` | number | 0 | Tilt the horizon, in degrees. |
| `lens` | number | 35mm | Focal length. Write it with a unit: 35mm. |
| `sensor` | number | 36mm | Sensor width. 36mm is full frame, 23.5mm is APS-C. |
| `fov` | number | — | Horizontal field of view in degrees. Overrides lens. |
| `aperture` | number | 8 | f-number, written f/2.8. Smaller numbers blur the background more. 0 turns depth of field off. |
| `focus` | number or auto | auto | Focus distance in metres, or auto to focus on look_at. |
| `shutter` | number | — | Exposure time in seconds (1/60s). Controls motion blur. Default: half a frame (the 180° rule). |
| `iso` | number | 100 | Sensor sensitivity. Used when exposure is manual. |
| `exposure` | auto \| manual | auto | auto meters the scene; manual uses aperture, shutter and iso like a real camera. |
| `exposure_compensation` | number | 0 | Brighten (+) or darken (−) in stops (EV). |
| `blades` | number | 0 | Aperture blades; 5 to 9 give polygon-shaped bokeh. 0 is round. |
| `blade_rotation` | number | 0 | Rotation of the aperture shape in degrees. |
| `rolling_shutter` | number | 0 | Seconds the sensor takes to read top to bottom. Bends fast motion like a phone camera. |
| `distortion` | number | 0 | Lens barrel (+) or pincushion (−) distortion. |

#### `sky`

A physically based daytime sky with sun, from atmospheric scattering.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `sun_elevation` | number | 35 | Sun height above the horizon in degrees. Low values give golden hour. |
| `sun_azimuth` | number | 200 | Compass direction of the sun in degrees (0 north = −Z, 90 east = +X). |
| `sun_size` | number | 0.53 | Apparent sun diameter in degrees. Larger gives softer shadows. |
| `haze` | number | 1 | Amount of haze and dust. 0.2 is very clear, 4 is smoggy. |
| `intensity` | number | 1 | Scale all sky and sun light. |
| `ground` | color | [0.18, 0.17, 0.15] | Colour of the ground below the horizon. |

#### `hdri`

Light the scene with a panoramic HDR photo (equirectangular .hdr).

| Property | Type | Default | Meaning |
|---|---|---|---|
| `src` | string | — | Path or URL of the .hdr file. |
| `intensity` | number | 1 | Brightness multiplier. |
| `rotate` | number | 0 | Turn the panorama around the vertical axis, in degrees. |
| `visible` | bool | true | Show the panorama behind the scene, or only use it for light. |

#### `background`

A plain, evenly lit surrounding colour, like a studio cyclorama.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `color` | color | [1, 1, 1] | Colour. |
| `intensity` | number | 1000 | Brightness in nits. |

#### `fog`

Participating media: haze, mist and god rays. Fills everything below a height.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `density` | number | 0.02 | How thick the fog is. Visibility is about 3 / density metres. |
| `color` | color | [1, 1, 1] | How much light the fog scatters instead of absorbing, per colour. |
| `anisotropy` | number | 0.5 | 0 scatters evenly; toward 0.9 glows strongly around lights (god rays). |
| `height` | number | 50 | Top of the fog layer in metres. |

#### `film`

What happens after light hits the sensor: tone, grain, glow and lens character.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `tonemap` | agx \| aces \| reinhard \| none | agx | How bright light is compressed into the screen's range. |
| `contrast` | number | 1 | Contrast around mid grey. |
| `saturation` | number | 1 | Colour intensity. |
| `white_balance` | number | 6500 | Colour temperature rendered as white, in kelvin. 6500 is neutral daylight. |
| `grain` | number | 0 | Film grain amount, 0 to 1. |
| `grain_size` | number | 1 | Grain size in pixels. |
| `bloom` | number | 0.04 | Soft glow around bright light (lens glare), 0 to 1. |
| `halation` | number | 0 | Red-orange film halo around highlights, 0 to 1. |
| `vignette` | number | 0.5 | Corner darkening. 1 is the full cos⁴ falloff of an ideal lens, 0 is none. |
| `chromatic_aberration` | number | 0 | Colour fringes toward the corners, 0 to 1. |
| `denoise` | bool | true | Smooth the noise of low sample counts. |
| `clamp` | number | 12 | Limit on the brightness of indirect light per sample; removes fireflies. 0 turns it off. |

#### `timeline`

Length and frame rate of an animation.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `duration` | number | 0 | Length in seconds. 0 for a still image. |
| `fps` | number | 24 | Frames per second. |
| `time` | number | 0 | The moment shown when rendering a still. |

#### `render`

Quality settings.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `samples` | number | 512 | Samples per pixel for a still image. More is cleaner and slower. |
| `video_samples` | number | 64 | Samples per pixel for each video frame. |
| `bounces` | number | 8 | How many times light may bounce. |
| `resolution` | vec2 | [1280, 720] | Output width and height in pixels for stills and video. |

### Objects

Every object except the lights also takes the transform properties `position`, `rotate`, `scale`, `aim` and `visible`, and a `material` (or the `color` shorthand).

#### `sphere`

A sphere.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `position` | vec3 | [0, 0, 0] | Centre of the object, in metres. |
| `rotate` | vec3 | [0, 0, 0] | Rotation around X, Y and Z in degrees (applied X, then Y, then Z). |
| `scale` | number or vec3 | 1 | Extra scale, a number or [x, y, z]. |
| `aim` | vec3 | — | Turn the object so its local up (+Y) points at this point. |
| `visible` | bool | true | Hide the object without deleting it. |
| `material` | material | — | What the surface is made of. Default: light grey matte. |
| `color` | color | — | Shorthand: when no material is set, use a simple material of this colour. |
| `radius` | number | 1 | Radius in metres. |

#### `box`

A box centred on its position.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `position` | vec3 | [0, 0, 0] | Centre of the object, in metres. |
| `rotate` | vec3 | [0, 0, 0] | Rotation around X, Y and Z in degrees (applied X, then Y, then Z). |
| `scale` | number or vec3 | 1 | Extra scale, a number or [x, y, z]. |
| `aim` | vec3 | — | Turn the object so its local up (+Y) points at this point. |
| `visible` | bool | true | Hide the object without deleting it. |
| `material` | material | — | What the surface is made of. Default: light grey matte. |
| `color` | color | — | Shorthand: when no material is set, use a simple material of this colour. |
| `size` | number or vec3 | 1 | Width, height and depth in metres. |

#### `plane`

An infinite flat surface through its position, facing up (+Y) before rotation.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `position` | vec3 | [0, 0, 0] | Centre of the object, in metres. |
| `rotate` | vec3 | [0, 0, 0] | Rotation around X, Y and Z in degrees (applied X, then Y, then Z). |
| `scale` | number or vec3 | 1 | Extra scale, a number or [x, y, z]. |
| `aim` | vec3 | — | Turn the object so its local up (+Y) points at this point. |
| `visible` | bool | true | Hide the object without deleting it. |
| `material` | material | — | What the surface is made of. Default: light grey matte. |
| `color` | color | — | Shorthand: when no material is set, use a simple material of this colour. |

#### `ground`

An infinite floor at a given height. Shorthand for a plane.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `position` | vec3 | [0, 0, 0] | Centre of the object, in metres. |
| `rotate` | vec3 | [0, 0, 0] | Rotation around X, Y and Z in degrees (applied X, then Y, then Z). |
| `scale` | number or vec3 | 1 | Extra scale, a number or [x, y, z]. |
| `aim` | vec3 | — | Turn the object so its local up (+Y) points at this point. |
| `visible` | bool | true | Hide the object without deleting it. |
| `material` | material | — | What the surface is made of. Default: light grey matte. |
| `color` | color | — | Shorthand: when no material is set, use a simple material of this colour. |
| `height` | number | 0 | Height of the floor in metres. |

#### `disk`

A flat round disk facing up (+Y) before rotation.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `position` | vec3 | [0, 0, 0] | Centre of the object, in metres. |
| `rotate` | vec3 | [0, 0, 0] | Rotation around X, Y and Z in degrees (applied X, then Y, then Z). |
| `scale` | number or vec3 | 1 | Extra scale, a number or [x, y, z]. |
| `aim` | vec3 | — | Turn the object so its local up (+Y) points at this point. |
| `visible` | bool | true | Hide the object without deleting it. |
| `material` | material | — | What the surface is made of. Default: light grey matte. |
| `color` | color | — | Shorthand: when no material is set, use a simple material of this colour. |
| `radius` | number | 1 | Radius in metres. |

#### `quad`

A flat rectangle facing up (+Y) before rotation.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `position` | vec3 | [0, 0, 0] | Centre of the object, in metres. |
| `rotate` | vec3 | [0, 0, 0] | Rotation around X, Y and Z in degrees (applied X, then Y, then Z). |
| `scale` | number or vec3 | 1 | Extra scale, a number or [x, y, z]. |
| `aim` | vec3 | — | Turn the object so its local up (+Y) points at this point. |
| `visible` | bool | true | Hide the object without deleting it. |
| `material` | material | — | What the surface is made of. Default: light grey matte. |
| `color` | color | — | Shorthand: when no material is set, use a simple material of this colour. |
| `size` | number or vec2 | 1 | Width (X) and depth (Z) in metres. |

#### `cylinder`

A capped cylinder standing along Y.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `position` | vec3 | [0, 0, 0] | Centre of the object, in metres. |
| `rotate` | vec3 | [0, 0, 0] | Rotation around X, Y and Z in degrees (applied X, then Y, then Z). |
| `scale` | number or vec3 | 1 | Extra scale, a number or [x, y, z]. |
| `aim` | vec3 | — | Turn the object so its local up (+Y) points at this point. |
| `visible` | bool | true | Hide the object without deleting it. |
| `material` | material | — | What the surface is made of. Default: light grey matte. |
| `color` | color | — | Shorthand: when no material is set, use a simple material of this colour. |
| `radius` | number | 0.5 | Radius in metres. |
| `height` | number | 1 | Height in metres. |

#### `torus`

A ring (doughnut) lying flat in the XZ plane.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `position` | vec3 | [0, 0, 0] | Centre of the object, in metres. |
| `rotate` | vec3 | [0, 0, 0] | Rotation around X, Y and Z in degrees (applied X, then Y, then Z). |
| `scale` | number or vec3 | 1 | Extra scale, a number or [x, y, z]. |
| `aim` | vec3 | — | Turn the object so its local up (+Y) points at this point. |
| `visible` | bool | true | Hide the object without deleting it. |
| `material` | material | — | What the surface is made of. Default: light grey matte. |
| `color` | color | — | Shorthand: when no material is set, use a simple material of this colour. |
| `radius` | number | 1 | Distance from the centre to the middle of the tube. |
| `tube` | number | 0.25 | Radius of the tube. |
| `detail` | number | 64 | Segments around the ring. |

#### `mesh`

A triangle mesh loaded from a Wavefront .obj file.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `position` | vec3 | [0, 0, 0] | Centre of the object, in metres. |
| `rotate` | vec3 | [0, 0, 0] | Rotation around X, Y and Z in degrees (applied X, then Y, then Z). |
| `scale` | number or vec3 | 1 | Extra scale, a number or [x, y, z]. |
| `aim` | vec3 | — | Turn the object so its local up (+Y) points at this point. |
| `visible` | bool | true | Hide the object without deleting it. |
| `material` | material | — | What the surface is made of. Default: light grey matte. |
| `color` | color | — | Shorthand: when no material is set, use a simple material of this colour. |
| `src` | string | — | Path or URL of the .obj file. |
| `fit` | number | 0 | If above 0, scale the model so its largest side is this many metres, resting on y = 0. |
| `smooth` | bool | true | Smooth shading when the file has no normals. |

#### `terrain`

Procedural landscape: a square heightfield made from fractal noise.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `position` | vec3 | [0, 0, 0] | Centre of the object, in metres. |
| `rotate` | vec3 | [0, 0, 0] | Rotation around X, Y and Z in degrees (applied X, then Y, then Z). |
| `scale` | number or vec3 | 1 | Extra scale, a number or [x, y, z]. |
| `aim` | vec3 | — | Turn the object so its local up (+Y) points at this point. |
| `visible` | bool | true | Hide the object without deleting it. |
| `material` | material | — | What the surface is made of. Default: light grey matte. |
| `color` | color | — | Shorthand: when no material is set, use a simple material of this colour. |
| `size` | number | 40 | Side length in metres. |
| `height` | number | 4 | Height of the tallest hills in metres. |
| `detail` | number | 6 | Noise octaves; more gives rougher ground. |
| `frequency` | number | 0.06 | Hills per metre, roughly. |
| `resolution` | number | 160 | Grid cells along each side. |
| `seed` | number | 1 | Change for a different landscape. |
| `flatten` | number | 0 | Radius in metres around the centre that is kept flat at height 0. |

#### `rock`

A procedural rock: a sphere bent by noise.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `position` | vec3 | [0, 0, 0] | Centre of the object, in metres. |
| `rotate` | vec3 | [0, 0, 0] | Rotation around X, Y and Z in degrees (applied X, then Y, then Z). |
| `scale` | number or vec3 | 1 | Extra scale, a number or [x, y, z]. |
| `aim` | vec3 | — | Turn the object so its local up (+Y) points at this point. |
| `visible` | bool | true | Hide the object without deleting it. |
| `material` | material | — | What the surface is made of. Default: light grey matte. |
| `color` | color | — | Shorthand: when no material is set, use a simple material of this colour. |
| `radius` | number | 0.5 | Approximate radius in metres. |
| `roughness` | number | 0.35 | How lumpy the rock is, 0 to 1. |
| `detail` | number | 4 | Subdivision level, 1 to 6. |
| `seed` | number | 1 | Change for a different rock. |

#### `group`

Moves, rotates and scales the objects inside it together. Can contain other objects.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `position` | vec3 | [0, 0, 0] | Centre of the object, in metres. |
| `rotate` | vec3 | [0, 0, 0] | Rotation around X, Y and Z in degrees (applied X, then Y, then Z). |
| `scale` | number or vec3 | 1 | Extra scale, a number or [x, y, z]. |
| `aim` | vec3 | — | Turn the object so its local up (+Y) points at this point. |
| `visible` | bool | true | Hide the object without deleting it. |

#### `bulb`

A small round light, like a light bulb.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `position` | vec3 | [0, 0, 0] | Centre of the object, in metres. |
| `visible` | bool | true | Hide the object without deleting it. |
| `radius` | number | 0.04 | Radius of the glowing ball in metres. |
| `power` | number | 800 | Light output in lumens (a 60 W incandescent bulb is about 800 lm). |
| `temperature` | number | 2700 | Colour temperature in kelvin. |
| `color` | color | — | Light colour. Overrides temperature. |

#### `softbox`

A rectangular area light that shines out of its front (+Y) side, like a photo softbox or window.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `position` | vec3 | [0, 0, 0] | Centre of the object, in metres. |
| `rotate` | vec3 | [0, 0, 0] | Rotation around X, Y and Z in degrees (applied X, then Y, then Z). |
| `aim` | vec3 | — | Point the softbox at this point. |
| `visible` | bool | true | Hide the object without deleting it. |
| `size` | number or vec2 | 1 | Width and depth in metres. |
| `power` | number | 4000 | Light output in lumens. |
| `temperature` | number | 5600 | Colour temperature in kelvin. |
| `color` | color | — | Light colour. Overrides temperature. |

### Materials

All kinds except `light` take the same properties; they differ only in their defaults.

#### `material`

The general material. Every other material is this with different defaults.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `color` | color | [0.6, 0.6, 0.6] | Base colour (albedo, or reflectance for metals). |
| `roughness` | number | 0.5 | 0 is mirror-smooth, 1 is fully rough. |
| `metallic` | number | 0 | 1 for metals, 0 for everything else. |
| `specular` | number | 0.5 | Strength of the shine on non-metals. 0.5 matches most materials (4% reflectance). |
| `transmission` | number | 0 | 1 for glass and liquids: light passes through. |
| `ior` | number | 1.5 | Index of refraction (glass 1.5, water 1.33, diamond 2.42). |
| `tint` | color | [1, 1, 1] | Colour light takes on while travelling through a transparent material. |
| `tint_distance` | number | 0.1 | Distance in metres at which light has taken on the full tint colour. |
| `thin` | bool | false | Treat as a thin sheet (window pane, bubble): light passes through without bending. |
| `clearcoat` | number | 0 | A glossy varnish layer on top, 0 to 1 (car paint, lacquer). |
| `clearcoat_roughness` | number | 0.03 | Roughness of the varnish layer. |
| `emission` | color | [0, 0, 0] | Colour of light the surface gives off. |
| `emission_strength` | number | 0 | Brightness of emission in nits (cd/m²). A phone screen is about 500. |
| `pattern` | none \| checker \| grid \| noise \| marble \| wood \| stripes | none | Procedural pattern mixing color with color2. |
| `pattern_scale` | number | 1 | Pattern repeats per metre. |
| `color2` | color | [0.1, 0.1, 0.1] | Second colour of the pattern. |
| `roughness2` | number | — | Roughness where the pattern shows color2. Default: same as roughness. |
| `bump` | number | 0 | Strength of a noise bump on the surface normal, 0 to 1. |
| `bump_scale` | number | 4 | Bumps per metre. |
| `flow` | vec3 | [0, 0, 0] | Pattern and bump drift in metres per second (flowing water, moving clouds). |
| `texture` | string | — | Image file for the base colour, projected from three sides. |
| `texture_scale` | number | 1 | Texture repeats per metre. |

#### `matte`

Diffuse surfaces: paper, plaster, unglazed clay.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `color` | color | [0.7, 0.7, 0.7] | Base colour (albedo, or reflectance for metals). |
| `roughness` | number | 0.9 | 0 is mirror-smooth, 1 is fully rough. |
| `metallic` | number | 0 | 1 for metals, 0 for everything else. |
| `specular` | number | 0.3 | Strength of the shine on non-metals. 0.5 matches most materials (4% reflectance). |
| `transmission` | number | 0 | 1 for glass and liquids: light passes through. |
| `ior` | number | 1.5 | Index of refraction (glass 1.5, water 1.33, diamond 2.42). |
| `tint` | color | [1, 1, 1] | Colour light takes on while travelling through a transparent material. |
| `tint_distance` | number | 0.1 | Distance in metres at which light has taken on the full tint colour. |
| `thin` | bool | false | Treat as a thin sheet (window pane, bubble): light passes through without bending. |
| `clearcoat` | number | 0 | A glossy varnish layer on top, 0 to 1 (car paint, lacquer). |
| `clearcoat_roughness` | number | 0.03 | Roughness of the varnish layer. |
| `emission` | color | [0, 0, 0] | Colour of light the surface gives off. |
| `emission_strength` | number | 0 | Brightness of emission in nits (cd/m²). A phone screen is about 500. |
| `pattern` | none \| checker \| grid \| noise \| marble \| wood \| stripes | none | Procedural pattern mixing color with color2. |
| `pattern_scale` | number | 1 | Pattern repeats per metre. |
| `color2` | color | [0.1, 0.1, 0.1] | Second colour of the pattern. |
| `roughness2` | number | — | Roughness where the pattern shows color2. Default: same as roughness. |
| `bump` | number | 0 | Strength of a noise bump on the surface normal, 0 to 1. |
| `bump_scale` | number | 4 | Bumps per metre. |
| `flow` | vec3 | [0, 0, 0] | Pattern and bump drift in metres per second (flowing water, moving clouds). |
| `texture` | string | — | Image file for the base colour, projected from three sides. |
| `texture_scale` | number | 1 | Texture repeats per metre. |

#### `plastic`

Shiny non-metals: plastic, paint, ceramic.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `color` | color | [0.6, 0.05, 0.05] | Base colour (albedo, or reflectance for metals). |
| `roughness` | number | 0.25 | 0 is mirror-smooth, 1 is fully rough. |
| `metallic` | number | 0 | 1 for metals, 0 for everything else. |
| `specular` | number | 0.5 | Strength of the shine on non-metals. 0.5 matches most materials (4% reflectance). |
| `transmission` | number | 0 | 1 for glass and liquids: light passes through. |
| `ior` | number | 1.5 | Index of refraction (glass 1.5, water 1.33, diamond 2.42). |
| `tint` | color | [1, 1, 1] | Colour light takes on while travelling through a transparent material. |
| `tint_distance` | number | 0.1 | Distance in metres at which light has taken on the full tint colour. |
| `thin` | bool | false | Treat as a thin sheet (window pane, bubble): light passes through without bending. |
| `clearcoat` | number | 0 | A glossy varnish layer on top, 0 to 1 (car paint, lacquer). |
| `clearcoat_roughness` | number | 0.03 | Roughness of the varnish layer. |
| `emission` | color | [0, 0, 0] | Colour of light the surface gives off. |
| `emission_strength` | number | 0 | Brightness of emission in nits (cd/m²). A phone screen is about 500. |
| `pattern` | none \| checker \| grid \| noise \| marble \| wood \| stripes | none | Procedural pattern mixing color with color2. |
| `pattern_scale` | number | 1 | Pattern repeats per metre. |
| `color2` | color | [0.1, 0.1, 0.1] | Second colour of the pattern. |
| `roughness2` | number | — | Roughness where the pattern shows color2. Default: same as roughness. |
| `bump` | number | 0 | Strength of a noise bump on the surface normal, 0 to 1. |
| `bump_scale` | number | 4 | Bumps per metre. |
| `flow` | vec3 | [0, 0, 0] | Pattern and bump drift in metres per second (flowing water, moving clouds). |
| `texture` | string | — | Image file for the base colour, projected from three sides. |
| `texture_scale` | number | 1 | Texture repeats per metre. |

#### `metal`

Metals. Use gold, silver, copper, aluminium, iron, chrome, brass or titanium as colours.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `color` | color | [0.913, 0.922, 0.924] | Base colour (albedo, or reflectance for metals). |
| `roughness` | number | 0.2 | 0 is mirror-smooth, 1 is fully rough. |
| `metallic` | number | 1 | 1 for metals, 0 for everything else. |
| `specular` | number | 0.5 | Strength of the shine on non-metals. 0.5 matches most materials (4% reflectance). |
| `transmission` | number | 0 | 1 for glass and liquids: light passes through. |
| `ior` | number | 1.5 | Index of refraction (glass 1.5, water 1.33, diamond 2.42). |
| `tint` | color | [1, 1, 1] | Colour light takes on while travelling through a transparent material. |
| `tint_distance` | number | 0.1 | Distance in metres at which light has taken on the full tint colour. |
| `thin` | bool | false | Treat as a thin sheet (window pane, bubble): light passes through without bending. |
| `clearcoat` | number | 0 | A glossy varnish layer on top, 0 to 1 (car paint, lacquer). |
| `clearcoat_roughness` | number | 0.03 | Roughness of the varnish layer. |
| `emission` | color | [0, 0, 0] | Colour of light the surface gives off. |
| `emission_strength` | number | 0 | Brightness of emission in nits (cd/m²). A phone screen is about 500. |
| `pattern` | none \| checker \| grid \| noise \| marble \| wood \| stripes | none | Procedural pattern mixing color with color2. |
| `pattern_scale` | number | 1 | Pattern repeats per metre. |
| `color2` | color | [0.1, 0.1, 0.1] | Second colour of the pattern. |
| `roughness2` | number | — | Roughness where the pattern shows color2. Default: same as roughness. |
| `bump` | number | 0 | Strength of a noise bump on the surface normal, 0 to 1. |
| `bump_scale` | number | 4 | Bumps per metre. |
| `flow` | vec3 | [0, 0, 0] | Pattern and bump drift in metres per second (flowing water, moving clouds). |
| `texture` | string | — | Image file for the base colour, projected from three sides. |
| `texture_scale` | number | 1 | Texture repeats per metre. |

#### `mirror`

A perfect mirror.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `color` | color | [0.95, 0.95, 0.95] | Base colour (albedo, or reflectance for metals). |
| `roughness` | number | 0 | 0 is mirror-smooth, 1 is fully rough. |
| `metallic` | number | 1 | 1 for metals, 0 for everything else. |
| `specular` | number | 0.5 | Strength of the shine on non-metals. 0.5 matches most materials (4% reflectance). |
| `transmission` | number | 0 | 1 for glass and liquids: light passes through. |
| `ior` | number | 1.5 | Index of refraction (glass 1.5, water 1.33, diamond 2.42). |
| `tint` | color | [1, 1, 1] | Colour light takes on while travelling through a transparent material. |
| `tint_distance` | number | 0.1 | Distance in metres at which light has taken on the full tint colour. |
| `thin` | bool | false | Treat as a thin sheet (window pane, bubble): light passes through without bending. |
| `clearcoat` | number | 0 | A glossy varnish layer on top, 0 to 1 (car paint, lacquer). |
| `clearcoat_roughness` | number | 0.03 | Roughness of the varnish layer. |
| `emission` | color | [0, 0, 0] | Colour of light the surface gives off. |
| `emission_strength` | number | 0 | Brightness of emission in nits (cd/m²). A phone screen is about 500. |
| `pattern` | none \| checker \| grid \| noise \| marble \| wood \| stripes | none | Procedural pattern mixing color with color2. |
| `pattern_scale` | number | 1 | Pattern repeats per metre. |
| `color2` | color | [0.1, 0.1, 0.1] | Second colour of the pattern. |
| `roughness2` | number | — | Roughness where the pattern shows color2. Default: same as roughness. |
| `bump` | number | 0 | Strength of a noise bump on the surface normal, 0 to 1. |
| `bump_scale` | number | 4 | Bumps per metre. |
| `flow` | vec3 | [0, 0, 0] | Pattern and bump drift in metres per second (flowing water, moving clouds). |
| `texture` | string | — | Image file for the base colour, projected from three sides. |
| `texture_scale` | number | 1 | Texture repeats per metre. |

#### `glass`

Clear or tinted glass.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `color` | color | [1, 1, 1] | Base colour (albedo, or reflectance for metals). |
| `roughness` | number | 0 | 0 is mirror-smooth, 1 is fully rough. |
| `metallic` | number | 0 | 1 for metals, 0 for everything else. |
| `specular` | number | 0.5 | Strength of the shine on non-metals. 0.5 matches most materials (4% reflectance). |
| `transmission` | number | 1 | 1 for glass and liquids: light passes through. |
| `ior` | number | 1.5 | Index of refraction (glass 1.5, water 1.33, diamond 2.42). |
| `tint` | color | [1, 1, 1] | Colour light takes on while travelling through a transparent material. |
| `tint_distance` | number | 0.1 | Distance in metres at which light has taken on the full tint colour. |
| `thin` | bool | false | Treat as a thin sheet (window pane, bubble): light passes through without bending. |
| `clearcoat` | number | 0 | A glossy varnish layer on top, 0 to 1 (car paint, lacquer). |
| `clearcoat_roughness` | number | 0.03 | Roughness of the varnish layer. |
| `emission` | color | [0, 0, 0] | Colour of light the surface gives off. |
| `emission_strength` | number | 0 | Brightness of emission in nits (cd/m²). A phone screen is about 500. |
| `pattern` | none \| checker \| grid \| noise \| marble \| wood \| stripes | none | Procedural pattern mixing color with color2. |
| `pattern_scale` | number | 1 | Pattern repeats per metre. |
| `color2` | color | [0.1, 0.1, 0.1] | Second colour of the pattern. |
| `roughness2` | number | — | Roughness where the pattern shows color2. Default: same as roughness. |
| `bump` | number | 0 | Strength of a noise bump on the surface normal, 0 to 1. |
| `bump_scale` | number | 4 | Bumps per metre. |
| `flow` | vec3 | [0, 0, 0] | Pattern and bump drift in metres per second (flowing water, moving clouds). |
| `texture` | string | — | Image file for the base colour, projected from three sides. |
| `texture_scale` | number | 1 | Texture repeats per metre. |

#### `water`

Water with a moving, rippled surface.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `color` | color | [1, 1, 1] | Base colour (albedo, or reflectance for metals). |
| `roughness` | number | 0.02 | 0 is mirror-smooth, 1 is fully rough. |
| `metallic` | number | 0 | 1 for metals, 0 for everything else. |
| `specular` | number | 0.5 | Strength of the shine on non-metals. 0.5 matches most materials (4% reflectance). |
| `transmission` | number | 1 | 1 for glass and liquids: light passes through. |
| `ior` | number | 1.333 | Index of refraction (glass 1.5, water 1.33, diamond 2.42). |
| `tint` | color | [0.55, 0.85, 0.9] | Colour light takes on while travelling through a transparent material. |
| `tint_distance` | number | 2 | Distance in metres at which light has taken on the full tint colour. |
| `thin` | bool | false | Treat as a thin sheet (window pane, bubble): light passes through without bending. |
| `clearcoat` | number | 0 | A glossy varnish layer on top, 0 to 1 (car paint, lacquer). |
| `clearcoat_roughness` | number | 0.03 | Roughness of the varnish layer. |
| `emission` | color | [0, 0, 0] | Colour of light the surface gives off. |
| `emission_strength` | number | 0 | Brightness of emission in nits (cd/m²). A phone screen is about 500. |
| `pattern` | none \| checker \| grid \| noise \| marble \| wood \| stripes | none | Procedural pattern mixing color with color2. |
| `pattern_scale` | number | 1 | Pattern repeats per metre. |
| `color2` | color | [0.1, 0.1, 0.1] | Second colour of the pattern. |
| `roughness2` | number | — | Roughness where the pattern shows color2. Default: same as roughness. |
| `bump` | number | 0.25 | Strength of a noise bump on the surface normal, 0 to 1. |
| `bump_scale` | number | 1.5 | Bumps per metre. |
| `flow` | vec3 | [0.3, 0, 0.12] | Pattern and bump drift in metres per second (flowing water, moving clouds). |
| `texture` | string | — | Image file for the base colour, projected from three sides. |
| `texture_scale` | number | 1 | Texture repeats per metre. |

#### `light`

A surface that gives off light. Put it on a sphere, quad or disk to make a lamp.

| Property | Type | Default | Meaning |
|---|---|---|---|
| `color` | color | — | Light colour. Overrides temperature. |
| `temperature` | number | 5000 | Colour temperature in kelvin. |
| `power` | number | — | Total light output in lumens, spread over the object's area. |
| `intensity` | number | 1000 | Surface brightness in nits (cd/m²). Ignored when power is set. |

### Functions

`sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `sqrt`, `abs`, `floor`, `ceil`, `round`, `fract`, `sign`, `exp`, `log`, `log2`, `pow`, `mod`, `min`, `max`, `clamp`, `mix`, `lerp`, `step`, `smoothstep`, `remap`, `length`, `distance`, `normalize`, `dot`, `cross`, `len`, `rgb`, `hsl`, `hex`, `kelvin`, `linear`, `gray`, `grey`, `random`, `pick`, `noise`, `fbm`, `ease`, `bounce`, `fall`, `spring`, `orbit`, `pendulum`, `wobble`

### Easings

`linear`, `in`, `out`, `in_out`, `smooth`, `sine_in`, `sine_out`, `sine_in_out`, `expo_in`, `expo_out`, `expo_in_out`, `back_in`, `back_out`, `step`

### Metal colours

`gold`, `silver`, `copper`, `aluminium`, `aluminum`, `iron`, `chrome`, `brass`, `titanium`

### Units

`m`, `cm`, `mm`, `km`, `in`, `ft`, `deg`, `rad`, `turn`, `s`, `ms`, `min`, `K`, `lm`, `nit`, `nits`, `lx`, `ev`, `EV`, `%`, `x`
<!-- reference:end -->

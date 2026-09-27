// Every node kind the language understands, with its properties, their
// types and defaults. Documentation in LANGUAGE.md is written from this file.
//
// Property types:
//   number  vec3  vec2  color  bool  string  material
//   size3   a number (uniform) or a vec3
//   size2   a number (square) or a vec2
//   enum    one of `values` (written as a string or a bare word)
//   auto    a number or the text "auto"

const TRANSFORM = {
  position: { type: 'vec3', default: [0, 0, 0], doc: 'Centre of the object, in metres.' },
  rotate: { type: 'vec3', default: [0, 0, 0], doc: 'Rotation around X, Y and Z in degrees (applied X, then Y, then Z).' },
  scale: { type: 'size3', default: 1, doc: 'Extra scale, a number or [x, y, z].' },
  aim: { type: 'vec3', default: null, doc: 'Turn the object so its local up (+Y) points at this point.' },
  visible: { type: 'bool', default: true, doc: 'Hide the object without deleting it.' },
};

const SURFACE = {
  ...TRANSFORM,
  material: { type: 'material', default: null, doc: 'What the surface is made of. Default: light grey matte.' },
  color: { type: 'color', default: null, doc: 'Shorthand: when no material is set, use a simple material of this colour.' },
};

export const OBJECT_KINDS = {
  sphere: {
    doc: 'A sphere.',
    props: { ...SURFACE, radius: { type: 'number', default: 1, doc: 'Radius in metres.' } },
  },
  box: {
    doc: 'A box centred on its position.',
    props: { ...SURFACE, size: { type: 'size3', default: 1, doc: 'Width, height and depth in metres.' } },
  },
  plane: {
    doc: 'An infinite flat surface through its position, facing up (+Y) before rotation.',
    props: { ...SURFACE },
  },
  ground: {
    doc: 'An infinite floor at a given height. Shorthand for a plane.',
    props: { ...SURFACE, height: { type: 'number', default: 0, doc: 'Height of the floor in metres.' } },
  },
  disk: {
    doc: 'A flat round disk facing up (+Y) before rotation.',
    props: { ...SURFACE, radius: { type: 'number', default: 1, doc: 'Radius in metres.' } },
  },
  quad: {
    doc: 'A flat rectangle facing up (+Y) before rotation.',
    props: { ...SURFACE, size: { type: 'size2', default: 1, doc: 'Width (X) and depth (Z) in metres.' } },
  },
  cylinder: {
    doc: 'A capped cylinder standing along Y.',
    props: {
      ...SURFACE,
      radius: { type: 'number', default: 0.5, doc: 'Radius in metres.' },
      height: { type: 'number', default: 1, doc: 'Height in metres.' },
    },
  },
  torus: {
    doc: 'A ring (doughnut) lying flat in the XZ plane.',
    props: {
      ...SURFACE,
      radius: { type: 'number', default: 1, doc: 'Distance from the centre to the middle of the tube.' },
      tube: { type: 'number', default: 0.25, doc: 'Radius of the tube.' },
      detail: { type: 'number', default: 64, doc: 'Segments around the ring.' },
    },
  },
  mesh: {
    doc: 'A triangle mesh loaded from a Wavefront .obj file.',
    props: {
      ...SURFACE,
      src: { type: 'string', default: null, doc: 'Path or URL of the .obj file.' },
      fit: { type: 'number', default: 0, doc: 'If above 0, scale the model so its largest side is this many metres, resting on y = 0.' },
      smooth: { type: 'bool', default: true, doc: 'Smooth shading when the file has no normals.' },
    },
  },
  terrain: {
    doc: 'Procedural landscape: a square heightfield made from fractal noise.',
    props: {
      ...SURFACE,
      size: { type: 'number', default: 40, doc: 'Side length in metres.' },
      height: { type: 'number', default: 4, doc: 'Height of the tallest hills in metres.' },
      detail: { type: 'number', default: 6, doc: 'Noise octaves; more gives rougher ground.' },
      frequency: { type: 'number', default: 0.06, doc: 'Hills per metre, roughly.' },
      resolution: { type: 'number', default: 160, doc: 'Grid cells along each side.' },
      seed: { type: 'number', default: 1, doc: 'Change for a different landscape.' },
      flatten: { type: 'number', default: 0, doc: 'Radius in metres around the centre that is kept flat at height 0.' },
    },
  },
  rock: {
    doc: 'A procedural rock: a sphere bent by noise.',
    props: {
      ...SURFACE,
      radius: { type: 'number', default: 0.5, doc: 'Approximate radius in metres.' },
      roughness: { type: 'number', default: 0.35, doc: 'How lumpy the rock is, 0 to 1.' },
      detail: { type: 'number', default: 4, doc: 'Subdivision level, 1 to 6.' },
      seed: { type: 'number', default: 1, doc: 'Change for a different rock.' },
    },
  },
  group: {
    doc: 'Moves, rotates and scales the objects inside it together.',
    props: { ...TRANSFORM },
    children: true,
  },
  bulb: {
    doc: 'A small round light, like a light bulb.',
    props: {
      position: TRANSFORM.position,
      visible: TRANSFORM.visible,
      radius: { type: 'number', default: 0.04, doc: 'Radius of the glowing ball in metres.' },
      power: { type: 'number', default: 800, doc: 'Light output in lumens (a 60 W incandescent bulb is about 800 lm).' },
      temperature: { type: 'number', default: 2700, doc: 'Colour temperature in kelvin.' },
      color: { type: 'color', default: null, doc: 'Light colour. Overrides temperature.' },
    },
  },
  softbox: {
    doc: 'A rectangular area light that shines out of its front (+Y) side, like a photo softbox or window.',
    props: {
      position: TRANSFORM.position,
      rotate: TRANSFORM.rotate,
      aim: { ...TRANSFORM.aim, doc: 'Point the softbox at this point.' },
      visible: TRANSFORM.visible,
      size: { type: 'size2', default: 1, doc: 'Width and depth in metres.' },
      power: { type: 'number', default: 4000, doc: 'Light output in lumens.' },
      temperature: { type: 'number', default: 5600, doc: 'Colour temperature in kelvin.' },
      color: { type: 'color', default: null, doc: 'Light colour. Overrides temperature.' },
    },
  },
};

const PATTERNS = ['none', 'checker', 'grid', 'noise', 'marble', 'wood', 'stripes'];

// All material kinds share these parameters; each kind only changes the
// defaults. `material` is the general (principled) form.
const MATERIAL_PROPS = {
  color: { type: 'color', default: [0.6, 0.6, 0.6], doc: 'Base colour (albedo, or reflectance for metals).' },
  roughness: { type: 'number', default: 0.5, doc: '0 is mirror-smooth, 1 is fully rough.' },
  metallic: { type: 'number', default: 0, doc: '1 for metals, 0 for everything else.' },
  specular: { type: 'number', default: 0.5, doc: 'Strength of the shine on non-metals. 0.5 matches most materials (4% reflectance).' },
  transmission: { type: 'number', default: 0, doc: '1 for glass and liquids: light passes through.' },
  ior: { type: 'number', default: 1.5, doc: 'Index of refraction (glass 1.5, water 1.33, diamond 2.42).' },
  tint: { type: 'color', default: [1, 1, 1], doc: 'Colour light takes on while travelling through a transparent material.' },
  tint_distance: { type: 'number', default: 0.1, doc: 'Distance in metres at which light has taken on the full tint colour.' },
  thin: { type: 'bool', default: false, doc: 'Treat as a thin sheet (window pane, bubble): light passes through without bending.' },
  clearcoat: { type: 'number', default: 0, doc: 'A glossy varnish layer on top, 0 to 1 (car paint, lacquer).' },
  clearcoat_roughness: { type: 'number', default: 0.03, doc: 'Roughness of the varnish layer.' },
  emission: { type: 'color', default: [0, 0, 0], doc: 'Colour of light the surface gives off.' },
  emission_strength: { type: 'number', default: 0, doc: 'Brightness of emission in nits (cd/m²). A phone screen is about 500.' },
  pattern: { type: 'enum', values: PATTERNS, default: 'none', doc: 'Procedural pattern mixing color with color2.' },
  pattern_scale: { type: 'number', default: 1, doc: 'Pattern repeats per metre.' },
  color2: { type: 'color', default: [0.1, 0.1, 0.1], doc: 'Second colour of the pattern.' },
  roughness2: { type: 'number', default: null, doc: 'Roughness where the pattern shows color2. Default: same as roughness.' },
  bump: { type: 'number', default: 0, doc: 'Strength of a noise bump on the surface normal, 0 to 1.' },
  bump_scale: { type: 'number', default: 4, doc: 'Bumps per metre.' },
  flow: { type: 'vec3', default: [0, 0, 0], doc: 'Pattern and bump drift in metres per second (flowing water, moving clouds).' },
  texture: { type: 'string', default: null, doc: 'Image file for the base colour, projected from three sides.' },
  texture_scale: { type: 'number', default: 1, doc: 'Texture repeats per metre.' },
};

const withDefaults = (doc, overrides) => {
  const props = {};
  for (const [k, spec] of Object.entries(MATERIAL_PROPS)) {
    props[k] = k in overrides ? { ...spec, default: overrides[k] } : spec;
  }
  return { doc, props };
};

export const MATERIAL_KINDS = {
  material: withDefaults('The general material. Every other material is this with different defaults.', {}),
  matte: withDefaults('Diffuse surfaces: paper, plaster, unglazed clay.', { color: [0.7, 0.7, 0.7], roughness: 0.9, specular: 0.3 }),
  plastic: withDefaults('Shiny non-metals: plastic, paint, ceramic.', { color: [0.6, 0.05, 0.05], roughness: 0.25 }),
  metal: withDefaults('Metals. Use gold, silver, copper, aluminium, iron, chrome, brass or titanium as colours.', { color: [0.913, 0.922, 0.924], roughness: 0.2, metallic: 1 }),
  mirror: withDefaults('A perfect mirror.', { color: [0.95, 0.95, 0.95], roughness: 0, metallic: 1 }),
  glass: withDefaults('Clear or tinted glass.', { color: [1, 1, 1], roughness: 0, transmission: 1, ior: 1.5 }),
  water: withDefaults('Water with a moving, rippled surface.', {
    color: [1, 1, 1], roughness: 0.02, transmission: 1, ior: 1.333, tint: [0.55, 0.85, 0.9], tint_distance: 2,
    bump: 0.25, bump_scale: 1.5, flow: [0.3, 0, 0.12],
  }),
  light: {
    doc: 'A surface that gives off light. Put it on a sphere, quad or disk to make a lamp.',
    props: {
      color: { type: 'color', default: null, doc: 'Light colour. Overrides temperature.' },
      temperature: { type: 'number', default: 5000, doc: 'Colour temperature in kelvin.' },
      power: { type: 'number', default: null, doc: 'Total light output in lumens, spread over the object\'s area.' },
      intensity: { type: 'number', default: 1000, doc: 'Surface brightness in nits (cd/m²). Ignored when power is set.' },
    },
  },
};

export const SETTINGS_KINDS = {
  camera: {
    doc: 'A physical camera. Settings behave like a real one: lens, aperture, shutter and ISO.',
    props: {
      position: { type: 'vec3', default: [0, 1.6, 5], doc: 'Where the camera is, in metres.' },
      look_at: { type: 'vec3', default: [0, 1, 0], doc: 'The point the camera looks at.' },
      up: { type: 'vec3', default: [0, 1, 0], doc: 'Which way is up for the camera.' },
      roll: { type: 'number', default: 0, doc: 'Tilt the horizon, in degrees.' },
      lens: { type: 'number', default: 0.035, doc: 'Focal length. Write it with a unit: 35mm.' },
      sensor: { type: 'number', default: 0.036, doc: 'Sensor width. 36mm is full frame, 23.5mm is APS-C.' },
      fov: { type: 'number', default: null, doc: 'Horizontal field of view in degrees. Overrides lens.' },
      aperture: { type: 'number', default: 8, doc: 'f-number, written f/2.8. Smaller numbers blur the background more. 0 turns depth of field off.' },
      focus: { type: 'auto', default: 'auto', doc: 'Focus distance in metres, or auto to focus on look_at.' },
      shutter: { type: 'number', default: null, doc: 'Exposure time in seconds (1/60s). Controls motion blur. Default: half a frame (the 180° rule).' },
      iso: { type: 'number', default: 100, doc: 'Sensor sensitivity. Used when exposure is manual.' },
      exposure: { type: 'enum', values: ['auto', 'manual'], default: 'auto', doc: 'auto meters the scene; manual uses aperture, shutter and iso like a real camera.' },
      exposure_compensation: { type: 'number', default: 0, doc: 'Brighten (+) or darken (−) in stops (EV).' },
      blades: { type: 'number', default: 0, doc: 'Aperture blades; 5 to 9 give polygon-shaped bokeh. 0 is round.' },
      blade_rotation: { type: 'number', default: 0, doc: 'Rotation of the aperture shape in degrees.' },
      rolling_shutter: { type: 'number', default: 0, doc: 'Seconds the sensor takes to read top to bottom. Bends fast motion like a phone camera.' },
      distortion: { type: 'number', default: 0, doc: 'Lens barrel (+) or pincushion (−) distortion.' },
    },
  },
  sky: {
    doc: 'A physically based daytime sky with sun, from atmospheric scattering.',
    props: {
      sun_elevation: { type: 'number', default: 35, doc: 'Sun height above the horizon in degrees. Low values give golden hour.' },
      sun_azimuth: { type: 'number', default: 200, doc: 'Compass direction of the sun in degrees (0 north = −Z, 90 east = +X).' },
      sun_size: { type: 'number', default: 0.53, doc: 'Apparent sun diameter in degrees. Larger gives softer shadows.' },
      haze: { type: 'number', default: 1, doc: 'Amount of haze and dust. 0.2 is very clear, 4 is smoggy.' },
      intensity: { type: 'number', default: 1, doc: 'Scale all sky and sun light.' },
      ground: { type: 'color', default: [0.18, 0.17, 0.15], doc: 'Colour of the ground below the horizon.' },
    },
  },
  hdri: {
    doc: 'Light the scene with a panoramic HDR photo (equirectangular .hdr).',
    props: {
      src: { type: 'string', default: null, doc: 'Path or URL of the .hdr file.' },
      intensity: { type: 'number', default: 1, doc: 'Brightness multiplier.' },
      rotate: { type: 'number', default: 0, doc: 'Turn the panorama around the vertical axis, in degrees.' },
      visible: { type: 'bool', default: true, doc: 'Show the panorama behind the scene, or only use it for light.' },
    },
  },
  background: {
    doc: 'A plain, evenly lit surrounding colour, like a studio cyclorama.',
    props: {
      color: { type: 'color', default: [1, 1, 1], doc: 'Colour.' },
      intensity: { type: 'number', default: 1000, doc: 'Brightness in nits.' },
    },
  },
  fog: {
    doc: 'Participating media: haze, mist and god rays. Fills everything below a height.',
    props: {
      density: { type: 'number', default: 0.02, doc: 'How thick the fog is. Visibility is about 3 / density metres.' },
      color: { type: 'color', default: [1, 1, 1], doc: 'How much light the fog scatters instead of absorbing, per colour.' },
      anisotropy: { type: 'number', default: 0.5, doc: '0 scatters evenly; toward 0.9 glows strongly around lights (god rays).' },
      height: { type: 'number', default: 50, doc: 'Top of the fog layer in metres.' },
    },
  },
  film: {
    doc: 'What happens after light hits the sensor: tone, grain, glow and lens character.',
    props: {
      tonemap: { type: 'enum', values: ['agx', 'aces', 'reinhard', 'none'], default: 'agx', doc: 'How bright light is compressed into the screen\'s range.' },
      contrast: { type: 'number', default: 1, doc: 'Contrast around mid grey.' },
      saturation: { type: 'number', default: 1, doc: 'Colour intensity.' },
      white_balance: { type: 'number', default: 6500, doc: 'Colour temperature rendered as white, in kelvin. 6500 is neutral daylight.' },
      grain: { type: 'number', default: 0, doc: 'Film grain amount, 0 to 1.' },
      grain_size: { type: 'number', default: 1, doc: 'Grain size in pixels.' },
      bloom: { type: 'number', default: 0.04, doc: 'Soft glow around bright light (lens glare), 0 to 1.' },
      halation: { type: 'number', default: 0, doc: 'Red-orange film halo around highlights, 0 to 1.' },
      vignette: { type: 'number', default: 0.5, doc: 'Corner darkening. 1 is the full cos⁴ falloff of an ideal lens, 0 is none.' },
      chromatic_aberration: { type: 'number', default: 0, doc: 'Colour fringes toward the corners, 0 to 1.' },
      denoise: { type: 'bool', default: true, doc: 'Smooth the noise of low sample counts.' },
      clamp: { type: 'number', default: 12, doc: 'Limit on the brightness of indirect light per sample; removes fireflies. 0 turns it off.' },
    },
  },
  timeline: {
    doc: 'Length and frame rate of an animation.',
    props: {
      duration: { type: 'number', default: 0, doc: 'Length in seconds. 0 for a still image.' },
      fps: { type: 'number', default: 24, doc: 'Frames per second.' },
      time: { type: 'number', default: 0, doc: 'The moment shown when rendering a still.' },
    },
  },
  render: {
    doc: 'Quality settings.',
    props: {
      samples: { type: 'number', default: 512, doc: 'Samples per pixel for a still image. More is cleaner and slower.' },
      video_samples: { type: 'number', default: 64, doc: 'Samples per pixel for each video frame.' },
      bounces: { type: 'number', default: 8, doc: 'How many times light may bounce.' },
      resolution: { type: 'vec2', default: [1280, 720], doc: 'Output width and height in pixels for stills and video.' },
    },
  },
};

export const ALL_KINDS = { ...OBJECT_KINDS, ...MATERIAL_KINDS, ...SETTINGS_KINDS };

export const kindCategory = (kind) =>
  kind in OBJECT_KINDS ? 'object' : kind in MATERIAL_KINDS ? 'material' : kind in SETTINGS_KINDS ? 'settings' : null;

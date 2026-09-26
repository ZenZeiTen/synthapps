/**
 * hd2d-threejs.js — HD-2D building blocks for three.js (WebGLRenderer path).
 *
 * Tested against three r186 (three@0.186.1) in headless Chromium (WebGL2, SwiftShader).
 * Check your installed version first; see threejs-retro-forge/references/threejs-r18x.md.
 *
 * What is here, mapped to the skill:
 *   HD2D_DEFAULTS         the six dials with starting values
 *   createSprite()        billboard sprite that the renderer cannot tell from a mesh:
 *                         MeshStandardMaterial, normal map, alpha-tested, plus the
 *                         three-layer shadow strategy (shadow-map shadow from a proxy that
 *                         faces the key light, a blob decal, and receiving shadows)
 *   createKeyLight()      directional key light with a sized shadow camera
 *   createCameraRig()     long-lens perspective camera at a fixed pitch, optional texel snap
 *   createDioramaPost()   HDR post chain in the skill's order:
 *                         scene (linear HDR) → depth of field (bokeh gather, optional
 *                         tilt-shift) → bloom (threshold on HDR) → ACES → sRGB → screen
 *   prefersReducedEffects()  read the OS reduced-motion setting for the accessibility gate
 *
 * Not included: screen-space contact shadows (the blob decal stands in for them), SSAO,
 * fog and god rays, and a WebGPU/TSL version. Keep UI in HTML over the canvas: this post
 * chain never touches it.
 *
 * Usage:
 *   import * as THREE from 'three';
 *   import * as HD2D from './hd2d-threejs.js';
 *   const post = HD2D.createDioramaPost(renderer, { focusDistance: 12 });
 *   const hero = HD2D.createSprite({ map, normalMap, frameWidth: 32, frameHeight: 48, columns: 4 });
 *   scene.add(hero.group);
 *   // each frame:
 *   hero.update(camera, keyLight); rig.update(); post.render(scene, camera);
 */

import * as THREE from 'three';

/** Starting values for the six dials. Write the ones you pick into the spec. */
export const HD2D_DEFAULTS = Object.freeze({
  texel: 1 / 32, // world units per sprite texel (1 unit = 1 m: a 48-texel hero is 1.5 m)
  spriteHeight: 48, // character height in texels
  envRatio: 2, // environment texels per sprite texel: 1 or 2, always an integer
  pitchDeg: 32, // camera declination, 25-40
  fovDeg: 28, // vertical field of view, 20-35 (long lens)
  keyElevationDeg: 45, // key light elevation, keep below ~60
});

/** Convert a size in sprite texels to world units. */
export function texelsToWorld(texels, texel = HD2D_DEFAULTS.texel) {
  return texels * texel;
}

/** True when the user asked the OS for reduced motion; turn DoF and bloom down or off. */
export function prefersReducedEffects() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function pixelTexture(texture, colorSpace) {
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  return texture;
}

let blobTexture = null;
function getBlobTexture() {
  if (blobTexture) return blobTexture;
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1;
      const dy = (y + 0.5) / size * 2 - 1;
      const r = Math.min(1, Math.hypot(dx, dy));
      const a = 1 - r * r * (3 - 2 * r); // smoothstep falloff: dark centre, soft rim
      data[(y * size + x) * 4 + 3] = Math.round(255 * a);
    }
  }
  blobTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  blobTexture.magFilter = THREE.LinearFilter;
  blobTexture.minFilter = THREE.LinearFilter;
  blobTexture.needsUpdate = true;
  return blobTexture;
}

/**
 * A billboard sprite that stands on its feet and is lit like a mesh.
 *
 * @param {object} o
 * @param {THREE.Texture} o.map            colour sheet (sRGB); shared textures are cloned
 * @param {THREE.Texture} [o.normalMap]    matching normal sheet, OpenGL convention (green up),
 *                                         e.g. from scripts/sprite_normalmap.py
 * @param {number} o.frameWidth            frame size in texels
 * @param {number} o.frameHeight
 * @param {number} [o.columns=1]           sheet layout, row 0 at the top
 * @param {number} [o.rows=1]
 * @param {number} [o.texel]               world units per texel (dial 1)
 * @param {number} [o.alphaTest=0.5]       hard pixel edges; also cuts the shadow
 * @param {number} [o.normalScale=1]       use -1 on y for a DirectX (green-down) normal map
 * @param {boolean} [o.shadowProxy=true]   cast the shadow from a quad that faces the key light
 * @param {boolean} [o.blob=true]          soft contact decal under the feet
 * @param {number} [o.blobOpacity=0.45]
 */
export function createSprite(o) {
  const texel = o.texel ?? HD2D_DEFAULTS.texel;
  const columns = o.columns ?? 1;
  const rows = o.rows ?? 1;
  const width = o.frameWidth * texel;
  const height = o.frameHeight * texel;
  const alphaTest = o.alphaTest ?? 0.5;

  const map = pixelTexture(o.map.clone(), THREE.SRGBColorSpace);
  const normalMap = o.normalMap ? pixelTexture(o.normalMap.clone(), THREE.NoColorSpace) : null;
  for (const t of [map, normalMap]) if (t) t.repeat.set(1 / columns, 1 / rows);

  // Pivot at the feet: the quad's bottom edge sits on the group origin.
  const geometry = new THREE.PlaneGeometry(width, height);
  geometry.translate(0, height / 2, 0);

  const material = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    alphaTest,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  if (normalMap) {
    const s = o.normalScale ?? 1;
    material.normalScale.set(s, s);
  }

  const group = new THREE.Group();
  const sprite = new THREE.Mesh(geometry, material);
  sprite.name = 'hd2d-sprite';
  sprite.receiveShadow = true;
  group.add(sprite);

  // Layer 1: a shadow-only proxy. Same alpha-tested silhouette, turned to face the key
  // light, so the shadow keeps its width when the camera orbits (the rotation gate).
  let proxy = null;
  if (o.shadowProxy !== false) {
    const proxyMaterial = new THREE.MeshBasicMaterial({
      map,
      alphaTest,
      side: THREE.DoubleSide,
      colorWrite: false,
      depthWrite: false,
    });
    proxy = new THREE.Mesh(geometry, proxyMaterial);
    proxy.name = 'hd2d-shadow-proxy';
    proxy.castShadow = true;
    group.add(proxy);
  } else {
    sprite.castShadow = true;
  }

  // Layer 2: the blob decal. Dark contact where the feet meet the floor, in every light.
  let blob = null;
  if (o.blob !== false) {
    blob = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 0.9, width * 0.45),
      new THREE.MeshBasicMaterial({
        map: getBlobTexture(),
        color: 0x000000,
        transparent: true,
        opacity: o.blobOpacity ?? 0.45,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    blob.name = 'hd2d-blob';
    blob.rotation.order = 'YXZ'; // yaw first, so the wide axis can follow the sprite
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = texel * 0.25;
    blob.renderOrder = 1;
    group.add(blob);
  }
  // Layer 3 is receiving: the sprite is lit and shadowed by the world like any mesh.

  const _v = new THREE.Vector3();
  const _w = new THREE.Vector3();

  function setFrame(column, row) {
    const x = column / columns;
    const y = 1 - (row + 1) / rows; // flipY: row 0 is the top row of the image
    map.offset.set(x, y);
    if (normalMap) normalMap.offset.set(x, y);
  }
  setFrame(0, 0);

  /**
   * Face the camera around Y (cylindrical billboard), turn the blob with it, and turn the
   * shadow proxy toward the light. Call once per frame, after moving the camera.
   */
  function update(camera, light) {
    group.getWorldPosition(_w);
    camera.getWorldPosition(_v);
    sprite.rotation.y = Math.atan2(_v.x - _w.x, _v.z - _w.z);
    if (blob) blob.rotation.y = sprite.rotation.y; // wide axis spans the figure's width
    if (proxy && light) {
      light.getWorldPosition(_v);
      if (light.target) {
        light.target.getWorldPosition(_w);
        _v.sub(_w); // direction toward the light
      } else {
        _v.sub(_w);
      }
      proxy.rotation.y = Math.atan2(_v.x, _v.z);
    }
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
    map.dispose();
    normalMap?.dispose();
    proxy?.material.dispose();
    if (blob) {
      blob.geometry.dispose();
      blob.material.dispose();
    }
  }

  return { group, sprite, proxy, blob, material, width, height, setFrame, update, dispose };
}

/**
 * Directional key light aimed at `target`, with a shadow camera sized to `extent`.
 * Elevation above ~60 degrees leaves billboards almost no shadow (dial 6).
 */
export function createKeyLight({
  elevationDeg = HD2D_DEFAULTS.keyElevationDeg,
  azimuthDeg = 135,
  intensity = 3,
  color = 0xfff1dc,
  target = new THREE.Vector3(),
  extent = 12,
  shadowMapSize = 2048,
} = {}) {
  if (elevationDeg > 60) {
    console.warn(`hd2d: key elevation ${elevationDeg} deg is above ~60; sprite shadows will collapse`);
  }
  const light = new THREE.DirectionalLight(color, intensity);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const dist = extent * 2;
  light.position.set(
    target.x + Math.cos(el) * Math.sin(az) * dist,
    target.y + Math.sin(el) * dist,
    target.z + Math.cos(el) * Math.cos(az) * dist,
  );
  light.target.position.copy(target);
  light.castShadow = true;
  light.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  const cam = light.shadow.camera;
  cam.left = -extent;
  cam.right = extent;
  cam.top = extent;
  cam.bottom = -extent;
  cam.near = 0.1;
  cam.far = dist * 2;
  light.shadow.bias = -0.0005;
  light.shadow.normalBias = 0.02;
  return light;
}

/**
 * Long-lens camera at a fixed pitch around a target. With `snap` > 0 the target is
 * snapped to that world grid (use the environment texel) so textures do not crawl while
 * the camera pans (the motion gate).
 */
export function createCameraRig(camera, {
  pitchDeg = HD2D_DEFAULTS.pitchDeg,
  yawDeg = 0,
  fovDeg = HD2D_DEFAULTS.fovDeg,
  distance = 14,
  target = new THREE.Vector3(),
  snap = 0,
} = {}) {
  const params = { pitchDeg, yawDeg, fovDeg, distance, snap };
  const _t = new THREE.Vector3();

  function update() {
    if (camera.fov !== params.fovDeg) {
      camera.fov = params.fovDeg;
      camera.updateProjectionMatrix();
    }
    _t.copy(target);
    if (params.snap > 0) {
      _t.x = Math.round(_t.x / params.snap) * params.snap;
      _t.z = Math.round(_t.z / params.snap) * params.snap;
    }
    const p = THREE.MathUtils.degToRad(params.pitchDeg);
    const y = THREE.MathUtils.degToRad(params.yawDeg);
    camera.position.set(
      _t.x + Math.sin(y) * Math.cos(p) * params.distance,
      _t.y + Math.sin(p) * params.distance,
      _t.z + Math.cos(y) * Math.cos(p) * params.distance,
    );
    camera.lookAt(_t);
  }

  /** Distance at which a world height fills the view vertically. */
  function distanceToFit(worldHeight) {
    return worldHeight / (2 * Math.tan(THREE.MathUtils.degToRad(params.fovDeg) / 2));
  }

  update();
  return { camera, target, params, update, distanceToFit };
}

// ----------------------------------------------------------------------------- post chain

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// Single-pass bokeh gather after D. Gustafsson, "Bokeh depth of field in a single pass"
// (2018): golden-angle spiral, samples grow outward, background samples may not blur over
// a sharper foreground. The start angle is rotated per pixel (interleaved gradient noise),
// trading banding for fine noise.
const DOF_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 texelSize;
uniform float cameraNear;
uniform float cameraFar;
uniform float focusDistance;
uniform float focusScale;
uniform float maxBlur;
uniform float tiltShift;
uniform float tiltCenter;
uniform float tiltBand;
varying vec2 vUv;

const float GOLDEN_ANGLE = 2.39996323;

float hd2dLinearDepth(vec2 uv) {
  float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
  return 2.0 * cameraNear * cameraFar / (cameraFar + cameraNear - z * (cameraFar - cameraNear));
}

float hd2dBlurSize(float depth, vec2 uv) {
  float coc = clamp((1.0 / focusDistance - 1.0 / depth) * focusScale, -1.0, 1.0);
  float tilt = tiltShift * smoothstep(tiltBand, tiltBand + 0.35, abs(uv.y - tiltCenter));
  return max(abs(coc), tilt) * maxBlur;
}

void main() {
  float centerDepth = hd2dLinearDepth(vUv);
  float centerSize = hd2dBlurSize(centerDepth, vUv);
  vec3 color = texture2D(tColor, vUv).rgb;
  if (centerSize < 0.5) { gl_FragColor = vec4(color, 1.0); return; }
  float tot = 1.0;
  float radius = RAD_SCALE;
  float angle = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  for (int i = 0; i < MAX_ITER; i++) {
    if (radius >= maxBlur) break;
    vec2 uv = vUv + vec2(cos(angle), sin(angle)) * texelSize * radius;
    vec3 sampleColor = texture2D(tColor, uv).rgb;
    float sampleDepth = hd2dLinearDepth(uv);
    float sampleSize = hd2dBlurSize(sampleDepth, uv);
    if (sampleDepth > centerDepth) sampleSize = clamp(sampleSize, 0.0, centerSize * 2.0);
    float m = smoothstep(radius - 0.5, radius + 0.5, sampleSize);
    color += mix(color / tot, sampleColor, m);
    tot += 1.0;
    radius += RAD_SCALE / radius;
    angle += GOLDEN_ANGLE;
  }
  gl_FragColor = vec4(color / tot, 1.0);
}`;

// Bright pass on HDR input, with a 4-tap box downsample.
const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 texelSize;
uniform float threshold;
uniform float knee;
varying vec2 vUv;
vec3 bright(vec3 c) {
  float b = max(c.r, max(c.g, c.b));
  float soft = clamp(b - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float w = max(soft, b - threshold) / max(b, 1e-4);
  return c * w;
}
void main() {
  vec2 o = texelSize * 0.5;
  vec3 c = bright(texture2D(tColor, vUv + vec2(-o.x, -o.y)).rgb)
         + bright(texture2D(tColor, vUv + vec2( o.x, -o.y)).rgb)
         + bright(texture2D(tColor, vUv + vec2(-o.x,  o.y)).rgb)
         + bright(texture2D(tColor, vUv + vec2( o.x,  o.y)).rgb);
  gl_FragColor = vec4(c * 0.25, 1.0);
}`;

const DOWN_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 texelSize;
varying vec2 vUv;
void main() {
  vec2 o = texelSize * 0.5;
  vec3 c = texture2D(tColor, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tColor, vUv + vec2(o.x, -o.y)).rgb
         + texture2D(tColor, vUv + vec2(-o.x, o.y)).rgb + texture2D(tColor, vUv + vec2(o.x, o.y)).rgb;
  gl_FragColor = vec4(c * 0.25, 1.0);
}`;

const BLUR_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 direction;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tColor, vUv).rgb * 0.2270270270;
  c += (texture2D(tColor, vUv + direction * 1.0).rgb + texture2D(tColor, vUv - direction * 1.0).rgb) * 0.1945945946;
  c += (texture2D(tColor, vUv + direction * 2.0).rgb + texture2D(tColor, vUv - direction * 2.0).rgb) * 0.1216216216;
  c += (texture2D(tColor, vUv + direction * 3.0).rgb + texture2D(tColor, vUv - direction * 3.0).rgb) * 0.0540540541;
  c += (texture2D(tColor, vUv + direction * 4.0).rgb + texture2D(tColor, vUv - direction * 4.0).rgb) * 0.0162162162;
  gl_FragColor = vec4(c, 1.0);
}`;

// ACES: the Stephen Hill RRT+ODT fit, the same curve three.js uses for
// ACESFilmicToneMapping. Then the sRGB transfer function, because a ShaderMaterial
// drawing to the screen gets no colour-space conversion from three.js.
const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tBloomA;
uniform sampler2D tBloomB;
uniform float bloomStrength;
uniform float exposure;
varying vec2 vUv;

vec3 hd2dRRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 hd2dAcesFilmic(vec3 color) {
  const mat3 inputMat = mat3(
    vec3(0.59719, 0.07600, 0.02840),
    vec3(0.35458, 0.90834, 0.13383),
    vec3(0.04823, 0.01566, 0.83777));
  const mat3 outputMat = mat3(
    vec3(1.60475, -0.10208, -0.00327),
    vec3(-0.53108, 1.10813, -0.07276),
    vec3(-0.07367, -0.00605, 1.07602));
  color *= exposure / 0.6;
  color = outputMat * hd2dRRTAndODTFit(inputMat * color);
  return clamp(color, 0.0, 1.0);
}
vec3 hd2dLinearToSRGB(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}
void main() {
  vec3 hdr = texture2D(tColor, vUv).rgb;
  hdr += bloomStrength * 0.5 * (texture2D(tBloomA, vUv).rgb + texture2D(tBloomB, vUv).rgb);
  gl_FragColor = vec4(hd2dLinearToSRGB(hd2dAcesFilmic(hdr)), 1.0);
}`;

/**
 * The HD-2D post chain. Call `render(scene, camera)` instead of `renderer.render`.
 *
 * Options (all live-editable later through `post.params`):
 *   focusDistance  world distance of the focal plane (dial 5)
 *   focusScale     how fast blur grows away from the focal plane (bigger = shallower)
 *   maxBlur        largest blur radius in pixels (cost grows with its square)
 *   tiltShift      0-1 extra blur toward the top and bottom of the frame (miniature look)
 *   tiltCenter     screen height of the sharp band, 0 = bottom, 1 = top
 *   tiltBand       half-height of the sharp band in screen units
 *   dof, bloom     booleans; turn both off for the reduced-effects path
 *   bloomThreshold HDR value where bloom starts; keep it above 1.0
 *   bloomStrength, exposure
 */
export function createDioramaPost(renderer, options = {}) {
  const params = {
    focusDistance: 12,
    focusScale: 6,
    maxBlur: 10,
    tiltShift: 0,
    tiltCenter: 0.45,
    tiltBand: 0.12,
    dof: true,
    bloom: true,
    bloomThreshold: 1.2,
    bloomKnee: 0.4,
    bloomStrength: 0.6,
    exposure: 1,
    ...options,
  };
  if (prefersReducedEffects() && options.respectReducedMotion !== false) {
    params.tiltShift = 0;
    params.bloomStrength *= 0.5;
  }

  const radScale = 1.5;
  const maxIter = Math.ceil((params.maxBlur * params.maxBlur) / (2 * radScale)) + 4;

  const hdr = { type: THREE.HalfFloatType, depthBuffer: false, samples: 0 };
  const sceneRT = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: 0,
    depthTexture: new THREE.DepthTexture(1, 1),
  });
  const dofRT = new THREE.WebGLRenderTarget(1, 1, hdr);
  const half = [new THREE.WebGLRenderTarget(1, 1, hdr), new THREE.WebGLRenderTarget(1, 1, hdr)];
  const quarter = [new THREE.WebGLRenderTarget(1, 1, hdr), new THREE.WebGLRenderTarget(1, 1, hdr)];

  const make = (fragmentShader, uniforms, defines = {}) =>
    new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader,
      uniforms,
      defines,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

  const dofMat = make(
    DOF_FRAG,
    {
      tColor: { value: null },
      tDepth: { value: null },
      texelSize: { value: new THREE.Vector2() },
      cameraNear: { value: 0.1 },
      cameraFar: { value: 100 },
      focusDistance: { value: params.focusDistance },
      focusScale: { value: params.focusScale },
      maxBlur: { value: params.maxBlur },
      tiltShift: { value: params.tiltShift },
      tiltCenter: { value: params.tiltCenter },
      tiltBand: { value: params.tiltBand },
    },
    { MAX_ITER: maxIter, RAD_SCALE: radScale.toFixed(3) },
  );
  const brightMat = make(BRIGHT_FRAG, {
    tColor: { value: null },
    texelSize: { value: new THREE.Vector2() },
    threshold: { value: params.bloomThreshold },
    knee: { value: params.bloomKnee },
  });
  const downMat = make(DOWN_FRAG, { tColor: { value: null }, texelSize: { value: new THREE.Vector2() } });
  const blurMat = make(BLUR_FRAG, { tColor: { value: null }, direction: { value: new THREE.Vector2() } });
  const compositeMat = make(COMPOSITE_FRAG, {
    tColor: { value: null },
    tBloomA: { value: null },
    tBloomB: { value: null },
    bloomStrength: { value: params.bloomStrength },
    exposure: { value: params.exposure },
  });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), dofMat);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  black.needsUpdate = true;

  let width = 1;
  let height = 1;
  function setSize(w, h) {
    width = Math.max(1, Math.floor(w));
    height = Math.max(1, Math.floor(h));
    sceneRT.setSize(width, height);
    dofRT.setSize(width, height);
    for (const rt of half) rt.setSize(Math.max(1, width >> 1), Math.max(1, height >> 1));
    for (const rt of quarter) rt.setSize(Math.max(1, width >> 2), Math.max(1, height >> 2));
  }
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  setSize(size.x, size.y);

  function draw(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCamera);
  }

  function blurPair(pair) {
    const [a, b] = pair;
    blurMat.uniforms.tColor.value = a.texture;
    blurMat.uniforms.direction.value.set(1 / a.width, 0);
    draw(blurMat, b);
    blurMat.uniforms.tColor.value = b.texture;
    blurMat.uniforms.direction.value.set(0, 1 / b.height);
    draw(blurMat, a);
  }

  function render(scene, camera) {
    const previousTarget = renderer.getRenderTarget();
    const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (buffer.x !== width || buffer.y !== height) setSize(buffer.x, buffer.y);

    renderer.setRenderTarget(sceneRT);
    renderer.clear();
    renderer.render(scene, camera);
    let source = sceneRT.texture;

    if (params.dof) {
      const u = dofMat.uniforms;
      u.tColor.value = sceneRT.texture;
      u.tDepth.value = sceneRT.depthTexture;
      u.texelSize.value.set(1 / width, 1 / height);
      u.cameraNear.value = camera.near;
      u.cameraFar.value = camera.far;
      u.focusDistance.value = params.focusDistance;
      u.focusScale.value = params.focusScale;
      u.maxBlur.value = Math.min(params.maxBlur, Math.sqrt((maxIter - 4) * 2 * radScale));
      u.tiltShift.value = params.tiltShift;
      u.tiltCenter.value = params.tiltCenter;
      u.tiltBand.value = params.tiltBand;
      draw(dofMat, dofRT);
      source = dofRT.texture;
    }

    let bloomA = black;
    let bloomB = black;
    if (params.bloom && params.bloomStrength > 0) {
      brightMat.uniforms.tColor.value = source;
      brightMat.uniforms.texelSize.value.set(1 / width, 1 / height);
      brightMat.uniforms.threshold.value = params.bloomThreshold;
      brightMat.uniforms.knee.value = params.bloomKnee;
      draw(brightMat, half[0]);
      blurPair(half);
      downMat.uniforms.tColor.value = half[0].texture;
      downMat.uniforms.texelSize.value.set(1 / half[0].width, 1 / half[0].height);
      draw(downMat, quarter[0]);
      blurPair(quarter);
      bloomA = half[0].texture;
      bloomB = quarter[0].texture;
    }

    const c = compositeMat.uniforms;
    c.tColor.value = source;
    c.tBloomA.value = bloomA;
    c.tBloomB.value = bloomB;
    c.bloomStrength.value = params.bloom ? params.bloomStrength : 0;
    c.exposure.value = params.exposure;
    draw(compositeMat, previousTarget);
  }

  function dispose() {
    for (const rt of [sceneRT, dofRT, ...half, ...quarter]) rt.dispose();
    sceneRT.depthTexture?.dispose();
    for (const m of [dofMat, brightMat, downMat, blurMat, compositeMat]) m.dispose();
    quad.geometry.dispose();
    black.dispose();
  }

  return { params, render, setSize, dispose, targets: { sceneRT, dofRT } };
}

/**
 * retro-glsl.js — WebGLRenderer path for threejs-retro-forge.
 *
 * Verified against the three.js r18x API surface (ShaderMaterial with default GLSL ES 1.00
 * source, which WebGL2 accepts). No add-on imports, no EffectComposer, one dependency.
 *
 *   import * as THREE from 'three';
 *   import { PSXMaterial, RetroPipeline, BAYER_GLSL } from './retro-glsl.js';
 *
 * Pipeline order implemented here (see references/shader-cookbook.md for why):
 *   scene @ res  ->  halation blur  ->  tonemap + sRGB + dither + quantize @ res
 *                ->  nearest integer upscale  ->  CRT signal chain @ output  ->  screen
 */

import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 * Shared GLSL
 * ------------------------------------------------------------------ */

/** Closed-form Bayer matrices. bayer2 reproduces [[0,2],[3,1]]/4 exactly. */
export const BAYER_GLSL = /* glsl */`
float bayer2(vec2 a){ a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
#define bayer4(a) (bayer2(0.5 * (a)) * 0.25 + bayer2(a))
#define bayer8(a) (bayer4(0.5 * (a)) * 0.25 + bayer2(a))
`;

const SRGB_GLSL = /* glsl */`
vec3 linearToSRGB(vec3 c){
  return mix(pow(max(c, vec3(0.0)), vec3(0.41666)) * 1.055 - 0.055,
             c * 12.92,
             step(c, vec3(0.0031308)));
}
`;

/* ------------------------------------------------------------------ *
 * PSXMaterial
 * ------------------------------------------------------------------ */

const PSX_VERT = /* glsl */`
uniform vec2  uSnapRes;      // virtual resolution the vertex grid snaps to
uniform float uSnapEnabled;  // 1 = snap, 0 = subpixel
uniform float uAffine;       // 1 = affine warp, 0 = perspective correct

varying vec2  vUVW;          // uv * clip.w   (see cookbook for the derivation)
varying float vW;            // clip.w
varying vec3  vLight;
varying float vDepth;

uniform vec3  uLightDir;
uniform vec3  uLightColor;
uniform vec3  uAmbient;

void main() {
  vec4 mv   = modelViewMatrix * vec4(position, 1.0);
  vec4 clip = projectionMatrix * mv;

  // --- vertex snapping -------------------------------------------------
  // Guard w <= 0 (vertices behind the camera); dividing there throws geometry
  // across the screen. Snap only when the vertex is genuinely in front.
  if (uSnapEnabled > 0.5 && clip.w > 1e-4) {
    vec2 grid = uSnapRes * 0.5;               // NDC spans -1..1 over uSnapRes pixels
    vec3 ndc  = clip.xyz / clip.w;
    ndc.xy    = floor(ndc.xy * grid + 0.5) / grid;
    clip.xyz  = ndc * clip.w;
  }

  // --- affine texture setup --------------------------------------------
  // Perspective-correct interpolation of (uv * w) divided by that of (w)
  // collapses to plain barycentric interpolation of uv. Exact, not approximate.
  vW   = mix(1.0, clip.w, uAffine);
  vUVW = uv * vW;

  // --- per-vertex (Gouraud) lighting -----------------------------------
  vec3 n = normalize(normalMatrix * normal);
  vLight = uAmbient + uLightColor * max(dot(n, normalize(uLightDir)), 0.0);

  vDepth = -mv.z;
  gl_Position = clip;
}
`;

const PSX_FRAG = /* glsl */`
uniform sampler2D uMap;
uniform float uHasMap;
uniform vec3  uColor;
uniform float uAlpha;
uniform float uStipple;     // 1 = dithered cutout instead of alpha blend
uniform vec3  uFogColor;
uniform float uFogNear;
uniform float uFogFar;

varying vec2  vUVW;
varying float vW;
varying vec3  vLight;
varying float vDepth;

${BAYER_GLSL}

void main() {
  vec2 texUV = vUVW / vW;

  vec3 base = uColor;
  if (uHasMap > 0.5) base *= texture2D(uMap, texUV).rgb;

  vec3 col = base * vLight;

  // Linear fog — the hardware did linear, and it should genuinely hide the
  // end of the level rather than tint it.
  float f = clamp((uFogFar - vDepth) / max(uFogFar - uFogNear, 1e-4), 0.0, 1.0);
  col = mix(uFogColor, col, f);

  if (uStipple > 0.5) {
    // Period-accurate transparency, and it sidesteps sort order entirely
    // because discarded fragments never reach the blend stage.
    if (bayer4(gl_FragCoord.xy) > uAlpha) discard;
    gl_FragColor = vec4(col, 1.0);
  } else {
    gl_FragColor = vec4(col, uAlpha);
  }
}
`;

/**
 * Fifth-generation console material: vertex snapping, affine warp, Gouraud
 * lighting, linear fog, stipple transparency.
 *
 * @param {object} o
 * @param {THREE.Texture} [o.map]
 * @param {number|THREE.Color} [o.color=0xffffff]
 * @param {THREE.Vector2} [o.snapRes]     virtual resolution for the snap grid
 * @param {boolean} [o.snap=true]
 * @param {boolean} [o.affine=true]
 * @param {boolean} [o.stipple=false]     dithered cutout instead of alpha blend
 * @param {number}  [o.opacity=1]
 */
export class PSXMaterial extends THREE.ShaderMaterial {
  constructor(o = {}) {
    super({
      vertexShader: PSX_VERT,
      fragmentShader: PSX_FRAG,
      transparent: !o.stipple && (o.opacity ?? 1) < 1,
      uniforms: {
        uMap:        { value: o.map ?? null },
        uHasMap:     { value: o.map ? 1 : 0 },
        uColor:      { value: new THREE.Color(o.color ?? 0xffffff) },
        uAlpha:      { value: o.opacity ?? 1 },
        uStipple:    { value: o.stipple ? 1 : 0 },
        uSnapRes:    { value: o.snapRes ?? new THREE.Vector2(320, 240) },
        uSnapEnabled:{ value: o.snap === false ? 0 : 1 },
        uAffine:     { value: o.affine === false ? 0 : 1 },
        uLightDir:   { value: o.lightDir ?? new THREE.Vector3(0.4, 1.0, 0.6) },
        uLightColor: { value: new THREE.Color(o.lightColor ?? 0xffffff) },
        uAmbient:    { value: new THREE.Color(o.ambient ?? 0x404050) },
        uFogColor:   { value: new THREE.Color(o.fogColor ?? 0x000000) },
        uFogNear:    { value: o.fogNear ?? 8 },
        uFogFar:     { value: o.fogFar  ?? 40 }
      }
    });
    if (o.map) {
      // Nearest + no mipmaps is the hard PS1/arcade look. Enable mipmaps only
      // if you specifically want the N64 result (soft at distance).
      o.map.magFilter = THREE.NearestFilter;
      o.map.minFilter = THREE.NearestFilter;
      o.map.generateMipmaps = false;
    }
  }

  /** Convenience: retarget the snap grid after a resize. */
  setSnapResolution(w, h) { this.uniforms.uSnapRes.value.set(w, h); }
}

/* ------------------------------------------------------------------ *
 * Post passes
 * ------------------------------------------------------------------ */

const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Bright-pass + separable blur, run at half the virtual resolution.
const BLUR_FRAG = /* glsl */`
uniform sampler2D uTex;
uniform vec2  uTexel;
uniform vec2  uDir;
uniform float uThreshold;   // < 0 disables the bright-pass (second blur axis)
varying vec2 vUv;
void main(){
  vec3 sum = vec3(0.0);
  float w[5];
  w[0]=0.227; w[1]=0.194; w[2]=0.121; w[3]=0.054; w[4]=0.016;
  for (int i = -4; i <= 4; i++) {
    vec3 s = texture2D(uTex, vUv + uDir * uTexel * float(i)).rgb;
    if (uThreshold >= 0.0) s = max(s - uThreshold, 0.0);
    sum += s * w[int(abs(float(i)))];
  }
  gl_FragColor = vec4(sum, 1.0);
}
`;

// Runs at virtual resolution. Halation is added here, in linear space, BEFORE
// quantization — so the glow gets converted into dither texture rather than
// smeared across already-banded regions.
const QUANTIZE_FRAG = /* glsl */`
uniform sampler2D uScene;
uniform sampler2D uHalation;
uniform sampler2D uPalette;   // optional 1D LUT, N x 1
uniform float uPaletteSize;   // 0 = per-channel quantization instead
uniform float uHalationAmt;
uniform float uExposure;
uniform float uLevels;        // per-channel levels, e.g. 32 for RGB555
uniform float uDitherAmt;
uniform float uDitherScale;   // 4 or 8
uniform vec2  uRes;
varying vec2 vUv;

${BAYER_GLSL}
${SRGB_GLSL}

void main(){
  vec3 col = texture2D(uScene, vUv).rgb * uExposure;
  col += texture2D(uHalation, vUv).rgb * uHalationAmt;

  // Dither and quantize in DISPLAY space — that is where the hardware's
  // framebuffer lived, and where the 8-bit grid actually is.
  col = linearToSRGB(clamp(col, 0.0, 8.0));

  vec2 p = vUv * uRes;
  float t = (uDitherScale > 6.0 ? bayer8(p) : bayer4(p)) - 0.5;

  if (uPaletteSize > 0.5) {
    // Nearest entry in a LUT, with the Bayer threshold nudging the search so
    // adjacent pixels can resolve to different entries (true palette dither).
    col = clamp(col + t * uDitherAmt * (1.0 / 8.0), 0.0, 1.0);
    vec3 best = vec3(0.0);
    float bestD = 1e9;
    const int MAXN = 64;
    for (int i = 0; i < MAXN; i++) {
      if (float(i) >= uPaletteSize) break;
      vec3 c = texture2D(uPalette, vec2((float(i) + 0.5) / uPaletteSize, 0.5)).rgb;
      vec3 d = (col - c) * vec3(0.30, 0.59, 0.11);   // luma-weighted, not raw RGB
      float dist = dot(d, d);
      if (dist < bestD) { bestD = dist; best = c; }
    }
    col = best;
  } else {
    col += t * uDitherAmt / uLevels;
    col = floor(clamp(col, 0.0, 1.0) * (uLevels - 1.0) + 0.5) / (uLevels - 1.0);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

// Runs at OUTPUT resolution. Everything here belongs to the physical display.
const SIGNAL_FRAG = /* glsl */`
uniform sampler2D uTex;
uniform vec2  uOutRes;
uniform vec2  uVirtRes;
uniform float uCurvature;
uniform float uScanline;
uniform float uMask;         // 0 when the display can't resolve one
uniform float uChroma;
uniform float uVignette;
uniform float uBrightness;
uniform float uNoise;
uniform float uTime;
varying vec2 vUv;

vec2 barrel(vec2 uv, float k){
  uv = uv * 2.0 - 1.0;
  vec2 off = uv.yx * uv.yx;
  uv += uv * off * k;
  return uv * 0.5 + 0.5;
}

float hash(vec2 p){ return fract(sin(dot(p, vec2(41.0, 289.0))) * 45758.5453); }

void main(){
  vec2 uv = uCurvature > 0.0 ? barrel(vUv, uCurvature) : vUv;

  // Off-screen after warping = outside the tube.
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // Composite chroma split: sample R and B at a slight horizontal offset.
  vec3 col;
  if (uChroma > 0.0) {
    float o = uChroma / uOutRes.x;
    col = vec3(texture2D(uTex, uv + vec2(o, 0.0)).r,
               texture2D(uTex, uv).g,
               texture2D(uTex, uv - vec2(o, 0.0)).b);
  } else {
    col = texture2D(uTex, uv).rgb;
  }

  // Scanlines live in VIRTUAL line space, and bright pixels get a wider beam —
  // that widening is what keeps a real CRT looking bright rather than dim.
  if (uScanline > 0.0) {
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    float line = sin(uv.y * uVirtRes.y * 3.14159265);
    float beam = mix(1.0 - uScanline, 1.0, luma);
    col *= mix(1.0, abs(line) * 0.5 + 0.5, 1.0 - beam);
  }

  // Aperture grille in OUTPUT pixel space. Needs >= 3x scale to resolve;
  // the caller sets uMask to 0 below that or this produces moire.
  if (uMask > 0.0) {
    float i = mod(gl_FragCoord.x, 3.0);
    vec3 m = i < 1.0 ? vec3(1.0, 0.6, 0.6)
           : i < 2.0 ? vec3(0.6, 1.0, 0.6)
                     : vec3(0.6, 0.6, 1.0);
    col *= mix(vec3(1.0), m, uMask);
  }

  if (uNoise > 0.0) {
    col += (hash(gl_FragCoord.xy + fract(uTime) * 313.0) - 0.5) * uNoise;
  }

  if (uVignette > 0.0) {
    vec2 v = uv * (1.0 - uv.yx);
    col *= pow(clamp(v.x * v.y * 16.0, 0.0, 1.0), uVignette);
  }

  // Scanlines + mask can eat half the luminance. Put it back or the whole
  // image just reads as dim.
  gl_FragColor = vec4(clamp(col * uBrightness, 0.0, 1.0), 1.0);
}
`;

/* ------------------------------------------------------------------ *
 * RetroPipeline
 * ------------------------------------------------------------------ */

const PRESETS = {
  psx:      { virtual: [320, 240], levels: 32, dither: 4, curvature: 0.06, scanline: 0.35,
              mask: 0.30, chroma: 0.8, vignette: 0.22, brightness: 1.55, halation: 0.35 },
  n64:      { virtual: [320, 240], levels: 32, dither: 8, curvature: 0.05, scanline: 0.22,
              mask: 0.18, chroma: 1.4, vignette: 0.20, brightness: 1.40, halation: 0.45 },
  arcade:   { virtual: [320, 224], levels: 64, dither: 4, curvature: 0.10, scanline: 0.50,
              mask: 0.45, chroma: 0.4, vignette: 0.30, brightness: 1.80, halation: 0.55 },
  vga:      { virtual: [320, 200], levels: 6,  dither: 8, curvature: 0.03, scanline: 0.30,
              mask: 0.20, chroma: 0.0, vignette: 0.15, brightness: 1.45, halation: 0.20 },
  lcdClean: { virtual: [480, 270], levels: 32, dither: 8, curvature: 0.0,  scanline: 0.0,
              mask: 0.0,  chroma: 0.0, vignette: 0.0,  brightness: 1.0,  halation: 0.25 },
  aero:     { virtual: [0, 0],     levels: 256, dither: 0, curvature: 0.0, scanline: 0.0,
              mask: 0.0,  chroma: 0.0, vignette: 0.10, brightness: 1.0,  halation: 0.70 }
};

/**
 * Full retro pipeline. Owns its render targets and full-screen passes.
 *
 *   const pipe = new RetroPipeline(renderer, { preset: 'psx' });
 *   pipe.setSize(window.innerWidth, window.innerHeight);
 *   // in the loop:
 *   pipe.render(scene, camera, elapsedSeconds);
 *
 * `virtual: [0, 0]` in a preset means "render at output resolution" — used for
 * eras with no pixel budget (Frutiger Aero, Vectordelia).
 */
export class RetroPipeline {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.o = Object.assign({}, PRESETS[opts.preset ?? 'psx'], opts);
    this.reducedMotion =
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    renderer.setPixelRatio(1);   // the virtual target owns resolution, not the DPR

    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    this.quadCam.position.z = 1;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    const nearest = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
    this.sceneRT = new THREE.WebGLRenderTarget(2, 2, {
      ...nearest, type: THREE.HalfFloatType, depthBuffer: true,
      stencilBuffer: false, samples: 0
    });
    this.quantRT = new THREE.WebGLRenderTarget(2, 2, { ...nearest, depthBuffer: false });
    this.blurA = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false });
    this.blurB = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false });

    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: BLUR_FRAG,
      uniforms: {
        uTex: { value: null }, uTexel: { value: new THREE.Vector2() },
        uDir: { value: new THREE.Vector2(1, 0) }, uThreshold: { value: 0.75 }
      }
    });

    this.quantMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: QUANTIZE_FRAG,
      uniforms: {
        uScene: { value: null }, uHalation: { value: null },
        uPalette: { value: opts.paletteTexture ?? null },
        uPaletteSize: { value: opts.paletteSize ?? 0 },
        uHalationAmt: { value: this.o.halation },
        uExposure: { value: this.o.exposure ?? 1 },
        uLevels: { value: this.o.levels },
        uDitherAmt: { value: this.o.dither > 0 ? 1 : 0 },
        uDitherScale: { value: this.o.dither || 4 },
        uRes: { value: new THREE.Vector2() }
      }
    });

    this.signalMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: SIGNAL_FRAG,
      uniforms: {
        uTex: { value: null },
        uOutRes: { value: new THREE.Vector2() },
        uVirtRes: { value: new THREE.Vector2() },
        uCurvature: { value: this.o.curvature },
        uScanline: { value: this.o.scanline },
        uMask: { value: this.o.mask },
        uChroma: { value: this.o.chroma },
        uVignette: { value: this.o.vignette },
        uBrightness: { value: this.o.brightness },
        // Animated noise is a photosensitivity concern and the first thing
        // reduced-motion should remove.
        uNoise: { value: this.reducedMotion ? 0 : (this.o.noise ?? 0) },
        uTime: { value: 0 }
      }
    });
  }

  /**
   * Sizes the canvas to an integer multiple of the virtual resolution and
   * letterboxes the remainder. Non-integer upscaling of a pixel grid produces
   * uneven pixel widths, which is the loudest tell of a fake-retro build.
   */
  setSize(outW, outH) {
    const [vw0, vh0] = this.o.virtual;
    if (!vw0 || !vh0) {
      this.vw = outW; this.vh = outH; this.scale = 1;
    } else {
      this.scale = Math.max(1, Math.floor(Math.min(outW / vw0, outH / vh0)));
      this.vw = vw0; this.vh = vh0;
    }
    const cw = this.vw * this.scale, ch = this.vh * this.scale;

    this.renderer.setSize(cw, ch, true);
    this.sceneRT.setSize(this.vw, this.vh);
    this.quantRT.setSize(this.vw, this.vh);
    const bw = Math.max(1, this.vw >> 1), bh = Math.max(1, this.vh >> 1);
    this.blurA.setSize(bw, bh);
    this.blurB.setSize(bw, bh);

    this.quantMat.uniforms.uRes.value.set(this.vw, this.vh);
    this.signalMat.uniforms.uOutRes.value.set(cw, ch);
    this.signalMat.uniforms.uVirtRes.value.set(this.vw, this.vh);

    // A phosphor mask needs >= 3x output scale to resolve into stripes.
    // Below that it aliases into moire and looks worse than no mask at all.
    this.signalMat.uniforms.uMask.value = this.scale >= 3 ? this.o.mask : 0;

    const el = this.renderer.domElement;
    el.style.imageRendering = 'pixelated';
    return { canvasWidth: cw, canvasHeight: ch, scale: this.scale };
  }

  _blit(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  render(scene, camera, time = 0) {
    const r = this.renderer;

    // 1. scene at virtual resolution
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);

    // 2. halation, in linear space, at half virtual resolution
    if (this.o.halation > 0) {
      const bw = this.blurA.width, bh = this.blurA.height;
      this.blurMat.uniforms.uTex.value = this.sceneRT.texture;
      this.blurMat.uniforms.uTexel.value.set(1 / bw, 1 / bh);
      this.blurMat.uniforms.uDir.value.set(1, 0);
      this.blurMat.uniforms.uThreshold.value = 0.75;
      this._blit(this.blurMat, this.blurA);

      this.blurMat.uniforms.uTex.value = this.blurA.texture;
      this.blurMat.uniforms.uDir.value.set(0, 1);
      this.blurMat.uniforms.uThreshold.value = -1;
      this._blit(this.blurMat, this.blurB);
    }

    // 3. tonemap + sRGB + dither + quantize, still at virtual resolution
    this.quantMat.uniforms.uScene.value = this.sceneRT.texture;
    this.quantMat.uniforms.uHalation.value = this.blurB.texture;
    this._blit(this.quantMat, this.quantRT);

    // 4+5. nearest upscale happens implicitly in the signal pass's sampling
    this.signalMat.uniforms.uTex.value = this.quantRT.texture;
    this.signalMat.uniforms.uTime.value = time;
    this._blit(this.signalMat, null);
  }

  /** Accessibility escape hatch — wire this to a visible control. */
  setSignalEnabled(on) {
    const u = this.signalMat.uniforms;
    u.uCurvature.value = on ? this.o.curvature : 0;
    u.uScanline.value  = on ? this.o.scanline : 0;
    u.uMask.value      = on && this.scale >= 3 ? this.o.mask : 0;
    u.uChroma.value    = on ? this.o.chroma : 0;
    u.uVignette.value  = on ? this.o.vignette : 0;
    u.uNoise.value     = on && !this.reducedMotion ? (this.o.noise ?? 0) : 0;
    u.uBrightness.value = on ? this.o.brightness : 1;
  }

  dispose() {
    [this.sceneRT, this.quantRT, this.blurA, this.blurB].forEach(t => t.dispose());
    [this.blurMat, this.quantMat, this.signalMat].forEach(m => m.dispose());
    this.quad.geometry.dispose();
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** Build an N x 1 palette LUT texture from hex strings, for RetroPipeline. */
export function paletteTexture(hexes) {
  const n = hexes.length;
  const data = new Uint8Array(n * 4);
  hexes.forEach((h, i) => {
    const c = new THREE.Color(h);
    data[i * 4 + 0] = Math.round(c.r * 255);
    data[i * 4 + 1] = Math.round(c.g * 255);
    data[i * 4 + 2] = Math.round(c.b * 255);
    data[i * 4 + 3] = 255;
  });
  const tex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return { texture: tex, size: n };
}

/**
 * Coarse depth bucketing to reproduce PS1 sort-order instability without
 * disabling the depth buffer (which produces garbage, not nostalgia).
 * Call once per frame on the objects you want to be unstable.
 */
export function unstableSort(objects, camera, buckets = 32, far = 100) {
  for (const o of objects) {
    const d = o.position.distanceTo(camera.position);
    o.renderOrder = -Math.floor((d / far) * buckets);
    o.material.depthWrite = false;
  }
}

export const RETRO_PRESETS = PRESETS;

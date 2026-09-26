/**
 * retro-tsl.js — WebGPURenderer / TSL path for threejs-retro-forge.
 *
 * ── VERIFIED against three@0.185.1 (r185) on a real WebGPU device ─────────
 * Renders end-to-end through WebGPURenderer with zero Dawn validation errors.
 * All four emitted shader modules compile through Tint with 0 errors/0 warnings. See
 * references/threejs-r18x.md § "What three.js already ships".
 * ──────────────────────────────────────────────────────────────────────────
 *
 * DESIGN RULE: r185 already ships a complete PS1 pass and most of the CRT
 * signal chain. Do not reimplement those — compose them. This module adds only
 * the three things r185 does NOT ship:
 *
 *   1. exact ordered dithering  — shipped `bayerDither` is a self-described
 *      "approximation" resolving to 9 of 16 threshold levels; this is the
 *      canonical matrix (GPU-verified against the reference 4x4).
 *   2. arbitrary-palette quantization — nothing shipped.
 *   3. aperture-grille / phosphor mask — nothing shipped.
 *
 * NodeMaterial and TSL require WebGPURenderer; they do not work on
 * WebGLRenderer at all (WebGLNodeBuilder was removed in r164). For the
 * WebGLRenderer path use retro-glsl.js.
 */

import * as THREE from 'three/webgpu';
import {
  Fn, vec3, vec4, float, uniform, mix, floor, fract, dot, clamp,
  screenCoordinate, screenUV, posterize, select
} from 'three/tsl';

// Shipped nodes — prefer these over hand-rolled equivalents.
import { retroPass } from 'three/addons/tsl/display/RetroPassNode.js';
import { barrelUV, barrelMask, colorBleeding, scanlines, vignette }
  from 'three/addons/tsl/display/CRT.js';

export { retroPass, barrelUV, barrelMask, colorBleeding, scanlines, vignette };

/* ------------------------------------------------------------------ *
 * Gap 1 — exact ordered dithering
 * ------------------------------------------------------------------ */

/**
 * Bayer 2x2 in closed form. Reproduces [[0,2],[3,1]]/4 exactly.
 * GPU readback matches the canonical matrix element-for-element.
 */
export const bayer2 = /*@__PURE__*/ Fn(([p]) => {
  const a = floor(p);
  return fract(a.x.mul(0.5).add(a.y.mul(a.y).mul(0.75)));
});

/** Bayer 4x4 — 16 evenly spaced thresholds in [0, 15/16]. */
export const bayer4 = /*@__PURE__*/ Fn(([p]) =>
  bayer2(p.mul(0.5)).mul(0.25).add(bayer2(p)));

/** Bayer 8x8 — 64 evenly spaced thresholds in [0, 63/64]. */
export const bayer8 = /*@__PURE__*/ Fn(([p]) =>
  bayer4(p.mul(0.5)).mul(0.25).add(bayer2(p)));

/**
 * Dither then quantize using the exact Bayer matrix.
 *
 * Prefer this over the shipped `bayerDither` (three/addons/tsl/math/Bayer.js)
 * unless you specifically want its look: that one computes
 * `mod(floor(x+1)*floor(y+1)*17, 16)/16`, a multiplication table that resolves
 * to 9 distinct thresholds and biases along the diagonal. Fine for breaking up
 * banding in ray marching, which is what it was written for; wrong if you want
 * period-accurate console dithering.
 *
 * Run at VIRTUAL resolution, in DISPLAY space (after tone map + sRGB encode) —
 * that is where the hardware framebuffer lived.
 *
 * @param color  vec3, already in display space
 * @param levels per-channel levels (32 = RGB555)
 * @param matrix 4 or 8
 */
export const ditherQuantize = /*@__PURE__*/ Fn(([color, levels, matrix]) => {
  const p = screenCoordinate.xy;
  const t = select(matrix.greaterThan(6.0), bayer8(p), bayer4(p)).sub(0.5);
  return posterize(clamp(color.add(t.div(levels)), 0.0, 1.0), levels);
});

/* ------------------------------------------------------------------ *
 * Gap 2 — arbitrary-palette quantization
 * ------------------------------------------------------------------ */

/**
 * Build a node function snapping colour to the nearest entry of a fixed
 * palette, luma-weighted.
 *
 * Raw RGB distance is perceptually poor — it will happily swap a dark blue for
 * a dark green because they sit close in RGB and far apart to a human eye. The
 * (0.30, 0.59, 0.11) weighting fixes most of that.
 *
 * The loop unrolls at graph-build time, so keep the palette small (<= 32).
 *
 * @param {THREE.Color[]} entries
 */
export function paletteQuantize(entries) {
  const consts = entries.map(c => vec3(c.r, c.g, c.b));
  return Fn(([color]) => {
    const best = vec3(consts[0]).toVar();
    const bestD = float(1e9).toVar();
    for (const c of consts) {
      const d = color.sub(c).mul(vec3(0.30, 0.59, 0.11));
      const dist = dot(d, d);
      const closer = dist.lessThan(bestD);
      best.assign(select(closer, c, best));
      bestD.assign(select(closer, dist, bestD));
    }
    return best;
  });
}

/* ------------------------------------------------------------------ *
 * Gap 3 — phosphor mask
 * ------------------------------------------------------------------ */

/**
 * Aperture grille (Trinitron-style vertical RGB stripes) in OUTPUT pixel space.
 *
 * Gate `strength` to 0 when output scale < 3x. A phosphor mask needs at least
 * three device pixels per stripe triad to resolve; below that it aliases into
 * moire and a screen-door look worse than no mask at all.
 */
export const apertureMask = /*@__PURE__*/ Fn(([color, strength]) => {
  const i = fract(screenCoordinate.x.div(3.0)).mul(3.0);
  const m = select(i.lessThan(1.0), vec3(1.0, 0.6, 0.6),
            select(i.lessThan(2.0), vec3(0.6, 1.0, 0.6), vec3(0.6, 0.6, 1.0)));
  return color.mul(mix(vec3(1.0), m, strength));
});

/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */

/**
 * Full retro pipeline on WebGPURenderer.
 *
 *   const { pipeline } = createRetroPipeline(renderer, scene, camera, { preset: 'psx' });
 *   await renderer.init();
 *   renderer.setAnimationLoop(() => pipeline.render());
 *
 * `retroPass` supplies vertex snapping + affine warp + a nearest-filtered
 * low-res target in a single node, so this only has to add quantization and the
 * signal chain.
 *
 * Call order reads the same as execution order — TSL chaining was removed in
 * r168 in favour of free functions.
 */
export function createRetroPipeline(renderer, scene, camera, o = {}) {
  const P = {
    resolutionScale: 0.25,   // retroPass default; ~320x240 off a 1280x960 canvas
    levels: 32,
    matrix: 4,
    curvature: 0.06,
    scanline: 0.35,
    scanCount: 240,          // virtual scanlines, i.e. the virtual height
    mask: 0.30,
    bleed: 0.002,
    vignette: 0.35,
    brightness: 1.55,
    ...o
  };

  const uLevels = uniform(P.levels);
  const uMatrix = uniform(P.matrix);
  const uCurve  = uniform(P.curvature);
  const uScan   = uniform(P.scanline);
  const uCount  = uniform(P.scanCount);
  const uMask   = uniform(P.mask);
  const uBleed  = uniform(P.bleed);
  const uVig    = uniform(P.vignette);
  const uBright = uniform(P.brightness);

  const scene3D = retroPass(scene, camera);
  scene3D.setResolutionScale(P.resolutionScale);

  const chain = Fn(() => {
    const warped = barrelUV(uCurve, screenUV).toVar();
    const col = colorBleeding(scene3D.getTextureNode(), uBleed).rgb.toVar();

    // Virtual device: quantize before the display chain.
    col.assign(ditherQuantize(col, uLevels, uMatrix));

    // Physical display.
    col.assign(scanlines(col, uScan, uCount, float(0.0), warped));
    col.assign(apertureMask(col, uMask));
    col.assign(vignette(col, uVig, float(0.5), warped));

    // Scanlines + mask can eat half the luminance; real CRTs were bright.
    // barrelMask blanks everything outside the tube.
    return vec4(clamp(col.mul(uBright), 0.0, 1.0).mul(barrelMask(warped)), 1.0);
  });

  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputNode = chain();

  const d = { ...P };
  return {
    pipeline,
    scenePass: scene3D,
    uniforms: { uLevels, uMatrix, uCurve, uScan, uCount, uMask, uBleed, uVig, uBright },
    /**
     * Accessibility escape hatch — wire to a visible control. Several
     * signal-chain effects are literally flashing lights.
     */
    setSignalEnabled(on) {
      uCurve.value  = on ? d.curvature : 0;
      uScan.value   = on ? d.scanline : 0;
      uMask.value   = on ? d.mask : 0;
      uBleed.value  = on ? d.bleed : 0;
      uVig.value    = on ? d.vignette : 0;
      uBright.value = on ? d.brightness : 1;
    },
    /** Call on resize — a mask below 3x output scale aliases into moire. */
    updateMaskGate(outputScale) {
      uMask.value = outputScale >= 3 ? d.mask : 0;
    }
  };
}

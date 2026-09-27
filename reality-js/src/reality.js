// Reality: compile a .real scene and render it into a canvas.
//
//   const r = new Reality(canvas);
//   await r.load(source);
//   r.start();                              // progressive preview
//   const png = await r.renderStill();      // final image as a Blob
//
// This class owns everything between the language and the GPU: loading
// files, building meshes, computing the sky, packing each frame (with the
// shutter open and close instants for motion blur) and auto exposure.

import { compile, importPaths } from './lang/compile.js';
import { RealityError } from './lang/errors.js';
import { Renderer } from './render/renderer.js';
import { packScene, packMeshes } from './render/pack.js';
import { buildGeometry } from './geometry/mesh.js';
import { computeSky } from './sky/atmosphere.js';
import { parseHDR } from './sky/hdr.js';
import { buildEnvDistribution } from './sky/envmap.js';
import { whiteBalanceGains, luminance } from './core/color.js';

const KEY_VALUE = 0.18; // mid grey

export class Reality {
  // options.baseUrl: where relative file paths in scenes are resolved.
  constructor(canvas, { baseUrl = globalThis.location?.href, width, height } = {}) {
    this.canvas = canvas;
    this.baseUrl = baseUrl;
    this.renderer = new Renderer(canvas, { width: width ?? canvas.width, height: height ?? canvas.height });
    this.watchContext();
    this.onStatus = null;      // (message | null) => void, for context loss and recovery
    this.scene = null;
    this.time = 0;
    this.caches = { geometry: new Map(), sky: new Map(), hdr: new Map(), images: new Map(), text: new Map() };
    this.meshKeys = '';
    this.exposure = null;      // current exposure multiplier
    this.meteredAt = new Set();
    this.running = false;
    this.targetSamples = Infinity;
    this.samplesPerFrame = 1;
    this.onProgress = null;    // (samples, target) => void
    this.exposureLocked = false;
    this.warnings = [];
  }

  // When the GPU takes the context away (driver reset, too much work), say
  // so, and rebuild everything once the browser gives it back.
  watchContext() {
    const r = this.renderer;
    r.onLost = () => {
      this.onStatus?.('The graphics driver reset and the renderer lost its GPU context. Waiting for the browser to restore it…');
    };
    r.onTraceFailed = (gpu, variant) => {
      this.onStatus?.(`The graphics driver refused to run the path-tracing shader (${gpu}; features: ${variant || 'none'}). Nothing can be drawn on this GPU until that is fixed; please report it.`);
    };
    r.onRestored = async () => {
      r.onLost = r.onRestored = r.onTraceFailed = null;
      const { width, height } = r;
      this.renderer = new Renderer(this.canvas, { width, height });
      this.watchContext();
      this.meshKeys = '';
      this.textureKey = undefined;
      this.envKey = null;
      this.contextRestores = (this.contextRestores ?? 0) + 1;
      try {
        if (this.source != null) await this.load(this.source);
        this.onStatus?.(null);
      } catch (err) {
        this.onStatus?.(`Could not recover after the GPU reset: ${err.message}`);
      }
    };
  }

  // ------------------------------------------------------------ files
  resolveUrl(path) {
    return this.baseUrl ? new URL(path, this.baseUrl).href : path;
  }
  async fetchText(path) {
    if (this.caches.text.has(path)) return this.caches.text.get(path);
    const res = await fetch(this.resolveUrl(path));
    if (!res.ok) throw new Error(`could not load "${path}" (${res.status})`);
    const text = await res.text();
    this.caches.text.set(path, text);
    return text;
  }
  async fetchBuffer(path) {
    const res = await fetch(this.resolveUrl(path));
    if (!res.ok) throw new Error(`could not load "${path}" (${res.status})`);
    return res.arrayBuffer();
  }
  async loadImage(path) {
    if (this.caches.images.has(path)) return this.caches.images.get(path);
    const res = await fetch(this.resolveUrl(path));
    if (!res.ok) throw new Error(`could not load "${path}" (${res.status})`);
    const img = await createImageBitmap(await res.blob());
    this.caches.images.set(path, img);
    return img;
  }

  // ------------------------------------------------------------ loading
  // Compile `source`, fetch what it needs, and show time `timeline.time`.
  // Throws RealityError (with .format(source)) on mistakes in the scene.
  async load(source) {
    this.source = source;
    const imports = {};
    for (const path of importPaths(source)) imports[path] = await this.fetchText(path);
    const scene = compile(source, { imports });
    this.warnings = scene.warnings.slice();

    // Meshes: build new ones, reuse cached ones.
    const requests = scene.geometryRequests();
    const meshes = new Map();
    for (const params of requests) {
      const key = JSON.stringify(params);
      if (!this.caches.geometry.has(key)) {
        try {
          this.caches.geometry.set(key, await buildGeometry(params, (p) => this.fetchText(p)));
        } catch (err) {
          throw new RealityError(`${params.kind}: ${err.message}`);
        }
      }
      meshes.set(key, this.caches.geometry.get(key));
    }
    this.meshes = meshes;
    const meshKeys = [...meshes.keys()].join('|');
    if (meshKeys !== this.meshKeys) {
      this.packedMeshes = packMeshes(meshes);
      this.renderer.setGeometry(this.packedMeshes);
      this.meshKeys = meshKeys;
    }

    // Image textures.
    const texPaths = scene.assetRequests();
    this.textureLayers = new Map(texPaths.map((p, i) => [p, i]));
    const texKey = texPaths.join('|');
    if (texKey !== this.textureKey) {
      const images = [];
      for (const p of texPaths) images.push(await this.loadImage(p));
      this.renderer.setTextures(images);
      this.textureKey = texKey;
    }

    // HDRI files.
    if (scene.environmentKind === 'hdri') {
      const src = scene.sample(0).environment.src;
      if (!this.caches.hdr.has(src)) {
        const img = downsampleEnv(parseHDR(await this.fetchBuffer(src)), 2048);
        this.caches.hdr.set(src, img);
      }
    }

    this.scene = scene;
    const tl = scene.timeline;
    this.fps = tl.fps;
    this.duration = tl.duration;
    this.envKey = null;
    this.exposure = null;
    this.meteredAt.clear();
    this.setTime(tl.time);
    return { scene, warnings: this.warnings };
  }

  // ------------------------------------------------------------ frames
  // Prepare the renderer to show the scene at `time` (seconds).
  setTime(time) {
    if (!this.scene) return;
    this.time = time;
    const scene = this.scene;
    const aspect = this.renderer.width / this.renderer.height;
    const mid = scene.sample(time);
    const cam = mid.cameraFrame(aspect);
    const shutter = Math.max(0, cam.shutter);
    const rolling = cam.rolling;
    const span = shutter + rolling;
    const open = span > 0 ? scene.sample(time - shutter / 2) : mid;
    const close = span > 0 ? scene.sample(time + shutter / 2 + rolling) : mid;

    const packed = packScene(open, close, { meshRoots: this.packedMeshes?.roots, meshes: this.meshes, textureLayers: this.textureLayers });
    for (const w of packed.warnings) if (!this.warnings.some((x) => x.message === w)) this.warnings.push({ message: w });

    this.updateEnvironment(mid.environment);

    this.film = mid.film;
    this.camera = cam;
    this.manualExposure = cam.exposure;
    if (cam.exposure != null) this.exposure = cam.exposure;
    else if (this.exposure == null) this.exposure = this.guessExposure(mid.environment) * Math.pow(2, cam.compensation);
    this.whiteBalance = whiteBalanceGains(mid.film.white_balance);

    const render = scene.renderSettings;
    this.renderer.setFrame(packed, {
      cameras: [open.cameraFrame(aspect), close.cameraFrame(aspect)],
      shutterSpan: span > 0 ? shutter / span : 0,
      rollingSpan: span > 0 ? rolling / span : 0,
      time,
      fog: mid.fog,
      bounces: Math.max(1, Math.min(64, Math.round(render.bounces))),
      clamp: mid.film.clamp > 0 ? mid.film.clamp / this.exposure : 0,
    });
    this.meteredAt.clear();
  }

  updateEnvironment(env) {
    let key, make;
    if (env.type === 'sky') {
      key = JSON.stringify(['sky', env.sunDir, env.haze, env.intensity, env.sun_size, env.ground]);
      make = () => {
        if (!this.caches.sky.has(key)) {
          const sky = computeSky({ sunDir: env.sunDir, haze: env.haze, sunSize: env.sun_size, intensity: env.intensity, ground: env.ground });
          const sunUp = env.sunDir[1] > -0.02;
          this.caches.sky.set(key, {
            width: sky.width, height: sky.height, data: sky.data, dist: buildEnvDistribution(sky),
            rotation: 0, visible: true,
            sun: sunUp ? { dir: sky.sunDir, radiance: sky.sunRadiance, cosMax: sky.sunCosMax, oneMinusCos: sky.sunOneMinusCos } : null,
            guess: luminance(sky.groundRadiance),
          });
          if (this.caches.sky.size > 64) this.caches.sky.delete(this.caches.sky.keys().next().value);
        }
        return this.caches.sky.get(key);
      };
    } else if (env.type === 'hdri') {
      key = JSON.stringify(['hdri', env.src, env.intensity]);
      make = () => {
        const base = this.caches.hdr.get(env.src);
        const data = new Float32Array(base.data.length);
        for (let i = 0; i < data.length; i++) data[i] = base.data[i] * env.intensity;
        const img = { width: base.width, height: base.height, data };
        return { ...img, dist: buildEnvDistribution(img), sun: null, guess: averageLuminance(img) };
      };
    } else {
      key = JSON.stringify(['bg', env.radiance]);
      make = () => {
        const W = 64, H = 32, data = new Float32Array(W * H * 4);
        for (let i = 0; i < W * H; i++) data.set([...env.radiance, 1], i * 4);
        const img = { width: W, height: H, data };
        return { ...img, dist: buildEnvDistribution(img), sun: null, guess: luminance(env.radiance) * 0.5 };
      };
    }
    const extra = env.type === 'hdri' ? { rotation: (env.rotate * Math.PI) / 180, visible: env.visible } : { rotation: 0, visible: true };
    const fullKey = key + JSON.stringify(extra);
    if (fullKey !== this.envKey) {
      const e = { ...make(), ...extra };
      this.envGuess = e.guess;
      this.renderer.setEnvironment(e);
      this.envKey = fullKey;
    }
  }

  guessExposure() {
    return KEY_VALUE / Math.max(1e-6, this.envGuess ?? 1000);
  }

  // ------------------------------------------------------------ rendering
  // Add samples and redraw the canvas.
  step(passes = this.samplesPerFrame) {
    if (!this.scene) return;
    this.renderer.trace(passes);
    this.display();
    const n = this.renderer.samples;
    // Auto exposure: meter a few times while the image converges.
    // `exposureLocked` keeps the current value (for live animation, where
    // re-metering every frame would flicker).
    if (this.manualExposure == null && !this.exposureLocked) {
      for (const at of [1, 4, 16, 64]) {
        if (n >= at && !this.meteredAt.has(at)) {
          this.meteredAt.add(at);
          this.autoExpose();
          this.display();
        }
      }
    }
  }

  autoExpose(blend = 1) {
    const avg = this.renderer.meter(this.exposure);
    this.meterLog = [...(this.meterLog ?? []).slice(-7), Number.isFinite(avg) ? +avg.toPrecision(4) : String(avg)];
    if (!(avg > 0) || !Number.isFinite(avg)) return;
    const target = (KEY_VALUE / avg) * Math.pow(2, this.camera.compensation);
    const next = this.exposure * Math.pow(target / this.exposure, blend);
    // Scene luminance spans roughly 1e-4 nits (starlight) to 1e9 (the sun):
    // anything outside that range is a bad reading, not a real scene.
    if (Number.isFinite(next) && next > 1e-12 && next < 1e6) this.exposure = next;
  }

  // A snapshot of what the renderer is doing, for diagnosing problems on
  // hardware we cannot test. Everything is plain JSON.
  diagnostics() {
    const r = this.renderer;
    const report = {
      time: new Date().toISOString(),
      userAgent: globalThis.navigator?.userAgent ?? '',
      gpu: r.info(),
      size: [r.width, r.height],
      samples: r.samples,
      samplesPerFrame: this.samplesPerFrame,
      exposure: Number.isFinite(this.exposure) ? +this.exposure.toPrecision(4) : String(this.exposure),
      manualExposure: this.manualExposure != null,
      meterLog: this.meterLog ?? [],
      contextRestores: this.contextRestores ?? 0,
      scene: this.scene ? { objects: this.scene.objects.length, environment: this.scene.environmentKind } : null,
      film: this.film ? { tonemap: this.film.tonemap, denoise: this.film.denoise, bloom: this.film.bloom } : null,
    };
    if (!r.lost && r.samples > 0) {
      try {
        report.accumGrid = r.probeGrid('accum');
        report.hdrGrid = r.probeGrid('hdr');
        report.canvasGrid = canvasGrid(r);
      } catch (err) {
        report.probeError = String(err.message ?? err);
      }
      r.checkError('diagnostics');
      report.gpu.errors = r.errors.slice();
    }
    return report;
  }

  display() {
    this.renderer.display({
      film: this.film,
      exposure: this.exposure,
      tanHalfW: this.camera.tanHalfW,
      tanHalfH: this.camera.tanHalfH,
      whiteBalance: this.whiteBalance,
    });
  }

  get samples() { return this.renderer.samples; }

  resize(width, height) {
    this.renderer.setSize(width, height);
    if (this.scene) this.setTime(this.time);
  }

  // Progressive preview in the page's animation loop.
  start({ samples = this.scene?.renderSettings.samples ?? 512, samplesPerFrame = 1 } = {}) {
    this.targetSamples = samples;
    this.samplesPerFrame = samplesPerFrame;
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      if (this.scene && this.renderer.samples < this.targetSamples) {
        const t0 = performance.now();
        this.step(this.samplesPerFrame);
        // GL calls return before the GPU finishes, so wait for it before
        // timing. Keep the page responsive: aim for 10-25 ms per frame.
        this.renderer.sync();
        const dt = performance.now() - t0;
        if (dt < 10 && this.samplesPerFrame < 16) this.samplesPerFrame++;
        else if (dt > 25 && this.samplesPerFrame > 1) this.samplesPerFrame = Math.max(1, this.samplesPerFrame >> 1);
        this.onProgress?.(this.renderer.samples, this.targetSamples);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
  }

  // Render the current time to `samples` and return a PNG Blob.
  // Yields to the browser between batches so the page stays alive.
  async renderStill({ samples = this.scene.renderSettings.samples, onProgress } = {}) {
    const wasRunning = this.running;
    this.stop();
    this.setTime(this.time);
    while (this.renderer.samples < samples) {
      this.step(Math.min(4, samples - this.renderer.samples));
      this.renderer.sync();
      onProgress?.(this.renderer.samples, samples);
      await nextFrame();
    }
    this.display();
    const blob = await canvasBlob(this.canvas);
    if (wasRunning) this.start({ samples: this.targetSamples });
    return blob;
  }

  // Render frame `index` of the timeline with `samples` per pixel and leave
  // it on the canvas. Auto exposure adapts smoothly from frame to frame.
  async renderFrame(index, { samples, fps = this.fps, onProgress } = {}) {
    const keepExposure = this.exposure;
    this.setTime(index / fps);
    if (this.manualExposure == null && keepExposure != null && index > 0) this.exposure = keepExposure;
    while (this.renderer.samples < samples) {
      this.renderer.trace(Math.min(4, samples - this.renderer.samples));
      this.renderer.sync();
      onProgress?.(this.renderer.samples, samples);
      await nextFrame();
    }
    this.display();
    if (this.manualExposure == null) {
      this.autoExpose(index === 0 ? 1 : 0.15);
      if (index === 0) { this.display(); this.autoExpose(1); }
      this.display();
    }
  }
}

// The displayed 8-bit image at a few points (needs preserveDrawingBuffer).
function canvasGrid(r, cols = 4, rows = 3) {
  const px = r.readPixels();
  const out = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = Math.floor(((i + 0.5) / cols) * r.width), y = Math.floor(((j + 0.5) / rows) * r.height);
      const o = (y * r.width + x) * 4;
      out.push([px[o], px[o + 1], px[o + 2]]);
    }
  }
  return out;
}

function nextFrame() {
  return new Promise((r) => (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(() => r()) : setTimeout(r, 0)));
}

export function canvasBlob(canvas, type = 'image/png', quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function averageLuminance({ data }) {
  let s = 0;
  for (let i = 0; i < data.length; i += 4) s += Math.log(Math.max(1e-6, 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]));
  return Math.exp(s / (data.length / 4));
}

// Halve an equirectangular image until it is at most maxWidth wide.
export function downsampleEnv(img, maxWidth) {
  let { width, height, data } = img;
  while (width > maxWidth && width % 2 === 0 && height % 2 === 0) {
    const w = width / 2, h = height / 2;
    const out = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 4; c++) {
          const a = data[((2 * y) * width + 2 * x) * 4 + c], b = data[((2 * y) * width + 2 * x + 1) * 4 + c];
          const d = data[((2 * y + 1) * width + 2 * x) * 4 + c], e = data[((2 * y + 1) * width + 2 * x + 1) * 4 + c];
          out[(y * w + x) * 4 + c] = (a + b + d + e) / 4;
        }
      }
    }
    width = w; height = h; data = out;
  }
  return { width, height, data };
}

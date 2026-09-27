// WebGL2 plumbing: textures, framebuffers and the passes of one frame.
//
//   trace (N passes)  ->  accumulation buffers (colour, normal+depth, albedo)
//   denoise           ->  à-trous iterations on demodulated illumination
//   resolve           ->  exposed HDR image
//   bloom             ->  down/up-sample pyramid
//   film              ->  canvas
//
// The Renderer knows nothing about the scene language; see src/reality.js
// for the part that turns a Scene into the data uploaded here.

import { TRACE_FRAGMENT } from './trace.glsl.js';
import { FULLSCREEN_VERTEX, DENOISE_PREP, DENOISE_ATROUS, RESOLVE, BLOOM_DOWN, BLOOM_UP, FILM } from './post.glsl.js';
import { DATA_WIDTH } from './pack.js';

const TONEMAPS = { agx: 0, aces: 1, reinhard: 2, none: 3 };
const BLOOM_LEVELS = 6;

export class Renderer {
  constructor(canvas, { width = canvas.width, height = canvas.height } = {}) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('reality.js needs WebGL2, which this browser does not provide');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('reality.js needs float render targets (EXT_color_buffer_float)');
    this.floatLinear = !!gl.getExtension('OES_texture_float_linear');
    this.gl = gl;
    this.canvas = canvas;
    this.vao = gl.createVertexArray();

    this.programs = {
      trace: this.program(TRACE_FRAGMENT, 'trace'),
      prep: this.program(DENOISE_PREP, 'denoise prep'),
      atrous: this.program(DENOISE_ATROUS, 'denoise'),
      resolve: this.program(RESOLVE, 'resolve'),
      down: this.program(BLOOM_DOWN, 'bloom down'),
      up: this.program(BLOOM_UP, 'bloom up'),
      film: this.program(FILM, 'film'),
    };

    // Placeholders so every sampler is always bound to something valid.
    const one = new Float32Array(4);
    this.data = {
      objects: this.dataTexture(one), materials: this.dataTexture(one), lights: this.dataTexture(one),
      bvh: this.dataTexture(new Float32Array(8)), tris: this.dataTexture(new Float32Array(24)),
    };
    this.env = null;
    this.textureArray = this.emptyTextureArray();
    this.frameUniforms = null;
    this.objectCount = 0;
    this.lightCount = 0;
    this.frameIndex = 0;
    this.samples = 0;
    this.setSize(width, height);
  }

  // ------------------------------------------------------------ resources
  program(fragment, name) {
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        throw new Error(`${name} shader failed to compile:\n${log}`);
      }
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, FULLSCREEN_VERTEX));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${name} program failed to link:\n${gl.getProgramInfoLog(p)}`);
    return { handle: p, locations: new Map(), units: new Map() };
  }

  texture(width, height, internal, format, type, data = null, filter = this.gl.NEAREST) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    t.width = width;
    t.height = height;
    return t;
  }

  // RGBA32F texture DATA_WIDTH texels wide holding `floats`.
  dataTexture(floats, old = null) {
    const gl = this.gl;
    if (old) gl.deleteTexture(old);
    const texels = Math.max(1, Math.ceil(floats.length / 4));
    const w = Math.min(DATA_WIDTH, texels), h = Math.ceil(texels / DATA_WIDTH);
    const padded = new Float32Array(w * h * 4);
    padded.set(floats);
    return this.texture(w, h, gl.RGBA32F, gl.RGBA, gl.FLOAT, padded);
  }

  emptyTextureArray() {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.SRGB8_ALPHA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  framebuffer(textures) {
    const gl = this.gl;
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    textures.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    gl.drawBuffers(textures.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`framebuffer incomplete (0x${status.toString(16)})`);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, textures, width: textures[0].width, height: textures[0].height };
  }

  setSize(width, height) {
    const gl = this.gl;
    width = Math.max(1, Math.round(width));
    height = Math.max(1, Math.round(height));
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    for (const t of this.targets ?? []) gl.deleteTexture(t);
    for (const f of this.framebuffers ?? []) gl.deleteFramebuffer(f.fb);
    const f32 = () => this.texture(width, height, gl.RGBA32F, gl.RGBA, gl.FLOAT);
    this.accum = [this.framebuffer([f32(), f32(), f32()]), this.framebuffer([f32(), f32(), f32()])];
    this.denoise = [this.framebuffer([f32()]), this.framebuffer([f32()])];
    this.hdr = this.framebuffer([this.texture(width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, null, gl.LINEAR)]);
    this.bloom = [];
    let w = width, h = height;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      w = Math.max(1, w >> 1);
      h = Math.max(1, h >> 1);
      this.bloom.push(this.framebuffer([this.texture(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, null, gl.LINEAR)]));
    }
    this.framebuffers = [...this.accum, ...this.denoise, this.hdr, ...this.bloom];
    this.targets = [
      ...this.accum.flatMap((a) => a.textures), ...this.denoise.flatMap((a) => a.textures),
      ...this.hdr.textures, ...this.bloom.flatMap((b) => b.textures),
    ];
    this.current = 0;
    this.reset();
  }

  // ------------------------------------------------------------ scene data
  setGeometry({ bvh, tris }) {
    this.data.bvh = this.dataTexture(bvh, this.data.bvh);
    this.data.tris = this.dataTexture(tris, this.data.tris);
    this.reset();
  }

  // env: { width, height, data (RGBA float), dist (from buildEnvDistribution),
  //        rotation (radians), visible, sun: { dir, radiance, cosMax } | null }
  setEnvironment(env) {
    const gl = this.gl;
    if (this.env) for (const t of this.env.textures) gl.deleteTexture(t);
    const { width: W, height: H, dist } = env;
    const radiance = this.texture(W, H, gl.RGBA32F, gl.RGBA, gl.FLOAT, env.data, this.floatLinear ? gl.LINEAR : gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, radiance);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    const pdf = this.texture(W, H, gl.R32F, gl.RED, gl.FLOAT, dist.pdf);
    const cond = this.texture(W, H, gl.R32F, gl.RED, gl.FLOAT, dist.cond);
    const marg = this.texture(H, 1, gl.R32F, gl.RED, gl.FLOAT, dist.marg);
    this.env = { ...env, radiance, pdf, cond, marg, textures: [radiance, pdf, cond, marg] };
    this.reset();
  }

  // Images for material textures, all resized to one square size.
  setTextures(images, size = 1024) {
    const gl = this.gl;
    gl.deleteTexture(this.textureArray);
    if (!images.length) { this.textureArray = this.emptyTextureArray(); return; }
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
    const ctx = canvas.getContext('2d');
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.floor(Math.log2(size)) + 1, gl.SRGB8_ALPHA8, size, size, images.length);
    images.forEach((img, i) => {
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      const pixels = ctx.getImageData(0, 0, size, size).data;
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    });
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    this.textureArray = t;
    this.reset();
  }

  // packed: from packScene(). frame: camera, shutter, fog and bounce settings.
  setFrame(packed, frame) {
    this.data.objects = this.dataTexture(packed.objects, this.data.objects);
    this.data.materials = this.dataTexture(packed.materials, this.data.materials);
    this.data.lights = this.dataTexture(packed.lights, this.data.lights);
    this.objectCount = packed.objectCount;
    this.lightCount = packed.lightCount;
    this.frameUniforms = frame;
    this.reset();
  }

  reset() {
    this.samples = 0;
  }

  // ------------------------------------------------------------ drawing
  use(prog, uniforms) {
    const gl = this.gl;
    gl.useProgram(prog.handle);
    let unit = 0;
    for (const [name, value] of Object.entries(uniforms)) {
      let loc = prog.locations.get(name);
      if (loc === undefined) {
        loc = gl.getUniformLocation(prog.handle, name);
        prog.locations.set(name, loc);
      }
      if (loc === null) continue;
      if (value instanceof WebGLTexture) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(value.isArray ? gl.TEXTURE_2D_ARRAY : gl.TEXTURE_2D, value);
        gl.uniform1i(loc, unit++);
      } else if (value && value.array) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, value.array);
        gl.uniform1i(loc, unit++);
      } else if (typeof value === 'boolean') {
        gl.uniform1i(loc, value ? 1 : 0);
      } else if (typeof value === 'number') {
        gl.uniform1f(loc, value);
      } else if (value && value.int !== undefined) {
        gl.uniform1i(loc, value.int);
      } else if (value && value.ivec2) {
        gl.uniform2i(loc, value.ivec2[0], value.ivec2[1]);
      } else if (Array.isArray(value) || value instanceof Float32Array) {
        const flat = Array.isArray(value[0]) ? value.flat() : value;
        const fn = { 2: 'uniform2fv', 3: 'uniform3fv', 4: 'uniform4fv' }[Array.isArray(value[0]) ? value[0].length : flat.length] ?? 'uniform3fv';
        gl[fn](loc, flat);
      }
    }
  }

  draw(target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.width : this.width, target ? target.height : this.height);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // Add `passes` samples per pixel.
  trace(passes = 1) {
    if (!this.frameUniforms || !this.env) return;
    const f = this.frameUniforms;
    const env = this.env;
    for (let i = 0; i < passes; i++) {
      const src = this.accum[this.current], dst = this.accum[1 - this.current];
      this.use(this.programs.trace, {
        uPrevColor: src.textures[0], uPrevAux: src.textures[1], uPrevAlbedo: src.textures[2],
        uObjects: this.data.objects, uMaterials: this.data.materials, uLights: this.data.lights,
        uBvh: this.data.bvh, uTris: this.data.tris,
        uEnv: env.radiance, uEnvPdf: env.pdf, uEnvCond: env.cond, uEnvMarg: env.marg,
        uTextures: { array: this.textureArray },
        uObjectCount: { int: this.objectCount }, uLightCount: { int: this.lightCount },
        uFrame: { int: this.frameIndex++ }, uMaxBounces: { int: f.bounces },
        uAccumulate: { int: this.samples > 0 ? 1 : 0 },
        uResolution: [this.width, this.height],
        uEnvSize: { ivec2: [env.width, env.height] },
        uEnvRotation: env.rotation ?? 0, uEnvVisible: env.visible ?? true,
        uSunOn: !!env.sun,
        uSunDir: env.sun ? env.sun.dir : [0, 1, 0], uSunRadiance: env.sun ? env.sun.radiance : [0, 0, 0],
        uSunCosMax: env.sun ? env.sun.cosMax : 1,
        uSunOneMinusCos: env.sun ? env.sun.oneMinusCos : 0,
        uCamPos: [f.cameras[0].position, f.cameras[1].position],
        uCamRight: [f.cameras[0].right, f.cameras[1].right],
        uCamUp: [f.cameras[0].up, f.cameras[1].up],
        uCamFwd: [f.cameras[0].forward, f.cameras[1].forward],
        uTanHalfW: f.cameras[0].tanHalfW, uTanHalfH: f.cameras[0].tanHalfH,
        uLensRadius: f.cameras[0].lensRadius, uFocus: f.cameras[0].focus,
        uBlades: f.cameras[0].blades, uBladeRot: f.cameras[0].bladeRotation, uDistortion: f.cameras[0].distortion,
        uShutterSpan: f.shutterSpan, uRollingSpan: f.rollingSpan, uTime: f.time,
        uFog: f.fog ? [f.fog.density, f.fog.anisotropy, f.fog.height, 1] : [0, 0, 0, 0],
        uFogAlbedo: f.fog ? f.fog.color : [1, 1, 1],
        uClamp: f.clamp,
      });
      this.draw(dst);
      this.current = 1 - this.current;
      this.samples++;
    }
  }

  // Post-process and draw to the canvas.
  // film: resolved film settings; exposure: multiplier; tan: camera field of view.
  display({ film, exposure, tanHalfW, tanHalfH, whiteBalance }) {
    const gl = this.gl;
    const acc = this.accum[this.current];
    let illum = null;
    if (film.denoise && this.samples > 0) {
      this.use(this.programs.prep, { uColor: acc.textures[0], uAlbedo: acc.textures[2] });
      this.draw(this.denoise[0]);
      let src = 0;
      for (let i = 0; i < 5; i++) {
        this.use(this.programs.atrous, {
          uIllum: this.denoise[src].textures[0], uAux: acc.textures[1], uColor: acc.textures[0],
          uStep: { int: 1 << i }, uResolution: [this.width, this.height],
        });
        this.draw(this.denoise[1 - src]);
        src = 1 - src;
      }
      illum = this.denoise[src].textures[0];
    }
    this.use(this.programs.resolve, {
      uColor: acc.textures[0], uAlbedo: acc.textures[2], uIllum: illum ?? acc.textures[0],
      uDenoised: !!illum, uExposure: exposure,
    });
    this.draw(this.hdr);

    // Bloom pyramid.
    let prev = this.hdr;
    for (const level of this.bloom) {
      this.use(this.programs.down, { uSrc: prev.textures[0], uSrcTexel: [1 / prev.width, 1 / prev.height] });
      this.draw(level);
      prev = level;
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = this.bloom.length - 1; i > 0; i--) {
      const s = this.bloom[i], d = this.bloom[i - 1];
      this.use(this.programs.up, { uSrc: s.textures[0], uSrcTexel: [1 / s.width, 1 / s.height], uDstSize: [d.width, d.height] });
      this.draw(d);
    }
    gl.disable(gl.BLEND);

    this.use(this.programs.film, {
      uHdr: this.hdr.textures[0], uBloom: this.bloom[0].textures[0],
      uResolution: [this.width, this.height],
      uBloomAmount: film.bloom, uBloomLevels: this.bloom.length, uHalation: film.halation, uVignette: film.vignette,
      uAberration: film.chromatic_aberration, uGrain: film.grain, uGrainSize: film.grain_size,
      uContrast: film.contrast, uSaturation: film.saturation,
      uTanHalfW: tanHalfW, uTanHalfH: tanHalfH,
      uWhiteBalance: whiteBalance,
      uTonemap: { int: TONEMAPS[film.tonemap] ?? 0 }, uFrame: { int: this.frameIndex },
    });
    this.draw(null);
  }

  // Log-average luminance of the last exposed image, divided by `exposure`
  // to give scene luminance in nits. Read from the smallest bloom level,
  // which holds a plain downsample (upsampling never writes into it).
  meter(exposure) {
    const gl = this.gl;
    const level = this.bloom[this.bloom.length - 1];
    gl.bindFramebuffer(gl.FRAMEBUFFER, level.fb);
    const px = new Float32Array(level.width * level.height * 4);
    gl.readPixels(0, 0, level.width, level.height, gl.RGBA, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let sum = 0, wsum = 0;
    for (let y = 0; y < level.height; y++) {
      for (let x = 0; x < level.width; x++) {
        const o = (y * level.width + x) * 4;
        const l = 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
        // Centre-weighted, like a camera's default metering.
        const dx = (x + 0.5) / level.width - 0.5, dy = (y + 0.5) / level.height - 0.5;
        const w = Math.exp(-(dx * dx + dy * dy) * 4);
        sum += Math.log(Math.max(1e-6, l)) * w;
        wsum += w;
      }
    }
    return Math.exp(sum / wsum) / exposure;
  }

  // Wait until queued GPU work is done (reads back one texel). Used for
  // honest progress and timing, and to keep long renders from queueing
  // thousands of passes at once.
  sync() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.accum[this.current].fb);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, new Float32Array(4));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // Current canvas contents as 8-bit RGBA, top row first.
  readPixels() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const px = new Uint8Array(this.width * this.height * 4);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const row = this.width * 4, out = new Uint8Array(px.length);
    for (let y = 0; y < this.height; y++) out.set(px.subarray((this.height - 1 - y) * row, (this.height - y) * row), y * row);
    return out;
  }
}

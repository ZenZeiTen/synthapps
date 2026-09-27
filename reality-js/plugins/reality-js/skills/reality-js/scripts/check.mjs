#!/usr/bin/env node
// Check a reality.js scene without a GPU: compile it, report errors the way
// the playground does, flag choices that make renders slow, noisy or wrongly
// exposed, and estimate how long a still and a video will take.
//
//   node check.mjs scene.real [--root PATH] [--json] [--size WxH] [--samples N]
//
// --size and --samples estimate a render with those overrides, the same flags
// tools/render.mjs takes (for video, --samples is samples per frame).
// --cpu-speed M replaces the idle-CPU figure with a measured speed in millions
// of paths per second (width x height x samples / seconds of a draft render).
//
// --root is the reality-js folder (the one holding src/lang/compile.js). If it
// is not given, the script looks upward from the scene file and from the
// current directory, including a reality-js/ subfolder at each level.
// Exit code: 0 clean or warnings only, 1 errors, 2 usage or setup problem.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Measured throughput in light paths per second (DESIGN.md, "Limitations").
// A path is one sample of one pixel. Fog, glass and many bounces are slower.
const GPU_PATHS = { fast: 130e6, slow: 60e6 };   // RTX 4050 laptop, Chrome, D3D11
const IDLE_CPU_PATHS = 0.3e6;                     // SwiftShader on an idle 4-core machine (render.mjs without --gpu)
const DIRECT_LIGHT_SHAPES = new Set(['sphere', 'quad', 'disk']);
const MESH_KINDS = new Set(['torus', 'mesh', 'terrain', 'rock']);

function usage(code) {
  console.log('usage: node check.mjs SCENE.real [--root REALITY_JS_DIR] [--json] [--size WxH] [--samples N] [--cpu-speed M]');
  process.exit(code);
}

const args = process.argv.slice(2);
let file = null, root = null, json = false, size = null, samplesOverride = null, cpuSpeed = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--root') root = args[++i];
  else if (args[i] === '--size') size = args[++i].split('x').map(Number);
  else if (args[i] === '--samples') samplesOverride = Number(args[++i]);
  else if (args[i] === '--cpu-speed') cpuSpeed = Number(args[++i]) * 1e6;
  else if (args[i] === '--json') json = true;
  else if (args[i] === '-h' || args[i] === '--help') usage(0);
  else if (!file) file = args[i];
  else usage(2);
}
if (!file) usage(2);

const scenePath = resolve(file);
if (!existsSync(scenePath)) {
  console.error(`check: no such file ${scenePath}`);
  process.exit(2);
}

function isRealityRoot(dir) {
  if (!existsSync(join(dir, 'src', 'lang', 'compile.js'))) return false;
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name === 'reality.js';
  } catch {
    return false;
  }
}

function findRoot() {
  if (root) return isRealityRoot(resolve(root)) ? resolve(root) : null;
  for (const start of [dirname(scenePath), process.cwd()]) {
    let dir = start;
    for (;;) {
      if (isRealityRoot(dir)) return dir;
      if (isRealityRoot(join(dir, 'reality-js'))) return join(dir, 'reality-js');
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  return null;
}

const CPU_PATHS = cpuSpeed || IDLE_CPU_PATHS;
const rjRoot = findRoot();
if (!rjRoot) {
  console.error('check: cannot find the reality-js folder (src/lang/compile.js). Pass --root PATH.');
  process.exit(2);
}

const load = (p) => import(pathToFileURL(join(rjRoot, p)).href);
const { compile, importPaths } = await load('src/lang/compile.js');
const { RealityError } = await load('src/lang/errors.js');
const { sampleProps } = await load('src/scene/scene.js');

const source = readFileSync(scenePath, 'utf8');
const sceneDir = dirname(scenePath);
const errors = [];
const warnings = [];
const notes = [];
const report = { file: scenePath, root: rjRoot, errors, warnings, notes };

function finish() {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const say = (label, list) => list.forEach((m) => console.log(`${label} ${m}`));
    say('error:', errors);
    say('warning:', warnings);
    if (report.summary) {
      const s = report.summary;
      console.log(`scene: ${s.objects} objects, ${s.lights.direct} directly sampled light(s), environment ${s.environment}` +
        `${s.fog ? ', fog' : ''}${s.duration > 0 ? `, ${s.duration} s timeline at ${s.fps} fps` : ', still'}${s.animated ? ', moves with t' : ''}`);
      console.log(`shader features: ${s.features.length ? s.features.join(', ') : 'none (fastest variant)'}`);
      console.log(`render settings${size || samplesOverride ? ' (with overrides)' : ''}: ${s.resolution.join('x')}, ${s.samples} spp still, ${s.videoSamples} spp video, ${s.bounces} bounces`);
      const e = report.estimate;
      const cpuLabel = cpuSpeed ? `CPU at ${(cpuSpeed / 1e6).toFixed(2)} M/s` : 'CPU (idle SwiftShader)';
      console.log(`estimate, still: ${fmtPaths(e.stillPaths)} paths -> GPU ${fmtTime(e.stillGpu)}, ${cpuLabel} ${fmtTime(e.stillCpu)}`);
      if (e.videoPaths) {
        console.log(`estimate, video: ${e.frames} frames, ${fmtPaths(e.videoPaths)} paths -> GPU ${fmtTime(e.videoGpu)}, CPU ${fmtTime(e.videoCpu)}`);
      }
    }
    say('note:', notes);
    if (!errors.length) console.log(warnings.length ? `ok with ${warnings.length} warning(s)` : 'ok');
  }
  process.exit(errors.length ? 1 : 0);
}

const fmtPaths = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} G` : `${(n / 1e6).toFixed(1)} M`);
function fmtTime(s) {
  if (s < 1) return '<1 s';
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}
const where = (loc) => (loc ? `line ${loc.line}: ` : '');

// Compile, fetching imports from disk relative to the scene.
let scene;
try {
  const imports = {};
  for (const p of importPaths(source)) {
    const full = resolve(sceneDir, p);
    if (!existsSync(full)) throw new RealityError(`import "${p}": file not found (${full})`);
    imports[p] = readFileSync(full, 'utf8');
  }
  scene = compile(source, { imports });
  scene.sample(scene.timeline.time); // property checks happen when sampling
} catch (err) {
  errors.push(err instanceof RealityError ? err.format(source) : String(err.stack || err));
  finish();
}

for (const w of scene.warnings) warnings.push(where(w.loc) + w.message);

const tl = scene.timeline;
const rs = scene.renderSettings;
const cam = sampleProps(scene.settings.camera, 'camera', tl.time, scene);
const film = sampleProps(scene.settings.film, 'film', tl.time, scene);
const snap = scene.sample(tl.time);
const fog = snap.fog;

// Files the scene refers to must exist next to it (URLs are left alone).
const fileRefs = [];
const envNode = scene.settings[scene.environmentKind];
if (scene.environmentKind === 'hdri') fileRefs.push(['hdri src', sampleProps(envNode, 'hdri', 0, scene).src, envNode?.loc]);
for (const { node } of scene.objects) {
  if (node.kind === 'mesh') fileRefs.push(['mesh src', sampleProps(node, 'mesh', 0, scene).src, node.loc]);
}
for (const tex of scene.assetRequests()) fileRefs.push(['texture', tex, null]);
for (const [what, path, loc] of fileRefs) {
  if (!path) errors.push(`${where(loc)}${what} is not set`);
  else if (!/^[a-z]+:\/\//i.test(path) && !existsSync(resolve(sceneDir, path))) {
    errors.push(`${where(loc)}${what} "${path}" not found relative to the scene file`);
  }
}

// Lights: which are sampled directly (fast) and which are only hit by chance.
let direct = 0;
const indirect = [];
for (const o of snap.objects) {
  const m = o.material;
  const emits = m.isLight ? true : m.emission.some((c) => c > 0);
  if (!emits) continue;
  if (DIRECT_LIGHT_SHAPES.has(o.shape) && o.kind !== 'plane' && o.kind !== 'ground') direct++;
  else indirect.push(o.kind);
}
if (indirect.length) {
  warnings.push(`${indirect.length} glowing object(s) (${[...new Set(indirect)].join(', ')}) are not sampled directly, so the light they cast converges slowly. ` +
    'For a lamp, use bulb, softbox, or a light material on a sphere, quad or disk.');
}
for (const o of snap.objects) {
  if (o.material.isLight && o.material.power != null && (o.kind === 'plane' || o.kind === 'ground')) {
    errors.push(`a light with power on an infinite ${o.kind} has no area and gives no light; use intensity (nits) instead`);
  }
}

// Exposure: auto exposure lifts dark scenes to daylight brightness.
const env = snap.environment;
let dim = false;
if (env.type === 'background') dim = Math.max(...env.radiance) < 20;
if (env.type === 'sky') dim = env.sun_elevation < -1 || env.intensity < 0.02;
if (env.type === 'hdri') dim = env.intensity < 0.02;
if (dim && cam.exposure === 'auto') {
  warnings.push(direct
    ? 'the environment is dark but camera exposure is auto: the meter sets the exposure from the lights, which suits a studio; ' +
      'for a night or low-key look, set exposure: manual (for example f/1.8, 1/60s, iso: 800).'
    : 'the environment is dark but camera exposure is auto: the meter will brighten it to daylight. ' +
      'For night, set exposure: manual with a real setting (for example f/1.8, 1/60s, iso: 3200).');
}
if (env.type === 'sky' && env.sun_elevation < -1) {
  notes.push('sky models daytime only (no moon or stars); below the horizon it is twilight at best. Night scenes read better with background { } and bulbs.');
}

// Motion: does anything change with time?
const later = scene.sample(tl.time + 0.37);
const moves = JSON.stringify(later.objects.map((o) => o.world)) !== JSON.stringify(snap.objects.map((o) => o.world)) ||
  JSON.stringify(later.camera) !== JSON.stringify(snap.camera);
if (moves && tl.duration === 0) {
  notes.push('the scene moves with t but timeline duration is 0, so only a still at time ' + tl.time + ' s can be rendered; add timeline { duration: 4s }.');
}
if (!moves && tl.duration > 0) notes.push('timeline has a duration but nothing moves with t; a video would be a still image repeated.');

// Cost.
const objCount = snap.objects.length;
if (objCount > 1000) warnings.push(`${objCount} objects: every ray tests every object (no top-level BVH). Merge small parts into one mesh (.obj).`);
else if (objCount > 250) warnings.push(`${objCount} objects will slow every ray; hundreds are fine, thousands are not.`);
if (rs.bounces > 12) warnings.push(`bounces: ${rs.bounces} costs time with little visible gain; 6 to 10 covers glass and interiors.`);
const hasGlass = snap.objects.some((o) => o.material.transmission > 0);
if (direct && (film.halation > 0.05 || film.bloom > 0.02)) {
  warnings.push(`film bloom ${film.bloom} / halation ${film.halation} with lamps in the scene: lamps seen directly are thousands of times brighter than the frame, ` +
    'so these spread an orange haze everywhere. If a lamp is in view, use bloom 0.003-0.01 and halation 0.');
}
if (hasGlass && rs.bounces < 6) warnings.push(`glass or water with bounces: ${rs.bounces} looks dark; use at least 6.`);
if (!film.denoise && rs.samples < 256) warnings.push('denoise is off with fewer than 256 samples: expect visible noise.');
if (fog && rs.samples < 256) notes.push('fog converges slowly; a still usually needs 512 or more samples.');

const features = [];
if (snap.objects.some((o) => MESH_KINDS.has(o.kind))) features.push('HAS_MESH');
if (fog) features.push('HAS_FOG');
if (direct) features.push('HAS_LIGHTS');
if (snap.objects.some((o) => o.material.texture)) features.push('HAS_TEXTURES');
if (snap.objects.some((o) => o.material.pattern > 0 || o.material.bump > 0)) features.push('HAS_PATTERNS');

const [w, h] = size ?? rs.resolution;
const slow = fog || hasGlass || features.includes('HAS_MESH');
const gpu = slow ? GPU_PATHS.slow : GPU_PATHS.fast;
const stillSpp = samplesOverride ?? rs.samples;
const videoSpp = samplesOverride ?? rs.video_samples;
const stillPaths = w * h * stillSpp;
const frames = tl.duration > 0 ? Math.max(1, Math.round(tl.duration * tl.fps)) : 0;
const videoPaths = frames * w * h * videoSpp;
report.summary = {
  objects: objCount,
  lights: { direct, indirect: indirect.length },
  environment: scene.environmentKind,
  fog: !!fog,
  animated: moves,
  duration: tl.duration,
  fps: tl.fps,
  features,
  resolution: [w, h],
  samples: stillSpp,
  videoSamples: videoSpp,
  bounces: rs.bounces,
  exposure: cam.exposure,
};
report.estimate = {
  stillPaths, stillGpu: stillPaths / gpu, stillCpu: stillPaths / CPU_PATHS,
  frames, videoPaths, videoGpu: videoPaths / gpu, videoCpu: videoPaths / CPU_PATHS,
};
if (videoPaths / CPU_PATHS > 1800) {
  notes.push('on the CPU renderer this video takes over 30 minutes; for a draft try --size 320x180 --samples 16, or render with --gpu.');
}
finish();

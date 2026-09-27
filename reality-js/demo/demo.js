// reality.js Live: every control rewrites a reality.js scene; the scene is
// compiled and path traced on the viewer's GPU in real time.

import { Reality, RealityError } from '../src/index.js';

const $ = (id) => document.getElementById(id);
const APERTURES = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16];
const BOUNCE_PERIOD = 2.4; // seconds before the drop repeats

const state = {
  preset: 'golden',
  material: 'gold',
  aperture: 2.8,
  sun: 9,
  motion: false,
  size: [640, 360],
};

// ------------------------------------------------------------ scene source
const MATERIALS = {
  gold: 'metal { color: gold, roughness: 0.12 }',
  glass: 'glass { }',
  clay: 'matte { color: #d8c9b4 }',
  chrome: 'mirror { }',
};

function sceneSource(s) {
  const y = s.motion ? `0.6 + bounce(t, 1.4m, 0.72)` : '0.6';
  const lines = [];
  lines.push(`# ${{ golden: 'Golden hour', studio: 'Studio', night: 'Night', fog: 'Fog' }[s.preset]}, ${s.material}, f/${s.aperture}`);
  if (s.motion) lines.push(`timeline { duration: ${BOUNCE_PERIOD}s, fps: 30 }`);

  const cam = ['position: [2.4, 1.2, 4.4]', 'look_at: [0, 0.55, 0]', 'lens: 50mm', `aperture: f/${s.aperture}`, 'blades: 7'];
  if (s.preset === 'night') cam.push('exposure: manual', 'iso: 3200', 'shutter: 1/60s');
  lines.push(`camera {\n  ${cam.join('\n  ')}\n}`);

  if (s.preset === 'golden') {
    lines.push(`sky { sun_elevation: ${s.sun}, sun_azimuth: 235, haze: 1.4 }`);
    lines.push('film { bloom: 0.05, grain: 0.08, halation: 0.15 }');
    lines.push('ground { material: matte { color: #b8ab98, pattern: noise, color2: #a2958a, pattern_scale: 3 } }');
  } else if (s.preset === 'studio') {
    lines.push('background { color: #1c1e23, intensity: 15 }');
    lines.push('film { bloom: 0.03, vignette: 0.7 }');
    lines.push('ground { material: matte { color: #9a948c } }');
    lines.push('softbox { position: [-2.6, 3, 2.2], aim: [0, 0.6, 0], size: [2, 1.4], power: 30000lm }');
    lines.push('softbox { position: [2.6, 2.2, -2], aim: [0, 0.8, 0], size: [0.6, 2], power: 12000lm, temperature: 4300K }');
  } else if (s.preset === 'night') {
    lines.push('background { color: #141b33, intensity: 0.4 }');
    lines.push('film { bloom: 0.05, halation: 0.3, grain: 0.25 }');
    lines.push('ground { material: matte { color: #3b3b3b, roughness: 0.6 } }');
    lines.push('bulb { position: [1.2, 1.9, 1.6], power: 900lm, temperature: 2600K }');
    lines.push(`repeat i in 0..16 {\n  bulb {\n    position: [-5 + i * 0.7, 1.6 + 0.4 * sin(i * 50), -4.5 - random(i) * 2]\n    radius: 2cm\n    power: 160lm\n    temperature: 2000K + random(i, 0, 1100)\n  }\n}`);
  } else {
    lines.push(`sky { sun_elevation: ${Math.max(4, s.sun)}, sun_azimuth: 20, haze: 2 }`);
    lines.push('fog { density: 0.05, anisotropy: 0.7, height: 5m }');
    lines.push('film { bloom: 0.05 }');
    lines.push('ground { material: matte { color: #7d705e } }');
    lines.push(`repeat i in 0..7 {\n  box { position: [-4.5 + i * 1.5, 2.5, -3], size: [0.3, 5, 0.3], material: matte { color: #2e2620 } }\n}`);
  }

  lines.push(`sphere {\n  position: [0, ${y}, 0]\n  radius: 0.6\n  material: ${MATERIALS[s.material]}\n}`);
  lines.push('torus { position: [-1.3, 0.1, 0.6], radius: 0.3, tube: 0.09, material: metal { color: copper, roughness: 0.25 } }');
  lines.push('box { position: [1.2, 0.3, -0.7], size: 0.6, rotate: [0, 30, 0], material: plastic { color: #2f5d8a, roughness: 0.3 } }');
  lines.push('render { bounces: 6 }');
  return lines.join('\n\n') + '\n';
}

// ------------------------------------------------------------ status
function setHealth(stateName, text) {
  $('health').dataset.state = stateName;
  $('health-text').textContent = text;
}
function notice(text) {
  $('notice').hidden = !text;
  $('notice').textContent = text ?? '';
}

// ------------------------------------------------------------ renderer
let reality;
try {
  reality = new Reality($('canvas'), { baseUrl: location.href, width: state.size[0], height: state.size[1] });
} catch (err) {
  setHealth('bad', 'No renderer');
  notice(`This browser cannot run reality.js: ${err.message}`);
  throw err;
}
let gpuName = '';
try {
  gpuName = reality.renderer.info().renderer.replace(/^ANGLE \((.*)\)$/, '$1');
  $('gpu').textContent = gpuName;
} catch { /* optional */ }

let failed = false;
reality.onStatus = (message) => {
  if (message) {
    failed = /refused/.test(message);
    setHealth(failed ? 'bad' : 'warn', failed ? 'Shader refused by the driver' : 'Recovering');
    notice(message);
  } else {
    notice(null);
  }
};

// ------------------------------------------------------------ loading
let loading = null, pendingLoad = false, warmup = 0;
async function rebuild() {
  if (loading) { pendingLoad = true; return; }
  const src = sceneSource(state);
  $('code').textContent = src;
  loading = (async () => {
    try {
      if (reality.renderer.width !== state.size[0] || reality.renderer.height !== state.size[1]) {
        reality.renderer.setSize(state.size[0], state.size[1]);
      }
      await reality.load(src);
      reality.exposureLocked = false;
      warmup = 12; // meter exposure on a still frame before motion starts
      if (!failed) notice(null);
      updateExif();
    } catch (err) {
      setHealth('bad', 'Scene error');
      notice(err instanceof RealityError ? err.format(src) : String(err.message ?? err));
    }
  })();
  await loading;
  loading = null;
  if (pendingLoad) { pendingLoad = false; rebuild(); }
}

function updateExif() {
  const c = reality.camera;
  if (!c) return;
  const lens = '50mm';
  const shutter = c.shutter ? `1/${Math.round(1 / c.shutter)}s` : '—';
  const ev = Number.isFinite(reality.exposure) ? (-Math.log2(reality.exposure * 1.2)).toFixed(1) : '—';
  const mode = reality.manualExposure != null ? `ISO 3200 · EV ${ev}` : `auto · EV ${ev}`;
  $('exif').textContent = `${lens} · f/${state.aperture} · ${shutter} · ${mode} · ${reality.renderer.width}×${reality.renderer.height}`;
}

// ------------------------------------------------------------ render loop
let spf = 1, fpsEma = 0, pathsEma = 0, lastFrame = performance.now(), motionStart = performance.now();
let benchmarking = false;
const TARGET_SPP = 1024;

function tick(now) {
  requestAnimationFrame(tick);
  if (benchmarking || loading || !reality.scene || failed) return;

  const animating = state.motion && warmup <= 0;
  if (animating) {
    reality.exposureLocked = true;
    reality.setTime(((now - motionStart) / 1000) % BOUNCE_PERIOD);
  } else if (reality.samples >= TARGET_SPP) {
    return; // converged; nothing to do until something changes
  }

  const t0 = performance.now();
  reality.step(spf);
  reality.renderer.sync();
  const work = performance.now() - t0;
  if (warmup > 0) warmup -= spf;

  // Keep each frame near 25 ms of GPU work so the page stays smooth.
  if (work < 14 && spf < 32) spf++;
  else if (work > 32 && spf > 1) spf = Math.max(1, Math.floor(spf * 0.7));

  const dt = Math.max(1, now - lastFrame);
  lastFrame = now;
  const paths = (reality.renderer.width * reality.renderer.height * spf) / (work / 1000);
  fpsEma = fpsEma ? fpsEma * 0.9 + (1000 / dt) * 0.1 : 1000 / dt;
  pathsEma = pathsEma ? pathsEma * 0.9 + paths * 0.1 : paths;

  $('spp').textContent = reality.samples;
  $('spf').textContent = spf;
  $('fps').textContent = fpsEma.toFixed(0);
  $('paths').textContent = formatPaths(pathsEma);
  if (!failed) setHealth('ok', `Tracing on ${gpuName || 'your GPU'}`);
  if (reality.samples <= spf || animating) updateExif();
  if (reality.samples >= 24) saveReport('samples');
}

const formatPaths = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} G` : `${(n / 1e6).toFixed(1)} M`);

// ------------------------------------------------------------ controls
function segmented(id, key, parse = (v) => v) {
  const group = $(id);
  group.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    for (const other of group.querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === b));
    state[key] = parse(b.dataset.value);
    onChange();
  });
}
segmented('preset', 'preset');
segmented('material', 'material');

$('aperture').addEventListener('input', (e) => {
  state.aperture = APERTURES[Number(e.target.value)];
  $('aperture-out').textContent = `f/${state.aperture}`;
  onChange();
});
$('sun').addEventListener('input', (e) => {
  state.sun = Number(e.target.value);
  $('sun-out').textContent = `${state.sun}°`;
  onChange();
});
$('motion').addEventListener('change', (e) => {
  state.motion = e.target.checked;
  motionStart = performance.now();
  onChange();
});
$('size').addEventListener('change', (e) => {
  state.size = e.target.value.split('x').map(Number);
  $('size-out').textContent = e.target.value.replace('x', '×');
  onChange();
});

let changeTimer = null;
function onChange() {
  const sunOn = state.preset === 'golden' || state.preset === 'fog';
  $('sun-row').setAttribute('aria-disabled', String(!sunOn));
  $('sun').disabled = !sunOn;
  clearTimeout(changeTimer);
  changeTimer = setTimeout(rebuild, 60);
}

// ------------------------------------------------------------ benchmark
$('bench').addEventListener('click', async () => {
  if (benchmarking || !reality.scene) return;
  benchmarking = true;
  $('bench').disabled = true;
  const out = $('bench-result');
  out.textContent = 'Running…';
  await new Promise((r) => requestAnimationFrame(r));
  try {
    reality.setTime(reality.time);
    const t0 = performance.now();
    let samples = 0;
    while (performance.now() - t0 < 4000) {
      reality.renderer.trace(4);
      reality.renderer.sync();
      samples += 4;
      if (samples % 32 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    const secs = (performance.now() - t0) / 1000;
    reality.display();
    const { width, height } = reality.renderer;
    const perSec = samples / secs;
    const pathsPerSec = (width * height * samples) / secs;
    out.innerHTML = `<b>${perSec.toFixed(1)}</b> samples per pixel per second at ${width}×${height}, <b>${formatPaths(pathsPerSec)}</b> paths per second.`;
    await saveResult({ samplesPerSecond: +perSec.toFixed(2), pathsPerSecond: Math.round(pathsPerSec), width, height, seconds: +secs.toFixed(2), state: { ...state } });
  } catch (err) {
    out.textContent = `The benchmark stopped: ${err.message ?? err}`;
  } finally {
    benchmarking = false;
    $('bench').disabled = false;
  }
});

// ------------------------------------------------------------ reports
// Inside a claude.ai artifact with the `db` capability, keep one GPU
// report per visit and every benchmark result, so performance can be
// checked on hardware we cannot test. No scene content, nothing personal
// beyond browser and GPU names.
const dbReady = window.claude?.use ? window.claude.use('db').catch(() => null) : Promise.resolve(null);
const stamp = () => new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 8);
let reportSaved = false;
async function saveReport(reason) {
  if (reportSaved) return;
  reportSaved = true;
  const db = await dbReady;
  if (!db) return;
  try {
    await db.doc(`diagnostics/${stamp()}`).set({ page: 'live', reason, state: { ...state }, fps: +fpsEma.toFixed(1), pathsPerSecond: Math.round(pathsEma), ...reality.diagnostics() });
  } catch (err) {
    console.warn('report not saved', err);
  }
}
setTimeout(() => saveReport('timer'), 15000);

async function saveResult(result) {
  const db = await dbReady;
  if (!db) return;
  try {
    await db.doc(`bench/${stamp()}`).set({ time: new Date().toISOString(), gpu: gpuName, userAgent: navigator.userAgent, ...result });
    $('bench-result').insertAdjacentText('beforeend', ' Result saved.');
  } catch (err) {
    console.warn('benchmark not saved', err);
  }
}

// ------------------------------------------------------------ start
if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) $('motion').checked = false;
onChange();
requestAnimationFrame(tick);

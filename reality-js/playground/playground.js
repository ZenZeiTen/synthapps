// The playground: edit a scene on the left, watch it converge on the right.

import { Reality, RealityError, renderVideo, OBJECT_KINDS, MATERIAL_KINDS, SETTINGS_KINDS } from '../src/index.js';

const EXAMPLES = [
  ['hello.real', 'Hello, sphere'],
  ['golden-hour.real', 'Golden hour'],
  ['studio-product.real', 'Studio product shot'],
  ['bouncing-balls.real', 'Bouncing balls (animated)'],
  ['lake.real', 'Lake with hand-held camera (animated)'],
  ['god-rays.real', 'God rays in a barn'],
  ['night-bokeh.real', 'Night bokeh'],
];
const EXAMPLES_URL = new URL('../examples/', import.meta.url);
const STORE_KEY = 'reality.playground.v1';

const $ = (id) => document.getElementById(id);
const source = $('source'), highlight = $('highlight'), problems = $('problems');
const canvas = $('canvas');

let reality;
try {
  reality = new Reality(canvas, { baseUrl: EXAMPLES_URL.href });
} catch (err) {
  problems.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
  throw err;
}

// ------------------------------------------------------------ storage
const store = {
  get() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {}; } catch { return {}; } },
  set(v) { try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...store.get(), ...v })); } catch { /* private mode */ } },
};

// ------------------------------------------------------------ highlighting
const KINDS = new Set([...Object.keys(OBJECT_KINDS), ...Object.keys(MATERIAL_KINDS), ...Object.keys(SETTINGS_KINDS)]);
const KEYWORDS = new Set(['let', 'repeat', 'in', 'if', 'else', 'true', 'false', 'keys', 'import', 'ease']);
const TOKEN = /(#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w])|#.*|\/\/.*)|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?)|(f\/[\d.]+|\d+\.?\d*(?:[eE][+-]?\d+)?(?:[a-zA-Z%]+)?)|([A-Za-z_]\w*)(\s*:)?/g;

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function highlightSource(text, errorLine = -1) {
  const lines = text.split('\n').map((line, i) => {
    let out = '', last = 0;
    line.replace(TOKEN, (m, comment, str, num, ident, colon, offset) => {
      out += escapeHtml(line.slice(last, offset));
      last = offset + m.length;
      if (comment) {
        if (comment.length <= 7 && /^#[0-9a-fA-F]+$/.test(comment)) {
          out += `<span class="tok-num tok-color" style="--swatch:${comment}">${comment}</span>`;
        } else {
          out += `<span class="tok-comment">${escapeHtml(comment)}</span>`;
        }
      } else if (str) out += `<span class="tok-str">${escapeHtml(str)}</span>`;
      else if (num) out += `<span class="tok-num">${escapeHtml(num)}</span>`;
      else if (ident) {
        const cls = colon ? 'tok-prop' : KEYWORDS.has(ident) ? 'tok-kw' : KINDS.has(ident) ? 'tok-kind' : '';
        out += cls ? `<span class="${cls}">${ident}</span>` : ident;
        if (colon) out += escapeHtml(colon);
      }
      return m;
    });
    out += escapeHtml(line.slice(last));
    return i === errorLine ? `<span class="err-line">${out || ' '}</span>` : out;
  });
  highlight.innerHTML = lines.join('\n') + '\n';
}

source.addEventListener('scroll', () => {
  highlight.parentElement.scrollTop = source.scrollTop;
  highlight.parentElement.scrollLeft = source.scrollLeft;
});

source.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const { selectionStart: a, selectionEnd: b } = source;
    source.setRangeText('  ', a, b, 'end');
    onEdit();
  } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    renderStill();
  }
});

// ------------------------------------------------------------ compiling
let pending = null, generation = 0, errorLine = -1;

function onEdit() {
  highlightSource(source.value, errorLine);
  store.set({ source: source.value });
  clearTimeout(pending);
  pending = setTimeout(apply, 350);
}
source.addEventListener('input', onEdit);

async function apply() {
  const gen = ++generation;
  const text = source.value;
  try {
    await reality.load(text);
    if (gen !== generation) return;
    errorLine = -1;
    fitPreview();
    showProblems([], reality.warnings);
    setupTimeline();
    reality.start();
  } catch (err) {
    if (gen !== generation) return;
    errorLine = err instanceof RealityError && err.loc ? err.loc.line - 1 : -1;
    showProblems([err instanceof RealityError ? err.format(text) : String(err.message ?? err)], []);
  }
  highlightSource(source.value, errorLine);
}

function showProblems(errors, warnings) {
  problems.innerHTML = [
    ...errors.map((e) => `<div class="error">${escapeHtml(e)}</div>`),
    ...warnings.map((w) => `<div class="warning">warning: ${escapeHtml(w.message)}${w.loc ? ` (line ${w.loc.line})` : ''}</div>`),
  ].join('');
}

// ------------------------------------------------------------ preview size
function fitPreview() {
  const [w, h] = reality.scene.renderSettings.resolution;
  const k = Number($('scale').value);
  const pw = Math.max(64, Math.round(w * k)), ph = Math.max(36, Math.round(h * k));
  if (pw !== reality.renderer.width || ph !== reality.renderer.height) reality.resize(pw, ph);
  $('res').textContent = `${pw}×${ph} preview · ${w}×${h} final`;
}
$('scale').addEventListener('change', () => {
  store.set({ scale: $('scale').value });
  if (reality.scene) { fitPreview(); reality.start(); }
});

reality.onProgress = (n) => {
  $('spp').textContent = n;
  $('exposure').textContent = reality.manualExposure != null ? 'manual exposure' : `auto exposure, EV ${(-Math.log2(reality.exposure * 1.2)).toFixed(1)}`;
};

// ------------------------------------------------------------ timeline
let playing = false, playStart = 0;
function setupTimeline() {
  const d = reality.duration;
  $('timeline').hidden = !(d > 0);
  if (!(d > 0)) { playing = false; return; }
  const slider = $('time');
  slider.max = d;
  slider.value = reality.time;
  $('time-label').textContent = `${reality.time.toFixed(2)} s`;
}
$('time').addEventListener('input', (e) => {
  playing = false;
  $('play').textContent = '▶';
  reality.setTime(Number(e.target.value));
  $('time-label').textContent = `${reality.time.toFixed(2)} s`;
});
$('play').addEventListener('click', () => {
  playing = !playing;
  $('play').textContent = playing ? '❚❚' : '▶';
  playStart = performance.now() / 1000 - reality.time;
  if (playing) requestAnimationFrame(playTick);
});
function playTick() {
  if (!playing) return;
  let t = performance.now() / 1000 - playStart;
  if (t > reality.duration) { playStart += reality.duration; t -= reality.duration; }
  reality.setTime(t);
  $('time').value = t;
  $('time-label').textContent = `${t.toFixed(2)} s`;
  requestAnimationFrame(playTick);
}

// ------------------------------------------------------------ exports
let abort = null;
function overlay(text, fraction) {
  $('overlay').hidden = text == null;
  if (text != null) {
    $('overlay-text').textContent = text;
    $('overlay-fill').style.width = `${Math.round(fraction * 100)}%`;
  }
}
$('cancel').addEventListener('click', () => abort?.abort());

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function withFullResolution(fn) {
  const [w, h] = reality.scene.renderSettings.resolution;
  playing = false;
  reality.stop();
  $('still').disabled = $('video').disabled = true;
  const keepTime = reality.time;
  reality.resize(w, h);
  try {
    return await fn();
  } finally {
    overlay(null);
    $('still').disabled = $('video').disabled = false;
    fitPreview();
    reality.setTime(keepTime);
    reality.start();
  }
}

async function renderStill() {
  if (!reality.scene) return;
  const name = ($('example').value || 'scene').replace(/\.real$/, '');
  await withFullResolution(async () => {
    const samples = reality.scene.renderSettings.samples;
    overlay(`Rendering image: 0 / ${samples} samples`, 0);
    const blob = await reality.renderStill({
      samples,
      onProgress: (n) => overlay(`Rendering image: ${n} / ${samples} samples`, n / samples),
    });
    download(blob, `${name}.png`);
  });
}

async function renderMovie() {
  if (!reality.scene) return;
  if (!(reality.duration > 0)) {
    showProblems(['This scene has no timeline. Add one to make a video, for example:\n  timeline { duration: 4s, fps: 24 }'], reality.warnings);
    return;
  }
  const name = ($('example').value || 'scene').replace(/\.real$/, '');
  abort = new AbortController();
  try {
    await withFullResolution(async () => {
      const r = await renderVideo(reality, {
        signal: abort.signal,
        onProgress: ({ frame, frames, samples, of }) =>
          overlay(`Rendering video: frame ${frame + 1} of ${frames}`, (frame + samples / of) / frames),
      });
      if (r.blob) download(r.blob, `${name}.webm`);
      else r.frames.forEach((f, i) => download(f, `${name}-${String(i).padStart(5, '0')}.png`));
    });
  } catch (err) {
    showProblems([String(err.message ?? err)], []);
  } finally {
    abort = null;
  }
}

$('still').addEventListener('click', renderStill);
$('video').addEventListener('click', renderMovie);

// ------------------------------------------------------------ examples
const select = $('example');
for (const [file, title] of EXAMPLES) select.add(new Option(title, file));
select.add(new Option('My scene (edited)', ''));

async function loadExample(file) {
  const res = await fetch(new URL(file, EXAMPLES_URL));
  source.value = await res.text();
  store.set({ example: file });
  onEdit();
}
select.addEventListener('change', () => { if (select.value) loadExample(select.value); });
source.addEventListener('input', () => { select.value = ''; store.set({ example: '' }); });

// ------------------------------------------------------------ start
const saved = store.get();
if (saved.scale) $('scale').value = saved.scale;
if (saved.source && saved.example === '') {
  select.value = '';
  source.value = saved.source;
  onEdit();
} else {
  select.value = saved.example || EXAMPLES[1][0];
  loadExample(select.value);
}

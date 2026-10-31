// The player page: runs the game in a frame, and around it the translation
// overlay, the script, the glossary and save states.
import { LANGUAGES, api, el, fmtDuration, icon, makerColors, toast } from './common.js';
import { changeThreshold, changed, decodePng, enlargedPngBase64, hashPixels, signature } from './frames.js';
import { Overlay } from './overlay.js';

const $ = (s) => document.querySelector(s);
const gameId = location.pathname.split('/').pop();
const MODES = { boxes: 'Boxes', subtitles: 'Subtitles', off: 'Panel only' };

const S = {
  game: null, settings: null, systems: [],
  started: false, translating: false,
  auto: false, mode: 'boxes',
  lastSig: null, stableSince: 0, translatedSig: null,
  autoTimer: 0, playTimer: 0, lastTick: Date.now(),
};

const stage = $('#stage');
const frame = $('#emu');
const overlay = new Overlay(stage);
const bridge = () => frame.contentWindow?.retroglotBridge;
/** Give the keyboard to the game. */
const focusGame = () => { frame.focus(); bridge()?.focus(); };

// ---------- buttons ----------
function label(btn, iconName, text, key) {
  btn.replaceChildren(icon(iconName), el('span', { class: 'label' }, text), key ? el('kbd', {}, key) : '');
}
$('#back').append(icon('back'));
$('#panel-btn').append(icon('panel'));
label($('#b-translate'), 'lang', 'Translate', 'F2');
label($('#b-save'), 'save', 'Save', 'F6');
label($('#b-load'), 'load', 'Load', 'F7');
label($('#b-pause'), 'pause', 'Pause', 'F9');
label($('#b-ff'), 'ff', 'Fast');
label($('#b-full'), 'full', 'Full screen');
for (const l of LANGUAGES) $('#languages').append(el('option', { value: l }));

function renderToggles() {
  label($('#b-auto'), 'auto', S.auto ? 'Auto: on' : 'Auto: off', 'F3');
  $('#b-auto').classList.toggle('on', S.auto);
  $('#b-auto').setAttribute('aria-pressed', String(S.auto));
  label($('#b-mode'), 'layers', MODES[S.mode], 'F4');
}

function showMessage(title, text) {
  const m = $('#stage-msg');
  m.hidden = !title;
  m.replaceChildren(...(title ? [el('div', {}, el('h2', {}, title), el('p', {}, text || ''))] : []));
}

function busy(on, text = 'Translating…') {
  $('#busy').classList.toggle('on', on);
  $('#busy-text').textContent = text;
}

function costText(usage) {
  if (!usage) return;
  const c = usage.costUsd || 0;
  $('#cost').textContent = `${usage.requests} translation${usage.requests === 1 ? '' : 's'} · ${c < 0.01 && c > 0 ? '<$0.01' : `$${c.toFixed(2)}`} est.${usage.cachedScreens ? ` · ${usage.cachedScreens} from memory` : ''}`;
}

// ---------- loading ----------
async function init() {
  try {
    [S.game, S.settings, S.systems] = await Promise.all([api(`/api/games/${gameId}`), api('/api/settings'), api('/api/systems')]);
  } catch (e) {
    showMessage('This game could not be opened', e.message);
    return;
  }
  const sys = S.systems.find((s) => s.id === S.game.system) || {};
  document.title = `${S.game.title} · retroglot`;
  $('#game-title').textContent = S.game.title;
  $('#sys-tag').textContent = sys.short || S.game.system;
  $('#sys-tag').style.background = makerColors(sys.maker)[0];
  $('#g-lang').value = S.game.sourceLanguage === 'auto' ? '' : S.game.sourceLanguage;
  $('#g-notes').value = S.game.notes || '';
  $('#g-info').textContent = `${S.game.fileName} · ${sys.name || S.game.system} (core ${sys.core}) · played ${fmtDuration(S.game.playSeconds)}`;
  S.mode = S.settings.overlay;
  S.auto = !!S.settings.autoTranslate;
  overlay.setMode(S.mode);
  renderToggles();
  for (const f of ['txt', 'csv', 'tmx']) $(`#export-${f}`).href = `/api/games/${gameId}/export?format=${f}`;
  if (window.innerWidth < 900) $('#side').classList.add('closed');

  if (!sys.installed) {
    showMessage(`The ${sys.name || S.game.system} core is not installed`, `Run: node bin/retroglot.js install-runtime --cores ${sys.core}`);
    return;
  }
  frame.src = `/emu/${gameId}`;
  loadScript();
  loadSaves();
  api(`/api/games/${gameId}`, { method: 'PATCH', body: { played: true } }).catch(() => {});
}

window.addEventListener('message', (ev) => {
  if (ev.origin !== location.origin || !ev.data?.type) return;
  const d = ev.data;
  if (d.type === 'retroglot:start') onStarted();
  else if (d.type === 'retroglot:key') onKey(d.code, d.down);
});

function onStarted() {
  S.started = true;
  showMessage('');
  placeOverlay();
  focusGame();
  // Count play time while the game runs and the page is visible.
  S.playTimer = setInterval(() => {
    const now = Date.now();
    const dt = (now - S.lastTick) / 1000;
    S.lastTick = now;
    if (document.visibilityState === 'visible' && !bridge()?.paused) S.pendingSeconds = (S.pendingSeconds || 0) + dt;
    if (S.pendingSeconds >= 60) flushPlayTime();
  }, 5000);
  // Give the library a picture of the game after a little play.
  if (!S.game.hasCover) setTimeout(() => saveCover(true), 25000);
  if (S.auto) startAuto();
}

function flushPlayTime() {
  const s = Math.round(S.pendingSeconds || 0);
  if (s < 1) return;
  S.pendingSeconds = 0;
  api(`/api/games/${gameId}`, { method: 'PATCH', body: { addPlaySeconds: s } }).catch(() => {});
}
window.addEventListener('pagehide', () => {
  const s = Math.round(S.pendingSeconds || 0);
  if (s > 0) fetch(`/api/games/${gameId}`, { method: 'PATCH', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addPlaySeconds: s }) });
});

// ---------- overlay placement ----------
function placeOverlay() {
  const r = bridge()?.gameRect?.();
  if (!r) return;
  const f = frame.getBoundingClientRect();
  const s = stage.getBoundingClientRect();
  overlay.place({ x: r.x + f.left - s.left, y: r.y + f.top - s.top, width: r.width, height: r.height });
}
new ResizeObserver(() => requestAnimationFrame(placeOverlay)).observe(stage);
setInterval(placeOverlay, 1000);
document.addEventListener('fullscreenchange', () => setTimeout(placeOverlay, 120));

// ---------- translation ----------
async function capture() {
  const png = await bridge().screenshot();
  const img = await decodePng(png);
  return { img, sig: signature(img) };
}

async function translateNow({ force = false, fromAuto = false, shot = null } = {}) {
  if (!S.started || !bridge()) { toast('The game has not started yet'); return; }
  if (S.translating) return;
  S.translating = true;
  let pausedByUs = false;
  busy(true, fromAuto ? 'Reading the screen…' : 'Translating…');
  try {
    const { img, sig } = shot || await capture();
    if (!fromAuto && S.settings.pauseWhileTranslating) pausedByUs = bridge().pause();
    const [hash, big] = await Promise.all([hashPixels(img), enlargedPngBase64(img)]);
    const result = await api(`/api/games/${gameId}/translate`, {
      method: 'POST',
      body: { image: big.base64, width: big.width, height: big.height, hash, force },
    });
    S.translatedSig = sig;
    overlay.show(result);
    costText(result.usage);
    if (result.lines.length) appendScript(result.lines, true);
    else if (!fromAuto) toast('No text to translate on this screen');
    if (result.termsAdded) { toast(`${result.termsAdded} new term${result.termsAdded > 1 ? 's' : ''} added to the glossary`); loadGlossary(); }
  } catch (e) {
    toast(`${e.message}${e.hint ? ` ${e.hint}` : ''}`, 'bad', 7000);
    if (e.code === 'auth' && S.auto) { S.auto = false; renderToggles(); stopAuto(); }
  } finally {
    if (pausedByUs) bridge()?.play();
    S.translating = false;
    busy(false);
  }
}

// Auto mode: watch the screen; when it changes and then holds still, translate it.
function startAuto() {
  stopAuto();
  S.lastSig = null;
  const tick = async () => {
    if (!S.auto) return;
    try {
      if (S.started && !S.translating && document.visibilityState === 'visible' && !bridge()?.paused) {
        const shot = await capture();
        const threshold = changeThreshold(S.settings.autoSensitivity);
        const moving = changed(shot.sig, S.lastSig) > threshold / 2;
        S.lastSig = shot.sig;
        if (moving) {
          S.stableSince = Date.now();
          // The text the overlay describes is gone: hide stale translations straight away.
          if (overlay.result && changed(shot.sig, S.translatedSig) > threshold) overlay.clear();
        } else if (Date.now() - S.stableSince >= 400 && changed(shot.sig, S.translatedSig) > threshold) {
          await translateNow({ fromAuto: true, shot });
        }
      }
    } catch { /* the next tick tries again */ }
    if (S.auto) S.autoTimer = setTimeout(tick, 550);
  };
  S.stableSince = Date.now();
  S.autoTimer = setTimeout(tick, 200);
}
function stopAuto() {
  clearTimeout(S.autoTimer);
}

function toggleAuto() {
  S.auto = !S.auto;
  renderToggles();
  if (S.auto) { S.translatedSig = null; startAuto(); toast('Auto-translate on: new text is translated when the screen settles'); } else stopAuto();
  api('/api/settings', { method: 'PATCH', body: { autoTranslate: S.auto } }).catch(() => {});
}

function cycleMode() {
  const keys = Object.keys(MODES);
  S.mode = keys[(keys.indexOf(S.mode) + 1) % keys.length];
  overlay.setMode(S.mode);
  renderToggles();
  api('/api/settings', { method: 'PATCH', body: { overlay: S.mode } }).catch(() => {});
}

// ---------- script ----------
function lineNode(l, fresh) {
  return el('div', { class: `line${fresh ? ' fresh' : ''}` },
    l.speaker ? el('div', { class: 'who' }, l.speaker) : null,
    el('div', { class: 'tr' }, l.translation),
    el('div', { class: 'or', lang: 'ja' }, l.original));
}

function appendScript(lines, fresh) {
  const box = $('#script');
  box.querySelectorAll('.fresh').forEach((n) => n.classList.remove('fresh'));
  const recent = [...box.querySelectorAll('.or')].slice(-12).map((n) => n.textContent);
  for (const l of lines) {
    if (recent.includes(l.original)) continue;
    box.append(lineNode(l, fresh));
  }
  $('#script-empty').hidden = !!box.childElementCount;
  const pane = box.closest('.pane');
  pane.scrollTop = pane.scrollHeight;
}

async function loadScript() {
  try {
    const data = await api(`/api/games/${gameId}/script`);
    $('#script').replaceChildren(...data.lines.map((l) => lineNode(l, false)));
    $('#script-empty').hidden = !!data.lines.length;
    renderGlossary(data.glossary);
    costText(data.usage);
  } catch (e) {
    toast(e.message, 'bad');
  }
}

async function loadGlossary() {
  const data = await api(`/api/games/${gameId}/script?limit=1`);
  renderGlossary(data.glossary);
}

function glossaryRow(g = { source: '', target: '', note: '', origin: 'user' }) {
  const row = el('div', { class: `gl-row ${g.origin === 'suggested' ? 'suggested' : ''}`, dataset: { origin: g.origin || 'user', note: g.note || '' } },
    el('input', { type: 'text', value: g.source, placeholder: 'Original', 'aria-label': 'Original term', title: g.note || '' }),
    el('input', { type: 'text', value: g.target, placeholder: 'Translation', 'aria-label': 'Translation' }),
    el('button', { class: 'icon-btn', type: 'button', title: 'Delete', 'aria-label': 'Delete term', onclick: () => row.remove() }, icon('x')));
  row.querySelectorAll('input').forEach((i) => i.addEventListener('input', () => { row.dataset.origin = 'user'; row.classList.remove('suggested'); }));
  return row;
}
function renderGlossary(list) {
  $('#glossary').replaceChildren(...(list || []).map(glossaryRow));
}
$('#gl-add').addEventListener('click', () => { const r = glossaryRow(); $('#glossary').append(r); r.querySelector('input').focus(); });
$('#gl-save').addEventListener('click', async () => {
  const glossary = [...document.querySelectorAll('.gl-row')].map((r) => {
    const [a, b] = r.querySelectorAll('input');
    return { source: a.value.trim(), target: b.value.trim(), note: r.dataset.note, origin: r.dataset.origin };
  }).filter((g) => g.source && g.target);
  try {
    renderGlossary((await api(`/api/games/${gameId}/glossary`, { method: 'PUT', body: { glossary } })).glossary);
    toast('Glossary saved', 'good');
  } catch (e) { toast(e.message, 'bad'); }
});
$('#clear-script').addEventListener('click', async () => {
  if (!confirm('Clear the script and the screen memory for this game? The glossary is kept.')) return;
  await api(`/api/games/${gameId}/script`, { method: 'DELETE' });
  loadScript();
});

// ---------- saves ----------
async function pngOfScreen() {
  try { return await bridge().screenshot(); } catch { return new Uint8Array(0); }
}

async function saveState(slot) {
  if (!S.started) return;
  try {
    const state = bridge().getState();
    const pic = await pngOfScreen();
    const body = new Uint8Array(pic.length + state.length);
    body.set(pic, 0);
    body.set(state, pic.length);
    await api(`/api/games/${gameId}/saves/${slot}`, { method: 'PUT', body, headers: { 'X-Picture-Length': String(pic.length), 'Content-Type': 'application/octet-stream' } });
    toast(`Saved to slot ${slot}`, 'good', 1800);
    loadSaves();
  } catch (e) {
    toast(`Could not save: ${e.message}`, 'bad');
  }
}

async function loadState(slot) {
  if (!S.started) return;
  try {
    const res = await api(`/api/games/${gameId}/saves/${slot}/state`, { raw: true });
    if (!res.ok) throw new Error(res.status === 404 ? `Slot ${slot} is empty` : res.statusText);
    bridge().loadState(new Uint8Array(await res.arrayBuffer()));
    overlay.clear();
    S.translatedSig = null;
    toast(`Loaded slot ${slot}`, 'good', 1800);
    focusGame();
  } catch (e) {
    toast(e.message, 'bad');
  }
}

async function loadSaves() {
  const saves = await api(`/api/games/${gameId}/saves`).catch(() => []);
  const bySlot = new Map(saves.map((s) => [s.slot, s]));
  const box = $('#slots');
  box.replaceChildren();
  for (let slot = 1; slot <= 8; slot++) {
    const s = bySlot.get(slot);
    const pic = el('div', { class: 'pic' }, s ? '' : 'Empty');
    if (s?.hasPicture) pic.style.backgroundImage = `url("/api/games/${gameId}/saves/${slot}/png?t=${encodeURIComponent(s.savedAt)}")`;
    box.append(el('div', { class: 'slot' }, pic,
      el('div', { class: 'info' }, el('b', {}, `Slot ${slot}`), s ? new Date(s.savedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : ''),
      el('div', { class: 'acts' },
        el('button', { class: 'btn', type: 'button', onclick: () => saveState(slot) }, 'Save'),
        s ? el('button', { class: 'btn', type: 'button', onclick: () => loadState(slot) }, 'Load') : null)));
  }
}

async function saveCover(quiet = false) {
  if (!S.started) return;
  try {
    const png = await bridge().screenshot();
    await api(`/api/games/${gameId}/cover`, { method: 'PUT', body: png, headers: { 'Content-Type': 'image/png' } });
    S.game.hasCover = true;
    if (!quiet) toast('Cover updated', 'good');
  } catch (e) {
    if (!quiet) toast(e.message, 'bad');
  }
}

// ---------- controls ----------
function onKey(code, down) {
  if (code === 'Backquote') { overlay.peek(down); return; }
  if (!down) return;
  if (code === 'F2') translateNow({ force: false });
  else if (code === 'F3') toggleAuto();
  else if (code === 'F4') cycleMode();
  else if (code === 'F6') saveState(1);
  else if (code === 'F7') loadState(1);
  else if (code === 'F9') bridge()?.togglePause();
}
const typing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
window.addEventListener('keydown', (e) => {
  if (typing()) return;
  if (['F2', 'F3', 'F4', 'F6', 'F7', 'F9', 'Backquote'].includes(e.code)) { e.preventDefault(); if (!e.repeat) onKey(e.code, true); }
});
window.addEventListener('keyup', (e) => { if (e.code === 'Backquote' && !typing()) onKey('Backquote', false); });

$('#b-translate').addEventListener('click', (e) => translateNow({ force: e.shiftKey }));
$('#b-auto').addEventListener('click', toggleAuto);
$('#b-mode').addEventListener('click', cycleMode);
$('#b-save').addEventListener('click', () => saveState(1));
$('#b-load').addEventListener('click', () => loadState(1));
$('#b-pause').addEventListener('click', () => { bridge()?.togglePause(); focusGame(); });
const ff = (on) => bridge()?.fastForward(on);
$('#b-ff').addEventListener('pointerdown', () => ff(true));
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('#b-ff').addEventListener(ev, () => ff(false));
$('#b-full').addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen()).catch(() => {}));
$('#panel-btn').addEventListener('click', () => { $('#side').classList.toggle('closed'); setTimeout(placeOverlay, 50); });
// Clicking the HUD should not leave keyboard focus outside the game.
$('#hud').addEventListener('click', () => setTimeout(() => { if (!typing()) focusGame(); }, 0));

for (const t of document.querySelectorAll('.tab')) {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === t));
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === t.dataset.tab));
  });
}

$('#g-save').addEventListener('click', async () => {
  try {
    S.game = await api(`/api/games/${gameId}`, { method: 'PATCH', body: { sourceLanguage: $('#g-lang').value.trim() || 'auto', notes: $('#g-notes').value } });
    toast('Saved', 'good');
  } catch (e) { toast(e.message, 'bad'); }
});
$('#g-cover').addEventListener('click', () => saveCover(false));
$('#g-restart').addEventListener('click', () => { if (confirm('Restart the game? Unsaved progress is lost.')) { bridge()?.restart(); overlay.clear(); } });

init();

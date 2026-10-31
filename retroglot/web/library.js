// The home screen: systems along the top, the chosen game large in the middle,
// the shelf of games below. Works with mouse, keyboard and game controllers.
import { BRAND_SVG, LANGUAGES, api, el, fmtBytes, fmtDuration, icon, lightOf, toast } from './common.js';
import { watchGamepads } from './gamepad.js';
import { startGlow } from './glow.js';
import { play as sfx, setSounds } from './sound.js';

const state = {
  games: [], systems: [], status: null, settings: null, options: null,
  filter: 'all', query: '', sel: 0, zone: 'shelf', input: 'keys', light: lightOf('all'),
};
const $ = (s) => document.querySelector(s);

$('#brand').insertAdjacentHTML('afterbegin', BRAND_SVG);
$('#search-icon').replaceWith(icon('search'));
$('#add-btn').append(icon('plus'), el('span', { class: 'label' }, 'Add games'));
$('#settings-btn').append(icon('gear'));
$('#settings-x').append(icon('x'));
$('#edit-x').append(icon('x'));
for (const l of LANGUAGES) $('#languages').append(el('option', { value: l }));
startGlow($('#glow'), () => state.light);

const systemOf = (id) => state.systems.find((s) => s.id === id) || { name: id, short: id, maker: '' };
const artUrl = (g, kind = 'boxart') => `/api/games/${g.id}/art/${kind}`;
const dialogOpen = () => !!document.querySelector('dialog[open]');
const typing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

async function load() {
  try {
    [state.status, state.systems, state.settings, state.options] = await Promise.all([
      api('/api/status'), api('/api/systems'), api('/api/settings'), api('/api/options'),
    ]);
    state.games = (await api('/api/scan', { method: 'POST' })).games;
  } catch (e) {
    $('#hero').replaceChildren(el('div', { class: 'hero-empty' }, el('h1', {}, 'Retroglot is not running'), el('p', {}, `The app could not reach its own server: ${e.message}`)));
    return;
  }
  setSounds(state.settings.uiSounds);
  // Start where the player left off: the most recently played game.
  const recent = state.games.filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed.localeCompare(a.lastPlayed))[0];
  renderNotices();
  render();
  if (recent) select(visibleGames().findIndex((g) => g.id === recent.id), { quiet: true });
}

function renderNotices() {
  const box = $('#notices');
  box.replaceChildren();
  const rt = state.status.runtime;
  if (!rt.installed || rt.installing) {
    const bar = el('div', { class: 'progress', hidden: true }, el('i'));
    const text = el('div', {}, el('strong', {}, 'One more step: install the emulator. '),
      'Retroglot downloads EmulatorJS and its emulator cores (about 70 MB, once). Games start once this is done.');
    const btn = el('button', { class: 'btn primary', type: 'button', onclick: () => installRuntime(btn, bar, text) }, 'Install emulator');
    box.append(el('div', { class: 'notice' }, el('div', { class: 'grow' }, text, bar), btn));
    if (rt.installing || state.status.desktop) installRuntime(btn, bar, text);
  }
  if (!state.status.credentials.ok) {
    box.append(el('div', { class: 'notice info' },
      el('div', { class: 'grow' }, el('strong', {}, 'Translation needs a Claude API key. '), 'Games play without one. Add your key in Settings to translate.'),
      el('button', { class: 'btn', type: 'button', onclick: () => $('#settings-btn').click() }, 'Add API key')));
  }
}

let installing = false;
async function installRuntime(btn, bar, text) {
  if (installing) return;
  installing = true;
  btn.disabled = true;
  btn.textContent = 'Installing…';
  bar.hidden = false;
  try {
    let st = await api('/api/runtime/install', { method: 'POST', body: {} });
    while (st.running || (!st.finishedAt && !st.error)) {
      const pct = st.total ? (st.done / st.total) * 100 : 2;
      bar.firstElementChild.style.width = `${Math.max(2, pct)}%`;
      text.lastChild.textContent = ` Downloading ${st.label || '…'} (${st.done + (st.total ? 1 : 0)} of ${st.total || '?'}, ${(st.bytes / 1048576).toFixed(1)} MB so far)`;
      await new Promise((r) => setTimeout(r, 400));
      st = await api('/api/runtime/install');
    }
    if (st.error) throw new Error(st.error);
    toast('The emulator is installed. Pick a game!', 'good');
    state.status = await api('/api/status');
    state.systems = await api('/api/systems');
    renderNotices();
    render();
  } catch (e) {
    text.lastChild.textContent = ` The download failed: ${e.message}. Check the internet connection and try again.`;
    btn.disabled = false;
    btn.textContent = 'Try again';
  } finally {
    installing = false;
  }
}

// ---------- what is on the shelf ----------
function collections() {
  const games = state.games;
  const out = [{ id: 'all', b: 'All', span: `${games.length} game${games.length === 1 ? '' : 's'}` }];
  const recent = games.filter((g) => g.lastPlayed).length;
  if (recent) out.push({ id: 'recent', b: 'Continue', span: 'Recently played' });
  const favs = games.filter((g) => g.favorite).length;
  if (favs) out.push({ id: 'fav', b: 'Favorites', span: `${favs} game${favs === 1 ? '' : 's'}` });
  const counts = {};
  for (const g of games) counts[g.system] = (counts[g.system] || 0) + 1;
  for (const s of state.systems.filter((x) => counts[x.id]).sort((a, b) => a.era - b.era || a.name.localeCompare(b.name))) {
    out.push({ id: s.id, b: s.short, span: s.name, n: counts[s.id] });
  }
  return out;
}

function visibleGames() {
  const q = state.query.trim().toLowerCase();
  let list = state.games.slice();
  if (state.filter === 'fav') list = list.filter((g) => g.favorite);
  else if (state.filter === 'recent') list = list.filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed.localeCompare(a.lastPlayed));
  else if (state.filter !== 'all') list = list.filter((g) => g.system === state.filter);
  if (q) list = list.filter((g) => `${g.title} ${g.fileName} ${g.systemName}`.toLowerCase().includes(q));
  if (state.filter !== 'recent') list.sort((a, b) => a.title.localeCompare(b.title));
  return list;
}

function setLight(color) {
  state.light = color;
  document.body.style.setProperty('--sys', color);
}

// ---------- drawing ----------
const cleanTitle = (t) => t.replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^\]]*\]/g, '').trim() || t;
const REGION_WORDS = /^(Japan|USA|Europe|World|Korea|China|France|Germany|Spain|Brazil|Asia|Australia|J|U|E|UE|JU)(,\s*\w+)*$/i;
/** Tags in the title other than regions: (Demo), (Disc 1), (Rev 1). */
const extraTags = (t) => [...t.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]).filter((x) => !REGION_WORDS.test(x));

// Box art loads when its tile comes near the screen.
const artObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    artObserver.unobserve(e.target);
    e.target.__load?.();
  }
}, { rootMargin: '0px 600px' });

function cover(g, { big = false } = {}) {
  // A drawn label first; the real box art replaces it once it has loaded.
  const sys = systemOf(g.system);
  const gen = el('div', { class: 'gen', style: `--c:${lightOf(g.system)}` },
    el('div', { class: 'band' }, el('b', {}, sys.short || g.system)),
    el('div', { class: 't' }, cleanTitle(g.title)),
    el('div', { class: 'r' }, g.region || sys.maker || ''));
  if (!state.settings?.downloadArt && !g.art?.boxart) return gen;
  const load = () => {
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.onload = () => gen.replaceWith(img);
    img.src = artUrl(g);
  };
  if (big) load();
  else { gen.__load = load; artObserver.observe(gen); }
  return gen;
}

/** Scroll a row so the item sits in the middle, without moving the page. */
function centerIn(row, item, smooth) {
  if (!row || !item) return;
  row.scrollTo({ left: item.offsetLeft - row.clientWidth / 2 + item.offsetWidth / 2, behavior: smooth ? 'smooth' : 'auto' });
}

function render() {
  const cols = collections();
  if (!cols.some((c) => c.id === state.filter)) state.filter = 'all';
  const rail = $('#rail');
  rail.replaceChildren(...cols.map((c) => {
    const b = el('button', { class: `plate${c.id === state.filter ? ' on' : ''}`, type: 'button', style: `--c:${lightOf(c.id)}`, 'aria-pressed': String(c.id === state.filter), dataset: { id: c.id } },
      el('b', {}, c.b), el('span', {}, c.span), c.n ? el('i', { 'aria-label': `${c.n} games` }, String(c.n)) : null);
    b.addEventListener('click', () => { setFilter(c.id); state.zone = 'rail'; zoneChanged(); });
    return b;
  }));
  requestAnimationFrame(() => centerIn(rail, rail.querySelector('.plate.on'), true));

  const list = visibleGames();
  const col = cols.find((c) => c.id === state.filter);
  $('#shelf-title').textContent = state.query ? `Search: ${state.query}` : col.id === 'all' ? 'All games' : col.id === 'recent' ? 'Continue playing' : col.id === 'fav' ? 'Favorites' : col.span;
  $('#shelf-count').textContent = list.length ? `${list.length}` : '';
  setLight(lightOf(state.filter === 'all' || state.filter === 'recent' || state.filter === 'fav' ? (list[0]?.system || state.filter) : state.filter));

  const shelf = $('#shelf');
  shelf.replaceChildren();
  if (!state.games.length) { renderEmptyHero(); return; }
  if (!list.length) {
    shelf.append(el('p', { class: 'shelf-empty' }, 'No games match. Clear the search to see them all.'));
    $('#hero').replaceChildren();
    return;
  }
  list.forEach((g, i) => {
    const t = el('button', { class: 'tile', type: 'button', role: 'option', 'aria-label': g.title, dataset: { i } },
      el('div', { class: 'art' }, cover(g)), el('div', { class: 'name' }, cleanTitle(g.title)));
    if (g.favorite) t.querySelector('.art').append(el('span', { class: 'fav-dot', title: 'Favorite' }));
    t.addEventListener('click', () => { state.zone = 'shelf'; zoneChanged(); if (state.sel === i) playGame(g); else select(i); });
    t.addEventListener('dblclick', () => playGame(g));
    shelf.append(t);
  });
  state.sel = Math.min(state.sel, list.length - 1);
  select(state.sel, { quiet: true, force: true });
}

function renderEmptyHero() {
  setLight(lightOf('all'));
  setBackdrop(null);
  $('#shelf-title').textContent = 'Your shelf is empty';
  $('#shelf-count').textContent = '';
  $('#hero').replaceChildren(
    el('div', { class: 'hero-art' }, el('div', { class: 'case' }, el('img', { src: '/assets/demo-boxart.png', alt: '' }))),
    el('div', { class: 'hero-info hero-empty' },
      el('div', { class: 'hero-system' }, 'Welcome to Retroglot'),
      el('h1', {}, 'Bring your games, read them in your language'),
      el('p', {}, 'Add cartridge ROMs, disc images and DOS games from the 1980s to the PlayStation era. They stay on this computer. Or try the short Japanese demo and press F2 to translate it.'),
      el('div', { class: 'hero-actions' },
        el('button', { class: 'btn primary play', type: 'button', onclick: addDemo }, icon('play'), 'Try the Japanese demo'),
        el('button', { class: 'btn big', type: 'button', onclick: () => $('#file-input').click() }, icon('plus'), 'Add your games'))));
}

let bdFront = 'a';
let bdUrl = null;
function setBackdrop(url) {
  if (url === bdUrl) return;
  bdUrl = url;
  const next = bdFront === 'a' ? 'b' : 'a';
  const nextEl = $(`#bd-${next}`);
  const show = () => { $(`#bd-${bdFront}`).classList.remove('on'); nextEl.classList.add('on'); bdFront = next; };
  if (!url) { $(`#bd-${bdFront}`).classList.remove('on'); return; }
  const img = new Image();
  img.onload = () => { if (bdUrl !== url) return; nextEl.style.backgroundImage = `url("${url}")`; show(); };
  img.onerror = () => {
    // No in-game picture: fall back to the box art.
    if (url.endsWith('/snap')) setBackdrop(url.replace(/\/snap$/, '/boxart'));
  };
  img.src = url;
}

function select(i, { quiet = false, force = false } = {}) {
  const list = visibleGames();
  if (!list.length || i < 0) return;
  i = Math.max(0, Math.min(list.length - 1, i));
  if (i === state.sel && !force && $('#hero').childElementCount) return;
  if (!quiet && i !== state.sel) sfx('move');
  state.sel = i;
  const tiles = $('#shelf').children;
  for (const t of tiles) t.classList.toggle('sel', Number(t.dataset.i) === i);
  centerIn($('#shelf'), tiles[i], !quiet);
  renderHero(list[i]);
}

function renderHero(g) {
  const sys = systemOf(g.system);
  setLight(lightOf(g.system));
  setBackdrop(artUrl(g, 'snap'));
  const facts = el('div', { class: 'facts' });
  if (g.region) facts.append(el('span', { class: 'region' }, g.region));
  facts.append(el('span', {}, icon('clock'), g.playSeconds ? `Played ${fmtDuration(g.playSeconds)}` : 'Not played yet'));
  if (g.lastPlayed) facts.append(el('span', {}, icon('calendar'), `Last played ${relDay(g.lastPlayed)}`));
  if (g.saves) facts.append(el('span', {}, icon('disk'), `${g.saves} save${g.saves === 1 ? '' : 's'}`));
  const fav = el('button', { class: `icon-btn big${g.favorite ? ' on' : ''}`, type: 'button', title: g.favorite ? 'Remove from favorites (F)' : 'Add to favorites (F)', 'aria-label': 'Favorite', 'aria-pressed': String(g.favorite), onclick: () => toggleFav(g) }, icon('heart'));
  if (g.favorite) fav.querySelector('svg').setAttribute('fill', 'currentColor');
  const btnHint = (k, pad) => (state.input === 'pad' ? el('span', { class: `pad ${pad}` }, pad.toUpperCase()) : el('kbd', {}, k));
  $('#hero').replaceChildren(
    el('div', { class: 'hero-art' }, el('div', { class: 'case' }, cover(g, { big: true }))),
    el('div', { class: 'hero-info' },
      el('div', { class: 'hero-system' }, sys.name || g.system),
      el('h1', {}, cleanTitle(g.title)),
      extraTags(g.title).length ? el('div', { class: 'tags' }, extraTags(g.title).map((t) => el('span', {}, t))) : null,
      facts,
      el('div', { class: 'hero-actions' },
        el('button', { class: 'btn primary play', type: 'button', onclick: () => playGame(g) }, icon('play'), 'Play', btnHint('Enter', 'a')),
        g.saves ? el('button', { class: 'btn big', type: 'button', onclick: () => playGame(g, { resume: true }) }, icon('load'), 'Continue', btnHint('C', 'x')) : null,
        fav,
        el('button', { class: 'icon-btn big', type: 'button', title: 'Game details (I)', 'aria-label': 'Game details', onclick: () => editGame(g) }, icon('dots')))));
}

function relDay(iso) {
  const days = Math.floor((Date.now() - new Date(iso)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

async function toggleFav(g) {
  sfx('fav');
  Object.assign(g, await api(`/api/games/${g.id}`, { method: 'PATCH', body: { favorite: !g.favorite } }));
  const id = g.id;
  render();
  select(visibleGames().findIndex((x) => x.id === id), { quiet: true, force: true });
}

async function playGame(g, { resume = false } = {}) {
  if (!g) return;
  sfx('select');
  let url = `/play/${g.id}`;
  if (resume) {
    const saves = await api(`/api/games/${g.id}/saves`).catch(() => []);
    const latest = saves.sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
    if (latest) url += `?slot=${latest.slot}`;
  }
  document.body.classList.add('leaving');
  setTimeout(() => { location.href = url; }, 140);
}

function setFilter(id) {
  if (id === state.filter) return;
  state.filter = id;
  state.sel = 0;
  sfx('switch');
  render();
}

function moveFilter(d) {
  const cols = collections();
  const i = cols.findIndex((c) => c.id === state.filter);
  const n = cols[Math.max(0, Math.min(cols.length - 1, i + d))];
  if (n) setFilter(n.id);
}

function zoneChanged() {
  $('#rail').classList.toggle('focus', state.zone === 'rail');
  $('#shelf').classList.toggle('focus', state.zone === 'shelf');
}

function renderHints() {
  const pad = state.input === 'pad';
  const h = (k, p, text) => el('span', {}, pad ? el('span', { class: `pad ${p}` }, p.toUpperCase()) : el('kbd', {}, k), text);
  $('#hints').replaceChildren(
    h('Enter', 'a', 'Play'), h('C', 'x', 'Continue'), h('F', 'y', 'Favorite'),
    pad ? el('span', {}, el('span', { class: 'pad' }, 'LB'), el('span', { class: 'pad' }, 'RB'), 'Systems') : el('span', {}, el('kbd', {}, 'Q'), el('kbd', {}, 'E'), 'Systems'),
    pad ? el('span', {}, el('span', { class: 'pad' }, '☰'), 'Settings') : el('span', {}, el('kbd', {}, '/'), 'Search'));
}

function command(name) {
  if (dialogOpen()) return;
  const list = visibleGames();
  const g = list[state.sel];
  if (name === 'left') { if (state.zone === 'rail') moveFilter(-1); else select(state.sel - 1); }
  else if (name === 'right') { if (state.zone === 'rail') moveFilter(1); else select(state.sel + 1); }
  else if (name === 'up') { if (state.zone !== 'rail') { state.zone = 'rail'; sfx('move'); zoneChanged(); } }
  else if (name === 'down') { if (state.zone !== 'shelf') { state.zone = 'shelf'; sfx('move'); zoneChanged(); } }
  else if (name === 'a') { if (state.zone === 'rail') { state.zone = 'shelf'; zoneChanged(); sfx('move'); } else playGame(g); }
  else if (name === 'x') { if (g?.saves) playGame(g, { resume: true }); }
  else if (name === 'y') { if (g) toggleFav(g); }
  else if (name === 'lb') moveFilter(-1);
  else if (name === 'rb') moveFilter(1);
  else if (name === 'b') { if (state.query) { $('#search').value = ''; state.query = ''; render(); sfx('back'); } }
  else if (name === 'start') $('#settings-btn').click();
  else if (name === 'select') { if (g) editGame(g); }
}

function setInput(kind) {
  if (state.input === kind) return;
  state.input = kind;
  renderHints();
  const g = visibleGames()[state.sel];
  if (g) renderHero(g);
}

document.addEventListener('keydown', (e) => {
  if (dialogOpen()) return;
  if (typing()) {
    if (e.key === 'Escape' || e.key === 'ArrowDown' || e.key === 'Enter') { document.activeElement.blur(); state.zone = 'shelf'; zoneChanged(); e.preventDefault(); }
    return;
  }
  const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Enter: 'a', c: 'x', C: 'x', f: 'y', F: 'y', q: 'lb', Q: 'lb', e: 'rb', E: 'rb', PageUp: 'lb', PageDown: 'rb', Escape: 'b', i: 'select', I: 'select' };
  if (e.key === '/') { e.preventDefault(); $('#search').focus(); return; }
  const name = map[e.key];
  if (!name) return;
  // Enter on a focused button activates that button instead.
  if (name === 'a' && document.activeElement?.tagName === 'BUTTON' && !document.activeElement.classList.contains('tile')) return;
  e.preventDefault();
  setInput('keys');
  command(name);
});
watchGamepads((name) => { setInput('pad'); command(name); }, { isActive: () => !document.hidden });

// ---------- adding games ----------
async function upload(files) {
  const list = [...files];
  if (!list.length) return;
  const bar = $('#upload-progress');
  bar.hidden = false;
  let done = 0;
  const total = list.reduce((s, f) => s + f.size, 0) || 1;
  for (const f of list) {
    try {
      const g = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', `/api/upload?name=${encodeURIComponent(f.name)}`);
        xhr.upload.onprogress = (e) => { bar.firstElementChild.style.width = `${((done + e.loaded) / total) * 100}%`; };
        xhr.onload = () => {
          let data = {};
          try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
          if (xhr.status >= 200 && xhr.status < 300) resolve(data); else reject(new Error(data.error || xhr.statusText));
        };
        xhr.onerror = () => reject(new Error('upload failed'));
        xhr.send(f);
      });
      toast(`Added ${g.title} (${g.systemName}${g.detection?.confidence === 'low' ? ', guessed: check the system in its details' : ''})`, 'good');
    } catch (e) {
      toast(`${f.name}: ${e.message}`, 'bad', 6000);
    }
    done += f.size;
  }
  bar.hidden = true;
  bar.firstElementChild.style.width = '0';
  state.games = await api('/api/games');
  render();
}

async function addDemo() {
  try {
    const g = await api('/api/demo', { method: 'POST' });
    toast(`Added ${g.title}. Press Play, then F2 to translate.`, 'good');
    state.games = await api('/api/games');
    state.filter = 'all';
    render();
    select(visibleGames().findIndex((x) => x.id === g.id), { quiet: true, force: true });
    sfx('select');
  } catch (e) {
    toast(e.message, 'bad');
  }
}

$('#add-btn').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', (e) => { upload(e.target.files); e.target.value = ''; });
$('#search').addEventListener('input', (e) => { state.query = e.target.value; state.sel = 0; if (state.query && state.filter !== 'all') state.filter = 'all'; render(); });

let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { dragDepth++; $('#dropzone').classList.add('on'); } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropzone').classList.remove('on'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('#dropzone').classList.remove('on');
  if (e.dataTransfer?.files?.length) upload(e.dataTransfer.files);
});

// ---------- dialogs ----------
function fillSelect(sel, entries, value) {
  sel.replaceChildren(...entries.map(([v, label]) => el('option', { value: v, selected: v === value }, label)));
}

$('#settings-btn').addEventListener('click', () => {
  const f = $('#settings-dialog form');
  const s = state.settings;
  f.targetLanguage.value = s.targetLanguage;
  fillSelect(f.style, Object.entries(state.options.styles).map(([k, v]) => [k, v.split(':')[0]]), s.style);
  fillSelect(f.model, Object.entries(state.options.models).map(([k, v]) => [k, v.label]), s.model);
  fillSelect(f.effort, state.options.efforts.map((e) => [e, e[0].toUpperCase() + e.slice(1)]), s.effort);
  f.overlay.value = s.overlay;
  f.pauseWhileTranslating.checked = s.pauseWhileTranslating;
  f.autoSensitivity.value = s.autoSensitivity;
  f.libraryPaths.value = s.libraryPaths.join('\n');
  f.display.value = s.display;
  f.downloadArt.checked = s.downloadArt;
  f.uiSounds.checked = s.uiSounds;
  renderKeyStatus(state.status.credentials);
  const st = state.status;
  $('#settings-status').textContent = `Retroglot ${st.version}. Data folder: ${st.home}. Emulator: EmulatorJS ${st.runtime.emulatorjs} with ${st.runtime.cores.length} cores. Claude credentials: ${st.credentials.source}.`;
  $('#settings-dialog').showModal();
});

$('#settings-dialog').addEventListener('close', async () => {
  if ($('#settings-dialog').returnValue !== 'save') return;
  const f = $('#settings-dialog form');
  try {
    state.settings = await api('/api/settings', {
      method: 'PATCH',
      body: {
        targetLanguage: f.targetLanguage.value.trim() || 'English', style: f.style.value, model: f.model.value, effort: f.effort.value,
        overlay: f.overlay.value, pauseWhileTranslating: f.pauseWhileTranslating.checked, autoSensitivity: Number(f.autoSensitivity.value),
        libraryPaths: f.libraryPaths.value.split('\n').map((s) => s.trim()).filter(Boolean),
        display: f.display.value, downloadArt: f.downloadArt.checked, uiSounds: f.uiSounds.checked,
      },
    });
    setSounds(state.settings.uiSounds);
    toast('Settings saved', 'good');
    state.games = (await api('/api/scan', { method: 'POST' })).games;
    render();
  } catch (e) {
    toast(e.message, 'bad');
  }
});

function renderKeyStatus(c) {
  $('#api-key').value = '';
  $('#api-key').placeholder = c.saved ? `Saved key ${c.hint} (type a new one to replace it)` : c.ok ? `Using ${c.source}` : 'sk-ant-...';
  $('#key-remove').hidden = !c.saved;
}

$('#key-save').addEventListener('click', async () => {
  const key = $('#api-key').value.trim();
  if (!key) { $('#api-key').focus(); return; }
  const btn = $('#key-save');
  btn.disabled = true;
  try {
    state.status.credentials = await api('/api/credentials', { method: 'PUT', body: { apiKey: key } });
    renderKeyStatus(state.status.credentials);
    btn.textContent = 'Checking…';
    const t = await api('/api/credentials/test', { method: 'POST' });
    if (t.ok) toast('API key saved and working', 'good');
    else toast(`Saved, but Claude did not accept it: ${t.error} ${t.hint || ''}`, 'bad', 8000);
    renderNotices();
  } catch (e) {
    toast(e.message, 'bad', 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save key';
  }
});

$('#key-remove').addEventListener('click', async () => {
  if (!confirm('Remove the saved Claude API key from this computer?')) return;
  state.status.credentials = await api('/api/credentials', { method: 'DELETE' });
  renderKeyStatus(state.status.credentials);
  renderNotices();
});

let editing = null;
function editGame(g) {
  editing = g;
  const f = $('#edit-dialog form');
  f.title.value = g.title;
  fillSelect(f.system, state.systems.slice().sort((a, b) => a.name.localeCompare(b.name)).map((s) => [s.id, `${s.name}${s.installed ? '' : ' (core not installed)'}`]), g.system);
  f.sourceLanguage.value = g.sourceLanguage === 'auto' ? '' : g.sourceLanguage;
  f.notes.value = g.notes || '';
  $('#edit-info').textContent = `File: ${g.fileName} (${fmtBytes(g.size)}). Detected as ${systemOf(g.detection.system).name}: ${g.detection.reason}, ${g.detection.confidence} confidence.${g.extraFiles.length ? ` Disc tracks: ${g.extraFiles.join(', ')}.` : ''}`;
  $('#edit-dialog').showModal();
}

$('#edit-dialog').addEventListener('close', async () => {
  const action = $('#edit-dialog').returnValue;
  const f = $('#edit-dialog form');
  if (!editing) return;
  try {
    if (action === 'save') {
      Object.assign(editing, await api(`/api/games/${editing.id}`, { method: 'PATCH', body: { title: f.title.value, system: f.system.value, sourceLanguage: f.sourceLanguage.value.trim() || 'auto', notes: f.notes.value } }));
    } else if (action === 'remove') {
      if (!confirm(`Remove "${editing.title}" from the library? Files you uploaded are deleted; files in your own folders are left alone.`)) return;
      await api(`/api/games/${editing.id}?deleteFile=1`, { method: 'DELETE' });
      state.games = state.games.filter((x) => x.id !== editing.id);
    }
    const id = editing.id;
    render();
    const i = visibleGames().findIndex((x) => x.id === id);
    if (i >= 0) select(i, { quiet: true, force: true });
  } catch (e) {
    toast(e.message, 'bad');
  }
});

$('#art-choose').addEventListener('click', () => $('#art-input').click());
$('#art-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !editing) return;
  try {
    Object.assign(editing, await api(`/api/games/${editing.id}/art/boxart`, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } }));
    toast('Box art updated', 'good');
    bust();
  } catch (err) { toast(err.message, 'bad'); }
});
$('#art-reset').addEventListener('click', async () => {
  if (!editing) return;
  Object.assign(editing, await api(`/api/games/${editing.id}/art/boxart`, { method: 'DELETE' }));
  toast('Box art reset; the downloaded picture is used when there is one', 'good');
  bust();
});
/** Reload pictures after a change (the browser keeps them for an hour otherwise). */
function bust() {
  const id = editing.id;
  for (const img of document.querySelectorAll(`img[src*="/api/games/${id}/art/"]`)) img.src = `${img.src.split('?')[0]}?t=${Date.now()}`;
}

renderHints();
zoneChanged();
load();

// The library page: browse, add, edit and start games.
import { BRAND_SVG, LANGUAGES, api, el, fmtBytes, fmtDuration, icon, makerColors, toast } from './common.js';

const state = { games: [], systems: [], status: null, settings: null, options: null, filter: 'all', query: '' };
const $ = (s) => document.querySelector(s);

$('#brand').insertAdjacentHTML('afterbegin', BRAND_SVG);
$('#search-icon').replaceWith(icon('search'));
$('#add-btn').append(icon('plus'), el('span', { class: 'label' }, 'Add games'));
$('#settings-btn').append(icon('gear'));
$('#settings-x').append(icon('x'));
$('#edit-x').append(icon('x'));
for (const l of LANGUAGES) $('#languages').append(el('option', { value: l }));

const systemOf = (id) => state.systems.find((s) => s.id === id) || { name: id, short: id, maker: '' };

async function load() {
  try {
    [state.status, state.systems, state.settings, state.options] = await Promise.all([
      api('/api/status'), api('/api/systems'), api('/api/settings'), api('/api/options'),
    ]);
    state.games = (await api('/api/scan', { method: 'POST' })).games;
  } catch (e) {
    $('#summary').textContent = `Could not reach the retroglot server: ${e.message}`;
    return;
  }
  renderNotices();
  render();
}

function renderNotices() {
  const box = $('#notices');
  box.replaceChildren();
  const rt = state.status.runtime;
  if (!rt.installed || rt.installing) {
    const bar = el('div', { class: 'progress', hidden: true }, el('i'));
    const text = el('div', {}, el('strong', {}, 'One more step: install the emulator. '),
      'retroglot downloads EmulatorJS and its emulator cores (about 70 MB, once). Games cannot start until this is done.');
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

function visibleGames() {
  const q = state.query.trim().toLowerCase();
  let list = state.games.slice();
  if (state.filter === 'fav') list = list.filter((g) => g.favorite);
  else if (state.filter === 'recent') list = list.filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed.localeCompare(a.lastPlayed));
  else if (state.filter !== 'all') list = list.filter((g) => g.system === state.filter);
  if (q) list = list.filter((g) => `${g.title} ${g.fileName} ${g.systemName}`.toLowerCase().includes(q));
  if (state.filter !== 'recent') list.sort((a, b) => (b.favorite - a.favorite) || (b.lastPlayed || '').localeCompare(a.lastPlayed || '') || a.title.localeCompare(b.title));
  return list;
}

function render() {
  const games = state.games;
  const played = games.reduce((s, g) => s + g.playSeconds, 0);
  $('#summary').textContent = games.length
    ? `${games.length} game${games.length === 1 ? '' : 's'} · ${new Set(games.map((g) => g.system)).size} systems · ${fmtDuration(played).replace('Not played', 'nothing played yet')}`
    : 'Add a game to get started.';

  const chips = $('#chips');
  chips.replaceChildren();
  const chip = (id, label, n) => el('button', { class: `chip${state.filter === id ? ' on' : ''}`, type: 'button', 'aria-pressed': String(state.filter === id), onclick: () => { state.filter = id; render(); } }, label, n != null ? el('span', { class: 'n' }, n) : null);
  if (games.length) {
    chips.append(chip('all', 'All', games.length));
    if (games.some((g) => g.lastPlayed)) chips.append(chip('recent', 'Recently played'));
    if (games.some((g) => g.favorite)) chips.append(chip('fav', 'Favorites', games.filter((g) => g.favorite).length));
    const counts = {};
    for (const g of games) counts[g.system] = (counts[g.system] || 0) + 1;
    for (const s of state.systems.filter((x) => counts[x.id]).sort((a, b) => a.era - b.era)) chips.append(chip(s.id, s.name, counts[s.id]));
  }

  const grid = $('#grid');
  grid.replaceChildren();
  const list = visibleGames();
  if (!games.length) {
    grid.style.display = 'block';
    grid.append(el('div', { class: 'empty' },
      el('h2', {}, 'Drop your games here'),
      el('p', {}, 'Cartridge ROMs, disc images and DOS games, from the 1980s to the PlayStation era. Files stay on this computer.'),
      el('div', { class: 'row' },
        el('button', { class: 'btn primary', type: 'button', onclick: () => $('#file-input').click() }, icon('plus'), 'Choose files'),
        el('button', { class: 'btn', type: 'button', onclick: addDemo }, 'Add the Japanese demo game'))));
    return;
  }
  grid.style.display = '';
  if (!list.length) grid.append(el('p', { class: 'hint' }, 'No games match.'));
  for (const g of list) grid.append(card(g));
}

function card(g) {
  const sys = systemOf(g.system);
  const [c1, c2] = makerColors(sys.maker);
  const cover = el('div', { class: 'cover' });
  if (g.hasCover) cover.append(el('img', { src: `/api/games/${g.id}/cover?t=${encodeURIComponent(g.lastPlayed || '')}`, alt: '', loading: 'lazy' }));
  else { cover.style.background = `radial-gradient(120% 90% at 20% 10%, ${c1}55, transparent 60%), linear-gradient(135deg, ${c2}, #0b0c14)`; cover.append(el('div', { class: 'placeholder' }, sys.short)); }
  cover.append(el('div', { class: 'play' }, el('span', {}, icon('play'))));
  const fav = el('button', { class: `fav${g.favorite ? ' on' : ''}`, type: 'button', title: g.favorite ? 'Remove from favorites' : 'Add to favorites', 'aria-label': 'Favorite', 'aria-pressed': String(g.favorite) }, icon('heart'));
  if (g.favorite) fav.querySelector('svg').setAttribute('fill', 'currentColor');
  fav.addEventListener('click', async (e) => {
    e.stopPropagation();
    const upd = await api(`/api/games/${g.id}`, { method: 'PATCH', body: { favorite: !g.favorite } });
    Object.assign(g, upd);
    render();
  });
  const more = el('button', { class: 'icon-btn more', type: 'button', title: 'Game details', 'aria-label': `Details for ${g.title}` }, icon('dots'));
  more.addEventListener('click', (e) => { e.stopPropagation(); editGame(g); });
  const tag = el('span', { class: 'tag', style: `background:${c1}` }, sys.short);
  const node = el('article', { class: 'card', tabindex: '0', role: 'link', 'aria-label': `Play ${g.title}` },
    cover, fav,
    el('div', { class: 'meta' },
      el('div', { class: 'title', title: g.title }, g.title),
      el('div', { class: 'sub' }, tag, g.region ? el('span', {}, g.region) : null, el('span', {}, fmtDuration(g.playSeconds)))),
    more);
  const go = () => { location.href = `/play/${g.id}`; };
  node.addEventListener('click', go);
  node.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === node) go(); });
  return node;
}

// ---------- adding games ----------
async function upload(files) {
  const list = [...files];
  if (!list.length) return;
  const bar = $('#upload-progress');
  bar.style.display = '';
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
  bar.style.display = 'none';
  bar.firstElementChild.style.width = '0';
  state.games = await api('/api/games');
  render();
}

async function addDemo() {
  try {
    const g = await api('/api/demo', { method: 'POST' });
    toast(`Added ${g.title}. Open it and press Translate.`, 'good');
    state.games = await api('/api/games');
    render();
  } catch (e) {
    toast(e.message, 'bad');
  }
}

$('#add-btn').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', (e) => { upload(e.target.files); e.target.value = ''; });
$('#search').addEventListener('input', (e) => { state.query = e.target.value; render(); });
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') { e.preventDefault(); $('#search').focus(); }
});

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
  renderKeyStatus(state.status.credentials);
  const st = state.status;
  $('#settings-status').textContent = `Data folder: ${st.home} · EmulatorJS ${st.runtime.emulatorjs}, ${st.runtime.cores.length} cores · Claude credentials: ${st.credentials.source} · retroglot ${st.version}`;
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
      },
    });
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
  $('#edit-info').textContent = `${g.fileName} · ${fmtBytes(g.size)} · detected as ${systemOf(g.detection.system).name} (${g.detection.reason}, ${g.detection.confidence} confidence)${g.extraFiles.length ? ` · with ${g.extraFiles.join(', ')}` : ''}`;
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
    render();
  } catch (e) {
    toast(e.message, 'bad');
  }
});

load();

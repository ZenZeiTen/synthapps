import { h, fill, icon, bytes, num, when, day, toast, api, runJob, working, errorBox, t, tn, loadLang, currentLang } from './ui.js';

const state = {
  mode: null,
  categories: [],   // catalog
  care: [],         // ids used by "Tidy up" and automatic care
  scans: null,      // id -> scan
  scanJob: null,
  health: null,
  healthJob: null,
  startup: null,
  updates: null,
  lastReceipt: null,
  folders: null,
};

const main = document.getElementById('main');
const nav = document.getElementById('nav');
const isWin = () => state.mode && state.mode.os === 'windows';
const feat = k => state.mode && state.mode.features && state.mode.features[k];
// The Recycle Bin on Windows, the trash elsewhere.
const bin = () => t(isWin() ? 'word.recycleBin' : 'word.trash');

// ---------------------------------------------------------------- data

function scan(force) {
  if (state.scanJob && !force) return state.scanJob;
  state.scanJob = runJob('scan').then(r => {
    state.scans = Object.fromEntries(r.scans.map(s => [s.id, s]));
    updateNav();
    return state.scans;
  }).catch(e => { state.scanJob = null; throw e; });
  return state.scanJob;
}

function checkHealth(force) {
  if (state.healthJob && !force) return state.healthJob;
  state.healthJob = runJob('health').then(r => { state.health = r; updateNav(); return r; })
    .catch(e => { state.healthJob = null; throw e; });
  return state.healthJob;
}

async function loadStartup() {
  const r = await api('GET', '/api/local/startup');
  state.startup = r.items;
  updateNav();
  return r.items;
}

const cat = id => state.categories.find(c => c.id === id);

// Space that can go now, without the bin (that is the person's own choice).
function canGo(ids) {
  if (!state.scans) return 0;
  return (ids || Object.keys(state.scans)).reduce((n, id) => {
    const s = state.scans[id], c = cat(id);
    return n + (s && c && c.kind !== 'bin' && s.status === 'ready' ? s.bytes : 0);
  }, 0);
}

// ---------------------------------------------------------------- navigation

const pages = [
  { id: 'overview' },
  { id: 'clean' },
  { id: 'large' },
  { id: 'dupes' },
  { sep: true },
  { id: 'startup' },
  { id: 'updates', when: () => feat('updates') },
  { id: 'health' },
  { id: 'privacy', when: () => feat('privacy') },
  { sep: true },
  { id: 'care' },
  { id: 'history' },
  { id: 'settings', when: () => feat('autostart') },
  { id: 'why' },
];

function badge(id) {
  if (id === 'clean' && state.scans) { const n = canGo(); return n ? bytes(n) : ''; }
  if (id === 'startup' && state.startup) return num(state.startup.filter(i => i.enabled).length);
  if (id === 'health' && state.health) {
    const n = state.health.findings.filter(f => f.status === 'problem' || f.status === 'attention').length;
    return n ? num(n) : '';
  }
  if (id === 'updates' && state.updates) return state.updates.length ? num(state.updates.length) : '';
  return '';
}

function updateNav() {
  const cur = route();
  fill(nav, pages.filter(p => !p.when || p.when()).map(p => p.sep ? h('hr') :
    h('a', { href: '#/' + p.id, 'aria-current': p.id === cur ? 'page' : false },
      h('span', null, t('nav.' + p.id)), h('small', null, badge(p.id)))));
}

const views = {};
function route() {
  const r = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  // Only a page Kempt defines, and only a view that really exists.
  return pages.some(p => p.id === r) && Object.hasOwn(views, r) ? r : 'overview';
}

let viewToken = 0;
function render() {
  const id = route();
  const mine = ++viewToken;
  updateNav();
  const page = h('div', { class: 'page' });
  fill(main, page);
  const alive = () => mine === viewToken;
  Promise.resolve(views[id](page, alive)).catch(e => { if (alive()) page.append(errorBox(e, render)); });
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function header(page, title, lede) {
  page.append(h('h1', null, title), lede && h('p', { class: 'lede' }, lede));
}

async function action(id, path) {
  try { await api('POST', '/api/local/action', { id, path }); }
  catch (e) { toast(e.message, 'error'); }
}

function actionButton(a) {
  if (!a) return null;
  if (a.id.startsWith('go:')) return h('a', { class: 'btn', href: '#/' + a.id.slice(3) }, a.label);
  return h('button', { class: 'btn', onclick: () => action(a.id) }, a.label);
}

// ---------------------------------------------------------------- overview

views.overview = async (page, alive) => {
  header(page, t('overview.title'), t('overview.lede'));
  const ribbon = h('section', { class: 'ribbon-wrap', 'aria-label': t('overview.driveLabel') }, working(t('overview.measuring')));
  const receipt = h('div');
  const list = h('ul', { class: 'ledger', 'aria-label': t('overview.foundLabel') });
  page.append(ribbon, receipt, h('h2', null, t('overview.needsLook')), list);
  if (state.lastReceipt) receipt.append(state.lastReceipt);

  const healthP = checkHealth().catch(e => e);
  const startupP = (state.startup ? Promise.resolve(state.startup) : loadStartup()).catch(e => e);
  let scans;
  try { scans = await scan(); } catch (e) { if (alive()) fill(ribbon, errorBox(e, render)); return; }
  const rep = await healthP;
  if (!alive()) return;
  drawRibbon(ribbon, rep instanceof Error ? null : rep, scans, receipt);

  const items = [];
  if (!(rep instanceof Error)) {
    for (const f of rep.findings.filter(f => f.status === 'problem' || f.status === 'attention')) items.push(findingRow(f));
  }
  const st = await startupP;
  if (!alive()) return;
  if (Array.isArray(st)) {
    const on = st.filter(i => i.enabled).length;
    items.push(simpleRow(tn('overview.startup', on), t('overview.startup.sub'),
      h('a', { class: 'btn', href: '#/startup' }, t('overview.startup.button'))));
  }
  const b = scans['recycle-bin'];
  if (b && b.bytes > 0) {
    items.push(simpleRow(t('overview.bin', { size: bytes(b.bytes), bin: bin() }), t('overview.bin.sub'),
      h('a', { class: 'btn', href: '#/clean' }, t('overview.bin.button'))));
  }
  if (!items.length) items.push(h('li', { class: 'empty' }, t('overview.nothing')));
  fill(list, items);
};

function drawRibbon(box, rep, scans, receipt) {
  const ids = state.care.filter(id => scans[id] && scans[id].status === 'ready');
  const go = canGo(ids);
  const drives = rep ? rep.facts.drives || [] : [];
  const d = drives.find(x => /^c:\\$/i.test(x.path)) || drives[0];
  const parts = [];
  if (d && d.total > 0) {
    const used = d.total - d.free;
    const pct = v => Math.max(0, Math.min(100, v / d.total * 100));
    const usedEl = h('span', { class: 'used', title: t('overview.legend.inUse.short') });
    const goEl = h('span', { class: 'can-go' + (go ? '' : ' none'), title: t('overview.legend.canGo.short') });
    usedEl.style.width = pct(Math.max(0, used - go)) + '%';
    goEl.style.width = pct(Math.min(go, used)) + '%';
    parts.push(
      h('div', { class: 'ribbon', role: 'img', 'aria-label': t('overview.ribbon.label', { drive: d.path, used: bytes(used), go: bytes(go), free: bytes(d.free) }) },
        usedEl, goEl, h('span', { class: 'free' })),
      h('div', { class: 'legend' },
        h('span', null, h('i', { class: 'used' }), t('overview.legend.inUse', { size: bytes(Math.max(0, used - go)) })),
        h('span', null, h('i', { class: 'can-go' }), t('overview.legend.canGo', { size: bytes(go) })),
        h('span', null, h('i', { class: 'free' }), t('overview.legend.free', { free: bytes(d.free), total: bytes(d.total), drive: d.path }))));
  }
  const tidy = h('button', { class: 'btn primary', disabled: !go, onclick: () => tidyUp(tidy, ids, box, receipt) }, t('overview.tidy'));
  fill(box,
    h('div', { class: 'ribbon-head' },
      h('span', { class: 'big' }, bytes(go)),
      h('span', null, go ? t('overview.canGo') : t('overview.nothingToTidy'))),
    parts,
    h('div', { class: 'toolbar' }, tidy,
      h('a', { class: 'btn quiet', href: '#/clean' }, t('overview.seeWhat')),
      h('span', { class: 'muted small' }, tn('overview.covers', state.care.length))));
}

async function tidyUp(btn, ids, box, receipt) {
  btn.disabled = true;
  const w = working(t('progress.removing'));
  btn.after(w);
  try {
    const r = await runJob('clean', { ids }, p => w.set(tn('progress.removingCount', p.files || 0, { size: bytes(p.bytes || 0) })));
    state.lastReceipt = receiptFor(r.results);
    state.scanJob = null;
    state.healthJob = null;
    render();
  } catch (e) { w.remove(); btn.disabled = false; toast(e.message, 'error'); }
}

function receiptFor(results) {
  const freed = results.reduce((n, r) => n + r.freed, 0);
  const removed = results.reduce((n, r) => n + r.removed, 0);
  const skipped = results.reduce((n, r) => n + r.skipped, 0);
  const lines = results.filter(r => r.removed || r.status === 'in-use' || r.status === 'admin').map(r => {
    const c = cat(r.id) || { name: r.id };
    if (r.status === 'in-use') return t('receipt.inUse', { name: c.name, app: c.app });
    if (r.status === 'admin') return t('receipt.admin', { name: c.name });
    return t('receipt.line', { name: c.name, size: bytes(r.freed) });
  });
  return h('div', { class: 'receipt', role: 'status' },
    h('h3', null, removed ? t('receipt.freed', { size: bytes(freed) }) : t('receipt.nothing')),
    h('div', { class: 'muted small' }, tn('receipt.removed', removed) + (skipped ? ' ' + tn('receipt.skipped', skipped) : '') + ' ' + t('receipt.recorded')),
    lines.length ? h('ul', null, lines.map(l => h('li', null, l))) : null);
}

function simpleRow(title, sub, act) {
  return h('li', null, h('div', { class: 'row-main no-check' },
    h('div', { class: 'row-title' }, h('h3', null, title), h('div', { class: 'sub' }, sub)), h('span'), act));
}

function findingRow(f) {
  return h('li', { class: 'finding ' + f.status },
    h('div', null,
      h('div', { class: 'area' }, f.area),
      h('h3', null, f.title),
      h('div', { class: 'detail' }, f.detail),
      f.advice && f.status !== 'good' ? h('div', { class: 'advice' }, f.advice) : null),
    h('div', null, actionButton(f.action)));
}

// ---------------------------------------------------------------- clean up

const statusChip = (s, c) => ({
  ready: null,
  empty: h('span', { class: 'chip' }, t('clean.status.empty')),
  missing: h('span', { class: 'chip' }, c.group === 'browsers' ? t('clean.status.notInstalled') : t('clean.status.nothingHere')),
  'in-use': h('span', { class: 'chip warn' }, t('clean.status.inUse', { app: c.app })),
  admin: h('span', { class: 'chip warn' }, t('clean.status.admin')),
}[s.status]);

views.clean = async (page, alive) => {
  header(page, t('clean.title'), t('clean.lede'));
  const body = h('div', null, working(t('clean.measuring')));
  page.append(body);
  let scans;
  try { scans = await scan(); } catch (e) { if (alive()) fill(body, errorBox(e, render)); return; }
  if (!alive()) return;

  const chosen = new Set(state.categories.filter(c => scans[c.id] && scans[c.id].status === 'ready' && c.kind !== 'bin' && scans[c.id].bytes > 0).map(c => c.id));
  const total = h('strong');
  const go = h('button', { class: 'btn primary' }, t('clean.cleanSelected'));
  const refresh = () => {
    const sum = [...chosen].reduce((n, id) => n + (scans[id] ? scans[id].bytes : 0), 0);
    total.textContent = bytes(sum);
    go.disabled = chosen.size === 0;
  };
  const groups = [['system', isWin() ? 'clean.group.system' : 'clean.group.systemUnix'], ['browsers', 'clean.group.browsers'], ['bin', 'clean.group.bin']];
  const lists = groups.map(([g, label]) => {
    const cs = state.categories.filter(c => c.group === g);
    if (!cs.length) return null;
    return [h('div', { class: 'group-label' }, t(label)),
      h('ul', { class: 'ledger' }, cs.map(c => categoryRow(c, scans[c.id] || { status: 'missing', bytes: 0, files: 0 }, chosen, refresh)))];
  });
  go.addEventListener('click', async () => {
    const ids = [...chosen];
    if (ids.includes('recycle-bin') && !confirm(t('clean.confirmBin', { bin: bin() }))) return;
    go.disabled = true;
    const w = working(t('progress.removing'));
    fill(result, w);
    try {
      const r = await runJob('clean', { ids }, p => w.set(tn('progress.removingCount', p.files || 0, { size: bytes(p.bytes || 0) }) + (p.now ? ' (' + p.now + ')' : '')));
      state.lastReceipt = receiptFor(r.results);
      state.scanJob = null;
      state.healthJob = null;
      await scan();
      if (alive()) { render(); }
    } catch (e) { fill(result, errorBox(e)); go.disabled = false; }
  });
  const result = h('div');
  if (state.lastReceipt) result.append(state.lastReceipt);
  fill(body,
    h('div', { class: 'toolbar' }, go, h('span', null, t('ui.selected'), ' ', total),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn quiet', onclick: () => { state.scanJob = null; state.lastReceipt = null; render(); } }, t('clean.measureAgain'))),
    result, lists,
    isWin() ? h('div', { class: 'notice' },
      h('p', null, h('strong', null, t('clean.diskCleanup.title'))),
      h('p', null, t('clean.diskCleanup.text')),
      h('div', { class: 'toolbar' },
        h('button', { class: 'btn', onclick: () => action('open:diskcleanup') }, t('clean.diskCleanup.open')),
        h('button', { class: 'btn quiet', onclick: () => action('open:storagesense') }, t('clean.storageSense.open')))) : null);
  refresh();
};

function categoryRow(c, s, chosen, refresh) {
  const ready = s.status === 'ready' && (s.bytes > 0 || s.files > 0);
  const box = h('input', { type: 'checkbox', checked: chosen.has(c.id), disabled: !ready, 'aria-label': t('clean.include', { name: c.name }),
    onchange: e => { e.target.checked ? chosen.add(c.id) : chosen.delete(c.id); refresh(); } });
  const more = h('div', { class: 'row-more', hidden: true },
    h('dl', null,
      h('dt', null, t('clean.what')), h('dd', null, c.what),
      h('dt', null, t('clean.safe')), h('dd', null, c.safe),
      c.cost ? [h('dt', null, t('clean.cost')), h('dd', null, c.cost)] : null,
      c.minAgeDays ? [h('dt', null, t('clean.leftAlone')), h('dd', null, tn('clean.leftAlone.days', c.minAgeDays))] : null),
    s.largest && s.largest.length ? [h('p', null, t('clean.largest')),
      h('table', { class: 'files' }, h('tbody', null, s.largest.map(f => h('tr', null,
        h('td', { class: 'path' }, f.path), h('td', { class: 'size' }, bytes(f.size)),
        h('td', null, h('button', { class: 'btn quiet', onclick: () => action('reveal', f.path) }, t('ui.show')))))))] : null);
  const exp = h('button', { class: 'expander', 'aria-expanded': 'false', 'aria-label': t('clean.details', { name: c.name }),
    onclick: () => { more.hidden = !more.hidden; exp.setAttribute('aria-expanded', String(!more.hidden)); } }, icon('chevron'));
  return h('li', null,
    h('div', { class: 'row-main' }, box,
      h('div', { class: 'row-title' }, h('h3', null, c.name),
        h('div', { class: 'sub' }, s.files ? tn('unit.file', s.files) : c.what, ' ', statusChip(s, c))),
      h('span', { class: 'amount' + (s.bytes ? '' : ' zero') }, s.status === 'missing' ? '' : bytes(s.bytes)), exp),
    more);
}

// ---------------------------------------------------------------- large files and duplicates

async function folderPicker(onRun, label) {
  if (!state.folders) state.folders = await api('GET', '/api/local/folders');
  const input = h('input', { type: 'text', value: state.folders.home, 'aria-label': t('files.folder'), spellcheck: 'false' });
  const pick = h('select', { 'aria-label': t('files.commonFolders'), onchange: e => { input.value = e.target.value; } },
    state.folders.folders.map(f => h('option', { value: f.path }, folderLabel(f))));
  return { input, row: [pick, input, h('button', { class: 'btn primary', onclick: () => onRun(input.value.trim()) }, label)] };
}

// Folder names come from the server in English; known ones are translated.
function folderLabel(f) {
  const known = { 'Your files': 'files.folder.home', Downloads: 'files.folder.downloads', Desktop: 'files.folder.desktop',
    Documents: 'files.folder.documents', Pictures: 'files.folder.pictures', Videos: 'files.folder.videos', Music: 'files.folder.music' };
  if (Object.hasOwn(known, f.label)) return t(known[f.label]);
  if (f.label.startsWith('Drive ')) return t('files.folder.drive', { drive: f.label.slice(6) });
  return f.label;
}

views.large = async (page, alive) => {
  header(page, t('large.title'), t('large.lede'));
  const min = h('select', { 'aria-label': t('files.minSize') },
    [[100, 100 * 2 ** 20], [500, 500 * 2 ** 20], [1024, 2 ** 30], [50, 50 * 2 ** 20]].map(([v, b]) => h('option', { value: v }, t('files.andUp', { size: bytes(b) }))));
  const out = h('div');
  const picker = await folderPicker(root => search(root), t('large.find'));
  if (!alive()) return;
  page.append(h('div', { class: 'toolbar' }, picker.row, min), out);

  async function search(root) {
    const w = working(t('files.searching'));
    const stop = h('button', { class: 'btn quiet' }, t('ui.stop'));
    fill(out, h('div', { class: 'toolbar' }, w, stop));
    const job = runJob('large', { root, minMB: Number(min.value) }, p => w.set(tn('files.searchingCount', p.files || 0)));
    stop.onclick = () => job.cancel();
    try {
      const r = await job;
      if (alive()) showFiles(out, r.files, r.searched);
    } catch (e) { if (alive()) fill(out, e.code === 'stopped' ? h('p', { class: 'empty' }, t('files.stopped')) : errorBox(e)); }
  }
};

function showFiles(out, list, searched) {
  if (!list.length) { fill(out, h('p', { class: 'empty' }, tn('large.none', searched || 0))); return; }
  const chosen = new Set();
  const total = h('strong', null, bytes(0));
  const btn = h('button', { class: 'btn', disabled: true }, t('files.moveToBin', { bin: bin() }));
  const upd = () => {
    total.textContent = bytes(list.filter(f => chosen.has(f.path)).reduce((n, f) => n + f.size, 0));
    btn.disabled = !chosen.size;
  };
  btn.onclick = () => recycle([...chosen], () => showFiles(out, list.filter(f => !chosen.has(f.path)), searched));
  fill(out,
    h('div', { class: 'toolbar' }, btn, h('span', null, t('ui.selected'), ' ', total), h('span', { class: 'grow' }),
      h('span', { class: 'muted small' }, tn('large.shown', list.length))),
    h('table', { class: 'files' },
      h('thead', null, h('tr', null, h('th', null, h('span', { class: 'sr' }, t('files.col.select'))), h('th', null, t('files.col.file')),
        h('th', null, t('files.col.changed')), h('th', null, t('files.col.size')), h('th', null, h('span', { class: 'sr' }, t('ui.show'))))),
      h('tbody', null, list.map(f => h('tr', null,
        h('td', null, h('input', { type: 'checkbox', 'aria-label': t('files.select', { path: f.path }), onchange: e => { e.target.checked ? chosen.add(f.path) : chosen.delete(f.path); upd(); } })),
        h('td', { class: 'path' }, f.path),
        h('td', { class: 'date' }, day(f.modified)),
        h('td', { class: 'size' }, bytes(f.size)),
        h('td', null, h('button', { class: 'btn quiet', onclick: () => action('reveal', f.path) }, t('ui.show'))))))));
}

async function recycle(paths, after) {
  try {
    const r = await runJob('recycle', { paths });
    const ok = r.results.filter(x => x.ok).length;
    const bad = r.results.filter(x => !x.ok);
    toast(tn('files.moved', ok, { size: bytes(r.bytes), bin: bin() }) + (bad.length ? ' ' + tn('files.notMoved', bad.length, { reason: bad[0].message }) : ''), bad.length ? 'error' : '');
    state.scanJob = null;
    after();
  } catch (e) { toast(e.message, 'error'); }
}

views.dupes = async (page, alive) => {
  header(page, t('dupes.title'), t('dupes.lede'));
  const min = h('select', { 'aria-label': t('files.minSize') },
    [[1024, 2 ** 20], [100, 100 * 2 ** 10], [10240, 10 * 2 ** 20], [102400, 100 * 2 ** 20]].map(([v, b]) => h('option', { value: v }, t('files.andUp', { size: bytes(b) }))));
  const out = h('div');
  const picker = await folderPicker(root => search(root), t('dupes.find'));
  if (!alive()) return;
  page.append(h('div', { class: 'toolbar' }, picker.row, min), out);

  async function search(root) {
    const w = working(t('dupes.comparing'));
    const stop = h('button', { class: 'btn quiet' }, t('ui.stop'));
    fill(out, h('div', { class: 'toolbar' }, w, stop));
    const job = runJob('dupes', { root, minKB: Number(min.value) }, p => w.set(tn('dupes.comparingCount', p.files || 0)));
    stop.onclick = () => job.cancel();
    try {
      const r = await job;
      if (alive()) showDupes(out, r.groups, r.searched);
    } catch (e) { if (alive()) fill(out, e.code === 'stopped' ? h('p', { class: 'empty' }, t('files.stopped')) : errorBox(e)); }
  }
};

function showDupes(out, groups, searched) {
  if (!groups.length) { fill(out, h('p', { class: 'empty' }, tn('dupes.none', searched || 0))); return; }
  const chosen = new Set();
  for (const g of groups) g.files.slice(1).forEach(f => chosen.add(f.path));
  const total = h('strong');
  const btn = h('button', { class: 'btn' }, t('dupes.move', { bin: bin() }));
  const sizeOf = new Map(groups.flatMap(g => g.files.map(f => [f.path, g.size])));
  const upd = () => {
    total.textContent = bytes([...chosen].reduce((n, p) => n + (sizeOf.get(p) || 0), 0));
    btn.disabled = !chosen.size;
  };
  btn.onclick = () => {
    // Never let every copy of a file go.
    const all = groups.find(g => g.files.every(f => chosen.has(f.path)));
    if (all) { toast(t('dupes.keepOne', { path: all.files[0].path }), 'error'); return; }
    recycle([...chosen], () => showDupes(out, groups.map(g => ({ ...g, files: g.files.filter(f => !chosen.has(f.path)) })).filter(g => g.files.length > 1), searched));
  };
  const wasted = groups.reduce((n, g) => n + g.wasted, 0);
  fill(out,
    h('div', { class: 'toolbar' }, btn, h('span', null, t('ui.selected'), ' ', total), h('span', { class: 'grow' }),
      h('span', { class: 'muted small' }, tn('dupes.summary', groups.length, { size: bytes(wasted) }))),
    groups.map(g => h('section', { class: 'dup' },
      h('header', null, h('h3', null, tn('dupes.group', g.files.length, { size: bytes(g.size) })), h('span', { class: 'muted small' }, t('dupes.extra', { size: bytes(g.wasted) }))),
      h('table', { class: 'files' }, h('tbody', null, g.files.map((f, i) => {
        const tr = h('tr', { class: chosen.has(f.path) ? '' : 'keep' },
          h('td', null, h('input', { type: 'checkbox', checked: chosen.has(f.path), 'aria-label': t('dupes.moveOne', { path: f.path }),
            onchange: e => { e.target.checked ? chosen.add(f.path) : chosen.delete(f.path); tr.className = e.target.checked ? '' : 'keep'; upd(); } })),
          h('td', { class: 'path' }, f.path, i === 0 ? [' ', h('span', { class: 'chip good' }, t('dupes.oldest'))] : null),
          h('td', { class: 'date' }, day(f.modified)),
          h('td', null, h('button', { class: 'btn quiet', onclick: () => action('reveal', f.path) }, t('ui.show'))));
        return tr;
      }))))));
  upd();
}

// ---------------------------------------------------------------- startup

views.startup = async (page, alive) => {
  header(page, t('startup.title'), isWin() ? t('startup.lede') : t('startup.lede.unix'));
  const body = h('div', null, working(t('startup.reading')));
  page.append(body);
  const items = await loadStartup();
  if (!alive()) return;
  if (!items.length) { fill(body, h('p', { class: 'empty' }, t('startup.none'))); return; }
  fill(body,
    h('ul', { class: 'ledger' }, items.map(it => {
      const sw = h('input', { type: 'checkbox', class: 'switch', checked: it.enabled, 'aria-label': t(it.enabled ? 'startup.turnOff' : 'startup.turnOn', { name: it.name }),
        disabled: it.admin && !state.mode.elevated,
        onchange: async e => {
          sw.disabled = true;
          try {
            const r = await api('POST', '/api/local/startup', { id: it.id, enabled: e.target.checked });
            it.enabled = r.enabled;
            toast(t(r.enabled ? 'startup.willStart' : 'startup.willNotStart', { name: it.name }));
            updateNav();
          } catch (err) { e.target.checked = !e.target.checked; toast(err.message, 'error'); }
          sw.disabled = false;
        } });
      return h('li', null, h('div', { class: 'row-main' }, sw,
        h('div', { class: 'row-title' }, h('h3', null, it.name),
          h('div', { class: 'sub', title: it.command }, [it.publisher, it.where].filter(Boolean).join(', '),
            it.missing ? [' ', h('span', { class: 'chip warn' }, t('startup.missing'))] : null,
            it.admin && !state.mode.elevated ? [' ', h('span', { class: 'chip' }, t('startup.allUsers'))] : null)),
        h('span'), h('span', { class: 'muted small' }, t(it.enabled ? 'ui.on' : 'ui.off'))));
    })),
    h('p', { class: 'muted small' }, t('startup.note') + (isWin() ? ' ' + t('startup.note.win') : '')));
};

// ---------------------------------------------------------------- app updates

views.updates = async (page, alive) => {
  header(page, t('updates.title'), t('updates.lede'));
  const out = h('div');
  page.append(out);
  if (!feat('winget')) {
    out.append(h('div', { class: 'notice warn' }, h('p', null, t('updates.noWinget'))));
    return;
  }
  const check = async () => {
    fill(out, working(t('updates.checking')));
    try {
      const r = await runJob('updates');
      state.updates = r.updates || [];
      updateNav();
      if (alive()) showUpdates(out, check);
    } catch (e) { if (alive()) fill(out, errorBox(e, check)); }
  };
  if (state.updates) showUpdates(out, check); else check();
};

function showUpdates(out, check) {
  const ups = state.updates;
  if (!ups.length) { fill(out, h('p', { class: 'empty' }, t('updates.none')), h('button', { class: 'btn', onclick: check }, t('ui.checkAgain'))); return; }
  const chosen = new Set(ups.filter(u => !u.truncated).map(u => u.id));
  const btn = h('button', { class: 'btn primary' }, t('updates.updateSelected'));
  const result = h('div');
  btn.onclick = async () => {
    btn.disabled = true;
    const w = working(t('updates.updating'));
    fill(result, w);
    try {
      const r = await runJob('upgrade', { ids: [...chosen] }, p => w.set(t('updates.progress', { name: p.now || '', done: num(p.files || 0), total: num(chosen.size) })));
      const ok = r.results.filter(x => x.ok);
      fill(result, h('div', { class: 'receipt' }, h('h3', null, tn('updates.updated', ok.length)),
        h('ul', null, r.results.map(x => h('li', null, x.ok ? t('updates.line.ok', { id: x.id }) : t('updates.line.failed', { id: x.id, reason: (x.message || '').split('\n').pop() }))))));
      state.updates = ups.filter(u => !ok.some(x => x.id === u.id));
      updateNav();
    } catch (e) { fill(result, errorBox(e)); }
    btn.disabled = false;
  };
  fill(out, h('div', { class: 'toolbar' }, btn, h('button', { class: 'btn quiet', onclick: check }, t('ui.checkAgain'))), result,
    h('ul', { class: 'ledger' }, ups.map(u => h('li', null, h('div', { class: 'row-main' },
      h('input', { type: 'checkbox', checked: chosen.has(u.id), disabled: u.truncated, 'aria-label': t('updates.update', { name: u.name }),
        onchange: e => { e.target.checked ? chosen.add(u.id) : chosen.delete(u.id); btn.disabled = !chosen.size; } }),
      h('div', { class: 'row-title' }, h('h3', null, u.name), h('div', { class: 'sub' }, u.id,
        u.truncated ? [' ', h('span', { class: 'chip' }, t('updates.truncated'))] : null)),
      h('span', { class: 'muted' }, u.version), h('span', { class: 'amount' }, u.available))))));
}

// ---------------------------------------------------------------- health

views.health = async (page, alive) => {
  header(page, t('health.title'), t('health.lede'));
  const body = h('div', null, working(t('health.running')));
  const again = h('button', { class: 'btn quiet', onclick: () => { state.healthJob = null; render(); } }, t('ui.checkAgain'));
  page.append(h('div', { class: 'toolbar' }, again), body);
  const rep = await checkHealth();
  if (!alive()) return;
  const procs = rep.facts.procs || [];
  fill(body,
    h('ul', { class: 'ledger' }, rep.findings.map(findingRow)),
    procs.length ? [h('h2', null, t('health.memoryTitle')),
      h('table', { class: 'files' }, h('tbody', null, procs.map(p => h('tr', null,
        h('td', null, p.name, p.count > 1 ? h('span', { class: 'muted' }, ' ' + tn('health.processes', p.count)) : null),
        h('td', { class: 'size' }, bytes(p.mem)))))),
      h('p', { class: 'muted small' }, t('health.memoryNote'))] : null,
    h('p', { class: 'muted small' }, t('health.checked', { when: when(new Date().toISOString()) })));
};

// ---------------------------------------------------------------- privacy

views.privacy = async (page, alive) => {
  header(page, t('privacy.title'), t('privacy.lede'));
  const body = h('div', null, working(t('privacy.reading')));
  page.append(body);
  const r = await api('GET', '/api/local/privacy');
  if (!alive()) return;
  fill(body, h('ul', { class: 'ledger' }, r.settings.map(s => {
    const sw = h('input', { type: 'checkbox', class: 'switch', checked: s.on, 'aria-label': s.title,
      onchange: async e => {
        sw.disabled = true;
        try {
          const x = await api('POST', '/api/local/privacy', { id: s.id, on: e.target.checked });
          toast(t(x.on ? 'privacy.isOn' : 'privacy.isOff', { name: x.title }));
        } catch (err) { e.target.checked = !e.target.checked; toast(err.message, 'error'); }
        sw.disabled = false;
      } });
    return h('li', null, h('div', { class: 'row-main' }, sw,
      h('div', { class: 'row-title' }, h('h3', null, s.title), h('div', { class: 'sub' }, s.what)),
      h('span'),
      s.settings ? h('button', { class: 'btn quiet', onclick: () => action('settings:' + s.settings) }, t('privacy.openSettings')) : h('span')));
  })), h('p', { class: 'muted small' }, t('privacy.note')));
};

// ---------------------------------------------------------------- automatic care

const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

views.care = async (page, alive) => {
  header(page, t('care.title'), t('care.lede'));
  const settings = await api('GET', '/api/local/settings');
  if (!alive()) return;
  const chosen = new Set(settings.careCategories);
  const saveKinds = async () => {
    try {
      const r = await api('PUT', '/api/local/settings', { careCategories: [...chosen] });
      state.care = r.careCategories;
      toast(t('care.saved'));
    } catch (e) { toast(e.message, 'error'); }
  };
  const kinds = h('ul', { class: 'ledger' }, state.categories.filter(c => c.kind !== 'bin').map(c => h('li', null,
    h('label', { class: 'row-main no-check check' },
      h('span', { class: 'row-title' }, h('h3', null, c.name), h('span', { class: 'sub' }, c.admin ? t('care.adminOnly') : c.what)),
      h('span'),
      h('input', { type: 'checkbox', checked: chosen.has(c.id), onchange: e => { e.target.checked ? chosen.add(c.id) : chosen.delete(c.id); saveKinds(); } })))));

  const plan = h('div');
  page.append(h('h2', null, t('care.when')), plan, h('h2', null, t('care.whatTitle')),
    h('p', { class: 'muted' }, t('care.whatNote', { bin: bin() })), kinds);

  if (!feat('schedule')) {
    plan.append(h('div', { class: 'notice' }, h('p', null, t('care.cron')),
      h('p', null, h('code', null, '0 11 * * 0 kempt care'))));
    return;
  }
  plan.append(working(t('care.reading')));
  let p;
  try { p = await api('GET', '/api/local/schedule'); } catch (e) { if (alive()) fill(plan, errorBox(e)); return; }
  if (!alive()) return;
  const on = h('input', { type: 'checkbox', class: 'switch', checked: p.enabled, 'aria-label': t('care.title') });
  const freq = h('select', null,
    h('option', { value: 'weekly', selected: p.frequency !== 'daily' }, t('care.weekly')),
    h('option', { value: 'daily', selected: p.frequency === 'daily' }, t('care.daily')));
  const dayEl = h('select', null, weekdays.map(d => h('option', { value: d, selected: (p.day || 'Sunday') === d }, t('day.' + d.toLowerCase()))));
  const time = h('input', { type: 'text', value: p.time || '11:00', 'aria-label': t('care.time'), inputmode: 'numeric', pattern: '[0-2][0-9]:[0-5][0-9]' });
  const save = h('button', { class: 'btn primary' }, t('ui.save'));
  const sync = () => { dayEl.disabled = freq.value === 'daily' || !on.checked; freq.disabled = time.disabled = !on.checked; };
  on.onchange = freq.onchange = sync;
  save.onclick = async () => {
    save.disabled = true;
    try {
      const r = await api('PUT', '/api/local/schedule', { enabled: on.checked, frequency: freq.value, day: dayEl.value, time: time.value.trim() });
      toast(r.enabled ? t('care.isOn') + (r.nextRun ? ' ' + t('care.nextRun', { when: when(r.nextRun) }) + '.' : '') : t('care.isOff'));
      render();
    } catch (e) { toast(e.message, 'error'); save.disabled = false; }
  };
  fill(plan,
    h('div', { class: 'form-grid' },
      h('label', null, t('care.title')), h('div', null, on),
      h('label', null, t('care.howOften')), freq,
      h('label', null, t('care.day')), dayEl,
      h('label', null, t('care.time')), time),
    h('div', { class: 'toolbar' }, save,
      p.nextRun ? h('span', { class: 'muted small' }, t('care.nextRun', { when: when(p.nextRun) })) : null,
      p.lastRun ? h('span', { class: 'muted small' }, t('care.lastRun', { when: when(p.lastRun) })) : null),
    p.enabled ? h('p', { class: 'muted small' }, t('care.moved')) : null);
  sync();
};

// ---------------------------------------------------------------- settings

views.settings = async (page, alive) => {
  header(page, t('settings.title'), t('settings.lede'));
  const body = h('div', null, working(t('settings.reading')));
  page.append(body);
  let st = await api('GET', '/api/local/app');
  if (!alive()) return;
  const startName = isWin() ? t('settings.startup.win') : t('settings.startup.unix');
  const draw = () => {
    const change = async (key, value, sw) => {
      sw.disabled = true;
      try {
        st = await api('PUT', '/api/local/app', { [key]: value });
        toast(key === 'startup'
          ? t(st.startup ? 'settings.startup.on' : 'settings.startup.off')
          : t(st.minimized ? 'settings.minimized.on' : 'settings.minimized.off'));
      } catch (e) { toast(e.message, 'error'); }
      if (alive()) draw();
    };
    const startup = h('input', { type: 'checkbox', class: 'switch', checked: st.startup, 'aria-label': startName,
      onchange: e => change('startup', e.target.checked, e.target) });
    const mini = h('input', { type: 'checkbox', class: 'switch', checked: st.minimized, 'aria-label': t('settings.minimized'),
      disabled: !st.minimizedSupported || !st.startup,
      onchange: e => change('minimized', e.target.checked, e.target) });
    fill(body, h('ul', { class: 'ledger' },
      h('li', null, h('div', { class: 'row-main' }, startup,
        h('div', { class: 'row-title' }, h('h3', null, startName),
          h('div', { class: 'sub' }, isWin() ? t('settings.startup.sub.win') : t('settings.startup.sub.unix'))),
        h('span'), h('span', { class: 'muted small' }, t(st.startup ? 'ui.on' : 'ui.off')))),
      h('li', null, h('div', { class: 'row-main' }, mini,
        h('div', { class: 'row-title' }, h('h3', null, t('settings.minimized')),
          h('div', { class: 'sub' }, !st.minimizedSupported
            ? t('settings.minimized.windowsOnly')
            : t('settings.minimized.sub') + (st.startup ? '' : ' ' + t('settings.minimized.needsStartup')))),
        h('span'), h('span', { class: 'muted small' }, t(st.minimized ? 'ui.on' : 'ui.off'))))),
      h('h2', null, t('settings.language')),
      languagePicker(),
      h('p', { class: 'muted small' }, t('settings.note')));
  };
  draw();
};

// ---------------------------------------------------------------- history

views.history = async (page, alive) => {
  header(page, t('history.title'), t('history.lede'));
  const r = await api('GET', '/api/local/journal');
  if (!alive()) return;
  if (!r.entries.length) { page.append(h('p', { class: 'empty' }, t('history.empty'))); return; }
  page.append(h('div', null, r.entries.map(e => h('div', { class: 'entry' + (e.undone ? ' undone' : '') },
    h('time', { datetime: e.time }, when(e.time)),
    h('div', null, h('div', { class: 'what' }, e.summary, e.auto ? [' ', h('span', { class: 'chip' }, t('history.auto'))] : null),
      e.details && e.details.length ? h('ul', null, e.details.slice(0, 8).map(d => h('li', null, d)), e.details.length > 8 ? h('li', null, tn('history.more', e.details.length - 8)) : null) : null),
    e.undo && !e.undone ? h('button', { class: 'btn', onclick: async ev => {
      ev.target.disabled = true;
      try { await api('POST', '/api/local/undo', { id: e.id }); state.startup = null; toast(t('history.undone')); render(); }
      catch (err) { toast(err.message, 'error'); ev.target.disabled = false; }
    } }, t('history.undo')) : h('span')))));
};

// ---------------------------------------------------------------- honest notes

views.why = page => {
  header(page, t('why.title'), t('why.lede'));
  const notes = ['registry', 'ram', 'internet', 'drivers', 'score', 'antivirus', 'background'];
  page.append(h('ul', { class: 'why' }, notes.map(n => h('li', null, h('h3', null, t('why.' + n + '.title')), h('p', null, t('why.' + n + '.text'))))));
};

// ---------------------------------------------------------------- language

// Language names are written in their own language so anyone can find theirs.
const languageNames = { en: 'English', id: 'Bahasa Indonesia' };

function languagePicker() {
  const langs = (state.mode && state.mode.languages) || ['en', 'id'];
  return h('div', { class: 'lang', role: 'group', 'aria-label': t('settings.language') },
    langs.map(l => h('button', { class: 'btn' + (l === currentLang() ? ' primary' : ''), lang: l, 'aria-pressed': String(l === currentLang()),
      onclick: async () => {
        if (l === currentLang()) return;
        try { await api('PUT', '/api/local/app', { lang: l }); location.reload(); }
        catch (e) { toast(e.message, 'error'); }
      } }, languageNames[l] || l)));
}

// ---------------------------------------------------------------- start

async function start() {
  try {
    state.mode = await api('GET', '/api/mode');
    await loadLang(state.mode.lang);
    const c = await api('GET', '/api/local/categories');
    state.categories = c.categories;
    state.care = c.care;
  } catch (e) {
    fill(main, h('div', { class: 'page' }, h('h1', null, t('app.notConnected')), errorBox(e)));
    return;
  }
  document.title = 'Kempt';
  nav.setAttribute('aria-label', t('nav.label'));
  const foot = document.getElementById('foot');
  fill(foot,
    state.mode.elevated ? h('span', null, t('app.elevated')) : null,
    feat('elevate') ? h('button', { class: 'btn', onclick: async () => {
      try { await api('POST', '/api/local/elevate'); fill(main, h('div', { class: 'page' }, h('h1', null, t('app.restarting')), h('p', { class: 'lede' }, t('app.restarting.text')))); }
      catch (e) { toast(e.message, 'error'); }
    } }, t('app.restartAdmin')) : null,
    languagePicker(),
    h('div', { class: 'row' },
      h('span', null, 'Kempt ' + state.mode.version),
      h('button', { class: 'btn quiet', onclick: async () => { await api('POST', '/api/local/quit').catch(() => {}); window.close(); fill(main, h('div', { class: 'page' }, h('h1', null, t('app.closed')))); } }, t('app.close'))));
  window.addEventListener('hashchange', render);
  setInterval(() => api('POST', '/api/local/heartbeat').catch(() => {}), 30000);
  render();
}

start();

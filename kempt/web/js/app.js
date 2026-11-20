import { h, fill, icon, bytes, plural, when, day, toast, api, runJob, working, errorBox } from './ui.js';

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
const binName = () => (isWin() ? 'Recycle Bin' : 'trash');

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
  { id: 'overview', title: 'Overview' },
  { id: 'clean', title: 'Clean up' },
  { id: 'large', title: 'Large files' },
  { id: 'dupes', title: 'Duplicates' },
  { sep: true },
  { id: 'startup', title: 'Startup' },
  { id: 'updates', title: 'App updates', when: () => feat('updates') },
  { id: 'health', title: 'Health' },
  { id: 'privacy', title: 'Privacy', when: () => feat('privacy') },
  { sep: true },
  { id: 'care', title: 'Automatic care' },
  { id: 'history', title: 'History' },
  { id: 'settings', title: 'Settings', when: () => feat('autostart') },
  { id: 'why', title: 'What Kempt won’t do' },
];

function badge(id) {
  if (id === 'clean' && state.scans) { const n = canGo(); return n ? bytes(n) : ''; }
  if (id === 'startup' && state.startup) return String(state.startup.filter(i => i.enabled).length);
  if (id === 'health' && state.health) {
    const n = state.health.findings.filter(f => f.status === 'problem' || f.status === 'attention').length;
    return n ? String(n) : '';
  }
  if (id === 'updates' && state.updates) return state.updates.length ? String(state.updates.length) : '';
  return '';
}

function updateNav() {
  const cur = route();
  fill(nav, pages.filter(p => !p.when || p.when()).map(p => p.sep ? h('hr') :
    h('a', { href: '#/' + p.id, 'aria-current': p.id === cur ? 'page' : false },
      h('span', null, p.title), h('small', null, badge(p.id)))));
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
  header(page, 'Your PC, as it is', 'Kempt measures, explains what it found and changes nothing until you say so.');
  const ribbon = h('section', { class: 'ribbon-wrap', 'aria-label': 'System drive' }, working('Measuring caches and leftovers…'));
  const receipt = h('div');
  const list = h('ul', { class: 'ledger', 'aria-label': 'What Kempt found' });
  page.append(ribbon, receipt, h('h2', null, 'What needs a look'), list);
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
    items.push(simpleRow(plural(on, 'program') + ' start when you sign in',
      'Each one adds to the wait before your desktop is ready. Turn off the ones you do not need right away.',
      h('a', { class: 'btn', href: '#/startup' }, 'Review startup')));
  }
  const bin = scans['recycle-bin'];
  if (bin && bin.bytes > 0) {
    items.push(simpleRow(`${bytes(bin.bytes)} in the ${binName()}`,
      'Kempt never empties it on its own. Empty it when you are sure you will not want those files back.',
      h('a', { class: 'btn', href: '#/clean' }, 'Review')));
  }
  if (!items.length) items.push(h('li', { class: 'empty' }, 'Nothing needs your attention right now.'));
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
    const usedEl = h('span', { class: 'used', title: 'In use' });
    const goEl = h('span', { class: 'can-go' + (go ? '' : ' none'), title: 'Can go' });
    usedEl.style.width = pct(Math.max(0, used - go)) + '%';
    goEl.style.width = pct(Math.min(go, used)) + '%';
    parts.push(
      h('div', { class: 'ribbon', role: 'img', 'aria-label': `Drive ${d.path}: ${bytes(used)} used, ${bytes(go)} of it can go, ${bytes(d.free)} free` },
        usedEl, goEl, h('span', { class: 'free' })),
      h('div', { class: 'legend' },
        h('span', null, h('i', { class: 'used' }), `In use ${bytes(Math.max(0, used - go))}`),
        h('span', null, h('i', { class: 'can-go' }), `Can go ${bytes(go)}`),
        h('span', null, h('i', { class: 'free' }), `Free ${bytes(d.free)} of ${bytes(d.total)} on ${d.path}`)));
  }
  const tidy = h('button', { class: 'btn primary', disabled: !go, onclick: () => tidyUp(tidy, ids, box, receipt) }, 'Tidy up');
  fill(box,
    h('div', { class: 'ribbon-head' },
      h('span', { class: 'big' }, bytes(go)),
      h('span', null, go ? 'of caches and leftovers can go without losing anything you made.' : 'Nothing to tidy right now.')),
    parts,
    h('div', { class: 'toolbar' }, tidy,
      h('a', { class: 'btn quiet', href: '#/clean' }, 'See what this includes'),
      h('span', { class: 'muted small' }, `Covers ${plural(state.care.length, 'kind')} of files, chosen in Automatic care.`)));
}

async function tidyUp(btn, ids, box, receipt) {
  btn.disabled = true;
  const w = working('Removing files…');
  btn.after(w);
  try {
    const r = await runJob('clean', { ids }, p => w.set(`Removing files… ${plural(p.files || 0, 'file')}, ${bytes(p.bytes || 0)}`));
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
    if (r.status === 'in-use') return `${c.name}: skipped, close ${c.app} first`;
    if (r.status === 'admin') return `${c.name}: skipped, needs administrator`;
    return `${c.name}: ${bytes(r.freed)}`;
  });
  return h('div', { class: 'receipt', role: 'status' },
    h('h3', null, removed ? `Freed ${bytes(freed)}` : 'Nothing was removed'),
    h('div', { class: 'muted small' }, `${plural(removed, 'file')} removed` + (skipped ? `, ${plural(skipped, 'file')} left because a program was using them` : '') + '. Recorded in History.'),
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
  empty: h('span', { class: 'chip' }, 'Nothing to remove'),
  missing: h('span', { class: 'chip' }, c.group === 'browsers' ? 'Not installed' : 'Nothing here'),
  'in-use': h('span', { class: 'chip warn' }, `Close ${c.app} first`),
  admin: h('span', { class: 'chip warn' }, 'Needs administrator'),
}[s.status]);

views.clean = async (page, alive) => {
  header(page, 'Clean up', 'Caches and leftovers that programs recreate on their own. Your documents, photos, passwords, cookies and browsing history are never part of this.');
  const body = h('div', null, working('Measuring…'));
  page.append(body);
  let scans;
  try { scans = await scan(); } catch (e) { if (alive()) fill(body, errorBox(e, render)); return; }
  if (!alive()) return;

  const chosen = new Set(state.categories.filter(c => scans[c.id] && scans[c.id].status === 'ready' && c.kind !== 'bin' && scans[c.id].bytes > 0).map(c => c.id));
  const total = h('strong');
  const go = h('button', { class: 'btn primary' }, 'Clean selected');
  const refresh = () => {
    const sum = [...chosen].reduce((n, id) => n + (scans[id] ? scans[id].bytes : 0), 0);
    total.textContent = bytes(sum);
    go.disabled = chosen.size === 0;
  };
  const groups = [['system', 'Windows and programs'], ['browsers', 'Browser caches'], ['bin', 'Deleted files']];
  const lists = groups.map(([g, label]) => {
    const cs = state.categories.filter(c => c.group === g);
    if (!cs.length) return null;
    return [h('div', { class: 'group-label' }, g === 'system' && !isWin() ? 'System and programs' : label),
      h('ul', { class: 'ledger' }, cs.map(c => categoryRow(c, scans[c.id] || { status: 'missing', bytes: 0, files: 0 }, chosen, refresh)))];
  });
  go.addEventListener('click', async () => {
    const ids = [...chosen];
    if (ids.includes('recycle-bin') && !confirm(`Empty the ${binName()}? Files in it cannot be restored afterwards.`)) return;
    go.disabled = true;
    const w = working('Removing files…');
    fill(result, w);
    try {
      const r = await runJob('clean', { ids }, p => w.set(`Removing files… ${plural(p.files || 0, 'file')}, ${bytes(p.bytes || 0)}${p.now ? ' (' + p.now + ')' : ''}`));
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
    h('div', { class: 'toolbar' }, go, h('span', null, 'Selected: ', total),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn quiet', onclick: () => { state.scanJob = null; state.lastReceipt = null; render(); } }, 'Measure again')),
    result, lists,
    isWin() ? h('div', { class: 'notice' },
      h('p', null, h('strong', null, 'Windows Update leftovers and old Windows versions')),
      h('p', null, 'Windows’ own Disk Cleanup knows which of these are safe to remove. Choose “Clean up system files” there.'),
      h('div', { class: 'toolbar' },
        h('button', { class: 'btn', onclick: () => action('open:diskcleanup') }, 'Open Disk Cleanup'),
        h('button', { class: 'btn quiet', onclick: () => action('open:storagesense') }, 'Storage Sense settings'))) : null);
  refresh();
};

function categoryRow(c, s, chosen, refresh) {
  const ready = s.status === 'ready' && (s.bytes > 0 || s.files > 0);
  const box = h('input', { type: 'checkbox', checked: chosen.has(c.id), disabled: !ready, 'aria-label': 'Include ' + c.name,
    onchange: e => { e.target.checked ? chosen.add(c.id) : chosen.delete(c.id); refresh(); } });
  const more = h('div', { class: 'row-more', hidden: true },
    h('dl', null,
      h('dt', null, 'What it is'), h('dd', null, c.what),
      h('dt', null, 'Why it is safe'), h('dd', null, c.safe),
      c.cost ? [h('dt', null, 'What you give up'), h('dd', null, c.cost)] : null,
      c.minAgeDays ? [h('dt', null, 'Left alone'), h('dd', null, `Files changed in the last ${plural(c.minAgeDays, 'day')}.`)] : null),
    s.largest && s.largest.length ? [h('p', null, 'Largest files:'),
      h('table', { class: 'files' }, h('tbody', null, s.largest.map(f => h('tr', null,
        h('td', { class: 'path' }, f.path), h('td', { class: 'size' }, bytes(f.size)),
        h('td', null, h('button', { class: 'btn quiet', onclick: () => action('reveal', f.path) }, 'Show'))))))] : null);
  const exp = h('button', { class: 'expander', 'aria-expanded': 'false', 'aria-label': 'Details for ' + c.name,
    onclick: () => { more.hidden = !more.hidden; exp.setAttribute('aria-expanded', String(!more.hidden)); } }, icon('chevron'));
  return h('li', null,
    h('div', { class: 'row-main' }, box,
      h('div', { class: 'row-title' }, h('h3', null, c.name),
        h('div', { class: 'sub' }, s.files ? plural(s.files, 'file') : c.what, ' ', statusChip(s, c))),
      h('span', { class: 'amount' + (s.bytes ? '' : ' zero') }, s.status === 'missing' ? '' : bytes(s.bytes)), exp),
    more);
}

// ---------------------------------------------------------------- large files and duplicates

async function folderPicker(onRun, label) {
  if (!state.folders) state.folders = await api('GET', '/api/local/folders');
  const input = h('input', { type: 'text', value: state.folders.home, 'aria-label': 'Folder to search', spellcheck: 'false' });
  const pick = h('select', { 'aria-label': 'Common folders', onchange: e => { input.value = e.target.value; } },
    state.folders.folders.map(f => h('option', { value: f.path }, f.label)));
  return { input, row: [pick, input, h('button', { class: 'btn primary', onclick: () => onRun(input.value.trim()) }, label)] };
}

views.large = async (page, alive) => {
  header(page, 'Large files', 'The biggest files in a folder, so you can decide what you still need. Programs, Windows and app data are left out of the search.');
  const min = h('select', { 'aria-label': 'Smallest size' },
    [[100, '100 MB and up'], [500, '500 MB and up'], [1024, '1 GB and up'], [50, '50 MB and up']].map(([v, t]) => h('option', { value: v }, t)));
  const out = h('div');
  const picker = await folderPicker(root => search(root), 'Find large files');
  if (!alive()) return;
  page.append(h('div', { class: 'toolbar' }, picker.row, min), out);

  async function search(root) {
    const w = working('Searching…');
    const stop = h('button', { class: 'btn quiet' }, 'Stop');
    fill(out, h('div', { class: 'toolbar' }, w, stop));
    const job = runJob('large', { root, minMB: Number(min.value) }, p => w.set(`Searching… ${plural(p.files || 0, 'file')} looked at`));
    stop.onclick = () => job.cancel();
    try {
      const r = await job;
      if (alive()) showFiles(out, r.files, r.searched);
    } catch (e) { if (alive()) fill(out, e.code === 'stopped' ? h('p', { class: 'empty' }, 'Search stopped.') : errorBox(e)); }
  }
};

function showFiles(out, list, searched) {
  if (!list.length) { fill(out, h('p', { class: 'empty' }, `No files that large among ${plural(searched || 0, 'file')}.`)); return; }
  const chosen = new Set();
  const total = h('strong', null, '0 MB');
  const btn = h('button', { class: 'btn', disabled: true }, `Move to ${binName()}`);
  const upd = () => {
    total.textContent = bytes(list.filter(f => chosen.has(f.path)).reduce((n, f) => n + f.size, 0));
    btn.disabled = !chosen.size;
  };
  btn.onclick = () => recycle([...chosen], () => showFiles(out, list.filter(f => !chosen.has(f.path)), searched));
  fill(out,
    h('div', { class: 'toolbar' }, btn, h('span', null, 'Selected: ', total), h('span', { class: 'grow' }),
      h('span', { class: 'muted small' }, `${plural(list.length, 'file')} shown, largest first`)),
    h('table', { class: 'files' },
      h('thead', null, h('tr', null, h('th', null, h('span', { class: 'sr' }, 'Select')), h('th', null, 'File'), h('th', null, 'Changed'), h('th', null, 'Size'), h('th', null, h('span', { class: 'sr' }, 'Show')))),
      h('tbody', null, list.map(f => h('tr', null,
        h('td', null, h('input', { type: 'checkbox', 'aria-label': 'Select ' + f.path, onchange: e => { e.target.checked ? chosen.add(f.path) : chosen.delete(f.path); upd(); } })),
        h('td', { class: 'path' }, f.path),
        h('td', { class: 'date' }, day(f.modified)),
        h('td', { class: 'size' }, bytes(f.size)),
        h('td', null, h('button', { class: 'btn quiet', onclick: () => action('reveal', f.path) }, 'Show')))))));
}

async function recycle(paths, after) {
  try {
    const r = await runJob('recycle', { paths });
    const ok = r.results.filter(x => x.ok).length;
    const bad = r.results.filter(x => !x.ok);
    toast(`Moved ${plural(ok, 'file')} (${bytes(r.bytes)}) to the ${binName()}.` + (bad.length ? ` ${bad.length} could not be moved: ${bad[0].message}` : ''), bad.length ? 'error' : '');
    state.scanJob = null;
    after();
  } catch (e) { toast(e.message, 'error'); }
}

views.dupes = async (page, alive) => {
  header(page, 'Duplicates', 'Files with exactly the same contents, compared byte for byte. Kempt marks the oldest copy to keep; you choose which copies go.');
  const min = h('select', { 'aria-label': 'Smallest size' },
    [[1024, '1 MB and up'], [100, '100 KB and up'], [10240, '10 MB and up'], [102400, '100 MB and up']].map(([v, t]) => h('option', { value: v }, t)));
  const out = h('div');
  const picker = await folderPicker(root => search(root), 'Find duplicates');
  if (!alive()) return;
  page.append(h('div', { class: 'toolbar' }, picker.row, min), out);

  async function search(root) {
    const w = working('Comparing…');
    const stop = h('button', { class: 'btn quiet' }, 'Stop');
    fill(out, h('div', { class: 'toolbar' }, w, stop));
    const job = runJob('dupes', { root, minKB: Number(min.value) }, p => w.set(`Comparing… ${plural(p.files || 0, 'file')} looked at`));
    stop.onclick = () => job.cancel();
    try {
      const r = await job;
      if (alive()) showDupes(out, r.groups, r.searched);
    } catch (e) { if (alive()) fill(out, e.code === 'stopped' ? h('p', { class: 'empty' }, 'Search stopped.') : errorBox(e)); }
  }
};

function showDupes(out, groups, searched) {
  if (!groups.length) { fill(out, h('p', { class: 'empty' }, `No duplicates among ${plural(searched || 0, 'file')}.`)); return; }
  const chosen = new Set();
  for (const g of groups) g.files.slice(1).forEach(f => chosen.add(f.path));
  const total = h('strong');
  const btn = h('button', { class: 'btn' }, `Move selected copies to ${binName()}`);
  const sizeOf = new Map(groups.flatMap(g => g.files.map(f => [f.path, g.size])));
  const upd = () => {
    total.textContent = bytes([...chosen].reduce((n, p) => n + (sizeOf.get(p) || 0), 0));
    btn.disabled = !chosen.size;
  };
  btn.onclick = () => {
    // Never let every copy of a file go.
    const all = groups.find(g => g.files.every(f => chosen.has(f.path)));
    if (all) { toast('Keep at least one copy of every file: ' + all.files[0].path, 'error'); return; }
    recycle([...chosen], () => showDupes(out, groups.map(g => ({ ...g, files: g.files.filter(f => !chosen.has(f.path)) })).filter(g => g.files.length > 1), searched));
  };
  const wasted = groups.reduce((n, g) => n + g.wasted, 0);
  fill(out,
    h('div', { class: 'toolbar' }, btn, h('span', null, 'Selected: ', total), h('span', { class: 'grow' }),
      h('span', { class: 'muted small' }, `${plural(groups.length, 'set')} of duplicates, ${bytes(wasted)} in extra copies`)),
    groups.map(g => h('section', { class: 'dup' },
      h('header', null, h('h3', null, `${plural(g.files.length, 'copy', 'copies')} of ${bytes(g.size)}`), h('span', { class: 'muted small' }, `${bytes(g.wasted)} in extra copies`)),
      h('table', { class: 'files' }, h('tbody', null, g.files.map((f, i) => {
        const tr = h('tr', { class: chosen.has(f.path) ? '' : 'keep' },
          h('td', null, h('input', { type: 'checkbox', checked: chosen.has(f.path), 'aria-label': 'Move ' + f.path,
            onchange: e => { e.target.checked ? chosen.add(f.path) : chosen.delete(f.path); tr.className = e.target.checked ? '' : 'keep'; upd(); } })),
          h('td', { class: 'path' }, f.path, i === 0 ? h('span', { class: 'chip good' }, ' Oldest copy') : null),
          h('td', { class: 'date' }, day(f.modified)),
          h('td', null, h('button', { class: 'btn quiet', onclick: () => action('reveal', f.path) }, 'Show')));
        return tr;
      }))))));
  upd();
}

// ---------------------------------------------------------------- startup

views.startup = async (page, alive) => {
  header(page, 'Startup', isWin()
    ? 'Programs that start when you sign in. Kempt uses the same switch as Task Manager, so turning one off is always reversible and nothing is deleted.'
    : 'Programs that start when you sign in, from the autostart folders. Turning one off writes a personal override; nothing is deleted.');
  const body = h('div', null, working('Reading startup programs…'));
  page.append(body);
  const items = await loadStartup();
  if (!alive()) return;
  if (!items.length) { fill(body, h('p', { class: 'empty' }, 'No programs start when you sign in.')); return; }
  fill(body,
    h('ul', { class: 'ledger' }, items.map(it => {
      const sw = h('input', { type: 'checkbox', class: 'switch', checked: it.enabled, 'aria-label': (it.enabled ? 'Turn off ' : 'Turn on ') + it.name,
        disabled: it.admin && !state.mode.elevated,
        onchange: async e => {
          sw.disabled = true;
          try {
            const r = await api('POST', '/api/local/startup', { id: it.id, enabled: e.target.checked });
            it.enabled = r.enabled;
            toast(`${it.name} ${r.enabled ? 'will start' : 'will no longer start'} when you sign in.`);
            updateNav();
          } catch (err) { e.target.checked = !e.target.checked; toast(err.message, 'error'); }
          sw.disabled = false;
        } });
      return h('li', null, h('div', { class: 'row-main' }, sw,
        h('div', { class: 'row-title' }, h('h3', null, it.name),
          h('div', { class: 'sub', title: it.command }, [it.publisher, it.where].filter(Boolean).join(', '),
            it.missing ? h('span', { class: 'chip warn' }, ' Program file is missing') : null,
            it.admin && !state.mode.elevated ? h('span', { class: 'chip' }, ' All users: needs administrator') : null)),
        h('span'), h('span', { class: 'muted small' }, it.enabled ? 'On' : 'Off')));
    })),
    h('p', { class: 'muted small' }, 'Changes take effect the next time you sign in.' + (isWin() ? ' Task Manager and Settings › Apps › Startup show the same state.' : '')));
};

// ---------------------------------------------------------------- app updates

views.updates = async (page, alive) => {
  header(page, 'App updates', 'Kempt asks winget, the package manager built into Windows, which of your programs have a newer version, and installs them from the same sources Microsoft uses.');
  const out = h('div');
  page.append(out);
  if (!feat('winget')) {
    out.append(h('div', { class: 'notice warn' }, h('p', null, 'winget is missing. It comes with “App Installer” from the Microsoft Store; install or update that, then open this page again.')));
    return;
  }
  const check = async () => {
    fill(out, working('Asking winget for updates. This can take a minute…'));
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
  if (!ups.length) { fill(out, h('p', { class: 'empty' }, 'Every program winget knows about is up to date.'), h('button', { class: 'btn', onclick: check }, 'Check again')); return; }
  const chosen = new Set(ups.filter(u => !u.truncated).map(u => u.id));
  const btn = h('button', { class: 'btn primary' }, 'Update selected');
  const result = h('div');
  btn.onclick = async () => {
    btn.disabled = true;
    const w = working('Updating…');
    fill(result, w);
    try {
      const r = await runJob('upgrade', { ids: [...chosen] }, p => w.set(`Updating ${p.now || ''}… (${p.files || 0} of ${chosen.size} done). Some installers ask for permission.`));
      const ok = r.results.filter(x => x.ok);
      fill(result, h('div', { class: 'receipt' }, h('h3', null, `Updated ${plural(ok.length, 'program')}`),
        h('ul', null, r.results.map(x => h('li', null, `${x.id}: ${x.ok ? 'updated' : 'not updated. ' + (x.message || '').split('\n').pop()}`)))));
      state.updates = ups.filter(u => !ok.some(x => x.id === u.id));
      updateNav();
    } catch (e) { fill(result, errorBox(e)); }
    btn.disabled = false;
  };
  fill(out, h('div', { class: 'toolbar' }, btn, h('button', { class: 'btn quiet', onclick: check }, 'Check again')), result,
    h('ul', { class: 'ledger' }, ups.map(u => h('li', null, h('div', { class: 'row-main' },
      h('input', { type: 'checkbox', checked: chosen.has(u.id), disabled: u.truncated, 'aria-label': 'Update ' + u.name,
        onchange: e => { e.target.checked ? chosen.add(u.id) : chosen.delete(u.id); btn.disabled = !chosen.size; } }),
      h('div', { class: 'row-title' }, h('h3', null, u.name), h('div', { class: 'sub' }, u.id,
        u.truncated ? h('span', { class: 'chip' }, ' Name too long for winget’s list; update it from the program itself') : null)),
      h('span', { class: 'muted' }, u.version), h('span', { class: 'amount' }, u.available))))));
}

// ---------------------------------------------------------------- health

views.health = async (page, alive) => {
  header(page, 'Health', 'The things that decide whether this PC is in good shape: space, drives, protection, updates and memory. No made-up score.');
  const body = h('div', null, working('Running a checkup…'));
  const again = h('button', { class: 'btn quiet', onclick: () => { state.healthJob = null; render(); } }, 'Check again');
  page.append(h('div', { class: 'toolbar' }, again), body);
  const rep = await checkHealth();
  if (!alive()) return;
  const procs = rep.facts.procs || [];
  fill(body,
    h('ul', { class: 'ledger' }, rep.findings.map(findingRow)),
    procs.length ? [h('h2', null, 'Using the most memory'),
      h('table', { class: 'files' }, h('tbody', null, procs.map(p => h('tr', null,
        h('td', null, p.name, p.count > 1 ? h('span', { class: 'muted' }, ` (${p.count} processes)`) : null),
        h('td', { class: 'size' }, bytes(p.mem)))))),
      h('p', { class: 'muted small' }, 'Memory a program holds is not wasted. It only matters when memory is nearly full; then close what you are not using.')] : null,
    h('p', { class: 'muted small' }, 'Checked ' + when(new Date().toISOString()) + '.'));
};

// ---------------------------------------------------------------- privacy

views.privacy = async (page, alive) => {
  header(page, 'Privacy', 'Switches Windows keeps for your account. Kempt changes the same values the Settings app does, and each one links to its page there.');
  const body = h('div', null, working('Reading settings…'));
  page.append(body);
  const r = await api('GET', '/api/local/privacy');
  if (!alive()) return;
  fill(body, h('ul', { class: 'ledger' }, r.settings.map(s => {
    const sw = h('input', { type: 'checkbox', class: 'switch', checked: s.on, 'aria-label': s.title,
      onchange: async e => {
        sw.disabled = true;
        try {
          const x = await api('POST', '/api/local/privacy', { id: s.id, on: e.target.checked });
          toast(`${x.title}: ${x.on ? 'on' : 'off'}.`);
        } catch (err) { e.target.checked = !e.target.checked; toast(err.message, 'error'); }
        sw.disabled = false;
      } });
    return h('li', null, h('div', { class: 'row-main' }, sw,
      h('div', { class: 'row-title' }, h('h3', null, s.title), h('div', { class: 'sub' }, s.what)),
      h('span'),
      s.settings ? h('button', { class: 'btn quiet', onclick: () => action('settings:' + s.settings) }, 'Open in Settings') : h('span')));
  })), h('p', { class: 'muted small' }, 'Some changes show after you sign out and in again. Every change is in History, where you can undo it.'));
};

// ---------------------------------------------------------------- automatic care

views.care = async (page, alive) => {
  header(page, 'Automatic care', 'Kempt can tidy the same caches on a schedule, using Windows Task Scheduler. Nothing of Kempt runs in the background in between.');
  const settings = await api('GET', '/api/local/settings');
  if (!alive()) return;
  const chosen = new Set(settings.careCategories);
  const saveKinds = async () => {
    try {
      const r = await api('PUT', '/api/local/settings', { careCategories: [...chosen] });
      state.care = r.careCategories;
      toast('Saved. Tidy up and automatic care use these kinds.');
    } catch (e) { toast(e.message, 'error'); }
  };
  const kinds = h('ul', { class: 'ledger' }, state.categories.filter(c => c.kind !== 'bin').map(c => h('li', null,
    h('label', { class: 'row-main no-check check' },
      h('span', { class: 'row-title' }, h('h3', null, c.name), h('span', { class: 'sub' }, c.admin ? 'Only when Kempt runs as administrator' : c.what)),
      h('span'),
      h('input', { type: 'checkbox', checked: chosen.has(c.id), onchange: e => { e.target.checked ? chosen.add(c.id) : chosen.delete(c.id); saveKinds(); } })))));

  const plan = h('div');
  page.append(h('h2', null, 'When'), plan, h('h2', null, 'What it removes'),
    h('p', { class: 'muted' }, `Also used by Tidy up on the overview. The ${binName()} is never emptied automatically, and anything a program has open is skipped.`), kinds);

  if (!feat('schedule')) {
    plan.append(h('div', { class: 'notice' }, h('p', null, 'Scheduling uses Windows Task Scheduler. On this system, add this line to your crontab (crontab -e) for a weekly run on Sunday at 11:00:'),
      h('p', null, h('code', null, '0 11 * * 0 kempt care'))));
    return;
  }
  plan.append(working('Reading Task Scheduler…'));
  let p;
  try { p = await api('GET', '/api/local/schedule'); } catch (e) { if (alive()) fill(plan, errorBox(e)); return; }
  if (!alive()) return;
  const on = h('input', { type: 'checkbox', class: 'switch', checked: p.enabled, 'aria-label': 'Automatic care' });
  const freq = h('select', null, h('option', { value: 'weekly', selected: p.frequency !== 'daily' }, 'Every week'), h('option', { value: 'daily', selected: p.frequency === 'daily' }, 'Every day'));
  const dayEl = h('select', null, ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(d => h('option', { value: d, selected: (p.day || 'Sunday') === d }, d)));
  const time = h('input', { type: 'text', value: p.time || '11:00', 'aria-label': 'Time', inputmode: 'numeric', pattern: '[0-2][0-9]:[0-5][0-9]' });
  const save = h('button', { class: 'btn primary' }, 'Save');
  const sync = () => { dayEl.disabled = freq.value === 'daily' || !on.checked; freq.disabled = time.disabled = !on.checked; };
  on.onchange = freq.onchange = sync;
  save.onclick = async () => {
    save.disabled = true;
    try {
      const r = await api('PUT', '/api/local/schedule', { enabled: on.checked, frequency: freq.value, day: dayEl.value, time: time.value.trim() });
      toast(r.enabled ? 'Automatic care is on.' + (r.nextRun ? ' Next run: ' + when(r.nextRun) + '.' : '') : 'Automatic care is off.');
      render();
    } catch (e) { toast(e.message, 'error'); save.disabled = false; }
  };
  fill(plan,
    h('div', { class: 'form-grid' },
      h('label', null, 'Automatic care'), h('div', null, on),
      h('label', null, 'How often'), freq,
      h('label', null, 'Day'), dayEl,
      h('label', null, 'Time (24-hour)'), time),
    h('div', { class: 'toolbar' }, save,
      p.nextRun ? h('span', { class: 'muted small' }, 'Next run: ' + when(p.nextRun)) : null,
      p.lastRun ? h('span', { class: 'muted small' }, 'Last run: ' + when(p.lastRun)) : null),
    p.enabled ? h('p', { class: 'muted small' }, 'If you move Kempt to another folder, save this again so the task finds it.') : null);
  sync();
};

// ---------------------------------------------------------------- settings

views.settings = async (page, alive) => {
  header(page, 'Settings', 'How Kempt itself starts. Both are off unless you turn them on.');
  const body = h('div', null, working('Reading settings…'));
  page.append(body);
  let st = await api('GET', '/api/local/app');
  if (!alive()) return;
  const draw = () => {
    const change = async (key, value, sw) => {
      sw.disabled = true;
      try {
        st = await api('PUT', '/api/local/app', { [key]: value });
        toast(key === 'startup'
          ? (st.startup ? 'Kempt will start when you sign in.' : 'Kempt will no longer start when you sign in.')
          : (st.minimized ? 'Kempt will open minimized on the taskbar at startup.' : 'Kempt will open its window normally at startup.'));
      } catch (e) { toast(e.message, 'error'); }
      if (alive()) draw();
    };
    const startup = h('input', { type: 'checkbox', class: 'switch', checked: st.startup, 'aria-label': isWin() ? 'Start at Windows startup' : 'Start when you sign in',
      onchange: e => change('startup', e.target.checked, e.target) });
    const mini = h('input', { type: 'checkbox', class: 'switch', checked: st.minimized, 'aria-label': 'Minimize to desktop and stick to taskbar',
      disabled: !st.minimizedSupported || !st.startup,
      onchange: e => change('minimized', e.target.checked, e.target) });
    fill(body, h('ul', { class: 'ledger' },
      h('li', null, h('div', { class: 'row-main' }, startup,
        h('div', { class: 'row-title' }, h('h3', null, isWin() ? 'Start at Windows startup' : 'Start when you sign in'),
          h('div', { class: 'sub' }, isWin()
            ? 'Kempt opens when you sign in to Windows. It is listed as “Kempt” under Startup, here and in Task Manager, and nothing is cleaned until you ask.'
            : 'Kempt opens when you sign in. It adds one file, kempt.desktop, to your autostart folder.')),
        h('span'), h('span', { class: 'muted small' }, st.startup ? 'On' : 'Off'))),
      h('li', null, h('div', { class: 'row-main' }, mini,
        h('div', { class: 'row-title' }, h('h3', null, 'Minimize to desktop and stick to taskbar'),
          h('div', { class: 'sub' }, !st.minimizedSupported
            ? 'Only available on Windows.'
            : 'When Kempt starts with Windows, its window opens minimized and stays on the taskbar until you click it.' + (st.startup ? '' : ' Turn on Start at Windows startup first.'))),
        h('span'), h('span', { class: 'muted small' }, st.minimized ? 'On' : 'Off')))),
      h('p', { class: 'muted small' }, 'Closing the window still closes Kempt. Both changes are recorded in History.'));
  };
  draw();
};

// ---------------------------------------------------------------- history

views.history = async (page, alive) => {
  header(page, 'History', 'Everything Kempt changed, newest first. Startup and privacy changes can be undone here.');
  const r = await api('GET', '/api/local/journal');
  if (!alive()) return;
  if (!r.entries.length) { page.append(h('p', { class: 'empty' }, 'Nothing yet. Every change Kempt makes will be listed here.')); return; }
  page.append(h('div', null, r.entries.map(e => h('div', { class: 'entry' + (e.undone ? ' undone' : '') },
    h('time', { datetime: e.time }, when(e.time)),
    h('div', null, h('div', { class: 'what' }, e.summary, e.auto ? h('span', { class: 'chip' }, ' Automatic care') : null),
      e.details && e.details.length ? h('ul', null, e.details.slice(0, 8).map(d => h('li', null, d)), e.details.length > 8 ? h('li', null, `and ${e.details.length - 8} more`) : null) : null),
    e.undo && !e.undone ? h('button', { class: 'btn', onclick: async ev => {
      ev.target.disabled = true;
      try { await api('POST', '/api/local/undo', { id: e.id }); state.startup = null; toast('Undone.'); render(); }
      catch (err) { toast(err.message, 'error'); ev.target.disabled = false; }
    } }, 'Undo') : h('span')))));
};

// ---------------------------------------------------------------- honest notes

views.why = page => {
  header(page, 'What Kempt won’t do', 'All-in-one “PC optimizers” bundle many features. Some help; these do not, so Kempt leaves them out.');
  const notes = [
    ['Clean the registry', 'Unused registry entries take a few kilobytes and do not slow Windows down. Removing the wrong one can break a program or Windows itself, and Microsoft does not support registry cleaners (support article KB2563254).'],
    ['“Free up” or “boost” RAM', 'Windows fills spare memory with a cache of files you are likely to open next and gives it back the instant a program needs it. Emptying it makes the next things you open slower. When memory really is full, the fix is to close programs or turn off ones that start with Windows, which Kempt shows you.'],
    ['Speed up your internet by 300%', 'Windows has tuned its network settings automatically since Windows Vista. Your connection speed is set by your provider, your Wi-Fi signal and the site you visit, not by a setting a tool can change.'],
    ['Update drivers from its own database', 'Third-party driver updaters can install the wrong driver for your hardware. Windows Update delivers drivers tested for your PC, and your PC maker’s support page has the rest.'],
    ['Give your PC a score or an “AI mode”', 'A single number hides what is going on. Kempt shows each measurement with what it means and what to do about it.'],
    ['Replace your antivirus', 'Microsoft Defender is built in, updates itself and is enough for most people. Kempt checks that it, or the antivirus you chose, is switched on.'],
    ['Run in the background or nag you to upgrade', 'Kempt runs only while its window is open, or when the task you scheduled starts it. It starts with Windows only if you turn that on in Settings. There is no paid version, no advertising and no data sent anywhere.'],
  ];
  page.append(h('ul', { class: 'why' }, notes.map(([t, p]) => h('li', null, h('h3', null, t), h('p', null, p)))));
};

// ---------------------------------------------------------------- start

async function start() {
  try {
    state.mode = await api('GET', '/api/mode');
    const c = await api('GET', '/api/local/categories');
    state.categories = c.categories;
    state.care = c.care;
  } catch (e) {
    fill(main, h('div', { class: 'page' }, h('h1', null, 'Kempt is not connected'), errorBox(e)));
    return;
  }
  const foot = document.getElementById('foot');
  fill(foot,
    state.mode.elevated ? h('span', null, 'Running as administrator') : null,
    feat('elevate') ? h('button', { class: 'btn', onclick: async () => {
      try { await api('POST', '/api/local/elevate'); fill(main, h('div', { class: 'page' }, h('h1', null, 'Restarting as administrator'), h('p', { class: 'lede' }, 'A new Kempt window opens in a moment. You can close this one.'))); }
      catch (e) { toast(e.message, 'error'); }
    } }, 'Restart as administrator') : null,
    h('div', { class: 'row' },
      h('span', null, 'Kempt ' + state.mode.version),
      h('button', { class: 'btn quiet', onclick: async () => { await api('POST', '/api/local/quit').catch(() => {}); window.close(); fill(main, h('div', { class: 'page' }, h('h1', null, 'Kempt has closed'))); } }, 'Close')));
  window.addEventListener('hashchange', render);
  setInterval(() => api('POST', '/api/local/heartbeat').catch(() => {}), 30000);
  render();
}

start();

// Right-hand side panel: Assistant · Translate · Terms · Offline. Resizable; sits beside the page (never over it).
import { h, mount, hostOf, LANGS, langName, fmtBytes, relTime, debounce, errText } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { renderMarkdown } from '../lib/markdown.js';
import { S, L, on, emit, call, go, activeTab, setPanel, setSettings, modLabel } from '../lib/store.js';
import { iconBtn, withBusy, diffView, matchBadge, favicon, emptyState } from './widgets.js';
import { toast } from './overlay.js';
import { tabTitle } from './tabstrip.js';
import { openInternal } from './toolbar.js';

const VIEWS = [['assistant', 'Assistant', 'sparkle'], ['translate', 'Translate', 'translate'], ['terms', 'Terms', 'book'], ['offline', 'Offline', 'saveOffline']];
const APPS = [['gmail', 'Gmail', 'mail'], ['calendar', 'Google Calendar', 'calendar']];
let root, body, tabsEl, lastKey = '';
const chats = new Map();       // tabId -> [{ role, text, citations, error }]
const mem = { targetLang: null, projectId: '', lookupText: '', termbaseId: '', termQuery: '' };
let projects = null, termbases = null;

export function initSidePanel() {
  root = document.getElementById('sidepanel');
  const handle = h('div.sp-resize', { role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize side panel', tabIndex: 0 });
  tabsEl = h('div.sp-tabs', { role: 'tablist' }, VIEWS.map(([id, label, ic]) => h('button', { type: 'button', role: 'tab', title: label, 'aria-label': label, dataset: { view: id }, onClick: () => setPanel({ view: id }) }, icon(ic), h('span.sp-tab-label', label))));
  // Web panels (Gmail, Calendar): icon buttons after the built-in tabs
  for (const [id, label, ic] of APPS) tabsEl.appendChild(h('button.sp-app-btn', { type: 'button', role: 'tab', title: label, 'aria-label': label, dataset: { view: 'app:' + id }, onClick: () => setPanel({ view: 'app:' + id }) }, icon(ic)));
  body = h('div.sp-body', { role: 'tabpanel' });
  mount(root, handle, h('div.sp-head', tabsEl, iconBtn('close', `Close side panel (${modLabel()}Shift+E)`, () => setPanel({ open: false }), 'sm')), body);

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault(); handle.setPointerCapture(e.pointerId); handle.classList.add('active');
    const startX = e.clientX, startW = S.panel.width;
    const move = (ev) => { root.style.width = clampW(startW + (startX - ev.clientX)) + 'px'; };
    const up = (ev) => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.classList.remove('active'); setPanel({ width: clampW(startW + (startX - ev.clientX)) }); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
  });
  handle.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') setPanel({ width: clampW(S.panel.width + 24) }); else if (e.key === 'ArrowRight') setPanel({ width: clampW(S.panel.width - 24) }); });

  on('panel', () => sync(true)); on('tabs', () => sync(false)); on('offline-changed', () => { if (S.panel.view === 'offline') sync(true); });
  on('status', () => sync(true));
  sync(true);
}
const clampW = (w) => Math.round(Math.max(320, Math.min(900, Math.min(window.innerWidth - 420, w))));

function sync(force) {
  root.hidden = !S.panel.open;
  root.style.width = clampW(S.panel.width) + 'px';
  if (!S.panel.open || !String(S.panel.view).startsWith('app:')) hideApp();
  if (!S.panel.open) { lastKey = ''; return; }
  for (const b of tabsEl.children) b.setAttribute('aria-selected', String(b.dataset.view === S.panel.view));
  const t = activeTab();
  const key = [S.panel.view, t?.id, t?.url, t?.translated?.targetLang, t?.offlineCopy?.id, !!t?.error, !!t?.loading && S.panel.view === 'offline'].join('|');
  const intent = S.panelIntent && S.panelIntent.view === S.panel.view ? S.panelIntent : null;
  if (!force && !intent && key === lastKey) return;
  lastKey = key; if (intent) S.panelIntent = null;
  if (String(S.panel.view).startsWith('app:')) return viewApp(S.panel.view.slice(4));
  ({ assistant: viewAssistant, translate: viewTranslate, terms: viewTerms, offline: viewOffline }[S.panel.view] || viewAssistant)(t, intent);
}

/* ================= Web panels (Gmail, Calendar) ================= */
let appShown = null, appObserver = null;
function hideApp() {
  if (appObserver) { appObserver.disconnect(); appObserver = null; window.removeEventListener('resize', reportApp); }
  if (appShown !== null) { appShown = null; call(L().webpanel.show(null, null), { silent: true }); }
}
let appSlot = null, appId = null;
function reportApp() {
  if (!appSlot || !appSlot.isConnected) return;
  const r = appSlot.getBoundingClientRect();
  appShown = appId;
  call(L().webpanel.show(appId, { x: r.left, y: r.top, width: r.width, height: r.height }), { silent: true });
}
function viewApp(id) {
  const app = APPS.find(([x]) => x === id);
  if (!app) return mount(body, emptyState('globe', 'Not available', 'This web panel does not exist.'));
  hideApp();
  appId = id;
  appSlot = h('div.sp-app-slot', { 'aria-label': app[1] });
  const tool = h('div.sp-app-bar',
    h('span.sp-app-name', icon(app[2], 16), app[1]), h('span.grow'),
    iconBtn('home', `${app[1]} home`, () => call(L().webpanel.home(id), { silent: true }), 'sm'),
    iconBtn('reload', 'Reload', () => call(L().webpanel.reload(id), { silent: true }), 'sm'),
    iconBtn('external', 'Open in a tab', () => call(L().webpanel.openInTab(id), { silent: true }), 'sm'));
  mount(body, h('div.sp-app', tool, appSlot, h('div.sp-app-note', 'Signed in here means signed in to Google in your tabs too. Private tabs stay separate.')));
  appObserver = new ResizeObserver(() => requestAnimationFrame(reportApp));
  appObserver.observe(appSlot);
  window.addEventListener('resize', reportApp);
  requestAnimationFrame(reportApp);
}

const pageContext = (t) => h('div.sp-context', t.kind === 'web' ? favicon(t.favicon, t.url, t.favicon ? null : 'globe') : icon('layers', 16), h('span.ellipsis', { dir: 'auto' }, tabTitle(t)), t.kind === 'web' ? h('span.muted', { style: { flex: 'none' } }, hostOf(t.url)) : null);
const needsKey = () => h('div.sp-note.warn', h('b', 'AI is not set up yet. '), 'Add your Claude API key to use the assistant and AI suggestions. Pages translate without a key only when your translation memory has every passage. ', h('button.btn.sm', { type: 'button', style: { marginTop: '8px', display: 'flex' }, onClick: () => openInternal('lintas://settings') }, icon('key'), 'Open settings'));
const webOnly = (what) => emptyState('globe', 'Open a web page', what);
async function loadProjects() { if (!projects) { const d = await call(L().tms.dashboard(), { silent: true }); projects = d?.projects || []; termbases = d?.termbases || []; } return projects; }
export function invalidateTmsCache() { projects = null; termbases = null; }

/* ================= Assistant ================= */
function viewAssistant(t, intent) {
  if (!t || t.kind !== 'web' || t.error) return mount(body, h('div.sp-section', webOnly('The assistant answers questions about the page in the active tab, with citations you can click.')));
  if (!chats.has(t.id)) chats.set(t.id, []);
  const msgs = chats.get(t.id);
  const log = h('div.chat', { 'aria-live': 'polite' });
  const input = h('textarea', { rows: 1, placeholder: 'Ask about this page…', 'aria-label': 'Ask about this page', dir: 'auto' });
  const send = h('button.icon-btn.send', { type: 'button', title: 'Send (Enter)', 'aria-label': 'Send' }, icon('send', 16));
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; };
  let busy = false;

  const cite = (n) => call(L().ai.highlight(t.id, n));
  const draw = () => {
    mount(log, msgs.length ? msgs.map((m) => {
      if (m.role === 'user') return h('div.msg.user', { dir: 'auto' }, m.text);
      if (m.error) return h('div.msg.err', m.text);
      return h('div.msg.bot', h('div.who', icon('sparkle'), 'Claude'), renderMarkdown(m.text, { onCite: cite }),
        m.citations?.length ? h('div.cites', m.citations.map((c) => h('button', { type: 'button', title: 'Show on the page', onClick: () => cite(c.n) }, h('b', `[${c.n}]`), h('span', { dir: 'auto' }, '“' + c.quote + (c.quote.length >= 138 ? '…' : '') + '”')))) : null);
    }) : h('div.sp-hello', h('h3', 'Ask about this page'), h('p', 'Answers are grounded in the page text. Numbered citations like ', h('span.cite', '3'), ' jump to the paragraph they come from.'),
      h('div.prompt-chips', ['Summarise this page', 'List the key terms with translations', 'What are the main claims?', 'Explain this for a general reader'].map((q) => h('button', { type: 'button', onClick: () => ask(q) }, q)))),
    busy ? h('div.msg.bot', h('div.who', icon('sparkle'), 'Claude'), h('div.typing', { 'aria-label': 'Thinking' }, h('i'), h('i'), h('i'))) : null);
    log.scrollTop = log.scrollHeight;
  };
  async function ask(q) {
    q = (q ?? input.value).trim(); if (!q || busy) return;
    input.value = ''; grow();
    const history = msgs.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.text }));
    msgs.push({ role: 'user', text: q }); busy = true; draw();
    try { const r = await L().ai.ask(t.id, q, { history }); msgs.push({ role: 'assistant', text: r.answer, citations: r.citations || [] }); }
    catch (e) { msgs.push({ role: 'assistant', error: true, text: errText(e, 'The assistant could not answer.') }); }
    busy = false; if (activeTab()?.id === t.id && S.panel.view === 'assistant') draw();
  }
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(); } });
  send.addEventListener('click', () => ask());
  mount(body, h('div.sp-section', { style: { paddingBottom: '10px' } }, pageContext(t), S.status.hasApiKey ? null : needsKey(),
    msgs.length ? h('div.row', h('span.grow'), h('button.btn.sm.ghost', { type: 'button', onClick: () => { msgs.length = 0; draw(); } }, icon('trash'), 'Clear conversation')) : null),
    log, h('div.composer', input, send));
  draw();
  if (intent?.selection) { input.value = `About this passage: “${intent.selection}”\n`; grow(); }
  if (intent) input.focus();
}

/* ================= Translate ================= */
function langSelect(value, onChange, label) {
  return h('select.select', { 'aria-label': label, onChange: (e) => onChange(e.target.value) }, LANGS.map(([c, n]) => h('option', { value: c, selected: c === value }, n)));
}
export function termHit(t, onInsert) {
  const pill = h('span.t-pill.t-' + t.status, icon(t.status === 'forbidden' ? 'ban' : t.status === 'admitted' ? 'circle' : 'check'), t.status[0].toUpperCase() + t.status.slice(1));
  const inner = [h('span.th-src', { dir: 'auto' }, t.source), pill, h('span.th-tgt', { dir: 'auto', style: { gridColumn: '1 / -1' } }, t.target), t.note ? h('span.th-note', { dir: 'auto' }, t.note) : null];
  if (onInsert && t.status !== 'forbidden') return h('button.term-hit.t-' + t.status, { type: 'button', title: 'Insert into the translation', onClick: () => onInsert(t) }, inner);
  return h('div.term-hit.t-' + t.status, { title: t.status === 'forbidden' ? 'Forbidden term — do not use' : null }, inner);
}
export function tmMatch(m, n, onInsert) {
  const inner = [h('div.tm-head', n ? h('span.tm-n', String(n)) : null, matchBadge(m.score), h('span.ellipsis.grow', m.tmName || '')),
    h('div.tm-src', diffView(m.diff?.length ? m.diff : [{ op: 'eq', text: m.source }])), h('div.tm-tgt', { dir: 'auto' }, m.target)];
  return onInsert ? h('button.tm-match', { type: 'button', title: n ? `Insert match (${modLabel()}${n})` : 'Insert', onClick: () => onInsert(m) }, inner) : h('div.tm-match', inner);
}

function viewTranslate(t, intent) {
  mem.targetLang ||= S.settings.defaultTargetLang || 'en';
  const web = t && t.kind === 'web' && !t.error;
  const projSel = h('select.select', { 'aria-label': 'Project', onChange: (e) => { mem.projectId = e.target.value; } }, h('option', { value: '' }, 'No project (plain translation)'));
  const status = h('div');
  const pageBtn = h('button.btn.primary', { type: 'button' }, icon('translate'), 'Translate page');
  const restoreBtn = h('button.btn', { type: 'button' }, icon('undo'), 'Show original');
  const pageBox = h('div.sp-section');
  const drawPage = () => {
    if (!web) return mount(pageBox, h('div.sp-title', 'Translate page'), h('div.sp-note', 'Open a web page to translate it in place. Lookups below work on any text.'));
    const cur = activeTab();
    mount(pageBox, h('div.sp-title', 'Translate page'), pageContext(cur),
      h('div.field', h('label', 'Translate to'), langSelect(mem.targetLang, (v) => { mem.targetLang = v; }, 'Target language')),
      h('div.field', h('label', 'Use TM and termbase from'), projSel, h('div.hint', 'Approved TM matches are used first and termbase terms are enforced.')),
      S.status.hasApiKey ? null : needsKey(),
      h('div.row', cur.translated ? restoreBtn : null, pageBtn), status,
      cur.translated ? h('div.sp-note', icon('circleCheck', 14), ` This page is shown in ${langName(cur.translated.targetLang)}. The original is kept and can be restored at any time.`) : null);
    pageBtn.lastChild.textContent = cur.translated ? 'Translate again' : 'Translate page';
  };
  let off = null;
  pageBtn.addEventListener('click', async () => {
    if (pageBtn.classList.contains('busy')) return;
    const label = h('span.muted', 'Preparing…'); const bar = h('div.seg-bar', { style: { height: '6px' } }, h('i', { style: { background: 'var(--accent)', flexGrow: '0' } }), h('i', { style: { flexGrow: '1' } }));
    mount(status, h('div', { style: { display: 'grid', gap: '6px' } }, bar, label));
    off = L().on('translate-progress', (p) => { if (p.tabId !== t.id) return; const f = p.total ? p.done / p.total : 0; bar.firstChild.style.flexGrow = String(f); bar.lastChild.style.flexGrow = String(1 - f); label.textContent = `Translating… ${p.done} of ${p.total} passages`; });
    await withBusy(pageBtn, async () => {
      try { const r = await L().ai.translatePage(t.id, { targetLang: mem.targetLang, projectId: mem.projectId || undefined });
        mount(status, h('div.sp-note', h('b', `${r.translated} passages translated. `), `${r.fromTm} from translation memory, ${r.fromAi} by AI.`)); }
      catch (e) { mount(status, h('div.msg.err', errText(e, 'The page could not be translated.'))); }
    });
    off && off(); off = null;
  });
  restoreBtn.addEventListener('click', async () => { await call(L().ai.restorePage(t.id)); mount(status); });

  // lookup / selection
  const text = h('textarea.textarea', { rows: 3, placeholder: 'Paste or type text — or select text on the page and use the right-click menu', 'aria-label': 'Text to look up', dir: 'auto' }, intent?.selection ?? mem.lookupText);
  const results = h('div', { style: { display: 'grid', gap: '10px' } });
  const lookBtn = h('button.btn', { type: 'button' }, icon('database'), 'Look up');
  const trBtn = h('button.btn', { type: 'button' }, icon('sparkle'), 'Translate');
  const selBtn = h('button.btn.sm.ghost', { type: 'button', title: 'Use the text selected on the page', onClick: async () => { const s = await call(L().ai.selection(t.id), { silent: true }); if (s) { text.value = s; mem.lookupText = s; } else toast('info', 'Select some text on the page first.'); } }, icon('capture'), 'Use selection');
  text.addEventListener('input', () => { mem.lookupText = text.value; });
  async function lookup() {
    const q = text.value.trim(); if (!q) return text.focus();
    const ps = await loadProjects(); const pid = mem.projectId || ps[0]?.id;
    if (!pid) return mount(results, h('div.sp-note', 'Create a TMS project first: lookups use its translation memories and termbase.'));
    await withBusy(lookBtn, async () => {
      const r = await call(L().tms.lookup(pid, q)); if (!r) return;
      mount(results, h('div.sp-title', h('span.grow', 'Translation memory'), h('span', String(r.matches.length))),
        r.matches.length ? r.matches.map((m) => tmMatch(m)) : h('div.sp-note', 'No match of 50% or better in this project’s memories.'),
        h('div.sp-title', { style: { marginTop: '6px' } }, h('span.grow', 'Terms'), h('span', String(r.terms.length))),
        r.terms.length ? r.terms.map((x) => termHit(x)) : h('div.sp-note', 'No termbase entries found in this text.'));
    });
  }
  async function translate() {
    const q = text.value.trim(); if (!q) return text.focus();
    await withBusy(trBtn, async () => {
      try { const r = await L().ai.translateText(q, { targetLang: mem.targetLang, projectId: mem.projectId || undefined });
        const out = h('div.tm-tgt.selectable', { dir: 'auto' }, r.text);
        mount(results, h('div.sp-title', h('span.grow', `Translation · ${langName(mem.targetLang)}`), iconBtn('copy', 'Copy translation', () => { navigator.clipboard?.writeText(r.text).then(() => toast('success', 'Copied', 1600), () => {}); }, 'sm')), h('div.tm-match', out)); }
      catch (e) { mount(results, h('div.msg.err', errText(e, 'Could not translate.'))); }
    });
  }
  lookBtn.addEventListener('click', lookup); trBtn.addEventListener('click', translate);
  mount(body, pageBox, h('div.sp-section', h('div.sp-title', h('span.grow', 'Look up or translate text'), web ? selBtn : null), text, h('div.row', lookBtn, trBtn), results), h('div', { style: { height: '16px', flex: 'none' } }));
  drawPage();
  loadProjects().then((ps) => { for (const p of ps) projSel.appendChild(h('option', { value: p.id, selected: p.id === mem.projectId }, `${p.name} (${p.sourceLang.toUpperCase()}→${p.targetLang.toUpperCase()})`)); });
  if (intent?.action === 'lookup') lookup(); else if (intent?.action === 'translate') translate(); else if (intent?.action === 'translate-page' && web) pageBtn.click();
}

/* ================= Terms ================= */
async function viewTerms(t, intent) {
  mount(body, h('div.sp-section', h('div.skeleton', { style: { height: '32px' } }), h('div.skeleton', { style: { height: '120px' } })));
  await loadProjects();
  if (S.panel.view !== 'terms') return;
  if (!termbases?.length) return mount(body, h('div.sp-section', emptyState('book', 'No termbases yet', 'Create a termbase in the TMS to collect approved, admitted and forbidden terms.', h('button.btn.primary', { type: 'button', onClick: () => openInternal('lintas://tms') }, 'Open TMS'))));
  if (!termbases.some((b) => b.id === mem.termbaseId)) mem.termbaseId = termbases[0].id;
  const list = h('div', { style: { display: 'grid', gap: '6px' } });
  const tbSel = h('select.select', { 'aria-label': 'Termbase', onChange: (e) => { mem.termbaseId = e.target.value; load(); } }, termbases.map((b) => h('option', { value: b.id, selected: b.id === mem.termbaseId }, `${b.name} (${b.sourceLang.toUpperCase()}→${b.targetLang.toUpperCase()})`)));
  const q = h('input.input', { type: 'search', placeholder: 'Search terms', 'aria-label': 'Search terms', value: mem.termQuery, dir: 'auto', spellcheck: false });
  const src = h('input.input', { placeholder: 'Source term', 'aria-label': 'Source term', dir: 'auto', value: intent?.selection || '', spellcheck: false });
  const tgt = h('input.input', { placeholder: 'Target term', 'aria-label': 'Target term', dir: 'auto', spellcheck: false });
  const st = h('select.select', { 'aria-label': 'Status' }, [['preferred', 'Preferred'], ['admitted', 'Admitted'], ['forbidden', 'Forbidden']].map(([v, l]) => h('option', { value: v }, l)));
  const note = h('input.input', { placeholder: 'Note (optional)', 'aria-label': 'Note', dir: 'auto' });
  const addBtn = h('button.btn.primary', { type: 'button' }, icon('plus'), 'Add term');
  async function load() {
    const terms = (await call(L().tms.listTerms(mem.termbaseId, { q: q.value.trim() || undefined }))) || [];
    mount(list, terms.length ? terms.slice(0, 200).map((x) => { const row = termHit(x); row.style.position = 'relative';
      row.appendChild(h('button.icon-btn.sm', { type: 'button', title: 'Delete term', 'aria-label': 'Delete term', style: { position: 'absolute', right: '6px', bottom: '6px' }, onClick: async () => { await call(L().tms.deleteTerm(mem.termbaseId, x.id)); load(); } }, icon('trash'))); return row; })
      : h('div.sp-note', q.value ? 'No terms match your search.' : 'This termbase is empty. Add the first term above.'));
  }
  const search = debounce(() => { mem.termQuery = q.value; load(); }, 200);
  q.addEventListener('input', search);
  const add = async () => {
    if (!src.value.trim() || !tgt.value.trim()) { (src.value.trim() ? tgt : src).focus(); return; }
    await withBusy(addBtn, async () => { const r = await call(L().tms.addTerm(mem.termbaseId, { source: src.value.trim(), target: tgt.value.trim(), status: st.value, note: note.value.trim() })); if (r) { toast('success', 'Term added', 1800); src.value = tgt.value = note.value = ''; emit('terms-changed'); load(); src.focus(); } });
  };
  addBtn.addEventListener('click', add);
  for (const i of [src, tgt, note]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  mount(body, h('div.sp-section', h('div.sp-title', 'Termbase'), tbSel),
    h('div.sp-section', h('div.sp-title', 'Add a term'), h('div.form-row', src, tgt), h('div.form-row', st, note), h('div.row', h('span.grow'), addBtn)),
    h('div.sp-section', h('div.sp-title', 'Entries'), h('div.search-field', icon('search'), q), list), h('div', { style: { height: '16px', flex: 'none' } }));
  q.style.paddingLeft = '34px';
  load();
  if (intent) (src.value ? tgt : src).focus();
}

/* ================= Offline ================= */
async function viewOffline(t) {
  const web = t && t.kind === 'web' && !t.error;
  const saveBtn = h('button.btn.primary', { type: 'button', disabled: !web }, icon('saveOffline'), t?.offlineCopy ? 'Save again' : 'Save this page');
  saveBtn.addEventListener('click', () => withBusy(saveBtn, async () => { const p = await call(L().offline.save(t.id)); if (p) { toast('success', `Saved for offline · ${fmtBytes(p.bytes)}`); emit('offline-changed'); } }));
  const list = h('div');
  const auto = h('input.switch', { type: 'checkbox', checked: !!S.settings.autoSaveOffline, 'aria-label': 'Auto-save visited pages', onChange: (e) => setSettings({ autoSaveOffline: e.target.checked }) });
  mount(body, h('div.sp-section', h('div.sp-title', 'This page'), t ? pageContext(t) : null,
    web ? (t.offlineCopy ? h('div.sp-note', icon('offlineDone', 14), ` A copy was saved ${relTime(t.offlineCopy.savedAt)}. It opens without a network connection.`) : h('div.sp-note', 'Save the complete page as a single file so you can read it — and translate it — without a network connection.')) : h('div.sp-note', 'Open a web page to save it for offline reading.'),
    h('div.row', saveBtn, t?.offlineCopy && t.security !== 'offline-copy' ? h('button.btn', { type: 'button', onClick: () => call(L().offline.open(t.offlineCopy.id, { newTab: true })) }, 'Open saved copy') : null),
    h('label.check-row', h('span.grow', 'Auto-save every page I visit'), auto)),
  h('div.sp-section', h('div.sp-title', h('span.grow', 'Recently saved'), h('button.btn.sm.ghost', { type: 'button', onClick: () => openInternal('lintas://offline') }, 'Open library')), list), h('div', { style: { height: '16px', flex: 'none' } }));
  const pages = (await call(L().offline.list({}), { silent: true })) || [];
  mount(list, pages.length ? pages.slice(0, 8).map((p) => h('div.list-row', { style: { padding: '8px 6px' } },
    h('button.list-row', { type: 'button', style: { padding: 0, background: 'none' }, title: p.url, onClick: () => call(L().offline.open(p.id, { newTab: false })) }, favicon(null, p.url), h('span.lr-main', h('span.lr-title', { dir: 'auto' }, p.title), h('span.lr-sub', `${hostOf(p.url)} · ${relTime(p.savedAt)} · ${fmtBytes(p.bytes)}`))),
    h('span.lr-actions', iconBtn('trash', 'Remove saved copy', async () => { await call(L().offline.remove(p.id)); emit('offline-changed'); }, 'sm'))))
    : h('div.sp-note', 'Nothing saved yet.'));
}

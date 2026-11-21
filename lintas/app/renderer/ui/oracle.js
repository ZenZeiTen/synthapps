// AI Oracle: the agentic chat in the side panel (replaces the old Assistant view).
// Markup follows docs/oracle-design.md; the event protocol follows docs/oracle-contract.md.
//
// State lives per Lintas tab in a module Map, and ONE module-level listener applies `oracle` events to that
// state, so a run keeps going while the view is re-mounted (tab switch, other side panel view). A mount only
// draws the stored state and receives live updates while it is the current one.
import { h, mount, hostOf, errText, fmtDate } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { renderMarkdown } from '../lib/markdown.js';
import { S, L, on, call } from '../lib/store.js';
import { favicon } from './widgets.js';
import { tabTitle } from './tabstrip.js';
import { openInternal } from './toolbar.js';
import { createWisp, createCouncil, ROLES } from './oracle-wisp.js';

const CHIPS = ['Summarise this page', 'List the key terms with translations', 'What are the main claims?', 'Explain this for a general reader'];
const HISTORY_TURNS = 10;
const LONG_RUN_TOOLS = 3, LONG_RUN_MS = 20000;

const states = new Map();   // tabId -> conversation state
const early = new Map();    // runId -> events that arrived before oracle.ask resolved
let view = null;            // the mounted view { st, destroy, ... } (at most one)
let unsubscribe = null;
let unsubTabs = null;

/* ---------------- state ---------------- */
function stateFor(tabId) {
  let st = states.get(tabId);
  if (!st) {
    st = { tabId, items: [], runId: null, pending: false, running: false, stopping: false,
      active: new Set(), used: new Set(), roleStates: {}, tools: 0, startedAt: 0, status: '', wisp: 'idle', draft: '', errTimer: 0, ai: null };
    states.set(tabId, st);
  }
  return st;
}
const stateByRun = (runId) => { for (const st of states.values()) if (st.runId === runId) return st; return null; };
const anyPending = () => { for (const st of states.values()) if (st.pending) return true; return false; };

function ensureListeners() {
  if (!unsubscribe) unsubscribe = L().on('oracle', (ev) => {
    if (!ev || ev.runId == null) return;
    const st = stateByRun(ev.runId);
    if (st) return handle(st, ev);
    if (anyPending()) { if (!early.has(ev.runId)) early.set(ev.runId, []); early.get(ev.runId).push(ev); }   // else: a run that is no longer current
  });
  if (!unsubTabs) unsubTabs = on('tabs', () => {   // forget conversations of tabs that were closed
    const ids = new Set(S.tabs.map((t) => t.id));
    for (const [id, st] of states) if (!ids.has(id)) { if (st.running && st.runId) call(L().oracle.stop(st.runId), { silent: true }); clearTimeout(st.errTimer); states.delete(id); }
  });
}

/** What the model gets as context: the earlier finished turns of this tab. */
function historyOf(st) {
  const turns = [];
  for (const it of st.items) {
    if (it.kind === 'user') turns.push({ role: 'user', content: it.text });
    else if (it.kind === 'ai' && it.done && it.text) turns.push({ role: 'assistant', content: it.text });
  }
  return turns.slice(-HISTORY_TURNS);
}

function setWisp(st, s) { st.wisp = s; if (view?.st === st) view.wisp.setState(s); }

function handle(st, ev) {
  const v = view?.st === st ? view : null;
  switch (ev.type) {
    case 'role': {
      const r = ev.role; if (!ROLES.includes(r)) return;
      if (ev.state === 'active') { st.active.add(r); st.used.add(r); st.roleStates[r] = 'active'; }
      else { st.active.delete(r); if (st.used.has(r)) st.roleStates[r] = 'done'; }
      st.status = ev.state === 'active' ? (ev.detail || '') : '';
      if (st.wisp === 'speaking') setWisp(st, 'thinking');
      v?.roles();
      return;
    }
    case 'tool': {
      let step = null, holder = null;
      for (const it of st.items) if (it.kind === 'steps') { const s = it.steps.find((x) => x.callId === ev.callId); if (s) { step = s; holder = it; } }
      if (!step) {
        const last = st.items[st.items.length - 1];
        holder = last?.kind === 'steps' ? last : addItem(st, { kind: 'steps', steps: [] });
        step = { callId: ev.callId, title: '', status: 'running', summary: '' }; holder.steps.push(step); st.tools++;
        if (v) v.addStep(holder, step);
      }
      step.title = ev.title || step.title; step.status = ev.status || step.status; step.summary = ev.summary || '';
      if (ev.status === 'denied') { const ap = st.items.find((i) => i.kind === 'approval' && i.callId === ev.callId && i.state === 'pending'); if (ap) { ap.state = 'denied'; v?.updateApproval(ap); } }
      if (st.ai) st.ai.streaming = false, v?.updateAi(st.ai);
      st.ai = null;   // text after a tool call starts a fresh bubble, below the steps
      if (st.wisp === 'speaking') setWisp(st, 'thinking');
      v?.updateStep(step);
      return;
    }
    case 'approval': {
      st.ai = null;
      const it = addItem(st, { kind: 'approval', callId: ev.callId, title: ev.title || 'Permission needed', detail: ev.detail || '', state: 'pending' });
      st.status = 'Waiting for your permission';
      v?.addItem(it); v?.roles();
      return;
    }
    case 'text': {
      if (!ev.delta) return;
      if (!st.ai) { st.ai = addItem(st, { kind: 'ai', text: '', citations: [], streaming: true, done: false }); v?.addItem(st.ai); }
      st.ai.text += ev.delta;
      if (st.wisp !== 'speaking') setWisp(st, 'speaking');
      v?.updateAi(st.ai, true);
      return;
    }
    case 'done': return finish(st, ev);
    case 'error': return finish(st, ev);
  }
}

function addItem(st, it) { st.items.push(it); return it; }

function finish(st, ev) {
  const v = view?.st === st ? view : null;
  const ok = ev.type === 'done';
  const longRun = ok && (st.tools >= LONG_RUN_TOOLS || Date.now() - st.startedAt >= LONG_RUN_MS);
  st.running = false; st.pending = false; st.stopping = false; st.runId = null; st.status = '';
  for (const r of st.active) st.roleStates[r] = ok ? 'done' : 'idle';
  if (ok) for (const r of ev.roles || []) if (ROLES.includes(r)) st.roleStates[r] = 'done';
  if (!ok) for (const r of Object.keys(st.roleStates)) if (st.roleStates[r] === 'active') delete st.roleStates[r];
  st.active.clear();
  for (const it of st.items) {
    if (it.kind === 'approval' && it.state === 'pending') { it.state = 'denied'; it.result = 'No answer'; v?.updateApproval(it); }
    if (it.kind === 'steps') for (const s of it.steps) if (s.status === 'running') { s.status = ok ? 'done' : 'error'; v?.updateStep(s); }
  }
  if (ok) {
    // The final answer replaces any narration bubbles streamed between tool calls.
    const mine = st.items.filter((i) => i.kind === 'ai' && !i.done);
    let fin = mine[mine.length - 1];
    for (const it of mine) if (it !== fin) { st.items.splice(st.items.indexOf(it), 1); v?.removeItem(it); }
    if (!fin) { fin = addItem(st, { kind: 'ai', text: '', citations: [], streaming: false, done: false }); v?.addItem(fin); }
    fin.text = ev.answer ?? fin.text; fin.citations = Array.isArray(ev.citations) ? ev.citations : []; fin.streaming = false; fin.done = true;
    v?.updateAi(fin); v?.cites(fin);
    setWisp(st, 'idle');
  } else {
    for (const it of st.items) if (it.kind === 'ai' && !it.done) { it.streaming = false; if (!it.text) { st.items.splice(st.items.indexOf(it), 1); v?.removeItem(it); } else { it.done = true; v?.updateAi(it); } }
    const stopped = /^stopped\.?$/i.test(ev.message || '');
    const it = addItem(st, { kind: 'err', text: ev.message || 'The Oracle could not answer.' }); v?.addItem(it);
    if (stopped) setWisp(st, 'idle');
    else { setWisp(st, 'error'); clearTimeout(st.errTimer); st.errTimer = setTimeout(() => { if (st.wisp === 'error') setWisp(st, 'idle'); }, 2600); }
  }
  st.ai = null;
  if (v) { v.roles(); v.running(); v.refreshSend(); if (longRun) v.wisp.manifest(); }
}

/* ---------------- sending / stopping ---------------- */
async function send(st, text) {
  text = String(text ?? '').trim();
  if (!text || st.running || st.pending) return;
  const history = historyOf(st);
  clearTimeout(st.errTimer);
  st.active.clear(); st.used.clear(); st.roleStates = {}; st.tools = 0; st.startedAt = Date.now(); st.status = ''; st.ai = null; st.stopping = false;
  st.running = true; st.pending = true; st.draft = '';
  const u = addItem(st, { kind: 'user', text });
  const v = view?.st === st ? view : null;
  if (v) { v.council.reset(); v.addItem(u, true); v.roles(); v.running(); }
  setWisp(st, 'thinking');
  let runId = null;
  try { runId = (await L().oracle.ask(st.tabId, text, { history }))?.runId ?? null; }
  catch (e) { st.pending = false; early.clear(); finish(st, { type: 'error', message: errText(e, 'The Oracle could not answer.') }); return; }
  if (!st.running) return;   // new conversation started meanwhile
  st.pending = false; st.runId = runId;
  const queued = early.get(runId) || []; early.delete(runId);
  if (!anyPending()) early.clear();
  for (const ev of queued) { if (stateByRun(runId) !== st) break; handle(st, ev); }
}

function stop(st) {
  if (!st.running || st.stopping) return;
  st.stopping = true;
  if (st.runId) call(L().oracle.stop(st.runId), { silent: true });
  setTimeout(() => { if (st.running && st.stopping) finish(st, { type: 'error', message: 'Stopped.' }); }, 1500);   // the backend normally reports it first
}

function newConversation(st) {
  if (st.running && st.runId) call(L().oracle.stop(st.runId), { silent: true });
  clearTimeout(st.errTimer);
  st.items = []; st.runId = null; st.pending = false; st.running = false; st.stopping = false; st.active.clear(); st.used.clear(); st.roleStates = {}; st.status = ''; st.ai = null; st.wisp = 'idle'; st.draft = '';
}

/* ---------------- view ---------------- */
export function disposeOracle() { if (view) { view.destroy(); view = null; } }

export function viewOracle(body, t, intent) {
  disposeOracle();
  ensureListeners();
  const st = stateFor(t.id);
  const aborts = [];     // cleanup callbacks
  let raf = 0; const dirty = new Set();

  /* chrome */
  const wisp = createWisp({ size: 75 });
  const council = createCouncil();
  const statusEl = h('div.o-sr', { role: 'status', 'aria-live': 'polite' });
  const input = h('textarea', { rows: 1, placeholder: 'Ask the Oracle about this page…', 'aria-label': 'Ask the Oracle about this page', dir: 'auto', spellcheck: true });
  const sendBtn = h('button.o-send', { type: 'submit', 'aria-label': 'Send', title: 'Send (Enter)' });
  const stopBtn = h('button.o-stop', { type: 'button', 'aria-label': 'Stop', title: 'Stop', onClick: () => stop(st) });
  const composer = h('form.o-composer', { onSubmit: (e) => { e.preventDefault(); submit(); } }, input, sendBtn, stopBtn);
  const slot = h('div.o-wisp-slot', wisp.el);
  const foot = h('div.o-foot', slot, council.el, composer);
  const log = h('div.o-log', { role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation' });
  const memBtn = h('button.o-act', { type: 'button', title: 'Memory', 'aria-label': 'Memory', 'aria-pressed': 'false', onClick: () => toggleMemory() }, icon('book'), h('span', 'Memory'));
  const newBtn = h('button.o-act', { type: 'button', title: 'New conversation', 'aria-label': 'New conversation', onClick: () => { newConversation(st); draw(); setMemory(false); input.focus(); } }, icon('plus'), h('span', 'New'));
  const note = h('div.o-note.warn', h('b', 'AI is not set up yet. '), 'Add your Claude API key to use the Oracle. ',
    h('button.o-btn', { type: 'button', style: { marginTop: '8px' }, onClick: () => openInternal('lintas://settings') }, icon('key'), 'Open settings'));
  const memory = h('div.o-memory');
  const root = h('div.oracle', { dataset: { state: 'idle', view: 'chat' } },
    h('div.o-bg', { 'aria-hidden': 'true' }, h('i.o-bg-paper'), h('i.o-bg-scene'), h('i.o-bg-motes'), h('i.o-bg-corner.tl'), h('i.o-bg-corner.br')),
    h('header.o-head', h('span.o-crest', { 'aria-hidden': 'true' }),
      h('div.o-title', h('h2.o-name', 'AI Oracle'), h('span.o-tag', 'Many Minds. One Guiding Light.')),
      h('div.o-actions', memBtn, newBtn), h('i.o-trim', { 'aria-hidden': 'true' })),
    h('div.o-context', favicon(t.favicon, t.url, t.favicon ? null : 'globe'), h('span.o-context-title', { dir: 'auto' }, tabTitle(t)), h('span.o-context-host', hostOf(t.url))),
    note, log, memory, foot, statusEl);

  /* item rendering */
  const citeTo = (n) => call(L().ai.highlight(t.id, n));
  const stepEl = (s) => { s.el = h('div.o-step', { role: 'listitem' }, h('span.o-step-ic', { 'aria-hidden': 'true' }), s.tEl = h('span.o-step-title'), s.sEl = h('span.o-step-sum')); paintStep(s); return s.el; };
  function paintStep(s) { s.el.dataset.status = s.status; s.tEl.textContent = s.title; s.sEl.textContent = s.summary || ''; s.sEl.hidden = !s.summary; }
  function paintApproval(it) {
    it.el.dataset.state = it.state;
    it.resEl.textContent = it.state === 'allowed' ? 'Allowed' : (it.result || 'Not allowed');
  }
  function paintAi(it) {
    it.body.replaceChildren();
    if (!it.text) it.body.append(h('span.o-caret'));
    else it.body.append(...renderMarkdown(it.text, { onCite: citeTo }).childNodes);
    if (it.streaming) it.el.setAttribute('data-streaming', ''); else it.el.removeAttribute('data-streaming');
  }
  function paintCites(it) {
    it.citeEl?.remove(); it.citeEl = null;
    if (!it.citations?.length) return;
    it.citeEl = h('div.o-cites', it.citations.map((c) => h('button.o-cite', { type: 'button', title: 'Show on the page', onClick: () => citeTo(c.n) }, h('b', `[${c.n}]`), h('span', { dir: 'auto' }, '“' + c.quote + (c.quote.length >= 138 ? '…' : '') + '”'))));
    it.el.append(it.citeEl);
  }
  function answer(it, allow) {
    if (it.state !== 'pending') return;
    it.state = allow ? 'allowed' : 'denied'; paintApproval(it);
    st.status = ''; api.roles();
    if (st.runId) call(L().oracle.approve(st.runId, it.callId, allow), { silent: true });
  }
  function build(it) {
    switch (it.kind) {
      case 'user': return (it.el = h('div.o-msg.user', { dir: 'auto' }, it.text));
      case 'steps': it.el = h('div.o-steps', { role: 'list' }, it.steps.map(stepEl)); return it.el;
      case 'approval': {
        it.resEl = h('div.o-approval-result');
        it.el = h('div.o-approval', { role: 'group', 'aria-label': 'Permission needed' },
          h('span.o-approval-kicker', 'Permission needed'), h('div.o-approval-head', it.title), h('p.o-approval-detail', it.detail),
          h('div.o-approval-actions', h('button.o-btn.primary', { type: 'button', onClick: () => answer(it, true) }, 'Allow'), h('button.o-btn', { type: 'button', onClick: () => answer(it, false) }, 'Don’t allow')), it.resEl);
        paintApproval(it); return it.el;
      }
      case 'ai': {
        it.body = h('div.o-body.md');
        it.el = h('div.o-msg.ai', h('div.o-who', 'Oracle'), it.body);
        paintAi(it); paintCites(it); return it.el;
      }
      default: return (it.el = h('div.o-msg.err', { role: 'alert' }, it.text));
    }
  }
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 90;
  const toBottom = () => { log.scrollTop = log.scrollHeight; };
  function empty() {
    return h('div.o-empty', h('span.o-empty-kicker', 'Ancient Wisdom. Infinite Intelligence.'), h('h3', 'Ask about this page'),
      h('p', 'The Oracle reads the page, checks what it remembers, and answers with numbered citations like ', h('span.cite', '3'), ' that jump to the paragraph they come from.'),
      h('div.o-chips', CHIPS.map((q) => h('button.o-chip', { type: 'button', disabled: !S.status.hasApiKey, onClick: () => ask(q) }, q))));
  }
  function draw() {
    for (const it of st.items) { it.el = null; if (it.kind === 'steps') for (const s of it.steps) s.el = null; }
    mount(log, st.items.length ? st.items.map(build) : empty());
    toBottom();
  }

  /* live updates, called from handle() */
  const api = {
    st, wisp, council,
    addItem(it, force) { const stick = force || nearBottom(); if (log.firstElementChild?.classList.contains('o-empty')) log.replaceChildren(); log.append(build(it)); if (stick) toBottom(); },
    removeItem(it) { it.el?.remove(); },
    addStep(holder, s) { if (!holder.el) { api.addItem(holder); return; } const stick = nearBottom(); holder.el.append(stepEl(s)); if (stick) toBottom(); },
    updateStep(s) { if (s.el) paintStep(s); },
    updateApproval(it) { if (it.el) paintApproval(it); },
    updateAi(it, soft) {
      if (!it.el) return;
      if (soft) { dirty.add(it); if (!raf) raf = requestAnimationFrame(flush); } else { dirty.delete(it); paintAi(it); }
    },
    cites(it) { if (it.el) { const stick = nearBottom(); paintCites(it); if (stick) toBottom(); } },
    roles() {
      council.update({ ...st.roleStates }, { running: st.running, waiting: st.items.some((i) => i.kind === 'approval' && i.state === 'pending') });
      wisp.setRoles(st.used); wisp.setRoles(st.active);
      statusEl.textContent = st.status;
    },
    running() { root.dataset.state = st.running ? 'running' : 'idle'; },
    refreshSend,
    destroy() { cancelAnimationFrame(raf); raf = 0; for (const f of aborts) f(); wisp.destroy(); },
  };
  function flush() {
    raf = 0; const stick = nearBottom();
    for (const it of dirty) if (it.el) paintAi(it);
    dirty.clear(); if (stick) toBottom();
  }

  /* composer */
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; };
  function refreshSend() { sendBtn.disabled = !input.value.trim() || !S.status.hasApiKey; note.hidden = !!S.status.hasApiKey; }
  function ask(q) { input.value = ''; grow(); refreshSend(); return send(st, q); }
  function submit() { const q = input.value.trim(); if (!q || !S.status.hasApiKey || st.running) return; ask(q); }
  input.addEventListener('input', () => { st.draft = input.value; grow(); refreshSend(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); submit(); } });
  aborts.push(on('status', () => { refreshSend(); if (!st.items.length) draw(); }));

  /* memory view */
  let confirming = false;
  const setMemory = (open) => { root.dataset.view = open ? 'memory' : 'chat'; memBtn.setAttribute('aria-pressed', String(open)); if (open) loadMemory(); };
  const toggleMemory = () => { const open = root.dataset.view !== 'memory'; setMemory(open); if (!open) input.focus(); };
  async function loadMemory() {
    const list = await call(L().oracle.memory());
    if (root.dataset.view !== 'memory' || !memory.isConnected) return;
    paintMemory(Array.isArray(list) ? list : []);
  }
  function paintMemory(list) {
    const forgetAll = confirming
      ? h('span.o-confirm', { style: { display: 'inline-flex', gap: '6px' } },
        h('button.o-btn.danger', { type: 'button', onClick: async () => { confirming = false; await call(L().oracle.forget('*')); loadMemory(); } }, 'Yes, forget everything'),
        h('button.o-btn', { type: 'button', onClick: () => { confirming = false; paintMemory(list); } }, 'Keep'))
      : h('button.o-btn.danger', { type: 'button', disabled: !list.length, onClick: () => { confirming = true; paintMemory(list); } }, 'Forget all');
    mount(memory,
      h('div.o-memory-head', h('h3', 'What the Oracle remembers'), forgetAll),
      h('p.o-memory-hint', 'Saved on this computer. The Oracle may recall these in later conversations.'),
      list.length
        ? h('ul.o-memory-list', list.map((m) => h('li.o-memory-item', h('p.o-memory-text', { dir: 'auto' }, m.text), h('time.o-memory-date', { datetime: m.savedAt || '' }, m.savedAt ? 'Saved ' + fmtDate(m.savedAt) : ''),
          h('button.o-icon-btn', { type: 'button', 'aria-label': 'Forget this', title: 'Forget this', onClick: async () => { await call(L().oracle.forget(m.id)); loadMemory(); } }, icon('close')))))
        : h('div.o-memory-empty', 'Nothing saved yet. Ask the Oracle to remember something and it will appear here.'));
  }

  /* mount */
  view = api;
  mount(body, root);
  draw();
  input.value = st.draft; grow(); refreshSend();
  api.running();
  wisp.setState(st.wisp === 'idle' && st.running ? 'thinking' : st.wisp);
  if (st.wisp !== 'idle' || st.running || Object.keys(st.roleStates).length) api.roles();
  if (intent?.selection) { input.value = `About this passage: “${intent.selection}”\n`; st.draft = input.value; grow(); refreshSend(); }
  if (intent) input.focus();
  return api;
}

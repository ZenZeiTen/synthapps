// lintas://tms/file/<projectId>/<fileId> — the segment editor (two-column grid + CAT pane).
// Large files stay fast: segments are fetched in pages (offset/limit) and rows use content-visibility so
// only what is on screen is laid out and painted.
import { h, mount, clear, fmtNum, fmtPct, relTime, debounce, isMod, errText } from '../lib/dom.js';
import { icon, STATUSES, STATUS_LABEL, STATUS_ICON } from '../lib/icons.js';
import { S, L, call, on, modLabel } from '../lib/store.js';
import { segBar, statusIcon, langPair, matchBadge, emptyState, iconBtn, withBusy } from '../ui/widgets.js';
import { openMenu, toast } from '../ui/overlay.js';
import { tmMatch, termHit } from '../ui/sidepanel.js';
import { exportMenu, qaDialog, pretranslateDialog } from './project.js';
import { openInternal } from '../ui/toolbar.js';

const PAGE = 100;
const TAG_RE = /(\{[^{}\n]+\}|%\d*\$?[sd]|<\/?[a-zA-Z][^<>\n]*>)/g;
const CONFIRMED = ['translated', 'reviewed', 'approved'];

/** Text with placeholders/tags as chips and (optionally) termbase hits underlined. Text nodes only. */
function rich(text, terms) {
  const out = [];
  const plain = (s) => { let last = 0, m; TAG_RE.lastIndex = 0; while ((m = TAG_RE.exec(s))) { if (m.index > last) out.push(s.slice(last, m.index)); out.push(h('span.tagx', { title: 'Placeholder / tag — keep it in the translation' }, m[0])); last = TAG_RE.lastIndex; } if (last < s.length) out.push(s.slice(last)); };
  if (!terms?.length) { plain(text); return out; }
  const spans = []; // merge hits that cover the same range
  for (const t of terms) { const sp = spans.find((x) => x.start === t.start && x.end === t.end); if (sp) sp.hits.push(t); else if (!spans.some((x) => t.start < x.end && t.end > x.start)) spans.push({ start: t.start, end: t.end, hits: [t] }); }
  spans.sort((a, b) => a.start - b.start);
  let pos = 0;
  for (const sp of spans) {
    if (sp.start > pos) plain(text.slice(pos, sp.start));
    const forb = sp.hits.some((x) => x.status === 'forbidden'), pref = sp.hits.some((x) => x.status === 'preferred');
    out.push(h('span.termu', { class: !pref && !forb ? 'only-admitted' : (forb && !pref ? 'has-forbidden' : ''), title: sp.hits.map((x) => `${x.status === 'forbidden' ? '✕' : x.status === 'admitted' ? '○' : '✓'} ${x.target}`).join('   ') }, text.slice(sp.start, sp.end)));
    pos = sp.end;
  }
  if (pos < text.length) plain(text.slice(pos));
  return out;
}

export default function tmsEditor(el, ctx) {
  const { projectId: pid, fileId: fid } = ctx.params;
  const st = { project: null, file: null, total: 0, segs: [], offset: 0, filter: '', q: '', activeId: null, lookups: new Map(), ai: new Map(), issues: new Map(), index: null, token: 0, saving: 0 };
  const rows = new Map(); // seg id -> row element
  let ta = null;          // textarea of the active row

  /* ---------- skeleton ---------- */
  const title = h('h1', { dir: 'auto' }, 'Loading…');
  const crumbP = h('button.crumb', { type: 'button', onClick: () => ctx.navigate(`lintas://tms/project/${encodeURIComponent(pid)}`) }, 'Project');
  const pairSlot = h('span'), progress = h('div.ed-progress');
  const filterSel = h('select.select', { 'aria-label': 'Filter by status', onChange: () => { st.filter = filterSel.value; st.offset = 0; load(); } }, h('option', { value: '' }, 'All segments'), STATUSES.map((s) => h('option', { value: s }, STATUS_LABEL[s])));
  const search = h('input.input', { type: 'search', placeholder: 'Search source and target', 'aria-label': 'Search source and target', spellcheck: false, dir: 'auto', dataset: { pageSearch: '1' } });
  search.addEventListener('input', debounce(() => { st.q = search.value.trim(); st.offset = 0; load(); }, 250));
  const tool = (label, ic, fn, t) => { const b = h('button.btn.sm', { type: 'button', title: t, onClick: () => fn(b) }, icon(ic), label); return b; };
  const grid = h('div.ed-grid', { tabIndex: -1 }), cat = h('aside.ed-cat', { 'aria-label': 'Translation aids' }), foot = h('div.ed-foot');
  const savedEl = h('span.saved');
  mount(el, h('div.ed',
    h('div.ed-top',
      h('div.ed-title', h('button.crumb', { type: 'button', onClick: () => ctx.navigate('lintas://tms') }, 'Translation'), sepIcon(), crumbP, sepIcon(), title, pairSlot, h('span.grow'), savedEl),
      h('div.row', { style: { gap: '16px', flexWrap: 'wrap' } }, progress,
        h('div.ed-tools', filterSel, h('div.search-field', icon('search'), search),
          tool('Pre-translate', 'wand', async () => { const r = await pretranslateDialog(pid, [st.file], st.file.id); if (r) { st.lookups.clear(); load(true); } }, 'Fill empty targets from TM (and AI)'),
          tool('QA', 'qa', (b) => runQa(b, true), 'Run quality checks on this file'),
          tool('Terms', 'sparkle', (b) => extractTerms(b), 'Let AI propose termbase entries from this file'),
          tool('Export', 'exportOut', (b) => exportMenu(b, pid, fid))))),
    grid, cat, foot));
  function sepIcon() { const i = icon('chevRight'); i.classList.add('sepic'); return i; }

  /* ---------- data ---------- */
  async function load(keepActive) {
    const tk = ++st.token;
    const r = await call(L().tms.getFile(pid, fid, { offset: st.offset, limit: PAGE, status: st.filter || undefined, q: st.q || undefined }), { silent: true });
    if (tk !== st.token) return;
    if (!r) return mount(grid, emptyState('file', 'File not found', 'It may have been deleted from the project.'));
    st.file = r.file; st.total = r.total; st.segs = r.segments;
    title.textContent = r.file.name; ctx.setTitle(r.file.name);
    drawProgress(); drawGrid(); drawFoot();
    const want = st.pending || (keepActive && st.activeId);
    st.pending = null;
    const target = st.segs.find((s) => s.id === want) || st.segs.find((s) => !CONFIRMED.includes(s.status) && !s.locked) || st.segs[0];
    st.activeId = null;
    if (target) activate(target.id, { focus: !el.hidden && !document.querySelector('#overlays .backdrop'), scroll: true }); else drawCat(null);
  }
  async function loadProject() { const p = await call(L().tms.getProject(pid), { silent: true }); if (p) { st.project = p; crumbP.textContent = p.name; mount(pairSlot, langPair(p.sourceLang, p.targetLang)); } }

  function drawProgress() {
    const s = st.file.stats;
    mount(progress, h('span.pct', fmtPct(s.progress)), segBar(s),
      h('div.legend', STATUSES.map((k) => h('span.row', { style: { gap: '4px' }, title: STATUS_LABEL[k] }, statusIcon(k), h('b', fmtNum(s.byStatus[k] || 0))))),
      h('span.muted', `${fmtNum(s.words)} words`));
  }
  function adjustStats(from, to) {
    if (from === to || !st.file) return; const s = st.file.stats;
    s.byStatus[from] = Math.max(0, (s.byStatus[from] || 0) - 1); s.byStatus[to] = (s.byStatus[to] || 0) + 1;
    s.progress = s.segments ? CONFIRMED.reduce((a, k) => a + (s.byStatus[k] || 0), 0) / s.segments : 0; drawProgress();
  }

  /* ---------- grid ---------- */
  function drawGrid() {
    rows.clear(); ta = null;
    const src = (st.project?.sourceLang || '').toUpperCase(), tgt = (st.project?.targetLang || '').toUpperCase();
    if (!st.segs.length) return mount(grid, h('div.ed-empty', emptyState('filter', st.filter || st.q ? 'No segments match the filter' : 'This file has no segments', st.filter || st.q ? 'Clear the status filter or the search to see all segments.' : '')));
    mount(grid, h('div.ed-cols', h('div', '#'), h('div', 'Source' + (src ? ' · ' + src : '')), h('div', 'Target' + (tgt ? ' · ' + tgt : '')), h('div', 'Status')), st.segs.map(rowEl));
    grid.scrollTop = 0;
  }
  function rowEl(s) {
    const row = h('div.seg', { dataset: { id: s.id }, class: s.locked ? 'locked' : '', role: 'row' });
    fillRow(row, s); rows.set(s.id, row);
    row.addEventListener('mousedown', (e) => { if (st.activeId !== s.id && !e.target.closest('.st-btn')) { e.preventDefault(); activate(s.id, { focus: true }); } });
    return row;
  }
  function fillRow(row, s) {
    const active = st.activeId === s.id;
    row.classList.toggle('active', active); row.classList.toggle('locked', !!s.locked);
    const issues = st.issues.get(s.id) || []; const worst = issues.some((i) => i.severity === 'critical') ? 'critical' : '';
    const tcell = h('div.seg-tgt', { dir: 'auto', lang: st.project?.targetLang, class: !active && !s.target ? 'empty' : '', dataset: { ph: s.locked ? 'Locked' : 'Click to translate' } });
    if (active) {
      ta = h('textarea', { rows: 1, dir: 'auto', lang: st.project?.targetLang, spellcheck: true, 'aria-label': `Translation of segment ${s.n}`, readOnly: !!s.locked }, s.target || '');
      ta.addEventListener('input', () => { autoGrow(); onType(s); });
      ta.addEventListener('keydown', (e) => onEditorKey(e));
      tcell.appendChild(ta);
    } else if (s.target) mount(tcell, rich(s.target));
    const srcCell = h('div.seg-src', { dir: 'auto', lang: st.project?.sourceLang }, s.key ? h('span.seg-key', s.key) : null, rich(s.source, active ? st.lookups.get(s.id)?.terms : null));
    const stBtn = h('button.st-btn', { type: 'button', title: `${STATUS_LABEL[s.status]} — change status`, 'aria-label': `Status: ${STATUS_LABEL[s.status]}. Change status`, onClick: () => statusMenu(stBtn, s) }, statusIcon(s.status));
    mount(row, h('div.seg-n', String(s.n), s.locked ? icon('lock') : null), srcCell, tcell,
      h('div.seg-meta', stBtn, matchBadge(s.matchScore), issues.length ? h('span.flag', { class: worst, title: issues.map((i) => i.message).join('\n') }, icon('warning')) : null, s.comment ? h('span.cmt', { title: s.comment }, icon('comment')) : null));
    if (active) requestAnimationFrame(autoGrow);
  }
  function autoGrow() { if (!ta) return; ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; }
  const seg = (id) => st.segs.find((s) => s.id === id);
  const activeSeg = () => seg(st.activeId);

  function activate(id, { focus = true, scroll = false } = {}) {
    if (st.activeId === id) { if (focus) ta?.focus(); return; }
    flush();
    const prev = st.activeId; st.activeId = id;
    if (prev && rows.has(prev) && seg(prev)) fillRow(rows.get(prev), seg(prev));
    const s = seg(id), row = rows.get(id); if (!s || !row) return;
    fillRow(row, s);
    if (scroll) { const r = row.getBoundingClientRect(), g = grid.getBoundingClientRect(); if (r.top < g.top + 40 || r.bottom > g.bottom - 20) grid.scrollTop += r.top - g.top - Math.min(160, g.height / 3); }
    else row.scrollIntoView({ block: 'nearest' });
    if (focus && ta) { ta.focus({ preventScroll: true }); const n = ta.value.length; ta.setSelectionRange(n, n); }
    drawCat(s); drawFoot();
  }

  /* ---------- saving ---------- */
  const autosave = debounce(() => flush(), 700);
  function onType(s) { s._dirty = true; autosave(); setSaved('Unsaved changes'); }
  function setSaved(text, ok) { mount(savedEl, ok ? icon('check') : null, text); savedEl.classList.toggle('muted', true); }
  async function flush() {
    autosave.cancel();
    const s = activeSeg(); if (!s || !s._dirty || !ta) return;
    const value = ta.value; s._dirty = false;
    const patch = { target: value }; if (s.status === 'new' && value) patch.status = 'draft';
    await save(s, patch, { soft: true });
  }
  async function save(s, patch, { soft } = {}) {
    st.saving++; setSaved('Saving…');
    const before = s.status;
    const r = await call(L().tms.updateSegment(pid, fid, s.id, patch));
    st.saving--;
    if (!r) { setSaved('Not saved'); return null; }
    const dirty = s._dirty; Object.assign(s, r); s._dirty = dirty;
    adjustStats(before, s.status);
    if (!st.saving) setSaved('All changes saved', true);
    const row = rows.get(s.id);
    if (row) { if (soft && st.activeId === s.id) { // keep the textarea (and the caret) while typing; only refresh the meta cell
      const fresh = h('div'); const keep = ta; fillRowMeta(row, s); void fresh; ta = keep; } else fillRow(row, s); }
    return s;
  }
  function fillRowMeta(row, s) {
    const issues = st.issues.get(s.id) || []; const worst = issues.some((i) => i.severity === 'critical') ? 'critical' : '';
    const stBtn = h('button.st-btn', { type: 'button', title: `${STATUS_LABEL[s.status]} — change status`, 'aria-label': `Status: ${STATUS_LABEL[s.status]}. Change status`, onClick: () => statusMenu(stBtn, s) }, statusIcon(s.status));
    mount(row.lastElementChild, stBtn, matchBadge(s.matchScore), issues.length ? h('span.flag', { class: worst, title: issues.map((i) => i.message).join('\n') }, icon('warning')) : null, s.comment ? h('span.cmt', { title: s.comment }, icon('comment')) : null);
    row.classList.toggle('locked', !!s.locked); if (ta) ta.readOnly = !!s.locked;
    mount(row.firstElementChild, String(s.n), s.locked ? icon('lock') : null);
  }
  function statusMenu(anchor, s) {
    openMenu(anchor, [{ header: `Segment ${s.n}` }, ...STATUSES.map((k) => ({ label: STATUS_LABEL[k], icon: (() => { const i = icon(STATUS_ICON[k]); i.style.color = `var(--st-${k})`; return i; })(), disabled: s.locked || (k !== 'new' && k !== 'draft' && !(st.activeId === s.id && ta ? ta.value : s.target)), onClick: async () => { if (st.activeId === s.id) await flush(); await save(s, { status: k }); refreshQaFor(s); if (st.activeId === s.id) drawCat(s); } })),
      { sep: true }, { label: s.locked ? 'Unlock segment' : 'Lock segment', icon: s.locked ? 'unlock' : 'lock', shortcut: `${modLabel()}Shift+L`, onClick: () => toggleLock(s) }], { align: 'right' });
  }
  async function toggleLock(s) { if (st.activeId === s.id) await flush(); await save(s, { locked: !s.locked }); if (st.activeId === s.id) { drawCat(s); ta?.focus(); } }

  async function confirm() {
    const s = activeSeg(); if (!s || !ta) return;
    if (s.locked) { toast('info', 'This segment is locked.'); return move(1); }
    if (!ta.value.trim()) { toast('info', 'Type a translation before confirming.'); return; }
    autosave.cancel(); s._dirty = false;
    const status = s.status === 'reviewed' || s.status === 'approved' ? s.status : 'translated';
    const r = await save(s, { target: ta.value, status });
    if (!r) return;
    st.lookups.delete(s.id); refreshQaFor(s);
    await move(1, true);
  }
  async function move(d, skipDone) {
    await flush();
    const i = st.segs.findIndex((s) => s.id === st.activeId); let j = i + d;
    if (skipDone) { while (st.segs[j] && (st.segs[j].locked)) j += d; }
    if (st.segs[j]) return activate(st.segs[j].id, { focus: true, scroll: true });
    if (d > 0 && st.offset + PAGE < st.total) { st.offset += PAGE; await load(); }
    else if (d < 0 && st.offset > 0) { st.offset = Math.max(0, st.offset - PAGE); await load(); const last = st.segs[st.segs.length - 1]; if (last) activate(last.id, { focus: true, scroll: true }); }
    else if (d > 0 && i >= 0) toast('success', 'End of file reached', 1800);
  }
  function setTarget(text, { replace = true } = {}) {
    const s = activeSeg(); if (!s || !ta) return; if (s.locked) return toast('info', 'This segment is locked.');
    if (replace) ta.value = text; else { const a = ta.selectionStart, b = ta.selectionEnd; ta.setRangeText(text, a, b, 'end'); }
    ta.focus(); autoGrow(); onType(s);
  }
  function onEditorKey(e) {
    const mod = isMod(e), k = e.key;
    if (mod && k === 'Enter') { e.preventDefault(); confirm(); }
    else if (mod && !e.shiftKey && (k === 'ArrowDown' || k === 'ArrowUp')) { e.preventDefault(); move(k === 'ArrowDown' ? 1 : -1); }
    else if (mod && !e.shiftKey && !e.altKey && /^[1-5]$/.test(k)) { e.preventDefault(); const m = st.lookups.get(st.activeId)?.matches?.[Number(k) - 1]; if (m) setTarget(m.target); else toast('info', `There is no match ${k} for this segment.`, 1800); }
    else if (mod && e.shiftKey && k.toLowerCase() === 's') { e.preventDefault(); const s = activeSeg(); if (s) setTarget(s.source); }
    else if (mod && e.shiftKey && k.toLowerCase() === 'l') { e.preventDefault(); const s = activeSeg(); if (s) toggleLock(s); }
    else if (k === 'Escape') { e.stopPropagation(); }
    else return;
    e.stopPropagation();
  }
  grid.addEventListener('keydown', (e) => { if (e.target === ta) return; if (isMod(e) && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); move(e.key === 'ArrowDown' ? 1 : -1); } });

  /* ---------- CAT pane ---------- */
  function sec(titleNodes, ...kids) { return h('section.cat-sec', h('div.cat-title', titleNodes), kids); }
  async function drawCat(s) {
    if (!s) return mount(cat, h('div.cat-sec', h('div.cat-none', 'Select a segment to see translation-memory matches, terms and AI help.')));
    const tmBox = h('div', { style: { display: 'grid', gap: '6px' } }, h('div.skeleton', { style: { height: '64px' } }));
    const termBox = h('div', { style: { display: 'grid', gap: '6px' } }, h('div.skeleton', { style: { height: '40px' } }));
    const tmN = h('span.n', '…'), termN = h('span.n', '…');
    const aiBox = h('div', { style: { display: 'grid', gap: '8px' } });
    const sugBtn = h('button.btn.sm', { type: 'button', title: 'Ask Claude for a translation that uses the TM matches, termbase and neighbouring segments' }, icon('sparkle'), 'Suggest');
    const revBtn = h('button.btn.sm', { type: 'button', title: 'Ask Claude to review this translation (MQM-style)' }, icon('qa'), 'Review');
    const comment = h('textarea.textarea.cat-comment', { rows: 2, placeholder: 'Comment for reviewers…', 'aria-label': 'Segment comment', dir: 'auto' }, s.comment || '');
    comment.addEventListener('change', async () => { await save(s, { comment: comment.value.trim() || null }, { soft: st.activeId === s.id }); });
    comment.addEventListener('keydown', (e) => e.stopPropagation());
    const issues = st.issues.get(s.id) || [];
    const drawAi = () => {
      const a = st.ai.get(s.id) || {};
      mount(aiBox,
        a.error ? h('div.msg.err', a.error) : null,
        a.pending ? h('div.row.muted', h('span.spinner'), a.pending === 'review' ? 'Reviewing the translation…' : 'Writing a suggestion…') : null,
        a.suggest ? h('div.ai-card', h('div.ai-text', { dir: 'auto' }, a.suggest.target), a.suggest.rationale ? h('div.ai-why', a.suggest.rationale) : null,
          h('div.ai-meta', h('span', `${a.suggest.usedMatches || 0} TM matches · ${a.suggest.usedTerms || 0} terms used`), h('span.grow'), h('button.btn.sm.primary', { type: 'button', onClick: () => setTarget(a.suggest.target) }, 'Insert'))) : null,
        a.review ? h('div.ai-card', h('div.row', h('span.chip', { class: a.review.verdict === 'ok' ? 'ok' : 'warn' }, icon(a.review.verdict === 'ok' ? 'circleCheck' : 'warning'), a.review.verdict === 'ok' ? 'Looks good' : 'Revise'), h('span.muted', { style: { fontSize: '12px' } }, 'AI review')),
          (a.review.issues || []).map((i) => h('div.ai-issue', h('div.hd', h('span.sev.sev-' + i.severity), `${i.category} · ${i.severity}`), h('div', { dir: 'auto' }, i.explanation), i.suggestion ? h('div.muted', { dir: 'auto' }, 'Suggestion: ' + i.suggestion) : null)),
          a.review.revised ? [h('div.ai-text', { dir: 'auto' }, a.review.revised), h('div.ai-meta', h('span.grow'), h('button.btn.sm.primary', { type: 'button', onClick: () => setTarget(a.review.revised) }, 'Use revision'))] : null) : null,
        !a.suggest && !a.review && !a.error && !a.pending ? h('div.cat-none', S.status.hasApiKey ? 'Suggestions are proposals only — nothing is written until you insert it.' : ['Add a Claude API key to use AI. ', h('a', { role: 'link', tabIndex: 0, onClick: () => openInternal('lintas://settings') }, 'Open settings')]) : null);
    };
    const runAi = (btnEl, kind) => withBusy(btnEl, async () => {
      await flush(); const a = st.ai.get(s.id) || {}; st.ai.set(s.id, a); a.error = null; a.pending = kind; st.redrawAi?.();
      try { a[kind] = await L().ai[kind](pid, fid, s.id); } catch (e) { a.error = errText(e, 'The AI request failed.'); }
      a.pending = null;
      if (st.activeId === s.id) st.redrawAi?.(); // the pane may have been rebuilt meanwhile
    });
    sugBtn.addEventListener('click', () => runAi(sugBtn, 'suggest')); revBtn.addEventListener('click', () => { if (!(ta?.value || s.target)) return toast('info', 'There is no translation to review yet.'); runAi(revBtn, 'review'); });
    mount(cat,
      sec([icon('database'), h('span.grow', 'Translation memory'), tmN], tmBox),
      sec([icon('book'), h('span.grow', 'Terms'), termN], termBox),
      sec([icon('sparkle'), h('span.grow', 'AI'), sugBtn, revBtn], aiBox),
      issues.length ? sec([icon('warning'), h('span.grow', 'QA'), h('span.n', String(issues.length))], issues.map((i) => h('div.issue', h('span.sev.sev-' + i.severity), h('span.msg', { dir: 'auto' }, i.message), h('span'), h('span.chk', `${i.check} · ${i.severity}`)))) : null,
      sec([icon('comment'), h('span.grow', 'Comment')], comment),
      sec([icon('info'), h('span.grow', 'Segment')], h('dl.cat-info', h('dt', 'Status'), h('dd', STATUS_LABEL[s.status] + (s.locked ? ' · locked' : '')),
        s.key ? [h('dt', 'Key'), h('dd', s.key)] : null, s.note ? [h('dt', 'Note'), h('dd', { dir: 'auto' }, s.note)] : null,
        h('dt', 'Origin'), h('dd', { tm: 'Translation memory', 'mt-ai': 'AI suggestion', human: 'Typed by a translator' }[s.origin] || '—'),
        h('dt', 'Updated'), h('dd', s.updatedAt ? relTime(s.updatedAt) : '—'))),
      h('div', { style: { height: '16px', flex: 'none' } }));
    st.redrawAi = drawAi; drawAi();
    let lk = st.lookups.get(s.id);
    if (!lk) { lk = await call(L().tms.lookup(pid, s.source), { silent: true }); if (lk) st.lookups.set(s.id, lk); }
    if (st.activeId !== s.id) return;
    if (!lk) { mount(tmBox, h('div.cat-none', 'Lookup failed.')); mount(termBox); return; }
    tmN.textContent = String(lk.matches.length); termN.textContent = String(lk.terms.length);
    mount(tmBox, lk.matches.length ? lk.matches.map((m, i) => tmMatch(m, i + 1, (x) => setTarget(x.target))) : h('div.cat-none', 'No match of 50% or better.'));
    mount(termBox, lk.terms.length ? lk.terms.map((t) => termHit(t, (x) => setTarget(x.target, { replace: false }))) : h('div.cat-none', 'No termbase entries in this segment.'));
    // underline the hits in the active source cell
    const row = rows.get(s.id); if (row && lk.terms.length) mount(row.children[1], s.key ? h('span.seg-key', s.key) : null, rich(s.source, lk.terms));
  }

  /* ---------- QA + terms ---------- */
  async function runQa(button, show) {
    const go = async () => {
      const r = await call(L().tms.qa(pid, fid), { silent: !show }); if (!r) return;
      st.issues.clear(); for (const i of r.issues) { if (!st.issues.has(i.segmentId)) st.issues.set(i.segmentId, []); st.issues.get(i.segmentId).push(i); }
      for (const [id, row] of rows) { const s = seg(id); if (s && id !== st.activeId) fillRow(row, s); else if (s) fillRowMeta(row, s); }
      if (show) qaDialog(`Quality check — ${st.file.name}`, r, (i) => goToSegment(i.segmentId));
      else if (activeSeg() && st.issues.has(st.activeId)) drawCat(activeSeg());
    };
    if (button) await withBusy(button, go); else await go();
  }
  const refreshQaFor = debounce(() => runQa(null, false), 600);
  async function goToSegment(id) {
    if (seg(id)) return activate(id, { focus: true, scroll: true });
    // the contract's Issue carries only a segment id: build an id -> position index once, in chunks
    if (!st.index) { st.index = new Map(); let off = 0; for (;;) { const r = await call(L().tms.getFile(pid, fid, { offset: off, limit: 500 })); if (!r) break; r.segments.forEach((s, i) => st.index.set(s.id, off + i)); off += r.segments.length; if (off >= r.total || !r.segments.length) break; } }
    const pos = st.index.get(id); if (pos == null) return toast('info', 'That segment is no longer in this file.');
    st.filter = ''; filterSel.value = ''; st.q = ''; search.value = ''; st.offset = Math.floor(pos / PAGE) * PAGE; st.pending = id; await load();
  }
  async function extractTerms(button) {
    await withBusy(button, async () => {
      let r; try { r = await L().ai.extractTerms(pid, fid); } catch (e) { return toast('error', errText(e, 'Term extraction failed.')); }
      const tbId = st.project?.termbaseIds?.[0];
      const { openDialog } = await import('../ui/overlay.js');
      openDialog({ title: 'Proposed terms', width: 640, content: [h('p', 'Proposals from this file. Nothing is saved until you add a term.'),
        r.terms.length ? h('div.term-table', h('table.tbl', h('thead', h('tr', h('th', 'Source'), h('th', 'Target'), h('th.num', 'Freq.'), h('th', 'Note'), h('th', ''))), h('tbody', r.terms.map((t) => { const add = h('button.btn.sm', { type: 'button', disabled: !tbId, onClick: async () => { const x = await call(L().tms.addTerm(tbId, { source: t.source, target: t.target, status: 'preferred', note: t.note || '' })); if (x) { add.disabled = true; mount(add, icon('check'), 'Added'); st.lookups.clear(); } } }, icon('plus'), 'Add');
          return h('tr', h('td', { dir: 'auto' }, t.source), h('td', { dir: 'auto', style: { fontWeight: 600 } }, t.target), h('td.num', String(t.frequency ?? '')), h('td.muted', { dir: 'auto', style: { fontSize: '12px' } }, t.note || ''), h('td', add)); })))) : h('p', 'No new term candidates were found.')],
      actions: [{ label: 'Done', kind: 'primary', primary: true }] });
    });
  }

  /* ---------- footer ---------- */
  function drawFoot() {
    const s = activeSeg(); const m = modLabel(); const from = st.total ? st.offset + 1 : 0, to = Math.min(st.total, st.offset + st.segs.length);
    const jump = h('input.input', { type: 'number', min: 1, placeholder: '#', 'aria-label': 'Go to segment number', title: 'Go to segment number' });
    jump.addEventListener('keydown', async (e) => { e.stopPropagation(); if (e.key !== 'Enter') return; const n = Number(jump.value); if (!n) return; await flush();
      const local = st.segs.find((x) => x.n === n); if (local) return activate(local.id, { focus: true, scroll: true });
      st.filter = ''; filterSel.value = ''; st.q = ''; search.value = ''; st.offset = Math.max(0, Math.floor((n - 1) / PAGE) * PAGE); await load(); const t = st.segs.find((x) => x.n === n); if (t) activate(t.id, { focus: true, scroll: true }); });
    const key = (k, label) => h('span', h('kbd.key', k), ' ', label);
    mount(foot, h('span', s ? `Segment ${fmtNum(s.n)}` : 'No segment', st.filter || st.q ? ` · ${fmtNum(st.total)} match the filter` : ` of ${fmtNum(st.file?.stats.segments || st.total)}`),
      h('div.keys', key(`${m}Enter`, 'confirm + next'), key(`${m}1–5`, 'insert match'), key(`${m}Shift+S`, 'copy source'), key(`${m}↑/↓`, 'move'), key(`${m}Shift+L`, 'lock')),
      h('span.grow'),
      h('div.pager', iconBtn('chevLeft', 'Previous page', async () => { await flush(); st.offset = Math.max(0, st.offset - PAGE); load(); }, 'sm'), h('span', `${fmtNum(from)}–${fmtNum(to)} of ${fmtNum(st.total)}`), iconBtn('chevRight', 'Next page', async () => { await flush(); st.offset += PAGE; load(); }, 'sm'), jump));
    const [prev, , next] = foot.querySelector('.pager').children; prev.disabled = st.offset <= 0; next.disabled = st.offset + PAGE >= st.total;
  }

  /* ---------- start ---------- */
  st.pending = S.pendingSegment.get(`${pid}/${fid}`) || null; S.pendingSegment.delete(`${pid}/${fid}`);
  mount(grid, h('div', { style: { padding: '16px', display: 'grid', gap: '10px' } }, [1, 2, 3, 4, 5, 6].map(() => h('div.skeleton', { style: { height: '40px' } }))));
  (async () => {
    await loadProject();
    if (st.pending) { const id = st.pending; st.pending = null; await load(); await goToSegment(id); } else await load();
    runQa(null, false);
  })();
  const offs = [on('terms-changed', () => { st.lookups.clear(); const s = activeSeg(); if (s) drawCat(s); })];
  const onHide = () => flush(); window.addEventListener('blur', onHide);
  return () => { flush(); offs.forEach((f) => f()); window.removeEventListener('blur', onHide); };
}

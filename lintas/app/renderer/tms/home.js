// lintas://tms — projects, translation memories, termbases.
import { h, mount, fmtNum, fmtPct, relTime, dueInfo, LANGS, debounce } from '../lib/dom.js';
import { icon, STATUSES, STATUS_LABEL } from '../lib/icons.js';
import { S, L, call, on, emit } from '../lib/store.js';
import { ring, segBar, langPair, statusIcon, emptyState, iconBtn, btn, searchField } from '../ui/widgets.js';
import { formDialog, openDialog, confirmDialog, openMenu, toast } from '../ui/overlay.js';
import { invalidateTmsCache } from '../ui/sidepanel.js';

const pairFields = (src, tgt) => [
  { name: 'sourceLang', label: 'Source language', type: 'select', options: LANGS, value: src, half: true },
  { name: 'targetLang', label: 'Target language', type: 'select', options: LANGS, value: tgt, half: true },
];

export function legend(stats) {
  return h('div.legend', STATUSES.map((s) => h('span.row', { style: { gap: '5px' } }, statusIcon(s), STATUS_LABEL[s], h('b', fmtNum(stats.byStatus[s] || 0)))));
}

export async function createProjectDialog() {
  const p = await formDialog({ title: 'New translation project', submit: 'Create project', width: 520, fields: [
    { name: 'name', label: 'Project name', required: true, placeholder: 'e.g. Panduan Pengguna v4' },
    ...pairFields(S.settings.defaultSourceLang || 'id', S.settings.defaultTargetLang || 'en'),
    { name: 'client', label: 'Client (optional)', half: true }, { name: 'dueDate', label: 'Due date (optional)', type: 'date', half: true },
  ], intro: 'A project translation memory and termbase are created and attached automatically.',
  onSubmit: async (v) => { if (v.sourceLang === v.targetLang) throw new Error('Source and target language must be different.'); return L().tms.createProject({ name: v.name, sourceLang: v.sourceLang, targetLang: v.targetLang, client: v.client || undefined, dueDate: v.dueDate || undefined }); } });
  if (p) { invalidateTmsCache(); toast('success', 'Project created'); }
  return p;
}

/** Term manager dialog for one termbase. */
export async function termsDialog(tb) {
  const body = h('div.term-table'); let q = '';
  const editTerm = async (t) => {
    const v = await formDialog({ title: t ? 'Edit term' : 'Add term', submit: t ? 'Save' : 'Add term', width: 480, fields: [
      { name: 'source', label: `Source (${tb.sourceLang.toUpperCase()})`, required: true, value: t?.source, half: true }, { name: 'target', label: `Target (${tb.targetLang.toUpperCase()})`, required: true, value: t?.target, half: true },
      { name: 'status', label: 'Status', type: 'select', options: [['preferred', 'Preferred'], ['admitted', 'Admitted'], ['forbidden', 'Forbidden']], value: t?.status || 'preferred' },
      { name: 'note', label: 'Note', type: 'textarea', rows: 2, value: t?.note || '' },
    ], onSubmit: (x) => (t ? L().tms.updateTerm(tb.id, t.id, x) : L().tms.addTerm(tb.id, x)) });
    if (v) { emit('terms-changed'); load(); }
  };
  async function load() {
    const terms = (await call(L().tms.listTerms(tb.id, { q: q || undefined }))) || [];
    mount(body, terms.length ? h('table.tbl', h('thead', h('tr', h('th', 'Source'), h('th', 'Target'), h('th', 'Status'), h('th', 'Note'), h('th', ''))),
      h('tbody', terms.map((t) => h('tr', h('td', { dir: 'auto' }, t.source), h('td', { dir: 'auto', style: t.status === 'forbidden' ? { color: 'var(--danger)', textDecoration: 'line-through' } : { fontWeight: 600 } }, t.target),
        h('td', h('span.t-pill.t-' + t.status, icon(t.status === 'forbidden' ? 'ban' : t.status === 'admitted' ? 'circle' : 'check'), t.status)), h('td.muted', { dir: 'auto', style: { fontSize: '12px' } }, t.note || ''),
        h('td', h('div.acts', iconBtn('pencil', 'Edit term', () => editTerm(t), 'sm'), iconBtn('trash', 'Delete term', async () => { await call(L().tms.deleteTerm(tb.id, t.id)); emit('terms-changed'); load(); }, 'sm'))))))) : emptyState('book', q ? 'No terms match' : 'No terms yet', q ? '' : 'Add terms here, from the side panel, or import a TBX/CSV file.'));
  }
  const sf = searchField('Search terms', debounce((v) => { q = v; load(); }, 180));
  load();
  await openDialog({ title: tb.name, width: 820, content: [h('div.row', h('div.grow', sf), langPair(tb.sourceLang, tb.targetLang), btn('Add term', { kind: 'primary', ic: 'plus', onClick: () => editTerm(null) })), body], actions: [{ label: 'Done', kind: 'primary', primary: true }] });
}

async function tmSearchDialog(tm) {
  const body = h('div.term-table');
  const load = async (q) => {
    const units = (await call(L().tms.searchTm(tm.id, { q: q || '', limit: 100 }))) || [];
    mount(body, units.length ? h('table.tbl', h('thead', h('tr', h('th', `Source (${tm.sourceLang.toUpperCase()})`), h('th', `Target (${tm.targetLang.toUpperCase()})`), h('th.num', 'Used'))),
      h('tbody', units.map((u) => h('tr', h('td', { dir: 'auto', style: { width: '46%' } }, u.source), h('td', { dir: 'auto' }, u.target), h('td.num.muted', String(u.usage ?? 0)))))) : emptyState('database', q ? 'No units match' : 'This memory is empty', q ? '' : 'Confirmed segments are added automatically; you can also import a TMX file.'));
  };
  load('');
  await openDialog({ title: `Search — ${tm.name}`, width: 860, content: [searchField('Concordance search in source and target', debounce(load, 200)), body], actions: [{ label: 'Done', kind: 'primary', primary: true }] });
}

export default function tmsHome(el, ctx) {
  let data = null, view = 'projects';
  const main = h('div'), stats = h('div.stat-strip'), tabs = h('div.tabs-row', { role: 'tablist', style: { marginBottom: '16px' } });
  ctx.setTitle('Translation — TMS');
  const openProject = (p) => ctx.navigate(`lintas://tms/project/${encodeURIComponent(p.id)}`);

  async function load() { const d = await call(L().tms.dashboard()); if (!d) return; data = d; invalidateTmsCache(); draw(); }
  function draw() {
    const { projects, tms, termbases, totals } = data;
    mount(stats,
      h('div.card.stat', h('b', fmtNum(projects.length)), h('span', 'Projects')), h('div.card.stat', h('b', fmtNum(totals.words)), h('span', 'Source words')),
      h('div.card.stat', h('b', fmtNum(totals.segments)), h('span', 'Segments')), h('div.card.stat', h('b', totals.segments ? fmtPct(totals.approved / totals.segments) : '0%'), h('span', 'Approved')),
      h('div.card.stat', h('b', fmtNum(tms.reduce((a, t) => a + t.units, 0))), h('span', 'TM units')), h('div.card.stat', h('b', fmtNum(termbases.reduce((a, t) => a + t.entries, 0))), h('span', 'Terms')));
    mount(tabs, [['projects', 'Projects', 'folder', projects.length], ['tms', 'Translation memories', 'database', tms.length], ['termbases', 'Termbases', 'book', termbases.length]].map(([id, label, ic, n]) =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(view === id), onClick: () => { view = id; draw(); } }, icon(ic), label, h('span.count', String(n)))));
    if (view === 'projects') mount(main, h('div.tms-grid', projects.map(projectCard), h('button.card.proj-card.new', { type: 'button', onClick: async () => { const p = await createProjectDialog(); if (p) openProject(p); } }, icon('plus'), 'New project')));
    else if (view === 'tms') mount(main, tmTable(tms));
    else mount(main, tbTable(termbases));
  }
  function projectCard(p) {
    const due = dueInfo(p.dueDate);
    const card = h('article.card.proj-card', { tabIndex: 0, role: 'link', 'aria-label': `Open project ${p.name}`, onClick: () => openProject(p), onKeydown: (e) => { if (e.key === 'Enter' && e.target === card) openProject(p); } },
      h('div.top', h('div', h('h3', { dir: 'auto' }, p.name), p.client ? h('div.client', { dir: 'auto' }, p.client) : null), ring(p.stats.progress, { size: 46, stroke: 4 })),
      h('div.chips', langPair(p.sourceLang, p.targetLang), due && p.stats.progress < 1 ? h('span.chip', { class: due.tone }, icon('calendar'), due.text) : (p.stats.progress >= 1 ? h('span.chip.ok', icon('check'), 'Complete') : null)),
      segBar(p.stats),
      h('div.foot', h('span', `${fmtNum(p.stats.words)} words`), h('span', '·'), h('span', `${fmtNum(p.stats.segments)} segments`), h('span', '·'), h('span', `${p.fileCount} file${p.fileCount === 1 ? '' : 's'}`), h('span.grow'), h('span.upd', 'Updated ' + relTime(p.updatedAt))),
      h('button.icon-btn.sm.more', { type: 'button', title: 'Project actions', 'aria-label': 'Project actions', onClick: (e) => { e.stopPropagation(); openMenu(e.currentTarget, [
        { label: 'Open', icon: 'external', onClick: () => openProject(p) },
        { label: 'Delete project…', icon: 'trash', danger: true, onClick: async () => { if (await confirmDialog({ title: 'Delete project?', message: `“${p.name}” and its files will be deleted. Its translation memory and termbase are kept.`, ok: 'Delete project', danger: true })) { await call(L().tms.deleteProject(p.id)); load(); } } },
      ], { align: 'right' }); } }, icon('moreH')));
    return card;
  }
  const actBtn = (label, ic, fn) => { const b = h('button.btn.sm', { type: 'button', onClick: (e) => { e.stopPropagation(); fn(b); } }, ic ? icon(ic) : null, label); return b; };
  function tmTable(tms) {
    return h('div', h('div.action-bar', btn('New translation memory', { kind: 'primary', ic: 'plus', onClick: async () => { const t = await formDialog({ title: 'New translation memory', submit: 'Create', fields: [{ name: 'name', label: 'Name', required: true }, ...pairFields(S.settings.defaultSourceLang || 'id', S.settings.defaultTargetLang || 'en')], onSubmit: (v) => L().tms.createTm(v) }); if (t) load(); } }), h('span.muted', 'Confirmed segments are written to the project TM automatically.')),
      tms.length ? h('div.card.tbl-card', h('table.tbl', h('thead', h('tr', h('th', 'Name'), h('th', 'Languages'), h('th.num', 'Units'), h('th', 'Updated'), h('th', ''))),
        h('tbody', tms.map((t) => h('tr.clickable', { onClick: () => tmSearchDialog(t) }, h('td', h('div.name', icon('database'), h('span', { dir: 'auto' }, t.name))), h('td', langPair(t.sourceLang, t.targetLang)), h('td.num', fmtNum(t.units)), h('td.muted', relTime(t.updatedAt)),
          h('td', h('div.acts', actBtn('Search', 'search', () => tmSearchDialog(t)), actBtn('Import TMX', 'importIn', async () => { const r = await call(L().tms.importTmx(t.id)); if (r) { toast('success', `${fmtNum(r.added)} units imported`); load(); } }),
            actBtn('Export', 'exportOut', async () => { const r = await call(L().tms.exportTm(t.id)); if (r?.savedTo) toast('success', `Saved to ${r.savedTo}`); }),
            iconBtn('trash', 'Delete translation memory', async (e) => { e.stopPropagation(); if (await confirmDialog({ title: 'Delete translation memory?', message: `“${t.name}” and its ${fmtNum(t.units)} units will be permanently deleted.`, ok: 'Delete', danger: true })) { await call(L().tms.deleteTm(t.id)); load(); } }, 'sm')))))))) : h('div.card', emptyState('database', 'No translation memories', 'Create one, or create a project — it gets its own TM.')));
  }
  function tbTable(tbs) {
    return h('div', h('div.action-bar', btn('New termbase', { kind: 'primary', ic: 'plus', onClick: async () => { const t = await formDialog({ title: 'New termbase', submit: 'Create', fields: [{ name: 'name', label: 'Name', required: true }, ...pairFields(S.settings.defaultSourceLang || 'id', S.settings.defaultTargetLang || 'en')], onSubmit: (v) => L().tms.createTermbase(v) }); if (t) load(); } }), h('span.muted', 'Preferred, admitted and forbidden terms are shown in the editor and checked by QA.')),
      tbs.length ? h('div.card.tbl-card', h('table.tbl', h('thead', h('tr', h('th', 'Name'), h('th', 'Languages'), h('th.num', 'Entries'), h('th', 'Updated'), h('th', ''))),
        h('tbody', tbs.map((t) => h('tr.clickable', { onClick: async () => { await termsDialog(t); load(); } }, h('td', h('div.name', icon('book'), h('span', { dir: 'auto' }, t.name))), h('td', langPair(t.sourceLang, t.targetLang)), h('td.num', fmtNum(t.entries)), h('td.muted', relTime(t.updatedAt)),
          h('td', h('div.acts', actBtn('Manage terms', 'pencil', async () => { await termsDialog(t); load(); }), actBtn('Import', 'importIn', async () => { const r = await call(L().tms.importTermbase(t.id)); if (r) { toast('success', `${fmtNum(r.added)} terms imported`); load(); } }),
            actBtn('Export', 'exportOut', async () => { const r = await call(L().tms.exportTermbase(t.id)); if (r?.savedTo) toast('success', `Saved to ${r.savedTo}`); }),
            iconBtn('trash', 'Delete termbase', async (e) => { e.stopPropagation(); if (await confirmDialog({ title: 'Delete termbase?', message: `“${t.name}” and its ${fmtNum(t.entries)} entries will be permanently deleted.`, ok: 'Delete', danger: true })) { await call(L().tms.deleteTermbase(t.id)); load(); } }, 'sm')))))))) : h('div.card', emptyState('book', 'No termbases', 'Create a termbase to keep terminology consistent.')));
  }

  mount(el, h('div.page.wide', h('div.page-head', h('div', h('h1', icon('tms'), 'Translation'), h('div.sub', 'Projects, translation memories and termbases. Everything is stored on this computer and works offline.')), h('span.grow'),
    btn('New project', { kind: 'primary', ic: 'plus', onClick: async () => { const p = await createProjectDialog(); if (p) openProject(p); } })), stats, tabs, main));
  mount(main, h('div.tms-grid', [1, 2, 3].map(() => h('div.skeleton', { style: { height: '170px', borderRadius: '12px' } }))));
  load();
  const off = on('terms-changed', debounce(load, 300));
  return off;
}

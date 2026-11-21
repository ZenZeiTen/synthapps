// lintas://tms/project/<id> — files with status-split progress, and the project actions.
import { h, mount, fmtNum, fmtPct, relTime, dueInfo, hostOf, fmtDate } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { S, L, call, emit } from '../lib/store.js';
import { ring, segBar, langPair, emptyState, iconBtn, btn, withBusy, favicon } from '../ui/widgets.js';
import { formDialog, openDialog, confirmDialog, openMenu, toast } from '../ui/overlay.js';
import { tabTitle } from '../ui/tabstrip.js';
import { legend, termsDialog } from './home.js';
import { invalidateTmsCache } from '../ui/sidepanel.js';

const FILE_ICON = { web: 'globe', text: 'text', import: 'fileText' };
export const EXPORTS = [['original', 'Translated file (original format)'], ['xliff', 'XLIFF'], ['tmx', 'TMX'], ['csv', 'CSV (bilingual)'], ['po', 'Gettext PO'], ['json', 'JSON'], ['txt', 'Plain text']];
export function exportMenu(anchor, projectId, fileId) {
  openMenu(anchor, [{ header: 'Export as' }, ...EXPORTS.map(([type, label]) => ({ label, icon: type === 'original' ? 'fileText' : 'exportOut', onClick: async () => { const r = await call(L().tms.export(projectId, fileId, type)); if (r?.savedTo) toast('success', `Saved to ${r.savedTo}`); } }))], { align: 'right', width: 280 });
}

/** QA result dialog; onGo(issue) is called when the user picks an issue (fileId is attached by the caller). */
export function qaDialog(title, result, onGo) {
  const sum = Object.entries(result.summary || {}); let api = null;
  return openDialog({ title, width: 640, content: [
    h('div.row', { style: { flexWrap: 'wrap' } }, h('span.chip', { class: result.issues.length ? 'warn' : 'ok' }, icon(result.issues.length ? 'warning' : 'circleCheck'), result.issues.length ? `${fmtNum(result.issues.length)} issue${result.issues.length === 1 ? '' : 's'}` : 'No issues found'),
      h('span.muted', `${fmtNum(result.checked)} segments checked`), sum.map(([k, n]) => h('span.chip', `${k} · ${n}`))),
    result.issues.length ? h('div.issue-list', result.issues.slice(0, 400).map((i) => h('button.issue', { type: 'button', onClick: () => { api?.close(null); onGo && onGo(i); } },
      h('span.sev.sev-' + i.severity, { title: i.severity }), h('span.msg', { dir: 'auto' }, i.message), onGo ? icon('chevRight', 14) : null, h('span.chk', `${i.check} · ${i.severity}${i.fileName ? ' · ' + i.fileName : ''}`)))) : h('p', 'Terminology, numbers, placeholders, punctuation and spacing all check out.'),
  ], onMount: (a) => { api = a; }, actions: [{ label: 'Close', kind: 'primary', primary: true }] });
}

export function pretranslateDialog(projectId, files, preselect) {
  const sel = h('select.select', { 'aria-label': 'Files' }, files.length > 1 ? h('option', { value: '' }, `All ${files.length} files`) : null, files.map((f) => h('option', { value: f.id, selected: f.id === preselect }, f.name)));
  const min = h('select.select', { 'aria-label': 'Minimum match' }, [[100, '100% — exact matches only'], [95, '95% and above'], [85, '85% and above'], [75, '75% and above']].map(([v, l]) => h('option', { value: v }, l)));
  const aiOk = S.status.hasApiKey && S.online;
  const ai = h('input.check', { type: 'checkbox', disabled: !aiOk });
  const prog = h('div');
  return openDialog({ title: 'Pre-translate', width: 480, content: [
    h('p', 'Fills empty targets from the project’s translation memories. Filled segments are marked Draft so you can review them.'),
    h('div.field', h('label', 'Files'), sel), h('div.field', h('label', 'Use TM matches of'), min),
    h('label.check-row', ai, h('span', 'Translate the remaining segments with AI', h('small', aiOk ? ' — uses TM matches and the termbase as context' : S.online ? ' — add an API key in Settings first' : ' — needs a network connection'))), prog,
  ], actions: [{ label: 'Cancel', value: null }, { label: 'Pre-translate', kind: 'primary', primary: true, onClick: async () => {
    const targets = sel.value ? files.filter((f) => f.id === sel.value) : files; const total = { filled: 0, fromTm: 0, fromAi: 0 };
    const label = h('span.muted', 'Working…'); mount(prog, h('div', { style: { display: 'grid', gap: '6px' } }, h('div.progress-line'), label));
    const off = L().on('pretranslate-progress', (p) => { if (p.projectId === projectId) label.textContent = `Working… ${fmtNum(p.done)} of ${fmtNum(p.total)} segments`; });
    try { for (const f of targets) { const r = await L().tms.pretranslate(projectId, f.id, { minScore: Number(min.value), useAi: ai.checked }); for (const k in total) total[k] += r[k] || 0; } }
    catch (e) { off(); mount(prog, h('div.msg.err', e?.message || 'Pre-translation failed.')); return false; }
    off(); toast('success', `${fmtNum(total.filled)} segments filled — ${fmtNum(total.fromTm)} from TM, ${fmtNum(total.fromAi)} by AI`);
    return total;
  } }] });
}

async function analyzeDialog(project) {
  const body = h('div', h('div.progress-line'));
  const p = openDialog({ title: `Analysis — ${project.name}`, width: 640, content: [h('p', 'Match bands against the project’s translation memories, like a standard TMS analysis report.'), body], actions: [{ label: 'Close', kind: 'primary', primary: true }] });
  const r = await call(L().tms.analyze(project.id));
  if (r) {
    const segs = r.bands.reduce((a, b) => a + b.segments, 0), max = Math.max(1, ...r.bands.map((b) => b.words));
    mount(body, h('table.tbl.report', h('thead', h('tr', h('th', 'Match band'), h('th.num', 'Segments'), h('th.num', 'Words'), h('th.num', '% of words'), h('th', ''))),
      h('tbody', r.bands.map((b) => h('tr', h('td.band', b.band), h('td.num', fmtNum(b.segments)), h('td.num', fmtNum(b.words)), h('td.num', r.words ? fmtPct(b.words / r.words) : '0%'), h('td.barcell', h('i', { style: { width: (b.words / max) * 100 + '%' } })))),
        h('tr.total', h('td', 'Total'), h('td.num', fmtNum(segs)), h('td.num', fmtNum(r.words)), h('td.num', '100%'), h('td', '')))));
  } else mount(body, h('div.msg.err', 'The analysis could not be completed.'));
  return p;
}

export default function tmsProject(el, ctx) {
  const pid = ctx.params.projectId; let project = null;
  const root = h('div.page.wide');
  mount(el, root); mount(root, h('div.skeleton', { style: { height: '140px', borderRadius: '12px', marginBottom: '20px' } }), h('div.skeleton', { style: { height: '260px', borderRadius: '12px' } }));
  const openFile = (f) => ctx.navigate(`lintas://tms/file/${encodeURIComponent(pid)}/${encodeURIComponent(f.id)}`);

  async function load() {
    const p = await call(L().tms.getProject(pid), { silent: true });
    if (!p) return mount(root, h('div.card', emptyState('folder', 'Project not found', 'It may have been deleted.', btn('Back to TMS', { kind: 'primary', onClick: () => ctx.navigate('lintas://tms') }))));
    project = p; ctx.setTitle(p.name); invalidateTmsCache(); draw();
  }

  async function run(button, fn) { await withBusy(button, fn); }
  const actions = {
    async importFiles(b) { await run(b, async () => { const f = await call(L().tms.importFiles(pid)); if (f?.length) { toast('success', `${f.length} file${f.length === 1 ? '' : 's'} imported`); load(); } }); },
    async importText() { const f = await formDialog({ title: 'Import text', submit: 'Import', width: 560, fields: [{ name: 'name', label: 'File name', value: 'Pasted text', required: true }, { name: 'text', label: `Text (${project.sourceLang.toUpperCase()})`, type: 'textarea', rows: 9, required: true, placeholder: 'Paste the source text. It is split into segments by sentence.' }], onSubmit: (v) => L().tms.importText(pid, v) }); if (f) { toast('success', 'Text imported'); load(); } },
    async capture() {
      const webTabs = S.tabs.filter((t) => t.kind === 'web' && !t.error);
      if (!webTabs.length) return toast('info', 'Open the web page you want to translate in another tab first.');
      let chosen = webTabs[0].id;
      const list = h('div.pick-list', { role: 'radiogroup' }, webTabs.map((t, i) => h('label', h('input', { type: 'radio', name: 'cap', checked: i === 0, onChange: () => { chosen = t.id; } }), favicon(t.favicon, t.url, t.favicon ? null : 'globe'), h('span.lr-main', { style: { display: 'grid', minWidth: 0 } }, h('span.lr-title.ellipsis', { dir: 'auto' }, tabTitle(t)), h('span.lr-sub.ellipsis.muted', { style: { fontSize: '12px' } }, hostOf(t.url))))));
      const f = await openDialog({ title: 'Capture a web page', width: 520, content: [h('p', 'The text of the page becomes a file in this project, segmented and ready to translate.'), list], actions: [{ label: 'Cancel', value: null }, { label: 'Capture page', kind: 'primary', primary: true, onClick: async () => { try { return await L().tms.capturePage(chosen, pid); } catch (e) { toast('error', e?.message || 'The page could not be captured.'); return false; } } }] });
      if (f) { toast('success', 'Page captured'); await load(); }
    },
    async pretranslate() { if (!project.files.length) return toast('info', 'Add a file first.'); if (await pretranslateDialog(pid, project.files)) load(); },
    analyze() { analyzeDialog(project); },
    async qa(b) {
      await run(b, async () => {
        const all = { checked: 0, issues: [], summary: {} };
        for (const f of project.files) { const r = await call(L().tms.qa(pid, f.id)); if (!r) return; all.checked += r.checked; for (const i of r.issues) all.issues.push({ ...i, fileId: f.id, fileName: f.name }); for (const k in r.summary) all.summary[k] = (all.summary[k] || 0) + r.summary[k]; }
        const dlg = qaDialog(`Quality check — ${project.name}`, all, (i) => { S.pendingSegment.set(`${pid}/${i.fileId}`, i.segmentId); openFile({ id: i.fileId }); });
        await dlg;
      });
    },
    more(b) {
      openMenu(b, [
        { label: 'Edit project details…', icon: 'pencil', onClick: async () => { const v = await formDialog({ title: 'Project details', fields: [{ name: 'name', label: 'Project name', required: true, value: project.name }, { name: 'client', label: 'Client', value: project.client || '', half: true }, { name: 'dueDate', label: 'Due date', type: 'date', value: project.dueDate ? new Date(project.dueDate).toISOString().slice(0, 10) : '', half: true }], onSubmit: (x) => L().tms.updateProject(pid, { name: x.name, client: x.client || null, dueDate: x.dueDate || null }) }); if (v) load(); } },
        { label: 'Manage termbase…', icon: 'book', disabled: !project.termbaseIds?.length, onClick: async () => { const tbs = await call(L().tms.listTermbases()); const tb = (tbs || []).find((t) => project.termbaseIds.includes(t.id)); if (tb) termsDialog(tb); } },
        { sep: true },
        { label: 'Delete project…', icon: 'trash', danger: true, onClick: async () => { if (await confirmDialog({ title: 'Delete project?', message: `“${project.name}” and its files will be deleted. Its translation memory and termbase are kept.`, ok: 'Delete project', danger: true })) { await call(L().tms.deleteProject(pid)); emit('terms-changed'); ctx.navigate('lintas://tms'); } } },
      ], { align: 'right' });
    },
  };

  function draw() {
    const p = project, due = dueInfo(p.dueDate);
    const ab = (label, ic, key, kind) => { const b = h('button.btn', { type: 'button', class: kind || '', onClick: () => actions[key](b) }, icon(ic), label); return b; };
    const moreBtn = h('button.icon-btn', { type: 'button', title: 'More actions', 'aria-label': 'More actions', onClick: () => actions.more(moreBtn) }, icon('moreH'));
    mount(root,
      h('nav.breadcrumb', h('a', { role: 'link', tabIndex: 0, onClick: () => ctx.navigate('lintas://tms'), onKeydown: (e) => { if (e.key === 'Enter') ctx.navigate('lintas://tms'); } }, 'Translation'), icon('chevRight'), h('span', 'Project')),
      h('section.card.proj-hero',
        h('div', h('h1', { dir: 'auto' }, p.name), h('div.meta', langPair(p.sourceLang, p.targetLang), p.client ? h('span', { dir: 'auto' }, p.client) : null,
          due ? h('span.chip', { class: p.stats.progress >= 1 ? '' : due.tone, title: fmtDate(p.dueDate) }, icon('calendar'), p.stats.progress >= 1 ? 'Due ' + fmtDate(p.dueDate) : due.text) : null,
          h('span.muted', `${fmtNum(p.stats.words)} words · ${fmtNum(p.stats.segments)} segments · ${p.tmIds.length} TM · ${p.termbaseIds.length} termbase${p.termbaseIds.length === 1 ? '' : 's'} · updated ${relTime(p.updatedAt)}`))),
        ring(p.stats.progress, { size: 64, stroke: 5 }),
        h('div.bar', segBar(p.stats), legend(p.stats))),
      h('div.action-bar', ab('Import files', 'importIn', 'importFiles', 'primary'), ab('Import text', 'text', 'importText'), ab('Capture web page', 'capture', 'capture'), h('span.sep'),
        ab('Pre-translate', 'wand', 'pretranslate'), ab('Analyze', 'chart', 'analyze'), ab('Run QA', 'qa', 'qa'), h('span.grow'), moreBtn),
      p.files.length ? h('div.card.tbl-card', h('table.tbl', h('thead', h('tr', h('th', 'File'), h('th.num', 'Segments'), h('th.num', 'Words'), h('th', 'Progress'), h('th', 'Added'), h('th', ''))),
        h('tbody', p.files.map((f) => h('tr.clickable', { onClick: () => openFile(f) },
          h('td', h('div.name', icon(FILE_ICON[f.origin] || 'file'), h('span', { style: { minWidth: 0 } }, h('span', { dir: 'auto' }, f.name), h('span.sub', f.origin === 'web' && f.url ? hostOf(f.url) + ' · captured page' : f.origin === 'text' ? 'Pasted text' : (f.format || '').toUpperCase())))),
          h('td.num', fmtNum(f.stats.segments)), h('td.num', fmtNum(f.stats.words)),
          h('td', h('div.prog', segBar(f.stats), h('span', fmtPct(f.stats.progress)))), h('td.muted', relTime(f.createdAt)),
          h('td', h('div.acts', h('button.btn.sm.primary', { type: 'button', onClick: (e) => { e.stopPropagation(); openFile(f); } }, 'Open'),
            h('button.btn.sm', { type: 'button', onClick: (e) => { e.stopPropagation(); exportMenu(e.currentTarget, pid, f.id); } }, icon('exportOut'), 'Export'),
            iconBtn('trash', 'Delete file', async (e) => { e.stopPropagation(); if (await confirmDialog({ title: 'Delete file?', message: `“${f.name}” will be removed from the project. Translations already in the TM are kept.`, ok: 'Delete file', danger: true })) { await call(L().tms.deleteFile(pid, f.id)); load(); } }, 'sm'))))))))
        : h('div.card', emptyState('importIn', 'No files yet', 'Import documents (txt, md, html, docx, srt, vtt, po, xliff, json, csv, tmx), paste text, or capture an open web page.')));
  }
  load();
}

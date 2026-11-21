// The Translation Management System: projects, files, segments, workflow
// status, translation memories, termbases, analysis, QA and exports.
// Pure Node; the Electron main process wraps it in IPC handlers.
import { splitSentences, tokenize, detectLanguage, escapeRegex } from './text.js';
import { parseText, parseFile, decodeText, exportPo, exportXliff, exportJson, exportTmx, exportTbx, toCsv, parseCsv, stripTags, xmlEscape, markupTokens, tagAttr } from './formats.js';
import { TmIndex, wordDiff, bandOf, BANDS, normKey } from './tm.js';
import { checkSegment, inconsistencies } from './qa.js';
import { writeDocx } from './docx.js';

const STATUSES = ['new', 'draft', 'translated', 'reviewed', 'approved'];
const DONE = new Set(['translated', 'reviewed', 'approved']);
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function wordCount(s, lang = 'en') {
  return tokenize(s, lang).length;
}

/** Split running text into sentence segments, remembering paragraph numbers. */
export function segmentText(text, lang) {
  const out = [];
  String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).forEach((para, p) => {
    for (const s of splitSentences(para, lang)) out.push({ text: s, para: p });
  });
  return out;
}

export class Tms {
  constructor(store) {
    this.store = store;
    this.index = this.store.load('tms-index', { projects: [], tms: [], termbases: [] });
    this.tmIndexes = new Map();
  }

  saveIndex() { this.store.save('tms-index', this.index); }

  // ---------- projects ----------

  dashboard() {
    const projects = this.index.projects.map(p => this.projectSummary(p.id));
    const totals = projects.reduce((t, p) => ({ words: t.words + p.stats.words, segments: t.segments + p.stats.segments, approved: t.approved + p.stats.byStatus.approved }), { words: 0, segments: 0, approved: 0 });
    return { projects, tms: this.listTms(), termbases: this.listTermbases(), totals };
  }

  createProject({ name, sourceLang = 'en', targetLang = 'id', client = null, dueDate = null }) {
    if (!String(name || '').trim()) throw new Error('Give the project a name.');
    const id = uid('p');
    const now = new Date().toISOString();
    const tm = this.createTm({ name: `${name} TM`, sourceLang, targetLang });
    const tb = this.createTermbase({ name: `${name} terms`, sourceLang, targetLang });
    const doc = { id, name: name.trim(), client, sourceLang, targetLang, dueDate, createdAt: now, updatedAt: now, tmIds: [tm.id], termbaseIds: [tb.id], files: [] };
    this.store.save('project-' + id, doc);
    this.index.projects.push({ id });
    this.saveIndex();
    return this.projectSummary(id);
  }

  doc(id) {
    if (!this.index.projects.some(p => p.id === id)) throw new Error('That project no longer exists.');
    return this.store.load('project-' + id, null);
  }

  touch(doc) {
    doc.updatedAt = new Date().toISOString();
    this.store.save('project-' + doc.id, doc);
  }

  stats(segments, lang) {
    const byStatus = Object.fromEntries(STATUSES.map(s => [s, 0]));
    let words = 0, doneWords = 0;
    for (const s of segments) {
      byStatus[s.status]++;
      const w = s.words ?? wordCount(s.source, lang);
      words += w;
      if (DONE.has(s.status)) doneWords += w;
    }
    return { segments: segments.length, words, byStatus, progress: words ? Math.round((doneWords / words) * 1000) / 1000 : 0 };
  }

  fileSummary(doc, f) {
    const { segments, ...rest } = f;
    return { ...rest, projectId: doc.id, stats: this.stats(segments, doc.sourceLang) };
  }

  projectSummary(id) {
    const doc = this.doc(id);
    const { files, ...rest } = doc;
    return { ...rest, stats: this.stats(files.flatMap(f => f.segments), doc.sourceLang), fileCount: files.length };
  }

  getProject(id) {
    const doc = this.doc(id);
    return { ...this.projectSummary(id), files: doc.files.map(f => this.fileSummary(doc, f)) };
  }

  updateProject(id, patch) {
    const doc = this.doc(id);
    for (const k of ['name', 'client', 'dueDate', 'sourceLang', 'targetLang', 'tmIds', 'termbaseIds']) if (k in patch) doc[k] = patch[k];
    this.touch(doc);
    return this.projectSummary(id);
  }

  deleteProject(id) {
    this.doc(id);
    this.store.remove('project-' + id);
    this.index.projects = this.index.projects.filter(p => p.id !== id);
    this.saveIndex();
  }

  // ---------- files ----------

  addFile(projectId, { name, parsed, origin = 'import', url = null }) {
    const doc = this.doc(projectId);
    let units;
    if (parsed.units) units = parsed.units.filter(u => String(u.text ?? '').trim()).map(u => ({ text: u.text, target: u.target || '', key: u.key ?? null, note: u.note ?? null }));
    else units = segmentText(parsed.text, doc.sourceLang);
    if (!units.length) throw new Error('No translatable text was found in this file.');
    const file = { id: uid('f'), name, format: parsed.format || 'txt', origin, url, createdAt: new Date().toISOString(), meta: { title: parsed.title || null }, segments: [] };
    units.forEach((u, i) => {
      const target = String(u.target || '').trim();
      file.segments.push({
        id: 's' + (i + 1), n: i + 1, source: String(u.text).trim(), target,
        status: target ? 'translated' : 'new', locked: false, key: u.key ?? null, note: u.note ?? null,
        para: u.para ?? null, comment: null, matchScore: null, origin: target ? 'human' : null, updatedAt: null,
        words: wordCount(u.text, doc.sourceLang),
      });
    });
    doc.files.push(file);
    this.touch(doc);
    // Existing translations in bilingual files feed the project TM.
    const tm = this.projectTm(doc);
    if (tm) { for (const s of file.segments) if (s.target) tm.add(s.source, s.target); this.saveTm(tm.tm.id); }
    return this.fileSummary(doc, file);
  }

  importBuffer(projectId, filename, buf) {
    return this.addFile(projectId, { name: filename, parsed: parseFile(filename, buf) });
  }

  importText(projectId, { name, text }) {
    if (!String(text || '').trim()) throw new Error('There is no text to import.');
    return this.addFile(projectId, { name: name || 'Pasted text', parsed: { format: 'txt', text }, origin: 'text' });
  }

  importWebPage(projectId, { url, title, text, html }) {
    const parsed = html ? parseText('html', html) : { format: 'html', text, title };
    if (!parsed.title) parsed.title = title;
    parsed.format = 'html';
    return this.addFile(projectId, { name: title || url, parsed, origin: 'web', url });
  }

  deleteFile(projectId, fileId) {
    const doc = this.doc(projectId);
    doc.files = doc.files.filter(f => f.id !== fileId);
    this.touch(doc);
  }

  fileDoc(projectId, fileId) {
    const doc = this.doc(projectId);
    const file = doc.files.find(f => f.id === fileId);
    if (!file) throw new Error('That file no longer exists.');
    return { doc, file };
  }

  getFile(projectId, fileId, { offset = 0, limit = 500, status, q } = {}) {
    const { doc, file } = this.fileDoc(projectId, fileId);
    let list = file.segments;
    if (status) { const set = new Set([].concat(status)); list = list.filter(s => set.has(s.status)); }
    if (q) { const s = String(q).toLowerCase(); list = list.filter(x => x.source.toLowerCase().includes(s) || x.target.toLowerCase().includes(s) || (x.key || '').toLowerCase().includes(s)); }
    return { file: this.fileSummary(doc, file), total: list.length, segments: list.slice(offset, offset + limit).map(publicSeg) };
  }

  updateSegment(projectId, fileId, segId, patch) {
    const { doc, file } = this.fileDoc(projectId, fileId);
    const i = file.segments.findIndex(s => s.id === segId);
    if (i < 0) throw new Error('That segment no longer exists.');
    const seg = file.segments[i];
    if (seg.locked && !('locked' in patch)) throw new Error('This segment is locked. Unlock it first.');
    if ('target' in patch) { seg.target = String(patch.target ?? ''); if (!('origin' in patch)) seg.origin = 'human'; }
    if ('origin' in patch) seg.origin = patch.origin;
    if ('matchScore' in patch) seg.matchScore = patch.matchScore;
    if ('status' in patch) {
      if (!STATUSES.includes(patch.status)) throw new Error('Unknown status: ' + patch.status);
      if (DONE.has(patch.status) && !seg.target.trim()) throw new Error('Add a translation before confirming this segment.');
      seg.status = patch.status;
    } else if ('target' in patch && seg.status === 'new' && seg.target.trim()) seg.status = 'draft';
    if ('locked' in patch) seg.locked = !!patch.locked;
    if ('comment' in patch) seg.comment = patch.comment || null;
    seg.updatedAt = new Date().toISOString();
    if (DONE.has(seg.status) && seg.target.trim()) {
      const tm = this.projectTm(doc);
      if (tm) { tm.add(seg.source, seg.target, { context: file.segments[i - 1]?.source ?? null }); this.saveTm(tm.tm.id); }
    }
    this.touch(doc);
    return publicSeg(seg);
  }

  // ---------- TM ----------

  listTms() {
    return this.index.tms.map(t => this.tmSummary(t.id)).filter(Boolean);
  }

  tmSummary(id) {
    const tm = this.store.load('tm-' + id, null);
    if (!tm) return null;
    return { id: tm.id, name: tm.name, sourceLang: tm.sourceLang, targetLang: tm.targetLang, units: tm.units.length, updatedAt: tm.updatedAt };
  }

  createTm({ name, sourceLang = 'en', targetLang = 'id' }) {
    const id = uid('tm');
    const tm = { id, name: name || 'Translation memory', sourceLang, targetLang, units: [], updatedAt: new Date().toISOString() };
    this.store.save('tm-' + id, tm);
    this.index.tms.push({ id });
    this.saveIndex();
    return this.tmSummary(id);
  }

  deleteTm(id) {
    this.store.remove('tm-' + id);
    this.tmIndexes.delete(id);
    this.index.tms = this.index.tms.filter(t => t.id !== id);
    for (const p of this.index.projects) { const doc = this.doc(p.id); if (doc.tmIds.includes(id)) { doc.tmIds = doc.tmIds.filter(x => x !== id); this.touch(doc); } }
    this.saveIndex();
  }

  tmIndex(id) {
    if (!this.tmIndexes.has(id)) {
      const tm = this.store.load('tm-' + id, null);
      if (!tm) return null;
      this.tmIndexes.set(id, new TmIndex(tm));
    }
    return this.tmIndexes.get(id);
  }

  saveTm(id) {
    const ix = this.tmIndexes.get(id);
    if (!ix) return;
    ix.tm.updatedAt = new Date().toISOString();
    this.store.save('tm-' + id, ix.tm);
  }

  projectTm(doc) {
    return doc.tmIds[0] ? this.tmIndex(doc.tmIds[0]) : null;
  }

  importTmx(tmId, text) {
    const ix = this.tmIndex(tmId);
    if (!ix) throw new Error('That translation memory no longer exists.');
    const parsed = parseText('tmx', text);
    let added = 0;
    for (const u of parsed.units) if (u.target && ix.add(u.text, u.target)) added++;
    this.saveTm(tmId);
    return { added };
  }

  exportTmx(tmId) {
    const ix = this.tmIndex(tmId);
    return exportTmx(ix.tm.units.map(u => ({ text: u.source, target: u.target })), { sourceLang: ix.tm.sourceLang, targetLang: ix.tm.targetLang });
  }

  searchTm(tmId, { q, limit = 100 } = {}) {
    const ix = this.tmIndex(tmId);
    if (!ix) throw new Error('That translation memory no longer exists.');
    return ix.search(q, limit).map(u => ({ id: u.id, source: u.source, target: u.target, createdAt: u.createdAt, usage: u.usage }));
  }

  // ---------- termbases ----------

  listTermbases() {
    return this.index.termbases.map(t => this.tbSummary(t.id)).filter(Boolean);
  }

  tb(id) {
    const tb = this.store.load('tb-' + id, null);
    if (!tb) throw new Error('That termbase no longer exists.');
    return tb;
  }

  tbSummary(id) {
    const tb = this.store.load('tb-' + id, null);
    if (!tb) return null;
    return { id: tb.id, name: tb.name, sourceLang: tb.sourceLang, targetLang: tb.targetLang, entries: tb.terms.length, updatedAt: tb.updatedAt };
  }

  createTermbase({ name, sourceLang = 'en', targetLang = 'id' }) {
    const id = uid('tb');
    this.store.save('tb-' + id, { id, name: name || 'Termbase', sourceLang, targetLang, terms: [], updatedAt: new Date().toISOString() });
    this.index.termbases.push({ id });
    this.saveIndex();
    return this.tbSummary(id);
  }

  deleteTermbase(id) {
    this.store.remove('tb-' + id);
    this.index.termbases = this.index.termbases.filter(t => t.id !== id);
    for (const p of this.index.projects) { const doc = this.doc(p.id); if (doc.termbaseIds.includes(id)) { doc.termbaseIds = doc.termbaseIds.filter(x => x !== id); this.touch(doc); } }
    this.saveIndex();
  }

  listTerms(id, { q } = {}) {
    const tb = this.tb(id);
    const s = String(q || '').toLowerCase();
    return s ? tb.terms.filter(t => t.source.toLowerCase().includes(s) || (t.target || '').toLowerCase().includes(s)) : tb.terms;
  }

  addTerm(id, { source, target = '', status = 'admitted', note = '', pos = null }) {
    const tb = this.tb(id);
    if (!String(source || '').trim()) throw new Error('A term needs a source text.');
    if (!['preferred', 'admitted', 'forbidden'].includes(status)) status = 'admitted';
    const dup = tb.terms.find(t => t.source.toLowerCase() === source.trim().toLowerCase() && (t.target || '').toLowerCase() === String(target).trim().toLowerCase());
    if (dup) return dup;
    const term = { id: uid('t'), source: source.trim(), target: String(target).trim(), status, note: note || '', pos, createdAt: new Date().toISOString() };
    tb.terms.push(term);
    tb.updatedAt = term.createdAt;
    this.store.save('tb-' + id, tb);
    return term;
  }

  updateTerm(id, termId, patch) {
    const tb = this.tb(id);
    const t = tb.terms.find(x => x.id === termId);
    if (!t) throw new Error('That term no longer exists.');
    for (const k of ['source', 'target', 'status', 'note', 'pos']) if (k in patch) t[k] = patch[k];
    tb.updatedAt = new Date().toISOString();
    this.store.save('tb-' + id, tb);
    return t;
  }

  deleteTerm(id, termId) {
    const tb = this.tb(id);
    tb.terms = tb.terms.filter(x => x.id !== termId);
    this.store.save('tb-' + id, tb);
  }

  importTermbase(id, filename, buf) {
    const tb = this.tb(id);
    const text = decodeText(buf);
    let added = 0;
    if (/\.tbx$/i.test(filename) || /<martif|<tbx/i.test(text.slice(0, 500))) {
      for (const e of tbxEntries(text)) {
        const src = e.sets.find(x => x.lang === tb.sourceLang) || e.sets[0];
        const tgt = e.sets.find(x => x !== src);
        if (src?.term) { this.addTerm(id, { source: src.term, target: tgt?.term || '', status: tgt?.deprecated ? 'forbidden' : tgt?.preferred ? 'preferred' : 'admitted', note: e.note }); added++; }
      }
    } else {
      const rows = parseCsv(text);
      const header = rows[0]?.map(h => h.toLowerCase()) || [];
      const hasHeader = header.includes('source') || header.includes('term');
      const col = name => header.indexOf(name);
      for (const r of hasHeader ? rows.slice(1) : rows) {
        const source = hasHeader ? r[col('source') >= 0 ? col('source') : col('term')] : r[0];
        const target = hasHeader ? r[col('target')] ?? '' : r[1] ?? '';
        const statusCell = hasHeader && col('status') >= 0 ? r[col('status')] : '';
        const status = /forbid|deprecat/i.test(statusCell) ? 'forbidden' : /prefer|approv/i.test(statusCell) ? 'preferred' : 'admitted';
        if (source?.trim()) { this.addTerm(id, { source, target, status, note: hasHeader && col('note') >= 0 ? r[col('note')] : '' }); added++; }
      }
    }
    return { added };
  }

  exportTermbase(id) {
    const tb = this.tb(id);
    return exportTbx(tb.terms.map(t => ({ ...t, status: t.status === 'preferred' ? 'approved' : t.status })), { sourceLang: tb.sourceLang, targetLang: tb.targetLang });
  }

  /** Termbase hits in a source text, longest terms first, non-overlapping. */
  termHits(doc, text) {
    const hits = [];
    const taken = [];
    const terms = doc.termbaseIds.flatMap(id => { try { return this.tb(id).terms.map(t => ({ ...t, termbaseId: id })); } catch { return []; } })
      .sort((a, b) => b.source.length - a.source.length);
    for (const t of terms) {
      // Allow a short suffix so inflected forms match (e.g. Indonesian -nya, -kan; English -s, -ed).
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(t.source)}(?:[\\p{L}]{0,4})(?![\\p{L}\\p{N}])`, 'giu');
      for (const m of text.matchAll(re)) {
        const start = m.index, end = m.index + m[0].length;
        if (taken.some(([a, b]) => start < b && end > a)) continue;
        if (m[0].length - t.source.length > 0 && t.source.length < 4) continue;
        taken.push([start, end]);
        hits.push({ entryId: t.id, termbaseId: t.termbaseId, source: t.source, target: t.target, status: t.status, note: t.note, start, end });
      }
    }
    return hits.sort((a, b) => a.start - b.start);
  }

  // ---------- lookup, pretranslation, analysis, QA ----------

  lookup(projectId, text, { context = null } = {}) {
    const doc = this.doc(projectId);
    const matches = [];
    for (const id of doc.tmIds) {
      const ix = this.tmIndex(id);
      if (!ix) continue;
      for (const m of ix.lookup(text, { context })) matches.push({ score: m.score, source: m.unit.source, target: m.unit.target, tmId: id, tmName: ix.tm.name, diff: wordDiff(m.unit.source, text) });
    }
    matches.sort((a, b) => b.score - a.score);
    return { matches: matches.slice(0, 5), terms: this.termHits(doc, text) };
  }

  pretranslate(projectId, fileId, { minScore = 100 } = {}) {
    const { doc, file } = this.fileDoc(projectId, fileId);
    let fromTm = 0;
    const remaining = [];
    file.segments.forEach((s, i) => {
      if (s.target.trim() || s.locked) return;
      const best = this.lookup(projectId, s.source, { context: file.segments[i - 1]?.source ?? null }).matches[0];
      if (best && best.score >= minScore) {
        s.target = best.target; s.matchScore = best.score; s.origin = 'tm';
        s.status = best.score >= 100 ? 'translated' : 'draft';
        s.updatedAt = new Date().toISOString();
        fromTm++;
      } else remaining.push(s.id);
    });
    this.touch(doc);
    return { filled: fromTm, fromTm, remaining };
  }

  analyze(projectId) {
    const doc = this.doc(projectId);
    const rows = Object.fromEntries(BANDS.map(b => [b, { band: b, segments: 0, words: 0 }]));
    const seen = new Set();
    let words = 0;
    for (const f of doc.files) f.segments.forEach((s, i) => {
      const w = s.words ?? wordCount(s.source, doc.sourceLang);
      words += w;
      const best = this.lookup(projectId, s.source, { context: f.segments[i - 1]?.source ?? null }).matches[0];
      let band = bandOf(best?.score);
      const k = normKey(s.source).toLowerCase();
      if ((band === 'No match' || !['101%', '100%'].includes(band)) && seen.has(k)) band = 'Repetitions';
      seen.add(k);
      rows[band].segments++; rows[band].words += w;
    });
    return { bands: BANDS.map(b => rows[b]), words };
  }

  qa(projectId, fileId) {
    const doc = this.doc(projectId);
    const files = fileId ? [this.fileDoc(projectId, fileId).file] : doc.files;
    const issues = [];
    let checked = 0;
    for (const f of files) {
      for (const s of f.segments) {
        checked++;
        for (const i of checkSegment(s, { terms: this.termHits(doc, s.source), sourceLang: doc.sourceLang, targetLang: doc.targetLang })) issues.push({ ...i, fileId: f.id });
      }
      for (const i of inconsistencies(f.segments)) issues.push({ ...i, fileId: f.id });
    }
    const summary = {};
    for (const i of issues) summary[i.check] = (summary[i.check] || 0) + 1;
    return { checked, issues, summary };
  }

  // ---------- export ----------

  /** Returns { filename, data (string|Buffer) } for a file export. */
  exportFile(projectId, fileId, type = 'original') {
    const { doc, file } = this.fileDoc(projectId, fileId);
    const base = file.name.replace(/\.[^.]+$/, '') || 'file';
    const segs = file.segments.map(s => ({ id: s.id, text: s.source, target: s.target, key: s.key, note: s.note }));
    const langs = { sourceLang: doc.sourceLang, targetLang: doc.targetLang };
    const fmt = type === 'original' ? file.format : type;
    switch (fmt) {
      case 'xliff': return { filename: `${base}.${doc.targetLang}.xlf`, data: exportXliff(segs, { ...langs, original: file.name }) };
      case 'tmx': return { filename: `${base}.tmx`, data: exportTmx(segs, langs) };
      case 'po': return { filename: `${base}.${doc.targetLang}.po`, data: exportPo(segs, langs) };
      case 'json': return { filename: `${base}.${doc.targetLang}.json`, data: exportJson(segs.map(s => ({ ...s, target: s.target || s.text }))) };
      case 'csv': return { filename: `${base}.${doc.targetLang}.csv`, data: toCsv([['key', doc.sourceLang, doc.targetLang, 'status'], ...file.segments.map(s => [s.key || s.id, s.source, s.target, s.status])]) };
      case 'srt': case 'vtt': {
        const body = file.segments.map((s, i) => `${fmt === 'srt' ? (s.key || i + 1) + '\n' : ''}${(s.note || '').replace(/,/g, fmt === 'vtt' ? '.' : ',')}\n${s.target || s.source}`).join('\n\n');
        return { filename: `${base}.${doc.targetLang}.${fmt}`, data: (fmt === 'vtt' ? 'WEBVTT\n\n' : '') + body + '\n' };
      }
      case 'docx': return { filename: `${base}.${doc.targetLang}.docx`, data: writeDocx(this.paragraphs(file)) };
      case 'html': return { filename: `${base}.${doc.targetLang}.html`, data: `<!doctype html>\n<html lang="${xmlEscape(doc.targetLang)}"><meta charset="utf-8"><title>${xmlEscape(file.meta?.title || base)}</title>\n<body>\n${this.paragraphs(file).map(p => `<p>${xmlEscape(p)}</p>`).join('\n')}\n</body></html>\n` };
      default: return { filename: `${base}.${doc.targetLang}.${fmt === 'md' ? 'md' : 'txt'}`, data: this.paragraphs(file).join('\n\n') + '\n' };
    }
  }

  paragraphs(file) {
    const paras = [];
    let cur = null, buf = [];
    for (const s of file.segments) {
      const p = s.para ?? s.n;
      if (p !== cur && buf.length) { paras.push(buf.join(' ')); buf = []; }
      cur = p;
      buf.push(s.target || s.source);
    }
    if (buf.length) paras.push(buf.join(' '));
    return paras;
  }

  /** Context for an AI request about one segment. */
  segmentContext(projectId, fileId, segId) {
    const { doc, file } = this.fileDoc(projectId, fileId);
    const i = file.segments.findIndex(s => s.id === segId);
    if (i < 0) throw new Error('That segment no longer exists.');
    const seg = file.segments[i];
    const look = this.lookup(projectId, seg.source, { context: file.segments[i - 1]?.source ?? null });
    return {
      doc, file, seg,
      before: file.segments.slice(Math.max(0, i - 3), i).map(s => ({ source: s.source, target: s.target })),
      after: file.segments.slice(i + 1, i + 3).map(s => ({ source: s.source })),
      ...look,
    };
  }

  detectProjectLanguage(text) {
    return detectLanguage(text).lang;
  }
}

/** Read TBX (TBX-Basic, TBX v3) entries with a tokenizer. */
function tbxEntries(xml) {
  const entries = [];
  let entry = null, set = null, field = null, buf = '';
  for (const t of markupTokens(xml)) {
    if (t.type !== 'tag') { if (field) buf += t.value; continue; }
    const n = t.name;
    if (n === 'termentry' || n === 'conceptentry') {
      if (!t.closing) entry = { sets: [], note: '' }; else if (entry) { entries.push(entry); entry = null; }
    } else if (n === 'langset' && entry) {
      if (!t.closing) set = { lang: (tagAttr(t.raw, 'xml:lang') || '').toLowerCase().split('-')[0], term: '', deprecated: false, preferred: false };
      else if (set) { entry.sets.push(set); set = null; }
    } else if ((n === 'term' || n === 'descrip' || n === 'termnote') && entry) {
      if (!t.closing) { field = n; buf = ''; }
      else if (field === n) {
        const v = stripTags(buf).trim();
        if (n === 'term' && set && !set.term) set.term = v;
        else if (n === 'descrip' && !entry.note) entry.note = v;
        else if (n === 'termnote' && set) { if (/deprecated|forbidden|notRecommended/i.test(v)) set.deprecated = true; if (/preferred/i.test(v)) set.preferred = true; }
        field = null;
      }
    } else if (field) buf += t.raw;
  }
  return entries;
}

function publicSeg(s) {
  const { words, para, ...rest } = s;
  return rest;
}

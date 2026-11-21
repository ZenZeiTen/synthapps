// Translation memory: storage-agnostic index with fuzzy matching, word diff
// and match-band analysis. Scores follow common TMS conventions:
// 101 = exact match in the same context, 100 = exact, 99 = differs only in
// case, spacing or punctuation, below that an edit-distance similarity.
import { tokenize } from './text.js';

export function normKey(s) {
  return String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

function looseKey(s) {
  return normKey(s).toLowerCase().replace(/[\p{P}\p{S}]/gu, '').replace(/\s+/g, ' ').trim();
}

function wordSet(s) {
  return new Set(tokenize(s, 'en').map(t => t.text.toLowerCase()));
}

/** Levenshtein distance between two arrays or strings, O(n·m) with two rows. */
export function levenshtein(a, b) {
  if (a === b) return 0;
  const n = a.length, m = b.length;
  if (!n) return m;
  if (!m) return n;
  let prev = new Array(m + 1), cur = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    const ai = a[i - 1];
    for (let j = 1; j <= m; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ai === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[m];
}

/** Similarity 0..100 between two segments (character level, case-insensitive). */
export function similarity(a, b) {
  const x = normKey(a), y = normKey(b);
  if (x === y) return 100;
  if (looseKey(x) === looseKey(y) && looseKey(x)) return 99;
  const xl = x.toLowerCase(), yl = y.toLowerCase();
  const max = Math.max(xl.length, yl.length);
  if (!max) return 100;
  // Blend character and word distance: words catch reordering, characters catch inflection.
  const charSim = 1 - levenshtein(xl, yl) / max;
  const xw = tokenize(xl, 'en').map(t => t.text), yw = tokenize(yl, 'en').map(t => t.text);
  const wmax = Math.max(xw.length, yw.length) || 1;
  const wordSim = 1 - levenshtein(xw, yw) / wmax;
  return Math.max(0, Math.min(98, Math.round((charSim * 0.6 + wordSim * 0.4) * 100)));
}

/** Word-level diff of `from` (TM source) against `to` (current source). */
export function wordDiff(from, to) {
  const tok = s => String(s).match(/\s+|[\p{L}\p{M}\p{N}]+|[^\s\p{L}\p{M}\p{N}]/gu) || [];
  const a = tok(from), b = tok(to);
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = [];
  const push = (op, text) => { const last = ops.at(-1); if (last && last.op === op) last.text += text; else ops.push({ op, text }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push('eq', a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) push('del', a[i++]);
    else push('ins', b[j++]);
  }
  while (i < n) push('del', a[i++]);
  while (j < m) push('ins', b[j++]);
  return ops;
}

/**
 * In-memory TM index. `units` are { id, source, target, context, createdAt,
 * updatedAt, usage }. The caller persists `units`.
 */
export class TmIndex {
  constructor(tm) {
    this.tm = tm;
    this.exact = new Map();
    this.words = new Map();
    for (const u of tm.units) this._index(u);
  }

  _index(u) {
    this.exact.set(normKey(u.source), u);
    for (const w of wordSet(u.source)) {
      let set = this.words.get(w);
      if (!set) this.words.set(w, set = new Set());
      set.add(u);
    }
  }

  _unindex(u) {
    if (this.exact.get(normKey(u.source)) === u) this.exact.delete(normKey(u.source));
    for (const w of wordSet(u.source)) this.words.get(w)?.delete(u);
  }

  /** Add or update a translation unit. Returns the unit. */
  add(source, target, { context = null } = {}) {
    source = normKey(source); target = String(target ?? '').trim();
    if (!source || !target) return null;
    const now = new Date().toISOString();
    const existing = this.exact.get(source);
    if (existing) {
      existing.target = target;
      existing.updatedAt = now;
      if (context) existing.context = context;
      return existing;
    }
    const u = { id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), source, target, context, createdAt: now, updatedAt: now, usage: 0 };
    this.tm.units.push(u);
    this._index(u);
    return u;
  }

  remove(id) {
    const i = this.tm.units.findIndex(u => u.id === id);
    if (i >= 0) { this._unindex(this.tm.units[i]); this.tm.units.splice(i, 1); }
  }

  /** Best matches for `source`, highest first. */
  lookup(source, { min = 50, limit = 5, context = null } = {}) {
    const key = normKey(source);
    if (!key) return [];
    const out = [];
    const ex = this.exact.get(key);
    if (ex) out.push({ unit: ex, score: context && ex.context === context ? 101 : 100 });
    const qWords = [...wordSet(key)];
    const counts = new Map();
    for (const w of qWords) for (const u of this.words.get(w) || []) if (u !== ex) counts.set(u, (counts.get(u) || 0) + 1);
    // Only score candidates that share enough words; keeps lookups fast on large TMs.
    const need = Math.max(1, Math.floor(qWords.length * 0.3));
    const cands = [...counts.entries()].filter(([, c]) => c >= need).sort((a, b) => b[1] - a[1]).slice(0, 200);
    for (const [u] of cands) {
      const score = similarity(u.source, key);
      if (score >= min) out.push({ unit: u, score });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit);
  }

  search(q, limit = 100) {
    const s = String(q || '').toLowerCase();
    const list = s ? this.tm.units.filter(u => u.source.toLowerCase().includes(s) || u.target.toLowerCase().includes(s)) : this.tm.units;
    return list.slice(-limit).reverse();
  }
}

export const BANDS = ['101%', '100%', '95-99%', '85-94%', '75-84%', '50-74%', 'No match', 'Repetitions'];

export function bandOf(score) {
  if (score == null) return 'No match';
  if (score >= 101) return '101%';
  if (score >= 100) return '100%';
  if (score >= 95) return '95-99%';
  if (score >= 85) return '85-94%';
  if (score >= 75) return '75-84%';
  if (score >= 50) return '50-74%';
  return 'No match';
}

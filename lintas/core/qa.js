// Deterministic translation quality checks. Every issue names the check,
// a severity and a plain-language message.

const PLACEHOLDER = /\{\{\s*[\w.]+\s*\}\}|\{[\w.]+\}|%(?:\d+\$)?[sdif@]|\$\{[\w.]+\}|\$[\w]+|:[a-z_]+\b(?=[^:]|$)/g;
const TAG = /<\/?[a-z][^<>]*>|\{\/?\d+\}|\{\/\}/gi;
const NUMBER = /\d+(?:[.,]\d+)*/g;

function list(re, s) {
  return (String(s || '').match(re) || []).map(x => x.trim()).sort();
}

function sameMultiset(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Normalise numbers so 1,000.5 (en) and 1.000,5 (id) compare equal. */
function numValue(s) {
  const t = s.replace(/[.,](?=\d{3}(\D|$))/g, '');
  return t.replace(',', '.');
}

function endPunct(s) {
  const m = String(s).trim().match(/[.!?:;…。！？]$/u);
  return m ? m[0].replace('。', '.').replace('！', '!').replace('？', '?') : '';
}

/**
 * Check one segment. `terms` are term hits for the source: [{ source, target,
 * status }] where status is preferred|admitted|forbidden.
 */
export function checkSegment(seg, { terms = [], sourceLang = 'en', targetLang = 'id' } = {}) {
  const issues = [];
  const src = seg.source ?? seg.text ?? '';
  const tgt = seg.target ?? '';
  const add = (check, severity, message) => issues.push({ check, severity, message, segmentId: seg.id });
  if (!tgt.trim()) {
    if (['translated', 'reviewed', 'approved'].includes(seg.status)) add('empty-target', 'critical', 'The target is empty but the segment is marked as done.');
    return issues;
  }
  if (tgt.trim() === src.trim() && /\p{L}{3,}/u.test(src) && sourceLang !== targetLang && src.split(/\s+/).length > 1)
    add('untranslated', 'major', 'The target is identical to the source.');
  const ns = list(NUMBER, src).map(numValue).sort(), nt = list(NUMBER, tgt).map(numValue).sort();
  if (!sameMultiset(ns, nt)) add('number-mismatch', 'major', `Numbers differ: source has ${ns.join(', ') || 'none'}, target has ${nt.join(', ') || 'none'}.`);
  const ps = list(PLACEHOLDER, src), pt = list(PLACEHOLDER, tgt);
  if (!sameMultiset(ps, pt)) add('placeholder-mismatch', 'critical', `Placeholders differ: source ${ps.join(' ') || 'none'}, target ${pt.join(' ') || 'none'}.`);
  const ts = list(TAG, src), tt = list(TAG, tgt);
  if (!sameMultiset(ts, tt)) add('tag-mismatch', 'critical', `Tags differ: source ${ts.length}, target ${tt.length}.`);
  const es = endPunct(src), et = endPunct(tgt);
  if (es !== et && (es || et)) add('end-punctuation', 'minor', `Ending punctuation differs ("${es || 'none'}" vs "${et || 'none'}").`);
  if (/ {2,}/.test(tgt) && !/ {2,}/.test(src)) add('double-space', 'minor', 'The target contains double spaces.');
  if ((/^\s|\s$/.test(tgt)) !== (/^\s|\s$/.test(src))) add('leading-trailing-space', 'minor', 'Leading or trailing spaces differ from the source.');
  if (src.length >= 20) {
    const r = tgt.length / src.length;
    if (r > 2.5 || r < 0.4) add('length-ratio', 'minor', `The target is ${Math.round(r * 100)} % of the source length.`);
  }
  const low = tgt.toLowerCase();
  for (const t of terms) {
    if (!t.target) continue;
    const variants = t.target.toLowerCase().split(/\s*[;|]\s*/);
    if (t.status === 'forbidden') {
      if (variants.some(v => v && low.includes(v))) add('term-forbidden', 'major', `Uses the forbidden term "${t.target}".`);
    } else if (!variants.some(v => v && low.includes(v))) {
      add('term-missing', t.status === 'preferred' ? 'major' : 'minor', `"${t.source}" should be translated as "${t.target}".`);
    }
  }
  return issues;
}

/** Same source translated differently in one set of segments. */
export function inconsistencies(segments) {
  const by = new Map();
  for (const s of segments) {
    if (!(s.target || '').trim()) continue;
    const k = (s.source || '').trim().toLowerCase();
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(s);
  }
  const issues = [];
  for (const group of by.values()) {
    const targets = new Set(group.map(s => s.target.trim()));
    if (targets.size > 1) for (const s of group.slice(1))
      issues.push({ check: 'inconsistent-target', severity: 'minor', message: `The same source is translated ${targets.size} different ways in this file.`, segmentId: s.id });
  }
  return issues;
}

export const CHECKS = ['untranslated', 'empty-target', 'number-mismatch', 'placeholder-mismatch', 'tag-mismatch', 'end-punctuation',
  'double-space', 'leading-trailing-space', 'length-ratio', 'term-missing', 'term-forbidden', 'inconsistent-target'];

import { afterEach, describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { id } from '../src/i18n/id';
import { num, setLang, signedNum } from '../src/i18n';
import { makeCsv } from '../src/lib/backup';
import { entryContext, fmtDayHeading, tagLabel } from '../src/lib/format';
import { analyze } from '../src/lib/insights';
import { buildReport, pdfText } from '../src/lib/pdf';
import { gradeBP, gradeGlucose, gradeUric } from '../src/lib/ranges';
import { sampleEntries } from '../src/lib/sample';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type Entry } from '../src/lib/types';
import { formatValue } from '../src/lib/units';

const NOW = new Date('2026-11-17T21:00').getTime();

afterEach(() => setLang('en'));

/** Every leaf of a dictionary as [path, value]. */
function leaves(obj: unknown, path = ''): [string, unknown][] {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.entries(obj).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  }
  if (Array.isArray(obj) && obj.some((x) => typeof x !== 'string')) {
    return obj.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  }
  return [[path, obj]];
}

/** Calls a dictionary function with plausible arguments so its text can be checked. */
function render(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v as string[];
  if (typeof v === 'function') {
    const outs: string[] = [];
    for (const args of [[1, 2, 3, 4], [5, 7, 9, 11], ['120/80', 'label', 'detail', 'x']]) {
      try {
        outs.push(String((v as (...a: unknown[]) => unknown)(...args)));
      } catch {
        /* argument types differ; another set will fit */
      }
    }
    return outs;
  }
  return [];
}

describe('dictionaries', () => {
  it('have the same keys in English and Indonesian', () => {
    const a = leaves(en).map(([p]) => p).sort();
    const b = leaves(id).map(([p]) => p).sort();
    expect(b).toEqual(a);
  });

  it('have the same kind of value for every key', () => {
    const bm = new Map(leaves(id));
    for (const [p, v] of leaves(en)) {
      const w = bm.get(p);
      expect(typeof w, p).toBe(typeof v);
      if (Array.isArray(v)) expect((w as unknown[]).length, p).toBe(v.length);
    }
  });

  it('use only characters the PDF fonts can print', () => {
    for (const dict of [en, id]) {
      for (const [p, v] of leaves(dict)) {
        for (const s of render(v)) expect(pdfText(s), p).toBe(s);
      }
    }
  });

  it('translate every text in Indonesian (no English left in place)', () => {
    const same = new Set(['Normal', 'Diabetes', 'HbA1c', 'EN', 'ID', 'Vitalis', 'en', 'Gout']);
    const em = new Map(leaves(en));
    const leftovers = leaves(id)
      .filter(([p, v]) => typeof v === 'string' && v === em.get(p) && !same.has(v as string) && !['meta.htmlLang', 'meta.locale', 'meta.languageName', 'meta.short'].includes(p) && !p.startsWith('common.tags'))
      .map(([p]) => p);
    expect(leftovers).toEqual([]);
  });
});

describe('Indonesian output', () => {
  it('grades readings with Indonesian labels', () => {
    setLang('id');
    expect(gradeBP(134, 85).label).toBe('Rentang tahap 1');
    expect(gradeGlucose(110, 'fasting').label).toBe('Rentang prediabetes');
    expect(gradeUric(9.4).label).toBe('Jauh di atas rentang');
  });

  it('uses a decimal comma and Indonesian day names', () => {
    setLang('id');
    expect(num(6.42, 1)).toBe('6,4');
    expect(signedNum(-0.04, 1)).toBe('0,0');
    expect(formatValue('uric', 6.4, DEFAULT_SETTINGS)).toBe('6,4');
    expect(fmtDayHeading(NOW, NOW)).toBe('Hari ini');
    setLang('en');
    expect(num(6.42, 1)).toBe('6.4');
  });

  it('shows stored tags and context in the app language', () => {
    setLang('id');
    expect(tagLabel('Coffee')).toBe('Kopi');
    expect(tagLabel('My own tag')).toBe('My own tag');
    const e = { metric: 'bp', arm: 'left', position: 'sitting', pulse: 70 } as Entry;
    expect(entryContext(e)).toBe('nadi 70, duduk, lengan kiri');
  });

  it('keeps question and test IDs the same in both languages', () => {
    const entries = sampleEntries(NOW);
    const profile = { ...DEFAULT_PROFILE, sex: 'male' as const };
    const a = analyze(entries, profile, DEFAULT_SETTINGS, 90, NOW);
    setLang('id');
    const b = analyze(entries, profile, DEFAULT_SETTINGS, 90, NOW);
    expect(b.questions.map((q) => q.id)).toEqual(a.questions.map((q) => q.id));
    expect(b.labs.map((l) => l.id)).toEqual(a.labs.map((l) => l.id));
    expect(b.insights.map((i) => i.id)).toEqual(a.insights.map((i) => i.id));
    expect(b.questions[0].text).not.toBe(a.questions[0].text);
  });

  it('writes insights without English words', () => {
    setLang('id');
    const a = analyze(sampleEntries(NOW), { ...DEFAULT_PROFILE, sex: 'male', hasDiabetes: true }, DEFAULT_SETTINGS, 90, NOW);
    const text = [...a.insights.flatMap((i) => [i.title, i.body]), ...a.questions.map((q) => q.text), ...a.labs.map((l) => l.why)].join(' ');
    expect(text).not.toMatch(/\b(the|your|readings?|above|below|average)\b/i);
  });

  it('writes CSV headers in the app language', () => {
    setLang('id');
    const csv = makeCsv(sampleEntries(NOW).slice(0, 3), DEFAULT_SETTINGS);
    expect(csv.split('\n')[0]).toBe('Tanggal,Waktu,Pengukuran,Nilai,Satuan,Nadi (bpm),Keterangan,Tag,Catatan');
  });

  it('builds the PDF report in Indonesian', () => {
    setLang('id');
    const entries = sampleEntries(NOW);
    const a = analyze(entries, DEFAULT_PROFILE, DEFAULT_SETTINGS, 90, NOW);
    const doc = buildReport(entries, a, DEFAULT_PROFILE, DEFAULT_SETTINGS, { summary: true, charts: true, insights: true, questions: true, tests: true, log: true });
    expect(doc.getNumberOfPages()).toBeGreaterThan(3);
    const raw = doc.output();
    expect(raw).toContain('Laporan hasil pengukuran kesehatan');
  });
});

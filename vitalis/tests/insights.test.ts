import { describe, expect, it } from 'vitest';
import { makeBackup, makeCsv, parseBackup } from '../src/lib/backup';
import { analyze } from '../src/lib/insights';
import { sampleEntries } from '../src/lib/sample';
import { DAY, loggingStreak, movingAverage, nowLocalISO, seriesFor, slopePerDay, summarize } from '../src/lib/stats';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type Entry } from '../src/lib/types';

const NOW = new Date('2026-11-17T21:00').getTime();

function bp(daysAgo: number, hour: number, s: number, d: number, extra: Partial<Entry> = {}): Entry {
  const t = new Date(NOW - daysAgo * DAY);
  t.setHours(hour, 0, 0, 0);
  return { id: `${daysAgo}-${hour}-${s}`, metric: 'bp', takenAt: nowLocalISO(t), systolic: s, diastolic: d, tags: [], notes: '', createdAt: '', updatedAt: '', ...extra };
}

describe('statistics', () => {
  it('finds no trend with too few points', () => {
    const pts = seriesFor([bp(1, 8, 120, 80), bp(2, 8, 130, 80)], 'systolic');
    expect(slopePerDay(pts)).toBeNull();
  });

  it('measures a rising trend', () => {
    const entries = Array.from({ length: 10 }, (_, i) => bp(20 - i * 2, 8, 120 + i * 2, 80));
    const pts = seriesFor(entries, 'systolic');
    expect(slopePerDay(pts)).toBeCloseTo(1, 5);
    expect(summarize(pts).trend30).toBeCloseTo(30, 3);
  });

  it('computes a trailing moving average', () => {
    const entries = [bp(3, 8, 120, 80), bp(2, 8, 130, 80), bp(1, 8, 140, 80)];
    const ma = movingAverage(seriesFor(entries, 'systolic'), 7);
    expect(ma.map((p) => p.v)).toEqual([120, 125, 130]);
  });

  it('counts a logging streak ending today', () => {
    const entries = [bp(0, 8, 120, 80), bp(1, 8, 120, 80), bp(2, 8, 120, 80), bp(4, 8, 120, 80)];
    expect(loggingStreak(entries, NOW)).toBe(3);
  });
});

describe('insights', () => {
  it('grades the average and raises questions for a stage 1 average', () => {
    const entries = Array.from({ length: 8 }, (_, i) => bp(i, 8, 134, 85));
    const a = analyze(entries, DEFAULT_PROFILE, DEFAULT_SETTINGS, 30, NOW);
    const avg = a.insights.find((i) => i.id === 'bp-average');
    expect(avg?.level).toBe('watch');
    expect(a.questions.some((q) => q.fromData && q.metric === 'bp')).toBe(true);
    expect(a.labs.find((l) => l.name.startsWith('24-hour'))?.suggested).toBe(true);
  });

  it('puts severe readings first', () => {
    const entries = [...Array.from({ length: 6 }, (_, i) => bp(i, 8, 125, 78)), bp(0, 9, 190, 115)];
    const a = analyze(entries, DEFAULT_PROFILE, DEFAULT_SETTINGS, 30, NOW);
    expect(a.insights[0].id).toBe('bp-severe');
    expect(a.insights[0].level).toBe('urgent');
  });

  it('notices a morning surge', () => {
    const entries = [0, 1, 2, 3].flatMap((d) => [bp(d, 7, 150, 90), bp(d, 20, 128, 80)]);
    const a = analyze(entries, DEFAULT_PROFILE, DEFAULT_SETTINGS, 30, NOW);
    expect(a.flags.bpMorningSurge).toBe(true);
  });

  it('notices low glucose', () => {
    const g = (d: number, v: number): Entry => ({ ...bp(d, 7, 0, 0), id: `g${d}`, metric: 'glucose', systolic: undefined, diastolic: undefined, value: v, glucoseContext: 'fasting' });
    const a = analyze([g(1, 90), g(2, 60), g(3, 50)], DEFAULT_PROFILE, DEFAULT_SETTINGS, 30, NOW);
    const lows = a.insights.find((i) => i.id === 'glucose-lows');
    expect(lows?.level).toBe('urgent');
    expect(a.flags.glucoseLows).toBe(2);
  });

  it('handles sample data without errors', () => {
    const entries = sampleEntries(NOW);
    const a = analyze(entries, { ...DEFAULT_PROFILE, sex: 'male' }, DEFAULT_SETTINGS, 90, NOW);
    expect(a.present).toEqual(['bp', 'hr', 'glucose', 'uric']);
    expect(a.insights.length).toBeGreaterThan(4);
  });

  it('says so when there is no data', () => {
    const a = analyze([], DEFAULT_PROFILE, DEFAULT_SETTINGS, 30, NOW);
    expect(a.insights[0].id).toBe('empty');
  });
});

describe('backup', () => {
  it('round-trips entries and skips broken ones', () => {
    const entries = sampleEntries(NOW).slice(0, 10);
    const text = makeBackup(entries, DEFAULT_PROFILE, DEFAULT_SETTINGS);
    const data = JSON.parse(text);
    data.entries.push({ id: 'x', metric: 'bp', takenAt: 'not a date' });
    const parsed = parseBackup(JSON.stringify(data));
    expect(parsed.entries).toHaveLength(10);
    expect(parsed.skipped).toBe(1);
  });

  it('rejects other files', () => {
    expect(() => parseBackup('{"hello":1}')).toThrow(/not a Vitalis backup/);
  });

  it('writes CSV with quoted notes', () => {
    const e = { ...bp(0, 8, 120, 80), notes: 'Felt "fine", rested' };
    const csv = makeCsv([e], DEFAULT_SETTINGS);
    expect(csv.split('\n')[1]).toContain('"Felt ""fine"", rested"');
  });
});

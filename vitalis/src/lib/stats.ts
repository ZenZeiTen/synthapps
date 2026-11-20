import { gradeEntry, LEVEL_RANK } from './ranges';
import type { Entry, Level, Metric, Profile } from './types';

export const DAY = 86_400_000;

/** Parses a local ISO date-time ("2026-11-17T07:30") into epoch milliseconds. */
export function timeOf(takenAt: string): number {
  return new Date(takenAt).getTime();
}

export function nowLocalISO(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface Point {
  t: number;
  v: number;
  level: Level;
  entryId: string;
}

/** A numeric series for one quantity of one metric, oldest first. */
export type SeriesKey = 'systolic' | 'diastolic' | 'hr' | 'glucose' | 'uric';

export function seriesFor(entries: Entry[], key: SeriesKey, profile?: Profile): Point[] {
  const out: Point[] = [];
  for (const e of entries) {
    let v: number | undefined;
    if (key === 'systolic' && e.metric === 'bp') v = e.systolic;
    else if (key === 'diastolic' && e.metric === 'bp') v = e.diastolic;
    else if (key === 'hr') v = e.metric === 'hr' ? e.value : e.metric === 'bp' ? e.pulse : undefined;
    else if (key === 'glucose' && e.metric === 'glucose') v = e.value;
    else if (key === 'uric' && e.metric === 'uric') v = e.value;
    if (v === undefined || Number.isNaN(v)) continue;
    let level: Level;
    if (key === 'hr' && e.metric === 'bp') {
      level = gradeEntry({ ...e, metric: 'hr', value: v, hrContext: 'resting' }, profile).level;
    } else {
      level = gradeEntry(e, profile).level;
    }
    out.push({ t: timeOf(e.takenAt), v, level, entryId: e.id });
  }
  return out.sort((a, b) => a.t - b.t);
}

export function inWindow<T extends { t: number }>(points: T[], from: number, to = Infinity): T[] {
  return points.filter((p) => p.t >= from && p.t <= to);
}

export function entriesInWindow(entries: Entry[], from: number, to = Infinity): Entry[] {
  return entries.filter((e) => {
    const t = timeOf(e.takenAt);
    return t >= from && t <= to;
  });
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Least-squares slope in units per day. Returns null when there is too
 * little data for a trend to mean anything: fewer than 5 points, or a
 * span of less than 7 days.
 */
export function slopePerDay(points: Point[]): number | null {
  if (points.length < 5) return null;
  const span = points[points.length - 1].t - points[0].t;
  if (span < 7 * DAY) return null;
  const xs = points.map((p) => (p.t - points[0].t) / DAY);
  const ys = points.map((p) => p.v);
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? null : num / den;
}

/** Trailing moving average over `days` days, evaluated at every point. */
export function movingAverage(points: Point[], days = 7): { t: number; v: number }[] {
  const out: { t: number; v: number }[] = [];
  let start = 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    sum += points[i].v;
    while (points[i].t - points[start].t > days * DAY) {
      sum -= points[start].v;
      start++;
    }
    out.push({ t: points[i].t, v: sum / (i - start + 1) });
  }
  return out;
}

export interface Summary {
  count: number;
  mean: number;
  min: number;
  max: number;
  sd: number;
  latest?: Point;
  /** Share of graded readings that are in range (0-1); NaN when none are graded. */
  inRange: number;
  /** Change per 30 days from the regression line, or null. */
  trend30: number | null;
  worst: Level;
  counts: Record<Level, number>;
}

export function summarize(points: Point[]): Summary {
  const vs = points.map((p) => p.v);
  const counts: Record<Level, number> = { neutral: 0, ok: 0, low: 0, mild: 0, watch: 0, high: 0, urgent: 0 };
  let worst: Level = 'neutral';
  for (const p of points) {
    counts[p.level]++;
    if (LEVEL_RANK[p.level] > LEVEL_RANK[worst]) worst = p.level;
  }
  const graded = points.length - counts.neutral;
  const slope = slopePerDay(points);
  return {
    count: points.length,
    mean: mean(vs),
    min: vs.length ? Math.min(...vs) : NaN,
    max: vs.length ? Math.max(...vs) : NaN,
    sd: stdev(vs),
    latest: points[points.length - 1],
    inRange: graded ? counts.ok / graded : NaN,
    trend30: slope === null ? null : slope * 30,
    worst,
    counts
  };
}

/** Hour of day of a point, local time. */
export function hourOf(t: number): number {
  return new Date(t).getHours();
}

export function metricOfSeries(key: SeriesKey): Metric {
  if (key === 'systolic' || key === 'diastolic') return 'bp';
  return key;
}

/** Consecutive calendar days, ending today or yesterday, with at least one entry. */
export function loggingStreak(entries: Entry[], now = Date.now()): number {
  const days = new Set(entries.map((e) => e.takenAt.slice(0, 10)));
  const key = (t: number) => {
    const d = new Date(t);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  let t = now;
  if (!days.has(key(t))) t -= DAY;
  let n = 0;
  while (days.has(key(t))) {
    n++;
    t -= DAY;
  }
  return n;
}

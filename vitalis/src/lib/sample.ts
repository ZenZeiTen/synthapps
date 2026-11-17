import { t } from '../i18n';
import { newId } from './db';
import { DAY, nowLocalISO } from './stats';
import type { Entry, GlucoseContext } from './types';

/** A deterministic pseudo-random generator so sample data looks the same each time. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * Builds 60 days of realistic readings for someone with mildly raised blood
 * pressure that improves, borderline fasting glucose and uric acid that is
 * coming down. Used for "Try with sample data".
 */
export function sampleEntries(now = Date.now()): Entry[] {
  const r = rng(42);
  const n = (mean: number, spread: number) => mean + (r() + r() + r() - 1.5) * spread;
  const out: Entry[] = [];
  const stamp = new Date(now).toISOString();
  const make = (t: number, e: Partial<Entry>): Entry => ({
    id: newId(),
    metric: 'bp',
    takenAt: nowLocalISO(new Date(t)),
    tags: [],
    notes: '',
    createdAt: stamp,
    updatedAt: stamp,
    ...e
  });

  for (let d = 60; d >= 0; d--) {
    const day = new Date(now - d * DAY);
    day.setSeconds(0, 0);
    const at = (h: number, m: number) => {
      const t = new Date(day);
      t.setHours(h, m);
      return t.getTime();
    };
    const improve = (60 - d) / 60; // 0 -> 1 over the period
    if (at(7, 10) > now) continue;

    // Morning and evening blood pressure, a little higher in the morning.
    out.push(make(at(7, Math.floor(r() * 30)), {
      metric: 'bp',
      systolic: Math.round(n(142 - improve * 12, 10)),
      diastolic: Math.round(n(89 - improve * 6, 6)),
      pulse: Math.round(n(76, 8)),
      position: 'sitting',
      arm: 'left',
      tags: r() < 0.15 ? ['Coffee'] : []
    }));
    if (at(20, 30) <= now && r() < 0.8) {
      out.push(make(at(20, Math.floor(r() * 40)), {
        metric: 'bp',
        systolic: Math.round(n(131 - improve * 9, 9)),
        diastolic: Math.round(n(84 - improve * 5, 6)),
        pulse: Math.round(n(72, 7)),
        position: 'sitting',
        arm: 'left',
        tags: r() < 0.1 ? ['Stressed'] : []
      }));
    }

    // Glucose three or four days a week.
    if (r() < 0.55) {
      out.push(make(at(6, 45), { metric: 'glucose', value: Math.round(n(108 - improve * 8, 12)), glucoseContext: 'fasting' as GlucoseContext, enteredUnit: 'mg/dL' }));
    }
    if (r() < 0.3 && at(14, 0) <= now) {
      out.push(make(at(14, Math.floor(r() * 50)), {
        metric: 'glucose',
        value: Math.round(n(150 - improve * 10, 22)),
        glucoseContext: 'after-meal',
        enteredUnit: 'mg/dL',
        notes: r() < 0.4 ? t().common.sampleLunch : ''
      }));
    }

    // Morning resting heart rate on some days.
    if (r() < 0.25) {
      out.push(make(at(6, 30), { metric: 'hr', value: Math.round(n(68, 8)), hrContext: 'after-waking' }));
    }

    // Uric acid roughly every two weeks.
    if (d % 14 === 3) {
      out.push(make(at(8, 15), { metric: 'uric', value: Number(n(8.1 - improve * 1.6, 0.5).toFixed(1)), enteredUnit: 'mg/dL', notes: d > 40 ? t().common.sampleRedMeat : '' }));
    }
  }
  return out;
}

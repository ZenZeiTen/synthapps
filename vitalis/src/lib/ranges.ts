/**
 * Reference ranges and grading.
 *
 * Sources the thresholds follow (general adult references; a clinician's
 * personal targets override them through Profile.targets):
 * - Blood pressure: 2017 ACC/AHA guideline categories, kept in the 2025
 *   AHA/ACC guideline (normal <120/<80, elevated 120-129/<80, stage 1
 *   130-139 or 80-89, stage 2 >=140 or >=90, severe >180 and/or >120).
 *   Hypotension is commonly described as below 90/60.
 * - Heart rate: resting adult range 60-100 bpm (AHA).
 * - Glucose: ADA Standards of Care. Diagnostic ranges for people without
 *   diabetes (fasting 100-125 prediabetes range, >=126 diabetes range; 2 h
 *   after glucose load 140-199 / >=200). Targets for people with diabetes
 *   (80-130 before meals, <180 at the 1-2 h peak after a meal). Level 1
 *   hypoglycaemia <70, level 2 <54 mg/dL.
 * - Uric acid: common laboratory reference ranges (about 2.4-6.0 mg/dL for
 *   women and 3.4-7.0 mg/dL for men; labs differ), urate solubility limit
 *   about 6.8 mg/dL, and the ACR 2020 gout treatment target below 6 mg/dL.
 */
import { num, t } from '../i18n';
import type { Entry, GlucoseContext, Grade, HrContext, Level, Profile } from './types';

export interface Band {
  /** Inclusive lower bound in canonical units; -Infinity for the first band. */
  from: number;
  /** Exclusive upper bound; Infinity for the last band. */
  to: number;
  level: Level;
  label: string;
  detail: string;
  /** The number to print at the band's lower edge when it differs from `from` (180 for "above 180"). */
  edge?: number;
}

export const LEVEL_RANK: Record<Level, number> = {
  neutral: 0,
  ok: 0,
  low: 1,
  mild: 2,
  watch: 3,
  high: 4,
  urgent: 5
};

export function worse(a: Grade, b: Grade): Grade {
  return LEVEL_RANK[b.level] > LEVEL_RANK[a.level] ? b : a;
}

/** Builds a band from a [label, detail] pair in the dictionary. */
function band(from: number, to: number, level: Level, [label, detail]: string[], edge?: number): Band {
  return { from, to, level, label, detail, ...(edge !== undefined ? { edge } : {}) };
}

function pick(bands: Band[], value: number): Grade {
  const band = bands.find((b) => value >= b.from && value < b.to) ?? bands[bands.length - 1];
  return { level: band.level, label: band.label, detail: band.detail };
}

/* ------------------------------------------------------------------ */
/* Blood pressure                                                      */
/* ------------------------------------------------------------------ */

export function systolicBands(profile?: Profile): Band[] {
  const r = t().ranges.sys;
  const bands: Band[] = [
    band(-Infinity, 90, 'low', r.low),
    band(90, 120, 'ok', r.normal),
    band(120, 130, 'mild', r.elevated),
    band(130, 140, 'watch', r.stage1),
    band(140, 181, 'high', r.stage2),
    band(181, Infinity, 'urgent', r.severe, 180)
  ];
  return withTarget(bands, profile?.targets.bpSystolicMax, 'systolic');
}

export function diastolicBands(profile?: Profile): Band[] {
  const r = t().ranges.dia;
  const bands: Band[] = [
    band(-Infinity, 60, 'low', r.low),
    band(60, 80, 'ok', r.normal),
    band(80, 90, 'watch', r.stage1),
    band(90, 121, 'high', r.stage2),
    band(121, Infinity, 'urgent', r.severe, 120)
  ];
  return withTarget(bands, profile?.targets.bpDiastolicMax, 'diastolic');
}

/**
 * A personal "keep below X" target from a clinician marks anything from X
 * up to the next worse band as above target.
 */
function withTarget(bands: Band[], max: number | undefined, which: 'systolic' | 'diastolic'): Band[] {
  if (!max) return bands;
  const r = t().ranges;
  return bands
    .map((b) => (b.level === 'ok' && b.to > max ? { ...b, to: max } : b))
    .flatMap((b, i, arr) => {
      const next = arr[i + 1];
      if (b.level === 'ok' && next && b.to < next.from) {
        return [b, { from: b.to, to: next.from, level: 'mild' as Level, label: r.bpAboveTarget, detail: r.bpAboveTargetDetail(max, which) }];
      }
      return [b];
    });
}

export function gradeBP(systolic: number, diastolic: number, profile?: Profile): Grade {
  const s = pick(systolicBands(profile), systolic);
  const d = pick(diastolicBands(profile), diastolic);
  const r = t().ranges;
  // Low blood pressure only counts when the other number is not raised.
  if (s.level === 'low' || d.level === 'low') {
    const other = s.level === 'low' ? d : s;
    if (LEVEL_RANK[other.level] <= LEVEL_RANK.low) return { level: 'low', label: r.bpLow[0], detail: r.bpLow[1] };
    return other;
  }
  const g = worse(s, d);
  if (g.level === 'urgent') return { level: 'urgent', label: r.bpSevere[0], detail: r.bpSevere[1] };
  return g;
}

/* ------------------------------------------------------------------ */
/* Heart rate                                                          */
/* ------------------------------------------------------------------ */

export function hrBands(): Band[] {
  const r = t().ranges.hr;
  return [
    band(-Infinity, 40, 'high', r.veryLow),
    band(40, 60, 'low', r.low),
    band(60, 101, 'ok', r.normal),
    band(101, 121, 'watch', r.high, 100),
    band(121, Infinity, 'high', r.veryHigh, 120)
  ];
}

export function gradeHR(bpm: number, context: HrContext = 'resting'): Grade {
  if (context === 'active' || context === 'after-exercise') {
    const [label, detail] = t().ranges.hr.notResting;
    return { level: 'neutral', label, detail };
  }
  return pick(hrBands(), bpm);
}

/* ------------------------------------------------------------------ */
/* Blood glucose (mg/dL)                                               */
/* ------------------------------------------------------------------ */

function hypo(): Band[] {
  const g = t().ranges.glucose;
  return [band(-Infinity, 54, 'urgent', g.veryLow), band(54, 70, 'low', g.low)];
}

export function glucoseBands(context: GlucoseContext, profile?: Profile): Band[] {
  const g = t().ranges.glucose;
  const tg = profile?.targets ?? {};
  if (profile?.hasDiabetes) {
    if (context === 'fasting' || context === 'before-meal') {
      const min = tg.glucoseFastingMin ?? 80;
      const max = tg.glucoseFastingMax ?? 130;
      return [
        ...hypo(),
        band(70, min, 'mild', [g.belowTarget, g.belowTargetDetail(min)]),
        band(min, max + 1, 'ok', [g.inTarget, g.inTargetBeforeDetail(min, max)]),
        band(max + 1, 181, 'watch', [g.aboveTarget, g.aboveTargetBeforeDetail(max)], max),
        band(181, 300, 'high', [g.high, g.highBeforeDetail], 180),
        band(300, Infinity, 'urgent', [g.veryHigh, g.veryHighDiabetesDetail])
      ];
    }
    const max = tg.glucoseAfterMealMax ?? 180;
    return [
      ...hypo(),
      band(70, max, 'ok', [g.inTarget, g.inTargetAfterDetail(max)]),
      band(max, 251, 'watch', [g.aboveTarget, g.aboveTargetAfterDetail(max)]),
      band(251, 300, 'high', [g.high, g.highAfterDetail], 250),
      band(300, Infinity, 'urgent', [g.veryHigh, g.veryHighDiabetesDetail])
    ];
  }
  if (context === 'fasting') {
    return [
      ...hypo(),
      band(70, 100, 'ok', g.fastingNormal),
      band(100, 126, 'watch', g.prediabetes),
      band(126, 300, 'high', g.diabetesRange),
      band(300, Infinity, 'urgent', [g.veryHigh, g.veryHighDetail])
    ];
  }
  return [
    ...hypo(),
    band(70, 140, 'ok', g.otherNormal),
    band(140, 200, 'watch', g.aboveUsual),
    band(200, 300, 'high', g.otherHigh),
    band(300, Infinity, 'urgent', [g.veryHigh, g.veryHighDetail])
  ];
}

export function gradeGlucose(mgdl: number, context: GlucoseContext, profile?: Profile): Grade {
  return pick(glucoseBands(context, profile), mgdl);
}

/* ------------------------------------------------------------------ */
/* Uric acid (mg/dL)                                                   */
/* ------------------------------------------------------------------ */

export function uricLimits(profile?: Profile): { low: number; high: number } {
  if (profile?.sex === 'male') return { low: 3.4, high: 7.0 };
  if (profile?.sex === 'female') return { low: 2.4, high: 6.0 };
  return { low: 2.4, high: 6.8 };
}

export function uricBands(profile?: Profile): Band[] {
  const u = t().ranges.uric;
  const { low, high } = uricLimits(profile);
  const target = profile?.targets.uricMax ?? (profile?.hasGout ? 6.0 : undefined);
  const upper = target ?? high;
  const okDetail = target ? u.targetDetail(num(target, 1)) : u.rangeDetail(num(low, 1), num(high, 1));
  return [
    band(-Infinity, low, 'low', u.below),
    band(low, upper, 'ok', [target ? u.inTarget : u.normal, okDetail]),
    band(upper, 9, 'watch', target ? [u.aboveTarget, u.aboveTargetDetail(num(target, 1))] : [u.aboveRange, u.aboveRangeDetail]),
    band(9, Infinity, 'high', u.wellAbove)
  ];
}

export function gradeUric(mgdl: number, profile?: Profile): Grade {
  return pick(uricBands(profile), mgdl);
}

/* ------------------------------------------------------------------ */

export function gradeEntry(entry: Entry, profile?: Profile): Grade {
  switch (entry.metric) {
    case 'bp':
      return gradeBP(entry.systolic ?? 0, entry.diastolic ?? 0, profile);
    case 'hr':
      return gradeHR(entry.value ?? 0, entry.hrContext);
    case 'glucose':
      return gradeGlucose(entry.value ?? 0, entry.glucoseContext ?? 'random', profile);
    case 'uric':
      return gradeUric(entry.value ?? 0, profile);
  }
}

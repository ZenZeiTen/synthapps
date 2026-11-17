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

function pick(bands: Band[], value: number): Grade {
  const band = bands.find((b) => value >= b.from && value < b.to) ?? bands[bands.length - 1];
  return { level: band.level, label: band.label, detail: band.detail };
}

/* ------------------------------------------------------------------ */
/* Blood pressure                                                      */
/* ------------------------------------------------------------------ */

export function systolicBands(profile?: Profile): Band[] {
  const bands: Band[] = [
    { from: -Infinity, to: 90, level: 'low', label: 'Low', detail: 'Below 90 mmHg systolic is often called low blood pressure. It matters most if you feel dizzy, faint or unwell.' },
    { from: 90, to: 120, level: 'ok', label: 'Normal', detail: 'Systolic pressure under 120 mmHg is in the normal range.' },
    { from: 120, to: 130, level: 'mild', label: 'Elevated', detail: '120 to 129 mmHg systolic is called elevated. Lifestyle changes help keep it from rising.' },
    { from: 130, to: 140, level: 'watch', label: 'Stage 1 range', detail: '130 to 139 mmHg systolic is in the stage 1 hypertension range.' },
    { from: 140, to: 181, level: 'high', label: 'Stage 2 range', detail: '140 mmHg systolic or more is in the stage 2 hypertension range.' },
    { from: 181, to: Infinity, edge: 180, level: 'urgent', label: 'Severe', detail: 'Above 180 mmHg systolic is severely high. Rest 5 minutes and measure again; get urgent care if it stays this high or you have symptoms.' }
  ];
  return withTarget(bands, profile?.targets.bpSystolicMax, 'mmHg systolic');
}

export function diastolicBands(profile?: Profile): Band[] {
  const bands: Band[] = [
    { from: -Infinity, to: 60, level: 'low', label: 'Low', detail: 'Below 60 mmHg diastolic is often called low. It matters most if you have symptoms.' },
    { from: 60, to: 80, level: 'ok', label: 'Normal', detail: 'Diastolic pressure under 80 mmHg is in the normal range.' },
    { from: 80, to: 90, level: 'watch', label: 'Stage 1 range', detail: '80 to 89 mmHg diastolic is in the stage 1 hypertension range.' },
    { from: 90, to: 121, level: 'high', label: 'Stage 2 range', detail: '90 mmHg diastolic or more is in the stage 2 hypertension range.' },
    { from: 121, to: Infinity, edge: 120, level: 'urgent', label: 'Severe', detail: 'Above 120 mmHg diastolic is severely high. Measure again after resting; get urgent care if it stays this high or you have symptoms.' }
  ];
  return withTarget(bands, profile?.targets.bpDiastolicMax, 'mmHg diastolic');
}

/**
 * A personal "keep below X" target from a clinician marks anything from X
 * up to the next worse band as above target.
 */
function withTarget(bands: Band[], max: number | undefined, unitLabel: string): Band[] {
  if (!max) return bands;
  return bands.map((b) => {
    if (b.level === 'ok' && b.to > max) {
      return { ...b, to: max };
    }
    return b;
  }).flatMap((b, i, arr) => {
    const next = arr[i + 1];
    if (b.level === 'ok' && next && b.to < next.from) {
      return [b, { from: b.to, to: next.from, level: 'mild' as Level, label: 'Above your target', detail: `Your clinician's target is below ${max} ${unitLabel}.` }];
    }
    return [b];
  });
}

export function gradeBP(systolic: number, diastolic: number, profile?: Profile): Grade {
  const s = pick(systolicBands(profile), systolic);
  const d = pick(diastolicBands(profile), diastolic);
  // Low blood pressure only counts when the other number is not raised.
  if (s.level === 'low' || d.level === 'low') {
    const other = s.level === 'low' ? d : s;
    if (LEVEL_RANK[other.level] <= LEVEL_RANK.low) {
      return { level: 'low', label: 'Low', detail: 'Below 90/60 mmHg is often called low blood pressure. It matters most if you feel dizzy, faint or unwell.' };
    }
    return other;
  }
  const g = worse(s, d);
  if (g.level === 'urgent') {
    return { level: 'urgent', label: 'Severe', detail: 'Above 180/120 mmHg is severely high. Rest 5 minutes and measure again. Call emergency services if you have chest pain, shortness of breath, back pain, numbness, weakness, trouble speaking or a change in vision.' };
  }
  return g;
}

/* ------------------------------------------------------------------ */
/* Heart rate                                                          */
/* ------------------------------------------------------------------ */

export function hrBands(): Band[] {
  return [
    { from: -Infinity, to: 40, level: 'high', label: 'Very slow', detail: 'A resting heart rate under 40 bpm needs prompt medical advice, especially with dizziness, fainting or tiredness.' },
    { from: 40, to: 60, level: 'low', label: 'Slow', detail: '40 to 59 bpm at rest is called bradycardia. It is often normal in fit people and during sleep; it matters if you have symptoms.' },
    { from: 60, to: 101, level: 'ok', label: 'Normal', detail: '60 to 100 bpm is the usual resting range for adults.' },
    { from: 101, to: 121, edge: 100, level: 'watch', label: 'Fast', detail: 'Over 100 bpm at rest is called tachycardia. Caffeine, stress, fever or dehydration can cause it; repeated readings are worth discussing.' },
    { from: 121, to: Infinity, edge: 120, level: 'high', label: 'Very fast', detail: 'A resting heart rate over 120 bpm is well above range. Seek care promptly if it persists or comes with chest pain, breathlessness or fainting.' }
  ];
}

export function gradeHR(bpm: number, context: HrContext = 'resting'): Grade {
  if (context === 'active' || context === 'after-exercise') {
    return { level: 'neutral', label: 'Not at rest', detail: 'Heart rate during or after activity is not compared with the resting range.' };
  }
  return pick(hrBands(), bpm);
}

/* ------------------------------------------------------------------ */
/* Blood glucose (mg/dL)                                               */
/* ------------------------------------------------------------------ */

const HYPO: Band[] = [
  { from: -Infinity, to: 54, level: 'urgent', label: 'Very low', detail: 'Below 54 mg/dL (3.0 mmol/L) is level 2 hypoglycaemia. Take fast-acting sugar now and follow your plan; get help if you cannot treat it yourself.' },
  { from: 54, to: 70, level: 'low', label: 'Low', detail: 'Below 70 mg/dL (3.9 mmol/L) is low. Take 15 g of fast-acting sugar and check again in 15 minutes.' }
];

export const GLUCOSE_CONTEXT_LABEL: Record<GlucoseContext, string> = {
  fasting: 'Fasting',
  'before-meal': 'Before a meal',
  'after-meal': '1-2 h after a meal',
  bedtime: 'Bedtime',
  random: 'Any time'
};

export function glucoseBands(context: GlucoseContext, profile?: Profile): Band[] {
  const t = profile?.targets ?? {};
  if (profile?.hasDiabetes) {
    if (context === 'fasting' || context === 'before-meal') {
      const min = t.glucoseFastingMin ?? 80;
      const max = t.glucoseFastingMax ?? 130;
      return [
        ...HYPO,
        { from: 70, to: min, level: 'mild', label: 'Below target', detail: `Your before-meal target starts at ${min} mg/dL.` },
        { from: min, to: max + 1, level: 'ok', label: 'In target', detail: `In your before-meal target of ${min} to ${max} mg/dL.` },
        { from: max + 1, to: 181, edge: max, level: 'watch', label: 'Above target', detail: `Above your before-meal target of ${max} mg/dL.` },
        { from: 181, to: 300, edge: 180, level: 'high', label: 'High', detail: 'Well above the before-meal target. Follow your care plan for high readings.' },
        { from: 300, to: Infinity, level: 'urgent', label: 'Very high', detail: 'Very high. Check ketones if your plan says so, drink water, and contact your care team; get urgent care if you are vomiting, drowsy or breathing fast.' }
      ];
    }
    const max = t.glucoseAfterMealMax ?? 180;
    return [
      ...HYPO,
      { from: 70, to: max, level: 'ok', label: 'In target', detail: `Under your after-meal target of ${max} mg/dL.` },
      { from: max, to: 251, level: 'watch', label: 'Above target', detail: `At or above your after-meal target of ${max} mg/dL.` },
      { from: 251, to: 300, edge: 250, level: 'high', label: 'High', detail: 'Well above target. Follow your care plan for high readings.' },
      { from: 300, to: Infinity, level: 'urgent', label: 'Very high', detail: 'Very high. Check ketones if your plan says so, drink water, and contact your care team; get urgent care if you are vomiting, drowsy or breathing fast.' }
    ];
  }
  if (context === 'fasting') {
    return [
      ...HYPO,
      { from: 70, to: 100, level: 'ok', label: 'Normal', detail: 'A fasting glucose of 70 to 99 mg/dL is in the normal range.' },
      { from: 100, to: 126, level: 'watch', label: 'Prediabetes range', detail: 'A fasting glucose of 100 to 125 mg/dL is in the prediabetes range. A lab test confirms it.' },
      { from: 126, to: 300, level: 'high', label: 'Diabetes range', detail: 'A fasting glucose of 126 mg/dL or more is in the diabetes range. Diagnosis needs lab tests, usually repeated.' },
      { from: 300, to: Infinity, level: 'urgent', label: 'Very high', detail: 'Very high. Contact a doctor today; get urgent care if you are vomiting, very thirsty, drowsy or confused.' }
    ];
  }
  return [
    ...HYPO,
    { from: 70, to: 140, level: 'ok', label: 'Normal', detail: 'Under 140 mg/dL is the usual range outside fasting.' },
    { from: 140, to: 200, level: 'watch', label: 'Above usual', detail: '140 to 199 mg/dL after eating is higher than usual and worth checking with a lab test.' },
    { from: 200, to: 300, level: 'high', label: 'High', detail: '200 mg/dL or more is high. With symptoms such as thirst or frequent urination it can point to diabetes; see a doctor.' },
    { from: 300, to: Infinity, level: 'urgent', label: 'Very high', detail: 'Very high. Contact a doctor today; get urgent care if you are vomiting, very thirsty, drowsy or confused.' }
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
  const { low, high } = uricLimits(profile);
  const target = profile?.targets.uricMax ?? (profile?.hasGout ? 6.0 : undefined);
  const upper = target ?? high;
  const okDetail = target
    ? `Below your target of ${target} mg/dL. Keeping uric acid under target lets gout crystals dissolve over time.`
    : `Within the typical range of about ${low} to ${high} mg/dL. Labs differ slightly.`;
  return [
    { from: -Infinity, to: low, level: 'low', label: 'Below range', detail: 'Below the typical range. This is rarely a concern on its own; mention it if it keeps happening.' },
    { from: low, to: upper, level: 'ok', label: target ? 'In target' : 'Normal', detail: okDetail },
    { from: upper, to: 9, level: 'watch', label: target ? 'Above target' : 'Above range', detail: target ? `At or above your target of ${target} mg/dL.` : 'Above the typical range (hyperuricaemia). Above about 6.8 mg/dL, urate crystals can form in joints.' },
    { from: 9, to: Infinity, level: 'high', label: 'Well above range', detail: '9 mg/dL or more is well above range and raises the risk of gout attacks and kidney stones.' }
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

export const LEVEL_LABEL: Record<Level, string> = {
  neutral: 'Not graded',
  ok: 'In range',
  low: 'Below range',
  mild: 'Slightly above',
  watch: 'Above range',
  high: 'High',
  urgent: 'Needs attention'
};

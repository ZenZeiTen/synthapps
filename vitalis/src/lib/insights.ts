/**
 * Turns a person's readings into plain-language findings, questions for a
 * clinician, lab tests worth asking about and which doctor to see. All of
 * it is educational: the app never diagnoses.
 *
 * Text comes from the dictionaries in src/i18n; questions and lab tests
 * carry stable IDs so choices the person makes survive a language switch.
 */
import { locale, num, t } from '../i18n';
import { gradeBP, gradeGlucose, gradeHR, gradeUric, LEVEL_RANK } from './ranges';
import { DAY, entriesInWindow, hourOf, mean, seriesFor, stdev, summarize, timeOf, type Point, type Summary } from './stats';
import { formatValue, unitFor } from './units';
import type { Entry, GlucoseContext, Level, Metric, Profile, Settings } from './types';

export interface Insight {
  id: string;
  metric: Metric | 'general';
  level: Level;
  title: string;
  body: string;
}

export interface Question {
  /** Stable ID, used to remember which questions go into the report. */
  id: string;
  metric: Metric | 'general';
  text: string;
  /** True when the question was raised by the person's own readings. */
  fromData: boolean;
}

export interface LabTest {
  id: string;
  metric: Metric;
  name: string;
  why: string;
  suggested: boolean;
}

export interface Specialist {
  id: string;
  who: string;
  when: string;
  metrics: Metric[];
  suggested: boolean;
}

export interface Analysis {
  from: number;
  to: number;
  days: number;
  insights: Insight[];
  questions: Question[];
  labs: LabTest[];
  specialists: Specialist[];
  /** Metrics with at least one reading in the window. */
  present: Metric[];
  summaries: {
    systolic: Summary;
    diastolic: Summary;
    hr: Summary;
    glucose: Summary;
    uric: Summary;
  };
  flags: Flags;
}

interface Flags {
  bpAvgLevel: Level;
  bpUrgent: number;
  bpLow: number;
  bpMorningSurge: boolean;
  bpArmDifference: boolean;
  bpRising: boolean;
  hrHigh: number;
  hrLow: number;
  hrIrregular: number;
  glucoseFastingLevel: Level;
  glucoseAfterLevel: Level;
  glucoseLows: number;
  glucoseVeryLows: number;
  glucoseVeryHigh: number;
  glucoseSwings: boolean;
  uricLevel: Level;
}

type Units = Pick<Settings, 'glucoseUnit' | 'uricUnit'>;

/** Stored tag key for the monitor's irregular heartbeat symbol. */
export const IRREGULAR_TAG = 'Irregular heartbeat';

const round = (n: number): string => String(Math.round(n));
const lower = (s: string): string => s.toLocaleLowerCase(locale());

export function analyze(entries: Entry[], profile: Profile, units: Units, days: number, now = Date.now()): Analysis {
  const T = t().insights;
  const from = days > 0 ? now - days * DAY : -Infinity;
  const win = entriesInWindow(entries, from, now);
  const insights: Insight[] = [];
  const q: Question[] = [];

  const sys = seriesFor(win, 'systolic', profile);
  const dia = seriesFor(win, 'diastolic', profile);
  const hr = seriesFor(win, 'hr', profile);
  const glu = seriesFor(win, 'glucose', profile);
  const uric = seriesFor(win, 'uric', profile);

  const summaries = {
    systolic: summarize(sys),
    diastolic: summarize(dia),
    hr: summarize(hr),
    glucose: summarize(glu),
    uric: summarize(uric)
  };

  const flags: Flags = {
    bpAvgLevel: 'neutral',
    bpUrgent: 0,
    bpLow: 0,
    bpMorningSurge: false,
    bpArmDifference: false,
    bpRising: false,
    hrHigh: 0,
    hrLow: 0,
    hrIrregular: 0,
    glucoseFastingLevel: 'neutral',
    glucoseAfterLevel: 'neutral',
    glucoseLows: 0,
    glucoseVeryLows: 0,
    glucoseVeryHigh: 0,
    glucoseSwings: false,
    uricLevel: 'neutral'
  };

  const present: Metric[] = [];
  const period = T.period(days);
  const add = (id: string, metric: Insight['metric'], level: Level, title: string, body: string) => insights.push({ id, metric, level, title, body });

  /* ---------------- Blood pressure ---------------- */
  const bpEntries = win.filter((e) => e.metric === 'bp' && e.systolic && e.diastolic);
  if (bpEntries.length) {
    present.push('bp');
    const s = summaries.systolic;
    const d = summaries.diastolic;
    const avg = gradeBP(s.mean, d.mean, profile);
    flags.bpAvgLevel = avg.level;
    add('bp-average', 'bp', avg.level, T.bpAverage(`${round(s.mean)}/${round(d.mean)}`, lower(avg.label)), T.bpAverageBody(s.count, period, avg.detail));

    if (bpEntries.length < 6) add('bp-few', 'bp', 'neutral', T.bpFew, T.bpFewBody);

    flags.bpUrgent = bpEntries.filter((e) => (e.systolic ?? 0) > 180 || (e.diastolic ?? 0) > 120).length;
    if (flags.bpUrgent) add('bp-severe', 'bp', 'urgent', T.bpSevere(flags.bpUrgent), T.bpSevereBody);

    flags.bpLow = bpEntries.filter((e) => (e.systolic ?? 0) < 90 && (e.diastolic ?? 0) < 80).length;
    if (flags.bpLow) add('bp-low', 'bp', 'low', T.bpLow(flags.bpLow), T.bpLowBody);

    if (s.trend30 !== null && Math.abs(s.trend30) >= 5) {
      const rising = s.trend30 > 0;
      flags.bpRising = rising;
      if (rising) add('bp-trend', 'bp', 'watch', T.bpRising(round(s.trend30)), T.bpRisingBody);
      else add('bp-trend', 'bp', 'ok', T.bpFalling(round(-s.trend30)), T.bpFallingBody);
    }

    const inHours = (e: Entry, a: number, b: number) => {
      const h = hourOf(timeOf(e.takenAt));
      return h >= a && h < b;
    };
    const morning = bpEntries.filter((e) => inHours(e, 4, 11));
    const evening = bpEntries.filter((e) => inHours(e, 17, 24));
    if (morning.length >= 3 && evening.length >= 3) {
      const am = mean(morning.map((e) => e.systolic ?? 0));
      const pm = mean(evening.map((e) => e.systolic ?? 0));
      if (am - pm >= 10) {
        flags.bpMorningSurge = true;
        add('bp-morning', 'bp', 'watch', T.bpMorning(round(am - pm)), T.bpMorningBody(round(am), round(pm)));
      } else if (pm - am >= 10) {
        add('bp-evening', 'bp', 'mild', T.bpEvening(round(pm - am)), T.bpEveningBody(round(am), round(pm)));
      }
    }

    const left = bpEntries.filter((e) => e.arm === 'left');
    const right = bpEntries.filter((e) => e.arm === 'right');
    if (left.length >= 2 && right.length >= 2) {
      const diff = Math.abs(mean(left.map((e) => e.systolic ?? 0)) - mean(right.map((e) => e.systolic ?? 0)));
      if (diff > 10) {
        flags.bpArmDifference = true;
        add('bp-arms', 'bp', 'watch', T.bpArms(round(diff)), T.bpArmsBody);
      }
    }

    if (sys.length >= 6 && s.sd >= 15) add('bp-variable', 'bp', 'mild', T.bpVariable, T.bpVariableBody(round(s.sd)));

    const pulsePressure = s.mean - d.mean;
    if (pulsePressure >= 60) add('bp-pulse-pressure', 'bp', 'mild', T.bpPulsePressure(round(pulsePressure)), T.bpPulsePressureBody);
  }

  /* ---------------- Heart rate ---------------- */
  const hrResting = hr.filter((p) => p.level !== 'neutral');
  if (hr.length) {
    present.push('hr');
    if (hrResting.length) {
      const restMean = mean(hrResting.map((p) => p.v));
      const g = gradeHR(restMean, 'resting');
      add('hr-average', 'hr', g.level, T.hrAverage(round(restMean), lower(g.label)), T.hrAverageBody(hrResting.length, period, g.detail));
    }
    flags.hrHigh = hrResting.filter((p) => p.v > 100).length;
    flags.hrLow = hrResting.filter((p) => p.v < 50).length;
    if (flags.hrHigh >= 2) add('hr-high', 'hr', 'watch', T.hrHigh(flags.hrHigh), T.hrHighBody);
    if (flags.hrLow >= 2) add('hr-low', 'hr', 'low', T.hrLow(flags.hrLow), T.hrLowBody);
    flags.hrIrregular = win.filter((e) => e.tags.includes(IRREGULAR_TAG)).length;
    if (flags.hrIrregular) add('hr-irregular', 'hr', 'watch', T.hrIrregular(flags.hrIrregular), T.hrIrregularBody);
    const tr = summarize(hrResting).trend30;
    if (tr !== null && Math.abs(tr) >= 5) {
      if (tr > 0) add('hr-trend', 'hr', 'mild', T.hrRising(round(tr)), T.hrRisingBody);
      else add('hr-trend', 'hr', 'ok', T.hrFalling(round(-tr)), T.hrFallingBody);
    }
  }

  /* ---------------- Glucose ---------------- */
  const gluEntries = win.filter((e) => e.metric === 'glucose' && e.value !== undefined);
  if (gluEntries.length) {
    present.push('glucose');
    const byCtx = (ctxs: GlucoseContext[]) => gluEntries.filter((e) => ctxs.includes(e.glucoseContext ?? 'random'));
    const fasting = byCtx(profile.hasDiabetes ? ['fasting', 'before-meal'] : ['fasting']);
    const after = byCtx(['after-meal']);
    const fmt = (v: number) => `${formatValue('glucose', v, units)} ${unitFor('glucose', units)}`;

    if (fasting.length) {
      const m = mean(fasting.map((e) => e.value ?? 0));
      const g = gradeGlucose(m, 'fasting', profile);
      flags.glucoseFastingLevel = g.level;
      add('glucose-fasting', 'glucose', g.level, T.glucoseFasting(profile.hasDiabetes, fmt(m), lower(g.label)), T.glucoseFastingBody(fasting.length, period, g.detail));
    }
    if (after.length) {
      const m = mean(after.map((e) => e.value ?? 0));
      const g = gradeGlucose(m, 'after-meal', profile);
      flags.glucoseAfterLevel = g.level;
      add('glucose-after', 'glucose', g.level, T.glucoseAfter(fmt(m), lower(g.label)), T.glucoseAfterBody(after.length, g.detail));
    }
    if (!fasting.length && !after.length) {
      const m = summaries.glucose.mean;
      add('glucose-random', 'glucose', gradeGlucose(m, 'random', profile).level, T.glucoseRandom(fmt(m)), T.glucoseRandomBody);
    }

    flags.glucoseLows = gluEntries.filter((e) => (e.value ?? 0) < 70).length;
    flags.glucoseVeryLows = gluEntries.filter((e) => (e.value ?? 0) < 54).length;
    if (flags.glucoseLows) {
      add('glucose-lows', 'glucose', flags.glucoseVeryLows ? 'urgent' : 'low', T.glucoseLows(flags.glucoseLows, fmt(70)), T.glucoseLowsBody(flags.glucoseVeryLows, fmt(54)));
    }
    flags.glucoseVeryHigh = gluEntries.filter((e) => (e.value ?? 0) >= 300).length;
    if (flags.glucoseVeryHigh) add('glucose-very-high', 'glucose', 'urgent', T.glucoseVeryHigh(flags.glucoseVeryHigh, fmt(300)), T.glucoseVeryHighBody);

    if (profile.hasDiabetes && glu.length >= 5) {
      const share = summaries.glucose.inRange;
      add('glucose-in-target', 'glucose', share >= 0.7 ? 'ok' : share >= 0.5 ? 'mild' : 'watch', T.glucoseInTarget(String(Math.round(share * 100))), T.glucoseInTargetBody);
    }

    if (glu.length >= 10) {
      const cv = stdev(glu.map((p) => p.v)) / summaries.glucose.mean;
      if (cv > 0.36) {
        flags.glucoseSwings = true;
        add('glucose-swings', 'glucose', 'watch', T.glucoseSwings, T.glucoseSwingsBody(String(Math.round(cv * 100))));
      }
    }

    const recent = glu.filter((p) => p.t >= now - 90 * DAY);
    if (recent.length >= 14 && recent[recent.length - 1].t - recent[0].t >= 14 * DAY) {
      const avg = mean(recent.map((p) => p.v));
      const a1c = (avg + 46.7) / 28.7;
      add('glucose-a1c', 'glucose', 'neutral', T.glucoseA1c(num(a1c, 1)), T.glucoseA1cBody(recent.length, fmt(avg)));
    }
  }

  /* ---------------- Uric acid ---------------- */
  if (uric.length) {
    present.push('uric');
    const latest = uric[uric.length - 1];
    const g = gradeUric(latest.v, profile);
    flags.uricLevel = g.level;
    const fmt = (v: number) => `${formatValue('uric', v, units)} ${unitFor('uric', units)}`;
    add('uric-latest', 'uric', g.level, T.uricLatest(fmt(latest.v), lower(g.label)), `${uric.length > 1 ? T.uricLatestAverage(uric.length, fmt(summaries.uric.mean)) : ''}${g.detail}`);
    const tr = summaries.uric.trend30;
    if (tr !== null && Math.abs(tr) >= 0.3) {
      if (tr > 0) add('uric-trend', 'uric', 'mild', T.uricRising(fmt(tr)), T.uricRisingBody);
      else add('uric-trend', 'uric', 'ok', T.uricFalling(fmt(-tr)), T.uricFallingBody);
    }
    if (LEVEL_RANK[g.level] >= LEVEL_RANK.watch) add('uric-tips', 'uric', 'neutral', T.uricTips, T.uricTipsBody);
  }

  if (!present.length) add('empty', 'general', 'neutral', T.empty, T.emptyBody);

  /* ---------------- Questions ---------------- */
  const Q = t().questions;
  const ask = (id: keyof typeof Q, metric: Question['metric'], fromData = true, ...args: [string] | [number] | []) => {
    const v = Q[id] as string | ((x: string | number) => string);
    q.push({ id, metric, fromData, text: typeof v === 'function' ? v(args[0] as never) : v });
  };

  if (present.includes('bp')) {
    const above = LEVEL_RANK[flags.bpAvgLevel] >= LEVEL_RANK.watch;
    if (above && !profile.hasHypertension) {
      ask('bp.confirm', 'bp', true, `${round(summaries.systolic.mean)}/${round(summaries.diastolic.mean)}`);
      ask('bp.target', 'bp');
    }
    if (above && profile.hasHypertension) ask('bp.treatment', 'bp');
    if (flags.bpUrgent) ask('bp.severe', 'bp');
    if (flags.bpMorningSurge) ask('bp.morning', 'bp');
    if (flags.bpLow) ask('bp.low', 'bp');
    if (flags.bpArmDifference) ask('bp.arms', 'bp');
    if (flags.bpRising) ask('bp.rising', 'bp');
    ask('bp.monitor', 'bp', false);
  }
  if (present.includes('hr')) {
    if (flags.hrHigh >= 2) ask('hr.high', 'hr');
    if (flags.hrLow >= 2) ask('hr.low', 'hr');
    if (flags.hrIrregular) ask('hr.irregular', 'hr');
    ask('hr.target', 'hr', false);
  }
  if (present.includes('glucose')) {
    if (!profile.hasDiabetes && (flags.glucoseFastingLevel === 'watch' || flags.glucoseAfterLevel === 'watch')) {
      ask('glucose.prediabetes', 'glucose');
      ask('glucose.risk', 'glucose');
    }
    if (!profile.hasDiabetes && (flags.glucoseFastingLevel === 'high' || flags.glucoseAfterLevel === 'high' || flags.glucoseVeryHigh)) {
      ask('glucose.diabetesRange', 'glucose');
    }
    if (profile.hasDiabetes && (LEVEL_RANK[flags.glucoseFastingLevel] >= LEVEL_RANK.watch || LEVEL_RANK[flags.glucoseAfterLevel] >= LEVEL_RANK.watch)) {
      ask('glucose.aboveTarget', 'glucose');
      ask('glucose.ketones', 'glucose');
    }
    if (flags.glucoseLows) {
      ask('glucose.lows', 'glucose', true, flags.glucoseLows);
      if (profile.hasDiabetes) ask('glucose.glucagon', 'glucose');
    }
    if (flags.glucoseSwings) ask('glucose.cgm', 'glucose');
    ask('glucose.frequency', 'glucose', false);
  }
  if (present.includes('uric')) {
    if (LEVEL_RANK[flags.uricLevel] >= LEVEL_RANK.watch) {
      ask(profile.hasGout ? 'uric.goutTreatment' : 'uric.treatment', 'uric');
      ask('uric.medicines', 'uric');
      ask('uric.kidneys', 'uric');
    }
    if (profile.hasGout) ask('uric.flare', 'uric', false);
    ask('uric.retest', 'uric', false);
  }
  ask('general.medicines', 'general', false);
  ask('general.tracking', 'general', false);

  return {
    from: Number.isFinite(from) ? from : win.length ? Math.min(...win.map((e) => timeOf(e.takenAt))) : now,
    to: now,
    days,
    insights: insights.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]),
    questions: q,
    labs: labsFor(present, flags, profile),
    specialists: specialistsFor(present, flags, profile),
    present,
    summaries,
    flags
  };
}

function labsFor(present: Metric[], f: Flags, profile: Profile): LabTest[] {
  const L = t().labs;
  const labs: LabTest[] = [];
  const add = (id: keyof typeof L, metric: Metric, suggested: boolean) => labs.push({ id, metric, name: L[id][0], why: L[id][1], suggested });
  const bpUp = LEVEL_RANK[f.bpAvgLevel] >= LEVEL_RANK.watch || f.bpUrgent > 0;
  const gluUp = LEVEL_RANK[f.glucoseFastingLevel] >= LEVEL_RANK.watch || LEVEL_RANK[f.glucoseAfterLevel] >= LEVEL_RANK.watch || f.glucoseVeryHigh > 0;
  const uricUp = LEVEL_RANK[f.uricLevel] >= LEVEL_RANK.watch;
  const hrOff = f.hrHigh >= 2 || f.hrLow >= 2 || f.hrIrregular > 0;

  if (present.includes('bp')) {
    add('bp.abpm', 'bp', bpUp && !profile.hasHypertension);
    add('bp.kidney', 'bp', bpUp);
    add('bp.uacr', 'bp', bpUp);
    add('bp.lipids', 'bp', bpUp);
    add('bp.glucose', 'bp', bpUp);
    add('bp.tsh', 'bp', bpUp);
    add('bp.ecg', 'bp', bpUp);
    add('bp.aldo', 'bp', bpUp && profile.hasHypertension);
  }
  if (present.includes('hr')) {
    add('hr.ecg', 'hr', hrOff);
    add('hr.holter', 'hr', f.hrIrregular > 0 || f.hrHigh >= 2);
    add('hr.thyroid', 'hr', hrOff);
    add('hr.fbc', 'hr', f.hrHigh >= 2);
    add('hr.electrolytes', 'hr', hrOff);
  }
  if (present.includes('glucose')) {
    add('glucose.a1c', 'glucose', gluUp || profile.hasDiabetes);
    add('glucose.fpg', 'glucose', gluUp && !profile.hasDiabetes);
    add('glucose.ogtt', 'glucose', gluUp && !profile.hasDiabetes);
    add('glucose.lipidsKidney', 'glucose', profile.hasDiabetes || gluUp);
    add('glucose.alt', 'glucose', gluUp);
    add('glucose.eyesFeet', 'glucose', profile.hasDiabetes);
    add('glucose.cpeptide', 'glucose', false);
  }
  if (present.includes('uric')) {
    add('uric.repeat', 'uric', uricUp);
    add('uric.kidney', 'uric', uricUp);
    add('uric.metabolic', 'uric', uricUp);
    add('uric.liver', 'uric', uricUp && profile.hasGout);
    add('uric.crystals', 'uric', profile.hasGout);
    add('uric.hla', 'uric', uricUp);
    add('uric.urine24', 'uric', false);
  }
  return labs.sort((a, b) => Number(b.suggested) - Number(a.suggested));
}

function specialistsFor(present: Metric[], f: Flags, profile: Profile): Specialist[] {
  const S = t().specialists;
  const bpUp = LEVEL_RANK[f.bpAvgLevel] >= LEVEL_RANK.watch || f.bpUrgent > 0;
  const gluUp = LEVEL_RANK[f.glucoseFastingLevel] >= LEVEL_RANK.watch || LEVEL_RANK[f.glucoseAfterLevel] >= LEVEL_RANK.watch || f.glucoseVeryHigh > 0;
  const uricUp = LEVEL_RANK[f.uricLevel] >= LEVEL_RANK.watch;
  const hrOff = f.hrHigh >= 2 || f.hrLow >= 2 || f.hrIrregular > 0;
  const make = (id: keyof typeof S, metrics: Metric[], suggested: boolean): Specialist => ({ id, who: S[id][0], when: S[id][1], metrics, suggested });
  const list: Specialist[] = [
    make('gp', present.length ? present : ['bp', 'hr', 'glucose', 'uric'], bpUp || gluUp || uricUp || hrOff || f.glucoseLows > 0 || f.bpLow > 0),
    make('cardiologist', ['bp', 'hr'], f.bpUrgent > 0 || hrOff || (bpUp && profile.hasHypertension)),
    make('ep', ['hr'], false),
    make('endocrinologist', ['glucose', 'bp', 'hr'], (profile.hasDiabetes && gluUp) || f.glucoseVeryLows > 0 || f.glucoseVeryHigh > 0),
    make('nephrologist', ['bp', 'uric', 'glucose'], false),
    make('rheumatologist', ['uric'], uricUp && profile.hasGout),
    make('dietitian', ['glucose', 'uric', 'bp'], gluUp || uricUp)
  ];
  return list.filter((s) => s.metrics.some((m) => present.includes(m)) || !present.length).sort((a, b) => Number(b.suggested) - Number(a.suggested));
}

/** Signs that need emergency care, in the current language. */
export function emergencySigns(): string[] {
  return t().emergency;
}

export type { Point };

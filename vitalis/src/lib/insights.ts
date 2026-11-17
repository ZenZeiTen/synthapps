/**
 * Turns a person's readings into plain-language findings, questions for a
 * clinician, lab tests worth asking about and which doctor to see. All of
 * it is educational: the app never diagnoses.
 */
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
  metric: Metric | 'general';
  text: string;
  /** True when the question was raised by the person's own readings. */
  fromData: boolean;
}

export interface LabTest {
  metric: Metric;
  name: string;
  why: string;
  suggested: boolean;
}

export interface Specialist {
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

const BP_UNIT = 'mmHg';

export const IRREGULAR_TAG = 'Irregular heartbeat';

function round(n: number): string {
  return String(Math.round(n));
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function analyze(entries: Entry[], profile: Profile, units: Units, days: number, now = Date.now()): Analysis {
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
  const period = days > 0 ? `the last ${days} days` : 'all your readings';

  /* ---------------- Blood pressure ---------------- */
  const bpEntries = win.filter((e) => e.metric === 'bp' && e.systolic && e.diastolic);
  if (bpEntries.length) {
    present.push('bp');
    const s = summaries.systolic;
    const d = summaries.diastolic;
    const avg = gradeBP(s.mean, d.mean, profile);
    flags.bpAvgLevel = avg.level;
    insights.push({
      id: 'bp-average',
      metric: 'bp',
      level: avg.level,
      title: `Average ${round(s.mean)}/${round(d.mean)} ${BP_UNIT}: ${avg.label.toLowerCase()}`,
      body: `Across ${plural(s.count, 'reading')} in ${period}. ${avg.detail}`
    });

    if (bpEntries.length < 6) {
      insights.push({
        id: 'bp-few',
        metric: 'bp',
        level: 'neutral',
        title: 'More readings give a clearer picture',
        body: 'Doctors judge home blood pressure on an average of many readings. A common plan: two readings a minute apart, morning and evening, for 7 days, sitting with your back supported and feet flat after 5 minutes of rest.'
      });
    }

    flags.bpUrgent = bpEntries.filter((e) => (e.systolic ?? 0) > 180 || (e.diastolic ?? 0) > 120).length;
    if (flags.bpUrgent) {
      insights.push({
        id: 'bp-severe',
        metric: 'bp',
        level: 'urgent',
        title: `${plural(flags.bpUrgent, 'reading')} above 180/120 ${BP_UNIT}`,
        body: 'Readings this high need a doctor soon, even without symptoms. With chest pain, shortness of breath, back pain, numbness, weakness, trouble speaking or vision changes, call emergency services straight away.'
      });
    }

    flags.bpLow = bpEntries.filter((e) => (e.systolic ?? 0) < 90 && (e.diastolic ?? 0) < 80).length;
    if (flags.bpLow) {
      insights.push({
        id: 'bp-low',
        metric: 'bp',
        level: 'low',
        title: `${plural(flags.bpLow, 'reading')} below 90 ${BP_UNIT} systolic`,
        body: 'Low readings matter mostly if you feel dizzy, light-headed or faint, especially when standing up. Note any symptoms alongside the reading.'
      });
    }

    if (s.trend30 !== null && Math.abs(s.trend30) >= 5) {
      const rising = s.trend30 > 0;
      flags.bpRising = rising;
      insights.push({
        id: 'bp-trend',
        metric: 'bp',
        level: rising ? 'watch' : 'ok',
        title: rising ? `Systolic pressure is rising about ${round(s.trend30)} ${BP_UNIT} a month` : `Systolic pressure is falling about ${round(-s.trend30)} ${BP_UNIT} a month`,
        body: rising
          ? 'The trend line across your readings is going up. Changes in medication, salt, sleep, stress or weight can all play a part.'
          : 'The trend line across your readings is going down. If you also feel dizzy, mention it, as medication may need adjusting.'
      });
    }

    const morning = bpEntries.filter((e) => {
      const h = hourOf(timeOf(e.takenAt));
      return h >= 4 && h < 11;
    });
    const evening = bpEntries.filter((e) => {
      const h = hourOf(timeOf(e.takenAt));
      return h >= 17 && h < 24;
    });
    if (morning.length >= 3 && evening.length >= 3) {
      const am = mean(morning.map((e) => e.systolic ?? 0));
      const pm = mean(evening.map((e) => e.systolic ?? 0));
      if (am - pm >= 10) {
        flags.bpMorningSurge = true;
        insights.push({
          id: 'bp-morning',
          metric: 'bp',
          level: 'watch',
          title: `Mornings run ${round(am - pm)} ${BP_UNIT} higher than evenings`,
          body: `Morning systolic averages ${round(am)} ${BP_UNIT}, evening ${round(pm)} ${BP_UNIT}. A higher morning pressure is worth mentioning; the timing of medication can sometimes help.`
        });
      } else if (pm - am >= 10) {
        insights.push({
          id: 'bp-evening',
          metric: 'bp',
          level: 'mild',
          title: `Evenings run ${round(pm - am)} ${BP_UNIT} higher than mornings`,
          body: `Evening systolic averages ${round(pm)} ${BP_UNIT}, morning ${round(am)} ${BP_UNIT}. Activity, meals, salt and stress during the day can raise evening readings.`
        });
      }
    }

    const left = bpEntries.filter((e) => e.arm === 'left');
    const right = bpEntries.filter((e) => e.arm === 'right');
    if (left.length >= 2 && right.length >= 2) {
      const diff = Math.abs(mean(left.map((e) => e.systolic ?? 0)) - mean(right.map((e) => e.systolic ?? 0)));
      if (diff > 10) {
        flags.bpArmDifference = true;
        insights.push({
          id: 'bp-arms',
          metric: 'bp',
          level: 'watch',
          title: `Your arms differ by ${round(diff)} ${BP_UNIT}`,
          body: 'A systolic difference of more than 10 mmHg between arms is worth telling your doctor about. Measure on the arm with the higher reading.'
        });
      }
    }

    if (sys.length >= 6 && s.sd >= 15) {
      insights.push({
        id: 'bp-variable',
        metric: 'bp',
        level: 'mild',
        title: 'Readings vary a lot',
        body: `Your systolic readings swing by about ${round(s.sd)} ${BP_UNIT} either side of the average. Measuring the same way each time (same arm, after 5 minutes rest, no coffee or exercise in the previous 30 minutes) makes readings easier to compare.`
      });
    }

    const pulsePressure = s.mean - d.mean;
    if (pulsePressure >= 60) {
      insights.push({
        id: 'bp-pulse-pressure',
        metric: 'bp',
        level: 'mild',
        title: `Wide gap between the two numbers (${round(pulsePressure)} ${BP_UNIT})`,
        body: 'The difference between systolic and diastolic pressure (the pulse pressure) averages 60 mmHg or more. This is common with age and stiffer arteries and is worth mentioning.'
      });
    }
  }

  /* ---------------- Heart rate ---------------- */
  const hrResting = hr.filter((p) => p.level !== 'neutral');
  if (hr.length) {
    present.push('hr');
    const restMean = mean(hrResting.map((p) => p.v));
    if (hrResting.length) {
      const g = gradeHR(restMean, 'resting');
      insights.push({
        id: 'hr-average',
        metric: 'hr',
        level: g.level,
        title: `Resting heart rate averages ${round(restMean)} bpm: ${g.label.toLowerCase()}`,
        body: `From ${plural(hrResting.length, 'resting reading')} in ${period}, including the pulse from blood pressure readings. ${g.detail}`
      });
    }
    flags.hrHigh = hrResting.filter((p) => p.v > 100).length;
    flags.hrLow = hrResting.filter((p) => p.v < 50).length;
    if (flags.hrHigh >= 2) {
      insights.push({
        id: 'hr-high',
        metric: 'hr',
        level: 'watch',
        title: `${plural(flags.hrHigh, 'resting reading')} over 100 bpm`,
        body: 'A fast heart rate at rest has many causes, from caffeine, fever and dehydration to thyroid or heart rhythm problems. Note how you felt at the time.'
      });
    }
    if (flags.hrLow >= 2) {
      insights.push({
        id: 'hr-low',
        metric: 'hr',
        level: 'low',
        title: `${plural(flags.hrLow, 'resting reading')} under 50 bpm`,
        body: 'A slow heart rate is often normal for fit people. It needs checking if you feel dizzy, tired, short of breath or faint, or take medicines that slow the heart.'
      });
    }
    flags.hrIrregular = win.filter((e) => e.tags.includes(IRREGULAR_TAG)).length;
    if (flags.hrIrregular) {
      insights.push({
        id: 'hr-irregular',
        metric: 'hr',
        level: 'watch',
        title: `Irregular heartbeat noted ${plural(flags.hrIrregular, 'time')}`,
        body: 'Many monitors show a symbol when the rhythm is uneven. Repeated irregular readings can be a sign of atrial fibrillation and are worth an ECG.'
      });
    }
    const t = summarize(hrResting).trend30;
    if (t !== null && Math.abs(t) >= 5) {
      insights.push({
        id: 'hr-trend',
        metric: 'hr',
        level: t > 0 ? 'mild' : 'ok',
        title: t > 0 ? `Resting heart rate is rising about ${round(t)} bpm a month` : `Resting heart rate is falling about ${round(-t)} bpm a month`,
        body: t > 0
          ? 'A rising resting rate can follow illness, poor sleep, stress, less activity or a change in medication.'
          : 'A falling resting rate often follows better fitness. If you feel tired or dizzy, mention it.'
      });
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
      insights.push({
        id: 'glucose-fasting',
        metric: 'glucose',
        level: g.level,
        title: `${profile.hasDiabetes ? 'Fasting and before-meal' : 'Fasting'} glucose averages ${fmt(m)}: ${g.label.toLowerCase()}`,
        body: `From ${plural(fasting.length, 'reading')} in ${period}. ${g.detail}`
      });
    }
    if (after.length) {
      const m = mean(after.map((e) => e.value ?? 0));
      const g = gradeGlucose(m, 'after-meal', profile);
      flags.glucoseAfterLevel = g.level;
      insights.push({
        id: 'glucose-after',
        metric: 'glucose',
        level: g.level,
        title: `After-meal glucose averages ${fmt(m)}: ${g.label.toLowerCase()}`,
        body: `From ${plural(after.length, 'reading')} taken 1 to 2 hours after eating. ${g.detail}`
      });
    }
    if (!fasting.length && !after.length) {
      const m = summaries.glucose.mean;
      insights.push({
        id: 'glucose-random',
        metric: 'glucose',
        level: gradeGlucose(m, 'random', profile).level,
        title: `Glucose averages ${fmt(m)}`,
        body: 'Mark readings as fasting, before a meal or after a meal. Fasting readings, taken after at least 8 hours without food, are the easiest to compare with reference ranges.'
      });
    }

    flags.glucoseLows = gluEntries.filter((e) => (e.value ?? 0) < 70).length;
    flags.glucoseVeryLows = gluEntries.filter((e) => (e.value ?? 0) < 54).length;
    if (flags.glucoseLows) {
      insights.push({
        id: 'glucose-lows',
        metric: 'glucose',
        level: flags.glucoseVeryLows ? 'urgent' : 'low',
        title: `${plural(flags.glucoseLows, 'low reading')} below ${fmt(70)}`,
        body: `${flags.glucoseVeryLows ? `${plural(flags.glucoseVeryLows, 'reading')} below ${fmt(54)}, which counts as serious low glucose. ` : ''}Treat lows with 15 g of fast-acting sugar, check again after 15 minutes, and tell your doctor how often they happen.`
      });
    }
    flags.glucoseVeryHigh = gluEntries.filter((e) => (e.value ?? 0) >= 300).length;
    if (flags.glucoseVeryHigh) {
      insights.push({
        id: 'glucose-very-high',
        metric: 'glucose',
        level: 'urgent',
        title: `${plural(flags.glucoseVeryHigh, 'reading')} at ${fmt(300)} or more`,
        body: 'Very high glucose needs a doctor soon. Seek urgent care if it comes with vomiting, stomach pain, fast breathing, drowsiness or confusion.'
      });
    }

    if (profile.hasDiabetes && glu.length >= 5) {
      const share = summaries.glucose.inRange;
      insights.push({
        id: 'glucose-in-target',
        metric: 'glucose',
        level: share >= 0.7 ? 'ok' : share >= 0.5 ? 'mild' : 'watch',
        title: `${Math.round(share * 100)}% of readings in target`,
        body: 'This counts the readings you logged, which may not reflect the whole day. Continuous monitors aim for more than 70% of the day between 70 and 180 mg/dL.'
      });
    }

    if (glu.length >= 10) {
      const cv = stdev(glu.map((p) => p.v)) / summaries.glucose.mean;
      if (cv > 0.36) {
        flags.glucoseSwings = true;
        insights.push({
          id: 'glucose-swings',
          metric: 'glucose',
          level: 'watch',
          title: 'Glucose swings widely',
          body: `Your readings vary by ${Math.round(cv * 100)}% around the average. More than 36% is considered high variability and raises the chance of lows.`
        });
      }
    }

    const glu14 = glu.filter((p) => p.t >= now - 90 * DAY);
    if (glu14.length >= 14 && glu14[glu14.length - 1].t - glu14[0].t >= 14 * DAY) {
      const avg = mean(glu14.map((p) => p.v));
      const a1c = (avg + 46.7) / 28.7;
      insights.push({
        id: 'glucose-a1c',
        metric: 'glucose',
        level: 'neutral',
        title: `Your average suggests an HbA1c near ${a1c.toFixed(1)}%`,
        body: `A rough estimate from the average of ${plural(glu14.length, 'reading')} (${fmt(avg)}), using the ADAG formula. Spot readings miss much of the day, so a lab HbA1c test is the reliable number.`
      });
    }
  }

  /* ---------------- Uric acid ---------------- */
  if (uric.length) {
    present.push('uric');
    const latest = uric[uric.length - 1];
    const g = gradeUric(latest.v, profile);
    flags.uricLevel = g.level;
    const fmt = (v: number) => `${formatValue('uric', v, units)} ${unitFor('uric', units)}`;
    insights.push({
      id: 'uric-latest',
      metric: 'uric',
      level: g.level,
      title: `Latest uric acid ${fmt(latest.v)}: ${g.label.toLowerCase()}`,
      body: `${uric.length > 1 ? `Average of ${plural(uric.length, 'reading')}: ${fmt(summaries.uric.mean)}. ` : ''}${g.detail}`
    });
    const t = summaries.uric.trend30;
    if (t !== null && Math.abs(t) >= 0.3) {
      insights.push({
        id: 'uric-trend',
        metric: 'uric',
        level: t > 0 ? 'mild' : 'ok',
        title: t > 0 ? `Uric acid is rising about ${fmt(t)} a month` : `Uric acid is falling about ${fmt(-t)} a month`,
        body: t > 0
          ? 'Purine-rich food (organ meats, some seafood), alcohol, sugary drinks, dehydration and some medicines can raise uric acid.'
          : 'A falling level is a good sign if you are working to lower it.'
      });
    }
    if (uric.length && LEVEL_RANK[g.level] >= LEVEL_RANK.watch) {
      insights.push({
        id: 'uric-tips',
        metric: 'uric',
        level: 'neutral',
        title: 'Ways to bring uric acid down',
        body: 'Drink plenty of water, limit alcohol (especially beer) and sugary drinks, eat less red and organ meat and shellfish, and aim for a healthy weight. Ask before stopping any medicine that may raise uric acid.'
      });
    }
  }

  if (!present.length) {
    insights.push({
      id: 'empty',
      metric: 'general',
      level: 'neutral',
      title: 'No readings in this period',
      body: 'Log a reading to see your averages, trends and what they mean.'
    });
  }

  /* ---------------- Questions ---------------- */
  const ask = (metric: Question['metric'], text: string, fromData = true) => q.push({ metric, text, fromData });

  if (present.includes('bp')) {
    const above = LEVEL_RANK[flags.bpAvgLevel] >= LEVEL_RANK.watch;
    if (above && !profile.hasHypertension) {
      ask('bp', `My home average is ${round(summaries.systolic.mean)}/${round(summaries.diastolic.mean)} mmHg. Does this mean I have high blood pressure, or should I do 24-hour monitoring to confirm it?`);
      ask('bp', 'What blood pressure target is right for me, and which lifestyle changes would make the biggest difference?');
    }
    if (above && profile.hasHypertension) {
      ask('bp', 'My readings are still above target on my current treatment. Should the dose, the medicine or the time I take it change?');
    }
    if (flags.bpUrgent) ask('bp', 'I had readings above 180/120. What should I do if it happens again, and when should I go to the emergency department?');
    if (flags.bpMorningSurge) ask('bp', 'My morning readings are higher than my evening ones. Would taking my medicine at a different time help?');
    if (flags.bpLow) ask('bp', 'I sometimes get low readings. Could any of my medicines be causing this, and what should I do if I feel dizzy?');
    if (flags.bpArmDifference) ask('bp', 'My two arms read more than 10 mmHg apart. Does that need further checks?');
    if (flags.bpRising) ask('bp', 'My blood pressure has been rising. What could be causing it?');
    ask('bp', 'Can we check my home monitor against your clinic reading to make sure it is accurate?', false);
  }
  if (present.includes('hr')) {
    if (flags.hrHigh >= 2) ask('hr', 'My resting heart rate is often over 100. Could thyroid problems, anaemia, caffeine or a rhythm problem be the cause? Do I need an ECG?');
    if (flags.hrLow >= 2) ask('hr', 'My heart rate is often below 50. Is that normal for me, or could one of my medicines be slowing it?');
    if (flags.hrIrregular) ask('hr', 'My monitor showed an irregular heartbeat. Should I be checked for atrial fibrillation?');
    ask('hr', 'What resting heart rate should I aim for, and which symptoms with a fast or slow pulse mean I should call you?', false);
  }
  if (present.includes('glucose')) {
    if (!profile.hasDiabetes && (flags.glucoseFastingLevel === 'watch' || flags.glucoseAfterLevel === 'watch')) {
      ask('glucose', 'Some of my glucose readings are in the prediabetes range. Should I have an HbA1c or a glucose tolerance test?');
      ask('glucose', 'What can I do to lower my risk of type 2 diabetes?');
    }
    if (!profile.hasDiabetes && (flags.glucoseFastingLevel === 'high' || flags.glucoseAfterLevel === 'high' || flags.glucoseVeryHigh)) {
      ask('glucose', 'My glucose readings are in the diabetes range. Which tests confirm it, and what happens next?');
    }
    if (profile.hasDiabetes && (LEVEL_RANK[flags.glucoseFastingLevel] >= LEVEL_RANK.watch || LEVEL_RANK[flags.glucoseAfterLevel] >= LEVEL_RANK.watch)) {
      ask('glucose', 'My readings are often above target. Are my targets still right for me, and should my treatment change?');
      ask('glucose', 'When should I check for ketones, and what should I do if they are high?');
    }
    if (flags.glucoseLows) {
      ask('glucose', `I had ${plural(flags.glucoseLows, 'low reading')}. How should I change food, activity or medication to prevent them?`);
      if (profile.hasDiabetes) ask('glucose', 'Should I carry glucagon, and should the people around me know how to use it?');
    }
    if (flags.glucoseSwings) ask('glucose', 'My readings swing widely. Would a continuous glucose monitor help?');
    ask('glucose', 'How often, and at what times, should I check my glucose?', false);
  }
  if (present.includes('uric')) {
    if (LEVEL_RANK[flags.uricLevel] >= LEVEL_RANK.watch) {
      ask('uric', profile.hasGout
        ? 'My uric acid is above target. Should my urate-lowering medicine be increased to get below 6 mg/dL?'
        : 'My uric acid is above the usual range. Do I need treatment, or are diet and lifestyle changes enough for now?');
      ask('uric', 'Could any of my medicines, such as water tablets (diuretics) or low-dose aspirin, be raising my uric acid?');
      ask('uric', 'Should my kidney function be checked, and am I at risk of kidney stones?');
    }
    if (profile.hasGout) ask('uric', 'How should I manage a gout flare while I am on treatment?', false);
    ask('uric', 'How often should my uric acid be re-tested?', false);
  }
  ask('general', 'Do any of my medicines or supplements affect these numbers?', false);
  ask('general', 'Which of these readings should I keep tracking, and how often?', false);

  return {
    from: Number.isFinite(from) ? from : (win.length ? Math.min(...win.map((e) => timeOf(e.takenAt))) : now),
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
  const labs: LabTest[] = [];
  const add = (metric: Metric, name: string, why: string, suggested: boolean) => labs.push({ metric, name, why, suggested });
  const bpUp = LEVEL_RANK[f.bpAvgLevel] >= LEVEL_RANK.watch || f.bpUrgent > 0;
  const gluUp = LEVEL_RANK[f.glucoseFastingLevel] >= LEVEL_RANK.watch || LEVEL_RANK[f.glucoseAfterLevel] >= LEVEL_RANK.watch || f.glucoseVeryHigh > 0;
  const uricUp = LEVEL_RANK[f.uricLevel] >= LEVEL_RANK.watch;
  const hrOff = f.hrHigh >= 2 || f.hrLow >= 2 || f.hrIrregular > 0;

  if (present.includes('bp')) {
    add('bp', '24-hour ambulatory blood pressure monitoring', 'Confirms whether pressure is high across a whole day and night, and rules out "white coat" readings.', bpUp && !profile.hasHypertension);
    add('bp', 'Kidney function and electrolytes (creatinine, eGFR, sodium, potassium)', 'High blood pressure can affect the kidneys, and some blood pressure medicines change potassium.', bpUp);
    add('bp', 'Urine albumin-to-creatinine ratio (UACR) and urinalysis', 'Finds small amounts of protein in the urine, an early sign of kidney strain.', bpUp);
    add('bp', 'Lipid panel (cholesterol)', 'Blood pressure and cholesterol together set your heart and stroke risk.', bpUp);
    add('bp', 'Fasting glucose or HbA1c', 'Diabetes and high blood pressure often occur together.', bpUp);
    add('bp', 'Thyroid function (TSH)', 'An over- or under-active thyroid can raise blood pressure.', bpUp);
    add('bp', '12-lead ECG', 'Shows whether high blood pressure has put strain on the heart.', bpUp);
    add('bp', 'Aldosterone-to-renin ratio', 'Screens for primary aldosteronism, a hormone cause of high blood pressure that is easy to miss, especially if pressure stays high on treatment or potassium is low.', bpUp && profile.hasHypertension);
  }
  if (present.includes('hr')) {
    add('hr', '12-lead ECG', 'Records the heart rhythm and shows conduction problems.', hrOff);
    add('hr', 'Holter or event monitor (24 hours to 2 weeks)', 'Catches rhythm changes that come and go.', f.hrIrregular > 0 || f.hrHigh >= 2);
    add('hr', 'Thyroid function (TSH, free T4)', 'Thyroid problems commonly speed up or slow down the heart.', hrOff);
    add('hr', 'Full blood count', 'Anaemia can make the heart beat faster.', f.hrHigh >= 2);
    add('hr', 'Electrolytes (potassium, magnesium)', 'Low or high levels can disturb the heart rhythm.', hrOff);
  }
  if (present.includes('glucose')) {
    add('glucose', 'HbA1c', 'Shows your average glucose over the past 2 to 3 months; 5.7-6.4% is the prediabetes range and 6.5% or more the diabetes range.', gluUp || profile.hasDiabetes);
    add('glucose', 'Fasting plasma glucose (lab)', 'A lab measurement is more accurate than a home meter.', gluUp && !profile.hasDiabetes);
    add('glucose', 'Oral glucose tolerance test (OGTT)', 'Shows how your body handles a measured sugar drink over 2 hours.', gluUp && !profile.hasDiabetes);
    add('glucose', 'Lipid panel and kidney tests (eGFR, UACR)', 'Checks heart and kidney risk, which rises with high glucose; recommended at least yearly with diabetes.', profile.hasDiabetes || gluUp);
    add('glucose', 'Liver enzymes (ALT)', 'Raised glucose often goes with fatty liver.', gluUp);
    add('glucose', 'Dilated eye exam and foot check', 'Yearly checks for diabetes-related eye and nerve changes.', profile.hasDiabetes);
    add('glucose', 'C-peptide and islet autoantibodies', 'Help tell type 1 from type 2 diabetes when the type is unclear.', false);
  }
  if (present.includes('uric')) {
    add('uric', 'Repeat serum uric acid', 'One reading can mislead. During a gout flare uric acid can read falsely normal, so repeat it about 2 weeks after a flare settles.', uricUp);
    add('uric', 'Kidney function (creatinine, eGFR) and urinalysis', 'The kidneys clear uric acid, and high levels can lead to kidney stones.', uricUp);
    add('uric', 'Lipid panel, glucose and HbA1c', 'High uric acid often comes with raised cholesterol, glucose and blood pressure.', uricUp);
    add('uric', 'Liver function tests and full blood count', 'Checked before and during urate-lowering treatment.', uricUp && profile.hasGout);
    add('uric', 'Joint fluid test for crystals', 'Confirms gout if a joint is hot, red and swollen.', profile.hasGout);
    add('uric', 'HLA-B*5801 test', 'Recommended before starting allopurinol for people of Southeast Asian (for example Han Chinese, Korean or Thai) or African descent, who have a higher risk of a severe skin reaction.', uricUp);
    add('uric', '24-hour urine uric acid', 'Useful if you have had kidney stones.', false);
  }
  return labs.sort((a, b) => Number(b.suggested) - Number(a.suggested));
}

function specialistsFor(present: Metric[], f: Flags, profile: Profile): Specialist[] {
  const bpUp = LEVEL_RANK[f.bpAvgLevel] >= LEVEL_RANK.watch || f.bpUrgent > 0;
  const gluUp = LEVEL_RANK[f.glucoseFastingLevel] >= LEVEL_RANK.watch || LEVEL_RANK[f.glucoseAfterLevel] >= LEVEL_RANK.watch || f.glucoseVeryHigh > 0;
  const uricUp = LEVEL_RANK[f.uricLevel] >= LEVEL_RANK.watch;
  const hrOff = f.hrHigh >= 2 || f.hrLow >= 2 || f.hrIrregular > 0;
  const list: Specialist[] = [
    {
      who: 'General practitioner or internist',
      when: 'Your first stop for any of these readings. They can order the tests above, start treatment and refer you on.',
      metrics: present.length ? present : ['bp', 'hr', 'glucose', 'uric'],
      suggested: bpUp || gluUp || uricUp || hrOff || f.glucoseLows > 0 || f.bpLow > 0
    },
    {
      who: 'Cardiologist',
      when: 'Blood pressure that stays high on three or more medicines, an abnormal ECG, palpitations, an irregular or persistently fast or slow heartbeat, or chest pain.',
      metrics: ['bp', 'hr'],
      suggested: f.bpUrgent > 0 || hrOff || (bpUp && profile.hasHypertension)
    },
    {
      who: 'Cardiac electrophysiologist',
      when: 'A confirmed heart rhythm problem such as atrial fibrillation that needs specialist treatment.',
      metrics: ['hr'],
      suggested: false
    },
    {
      who: 'Endocrinologist',
      when: 'Diabetes that is not reaching target, frequent lows, suspected type 1 diabetes, thyroid problems, or a suspected hormone cause of high blood pressure.',
      metrics: ['glucose', 'bp', 'hr'],
      suggested: (profile.hasDiabetes && gluUp) || f.glucoseVeryLows > 0 || f.glucoseVeryHigh > 0
    },
    {
      who: 'Nephrologist (kidney specialist)',
      when: 'Falling kidney function, protein in the urine, blood pressure that is hard to control, or kidney stones with high uric acid.',
      metrics: ['bp', 'uric', 'glucose'],
      suggested: false
    },
    {
      who: 'Rheumatologist',
      when: 'Gout attacks, lumps of crystals under the skin (tophi), or uric acid that stays above target on treatment.',
      metrics: ['uric'],
      suggested: uricUp && profile.hasGout
    },
    {
      who: 'Dietitian or diabetes educator',
      when: 'Help with meal plans to lower salt, glucose or uric acid, and with using a meter or insulin.',
      metrics: ['glucose', 'uric', 'bp'],
      suggested: gluUp || uricUp
    }
  ];
  return list
    .filter((s) => s.metrics.some((m) => present.includes(m)) || !present.length)
    .sort((a, b) => Number(b.suggested) - Number(a.suggested));
}

export const EMERGENCY_SIGNS: string[] = [
  'Blood pressure above 180/120 mmHg with chest pain, shortness of breath, back pain, numbness or weakness, trouble speaking, or a change in vision.',
  'Chest pain or pressure, fainting, or a very fast or very slow heartbeat with dizziness or breathlessness.',
  'Glucose below 54 mg/dL (3.0 mmol/L) that does not rise after treatment, or confusion, seizures or unconsciousness.',
  'Glucose above 300 mg/dL (16.7 mmol/L) with vomiting, stomach pain, fast breathing, fruity-smelling breath or drowsiness.',
  'A hot, red, very painful joint together with fever, which can be an infection rather than gout.'
];

export type { Point };

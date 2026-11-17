import { describe, expect, it } from 'vitest';
import { gradeBP, gradeGlucose, gradeHR, gradeUric } from '../src/lib/ranges';
import { DEFAULT_PROFILE, type Profile } from '../src/lib/types';
import { glucoseFromCanonical, glucoseToCanonical, uricFromCanonical, uricToCanonical } from '../src/lib/units';

const p = (over: Partial<Profile> = {}): Profile => ({ ...DEFAULT_PROFILE, ...over, targets: { ...DEFAULT_PROFILE.targets, ...(over.targets ?? {}) } });

describe('blood pressure categories (ACC/AHA)', () => {
  it.each([
    [118, 76, 'ok', 'Normal'],
    [119, 79, 'ok', 'Normal'],
    [120, 79, 'mild', 'Elevated'],
    [129, 79, 'mild', 'Elevated'],
    [130, 79, 'watch', 'Stage 1 range'],
    [118, 80, 'watch', 'Stage 1 range'],
    [139, 89, 'watch', 'Stage 1 range'],
    [140, 70, 'high', 'Stage 2 range'],
    [125, 90, 'high', 'Stage 2 range'],
    [180, 120, 'high', 'Stage 2 range'],
    [181, 100, 'urgent', 'Severe'],
    [150, 121, 'urgent', 'Severe'],
    [88, 58, 'low', 'Low']
  ])('%i/%i is %s', (s, d, level, label) => {
    const g = gradeBP(s, d);
    expect(g.level).toBe(level);
    expect(g.label).toBe(label);
  });

  it('does not call a reading low when the other number is raised', () => {
    expect(gradeBP(85, 92).level).toBe('high');
  });

  it('flags readings above a stricter personal target', () => {
    const g = gradeBP(115, 70, p({ targets: { bpSystolicMax: 110 } }));
    expect(g.label).toBe('Above your target');
  });
});

describe('heart rate', () => {
  it.each([
    [35, 'high'],
    [52, 'low'],
    [60, 'ok'],
    [100, 'ok'],
    [101, 'watch'],
    [130, 'high']
  ])('%i bpm at rest is %s', (bpm, level) => {
    expect(gradeHR(bpm, 'resting').level).toBe(level);
  });

  it('does not grade a heart rate taken during exercise', () => {
    expect(gradeHR(150, 'after-exercise').level).toBe('neutral');
  });
});

describe('glucose (ADA)', () => {
  it.each([
    [50, 'urgent'],
    [65, 'low'],
    [92, 'ok'],
    [100, 'watch'],
    [125, 'watch'],
    [126, 'high']
  ])('fasting %i mg/dL without diabetes is %s', (v, level) => {
    expect(gradeGlucose(v, 'fasting').level).toBe(level);
  });

  it.each([
    [139, 'ok'],
    [140, 'watch'],
    [199, 'watch'],
    [200, 'high']
  ])('after a meal %i mg/dL without diabetes is %s', (v, level) => {
    expect(gradeGlucose(v, 'after-meal').level).toBe(level);
  });

  it('uses diabetes targets when the profile says so', () => {
    const d = p({ hasDiabetes: true });
    expect(gradeGlucose(75, 'fasting', d).level).toBe('mild');
    expect(gradeGlucose(130, 'fasting', d).level).toBe('ok');
    expect(gradeGlucose(150, 'fasting', d).level).toBe('watch');
    expect(gradeGlucose(175, 'after-meal', d).level).toBe('ok');
    expect(gradeGlucose(190, 'after-meal', d).level).toBe('watch');
    expect(gradeGlucose(320, 'after-meal', d).level).toBe('urgent');
  });

  it('converts between mg/dL and mmol/L', () => {
    expect(glucoseFromCanonical(126, 'mmol/L')).toBeCloseTo(7.0, 1);
    expect(glucoseToCanonical(5.5, 'mmol/L')).toBeCloseTo(99.1, 0);
  });
});

describe('uric acid', () => {
  it('uses sex-specific upper limits', () => {
    expect(gradeUric(6.5, p({ sex: 'male' })).level).toBe('ok');
    expect(gradeUric(6.5, p({ sex: 'female' })).level).toBe('watch');
  });

  it('uses the gout target of 6 mg/dL', () => {
    expect(gradeUric(6.2, p({ sex: 'male', hasGout: true })).label).toBe('Above target');
    expect(gradeUric(5.8, p({ sex: 'male', hasGout: true })).level).toBe('ok');
  });

  it('marks 9 mg/dL and above as well above range', () => {
    expect(gradeUric(9.4).level).toBe('high');
  });

  it('converts between mg/dL and µmol/L', () => {
    expect(uricFromCanonical(6, 'µmol/L')).toBeCloseTo(356.9, 0);
    expect(uricToCanonical(420, 'µmol/L')).toBeCloseTo(7.06, 1);
  });
});

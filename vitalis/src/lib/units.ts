import type { GlucoseUnit, Metric, Settings, UricUnit } from './types';

/** mg/dL per mmol/L for glucose (molar mass 180.16 g/mol). */
export const GLUCOSE_FACTOR = 18.016;
/** µmol/L per mg/dL for uric acid (molar mass 168.11 g/mol). */
export const URIC_FACTOR = 59.48;

export function glucoseToCanonical(value: number, unit: GlucoseUnit): number {
  return unit === 'mmol/L' ? value * GLUCOSE_FACTOR : value;
}

export function glucoseFromCanonical(mgdl: number, unit: GlucoseUnit): number {
  return unit === 'mmol/L' ? mgdl / GLUCOSE_FACTOR : mgdl;
}

export function uricToCanonical(value: number, unit: UricUnit): number {
  return unit === 'µmol/L' ? value / URIC_FACTOR : value;
}

export function uricFromCanonical(mgdl: number, unit: UricUnit): number {
  return unit === 'µmol/L' ? mgdl * URIC_FACTOR : mgdl;
}

/** Converts a canonical value to the unit the person prefers for that metric. */
export function toDisplay(metric: Metric, canonical: number, settings: Pick<Settings, 'glucoseUnit' | 'uricUnit'>): number {
  if (metric === 'glucose') return glucoseFromCanonical(canonical, settings.glucoseUnit);
  if (metric === 'uric') return uricFromCanonical(canonical, settings.uricUnit);
  return canonical;
}

export function unitFor(metric: Metric, settings: Pick<Settings, 'glucoseUnit' | 'uricUnit'>): string {
  switch (metric) {
    case 'bp':
      return 'mmHg';
    case 'hr':
      return 'bpm';
    case 'glucose':
      return settings.glucoseUnit;
    case 'uric':
      return settings.uricUnit;
  }
}

/** Number of decimals that suit a unit: 1 for mmol/L and uric mg/dL, none otherwise. */
export function decimalsFor(metric: Metric, settings: Pick<Settings, 'glucoseUnit' | 'uricUnit'>): number {
  if (metric === 'glucose') return settings.glucoseUnit === 'mmol/L' ? 1 : 0;
  if (metric === 'uric') return settings.uricUnit === 'mg/dL' ? 1 : 0;
  return 0;
}

export function formatValue(metric: Metric, canonical: number, settings: Pick<Settings, 'glucoseUnit' | 'uricUnit'>): string {
  const v = toDisplay(metric, canonical, settings);
  return v.toFixed(decimalsFor(metric, settings));
}

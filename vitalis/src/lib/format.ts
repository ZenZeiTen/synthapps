import { GLUCOSE_CONTEXT_LABEL } from './ranges';
import { DAY, timeOf } from './stats';
import type { Entry, HrContext, Metric, Settings } from './types';
import { formatValue, unitFor } from './units';

export const METRIC_NAME: Record<Metric, string> = {
  bp: 'Blood pressure',
  hr: 'Heart rate',
  glucose: 'Blood glucose',
  uric: 'Uric acid'
};

export const METRIC_SHORT: Record<Metric, string> = {
  bp: 'Pressure',
  hr: 'Heart rate',
  glucose: 'Glucose',
  uric: 'Uric acid'
};

export const HR_CONTEXT_LABEL: Record<HrContext, string> = {
  resting: 'Resting',
  'after-waking': 'After waking',
  active: 'During activity',
  'after-exercise': 'After exercise'
};

const LOCALE = 'en-GB';

export function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(t: number, withYear = false): string {
  return new Date(t).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
}

export function fmtDayHeading(t: number, now = Date.now()): string {
  const d = new Date(t);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - start.getTime()) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
}

/** "Today 07:15", "Yesterday 21:02", "12 Nov 08:00". */
export function fmtWhen(takenAt: string, now = Date.now()): string {
  const t = timeOf(takenAt);
  const day = fmtDayHeading(t, now);
  const label = day === 'Today' || day === 'Yesterday' ? day : fmtDate(t, new Date(t).getFullYear() !== new Date(now).getFullYear());
  return `${label}, ${fmtTime(t)}`;
}

export function entryValue(e: Entry, settings: Settings): string {
  if (e.metric === 'bp') return `${e.systolic}/${e.diastolic}`;
  return formatValue(e.metric, e.value ?? 0, settings);
}

export function entryUnit(e: Entry, settings: Settings): string {
  return unitFor(e.metric, settings);
}

export function entryContext(e: Entry): string {
  const parts: string[] = [];
  if (e.metric === 'bp') {
    if (e.pulse) parts.push(`pulse ${e.pulse}`);
    if (e.position) parts.push(e.position);
    if (e.arm) parts.push(`${e.arm} arm`);
  }
  if (e.metric === 'glucose') parts.push(GLUCOSE_CONTEXT_LABEL[e.glucoseContext ?? 'random']);
  if (e.metric === 'hr') parts.push(HR_CONTEXT_LABEL[e.hrContext ?? 'resting']);
  return parts.join(', ');
}

export function signed(n: number, digits = 0): string {
  const v = n.toFixed(digits);
  if (Number(v) === 0) return (0).toFixed(digits);
  return n > 0 ? `+${v}` : v;
}

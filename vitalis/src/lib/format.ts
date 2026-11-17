import { locale, signedNum, t } from '../i18n';
import { DAY, timeOf } from './stats';
import type { Entry, GlucoseContext, HrContext, Level, Metric, Settings } from './types';
import { formatValue, unitFor } from './units';

export const metricName = (m: Metric): string => t().common.metric[m];
export const levelLabel = (l: Level): string => t().common.level[l];
export const glucoseContextLabel = (c: GlucoseContext): string => t().common.glucoseContext[c];
export const hrContextLabel = (c: HrContext): string => t().common.hrContext[c];
/** Tags are stored by their English key; unknown tags (from older data) show as stored. */
export const tagLabel = (tag: string): string => t().common.tags[tag] ?? tag;

export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(ms: number, withYear = false): string {
  return new Date(ms).toLocaleDateString(locale(), { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
}

/** 0 for today, 1 for yesterday, and so on, by calendar day. */
function daysAgo(ms: number, now: number): number {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const start = new Date(ms);
  start.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - start.getTime()) / DAY);
}

export function fmtDayHeading(ms: number, now = Date.now()): string {
  const diff = daysAgo(ms, now);
  if (diff === 0) return t().common.today;
  if (diff === 1) return t().common.yesterday;
  const d = new Date(ms);
  return d.toLocaleDateString(locale(), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {})
  });
}

/** "Today, 07:15", "Yesterday, 21:02", "12 Nov, 08:00". */
export function fmtWhen(takenAt: string, now = Date.now()): string {
  const ms = timeOf(takenAt);
  const diff = daysAgo(ms, now);
  const label = diff === 0 || diff === 1 ? fmtDayHeading(ms, now) : fmtDate(ms, new Date(ms).getFullYear() !== new Date(now).getFullYear());
  return `${label}, ${fmtTime(ms)}`;
}

export function entryValue(e: Entry, settings: Settings): string {
  if (e.metric === 'bp') return `${e.systolic}/${e.diastolic}`;
  return formatValue(e.metric, e.value ?? 0, settings);
}

export function entryUnit(e: Entry, settings: Settings): string {
  return unitFor(e.metric, settings);
}

export function entryContext(e: Entry): string {
  const c = t().common;
  const parts: string[] = [];
  if (e.metric === 'bp') {
    if (e.pulse) parts.push(c.pulseValue(String(e.pulse)));
    if (e.position) parts.push(c.positionLower[e.position]);
    if (e.arm) parts.push(c.armLower[e.arm]);
  }
  if (e.metric === 'glucose') parts.push(glucoseContextLabel(e.glucoseContext ?? 'random'));
  if (e.metric === 'hr') parts.push(hrContextLabel(e.hrContext ?? 'resting'));
  return parts.join(', ');
}

export function entryTags(e: Entry): string {
  return e.tags.map(tagLabel).join(', ');
}

export const signed = signedNum;

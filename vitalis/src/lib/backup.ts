import { t } from '../i18n';
import { entryContext, entryTags, metricName } from './format';
import type { Entry, Metric, Profile, Settings } from './types';
import { formatValue, unitFor } from './units';

export interface Backup {
  app: 'vitalis';
  version: 1;
  exportedAt: string;
  profile: Profile;
  settings: Settings;
  entries: Entry[];
}

export function makeBackup(entries: Entry[], profile: Profile, settings: Settings): string {
  const b: Backup = { app: 'vitalis', version: 1, exportedAt: new Date().toISOString(), profile, settings, entries };
  return JSON.stringify(b, null, 2);
}

const METRICS = new Set<Metric>(['bp', 'hr', 'glucose', 'uric']);
const finite = (v: unknown) => v === undefined || (typeof v === 'number' && Number.isFinite(v));

/** Checks one entry from a backup file and returns it cleaned, or null if it is unusable. */
export function cleanEntry(raw: unknown): Entry | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== 'string' || !METRICS.has(e.metric as Metric)) return null;
  if (typeof e.takenAt !== 'string' || Number.isNaN(new Date(e.takenAt).getTime())) return null;
  if (![e.systolic, e.diastolic, e.pulse, e.value].every(finite)) return null;
  if (e.metric === 'bp' && (typeof e.systolic !== 'number' || typeof e.diastolic !== 'number')) return null;
  if (e.metric !== 'bp' && typeof e.value !== 'number') return null;
  const now = new Date().toISOString();
  return {
    ...(e as unknown as Entry),
    takenAt: (e.takenAt as string).slice(0, 16),
    tags: Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === 'string') : [],
    notes: typeof e.notes === 'string' ? e.notes : '',
    createdAt: typeof e.createdAt === 'string' ? e.createdAt : now,
    updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : now
  };
}

export function parseBackup(text: string): { entries: Entry[]; profile?: Profile; settings?: Partial<Settings>; skipped: number } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(t().backup.notJson);
  }
  const b = data as Partial<Backup>;
  if (!b || b.app !== 'vitalis' || !Array.isArray(b.entries)) {
    throw new Error(t().backup.notBackup);
  }
  const entries: Entry[] = [];
  let skipped = 0;
  for (const raw of b.entries) {
    const e = cleanEntry(raw);
    if (e) entries.push(e);
    else skipped++;
  }
  return { entries, profile: b.profile, settings: b.settings, skipped };
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function makeCsv(entries: Entry[], settings: Settings): string {
  const rows: string[][] = [t().backup.csvHeader];
  for (const e of [...entries].sort((a, b) => a.takenAt.localeCompare(b.takenAt))) {
    const value = e.metric === 'bp' ? `${e.systolic}/${e.diastolic}` : formatValue(e.metric, e.value ?? 0, settings);
    // The pulse has its own column, so leave it out of the context text.
    const context = entryContext({ ...e, pulse: undefined });
    rows.push([
      e.takenAt.slice(0, 10),
      e.takenAt.slice(11, 16),
      metricName(e.metric),
      value,
      unitFor(e.metric, settings),
      e.metric === 'bp' && e.pulse ? String(e.pulse) : '',
      context,
      entryTags(e),
      e.notes
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

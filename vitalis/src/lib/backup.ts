import { GLUCOSE_CONTEXT_LABEL } from './ranges';
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
    throw new Error('This file is not a Vitalis backup: it is not valid JSON.');
  }
  const b = data as Partial<Backup>;
  if (!b || b.app !== 'vitalis' || !Array.isArray(b.entries)) {
    throw new Error('This file is not a Vitalis backup. Choose a file exported from Settings > Back up data.');
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
  const rows = [['Date', 'Time', 'Measurement', 'Value', 'Unit', 'Pulse (bpm)', 'Context', 'Tags', 'Notes']];
  const name: Record<Metric, string> = { bp: 'Blood pressure', hr: 'Heart rate', glucose: 'Blood glucose', uric: 'Uric acid' };
  for (const e of [...entries].sort((a, b) => a.takenAt.localeCompare(b.takenAt))) {
    const value = e.metric === 'bp' ? `${e.systolic}/${e.diastolic}` : formatValue(e.metric, e.value ?? 0, settings);
    const context =
      e.metric === 'glucose'
        ? GLUCOSE_CONTEXT_LABEL[e.glucoseContext ?? 'random']
        : e.metric === 'hr'
          ? (e.hrContext ?? 'resting')
          : e.metric === 'bp'
            ? [e.position, e.arm && `${e.arm} arm`].filter(Boolean).join(', ')
            : '';
    rows.push([
      e.takenAt.slice(0, 10),
      e.takenAt.slice(11, 16),
      name[e.metric],
      value,
      unitFor(e.metric, settings),
      e.metric === 'bp' && e.pulse ? String(e.pulse) : '',
      context,
      e.tags.join('; '),
      e.notes
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

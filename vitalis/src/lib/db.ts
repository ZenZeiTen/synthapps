import { openDB, type IDBPDatabase } from 'idb';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type Entry, type Profile, type Settings } from './types';

const DB_NAME = 'vitalis';
const VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, VERSION, {
      upgrade(d) {
        const entries = d.createObjectStore('entries', { keyPath: 'id' });
        entries.createIndex('takenAt', 'takenAt');
        d.createObjectStore('kv');
      }
    });
  }
  return dbPromise;
}

export async function allEntries(): Promise<Entry[]> {
  const list = (await (await db()).getAll('entries')) as Entry[];
  return list.sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

export async function putEntry(entry: Entry): Promise<void> {
  await (await db()).put('entries', entry);
}

export async function putEntries(entries: Entry[]): Promise<void> {
  const tx = (await db()).transaction('entries', 'readwrite');
  await Promise.all([...entries.map((e) => tx.store.put(e)), tx.done]);
}

export async function deleteEntry(id: string): Promise<void> {
  await (await db()).delete('entries', id);
}

export async function clearEntries(): Promise<void> {
  await (await db()).clear('entries');
}

export async function loadProfile(): Promise<Profile> {
  const p = (await (await db()).get('kv', 'profile')) as Partial<Profile> | undefined;
  return { ...DEFAULT_PROFILE, ...p, targets: { ...DEFAULT_PROFILE.targets, ...(p?.targets ?? {}) } };
}

export async function saveProfile(p: Profile): Promise<void> {
  await (await db()).put('kv', p, 'profile');
}

export async function loadSettings(): Promise<Settings> {
  const s = (await (await db()).get('kv', 'settings')) as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...s };
}

export async function saveSettings(s: Settings): Promise<void> {
  await (await db()).put('kv', s, 'settings');
}

/** Asks the browser to keep the data even when storage runs low. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* not supported */
  }
  return false;
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

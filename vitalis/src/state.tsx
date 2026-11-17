import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as store from './lib/db';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type Entry, type Metric, type Profile, type Settings } from './lib/types';

export type Route = 'today' | 'trends' | 'journal' | 'insights' | 'report' | 'settings';
export const ROUTES: Route[] = ['today', 'trends', 'journal', 'insights', 'report', 'settings'];

interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

interface LogRequest {
  metric?: Metric;
  entry?: Entry;
}

interface AppState {
  ready: boolean;
  entries: Entry[];
  profile: Profile;
  settings: Settings;
  route: Route;
  trendMetric: Metric;
  logRequest: LogRequest | null;
  toast: Toast | null;
  go: (r: Route, metric?: Metric) => void;
  openLog: (req?: LogRequest) => void;
  closeLog: () => void;
  saveEntry: (e: Entry) => Promise<void>;
  removeEntry: (id: string) => Promise<void>;
  addEntries: (es: Entry[]) => Promise<void>;
  clearAll: () => Promise<void>;
  updateProfile: (p: Profile) => Promise<void>;
  updateSettings: (s: Partial<Settings>) => Promise<void>;
  notify: (text: string, action?: Toast['action']) => void;
}

const Ctx = createContext<AppState | null>(null);

function routeFromHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, '').split('?')[0] as Route;
  return ROUTES.includes(h) ? h : 'today';
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [trendMetric, setTrendMetric] = useState<Metric>('bp');
  const [logRequest, setLogRequest] = useState<LogRequest | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    Promise.all([store.allEntries(), store.loadProfile(), store.loadSettings()]).then(([e, p, s]) => {
      setEntries(e);
      setProfile(p);
      setSettings(s);
      setReady(true);
      if (new URLSearchParams(window.location.search).get('log') === '1') setLogRequest({});
    });
    const onHash = () => {
      setRoute(routeFromHash());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  const notify = useCallback((text: string, action?: Toast['action']) => {
    const id = Date.now();
    setToast({ id, text, action });
    window.setTimeout(() => setToast((t) => (t?.id === id ? null : t)), action ? 6000 : 3200);
  }, []);

  const go = useCallback((r: Route, metric?: Metric) => {
    if (metric) setTrendMetric(metric);
    if (window.location.hash !== `#/${r}`) window.location.hash = `/${r}`;
    setRoute(r);
    window.scrollTo({ top: 0 });
  }, []);

  const saveEntry = useCallback(async (e: Entry) => {
    await store.putEntry(e);
    setEntries((list) => [e, ...list.filter((x) => x.id !== e.id)].sort((a, b) => b.takenAt.localeCompare(a.takenAt)));
  }, []);

  const removeEntry = useCallback(
    async (id: string) => {
      const gone = entries.find((e) => e.id === id);
      await store.deleteEntry(id);
      setEntries((list) => list.filter((e) => e.id !== id));
      if (gone) notify('Reading deleted', { label: 'Undo', run: () => void saveEntry(gone) });
    },
    [entries, notify, saveEntry]
  );

  const addEntries = useCallback(async (es: Entry[]) => {
    await store.putEntries(es);
    setEntries(await store.allEntries());
  }, []);

  const clearAll = useCallback(async () => {
    await store.clearEntries();
    setEntries([]);
  }, []);

  const updateProfile = useCallback(async (p: Profile) => {
    await store.saveProfile(p);
    setProfile(p);
  }, []);

  const updateSettings = useCallback(
    async (s: Partial<Settings>) => {
      const next = { ...settings, ...s };
      await store.saveSettings(next);
      setSettings(next);
    },
    [settings]
  );

  const value = useMemo<AppState>(
    () => ({
      ready,
      entries,
      profile,
      settings,
      route,
      trendMetric,
      logRequest,
      toast,
      go,
      openLog: (req = {}) => setLogRequest(req),
      closeLog: () => setLogRequest(null),
      saveEntry,
      removeEntry,
      addEntries,
      clearAll,
      updateProfile,
      updateSettings,
      notify
    }),
    [ready, entries, profile, settings, route, trendMetric, logRequest, toast, go, saveEntry, removeEntry, addEntries, clearAll, updateProfile, updateSettings, notify]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside AppProvider');
  return v;
}

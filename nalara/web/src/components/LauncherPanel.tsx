import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api";
import { BRAND } from "../brand";
import type { InstalledApp } from "../types";
import { IconApps, IconRefresh } from "./Icons";
import { SidePanel } from "./SidePanel";

export interface NalaraApp {
  id: string;
  name: string;
  description: string;
  icon: ReactNode;
}

interface Props {
  /** Nalara's own apps (Ask, Files, Terminal...). */
  apps: NalaraApp[];
  onOpenApp: (id: string) => void;
  onClose: () => void;
  onToast: (message: string, tone?: "ok" | "error") => void;
}

/** The start menu: Nalara's own apps, and the programs installed on this computer. */
export function LauncherPanel({ apps, onOpenApp, onClose, onToast }: Props) {
  const [installed, setInstalled] = useState<InstalledApp[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  const load = useCallback((refresh = false) => {
    setError(null);
    (refresh ? api.refreshApps() : api.installedApps())
      .then(setInstalled)
      .catch((err: Error) => setError(err.message));
  }, []);
  useEffect(() => load(), [load]);

  const q = query.trim().toLowerCase();
  const own = useMemo(() => apps.filter((a) => !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)), [apps, q]);
  const shown = useMemo(() => (installed ?? []).filter((a) => !q || a.name.toLowerCase().includes(q) || a.comment?.toLowerCase().includes(q)), [installed, q]);

  const launch = async (app: InstalledApp) => {
    setStarting(app.id);
    try {
      await api.launchApp(app.id);
      onToast(`Starting ${app.name}`);
    } catch (err) {
      onToast(`${app.name}: ${(err as Error).message}`, "error");
    } finally {
      setStarting(null);
    }
  };

  return (
    <SidePanel title="Start" subtitle={`${BRAND}'s apps, and the programs on this computer`} onClose={onClose} wide>
      <label className="sr-only" htmlFor="launch-q">
        Search apps
      </label>
      <input id="launch-q" className="launch-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search apps…" autoComplete="off" spellCheck={false} />
      <h3 className="launch-h">{BRAND}</h3>
      <div className="launch-grid">
        {own.map((a) => (
          <button key={a.id} type="button" className="launch-tile" data-app={a.id} onClick={() => onOpenApp(a.id)}>
            <span className="launch-icon">{a.icon}</span>
            <span className="launch-name">{a.name}</span>
            <span className="launch-desc">{a.description}</span>
          </button>
        ))}
      </div>
      <div className="launch-h-row">
        <h3 className="launch-h">On this computer</h3>
        <button type="button" className="icon-btn" aria-label="Rescan installed apps" title="Rescan" onClick={() => load(true)}>
          <IconRefresh size={13} />
        </button>
      </div>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {installed === null && !error ? <p className="muted">Looking for installed apps…</p> : null}
      {installed && shown.length === 0 ? <p className="muted">{q ? "No installed app matches." : "No installed apps were found in this computer's app menus."}</p> : null}
      <ul className="launch-list">
        {shown.map((a) => (
          <li key={a.id}>
            <button type="button" className="launch-row" disabled={starting === a.id} onClick={() => void launch(a)} title={a.comment ?? a.name}>
              <IconApps size={14} />
              <span className="launch-row-name">{a.name}</span>
              {a.comment ? <span className="launch-row-desc">{a.comment}</span> : null}
              <span className="launch-open">{starting === a.id ? "Starting…" : "Open"}</span>
            </button>
          </li>
        ))}
      </ul>
    </SidePanel>
  );
}

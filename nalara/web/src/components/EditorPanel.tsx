import { useState, type FormEvent } from "react";
import { api } from "../api";
import { IconFile, IconFolder } from "./Icons";
import { SidePanel } from "./SidePanel";

/** New documents go here, in the Nalara folder. */
export const DOCUMENTS_DIR = "Documents";
const RECENT_KEY = "nalara.editor.recent";
const MAX_RECENT = 15;

export interface RecentFile {
  place: string;
  path: string;
  at: number;
}

export function recentFiles(): RecentFile[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? (raw as RecentFile[]).filter((r) => r && typeof r.path === "string" && typeof r.place === "string") : [];
  } catch {
    return [];
  }
}

/** Remembers a file opened in the viewer or editor (newest first). */
export function rememberFile(place: string, path: string) {
  try {
    const list = [{ place, path, at: Date.now() }, ...recentFiles().filter((r) => !(r.place === place && r.path === path))].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* storage blocked: no recent list */
  }
}

interface Props {
  onClose: () => void;
  /** Opens a file in the editor (edit: ready to type). */
  onOpen: (path: string, place: string, edit?: boolean) => void;
  onBrowse: () => void;
}

/** The text editor's start page: a new document, recent files, or a file from Files. */
export function EditorPanel({ onClose, onOpen, onBrowse }: Props) {
  const [name, setName] = useState("Untitled.txt");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const recent = recentFiles();

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    setBusy(true);
    setError(null);
    try {
      await api.ensureFolder("home", DOCUMENTS_DIR);
      const path = `${DOCUMENTS_DIR}/${clean}`;
      await api.saveText("home", path, "", "create");
      rememberFile("home", path);
      onOpen(path, "home", true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel title="Text editor" subtitle="Write and edit plain text, Markdown and code" onClose={onClose}>
      <form className="ed-new" onSubmit={(e) => void create(e)}>
        <label htmlFor="ed-name" className="small muted">
          New document in {DOCUMENTS_DIR}/
        </label>
        <div className="ed-new-row">
          <input id="ed-name" value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
          <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !name.trim()}>
            Create
          </button>
        </div>
      </form>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="button" className="btn btn-sm ed-browse" onClick={onBrowse}>
        <IconFolder size={13} /> Open a file from Files
      </button>
      <h3 className="launch-h">Recent</h3>
      {recent.length === 0 ? <p className="muted">Files you open appear here.</p> : null}
      <ul className="launch-list">
        {recent.map((r) => (
          <li key={`${r.place}:${r.path}`}>
            <button type="button" className="launch-row" onClick={() => onOpen(r.path, r.place)} title={r.path}>
              <IconFile size={14} />
              <span className="launch-row-name mono">{r.path.split("/").pop()}</span>
              <span className="launch-row-desc">{r.path}</span>
            </button>
          </li>
        ))}
      </ul>
    </SidePanel>
  );
}

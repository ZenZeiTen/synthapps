import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { BRAND } from "../brand";
import type { FileEntry } from "../types";
import { IconChevron, IconPlus, IconTrash } from "./Icons";
import { Markdown } from "./Markdown";
import { SidePanel } from "./SidePanel";

/** Notes are Markdown files in this folder of the Nalara home, so search, Files and the assistant see them too. */
export const NOTES_DIR = "Notes";
const SAVE_DELAY_MS = 700;

interface Props {
  onClose: () => void;
  onToast: (message: string, tone?: "ok" | "error") => void;
}

const titleOf = (name: string) => name.replace(/\.(md|markdown|txt)$/i, "");

function newName(taken: Set<string>): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const base = `Note ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
  let name = `${base}.md`;
  for (let n = 2; taken.has(name); n++) name = `${base} (${n}).md`;
  return name;
}

/** Notes: a list of Markdown notes, and an editor that saves as you type. */
export function NotesPanel({ onClose, onToast }: Props) {
  const [notes, setNotes] = useState<FileEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<{ path: string; name: string } | null>(null);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const pending = useRef<{ path: string; text: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      await api.ensureFolder("home", NOTES_DIR);
      const listing = await api.listFiles("home", NOTES_DIR);
      setNotes(listing.entries.filter((e) => e.type === "file" && /\.(md|markdown|txt)$/i.test(e.name)).sort((a, b) => b.mtimeMs - a.mtimeMs));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const flush = useCallback(async () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    setState("saving");
    try {
      await api.saveText("home", p.path, p.text, "overwrite");
      setState("saved");
    } catch (err) {
      setState("error");
      setError((err as Error).message);
    }
  }, []);
  // Save what is pending when the panel closes.
  useEffect(() => () => void flush(), [flush]);

  const edit = (value: string) => {
    setText(value);
    if (!open) return;
    pending.current = { path: open.path, text: value };
    setState("idle");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
  };

  const show = async (entry: { path: string; name: string }) => {
    await flush();
    setError(null);
    try {
      const f = await api.readText("home", entry.path);
      setOpen(entry);
      setText(f.content);
      setPreview(false);
      setState("idle");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const create = async () => {
    const name = newName(new Set(notes?.map((n) => n.name)));
    const path = `${NOTES_DIR}/${name}`;
    try {
      await api.saveText("home", path, `# ${titleOf(name)}\n\n`, "create");
      await load();
      await show({ path, name });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const back = async () => {
    await flush();
    setOpen(null);
    void load();
  };

  const rename = async (title: string) => {
    if (!open) return;
    const clean = title.trim().replace(/[\\/:*?"<>|]/g, "-");
    if (!clean || clean === titleOf(open.name)) return;
    await flush();
    const name = `${clean}.md`;
    try {
      const moved = await api.moveFile("home", open.path, `${NOTES_DIR}/${name}`);
      setOpen({ path: moved.path, name: moved.name });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async () => {
    if (!open) return;
    await flush();
    try {
      await api.trashFile("home", open.path);
      onToast(`"${titleOf(open.name)}" moved to the trash`);
      setOpen(null);
      void load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const q = query.trim().toLowerCase();
  const shown = (notes ?? []).filter((n) => !q || n.name.toLowerCase().includes(q));

  if (open) {
    return (
      <SidePanel title="Notes" subtitle={`${NOTES_DIR}/${open.name}`} onClose={onClose} wide bodyClassName="note-body">
        <div className="note-bar">
          <button type="button" className="btn btn-sm" onClick={() => void back()}>
            <IconChevron size={12} className="rot180" /> All notes
          </button>
          <label className="sr-only" htmlFor="note-title">
            Note title
          </label>
          <input id="note-title" className="note-title" defaultValue={titleOf(open.name)} key={open.path} onBlur={(e) => void rename(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
          <span className={`note-state small${state === "error" ? " is-err" : ""}`}>{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Not saved" : ""}</span>
          <button type="button" className={`btn btn-sm${preview ? " on" : ""}`} aria-pressed={preview} onClick={() => setPreview((p) => !p)}>
            {preview ? "Edit" : "Preview"}
          </button>
          <button type="button" className="icon-btn" aria-label="Move this note to the trash" title="Move to trash" onClick={() => void remove()}>
            <IconTrash size={14} />
          </button>
        </div>
        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
        {preview ? (
          <div className="note-preview">
            <Markdown text={text} />
          </div>
        ) : (
          <textarea className="note-editor" value={text} onChange={(e) => edit(e.target.value)} aria-label="Note text" autoFocus spellCheck />
        )}
      </SidePanel>
    );
  }

  return (
    <SidePanel title="Notes" subtitle={`Markdown notes in your ${BRAND} folder, saved as you type`} onClose={onClose} wide>
      <div className="note-list-bar">
        <label className="sr-only" htmlFor="note-q">
          Search notes
        </label>
        <input id="note-q" className="launch-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes…" autoComplete="off" />
        <button type="button" className="btn btn-sm btn-primary" onClick={() => void create()}>
          <IconPlus size={12} /> New note
        </button>
      </div>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {notes === null && !error ? <p className="muted">Loading…</p> : null}
      {notes && shown.length === 0 ? <p className="muted">{q ? "No note matches." : "No notes yet. Start one, or ask the assistant to write one for you."}</p> : null}
      <ul className="note-list">
        {shown.map((n) => (
          <li key={n.path}>
            <button type="button" className="note-item" onClick={() => void show(n)}>
              <span className="note-item-title">{titleOf(n.name)}</span>
              <span className="note-item-date">{new Date(n.mtimeMs).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
            </button>
          </li>
        ))}
      </ul>
    </SidePanel>
  );
}

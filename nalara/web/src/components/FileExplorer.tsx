import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api } from "../api";
import { BRAND } from "../brand";
import type { FileEntry, FileListing, Place, TrashItem } from "../types";
import { IconChevron, IconCopy, IconExternal, IconField, IconFile, IconFolder, IconMenu, IconPencil, IconPlus, IconRefresh, IconTrash, IconUp } from "./Icons";
import { SidePanel } from "./SidePanel";

const PREVIEW = /\.(png|jpe?g|gif|webp|bmp|ico|avif)$/i;
/** Opened in their own app: documents, media and archives Nalara cannot show as text. */
const EXTERNAL = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|zip|7z|rar|gz|tar|mp3|wav|flac|ogg|m4a|mp4|mov|avi|mkv|webm|psd|ai|sketch|fig)$/i;
const TRASH = "__trash__";
const ADD = "__add__";

function size(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function when(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  return d.toDateString() === today.toDateString() ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString();
}

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");

interface Props {
  onClose: () => void;
  /** Open a text file in the viewer; `edit` opens it ready to type (a new file). */
  onOpen: (path: string, place: string, edit?: boolean) => void;
  /** Open an image or PDF preview. */
  onPreview: (url: string, name: string) => void;
  /** The file radial (Summarize, Translate...) for an indexed file in the Nalara folder. */
  onActions: (path: string, nodeId: string) => void;
  onField: () => void;
  onToast: (message: string, tone?: "ok" | "error") => void;
}

type Editing = { kind: "rename"; path: string; value: string } | { kind: "new-file" | "new-folder"; value: string } | null;

/** A file manager: places, folders, new file and folder, rename, copy, trash and restore, open in the default app. */
export function FileExplorer({ onClose, onOpen, onPreview, onActions, onField, onToast }: Props) {
  const [places, setPlaces] = useState<Place[]>([]);
  const [suggested, setSuggested] = useState<{ name: string; path: string }[]>([]);
  const [place, setPlace] = useState("home");
  const [dir, setDir] = useState("");
  const [listing, setListing] = useState<FileListing | null>(null);
  const [trash, setTrash] = useState<TrashItem[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);
  const [newPlace, setNewPlace] = useState("");
  const editRef = useRef<HTMLInputElement>(null);
  const committing = useRef(false);

  const loadPlaces = useCallback(() => {
    api
      .places()
      .then((r) => {
        setPlaces(r.places);
        setSuggested(r.suggested);
      })
      .catch((err: Error) => setError(err.message));
  }, []);
  useEffect(loadPlaces, [loadPlaces]);

  const load = useCallback(() => {
    setError(null);
    if (place === TRASH) {
      api
        .trash()
        .then(setTrash)
        .catch((err: Error) => setError(err.message));
      return;
    }
    if (place === ADD) return;
    const ctl = new AbortController();
    api
      .listFiles(place, dir, { hidden }, ctl.signal)
      .then(setListing)
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => ctl.abort();
  }, [place, dir, hidden]);
  useEffect(load, [load]);

  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);

  const go = (p: string, d = "") => {
    setEditing(null);
    setListing(null);
    setPlace(p);
    setDir(d);
  };

  const run = async (what: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(null);
    try {
      await what();
      if (done) onToast(done);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const open = (e: FileEntry) => {
    if (e.type === "dir") return go(place, e.path);
    if (PREVIEW.test(e.name)) return onPreview(api.rawUrl(place, e.path), e.name);
    if (EXTERNAL.test(e.name)) return void run(() => api.openExternal(place, e.path), `Opened ${e.name} in its app`);
    onOpen(e.path, place);
  };

  const commitEdit = async (ev?: FormEvent) => {
    ev?.preventDefault();
    if (!editing || committing.current) return;
    const name = editing.value.trim();
    if (!name) return setEditing(null);
    committing.current = true;
    try {
    if (editing.kind === "rename") {
      const to = join(parentOf(editing.path), name);
      if (to === editing.path) return setEditing(null);
      await run(() => api.moveFile(place, editing.path, to), `Renamed to ${name}`);
    } else if (editing.kind === "new-folder") {
      await run(() => api.mkdir(place, join(dir, name)), `Created folder ${name}`);
    } else {
      const path = join(dir, name);
      await run(async () => {
        await api.saveText(place, path, "", "create");
        onOpen(path, place, true);
      }, `Created ${name}`);
    }
    } finally {
      committing.current = false;
      setEditing(null);
    }
  };

  const editKeys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setEditing(null);
    }
  };

  const copyOf = (e: FileEntry) => {
    const dot = e.type === "file" ? e.name.lastIndexOf(".") : -1;
    const base = dot > 0 ? e.name.slice(0, dot) : e.name;
    const ext = dot > 0 ? e.name.slice(dot) : "";
    const taken = new Set(listing?.entries.map((x) => x.name));
    let name = `${base} copy${ext}`;
    for (let n = 2; taken.has(name); n++) name = `${base} copy ${n}${ext}`;
    return join(parentOf(e.path), name);
  };

  const current = places.find((p) => p.id === place);
  const crumbs = dir ? dir.split("/") : [];

  const editor = (label: string) => (
    <form className="fx-edit" onSubmit={(e) => void commitEdit(e)}>
      <label className="sr-only" htmlFor="fx-edit-input">
        {label}
      </label>
      <input id="fx-edit-input" ref={editRef} value={editing?.value ?? ""} onChange={(e) => setEditing((x) => (x ? { ...x, value: e.target.value } : x))} onKeyDown={editKeys} onBlur={() => void commitEdit()} spellCheck={false} />
    </form>
  );

  return (
    <SidePanel title="Files" subtitle={current ? `${current.name} · ${current.path}` : place === TRASH ? "Trash: restore files, or delete them for good" : `Your folders in ${BRAND}`} onClose={onClose} wide bodyClassName="fx-body">
      <div className="fx-bar">
        <label className="sr-only" htmlFor="fx-place">
          Place
        </label>
        <select id="fx-place" className="fx-place" value={place} onChange={(e) => go(e.target.value)}>
          {places.map((p) => (
            <option key={p.id} value={p.id} disabled={!p.exists}>
              {p.name}
              {p.exists ? "" : " (missing)"}
            </option>
          ))}
          <option value={ADD}>+ Add a folder…</option>
          <option value={TRASH}>Trash</option>
        </select>
        <button type="button" className="icon-btn" aria-label="Refresh" title="Refresh" onClick={() => load()}>
          <IconRefresh size={14} />
        </button>
        <button type="button" className="btn btn-sm field-link" onClick={onField} title="Show the knowledge field">
          <IconField size={14} /> Field
        </button>
      </div>

      {place === ADD ? (
        <div className="fx-add">
          <p className="muted">Add a folder from this computer so {BRAND} and its assistant can work with it.</p>
          {suggested.length ? (
            <div className="fx-suggest">
              {suggested.map((s) => (
                <button
                  key={s.path}
                  type="button"
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const p = await api.addPlace(s.path, s.name);
                      loadPlaces();
                      go(p.id);
                    }, `Added ${s.name}`)
                  }
                >
                  <IconPlus size={12} /> {s.name}
                </button>
              ))}
            </div>
          ) : null}
          <form
            className="fx-add-form"
            onSubmit={(e) => {
              e.preventDefault();
              const path = newPlace.trim();
              if (!path) return;
              void run(async () => {
                const p = await api.addPlace(path);
                setNewPlace("");
                loadPlaces();
                go(p.id);
              }, "Folder added");
            }}
          >
            <label htmlFor="fx-new-place" className="small muted">
              Folder path
            </label>
            <input id="fx-new-place" value={newPlace} onChange={(e) => setNewPlace(e.target.value)} placeholder="C:\Users\you\Projects  or  /home/you/Projects" spellCheck={false} />
            <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !newPlace.trim()}>
              Add folder
            </button>
          </form>
          {places.filter((p) => !p.builtin).length ? (
            <ul className="fx-places">
              {places
                .filter((p) => !p.builtin)
                .map((p) => (
                  <li key={p.id}>
                    <span>{p.name}</span>
                    <code>{p.path}</code>
                    <button type="button" className="btn btn-sm" onClick={() => void run(async () => (await api.removePlace(p.id), loadPlaces()), `Removed ${p.name} from the list`)}>
                      Remove
                    </button>
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      ) : place === TRASH ? (
        <div className="fx-trash">
          <div className="fx-tools">
            <button type="button" className="btn btn-sm" disabled={busy || !trash?.length} onClick={() => window.confirm("Delete everything in the trash for good?") && void run(() => api.emptyTrash(), "Trash emptied")}>
              Empty trash
            </button>
          </div>
          {trash === null ? <p className="muted">Loading…</p> : trash.length === 0 ? <p className="muted">The trash is empty.</p> : null}
          <ul className="fx-list">
            {trash?.map((t) => (
              <li key={t.id} className="fx-row">
                <span className="fx-icon">{t.type === "dir" ? <IconFolder size={14} /> : <IconFile size={14} />}</span>
                <span className="fx-name mono" title={t.path}>
                  {t.path}
                </span>
                <span className="fx-meta">
                  {places.find((p) => p.id === t.place)?.name ?? t.place} · {when(Date.parse(t.trashedAt))}
                </span>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void run(() => api.restore(t.id), `Restored ${t.path}`)}>
                  Restore
                </button>
                <button type="button" className="icon-btn" aria-label={`Delete ${t.path} for good`} title="Delete for good" disabled={busy} onClick={() => window.confirm(`Delete ${t.path} for good?`) && void run(() => api.purge(t.id))}>
                  <IconTrash size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <nav className="fx-crumbs" aria-label="Folder path">
            <button type="button" className="icon-btn" aria-label="Up one folder" title="Up" disabled={!dir} onClick={() => go(place, parentOf(dir))}>
              <IconUp size={14} />
            </button>
            <button type="button" className="fx-crumb" onClick={() => go(place, "")}>
              {current?.name ?? place}
            </button>
            {crumbs.map((c, i) => (
              <span key={i} className="fx-crumb-wrap">
                <IconChevron size={11} />
                <button type="button" className="fx-crumb" onClick={() => go(place, crumbs.slice(0, i + 1).join("/"))}>
                  {c}
                </button>
              </span>
            ))}
          </nav>
          <div className="fx-tools">
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setEditing({ kind: "new-file", value: "untitled.md" })}>
              <IconPlus size={12} /> New file
            </button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setEditing({ kind: "new-folder", value: "New folder" })}>
              <IconPlus size={12} /> New folder
            </button>
            <button type="button" className="btn btn-sm" onClick={() => void run(() => api.openExternal(place, dir))} title="Open this folder in the computer's file manager">
              <IconExternal size={12} /> Open folder
            </button>
            <label className="fx-hidden small">
              <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> Hidden files
            </label>
          </div>
          {editing && editing.kind !== "rename" ? <div className="fx-row fx-new">{editor(editing.kind === "new-folder" ? "New folder name" : "New file name")}</div> : null}
          {!listing && !error ? <p className="muted">Loading…</p> : null}
          {listing && listing.entries.length === 0 ? <p className="muted">This folder is empty.</p> : null}
          <ul className="fx-list tree" aria-label={`Files in ${dir || current?.name || "the place"}`}>
            {listing?.entries.map((e) => (
              <li key={e.path} className={`fx-row${e.type === "dir" ? " is-dir" : ""}`}>
                {editing?.kind === "rename" && editing.path === e.path ? (
                  editor(`New name for ${e.name}`)
                ) : (
                  <button type="button" className={`tree-btn${e.type === "dir" ? " tree-dir" : ""} fx-open`} onClick={() => open(e)} title={e.path}>
                    <span className="fx-icon">{e.type === "dir" ? <IconFolder size={14} /> : <IconFile size={14} />}</span>
                    <span className="mono fx-name">{e.name}</span>
                  </button>
                )}
                <span className="fx-meta">{e.type === "dir" ? "" : `${size(e.size)} · `}{when(e.mtimeMs)}</span>
                <span className="fx-acts">
                  <button type="button" className="icon-btn" aria-label={`Rename ${e.name}`} title="Rename" onClick={() => setEditing({ kind: "rename", path: e.path, value: e.name })}>
                    <IconPencil size={13} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Duplicate ${e.name}`} title="Duplicate" disabled={busy} onClick={() => void run(() => api.copyFile(place, e.path, copyOf(e)), `Duplicated ${e.name}`)}>
                    <IconCopy size={13} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Open ${e.name} in its app`} title="Open in its app" onClick={() => void run(() => api.openExternal(place, e.path))}>
                    <IconExternal size={13} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Move ${e.name} to the trash`} title="Move to trash" disabled={busy} onClick={() => void run(() => api.trashFile(place, e.path), `${e.name} moved to the trash`)}>
                    <IconTrash size={13} />
                  </button>
                  {place === "home" && e.type === "file" ? (
                    <button type="button" className="icon-btn tree-act" aria-label={`Actions for ${e.name}`} title="Agent actions (summarize, translate...)" onClick={() => onActions(e.path, `file:${e.path}`)}>
                      <IconMenu size={13} />
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </SidePanel>
  );
}

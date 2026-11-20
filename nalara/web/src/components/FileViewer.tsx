import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api } from "../api";
import type { FileKind } from "../types";
import { IconClose, IconFile, IconPencil } from "./Icons";

interface Props {
  path: string;
  line?: number;
  /** Place id; default the Nalara folder. */
  place?: string;
  /** Start in edit mode (a file just created). */
  edit?: boolean;
  onClose: () => void;
}

/** Shows a text file with line numbers; Edit turns it into an editor with Save (Ctrl+S). */
export function FileViewer({ path, line, place = "home", edit = false, onClose }: Props) {
  const [file, setFile] = useState<{ path: string; content: string; kind: FileKind } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(edit);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const id = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const dirty = editing && file !== null && draft !== file.content;

  useEffect(() => {
    returnFocus.current = document.activeElement;
    closeRef.current?.focus();
    return () => {
      const el = returnFocus.current as HTMLElement | null;
      if (el && document.contains(el)) el.focus();
    };
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    setFile(null);
    setError(null);
    api
      .readText(place, path, ctl.signal)
      .then((f) => {
        setFile(f);
        setDraft(f.content);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => ctl.abort();
  }, [path, place]);

  useEffect(() => {
    if (file && line && !editing) lineRef.current?.scrollIntoView({ block: "center" });
  }, [file, line, editing]);

  useEffect(() => {
    if (editing && file) areaRef.current?.focus();
  }, [editing, file]);

  const save = useCallback(async () => {
    if (!file || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.saveText(place, file.path, draft, "overwrite");
      setFile({ ...file, content: draft });
      setSavedAt(Date.now());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [file, draft, place, saving]);

  const close = () => {
    if (dirty && !window.confirm("Close without saving your changes?")) return;
    onClose();
  };

  const lines = file ? file.content.replace(/\n$/, "").split("\n") : [];
  const width = String(lines.length).length;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="modal viewer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            close();
          } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && editing) {
            e.preventDefault();
            void save();
          }
        }}
      >
        <header className="viewer-head">
          <IconFile size={16} />
          <h2 id={`${id}-t`} className="mono viewer-path">
            {path}
          </h2>
          {file ? <span className={`kind kind-${file.kind}`}>{file.kind}</span> : null}
          {file && !editing ? <span className="muted small">{lines.length} lines</span> : null}
          {editing ? <span className={`small viewer-state${dirty ? " is-dirty" : ""}`}>{saving ? "Saving…" : dirty ? "Unsaved changes" : savedAt ? "Saved" : "Editing"}</span> : null}
          {file && !editing ? (
            <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
              <IconPencil size={12} /> Edit
            </button>
          ) : null}
          {editing ? (
            <button type="button" className="btn btn-sm btn-primary" disabled={!dirty || saving} onClick={() => void save()} title="Save (Ctrl+S)">
              Save
            </button>
          ) : null}
          <button ref={closeRef} type="button" className="icon-btn" aria-label="Close file viewer" onClick={close}>
            <IconClose size={16} />
          </button>
        </header>
        <div className="viewer-body" tabIndex={editing ? -1 : 0} aria-label={`Contents of ${path}`}>
          {error ? (
            <p className="inline-error" role="alert">
              {file ? error : `Could not open ${path}: ${error}`}
            </p>
          ) : null}
          {!file && !error ? <p className="muted pad">Loading...</p> : null}
          {file && editing ? (
            <textarea
              ref={areaRef}
              className="viewer-editor"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={file.kind === "doc"}
              aria-label={`Edit ${path}`}
            />
          ) : null}
          {file && !editing ? (
            <div className="code" style={{ ["--gutter" as string]: `${width + 2}ch` }}>
              {lines.map((l, i) => (
                <div key={i} ref={line === i + 1 ? lineRef : undefined} className={`code-line${line === i + 1 ? " hl" : ""}`}>
                  <span className="ln" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="lc">{l || " "}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Image preview from the kernel's sandboxed preview route. */
export function FilePreview({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const id = useId();
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal viewer preview"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="viewer-head">
          <IconFile size={16} />
          <h2 id={`${id}-t`} className="mono viewer-path">
            {name}
          </h2>
          <button type="button" className="icon-btn" aria-label="Close preview" onClick={onClose} autoFocus>
            <IconClose size={16} />
          </button>
        </header>
        <div className="viewer-body preview-body">
          <img src={url} alt={name} />
        </div>
      </div>
    </div>
  );
}

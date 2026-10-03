import { useEffect, useId, useRef, useState } from "react";
import { api } from "../api";
import type { FileKind } from "../types";
import { IconClose, IconFile } from "./Icons";

interface Props {
  path: string;
  line?: number;
  onClose: () => void;
}

export function FileViewer({ path, line, onClose }: Props) {
  const [file, setFile] = useState<{ path: string; content: string; kind: FileKind } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const lineRef = useRef<HTMLDivElement>(null);

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
      .fileContent(path, ctl.signal)
      .then(setFile)
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => ctl.abort();
  }, [path]);

  useEffect(() => {
    if (file && line) lineRef.current?.scrollIntoView({ block: "center" });
  }, [file, line]);

  const lines = file ? file.content.replace(/\n$/, "").split("\n") : [];
  const width = String(lines.length).length;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
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
            onClose();
          }
        }}
      >
        <header className="viewer-head">
          <IconFile size={16} />
          <h2 id={`${id}-t`} className="mono viewer-path">
            {path}
          </h2>
          {file ? <span className={`kind kind-${file.kind}`}>{file.kind}</span> : null}
          {file ? <span className="muted small">{lines.length} lines</span> : null}
          <button ref={closeRef} type="button" className="icon-btn" aria-label="Close file viewer" onClick={onClose}>
            <IconClose size={16} />
          </button>
        </header>
        <div className="viewer-body" tabIndex={0} aria-label={`Contents of ${path}`}>
          {error ? (
            <p className="inline-error" role="alert">
              Could not open {path}: {error}
            </p>
          ) : null}
          {!file && !error ? <p className="muted pad">Loading...</p> : null}
          {file ? (
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

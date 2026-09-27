import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import type { SearchHit } from "../types";
import { SidePanel } from "./SidePanel";
import { IconFile, IconSearch } from "./Icons";

export const SEARCH_EXAMPLES = ["combat code", "latest damage calculations", "files related to inventory", "design docs referencing merchants"];

interface Props {
  onClose: () => void;
  onOpenHit: (hit: SearchHit) => void;
}

export function SearchPanel({ onClose, onOpenHit }: Props) {
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  // Hits travel with the query that produced them: while the next query loads, the old list must not be labelled
  // with the new query's text.
  const [result, setResult] = useState<{ query: string; hits: SearchHit[] } | null>(null);
  const hits = result?.hits ?? null;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!submitted) return;
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    api
      .search(submitted, { limit: 25 }, ctl.signal)
      .then((h) => setResult({ query: submitted, hits: h }))
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      })
      .finally(() => setLoading(false));
    return () => ctl.abort();
  }, [submitted]);

  const run = (value: string) => {
    setQ(value);
    setSubmitted(value.trim());
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    run(q);
  };

  return (
    <SidePanel title="Search" subtitle="Find files by meaning, not by folder." onClose={onClose}>
      <form className="search-form" role="search" onSubmit={onSubmit}>
        <label htmlFor="nos-search" className="sr-only">
          Search query
        </label>
        <input id="nos-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="combat code" autoComplete="off" />
        <button type="submit" className="btn btn-primary" disabled={!q.trim()}>
          <IconSearch size={15} /> Search
        </button>
      </form>
      <div className="chips chips-wrap">
        {SEARCH_EXAMPLES.map((x) => (
          <button key={x} type="button" className="chip-btn" onClick={() => run(x)}>
            {x}
          </button>
        ))}
      </div>
      <div aria-live="polite">
        {loading ? <p className="muted">Searching...</p> : null}
        {error ? (
          <p className="inline-error" role="alert">
            Search failed: {error}
          </p>
        ) : null}
        {!loading && result && result.hits.length === 0 ? <p className="muted">No files match &ldquo;{result.query}&rdquo;.</p> : null}
        {result && result.hits.length > 0 ? (
          <p className="muted small">
            {result.hits.length} result{result.hits.length === 1 ? "" : "s"} for &ldquo;{result.query}&rdquo;
          </p>
        ) : null}
      </div>
      {hits && hits.length > 0 ? (
        <ol className="hits">
          {hits.map((h) => (
            <li key={h.nodeId}>
              <button type="button" className="hit" onClick={() => onOpenHit(h)}>
                <span className="hit-top">
                  <IconFile size={14} />
                  <span className="mono hit-path">
                    {h.path}
                    {h.line ? `:${h.line}` : ""}
                  </span>
                  <span className={`kind kind-${h.kind}`}>{h.kind}</span>
                </span>
                {h.reasons.length ? <span className="hit-reasons">{h.reasons.join(" · ")}</span> : null}
                {h.snippet ? <code className="hit-snippet">{h.snippet}</code> : null}
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </SidePanel>
  );
}

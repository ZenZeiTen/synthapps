import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { MEMORY_CATEGORIES, MEMORY_CATEGORY_LABEL } from "../labels";
import type { KernelEvent, MemoryCategory, MemoryRecord } from "../types";
import { SidePanel } from "./SidePanel";
import { IconCheck, IconClose, IconRefresh } from "./Icons";

interface Props {
  onClose: () => void;
  onToast: (message: string, tone?: "ok" | "error") => void;
  onEvent: (l: (ev: KernelEvent) => void) => () => void;
}

export function MemoryPanel({ onClose, onToast, onEvent }: Props) {
  const [records, setRecords] = useState<MemoryRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<MemoryCategory | "">("");
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ category: "coding_standard" as MemoryCategory, key: "", content: "", tags: "" });

  const load = useCallback(async () => {
    try {
      setRecords(await api.memory({ category: category || undefined, limit: 200, includeProposed: true }));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [category]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => onEvent((ev) => (ev.type === "memory.updated" ? void load() : undefined)), [onEvent, load]);

  const confirm = async (r: MemoryRecord) => {
    setBusy(r.id);
    try {
      await api.confirmMemory(r.id);
      onToast(`Confirmed memory "${r.key}"`);
      await load();
    } catch (err) {
      onToast(`Confirm failed: ${(err as Error).message}`, "error");
    } finally {
      setBusy(null);
    }
  };
  const forget = async (r: MemoryRecord) => {
    setBusy(r.id);
    try {
      await api.forget(r.id);
      onToast(`Forgot "${r.key}"`);
      await load();
    } catch (err) {
      onToast(`Forget failed: ${(err as Error).message}`, "error");
    } finally {
      setBusy(null);
    }
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.key.trim() || !form.content.trim()) return;
    setBusy("new");
    try {
      await api.remember({
        category: form.category,
        key: form.key.trim(),
        content: form.content.trim(),
        tags: form.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      setForm({ ...form, key: "", content: "", tags: "" });
      onToast("Memory saved");
      await load();
    } catch (err) {
      onToast(`Save failed: ${(err as Error).message}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const proposed = (records ?? []).filter((r) => r.status === "proposed");
  const groups = MEMORY_CATEGORIES.map((c) => ({ c, list: (records ?? []).filter((r) => r.category === c && r.status !== "proposed") })).filter((g) => g.list.length);

  const renderRecord = (r: MemoryRecord) => (
    <li key={r.id} className={`mem${r.status === "proposed" ? " proposed" : ""}`}>
      <div className="mem-top">
        <span className="mono mem-key">{r.key}</span>
        {r.status === "proposed" ? <span className="badge badge-amber">proposed</span> : null}
        <span className="mono muted small mem-src">{r.source}</span>
      </div>
      <p className="mem-content">{r.content}</p>
      {r.tags.length ? <p className="mono small muted">{r.tags.map((t) => `#${t}`).join(" ")}</p> : null}
      <div className="mem-actions">
        {r.status === "proposed" ? (
          <button type="button" className="btn btn-sm btn-primary" disabled={busy === r.id} onClick={() => void confirm(r)} aria-label={`Confirm memory ${r.key}`}>
            <IconCheck size={13} /> Confirm
          </button>
        ) : null}
        <button type="button" className="btn btn-sm" disabled={busy === r.id} onClick={() => void forget(r)} aria-label={`Forget memory ${r.key}`}>
          <IconClose size={13} /> Forget
        </button>
      </div>
    </li>
  );

  return (
    <SidePanel title="Memory" subtitle="What NeuralOS remembers. Agent-written records stay proposed until you confirm them." onClose={onClose}>
      <div className="row gap">
        <label htmlFor="mem-cat" className="field-label">
          Category
        </label>
        <select id="mem-cat" value={category} onChange={(e) => setCategory(e.target.value as MemoryCategory | "")}>
          <option value="">All categories</option>
          {MEMORY_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {MEMORY_CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <button type="button" className="icon-btn" aria-label="Reload memory" onClick={() => void load()}>
          <IconRefresh size={15} />
        </button>
      </div>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {!records && !error ? <p className="muted">Loading memory...</p> : null}
      {proposed.length ? (
        <section className="panel-sec">
          <h3>Waiting for confirmation ({proposed.length})</h3>
          <ul className="mem-list">
            {proposed.map(renderRecord)}
          </ul>
        </section>
      ) : null}
      {groups.map((g) => (
        <section key={g.c} className="panel-sec">
          <h3>{MEMORY_CATEGORY_LABEL[g.c]}</h3>
          <ul className="mem-list">
            {g.list.map(renderRecord)}
          </ul>
        </section>
      ))}
      {records && records.length === 0 ? <p className="muted">No memory records yet.</p> : null}

      <form className="panel-sec form" onSubmit={add}>
        <h3>Add a record</h3>
        <label className="field">
          <span className="field-label">Category</span>
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as MemoryCategory })}>
            {MEMORY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {MEMORY_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Key</span>
          <input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="naming-style" required />
        </label>
        <label className="field">
          <span className="field-label">Content</span>
          <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={3} required />
        </label>
        <label className="field">
          <span className="field-label">Tags (comma separated)</span>
          <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="typescript, style" />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy === "new" || !form.key.trim() || !form.content.trim()}>
          Save record
        </button>
      </form>
    </SidePanel>
  );
}

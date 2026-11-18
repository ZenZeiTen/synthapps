import { useState } from "react";
import { useAppStore } from "../store";

export default function TermPanel() {
  const { terms, updateTargetTerm, removeTerm, addTerm } = useAppStore();
  const [filter, setFilter] = useState("");
  const [newTerm, setNewTerm] = useState("");

  const shown = terms.filter((t) => t.sourceTerm.toLowerCase().includes(filter.toLowerCase()));
  const mapped = terms.filter((t) => t.targetTerm.trim()).length;

  return (
    <aside className="flex h-full flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Terminology</h2>
          <span className="text-xs text-slate-400">
            {mapped}/{terms.length} mapped
          </span>
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter terms…"
          className="mt-2 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none"
        />
        <form
          className="mt-2 flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (newTerm.trim()) {
              addTerm(newTerm.trim());
              setNewTerm("");
            }
          }}
        >
          <input
            value={newTerm}
            onChange={(e) => setNewTerm(e.target.value)}
            placeholder="Add a term manually…"
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-md border border-slate-300 bg-slate-50 px-2 text-sm text-slate-600 hover:bg-slate-100"
          >
            +
          </button>
        </form>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {terms.length === 0 && (
          <p className="p-4 text-center text-xs text-slate-400">
            Terms extracted from the source text will appear here, sorted by frequency.
          </p>
        )}
        <ul className="flex flex-col gap-1.5">
          {shown.map((term) => (
            <li key={term.id} className="group rounded-lg border border-slate-200 p-2 hover:border-indigo-200">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-slate-700" title={term.sourceTerm}>
                  {term.sourceTerm}
                </span>
                <span className="flex items-center gap-1">
                  <span className="rounded bg-slate-100 px-1.5 text-[11px] text-slate-500" title="Frequency in source text">
                    ×{term.frequency}
                  </span>
                  <button
                    onClick={() => removeTerm(term.id)}
                    className="text-slate-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                    title="Remove term"
                  >
                    ✕
                  </button>
                </span>
              </div>
              <input
                value={term.targetTerm}
                onChange={(e) => updateTargetTerm(term.id, e.target.value)}
                placeholder="Target equivalent…"
                className={`mt-1 w-full rounded-md border px-2 py-1 text-sm focus:outline-none ${
                  term.targetTerm.trim()
                    ? "border-emerald-300 bg-emerald-50/50"
                    : "border-slate-200 bg-slate-50"
                } focus:border-indigo-400`}
              />
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

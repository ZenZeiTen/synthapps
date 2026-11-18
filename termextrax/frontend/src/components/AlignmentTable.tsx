import { useRef, useState } from "react";
import { useAppStore } from "../store";
import type { Side } from "../types";

const btn =
  "rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] leading-4 text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed";

function Cell(props: { row: number; side: Side; text: string; isLast: boolean }) {
  const { row, side, text, isLast } = props;
  const { editCell, mergeDown, splitCell, shiftDown, shiftUp } = useAppStore();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState(false);

  const doSplit = () => {
    const el = ref.current;
    if (!el) return;
    const pos = el.selectionStart ?? 0;
    splitCell(row, side, pos);
    setEditing(false);
  };

  const empty = !text.trim();

  return (
    <td className={`w-1/2 border-b border-slate-200 p-0 align-top ${empty ? "bg-amber-50" : ""}`}>
      <div className="group flex flex-col">
        {editing ? (
          <textarea
            ref={ref}
            autoFocus
            defaultValue={text}
            onBlur={(e) => {
              editCell(row, side, e.target.value);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
            }}
            className="min-h-[3.5rem] w-full resize-y border-0 bg-indigo-50/60 p-2 text-sm focus:outline-none"
          />
        ) : (
          <div
            onDoubleClick={() => setEditing(true)}
            title="Double-click to edit"
            className="min-h-[2.5rem] cursor-text whitespace-pre-wrap p-2 text-sm"
          >
            {empty ? <span className="italic text-amber-600">— empty —</span> : text}
          </div>
        )}
        <div className="flex flex-wrap gap-1 px-2 pb-1.5 opacity-0 transition-opacity group-hover:opacity-100">
          {editing ? (
            <button className={btn} onMouseDown={(e) => e.preventDefault()} onClick={doSplit} title="Split this cell at the cursor position">
              ✂ Split at cursor
            </button>
          ) : (
            <>
              <button className={btn} onClick={() => setEditing(true)} title="Edit text">
                ✎ Edit
              </button>
              <button className={btn} disabled={isLast} onClick={() => mergeDown(row, side)} title="Merge with the cell below (this column pulls up)">
                ⤵ Merge ↓
              </button>
              <button className={btn} disabled={row === 0} onClick={() => shiftUp(row, side)} title="Shift this column up (merges into the cell above)">
                ↑ Shift
              </button>
              <button className={btn} onClick={() => shiftDown(row, side)} title="Insert an empty cell here, pushing this column down">
                ↓ Shift
              </button>
            </>
          )}
        </div>
      </div>
    </td>
  );
}

const STATUS_STYLE: Record<string, string> = {
  auto: "bg-slate-200 text-slate-600",
  manual_edit: "bg-sky-100 text-sky-700",
  approved: "bg-emerald-100 text-emerald-700",
};

export default function AlignmentTable() {
  const { segments, deleteRow, insertRowBelow, toggleApproved } = useAppStore();

  if (segments.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-400">
        No segments yet — ingest and align two texts above to start editing.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="w-10 border-b border-slate-200 p-2">#</th>
            <th className="w-1/2 border-b border-slate-200 p-2">Source</th>
            <th className="w-1/2 border-b border-slate-200 p-2">Target</th>
            <th className="w-28 border-b border-slate-200 p-2">Row</th>
          </tr>
        </thead>
        <tbody>
          {segments.map((seg, i) => (
            <tr key={seg.id} className="hover:bg-slate-50/50">
              <td className="border-b border-slate-200 p-2 align-top text-xs text-slate-400">{i + 1}</td>
              <Cell row={i} side="source" text={seg.sourceText} isLast={i === segments.length - 1} />
              <Cell row={i} side="target" text={seg.targetText} isLast={i === segments.length - 1} />
              <td className="border-b border-slate-200 p-2 align-top">
                <div className="flex flex-col items-start gap-1">
                  <button
                    onClick={() => toggleApproved(i)}
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[seg.status]}`}
                    title="Click to toggle approval"
                  >
                    {seg.status === "manual_edit" ? "edited" : seg.status}
                  </button>
                  <div className="flex gap-1">
                    <button className={btn} onClick={() => insertRowBelow(i)} title="Insert empty row below">
                      +
                    </button>
                    <button
                      className={`${btn} text-red-600 hover:bg-red-50`}
                      onClick={() => deleteRow(i)}
                      title="Delete this row"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import { create } from "zustand";
import type { AlignedSegment, ExtractedTerm, Side } from "./types";

let counter = 0;
const newId = () => `seg-${Date.now()}-${counter++}`;

/**
 * Column-wise editing model: the table is treated as two parallel columns of
 * cells. Merge/split/shift operate on one column only, then the rows are
 * rebuilt (padding the shorter column with empty cells). This is what lets a
 * single shift fix a whole misalignment cascade.
 */
function rebuild(
  prev: AlignedSegment[],
  srcCol: string[],
  tgtCol: string[],
  touched: Set<number>,
): AlignedSegment[] {
  // Drop trailing rows that are empty on both sides.
  let n = Math.max(srcCol.length, tgtCol.length);
  while (n > 0 && !(srcCol[n - 1] ?? "").trim() && !(tgtCol[n - 1] ?? "").trim()) n--;

  const rows: AlignedSegment[] = [];
  for (let i = 0; i < n; i++) {
    const before = prev[i];
    const sourceText = srcCol[i] ?? "";
    const targetText = tgtCol[i] ?? "";
    const unchanged =
      before && before.sourceText === sourceText && before.targetText === targetText && !touched.has(i);
    rows.push({
      id: before ? before.id : newId(),
      sourceText,
      targetText,
      status: unchanged ? before.status : "manual_edit",
    });
  }
  return rows;
}

const cols = (segments: AlignedSegment[]) => ({
  srcCol: segments.map((s) => s.sourceText),
  tgtCol: segments.map((s) => s.targetText),
});

const joinNonEmpty = (a: string, b: string) => (a.trim() && b.trim() ? `${a.trim()} ${b.trim()}` : (a + b).trim());

interface AppState {
  segments: AlignedSegment[];
  terms: ExtractedTerm[];
  sourceLang: string;
  targetLang: string;

  setLangs: (source: string, target: string) => void;
  setSegments: (segments: AlignedSegment[]) => void;
  setTerms: (terms: ExtractedTerm[]) => void;

  editCell: (row: number, side: Side, text: string) => void;
  mergeDown: (row: number, side: Side) => void;
  splitCell: (row: number, side: Side, position: number) => void;
  shiftDown: (row: number, side: Side) => void;
  shiftUp: (row: number, side: Side) => void;
  deleteRow: (row: number) => void;
  insertRowBelow: (row: number) => void;
  toggleApproved: (row: number) => void;

  updateTargetTerm: (id: string, targetTerm: string) => void;
  removeTerm: (id: string) => void;
  addTerm: (sourceTerm: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  segments: [],
  terms: [],
  sourceLang: "en",
  targetLang: "id",

  setLangs: (sourceLang, targetLang) => set({ sourceLang, targetLang }),
  setSegments: (segments) => set({ segments }),
  setTerms: (terms) => set({ terms }),

  editCell: (row, side, text) =>
    set((state) => ({
      segments: state.segments.map((seg, i) =>
        i === row
          ? {
              ...seg,
              [side === "source" ? "sourceText" : "targetText"]: text,
              status: "manual_edit",
            }
          : seg,
      ),
    })),

  // Merge this cell with the one below it (same column); the column pulls up.
  mergeDown: (row, side) =>
    set((state) => {
      const { srcCol, tgtCol } = cols(state.segments);
      const col = side === "source" ? srcCol : tgtCol;
      if (row >= col.length - 1) return state;
      col[row] = joinNonEmpty(col[row], col[row + 1]);
      col.splice(row + 1, 1);
      return { segments: rebuild(state.segments, srcCol, tgtCol, new Set([row])) };
    }),

  // Split one cell into two at a caret position; the column pushes down.
  splitCell: (row, side, position) =>
    set((state) => {
      const { srcCol, tgtCol } = cols(state.segments);
      const col = side === "source" ? srcCol : tgtCol;
      const text = col[row] ?? "";
      const before = text.slice(0, position).trim();
      const after = text.slice(position).trim();
      if (!before || !after) return state;
      col.splice(row, 1, before, after);
      return { segments: rebuild(state.segments, srcCol, tgtCol, new Set([row, row + 1])) };
    }),

  // Insert an empty cell here, pushing this column's content down one row.
  shiftDown: (row, side) =>
    set((state) => {
      const { srcCol, tgtCol } = cols(state.segments);
      const col = side === "source" ? srcCol : tgtCol;
      col.splice(row, 0, "");
      return { segments: rebuild(state.segments, srcCol, tgtCol, new Set([row])) };
    }),

  // Pull this column's content up one row, merging into the cell above if
  // that cell is not empty.
  shiftUp: (row, side) =>
    set((state) => {
      if (row === 0) return state;
      const { srcCol, tgtCol } = cols(state.segments);
      const col = side === "source" ? srcCol : tgtCol;
      col[row - 1] = joinNonEmpty(col[row - 1], col[row]);
      col.splice(row, 1);
      return { segments: rebuild(state.segments, srcCol, tgtCol, new Set([row - 1])) };
    }),

  deleteRow: (row) =>
    set((state) => ({ segments: state.segments.filter((_, i) => i !== row) })),

  insertRowBelow: (row) =>
    set((state) => {
      const segments = [...state.segments];
      segments.splice(row + 1, 0, { id: newId(), sourceText: "", targetText: "", status: "manual_edit" });
      return { segments };
    }),

  toggleApproved: (row) =>
    set((state) => ({
      segments: state.segments.map((seg, i) =>
        i === row ? { ...seg, status: seg.status === "approved" ? "manual_edit" : "approved" } : seg,
      ),
    })),

  updateTargetTerm: (id, targetTerm) =>
    set((state) => ({
      terms: state.terms.map((t) => (t.id === id ? { ...t, targetTerm } : t)),
    })),

  removeTerm: (id) => set((state) => ({ terms: state.terms.filter((t) => t.id !== id) })),

  addTerm: (sourceTerm) =>
    set((state) => ({
      terms: [
        { id: newId(), sourceTerm, targetTerm: "", frequency: 1 },
        ...state.terms,
      ],
    })),
}));

import { useState } from "react";
import AlignmentTable from "./components/AlignmentTable";
import ExportPanel from "./components/ExportPanel";
import IngestPanel from "./components/IngestPanel";
import TermPanel from "./components/TermPanel";
import { useAppStore } from "./store";

export default function App() {
  const segments = useAppStore((s) => s.segments);
  const [showIngest, setShowIngest] = useState(true);

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 p-4 md:p-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">
            TermExtrax
          </h1>
          <p className="text-sm text-slate-500">
            Bilingual text alignment &amp; terminology extraction for translators
          </p>
        </div>
        <button
          onClick={() => setShowIngest((v) => !v)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 shadow-sm hover:bg-slate-50"
        >
          {showIngest ? "Hide input panel" : "Show input panel"}
        </button>
      </header>

      {showIngest && <IngestPanel onAligned={() => setShowIngest(false)} />}

      <ExportPanel />

      <div className="grid flex-1 grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_20rem]">
        <main>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">
              Aligned segments{segments.length > 0 && ` (${segments.length})`}
            </h2>
            <span className="text-xs text-slate-400">
              Double-click a cell to edit · hover a cell for merge / split / shift
            </span>
          </div>
          <AlignmentTable />
        </main>
        <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]">
          <TermPanel />
        </div>
      </div>
    </div>
  );
}

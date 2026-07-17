import { useState } from "react";
import { exportCorpus, exportTerms } from "../api";
import { useAppStore } from "../store";
import Spinner from "./Spinner";

const btn =
  "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";

export default function ExportPanel() {
  const { segments, terms, sourceLang, targetLang } = useAppStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeUnmapped, setIncludeUnmapped] = useState(false);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Corpus</span>
          <button
            className={btn}
            disabled={segments.length === 0 || busy !== null}
            onClick={() => void run("corpus-csv", () => exportCorpus("csv", segments, sourceLang, targetLang))}
          >
            CSV
          </button>
          <button
            className={btn}
            disabled={segments.length === 0 || busy !== null}
            onClick={() => void run("corpus-tmx", () => exportCorpus("tmx", segments, sourceLang, targetLang))}
          >
            TMX
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Termbase</span>
          <button
            className={btn}
            disabled={terms.length === 0 || busy !== null}
            onClick={() =>
              void run("terms-csv", () => exportTerms("csv", terms, sourceLang, targetLang, includeUnmapped))
            }
          >
            CSV
          </button>
          <button
            className={btn}
            disabled={terms.length === 0 || busy !== null}
            onClick={() =>
              void run("terms-tbx", () => exportTerms("tbx", terms, sourceLang, targetLang, includeUnmapped))
            }
          >
            TBX
          </button>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={includeUnmapped}
              onChange={(e) => setIncludeUnmapped(e.target.checked)}
              className="accent-indigo-600"
            />
            include unmapped terms
          </label>
        </div>

        {busy && <Spinner label="Exporting…" />}
      </div>
      {error && (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-700">{error}</p>
      )}
    </section>
  );
}

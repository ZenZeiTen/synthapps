import { useEffect, useState } from "react";
import { extractTerms, fetchLanguages, segmentAndAlign, uploadFile } from "../api";
import { useAppStore } from "../store";
import type { AlignMethod, LanguageInfo } from "../types";
import Spinner from "./Spinner";

interface Props {
  onAligned: () => void;
}

function TextInput(props: {
  label: string;
  text: string;
  setText: (t: string) => void;
  lang: string;
  setLang: (l: string) => void;
  languages: LanguageInfo[];
  onError: (msg: string) => void;
}) {
  const [fileInfo, setFileInfo] = useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const res = await uploadFile(file);
      props.setText(res.text);
      setFileInfo(`${res.filename} (${res.encoding})`);
    } catch (err) {
      props.onError(err instanceof Error ? err.message : "Upload failed");
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-700">{props.label}</span>
        <select
          value={props.lang}
          onChange={(e) => props.setLang(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
        >
          {props.languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={props.text}
        onChange={(e) => props.setText(e.target.value)}
        placeholder="Paste text here, or upload a .txt file below…"
        className="h-44 w-full resize-y rounded-lg border border-slate-300 bg-white p-3 font-mono text-sm shadow-inner focus:border-indigo-400 focus:outline-none"
      />
      <div className="flex items-center gap-3 text-xs text-slate-500">
        <label className="cursor-pointer rounded-md border border-slate-300 bg-white px-2 py-1 font-medium text-slate-600 hover:bg-slate-50">
          Upload .txt
          <input
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={(e) => {
              void handleFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {fileInfo && <span>{fileInfo}</span>}
        <span className="ml-auto">{props.text.length.toLocaleString()} chars</span>
      </div>
    </div>
  );
}

export default function IngestPanel({ onAligned }: Props) {
  const [languages, setLanguages] = useState<LanguageInfo[]>([]);
  const [sourceText, setSourceText] = useState("");
  const [targetText, setTargetText] = useState("");
  const [alignMethod, setAlignMethod] = useState<AlignMethod>("gale_church");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const { sourceLang, targetLang, setLangs, setSegments, setTerms } = useAppStore();

  useEffect(() => {
    fetchLanguages()
      .then(setLanguages)
      .catch(() =>
        setError("Could not reach the backend. Start it with: uvicorn app.main:app --reload (in backend/)"),
      );
  }, []);

  const run = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const [alignRes, termRes] = await Promise.all([
        segmentAndAlign({ sourceText, targetText, sourceLang, targetLang, alignMethod }),
        extractTerms({ sourceText, sourceLang }),
      ]);
      setSegments(alignRes.segments);
      setTerms(termRes.terms);
      setInfo(
        `Aligned ${alignRes.segments.length} rows from ${alignRes.source_sentence_count} source / ` +
          `${alignRes.target_sentence_count} target sentences · ${termRes.terms.length} terms extracted ` +
          `(models: ${alignRes.source_model}, ${alignRes.target_model})`,
      );
      onAligned();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Processing failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row">
        <TextInput
          label="Source text"
          text={sourceText}
          setText={setSourceText}
          lang={sourceLang}
          setLang={(l) => setLangs(l, targetLang)}
          languages={languages}
          onError={setError}
        />
        <TextInput
          label="Target text"
          text={targetText}
          setText={setTargetText}
          lang={targetLang}
          setLang={(l) => setLangs(sourceLang, l)}
          languages={languages}
          onError={setError}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Alignment:
          <select
            value={alignMethod}
            onChange={(e) => setAlignMethod(e.target.value as AlignMethod)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
          >
            <option value="gale_church">Gale–Church (length-based)</option>
            <option value="sequential">Sequential 1:1</option>
          </select>
        </label>
        <button
          onClick={() => void run()}
          disabled={busy || !sourceText.trim() || !targetText.trim()}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Segment, align &amp; extract terms
        </button>
        {busy && <Spinner label="Running NLP pipeline…" />}
      </div>

      {error && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      {info && !error && (
        <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {info}
        </p>
      )}
    </section>
  );
}

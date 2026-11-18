import type { AlignedSegment, AlignMethod, ExtractedTerm, LanguageInfo } from "./types";

async function jsonOrThrow(res: Response) {
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* keep default message */
    }
    throw new Error(detail);
  }
  return res.json();
}

export async function fetchLanguages(): Promise<LanguageInfo[]> {
  return jsonOrThrow(await fetch("/api/languages"));
}

export async function uploadFile(file: File): Promise<{ filename: string; encoding: string; text: string }> {
  const form = new FormData();
  form.append("file", file);
  return jsonOrThrow(await fetch("/api/upload", { method: "POST", body: form }));
}

export interface SegmentResult {
  segments: AlignedSegment[];
  source_sentence_count: number;
  target_sentence_count: number;
  source_model: string;
  target_model: string;
}

export async function segmentAndAlign(params: {
  sourceText: string;
  targetText: string;
  sourceLang: string;
  targetLang: string;
  alignMethod: AlignMethod;
}): Promise<SegmentResult> {
  return jsonOrThrow(
    await fetch("/api/segment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_text: params.sourceText,
        target_text: params.targetText,
        source_lang: params.sourceLang,
        target_lang: params.targetLang,
        align_method: params.alignMethod,
      }),
    }),
  );
}

export async function extractTerms(params: {
  sourceText: string;
  sourceLang: string;
  maxTerms?: number;
}): Promise<{ terms: ExtractedTerm[]; model: string }> {
  return jsonOrThrow(
    await fetch("/api/extract-terms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_text: params.sourceText,
        source_lang: params.sourceLang,
        max_terms: params.maxTerms ?? 60,
      }),
    }),
  );
}

async function downloadFromResponse(res: Response, fallbackName: string) {
  if (!res.ok) {
    let detail = `Export failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* keep default */
    }
    throw new Error(detail);
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = match?.[1] ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function exportCorpus(
  format: "csv" | "tmx",
  segments: AlignedSegment[],
  sourceLang: string,
  targetLang: string,
) {
  const res = await fetch(`/api/export/corpus/${format}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ segments, source_lang: sourceLang, target_lang: targetLang }),
  });
  await downloadFromResponse(res, `aligned_corpus.${format}`);
}

export async function exportTerms(
  format: "csv" | "tbx",
  terms: ExtractedTerm[],
  sourceLang: string,
  targetLang: string,
  includeUnmapped: boolean,
) {
  const res = await fetch(`/api/export/terms/${format}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      terms: terms.map(({ sourceTerm, targetTerm, frequency }) => ({ sourceTerm, targetTerm, frequency })),
      source_lang: sourceLang,
      target_lang: targetLang,
      include_unmapped: includeUnmapped,
    }),
  });
  await downloadFromResponse(res, `termbase.${format}`);
}

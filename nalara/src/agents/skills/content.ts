/**
 * Offline skills for content agents: localization, SEO, brand voice and UX/accessibility.
 */
import type { Finding } from "../../kernel/types";
import {
  DOC_RE,
  HTML_RE,
  MARKUP_RE,
  countBySeverity,
  lineAt,
  makeOutput,
  readText,
  recall,
  recordWrite,
  truncate,
  writeOutput,
  type RecalledMemory,
  type Skill,
} from "./context";

// ---------------------------------------------------------------------------
// String extraction
// ---------------------------------------------------------------------------

export interface SourceString {
  file: string;
  line: number;
  text: string;
  /** Where it came from: "text", "alt", "title", "meta:description", "json:<key>", ... */
  context: string;
}

/** Replaces the matched blocks with blank text of the same shape, so later indexes keep their line numbers. */
function blankBlocks(text: string, re: RegExp): string {
  return text.replace(re, (m) => m.replace(/[^\n]/g, " "));
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

const TRANSLATABLE = /\p{L}{2,}/u;

export function extractHtmlStrings(file: string, html: string): SourceString[] {
  const text = blankBlocks(html, /<(script|style)\b[\s\S]*?<\/\1>|<!--[\s\S]*?-->/gi);
  const out: SourceString[] = [];
  const textNode = />([^<]+)</g;
  let m: RegExpExecArray | null;
  while ((m = textNode.exec(text))) {
    const value = decodeEntities(m[1]).replace(/\s+/g, " ").trim();
    if (TRANSLATABLE.test(value)) out.push({ file, line: lineAt(text, m.index + m[0].indexOf(m[1].trimStart()[0] ?? "")), text: value, context: "text" });
  }
  const attr = /\b(alt|title|placeholder|aria-label)\s*=\s*("([^"]*)"|'([^']*)')/gi;
  while ((m = attr.exec(text))) {
    const value = decodeEntities(m[3] ?? m[4] ?? "").trim();
    if (TRANSLATABLE.test(value)) out.push({ file, line: lineAt(text, m.index), text: value, context: m[1].toLowerCase() });
  }
  const meta = /<meta\b[^>]*>/gi;
  while ((m = meta.exec(text))) {
    const tag = m[0];
    const name = /\b(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /\bcontent\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
    if (name && content && /^(description|keywords|og:title|og:description|twitter:title|twitter:description)$/.test(name)) {
      const value = decodeEntities(content[2] ?? content[3] ?? "").trim();
      if (TRANSLATABLE.test(value)) out.push({ file, line: lineAt(text, m.index), text: value, context: `meta:${name}` });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

function stripInlineMarkdown(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`[^`]*`/g, "")
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractMarkdownStrings(file: string, md: string): SourceString[] {
  const out: SourceString[] = [];
  const lines = md.split("\n");
  let fenced = false;
  let frontMatter = lines[0]?.trim() === "---";
  lines.forEach((raw, i) => {
    if (frontMatter) {
      if (i > 0 && raw.trim() === "---") frontMatter = false;
      return;
    }
    if (/^\s*(```|~~~)/.test(raw)) {
      fenced = !fenced;
      return;
    }
    if (fenced || !raw.trim()) return;
    if (/^\s*\|?\s*:?-{2,}/.test(raw) && /^[\s|:-]+$/.test(raw)) return; // table separator
    if (raw.includes("|") && /^\s*\|/.test(raw)) {
      for (const cell of raw.split("|").map((c) => stripInlineMarkdown(c)).filter((c) => TRANSLATABLE.test(c))) {
        out.push({ file, line: i + 1, text: cell, context: "table" });
      }
      return;
    }
    const heading = /^\s*#{1,6}\s+/.test(raw);
    const value = stripInlineMarkdown(raw.replace(/^\s*(#{1,6}|[-*+]|\d+[.)]|>)\s+/, ""));
    if (TRANSLATABLE.test(value)) out.push({ file, line: i + 1, text: value, context: heading ? "heading" : "text" });
  });
  return out;
}

const NON_TEXT_KEYS = /^(id|key|url|href|src|path|file|type|icon|image|color|colour|class|slug|locale|lang|version|name_id|ref|\$\w+)$/i;

export function extractJsonStrings(file: string, raw: string): SourceString[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const out: SourceString[] = [];
  let searchFrom = 0;
  const walk = (value: unknown, key: string) => {
    if (typeof value === "string") {
      if (NON_TEXT_KEYS.test(key) || !TRANSLATABLE.test(value) || /^(https?:|\.{0,2}\/|#[0-9a-f]{3,8}$)/i.test(value)) return;
      const needle = JSON.stringify(value);
      let at = raw.indexOf(needle, searchFrom);
      if (at < 0) at = raw.indexOf(needle);
      else searchFrom = at + needle.length;
      out.push({ file, line: at >= 0 ? lineAt(raw, at) : 1, text: value, context: `json:${key}` });
    } else if (Array.isArray(value)) value.forEach((v) => walk(v, key));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, k);
  };
  walk(data, "");
  return out;
}

export function extractStrings(file: string, content: string): SourceString[] {
  if (HTML_RE.test(file)) return extractHtmlStrings(file, content);
  if (/\.json$/i.test(file)) return extractJsonStrings(file, content);
  if (DOC_RE.test(file)) return extractMarkdownStrings(file, content);
  return [];
}

// ---------------------------------------------------------------------------
// Glossary
// ---------------------------------------------------------------------------

export interface GlossaryTerm {
  source: string;
  target: string;
  note?: string;
}

/** Glossary terms from translation_guide memory: markdown tables (source | target | note) or "a => b" lines. */
export function parseGlossary(records: RecalledMemory[]): GlossaryTerm[] {
  const terms: GlossaryTerm[] = [];
  const push = (source: string, target: string, note?: string) => {
    const s = stripInlineMarkdown(source);
    const t = stripInlineMarkdown(target);
    if (!s || !t) return;
    // "Fire / Ice" -> "Api / Es": split parallel lists into separate terms.
    const ss = s.split(/\s+\/\s+/);
    const ts = t.split(/\s+\/\s+/);
    if (ss.length > 1 && ss.length === ts.length) ss.forEach((x, i) => terms.push({ source: x, target: ts[i], ...(note ? { note } : {}) }));
    else terms.push({ source: s, target: t, ...(note ? { note } : {}) });
  };
  for (const r of records) {
    const structured = r.data.terms;
    if (Array.isArray(structured)) {
      for (const t of structured) {
        const o = t as Record<string, unknown>;
        if (typeof o?.source === "string" && typeof o?.target === "string") push(o.source, o.target, typeof o.note === "string" ? o.note : undefined);
      }
    }
    const lines = r.content.split("\n");
    lines.forEach((line, i) => {
      if (/^\s*\|/.test(line)) {
        const next = lines[i + 1] ?? "";
        const isHeader = /^[\s|:-]+$/.test(next) && next.includes("-");
        if (isHeader || /^[\s|:-]+$/.test(line)) return;
        const cells = line.split("|").slice(1, -1).map((c) => c.trim());
        if (cells.length >= 2) push(cells[0], cells[1], cells[2] || undefined);
        return;
      }
      const arrow = /^\s*[-*]?\s*(.+?)\s*(?:=>|->|→|=)\s*(.+)$/.exec(line);
      if (arrow) push(arrow[1], arrow[2]);
    });
  }
  const seen = new Set<string>();
  return terms.filter((t) => {
    const k = t.source.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive whole-word patterns for a term; "Hit Points (HP)" also matches "Hit Points". */
function termPatterns(term: GlossaryTerm): { re: RegExp; canonical: string }[] {
  const variants = [term.source];
  const paren = /^(.+?)\s*\(([^)]+)\)$/.exec(term.source);
  if (paren) variants.push(paren[1]);
  return variants.map((v) => ({ re: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(v)}(?![\\p{L}\\p{N}])`, "giu"), canonical: v }));
}

const TRANSLATION_TASK = /\btranslat(e|es|ed|ing|ion)\b|\blocali[sz](e|ed|ing|ation)\b/i;
const REVIEW_TASK = /\b(check|review|verify|audit|qa)\b/i;

export function needsTranslation(task: string, agentId: string): boolean {
  if (agentId.endsWith("_qa")) return false;
  return TRANSLATION_TASK.test(task) && !REVIEW_TASK.test(task);
}

function mdCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

export const localization: Skill = async (ctx) => {
  const files = ctx.files.filter((f) => HTML_RE.test(f) || DOC_RE.test(f) || /\.json$/i.test(f));
  const strings: SourceString[] = [];
  for (const f of files) {
    const text = await readText(ctx, f);
    if (text !== null) strings.push(...extractStrings(f, text));
  }
  const glossary = parseGlossary(await recall(ctx, { category: "translation_guide", limit: 50 }));
  const findings: Finding[] = [];
  if (!glossary.length) {
    findings.push({ severity: "medium", title: "No glossary in memory", detail: "No translation_guide memory with glossary terms was found; terminology cannot be checked." });
  }

  const work: { s: SourceString; terms: GlossaryTerm[] }[] = [];
  const termUse = new Map<string, number>();
  for (const s of strings) {
    const hits: GlossaryTerm[] = [];
    for (const term of glossary) {
      for (const { re, canonical } of termPatterns(term)) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        let matched = false;
        while ((m = re.exec(s.text))) {
          matched = true;
          const written = m[0];
          // Capitalization is part of a term ("Dragon Tear", keep capitalized).
          if (written !== canonical && written.toLowerCase() === canonical.toLowerCase() && canonical !== canonical.toLowerCase()) {
            findings.push({
              severity: "low",
              title: `Glossary term written as "${written}"`,
              detail: `The glossary spells it "${canonical}". String: "${truncate(s.text, 100)}"`,
              file: s.file,
              line: s.line,
            });
          }
        }
        if (matched) {
          hits.push(term);
          termUse.set(term.source, (termUse.get(term.source) ?? 0) + 1);
          break;
        }
      }
    }
    work.push({ s, terms: hits });
  }

  const byFile = new Map<string, number>();
  for (const s of strings) byFile.set(s.file, (byFile.get(s.file) ?? 0) + 1);
  for (const [file, n] of byFile) findings.push({ severity: "info", title: `${n} translatable string(s)`, detail: "Listed in the translation work list.", file });

  const doc = [
    "# Translation work list",
    "",
    `${strings.length} translatable string(s) in ${byFile.size} file(s). ${glossary.length} glossary term(s) checked; ${termUse.size} of them occur in the source.`,
    "",
    "| # | File | Line | Context | Source string | Glossary terms (source => target) |",
    "|---|---|---|---|---|---|",
    ...work.map(
      (w, i) =>
        `| ${i + 1} | ${mdCell(w.s.file)} | ${w.s.line} | ${mdCell(w.s.context)} | ${mdCell(truncate(w.s.text, 200))} | ${mdCell(w.terms.map((t) => `${t.source} => ${t.target}`).join("; "))} |`,
    ),
    "",
    ...(glossary.length ? ["## Glossary", "", ...glossary.map((t) => `- ${t.source} => ${t.target}${t.note ? ` (${t.note})` : ""}`), ""] : []),
  ].join("\n");
  const artifacts: { path: string; description: string }[] = [];
  const notes: string[] = [];
  if (strings.length) recordWrite(await writeOutput(ctx, "translation-worklist.md", doc), "Translatable strings with the glossary terms each must use", artifacts, notes, "translation-worklist.md");

  const translate = needsTranslation(ctx.task, ctx.agent.id);
  return makeOutput({
    summary: [
      `Found ${strings.length} translatable string(s) in ${byFile.size} of ${files.length} file(s); ${termUse.size} glossary term(s) occur in them.`,
      translate ? "No text was translated." : "",
      ...notes,
    ]
      .filter(Boolean)
      .join(" "),
    findings,
    artifacts,
    confidence: strings.length ? (translate ? 0.35 : 0.55) : 0.2,
    ...(translate ? { limitation: "Translation needs Claude; offline mode produced the string inventory and glossary check only" } : {}),
  });
};

// ---------------------------------------------------------------------------
// seo
// ---------------------------------------------------------------------------

function tagLine(html: string, re: RegExp): number | undefined {
  const m = re.exec(html);
  return m ? lineAt(html, m.index) : undefined;
}

export const seo: Skill = async (ctx) => {
  const files = ctx.files.filter((f) => HTML_RE.test(f));
  const findings: Finding[] = [];
  const multilingual = /\b(locali[sz]|translat|indonesian|language|hreflang|i18n)/i.test(ctx.task);
  let checked = 0;
  for (const file of files) {
    const html = await readText(ctx, file);
    if (html === null) continue;
    checked++;
    const htmlTag = /<html\b[^>]*>/i.exec(html);
    if (!htmlTag || !/\blang\s*=\s*["'][^"']+["']/i.test(htmlTag[0])) {
      findings.push({ severity: "medium", title: "Missing lang attribute", detail: "<html> has no lang attribute; search engines and screen readers must guess the language.", file, line: htmlTag ? lineAt(html, htmlTag.index) : 1 });
    }
    const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const titleText = title ? decodeEntities(title[1]).replace(/\s+/g, " ").trim() : "";
    if (!titleText) findings.push({ severity: "high", title: "Missing <title>", detail: "The page has no title; it is the main text shown in search results.", file, line: title ? lineAt(html, title.index) : 1 });
    else if (titleText.length > 60 || titleText.length < 10) {
      findings.push({ severity: "low", title: "Title length", detail: `Title is ${titleText.length} characters ("${truncate(titleText, 80)}"); 10 to 60 is typical.`, file, line: lineAt(html, title!.index) });
    }
    const desc = /<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*>/i.exec(html);
    const descText = desc ? (/\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(desc[0]) ?? [])[1] ?? "" : "";
    if (!desc || !descText.trim()) findings.push({ severity: "medium", title: "Missing meta description", detail: "No <meta name=\"description\">; search engines will pick a snippet themselves.", file, line: desc ? lineAt(html, desc.index) : 1 });
    else if (descText.length < 50 || descText.length > 160) {
      findings.push({ severity: "low", title: "Meta description length", detail: `Description is ${descText.length} characters; 50 to 160 is typical.`, file, line: lineAt(html, desc.index) });
    }
    const hreflang = html.match(/<link\b[^>]*\bhreflang\s*=/gi)?.length ?? 0;
    if (!hreflang) {
      findings.push({
        severity: multilingual ? "medium" : "info",
        title: "No hreflang links",
        detail: "No <link rel=\"alternate\" hreflang>; language versions of this page are not linked for search engines.",
        file,
        line: tagLine(html, /<\/head>/i),
      });
    }
    for (const og of ["og:title", "og:description", "og:image"]) {
      if (!new RegExp(`property\\s*=\\s*["']${og}["']`, "i").test(html)) {
        findings.push({ severity: "low", title: `Missing ${og}`, detail: `No <meta property="${og}">; link previews on social sites will be poor.`, file, line: tagLine(html, /<\/head>/i) });
      }
    }
  }
  return makeOutput({
    summary: files.length
      ? `Checked ${checked} HTML file(s) for title, description, lang, hreflang and Open Graph tags: ${findings.length} finding(s) (${countBySeverity(findings)}).`
      : "No HTML files in the workspace to check.",
    findings,
    confidence: checked ? 0.7 : 0.1,
  });
};

// ---------------------------------------------------------------------------
// brand
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(
  (
    "a an the and or but if then else of to in on at by for with from as is are was were be been being it its this that these those " +
    "you your we our they their he she his her i me my not no yes do does did so than too very can will just into about over also " +
    "all any each more most other some such only own same up down out off again once here there when where why how what which who whom " +
    "has have had having would should could may might must shall let lets get got use used using per via etc " +
    "dan yang di ke dari untuk dengan ini itu atau pada adalah juga tidak akan dalam oleh sebagai"
  ).split(/\s+/),
);

const TONE_WORDS: Record<string, string[]> = {
  friendly: ["you", "your", "welcome", "enjoy", "together", "friend", "friends", "love", "happy", "help"],
  energetic: ["new", "now", "discover", "explore", "adventure", "epic", "amazing", "exciting", "unleash", "join", "battle"],
  formal: ["shall", "hereby", "pursuant", "therefore", "accordingly", "provided", "herein", "whereas"],
  trustworthy: ["secure", "safe", "reliable", "trusted", "guarantee", "proven", "privacy", "support"],
  premium: ["exclusive", "premium", "luxury", "crafted", "finest", "rare", "legendary"],
};

export const brand: Skill = async (ctx) => {
  const files = ctx.files.filter((f) => HTML_RE.test(f) || DOC_RE.test(f) || /\.json$/i.test(f));
  const strings: SourceString[] = [];
  for (const f of files) {
    const text = await readText(ctx, f);
    if (text !== null) strings.push(...extractStrings(f, text));
  }
  const freq = new Map<string, number>();
  const ngrams = new Map<string, number>();
  const proper = new Map<string, number>();
  const toneHits = new Map<string, { count: number; quote?: SourceString; word?: string }>();
  for (const s of strings) {
    const words = s.text.toLowerCase().match(/\p{L}[\p{L}'-]*/gu) ?? [];
    for (const w of words) if (!STOPWORDS.has(w) && w.length > 2) freq.set(w, (freq.get(w) ?? 0) + 1);
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n <= words.length; i++) {
        const gram = words.slice(i, i + n);
        if (STOPWORDS.has(gram[0]) || STOPWORDS.has(gram[n - 1])) continue;
        const k = gram.join(" ");
        ngrams.set(k, (ngrams.get(k) ?? 0) + 1);
      }
    }
    for (const m of s.text.matchAll(/\b[A-Z][\p{L}]+(?:\s+[A-Z][\p{L}]+)+\b/gu)) {
      // "The Dragon Tear" at a sentence start is the term "Dragon Tear".
      const parts = m[0].split(/\s+/);
      while (parts.length && STOPWORDS.has(parts[0].toLowerCase())) parts.shift();
      const term = parts.join(" ");
      if (parts.length > 1) proper.set(term, (proper.get(term) ?? 0) + 1);
    }
    for (const [tone, list] of Object.entries(TONE_WORDS)) {
      const hit = words.find((w) => list.includes(w));
      if (!hit) continue;
      const t = toneHits.get(tone) ?? { count: 0 };
      t.count += words.filter((w) => list.includes(w)).length;
      if (!t.quote) {
        t.quote = s;
        t.word = hit;
      }
      toneHits.set(tone, t);
    }
  }
  const top = [...freq].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 15);
  const phrases = [...ngrams].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10);
  const terms = [...proper].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const tones = [...toneHits].sort((a, b) => b[1].count - a[1].count);

  const findings: Finding[] = tones.map(([tone, t]) => ({
    severity: "info" as const,
    title: `Voice trait: ${tone}`,
    detail: `${t.count} ${tone} word(s), e.g. "${t.word}" in: "${truncate(t.quote!.text, 140)}"`,
    file: t.quote!.file,
    line: t.quote!.line,
  }));
  if (terms.length) findings.push({ severity: "info", title: "Key terms that must not change", detail: terms.map(([t, n]) => `${t} (${n})`).join(", ") });

  return makeOutput({
    summary: strings.length
      ? [
          `Analysed ${strings.length} string(s) in ${files.length} file(s).`,
          `Top terms: ${top.map(([w, n]) => `${w} (${n})`).join(", ") || "none"}.`,
          `Key phrases: ${phrases.map(([p, n]) => `"${p}" (${n})`).join(", ") || "none repeated"}.`,
          `Tone: ${tones.map(([t, v]) => `${t} (${v.count})`).join(", ") || "no tone markers found"}.`,
        ].join(" ")
      : "No text content in the workspace to analyse.",
    findings,
    confidence: strings.length > 20 ? 0.55 : strings.length ? 0.4 : 0.1,
  });
};

// ---------------------------------------------------------------------------
// ux
// ---------------------------------------------------------------------------

function attrOf(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{([^}]*)\\})`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : undefined;
}

export const ux: Skill = async (ctx) => {
  const files = ctx.files.filter((f) => MARKUP_RE.test(f));
  const findings: Finding[] = [];
  let checked = 0;
  for (const file of files) {
    const raw = await readText(ctx, file);
    if (raw === null) continue;
    checked++;
    const html = blankBlocks(raw, /<(script|style)\b[\s\S]*?<\/\1>|<!--[\s\S]*?-->/gi);
    const isPage = HTML_RE.test(file);

    for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
      if (attrOf(m[0], "alt") === undefined) {
        findings.push({ severity: "medium", title: "Image without alt text", detail: `Screen readers cannot describe this image: ${truncate(m[0], 100)}`, file, line: lineAt(html, m.index!) });
      }
    }
    for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
      const inner = m[2].replace(/<img\b[^>]*\balt\s*=\s*["']([^"']+)["'][^>]*>/gi, " $1 ").replace(/<[^>]+>/g, "").trim();
      if (!inner && !attrOf(m[1], "aria-label") && !attrOf(m[1], "aria-labelledby") && !attrOf(m[1], "title")) {
        findings.push({ severity: "medium", title: "Button without a label", detail: "The button has no text or aria-label; screen readers announce only \"button\".", file, line: lineAt(html, m.index!) });
      }
    }
    const labelled = new Set([...html.matchAll(/<label\b[^>]*\b(?:for|htmlFor)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]));
    for (const m of html.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
      const tag = m[0];
      const type = (attrOf(tag, "type") ?? "").toLowerCase();
      if (["hidden", "submit", "button", "reset", "image"].includes(type)) continue;
      const id = attrOf(tag, "id");
      const before = html.slice(Math.max(0, m.index! - 300), m.index!);
      const wrapped = /<label\b[^>]*>(?![\s\S]*<\/label>)[\s\S]*$/i.test(before);
      if (!(id && labelled.has(id)) && !wrapped && !attrOf(tag, "aria-label") && !attrOf(tag, "aria-labelledby")) {
        findings.push({ severity: "medium", title: `Form field without a label`, detail: `<${m[1]}${id ? ` id="${id}"` : ""}> has no <label for>, wrapping label or aria-label.`, file, line: lineAt(html, m.index!) });
      }
    }
    const headings = [...html.matchAll(/<h([1-6])\b/gi)].map((m) => ({ level: Number(m[1]), line: lineAt(html, m.index!) }));
    let prev = 0;
    for (const h of headings) {
      if (prev && h.level > prev + 1) findings.push({ severity: "low", title: "Skipped heading level", detail: `<h${h.level}> follows <h${prev}>; headings should not skip levels.`, file, line: h.line });
      prev = h.level;
    }
    if (isPage) {
      const h1 = headings.filter((h) => h.level === 1).length;
      if (headings.length && h1 === 0) findings.push({ severity: "low", title: "No <h1>", detail: "The page has headings but no <h1>.", file, line: headings[0].line });
      if (h1 > 1) findings.push({ severity: "low", title: "Several <h1> elements", detail: `${h1} <h1> elements; one main heading is clearer.`, file, line: headings.filter((h) => h.level === 1)[1].line });
      const htmlTag = /<html\b[^>]*>/i.exec(html);
      if (!htmlTag || attrOf(htmlTag[0], "lang") === undefined) {
        findings.push({ severity: "medium", title: "Missing lang attribute", detail: "<html> has no lang attribute; screen readers may use the wrong pronunciation.", file, line: htmlTag ? lineAt(html, htmlTag.index) : 1 });
      }
    }
  }
  return makeOutput({
    summary: files.length
      ? `Checked ${checked} markup file(s) for alt text, button labels, form labels, heading order and lang: ${findings.length} finding(s) (${countBySeverity(findings)}).`
      : "No HTML or component markup files in the workspace to check.",
    findings,
    confidence: checked ? 0.65 : 0.1,
  });
};

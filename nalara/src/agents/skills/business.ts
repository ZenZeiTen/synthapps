/**
 * Offline skills for business documents: legal (contracts) and finance (figures and totals).
 */
import type { Finding } from "../../kernel/types";
import { DOC_RE, HTML_RE, countBySeverity, makeOutput, readText, truncate, type Skill } from "./context";

function docFiles(files: string[]): string[] {
  return files.filter((f) => DOC_RE.test(f) || HTML_RE.test(f) || /\.(json|csv)$/i.test(f));
}

// ---------------------------------------------------------------------------
// legal
// ---------------------------------------------------------------------------

export interface DefinedTerm {
  term: string;
  line: number;
}

const DEFINITION_WORDS = /\b(means|shall mean|refers to|has the meaning|is defined as|berarti|adalah)\b/i;

/** Defined terms: quoted capitalized terms ("Services", “Fee”) and bold terms on a definition line. */
export function definedTerms(text: string): DefinedTerm[] {
  const out = new Map<string, number>();
  text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/["“]([A-Z][\p{L}\p{N}' -]{0,58}[\p{L}\p{N}])["”]/gu)) if (!out.has(m[1])) out.set(m[1], i + 1);
    if (DEFINITION_WORDS.test(line)) {
      for (const m of line.matchAll(/\*\*([A-Z][^*]{0,58}?)[.:]?\*\*/g)) if (!out.has(m[1])) out.set(m[1], i + 1);
    }
  });
  return [...out].map(([term, line]) => ({ term, line }));
}

export interface Clause {
  number: string;
  heading: string;
  line: number;
}

export function numberedClauses(text: string): Clause[] {
  const out: Clause[] = [];
  text.split("\n").forEach((line, i) => {
    const m = /^\s*(?:#{1,6}\s*)?(?:\*\*)?(?:(?:Clause|Section|Article|Pasal)\s+)?(\d+(?:\.\d+)*)[.)]?(?:\*\*)?\s+(?:\*\*)?([A-Z\p{Lu}][^\n]{0,80})/u.exec(line);
    if (m) out.push({ number: m[1], heading: m[2].replace(/\*\*/g, "").trim(), line: i + 1 });
  });
  return out;
}

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December|Januari|Februari|Maret|Mei|Juni|Juli|Agustus|Oktober|Desember";
const DATE_RES = [
  /\b\d{4}-\d{2}-\d{2}\b/g,
  new RegExp(`\\b\\d{1,2}\\s+(?:${MONTHS})\\s+\\d{4}\\b`, "gi"),
  new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2},\\s*\\d{4}\\b`, "gi"),
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
];

export function findDates(text: string): { date: string; line: number }[] {
  const out: { date: string; line: number }[] = [];
  text.split("\n").forEach((line, i) => {
    for (const re of DATE_RES) for (const m of line.matchAll(re)) out.push({ date: m[0], line: i + 1 });
  });
  return out;
}

const KEY_CLAUSES: { name: string; re: RegExp; severity: Finding["severity"] }[] = [
  { name: "payment", re: /\b(payment|fees?|invoice|price|pembayaran|biaya)\b/i, severity: "medium" },
  { name: "liability", re: /\b(liabilit(y|ies)|indemnif\w*|tanggung jawab|ganti rugi)\b/i, severity: "medium" },
  { name: "termination", re: /\b(terminat\w*|pengakhiran|pemutusan)\b/i, severity: "medium" },
  { name: "confidentiality", re: /\b(confidential\w*|kerahasiaan|non-disclosure)\b/i, severity: "low" },
  { name: "governing law", re: /\b(governing law|jurisdiction|hukum yang berlaku|yurisdiksi)\b/i, severity: "low" },
];

export const NOT_LEGAL_ADVICE = "This is an automated reading, not legal advice.";

/**
 * Contract-like: names an agreement and its parties, and is laid out in numbered clauses.
 * The clause test keeps READMEs and design docs that merely mention a contract out of the clause checks.
 */
export function looksLikeContract(text: string): boolean {
  const namesAgreement = /\b(agreement|contract|terms of service|perjanjian|kontrak)\b/i.test(text);
  const namesParties = /\b(part(y|ies)|client|contractor|supplier|customer|licensee|licensor|pihak)\b/i.test(text);
  const numberedClauses = text.match(/^\s*(?:#{1,6}\s*)?(?:(?:clause|article|pasal)\s+)?\d+(?:\.\d+)*[.)]?\s+\S/gim) ?? [];
  return namesAgreement && namesParties && numberedClauses.length >= 3;
}

export const legal: Skill = async (ctx) => {
  const files = docFiles(ctx.files);
  const findings: Finding[] = [];
  const summaries: string[] = [];
  let read = 0;
  const skipped: string[] = [];
  for (const file of files) {
    const text = await readText(ctx, file);
    if (text === null) continue;
    if (!looksLikeContract(text)) {
      skipped.push(file);
      continue;
    }
    read++;
    const terms = definedTerms(text);
    const clauses = numberedClauses(text);
    const dates = findDates(text);
    const lines = text.split("\n");

    for (const t of terms) {
      const uses = text.split(t.term).length - 1;
      findings.push({ severity: "info", title: `Defined term "${t.term}"`, detail: `Defined here; used ${uses - 1} more time(s).`, file, line: t.line });
      if (uses <= 1) findings.push({ severity: "low", title: `Defined term "${t.term}" is never used`, detail: "A term that is defined but never used again may point to a missing or renamed clause.", file, line: t.line });
    }

    // Top-level numbering gaps: 1, 2, 4 -> clause 3 is missing.
    const top = [...new Set(clauses.filter((c) => !c.number.includes(".")).map((c) => Number(c.number)))];
    for (let i = 1; i < top.length; i++) {
      if (top[i] > top[i - 1] + 1) {
        const at = clauses.find((c) => Number(c.number) === top[i]);
        findings.push({ severity: "medium", title: `Clause numbering skips from ${top[i - 1]} to ${top[i]}`, detail: "A clause may be missing or cross-references may point to the wrong number.", file, line: at?.line });
      }
    }

    const present: string[] = [];
    for (const k of KEY_CLAUSES) {
      const at = lines.findIndex((l) => k.re.test(l));
      if (at >= 0) {
        present.push(k.name);
        findings.push({ severity: "info", title: `${k.name[0].toUpperCase()}${k.name.slice(1)} clause present`, detail: truncate(lines[at], 140), file, line: at + 1 });
      } else {
        findings.push({ severity: k.severity, title: `No ${k.name} clause found`, detail: `Nothing in the document mentions ${k.name}; check whether it is missing or in another document.`, file });
      }
    }
    if (dates.length) findings.push({ severity: "info", title: `${dates.length} date(s)`, detail: dates.slice(0, 20).map((d) => `${d.date} (line ${d.line})`).join(", "), file, line: dates[0].line });
    summaries.push(`${file}: ${terms.length} defined term(s), ${clauses.length} numbered clause(s), ${dates.length} date(s); key clauses present: ${present.join(", ") || "none"}`);
  }
  findings.push({ severity: "info", title: "Not legal advice", detail: NOT_LEGAL_ADVICE });
  return makeOutput({
    summary: [
      read ? `Read ${read} contract(s). ${summaries.join(". ")}.` : "No contract-like documents in the workspace to read.",
      skipped.length ? `${skipped.length} other document(s) do not look like contracts and were not checked.` : "",
      NOT_LEGAL_ADVICE,
    ]
      .filter(Boolean)
      .join(" "),
    findings,
    confidence: read ? 0.5 : 0.1,
  });
};

// ---------------------------------------------------------------------------
// finance
// ---------------------------------------------------------------------------

export interface Amount {
  raw: string;
  currency: string;
  value: number;
  line: number;
}

const CURRENCY = String.raw`(?:US\$|\$|€|£|¥|Rp\.?|IDR|USD|EUR|GBP|SGD|JPY)`;
const NUMBER = String.raw`\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const AMOUNT_RE = new RegExp(String.raw`(${CURRENCY})\s?(${NUMBER})(?!\d)|(?<![\w.,])(${NUMBER})\s?(${CURRENCY})(?![A-Za-z])`, "g");

function normalizeCurrency(c: string): string {
  const u = c.toUpperCase().replace(/\.$/, "");
  return u === "RP" ? "IDR" : u === "US$" || u === "$" ? "USD" : u === "€" ? "EUR" : u === "£" ? "GBP" : u === "¥" ? "JPY" : u;
}

/** Parses "1,234.50", "1.234,50" and "Rp 1.500.000" without rounding. */
export function parseNumber(raw: string, currency: string): number {
  const s = raw.replace(/\s/g, "");
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    normalized = lastDot > lastComma ? s.replace(/,/g, "") : s.replace(/\./g, "").replace(",", ".");
  } else if (lastComma >= 0) {
    normalized = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot >= 0) {
    const thousands = /^\d{1,3}(\.\d{3})+$/.test(s) && (s.split(".").length > 2 || currency === "IDR");
    normalized = thousands ? s.replace(/\./g, "") : s;
  } else normalized = s;
  return Number(normalized);
}

export function findAmounts(text: string): Amount[] {
  const out: Amount[] = [];
  text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(AMOUNT_RE)) {
      const currency = normalizeCurrency(m[1] ?? m[4] ?? "");
      const raw = m[2] ?? m[3] ?? "";
      const value = parseNumber(raw, currency);
      if (Number.isFinite(value)) out.push({ raw: m[0].trim(), currency, value, line: i + 1 });
    }
  });
  return out;
}

/** Sums in integer hundredths so 0.1 + 0.2 style float error never becomes a false mismatch. */
function cents(v: number): number {
  return Math.round(v * 100);
}

export const finance: Skill = async (ctx) => {
  const files = docFiles(ctx.files);
  const findings: Finding[] = [];
  let total = 0;
  let checked = 0;
  const byCurrency = new Map<string, number>();
  for (const file of files) {
    const text = await readText(ctx, file);
    if (text === null) continue;
    const lines = text.split("\n");
    const amounts = findAmounts(text);
    total += amounts.length;
    for (const a of amounts) byCurrency.set(a.currency, (byCurrency.get(a.currency) ?? 0) + 1);
    if (amounts.length) {
      findings.push({ severity: "info", title: `${amounts.length} monetary amount(s)`, detail: amounts.slice(0, 30).map((a) => `${a.raw} (line ${a.line})`).join(", "), file, line: amounts[0].line });
    }

    // Items since the last heading, blank line or total; a total line should equal their sum.
    let items: Amount[] = [];
    lines.forEach((line, i) => {
      if (!line.trim() || /^\s*#/.test(line)) {
        items = [];
        return;
      }
      const onLine = amounts.filter((a) => a.line === i + 1);
      if (!onLine.length) return;
      const last = onLine[onLine.length - 1];
      if (/\b(sub-?total|total|jumlah|grand total|sum)\b/i.test(line)) {
        const sameCurrency = items.every((it) => it.currency === last.currency);
        if (items.length >= 2 && sameCurrency) {
          checked++;
          const sum = items.reduce((n, it) => n + cents(it.value), 0);
          if (sum !== cents(last.value)) {
            findings.push({
              severity: "high",
              title: "Total does not match its items",
              detail: `Stated ${last.raw}; the ${items.length} amount(s) above it (lines ${items.map((it) => it.line).join(", ")}) add up to ${(sum / 100).toFixed(2)} ${last.currency}.`,
              file,
              line: i + 1,
            });
          }
        }
        items = [last];
      } else items.push(last);
    });
  }
  return makeOutput({
    summary: `Found ${total} monetary amount(s) (${[...byCurrency].map(([c, n]) => `${n} ${c}`).join(", ") || "none"}) in ${files.length} file(s); checked ${checked} total(s): ${findings.filter((f) => f.severity === "high").length} mismatch(es). Figures are reported exactly as written. Findings: ${countBySeverity(findings)}.`,
    findings,
    confidence: total ? 0.55 : 0.15,
  });
};

/**
 * Shared plumbing for offline agent skills.
 *
 * Skills never touch the filesystem, memory or index directly: every read and write goes through
 * `ctx.callTool`, which the orchestrator binds to the instance principal. The tool gateway therefore
 * applies scope, policy, budget and audit to offline agents exactly as it does to Claude agents.
 */
import { matchAny } from "../../kernel/glob";
import type { AgentDefinition, AgentOutput, Finding, MemoryCategory, SearchHit, ToolResult, Workspace } from "../../kernel/types";

export interface SkillContext {
  agent: AgentDefinition;
  task: string;
  files: string[];
  workspace?: Workspace;
  callTool: (name: string, input: Record<string, unknown>) => Promise<ToolResult>;
  signal?: AbortSignal;
}

export type Skill = (ctx: SkillContext) => Promise<AgentOutput>;

export const SEVERITY_ORDER: Finding["severity"][] = ["critical", "high", "medium", "low", "info"];

export function severityRank(s: Finding["severity"]): number {
  const i = SEVERITY_ORDER.indexOf(s);
  return i < 0 ? SEVERITY_ORDER.length : i;
}

// ---------------------------------------------------------------------------
// Tool access
// ---------------------------------------------------------------------------

/** Whether the agent's definition lists the tool. The gateway enforces scope; this only avoids calls that must be denied. */
export function canUse(ctx: SkillContext, tool: string): boolean {
  return matchAny(tool, ctx.agent.tools, { dots: true });
}

function checkAborted(ctx: SkillContext): void {
  if (ctx.signal?.aborted) throw new Error("aborted");
}

async function call(ctx: SkillContext, name: string, input: Record<string, unknown>): Promise<ToolResult> {
  checkAborted(ctx);
  const result = await ctx.callTool(name, input);
  checkAborted(ctx);
  return result;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

const readCache = new WeakMap<SkillContext, Map<string, string | null>>();

/** File content through fs.read_file, or null when the read failed or is outside the agent's scope. */
export async function readText(ctx: SkillContext, path: string): Promise<string | null> {
  let cache = readCache.get(ctx);
  if (!cache) readCache.set(ctx, (cache = new Map()));
  if (cache.has(path)) return cache.get(path) ?? null;
  if (!canUse(ctx, "fs.read_file")) return null;
  const result = await call(ctx, "fs.read_file", { path });
  const text = result.ok ? result.content : null;
  cache.set(path, text);
  return text;
}

/** Project files: the workspace file list plus fs.list_files (when in scope). */
export async function listFiles(ctx: SkillContext, glob?: string): Promise<string[]> {
  const out = new Set(ctx.files);
  if (canUse(ctx, "fs.list_files")) {
    const result = await call(ctx, "fs.list_files", { limit: 2000, ...(glob ? { glob } : {}) });
    if (result.ok) {
      const files = asRecord(result.data)?.files;
      if (Array.isArray(files)) for (const f of files) if (typeof f === "string") out.add(f);
      else
        for (const line of result.content.split("\n")) {
          const t = line.trim();
          if (t && !t.startsWith("(") && !t.startsWith("[")) out.add(t);
        }
    }
  }
  return [...out];
}

export interface RecalledMemory {
  category: string;
  key: string;
  content: string;
  data: Record<string, unknown>;
}

export async function recall(ctx: SkillContext, query: { category?: MemoryCategory; text?: string; limit?: number }): Promise<RecalledMemory[]> {
  if (!canUse(ctx, "memory.recall")) return [];
  const input: Record<string, unknown> = { limit: query.limit ?? 20 };
  if (query.category) input.category = query.category;
  if (query.text) input.text = query.text.slice(0, 500);
  const result = await call(ctx, "memory.recall", input);
  if (!result.ok) return [];
  const records = asRecord(result.data)?.records;
  if (Array.isArray(records)) {
    return records.flatMap((r) => {
      const rec = asRecord(r);
      if (!rec || typeof rec.content !== "string") return [];
      return [{ category: String(rec.category ?? ""), key: String(rec.key ?? ""), content: rec.content, data: asRecord(rec.data) ?? {} }];
    });
  }
  // Text fallback: "[category] key: content" per line.
  return result.content.split("\n").flatMap((line) => {
    const m = /^\[([^\]]+)\]\s*([^:]+):\s*(.*)$/.exec(line);
    return m ? [{ category: m[1], key: m[2].trim(), content: m[3], data: {} }] : [];
  });
}

export async function semanticSearch(ctx: SkillContext, query: string, limit = 10): Promise<SearchHit[]> {
  if (!canUse(ctx, "search.semantic") || !query.trim()) return [];
  const result = await call(ctx, "search.semantic", { query: query.slice(0, 500), limit });
  if (!result.ok) return [];
  const hits = asRecord(result.data)?.hits;
  if (!Array.isArray(hits)) return [];
  return hits.filter((h): h is SearchHit => typeof asRecord(h)?.path === "string");
}

export type WriteResult = { written: true; path: string } | { written: false; reason: string };

/** Writes into the workspace output folder through fs.write_output. */
export async function writeOutput(ctx: SkillContext, path: string, content: string): Promise<WriteResult> {
  if (!canUse(ctx, "fs.write_output")) return { written: false, reason: `fs.write_output is not in the tool scope of ${ctx.agent.id}` };
  const result = await call(ctx, "fs.write_output", { path, content });
  if (!result.ok) return { written: false, reason: result.error ?? result.content };
  const written = asRecord(result.data)?.path;
  const fallback = ctx.workspace ? `${ctx.workspace.outputDir}/${path}` : path;
  return { written: true, path: typeof written === "string" ? written : fallback };
}

/** Appends a note about an artifact to the summary parts and the artifact list. */
export function recordWrite(
  write: WriteResult,
  description: string,
  artifacts: AgentOutput["artifacts"],
  notes: string[],
  name: string,
): void {
  if (write.written) artifacts.push({ path: write.path, description });
  else notes.push(`${name} not written: ${write.reason}`);
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export function makeOutput(o: {
  summary: string;
  findings?: Finding[];
  artifacts?: AgentOutput["artifacts"];
  confidence: number;
  limitation?: string;
}): AgentOutput {
  const findings = [...(o.findings ?? [])].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  return {
    summary: o.summary,
    findings,
    artifacts: o.artifacts ?? [],
    confidence: Math.max(0, Math.min(1, Number.isFinite(o.confidence) ? o.confidence : 0)),
    source: "offline",
    ...(o.limitation ? { limitation: o.limitation } : {}),
  };
}

export function countBySeverity(findings: Finding[]): string {
  const parts = SEVERITY_ORDER.map((s) => [s, findings.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s}`);
  return parts.length ? parts.join(", ") : "none";
}

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------

export const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|py|go|rs|java|cs|rb|php)$/i;
export const JS_RE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i;
export const HTML_RE = /\.(html?|xhtml)$/i;
export const MARKUP_RE = /\.(html?|xhtml|jsx|tsx|vue|svelte)$/i;
export const DOC_RE = /\.(md|markdown|mdx|txt|rst|adoc)$/i;

export function isCode(path: string): boolean {
  return CODE_RE.test(path) && !/\.d\.ts$/.test(path);
}

export function isTest(path: string): boolean {
  const p = path.toLowerCase();
  return /(^|\/)(tests?|__tests__|spec)\//.test(p) || /\.(test|spec)\.[a-z]+$/.test(p) || /(^|\/)test_[^/]+\.py$/.test(p) || /_test\.(go|py)$/.test(p);
}

/** "src/combat/damage.test.ts" -> "damage"; "tests/test_shop.py" -> "shop". */
export function moduleBase(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file
    .replace(/\.[^.]+$/, "")
    .replace(/\.(test|spec)$/i, "")
    .replace(/^test_/i, "")
    .replace(/_test$/i, "")
    .toLowerCase();
}

export function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** Normalizes "a/b/../c/./d" to "a/c/d". */
export function normalizePath(path: string): string {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/** 1-based line of a character index. */
export function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

export function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Blanks out comments and string literals (keeping line structure) so pattern checks only see code.
 * Template literal interpolations are blanked too; that is fine for the heuristics built on it.
 */
export function stripCode(text: string, opts: { keepStrings?: boolean } = {}): string {
  let out = "";
  let i = 0;
  const n = text.length;
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? n : end;
      out += blank(text.slice(i, stop));
      i = stop;
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      out += blank(text.slice(i, stop));
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n && text[j] !== c) {
        if (text[j] === "\\") j++;
        else if (c !== "`" && text[j] === "\n") break;
        j++;
      }
      const stop = Math.min(n, j + 1);
      out += opts.keepStrings ? text.slice(i, stop) : c + blank(text.slice(i + 1, stop - 1)) + (stop - 1 > i ? text[stop - 1] : "");
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * Offline skills for engineering agents: code review, architecture, QA, docs, security, implementation, devops.
 * All rule-based; every finding carries a file and, where it applies, a line.
 */
import type { Finding } from "../../kernel/types";
import {
  JS_RE,
  basename,
  canUse,
  countBySeverity,
  dirname,
  isCode,
  isTest,
  lineAt,
  listFiles,
  makeOutput,
  moduleBase,
  normalizePath,
  readText,
  recall,
  recordWrite,
  semanticSearch,
  stripCode,
  truncate,
  writeOutput,
  type RecalledMemory,
  type Skill,
  type SkillContext,
} from "./context";

const MAX_FUNCTION_LINES = 60;
/** Numbers too common in arithmetic to be "magic" (identity, halving, doubling). */
const ALLOWED_NUMBERS = new Set(["0", "1", "2"]);

// ---------------------------------------------------------------------------
// Coding standards from memory
// ---------------------------------------------------------------------------

interface Rule {
  id: string;
  text: string;
}

/** Splits recalled coding_standard records into rules; numbered list items become "rule N". */
export function parseRules(records: RecalledMemory[]): Rule[] {
  const rules: Rule[] = [];
  for (const r of records) {
    let numbered = false;
    for (const line of r.content.split("\n")) {
      const m = /^\s*(\d+)[.)]\s+(.+)$/.exec(line);
      if (m) {
        numbered = true;
        rules.push({ id: `rule ${m[1]}`, text: clean(m[2]) });
      }
    }
    if (!numbered) rules.push({ id: r.key || "standard", text: clean(r.content) });
  }
  return rules;
}

function clean(text: string): string {
  return text.replace(/[*`_]/g, "").replace(/\s+/g, " ").trim();
}

function cite(rules: Rule[], pattern: RegExp): Rule | undefined {
  return rules.find((r) => pattern.test(r.text));
}

function citation(rule: Rule | undefined): string {
  return rule ? ` Violates coding standard ${rule.id}: "${truncate(rule.text, 90)}"` : "";
}

const RULE_PATTERNS = {
  any: /\bno\s+any\b|\bany\b.*\bunknown\b|\bavoid\s+any\b/i,
  magic: /magic number|named constant/i,
  tests: /\btests?\b/i,
  console: /console|logging|logger/i,
  todo: /\bTODO\b|\bFIXME\b/i,
  catch: /catch|swallow|error handling/i,
  length: /(function|method)s?.*(long|length|lines)/i,
};

// ---------------------------------------------------------------------------
// code_review
// ---------------------------------------------------------------------------

const FUNCTION_START = [
  /\bfunction\b\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(/,
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=>/,
  /^\s*(?:(?:public|private|protected|static|async|override|readonly)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\s*$/,
];
const NOT_FUNCTIONS = new Set(["if", "for", "while", "switch", "catch", "with", "return", "function"]);

/** Functions longer than the limit: brace matching on comment- and string-free code. */
export function longFunctions(stripped: string, limit = MAX_FUNCTION_LINES): { name: string; line: number; length: number }[] {
  const lines = stripped.split("\n");
  const out: { name: string; line: number; length: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    let name: string | undefined;
    for (const re of FUNCTION_START) {
      const m = re.exec(lines[i]);
      if (m && !NOT_FUNCTIONS.has(m[1] ?? "")) {
        name = m[1] ?? "(anonymous)";
        break;
      }
    }
    if (!name) continue;
    // The body starts at the first "{" on this line or the next two.
    let depth = 0;
    let opened = false;
    let end = -1;
    for (let j = i; j < lines.length && (opened || j <= i + 2); j++) {
      for (const ch of lines[j]) {
        if (ch === "{") {
          depth++;
          opened = true;
        } else if (ch === "}" && opened) {
          depth--;
          if (depth === 0) {
            end = j;
            break;
          }
        }
      }
      if (end >= 0) break;
      // An arrow function with an expression body has no braces on its first line.
      if (!opened && j === i && /=>\s*[^{\s]/.test(lines[i])) break;
    }
    if (end < 0) continue;
    const length = end - i + 1;
    if (length > limit) out.push({ name, line: i + 1, length });
  }
  return out;
}

/** Numeric literals next to an arithmetic operator on a code line (not a named-constant declaration). */
export function magicNumbers(strippedLine: string): string[] {
  if (/^\s*(export\s+)?(const|let|var)\s+[A-Z][A-Z0-9_]*\s*(:[^=]+)?=\s*-?[\d.]+\s*;?\s*$/.test(strippedLine)) return [];
  if (/^\s*(import|export\s+\*|case\b)/.test(strippedLine)) return [];
  const found = new Set<string>();
  const re = /(?<![\w.$])(\d+(?:\.\d+)?)(?![\w.])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(strippedLine))) {
    const num = m[1];
    if (ALLOWED_NUMBERS.has(num)) continue;
    const before = strippedLine.slice(0, m.index).trimEnd();
    const after = strippedLine.slice(m.index + num.length).trimStart();
    if (/[*/%+-]$/.test(before) || /^[*/%+-](?!\+|-)/.test(after)) found.add(num);
  }
  return [...found];
}

export const codeReview: Skill = async (ctx) => {
  const findings: Finding[] = [];
  const standards = parseRules(await recall(ctx, { category: "coding_standard", limit: 50 }));
  const cited = new Set<string>();
  const add = (f: Finding, rule?: Rule) => {
    if (rule) cited.add(rule.id);
    findings.push({ ...f, detail: f.detail + citation(rule) });
  };

  const codeFiles = ctx.files.filter(isCode);
  let reviewed = 0;
  for (const file of codeFiles) {
    const text = await readText(ctx, file);
    if (text === null) continue;
    reviewed++;
    const raw = text.split("\n");
    const stripped = stripCode(text);
    const code = stripped.split("\n");
    const js = JS_RE.test(file);

    raw.forEach((line, i) => {
      const todo = /\b(TODO|FIXME|HACK|XXX)\b[:\s]*(.*)$/.exec(line);
      if (todo) {
        add(
          {
            severity: todo[1] === "TODO" ? "low" : "medium",
            title: `${todo[1]} left in code`,
            detail: `Unfinished work marker: "${truncate(todo[2] || todo[1], 100)}".`,
            file,
            line: i + 1,
          },
          cite(standards, RULE_PATTERNS.todo),
        );
      }
    });

    code.forEach((line, i) => {
      if (js && /(?::|\bas|<|,|\|)\s*any\b(?![\w$])|\bany\[\]/.test(line)) {
        add(
          { severity: "medium", title: "Use of `any`", detail: "`any` switches off type checking; use `unknown` and narrow it, or write the type.", file, line: i + 1 },
          cite(standards, RULE_PATTERNS.any),
        );
      }
      if (js && !isTest(file) && /\bconsole\.(log|debug)\s*\(/.test(line)) {
        add(
          { severity: "low", title: "console.log left in code", detail: "Debug logging in shipped code; remove it or use the project logger.", file, line: i + 1 },
          cite(standards, RULE_PATTERNS.console),
        );
      }
      const magic = magicNumbers(line);
      if (magic.length) {
        add(
          {
            severity: "medium",
            title: "Magic number in formula",
            detail: `Unnamed numeric literal(s) ${magic.join(", ")} in a calculation; move tuning values to named constants or a data table.`,
            file,
            line: i + 1,
          },
          cite(standards, RULE_PATTERNS.magic),
        );
      }
    });

    const emptyCatch = /catch\s*(\([^)]*\))?\s*\{\s*\}/g;
    let m: RegExpExecArray | null;
    while ((m = emptyCatch.exec(stripped))) {
      add(
        { severity: "medium", title: "Empty catch block", detail: "The error is swallowed silently; handle it, log it, or rethrow.", file, line: lineAt(stripped, m.index) },
        cite(standards, RULE_PATTERNS.catch),
      );
    }

    if (js) {
      for (const fn of longFunctions(stripped)) {
        add(
          {
            severity: "medium",
            title: "Function too long",
            detail: `${fn.name} is ${fn.length} lines (limit ${MAX_FUNCTION_LINES}); split it into smaller functions.`,
            file,
            line: fn.line,
          },
          cite(standards, RULE_PATTERNS.length),
        );
      }
    }
  }

  // Missing tests: a source file with no test whose base name matches.
  const sources = codeFiles.filter((f) => !isTest(f) && !/(^|\/)(index|main)\.[a-z]+$|\.config\.[a-z]+$/.test(f));
  if (sources.length) {
    const all = await listFiles(ctx);
    const testBases = new Set(all.filter(isTest).map(moduleBase));
    for (const src of sources) {
      if (testBases.has(moduleBase(src))) continue;
      add(
        {
          severity: "medium",
          title: "Missing test file",
          detail: `No test found for ${basename(src)} (expected something like ${moduleBase(src)}.test.${src.split(".").pop()}).`,
          file: src,
        },
        cite(standards, RULE_PATTERNS.tests),
      );
    }
  }

  const standardsNote = standards.length
    ? cited.size
      ? `Coding standards cited: ${[...cited].join(", ")}.`
      : "No coding standard was violated by the checks that ran."
    : "No coding_standard memory found; generic rules applied.";
  return makeOutput({
    summary: codeFiles.length
      ? `Reviewed ${reviewed} of ${codeFiles.length} code file(s): ${findings.length} finding(s) (${countBySeverity(findings)}). ${standardsNote}`
      : "No code files in the workspace to review.",
    findings,
    confidence: reviewed ? 0.6 : 0.2,
    ...(reviewed < codeFiles.length ? { limitation: `${codeFiles.length - reviewed} file(s) could not be read` } : {}),
  });
};

// ---------------------------------------------------------------------------
// architecture
// ---------------------------------------------------------------------------

const IMPORT_RES = [
  /\bimport\s+(?:type\s+)?[^'"`;]*?\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bexport\s+[^'"`;]*?\bfrom\s*["']([^"']+)["']/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
];

export function parseImports(text: string): { spec: string; line: number }[] {
  const code = stripCode(text, { keepStrings: true });
  const seen = new Map<string, number>();
  for (const re of IMPORT_RES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
      const spec = m[1];
      const line = lineAt(code, m.index + m[0].indexOf(spec));
      if (!seen.has(spec) || seen.get(spec)! > line) seen.set(spec, line);
    }
  }
  return [...seen].map(([spec, line]) => ({ spec, line })).sort((a, b) => a.line - b.line);
}

const RESOLVE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts"];

export function resolveImport(from: string, spec: string, known: Set<string>): string | undefined {
  if (!spec.startsWith(".")) return undefined;
  const base = normalizePath(`${dirname(from)}/${spec}`);
  const candidates = [base];
  const noExt = base.replace(/\.(m|c)?js$/, "");
  for (const ext of RESOLVE_EXTS) candidates.push(noExt + ext, `${base}/index${ext}`);
  return candidates.find((c) => known.has(c));
}

/** Strongly connected components with more than one file (or a self-import): import cycles. */
export function findCycles(edges: Map<string, Set<string>>): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const out: string[][] = [];
  const strong = (v: string) => {
    idx.set(v, index);
    low.set(v, index++);
    stack.push(v);
    onStack.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1 || edges.get(v)?.has(v)) out.push(comp.reverse());
    }
  };
  for (const v of edges.keys()) if (!idx.has(v)) strong(v);
  return out;
}

/** Module of a file: the directory under the nearest "src" (or the file's own directory). */
export function moduleOf(path: string): string {
  const parts = path.split("/");
  const src = parts.lastIndexOf("src");
  if (src >= 0) return parts.length - src > 2 ? parts[src + 1] : "src";
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "(root)";
}

function mermaidId(path: string): string {
  return `n_${path.replace(/[^A-Za-z0-9]/g, "_")}`;
}

export const architecture: Skill = async (ctx) => {
  const all = await listFiles(ctx);
  const known = new Set(all.filter(isCode));
  let files = ctx.files.filter((f) => isCode(f) && !isTest(f));
  if (!files.length) files = [...known].filter((f) => !isTest(f)).slice(0, 300);
  for (const f of files) known.add(f);

  const edges = new Map<string, Set<string>>();
  const importLine = new Map<string, number>();
  const external = new Map<string, number>();
  let read = 0;
  for (const file of files) {
    const text = await readText(ctx, file);
    edges.set(file, edges.get(file) ?? new Set());
    if (text === null) continue;
    read++;
    for (const imp of parseImports(text)) {
      const target = resolveImport(file, imp.spec, known);
      if (target) {
        edges.get(file)!.add(target);
        if (!edges.has(target)) edges.set(target, new Set());
        importLine.set(`${file}->${target}`, imp.line);
      } else if (!imp.spec.startsWith(".")) {
        const pkg = imp.spec.startsWith("@") ? imp.spec.split("/").slice(0, 2).join("/") : imp.spec.split("/")[0];
        external.set(pkg, (external.get(pkg) ?? 0) + 1);
      }
    }
  }

  const findings: Finding[] = [];
  const cycles = findCycles(edges);
  for (const cycle of cycles) {
    const ring = [...cycle, cycle[0]];
    findings.push({
      severity: "high",
      title: "Import cycle",
      detail: `Files import each other in a cycle: ${ring.join(" -> ")}. Break it by moving the shared part into its own module.`,
      file: cycle[0],
      line: importLine.get(`${cycle[0]}->${cycle[1] ?? cycle[0]}`),
    });
  }

  const moduleEdges = new Map<string, Map<string, number>>();
  for (const [from, targets] of edges) {
    for (const to of targets) {
      const a = moduleOf(from);
      const b = moduleOf(to);
      if (a === b) continue;
      const m = moduleEdges.get(a) ?? new Map<string, number>();
      m.set(b, (m.get(b) ?? 0) + 1);
      moduleEdges.set(a, m);
    }
  }
  const reported = new Set<string>();
  for (const [a, targets] of moduleEdges) {
    for (const b of targets.keys()) {
      if (moduleEdges.get(b)?.has(a) && !reported.has(`${b}|${a}`)) {
        reported.add(`${a}|${b}`);
        const example = [...edges].find(([f, t]) => moduleOf(f) === a && [...t].some((x) => moduleOf(x) === b));
        findings.push({
          severity: "medium",
          title: "Bidirectional module coupling",
          detail: `Modules "${a}" and "${b}" import each other (${targets.get(b)} and ${moduleEdges.get(b)!.get(a)} import(s)); one of them should depend on the other only.`,
          file: example?.[0],
        });
      }
    }
    if (targets.size > 3) {
      findings.push({
        severity: "low",
        title: "High module fan-out",
        detail: `Module "${a}" depends on ${targets.size} other modules (${[...targets.keys()].join(", ")}).`,
      });
    }
  }

  const cycleFiles = new Set(cycles.flat());
  const byModule = new Map<string, string[]>();
  for (const f of edges.keys()) byModule.set(moduleOf(f), [...(byModule.get(moduleOf(f)) ?? []), f]);
  const diagram = ["```mermaid", "graph LR"];
  for (const [mod, members] of byModule) {
    diagram.push(`  subgraph ${mermaidId(`mod_${mod}`)}["${mod.replace(/"/g, "'")}"]`);
    for (const f of members) diagram.push(`    ${mermaidId(f)}["${basename(f).replace(/"/g, "'")}"]`);
    diagram.push("  end");
  }
  for (const [from, targets] of edges) for (const to of targets) diagram.push(`  ${mermaidId(from)} --> ${mermaidId(to)}`);
  if (cycleFiles.size) {
    diagram.push("  classDef cycle stroke:#d33,stroke-width:2px");
    diagram.push(`  class ${[...cycleFiles].map(mermaidId).join(",")} cycle`);
  }
  diagram.push("```");

  const decisions = await recall(ctx, { category: "architecture_decision", limit: 20 });
  const edgeCount = [...edges.values()].reduce((n, s) => n + s.size, 0);
  const doc = [
    "# Module dependency map",
    "",
    `Generated offline from import statements in ${read} file(s). ${edgeCount} internal import(s), ${cycles.length} cycle(s).`,
    "",
    diagram.join("\n"),
    "",
    "## Modules",
    "",
    ...[...byModule].map(([mod, members]) => `- **${mod}**: ${members.length} file(s); depends on ${[...(moduleEdges.get(mod)?.keys() ?? [])].join(", ") || "no other module"}`),
    "",
    "## External packages",
    "",
    ...(external.size ? [...external].sort((a, b) => b[1] - a[1]).map(([p, n]) => `- ${p} (${n})`) : ["- none"]),
    ...(decisions.length ? ["", "## Architecture decisions to check against", "", ...decisions.map((d) => `- ${d.key}`)] : []),
    "",
  ].join("\n");

  const artifacts: { path: string; description: string }[] = [];
  const notes: string[] = [];
  recordWrite(await writeOutput(ctx, "architecture.md", doc), "Module dependency map with a Mermaid diagram", artifacts, notes, "architecture.md");

  return makeOutput({
    summary: [
      `Mapped ${edges.size} file(s) in ${byModule.size} module(s): ${edgeCount} internal import(s), ${cycles.length} import cycle(s), ${reported.size} bidirectional module pair(s).`,
      decisions.length ? `${decisions.length} architecture decision(s) in memory were listed for manual comparison.` : "",
      ...notes,
    ]
      .filter(Boolean)
      .join(" "),
    findings,
    artifacts,
    confidence: read ? 0.65 : 0.2,
  });
};

// ---------------------------------------------------------------------------
// qa
// ---------------------------------------------------------------------------

function asObj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

export const qa: Skill = async (ctx) => {
  const all = await listFiles(ctx);
  const tests = all.filter((f) => isCode(f) && isTest(f));
  let sources = ctx.files.filter((f) => isCode(f) && !isTest(f));
  if (!sources.length) sources = all.filter((f) => isCode(f) && !isTest(f));
  const testsByBase = new Map<string, string[]>();
  for (const t of tests) testsByBase.set(moduleBase(t), [...(testsByBase.get(moduleBase(t)) ?? []), t]);

  const findings: Finding[] = [];
  const mapped: string[] = [];
  for (const src of sources) {
    const match = testsByBase.get(moduleBase(src));
    if (match) mapped.push(`${src} -> ${match.join(", ")}`);
    else findings.push({ severity: "medium", title: "Untested source file", detail: `No test file matches ${basename(src)}.`, file: src });
  }

  let testStatus: string;
  let ran = false;
  if (!canUse(ctx, "proc.run_tests")) {
    testStatus = "not run (proc.run_tests is outside this agent's tool scope)";
    findings.push({ severity: "medium", title: "tests not run: proc.run_tests is outside this agent's tool scope", detail: "Test results are unknown; nothing here says the tests pass." });
  } else {
    const result = await ctx.callTool("proc.run_tests", {});
    const data = asObj(result.data);
    const exitCode = typeof data?.exitCode === "number" ? data.exitCode : undefined;
    const timedOut = data?.timedOut === true;
    const tail = result.content.split("\n").slice(-20).join("\n");
    if (exitCode === undefined && !timedOut) {
      // The call never ran the tests: denied, approval rejected or expired, or no test command.
      const reason = result.error ?? truncate(result.content, 200);
      testStatus = `not run (${reason})`;
      findings.push({ severity: "medium", title: `tests not run: ${reason}`, detail: "Test results are unknown; nothing here says the tests pass." });
    } else {
      ran = true;
      if (result.ok && exitCode === 0) {
        testStatus = "passed (exit 0)";
        findings.push({ severity: "info", title: "Test suite passed", detail: `Exit status 0. Output tail:\n${tail}` });
      } else {
        testStatus = timedOut ? "timed out" : `failed (exit ${exitCode})`;
        findings.push({ severity: "high", title: timedOut ? "Test run timed out" : `Test suite failed (exit ${exitCode})`, detail: `Output tail:\n${tail}` });
      }
    }
  }

  const untested = findings.filter((f) => f.title === "Untested source file").length;
  return makeOutput({
    summary: `Mapped ${sources.length} source file(s) to ${tests.length} test file(s): ${sources.length - untested} with a matching test, ${untested} without. Tests: ${testStatus}.`,
    findings,
    confidence: ran ? 0.75 : 0.45,
  });
};

// ---------------------------------------------------------------------------
// docs
// ---------------------------------------------------------------------------

export interface ExportedSymbol {
  name: string;
  kind: string;
  line: number;
  doc?: string;
}

const EXPORT_RE = /^\s*export\s+(?:default\s+)?(?:declare\s+)?(async\s+function\*?|function\*?|const|let|var|class|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/;

/** Exported symbols with the JSDoc or line comments directly above them. */
export function extractExports(text: string): ExportedSymbol[] {
  const lines = text.split("\n");
  const out: ExportedSymbol[] = [];
  lines.forEach((line, i) => {
    const m = EXPORT_RE.exec(line);
    if (!m) return;
    const docLines: string[] = [];
    let j = i - 1;
    if (j >= 0 && /\*\/\s*$/.test(lines[j])) {
      while (j >= 0) {
        docLines.unshift(lines[j]);
        if (/^\s*\/\*\*?/.test(lines[j])) break;
        j--;
      }
    } else {
      while (j >= 0 && /^\s*\/\//.test(lines[j])) docLines.unshift(lines[j--]);
    }
    const doc = docLines
      .map((l) => l.replace(/^\s*(\/\*\*?|\*\/|\*|\/\/)\s?/, "").replace(/\*\/\s*$/, "").trim())
      .filter(Boolean)
      .join(" ");
    out.push({ name: m[2], kind: m[1].replace(/\s+/g, " ").replace("async function", "function"), line: i + 1, ...(doc ? { doc } : {}) });
  });
  return out;
}

export const docs: Skill = async (ctx) => {
  const files = ctx.files.filter((f) => JS_RE.test(f) && !isTest(f));
  const findings: Finding[] = [];
  const sections: string[] = [];
  let symbols = 0;
  for (const file of files) {
    const text = await readText(ctx, file);
    if (text === null) continue;
    const exports = extractExports(text);
    if (!exports.length) continue;
    symbols += exports.length;
    sections.push(`## ${file}`, "");
    for (const e of exports) {
      sections.push(`### \`${e.name}\` (${e.kind})`, "", e.doc ?? "_No doc comment._", "", `Defined at ${file}:${e.line}.`, "");
      if (!e.doc) findings.push({ severity: "low", title: `Undocumented export ${e.name}`, detail: `Exported ${e.kind} ${e.name} has no doc comment.`, file, line: e.line });
    }
  }
  const artifacts: { path: string; description: string }[] = [];
  const notes: string[] = [];
  if (symbols) {
    const doc = ["# API reference", "", `Generated offline from ${files.length} source file(s); descriptions are the existing doc comments.`, "", ...sections].join("\n");
    recordWrite(await writeOutput(ctx, "docs.md", doc), "API reference from exported symbols and their comments", artifacts, notes, "docs.md");
  }
  return makeOutput({
    summary: [
      symbols ? `Documented ${symbols} exported symbol(s) in ${sections.filter((s) => s.startsWith("## ")).length} file(s); ${findings.length} lack a doc comment.` : "No exported symbols found in the workspace code files.",
      ...notes,
    ].join(" "),
    findings,
    artifacts,
    confidence: symbols ? 0.6 : 0.2,
    ...(files.length === 0 ? { limitation: "No JavaScript/TypeScript source files to document; prose documentation needs Claude" } : {}),
  });
};

// ---------------------------------------------------------------------------
// security
// ---------------------------------------------------------------------------

const SECRET_PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "private key", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { kind: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { kind: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { kind: "API key", re: /\bsk-(?:ant-|live_|test_|proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { kind: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { kind: "credential assignment", re: /\b(?:api[_-]?key|secret|token|passw(?:or)?d|pwd|client[_-]?secret|access[_-]?key)\b["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i },
  { kind: "credential in URL", re: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]{3,}@/i },
];

const UNSAFE_PATTERNS: { title: string; severity: Finding["severity"]; re: RegExp; detail: string }[] = [
  { title: "eval() call", severity: "high", re: /\beval\s*\(/, detail: "eval runs arbitrary strings as code." },
  { title: "new Function()", severity: "high", re: /\bnew\s+Function\s*\(/, detail: "new Function builds code from strings, like eval." },
  { title: "child_process use", severity: "medium", re: /\bchild_process\b|\b(?:execSync|spawnSync|execFileSync)\s*\(|\bexec\s*\(\s*[`'"a-zA-Z]/, detail: "Runs shell commands; check that no input reaches the command line unescaped." },
  { title: "innerHTML assignment", severity: "medium", re: /\.(?:innerHTML|outerHTML)\s*\+?=|dangerouslySetInnerHTML|insertAdjacentHTML\s*\(/, detail: "Writing HTML from strings allows script injection (XSS); use textContent or sanitize." },
];

const SQL_CONCAT = /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b[^;\n]*(?:["'`]\s*\+\s*[A-Za-z_$]|\$\{)/i;

export function detectSecret(line: string): string | undefined {
  return SECRET_PATTERNS.find((p) => p.re.test(line))?.kind;
}

export const security: Skill = async (ctx) => {
  const findings: Finding[] = [];
  let scanned = 0;
  const textFiles = ctx.files.filter((f) => !/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|mp[34]|wav|ogg)$/i.test(f));
  for (const file of textFiles) {
    if (/(^|\/)\.env(\.|$)/.test(file) && !/\.example$|\.sample$/.test(file)) {
      findings.push({ severity: "high", title: "Environment file in workspace", detail: "A .env file is part of the workspace; make sure it is git-ignored and not shared.", file });
    }
    const text = await readText(ctx, file);
    if (text === null) continue;
    scanned++;
    const code = isCode(file);
    const strippedLines = code ? stripCode(text, { keepStrings: true }).split("\n") : [];
    text.split("\n").forEach((line, i) => {
      const secret = detectSecret(line);
      if (secret) {
        // The value is never copied into the finding: reports are shared and logged.
        findings.push({ severity: "critical", title: `Possible secret (${secret})`, detail: `A ${secret} appears at ${file}:${line ? i + 1 : ""}; rotate it if real and load it from the environment. Value not shown.`, file, line: i + 1 });
        return;
      }
      if (!code) return;
      const codeLine = strippedLines[i] ?? "";
      for (const p of UNSAFE_PATTERNS) {
        if (p.re.test(codeLine)) findings.push({ severity: p.severity, title: p.title, detail: `${p.detail} Code: ${truncate(line, 120)}`, file, line: i + 1 });
      }
      if (SQL_CONCAT.test(codeLine)) {
        findings.push({ severity: "high", title: "SQL built by string concatenation", detail: `Use parameters instead of concatenating values into SQL (injection risk). Code: ${truncate(line, 120)}`, file, line: i + 1 });
      }
    });
  }
  return makeOutput({
    summary: `Scanned ${scanned} file(s) for secrets and unsafe code: ${findings.length} finding(s) (${countBySeverity(findings)}). Secret values are never reported, only their location.`,
    findings,
    confidence: scanned ? 0.6 : 0.2,
  });
};

// ---------------------------------------------------------------------------
// implementation
// ---------------------------------------------------------------------------

export const implementation: Skill = async (ctx) => {
  const hits = await semanticSearch(ctx, ctx.task, 10);
  const files = new Map<string, string>();
  for (const f of ctx.files.filter(isCode)) files.set(f, "in the workspace");
  for (const h of hits) if (!files.has(h.path)) files.set(h.path, h.reasons.join("; ") || `search score ${h.score.toFixed(2)}`);
  const standards = parseRules(await recall(ctx, { category: "coding_standard", limit: 50 }));
  const tests = (await listFiles(ctx)).filter(isTest);
  const testBases = new Set(tests.map(moduleBase));

  const rows = [...files].map(([path, why], i) => {
    const test = isCode(path) && !isTest(path) ? (testBases.has(moduleBase(path)) ? "update its test" : "add a test") : "";
    return `${i + 1}. \`${path}\` (${why})${test ? `; ${test}` : ""}`;
  });
  const plan = [
    "# Implementation plan",
    "",
    `Task: ${truncate(ctx.task, 300)}`,
    "",
    "Offline mode cannot write code. These are the files most likely to change, from the workspace and a semantic search:",
    "",
    ...(rows.length ? rows : ["(no candidate files found)"]),
    "",
    ...(standards.length ? ["## Coding standards to follow", "", ...standards.map((r) => `- ${r.id}: ${r.text}`), ""] : []),
    "## Done when",
    "",
    "- The change is implemented in the files above, each with a matching test.",
    "- The test suite passes (run by QA; approval required).",
    "",
  ].join("\n");
  const artifacts: { path: string; description: string }[] = [];
  const notes: string[] = [];
  recordWrite(await writeOutput(ctx, "implementation-plan.md", plan), "Implementation plan: files to change", artifacts, notes, "implementation-plan.md");
  return makeOutput({
    summary: [`Implementation plan with ${files.size} candidate file(s) to change; no code was changed.`, ...notes].join(" "),
    findings: [...files.keys()].slice(0, 20).map((path) => ({ severity: "info" as const, title: "Candidate file to change", detail: files.get(path) ?? "", file: path })),
    artifacts,
    confidence: 0.3,
    limitation: "Code changes need Claude",
  });
};

// ---------------------------------------------------------------------------
// devops
// ---------------------------------------------------------------------------

export const devops: Skill = async (ctx) => {
  const all = await listFiles(ctx);
  const findings: Finding[] = [];
  const pkgFiles = all.filter((f) => basename(f) === "package.json" && !f.includes("node_modules/")).sort((a, b) => a.split("/").length - b.split("/").length);
  const scriptsSeen: string[] = [];
  for (const pkg of pkgFiles.slice(0, 5)) {
    const text = await readText(ctx, pkg);
    if (text === null) continue;
    let json: Record<string, unknown> | undefined;
    try {
      json = asObj(JSON.parse(text));
    } catch {
      findings.push({ severity: "high", title: "package.json is not valid JSON", detail: "Builds and installs will fail.", file: pkg });
      continue;
    }
    const scripts = asObj(json?.scripts) ?? {};
    scriptsSeen.push(`${pkg}: ${Object.keys(scripts).join(", ") || "(no scripts)"}`);
    const lineOf = (key: string) => {
      const i = text.indexOf(`"${key}"`);
      return i >= 0 ? lineAt(text, i) : undefined;
    };
    if (!scripts.test) findings.push({ severity: "medium", title: "No test script", detail: "package.json has no scripts.test, so CI and proc.run_tests cannot run the tests.", file: pkg, line: lineOf("scripts") });
    if (!scripts.build && !scripts.start) findings.push({ severity: "low", title: "No build or start script", detail: "There is no one-command way to build or start the project.", file: pkg, line: lineOf("scripts") });
    if (!asObj(json?.engines)) findings.push({ severity: "low", title: "No engines field", detail: "The required Node.js version is not pinned; builds may differ between machines.", file: pkg });
    const lock = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"].some((l) => all.includes(`${dirname(pkg) ? `${dirname(pkg)}/` : ""}${l}`));
    if (!lock && (asObj(json?.dependencies) || asObj(json?.devDependencies))) {
      findings.push({ severity: "medium", title: "No lockfile", detail: "Dependencies are declared but no lockfile was found; installs are not reproducible.", file: pkg });
    }
  }
  const ci = all.filter((f) => /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$|(^|\/)\.gitlab-ci\.yml$|(^|\/)azure-pipelines\.yml$|(^|\/)Jenkinsfile$|(^|\/)\.circleci\/config\.yml$/.test(f));
  const docker = all.filter((f) => /(^|\/)(Dockerfile|Containerfile)(\.[^/]*)?$|(^|\/)(docker-)?compose\.ya?ml$/.test(f));
  if (!ci.length) findings.push({ severity: "low", title: "No CI configuration", detail: "No GitHub Actions, GitLab CI, Azure Pipelines, CircleCI or Jenkins file found; tests only run when someone remembers." });
  if (!docker.length) findings.push({ severity: "info", title: "No Dockerfile", detail: "No container definition; fine unless the project deploys as a container." });
  if (!pkgFiles.length) findings.push({ severity: "info", title: "No package.json", detail: "Not a Node.js project, or the manifest is outside the listed files." });

  return makeOutput({
    summary: [
      `Checked ${all.length} file(s): ${pkgFiles.length} package.json, ${ci.length} CI file(s), ${docker.length} container file(s).`,
      scriptsSeen.length ? `Scripts: ${scriptsSeen.join("; ")}.` : "",
      "Offline mode does not deploy.",
    ]
      .filter(Boolean)
      .join(" "),
    findings,
    confidence: all.length ? 0.6 : 0.2,
  });
};

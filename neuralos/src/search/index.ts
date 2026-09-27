/**
 * Semantic filesystem (DESIGN.md 9).
 *
 * Indexes every text file under the root with BM25 over stemmed tokens (path
 * segments, identifiers, comments and prose), expands queries through a small
 * concept lexicon so related words match ("combat" finds "battle"), and mirrors
 * the project structure into the knowledge graph: file, folder, project and
 * concept nodes plus contains / imports / references / about edges.
 */
import { promises as fsp, type Dirent } from "node:fs";
import path from "node:path";
import { fileNodeId, slugify } from "../kernel/ids";
import type {
  ConceptInfo,
  EdgeKind,
  EventBus,
  FileKind,
  KnowledgeGraph,
  SearchHit,
  SemanticIndex,
} from "../kernel/types";

export const IGNORED_DIRS: ReadonlySet<string> = new Set([".git", "node_modules", ".neuralos", "dist", "build"]);
export const MAX_FILE_BYTES = 1024 * 1024;
const BINARY_SNIFF_BYTES = 8192;

/** Weight of a concept-expanded term relative to a term the user typed. */
const EXPANSION_WEIGHT = 0.35;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
/** Extra credit when a term appears in the file's path (folder or file name). */
const PATH_BOOST = 1.5;
/** "related to X": the top hits for X are seeds; files linked to a seed are lifted to just below it. */
const RELATED_SEEDS = 3;
const RELATED_LIFT: Record<"imports" | "references", number> = { imports: 0.8, references: 0.6 };
const SNIPPET_MAX = 160;

/** Implementation extras beyond the SemanticIndex contract (used by the file watcher). */
export interface SemanticIndexImpl extends SemanticIndex {
  hasFile(relPath: string): boolean;
  kindOf(relPath: string): FileKind | undefined;
}

// ---------------------------------------------------------------------------
// File kinds
// ---------------------------------------------------------------------------

const CODE_EXT = new Set([
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt", "kts", "cs", "c", "h",
  "cc", "cpp", "hpp", "swift", "php", "lua", "gd", "gdscript", "sh", "bash", "ps1", "css", "scss", "sass", "less",
  "vue", "svelte", "sql", "scala", "dart", "ex", "exs", "hs", "ml", "zig", "shader", "glsl", "hlsl",
]);
const DOC_EXT = new Set(["md", "mdx", "markdown", "txt", "rst", "adoc", "html", "htm", "org", "tex"]);
const CONFIG_EXT = new Set(["json", "jsonc", "json5", "yaml", "yml", "toml", "ini", "cfg", "conf", "env", "properties", "lock"]);
const DATA_EXT = new Set(["csv", "tsv", "jsonl", "ndjson", "xml", "po", "pot", "xliff", "xlf", "srt", "vtt"]);
const TEST_DIRS = new Set(["test", "tests", "__tests__", "spec", "specs"]);
const JS_EXT = new Set(["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "vue", "svelte"]);

function extOf(relPath: string): string {
  const base = relPath.slice(relPath.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function detectKind(relPath: string): FileKind {
  const lower = relPath.toLowerCase();
  const segments = lower.split("/");
  const base = segments[segments.length - 1];
  const ext = extOf(lower);
  const inTestDir = segments.slice(0, -1).some((s) => TEST_DIRS.has(s));
  if (/\.(test|spec)\.[^.]+$/.test(base) || (inTestDir && CODE_EXT.has(ext))) return "test";
  if (CODE_EXT.has(ext)) return "code";
  if (DOC_EXT.has(ext) || base === "readme" || base === "license" || base === "changelog") return "doc";
  if (CONFIG_EXT.has(ext) || (base.startsWith(".") && ext === "")) return "config";
  if (DATA_EXT.has(ext)) return "data";
  return "other";
}

// ---------------------------------------------------------------------------
// Tokens and stemming
// ---------------------------------------------------------------------------

const ENGLISH_STOP = [
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "by", "for", "with", "from", "into", "as", "is", "are",
  "was", "were", "be", "been", "it", "its", "this", "that", "these", "those", "there", "then", "than", "but", "not",
  "no", "so", "if", "else", "we", "you", "i", "he", "she", "they", "our", "your", "their", "my", "me", "us", "do",
  "does", "did", "can", "will", "would", "should", "shall", "may", "all", "any", "each", "every", "some", "one",
  "has", "have", "had", "which", "what", "who", "whom", "where", "when", "how", "why", "also", "only", "just",
];
const CODE_KEYWORDS = [
  "import", "export", "const", "let", "var", "function", "return", "type", "interface", "new", "this", "true",
  "false", "null", "undefined", "number", "string", "boolean", "void", "async", "await", "class", "extends",
  "implements", "public", "private", "protected", "readonly", "static", "def", "self", "none", "elif", "pass",
  "lambda", "yield", "typeof", "instanceof", "default", "case", "break", "continue", "while", "try", "catch",
  "finally", "throw", "unknown", "record", "partial", "get", "set", "ok", "id",
];
const QUERY_CONTROL = [
  "latest", "recent", "recently", "newest", "most", "last", "new", "file", "files", "code", "source",
  "implementation", "doc", "docs", "documentation", "document", "documents", "test", "tests", "spec", "specs",
  "related", "relating", "referencing", "reference", "references", "mentioning", "mention", "mentions",
  "connected", "linked", "config", "configuration", "settings", "show", "find", "list", "give", "search", "look",
  "about", "please", "any", "modified", "changed", "edited", "updated",
];

const INDEX_STOP = new Set([...ENGLISH_STOP, ...CODE_KEYWORDS]);
const QUERY_STOP = new Set([...ENGLISH_STOP, ...QUERY_CONTROL]);

const STEM_RULES: ReadonlyArray<readonly [string, string]> = [
  ["izations", "iz"], ["ization", "iz"], ["ations", ""], ["ation", ""], ["ators", ""], ["ator", ""],
  ["izing", "iz"], ["ized", "iz"], ["izes", "iz"], ["ize", "iz"],
  ["ating", ""], ["ated", ""], ["ates", ""], ["ate", ""],
  ["ies", "y"], ["ing", ""], ["ed", ""],
];

/**
 * Deliberately tiny suffix stripper: plural s, -ing, -ed, -ation/-ate, -ize.
 * "calculations", "calculate", "calculated" -> "calcul"; "damaged" -> "damag".
 */
export function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length <= 3) return w;
  for (const [suffix, replacement] of STEM_RULES) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 3) {
      w = w.slice(0, -suffix.length) + replacement;
      // "shopping" -> "shopp" -> "shop", but keep "sell", "pass", "buzz".
      if ((suffix === "ing" || suffix === "ed") && /([^aeiouylsz])\1$/.test(w)) w = w.slice(0, -1);
      return w;
    }
  }
  if (w.endsWith("sses")) w = w.slice(0, -2);
  else if (w.endsWith("s") && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.endsWith("e") && w.length > 4) w = w.slice(0, -1);
  return w;
}

/** Splits text into raw lowercase words: camelCase, PascalCase, snake_case and kebab-case all break apart. */
export function splitWords(text: string): string[] {
  const spaced = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  const words = spaced.toLowerCase().match(/[a-z][a-z0-9]*/g) ?? [];
  return words.filter((w) => w.length >= 2);
}

function indexTokens(text: string): string[] {
  const out: string[] = [];
  for (const w of splitWords(text)) if (!INDEX_STOP.has(w)) out.push(stem(w));
  return out;
}

function pathTokens(relPath: string): string[] {
  const segments = relPath.split("/");
  const base = segments.pop() ?? "";
  const dot = base.lastIndexOf(".");
  segments.push(dot > 0 ? base.slice(0, dot) : base);
  return indexTokens(segments.join(" "));
}

/** HTML: drop markup but keep text and human-facing attribute values (title, alt, content, placeholder). */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, (tag) => {
      const values = [...tag.matchAll(/\b(?:title|alt|content|placeholder|aria-label)\s*=\s*"([^"]*)"/gi)].map((m) => m[1]);
      return ` ${values.join(" ")} `;
    });
}

// ---------------------------------------------------------------------------
// Concept lexicon
// ---------------------------------------------------------------------------

export interface ConceptDefinition {
  key: string;
  /** Display name; code concepts get " System" appended ("Combat System"). */
  name: string;
  code: boolean;
  terms: string[];
}

export const CONCEPT_LEXICON: readonly ConceptDefinition[] = [
  { key: "combat", name: "Combat", code: true, terms: ["combat", "battle", "fight", "attack", "damage", "hp", "element", "enemy", "critical", "skill"] },
  { key: "inventory", name: "Inventory", code: true, terms: ["inventory", "item", "bag", "stock", "equipment", "equip", "stack"] },
  { key: "merchant", name: "Merchant", code: true, terms: ["merchant", "shop", "vendor", "store", "trade", "buy", "sell", "price", "gold", "haggle"] },
  { key: "party", name: "Party", code: true, terms: ["party", "character", "member", "hero", "roster", "recruit"] },
  { key: "translation", name: "Localization", code: false, terms: ["translation", "translate", "localization", "localize", "i18n", "l10n", "locale", "language", "glossary", "indonesian"] },
  { key: "contract", name: "Contracts", code: false, terms: ["contract", "agreement", "clause", "terms", "payment", "invoice"] },
];

interface ConceptRuntime {
  key: string;
  name: string;
  nodeId: string;
  stems: Set<string>;
  source: "lexicon" | "directory";
}

function conceptName(def: { name: string; code: boolean }): string {
  return def.code ? `${def.name} System` : def.name;
}

const LEXICON: ConceptRuntime[] = CONCEPT_LEXICON.map((def) => {
  const name = conceptName(def);
  return { key: def.key, name, nodeId: `concept:${slugify(name)}`, stems: new Set(def.terms.map(stem)), source: "lexicon" };
});

/** Directory names too generic to name a concept after. */
const GENERIC_DIRS = new Set([
  "src", "lib", "app", "apps", "source", "sources", "utils", "util", "common", "core", "shared", "internal", "pkg",
  "cmd", "bin", "scripts", "types", "helpers", "components", "modules", "packages", "test", "tests", "__tests__",
  "spec", "specs", "docs", "doc", "design", "adr", "website", "web", "public", "static", "assets", "contracts",
  "config", "vendor", "examples", "example", "tmp",
]);

function titleCase(text: string): string {
  return text
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w, i) => {
      if (/^(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii)$/i.test(w)) return w.toUpperCase();
      if (i > 0 && /^(of|the|and|a|an|in|on|to|for)$/i.test(w)) return w.toLowerCase();
      return w[0].toUpperCase() + w.slice(1);
    })
    .join(" ");
}

// ---------------------------------------------------------------------------
// Query understanding
// ---------------------------------------------------------------------------

interface WeightedTerm {
  weight: number;
  /** What to show in reasons: the user's word, or the lexicon word for expansions. */
  surface: string;
  expandedFrom?: string;
}

interface ParsedQuery {
  terms: Map<string, WeightedTerm>;
  exactStems: string[];
  kinds?: FileKind[];
  recent: boolean;
  related?: string[];
  mentions?: string[];
  mentionText?: string;
}

function queryStems(text: string): Array<{ stem: string; surface: string }> {
  const out: Array<{ stem: string; surface: string }> = [];
  for (const w of splitWords(text)) {
    if (QUERY_STOP.has(w)) continue;
    const s = stem(w);
    if (!out.some((t) => t.stem === s)) out.push({ stem: s, surface: w });
  }
  return out;
}

export function parseQuery(query: string): ParsedQuery {
  const q = query.toLowerCase();
  const recent = /\b(latest|recent|recently|newest|most recent|last (modified|changed|edited|updated))\b/.test(q);

  const kinds = new Set<FileKind>();
  if (/\b(docs?|documentation|documents?|readme|notes|write-?ups?)\b/.test(q)) kinds.add("doc");
  if (/\b(code|source|implementation|functions?|classes|modules?)\b/.test(q)) {
    kinds.add("code");
    kinds.add("test");
  }
  if (/\b(tests?|specs?|unit tests?|test files?)\b/.test(q)) kinds.add("test");
  if (/\b(config|configuration|settings)\b/.test(q)) kinds.add("config");

  const relatedMatch = /\b(?:related to|relating to|connected to|linked to)\s+(.+)$/.exec(q);
  const mentionMatch = /\b(?:referencing|references to|reference to|mentioning|that mentions?|which mentions?)\s+(.+)$/.exec(q);

  const exact = queryStems(q);
  const terms = new Map<string, WeightedTerm>();
  for (const t of exact) terms.set(t.stem, { weight: 1, surface: t.surface });

  for (const t of exact) {
    for (const concept of LEXICON) {
      if (!concept.stems.has(t.stem)) continue;
      const def = CONCEPT_LEXICON.find((d) => d.key === concept.key);
      for (const word of def?.terms ?? []) {
        const s = stem(word);
        if (!terms.has(s)) terms.set(s, { weight: EXPANSION_WEIGHT, surface: word, expandedFrom: concept.name });
      }
    }
  }

  return {
    terms,
    exactStems: exact.map((t) => t.stem),
    kinds: kinds.size ? [...kinds] : undefined,
    recent,
    related: relatedMatch ? queryStems(relatedMatch[1]).map((t) => t.stem) : undefined,
    mentions: mentionMatch ? queryStems(mentionMatch[1]).map((t) => t.stem) : undefined,
    mentionText: mentionMatch ? mentionMatch[1].trim() : undefined,
  };
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

interface ImportRef {
  spec: string;
  lang: "js" | "py";
}

interface DocEntry {
  path: string;
  kind: FileKind;
  size: number;
  mtimeMs: number;
  lines: string[];
  tf: Map<string, number>;
  length: number;
  pathTerms: Set<string>;
  imports: ImportRef[];
  /** Path-like words in a doc ("damage.ts", "../adr/0001-x.md") that may name another file. */
  mentions: string[];
}

function extractImports(relPath: string, text: string): ImportRef[] {
  const ext = extOf(relPath);
  const out: ImportRef[] = [];
  if (JS_EXT.has(ext)) {
    const patterns = [
      /\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?["']([^"'\n]+)["']/g,
      /\bexport\s+(?:type\s+)?[\w*{}\s,$]+?\s+from\s+["']([^"'\n]+)["']/g,
      /\brequire\(\s*["']([^"'\n]+)["']\s*\)/g,
      /\bimport\(\s*["']([^"'\n]+)["']\s*\)/g,
    ];
    for (const re of patterns) {
      for (const m of text.matchAll(re)) if (m[1].startsWith(".")) out.push({ spec: m[1], lang: "js" });
    }
  } else if (ext === "py") {
    for (const m of text.matchAll(/^\s*from\s+(\.*[\w.]*)\s+import\s+([\w\s,*()]+)/gm)) {
      const module = m[1];
      if (/^\.+$/.test(module)) {
        // "from . import a, b": each name may be a sibling module.
        for (const name of m[2].replace(/[()]/g, "").split(",")) {
          const n = name.trim().split(/\s+/)[0];
          if (n && n !== "*") out.push({ spec: `${module}${n}`, lang: "py" });
        }
      } else out.push({ spec: module, lang: "py" });
    }
    for (const m of text.matchAll(/^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm)) {
      for (const module of m[1].split(",")) out.push({ spec: module.trim(), lang: "py" });
    }
  }
  const seen = new Set<string>();
  return out.filter((r) => (seen.has(r.spec) ? false : (seen.add(r.spec), true)));
}

function extractMentions(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/[\w./-]*[\w-]\.[A-Za-z][A-Za-z0-9]{0,5}\b/g)) {
    const token = m[0].replace(/^[./]+(?=[\w])/, (lead) => (lead.includes("..") ? lead : ""));
    if (token.length >= 4) found.add(token);
  }
  return [...found];
}

/** Resolves a relative mention or link like "../adr/0001.md" or "src/combat/damage.ts" against a doc's folder. */
function posixJoin(fromFile: string, spec: string): string {
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
}

export function createSemanticIndex(opts: { root: string; graph: KnowledgeGraph; bus?: EventBus }): SemanticIndexImpl {
  const root = path.resolve(opts.root);
  const graph = opts.graph;

  const docs = new Map<string, DocEntry>();
  const df = new Map<string, number>();
  const byBasename = new Map<string, Set<string>>();
  let totalLength = 0;
  let projectId: string | undefined;
  let projectName: string | undefined;
  const ensuredFolders = new Set<string>();
  let chain: Promise<unknown> = Promise.resolve();

  /** Runs mutations one at a time so a watcher update never interleaves with a full re-index. */
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  }

  // ----- path safety -------------------------------------------------------

  function normalizeRel(relPath: string): string {
    if (typeof relPath !== "string" || relPath.trim() === "") throw new Error("Path must be a non-empty string");
    const p = relPath.replace(/\\/g, "/");
    if (p.startsWith("/") || path.isAbsolute(relPath) || /^[A-Za-z]:/.test(p)) {
      throw new Error(`Path must be relative to the project root: ${relPath}`);
    }
    if (p.split("/").includes("..")) throw new Error(`Path must not contain "..": ${relPath}`);
    const norm = path.posix.normalize(p).replace(/^\.\//, "").replace(/\/$/, "");
    if (norm === "." || norm === "") throw new Error(`Path names the root, not a file: ${relPath}`);
    return norm;
  }

  async function confine(relPath: string): Promise<string> {
    const rel = normalizeRel(relPath);
    const rootReal = await fsp.realpath(root);
    const real = await fsp.realpath(path.join(rootReal, rel));
    if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
      throw new Error(`Path resolves outside the project root: ${relPath}`);
    }
    return real;
  }

  function isIgnored(rel: string): boolean {
    return rel.split("/").some((segment) => IGNORED_DIRS.has(segment));
  }

  // ----- BM25 bookkeeping --------------------------------------------------

  function addDoc(doc: DocEntry): void {
    removeDoc(doc.path);
    docs.set(doc.path, doc);
    for (const term of doc.tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
    totalLength += doc.length;
    const base = path.posix.basename(doc.path).toLowerCase();
    if (!byBasename.has(base)) byBasename.set(base, new Set());
    byBasename.get(base)!.add(doc.path);
  }

  function removeDoc(rel: string): DocEntry | undefined {
    const doc = docs.get(rel);
    if (!doc) return undefined;
    docs.delete(rel);
    for (const term of doc.tf.keys()) {
      const n = (df.get(term) ?? 1) - 1;
      if (n <= 0) df.delete(term);
      else df.set(term, n);
    }
    totalLength -= doc.length;
    const base = path.posix.basename(rel).toLowerCase();
    byBasename.get(base)?.delete(rel);
    if (byBasename.get(base)?.size === 0) byBasename.delete(base);
    return doc;
  }

  /** Reads and tokenizes one file. Returns null for missing, non-regular, oversized or binary files. */
  async function load(rel: string): Promise<DocEntry | null> {
    const abs = path.join(root, rel);
    let stat;
    try {
      stat = await fsp.lstat(abs);
    } catch {
      return null;
    }
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    let buf: Buffer;
    try {
      buf = await fsp.readFile(abs);
    } catch {
      return null;
    }
    if (buf.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return null;
    const text = buf.toString("utf8");
    const kind = detectKind(rel);
    const ext = extOf(rel);
    const body = ext === "html" || ext === "htm" ? htmlToText(text) : text;

    const tf = new Map<string, number>();
    const bodyTokens = indexTokens(body);
    for (const t of bodyTokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    const pTokens = pathTokens(rel);
    for (const t of pTokens) tf.set(t, (tf.get(t) ?? 0) + 1);

    return {
      path: rel,
      kind,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      lines: text.split(/\r?\n/),
      tf,
      length: bodyTokens.length + pTokens.length,
      pathTerms: new Set(pTokens),
      imports: extractImports(rel, text),
      mentions: kind === "doc" ? extractMentions(text) : [],
    };
  }

  // ----- graph structure ---------------------------------------------------

  async function detectProjectName(): Promise<string> {
    for (const readme of ["README.md", "readme.md", "README"]) {
      try {
        const text = await fsp.readFile(path.join(root, readme), "utf8");
        const title = /^#\s+(.+?)\s*#*\s*$/m.exec(text)?.[1];
        if (title) return title.trim();
      } catch {
        // try the next candidate
      }
    }
    try {
      const pkg = JSON.parse(await fsp.readFile(path.join(root, "package.json"), "utf8")) as { name?: unknown };
      if (typeof pkg.name === "string" && pkg.name) return titleCase(pkg.name.replace(/^@[^/]+\//, ""));
    } catch {
      // no package.json
    }
    return titleCase(path.basename(root));
  }

  async function ensureProject(): Promise<string> {
    if (!projectId) {
      projectName = await detectProjectName();
      projectId = `project:${slugify(projectName) || "project"}`;
      if (!graph.getNode(projectId)) {
        graph.upsertNode({ id: projectId, type: "project", name: projectName, props: { root } });
      }
    }
    return projectId;
  }

  /** Returns the node id that should contain an entry in `dir` ("" is the project itself). */
  function ensureFolder(dir: string): string {
    if (dir === "" || dir === ".") return projectId!;
    const id = `folder:${dir}`;
    if (ensuredFolders.has(id) && graph.getNode(id)) return id;
    if (!graph.getNode(id)) graph.upsertNode({ id, type: "folder", name: path.posix.basename(dir), props: { path: dir } });
    const parent = path.posix.dirname(dir);
    graph.link(ensureFolder(parent === "." ? "" : parent), id, "contains");
    ensuredFolders.add(id);
    return id;
  }

  function writeFileNode(doc: DocEntry): string {
    const id = fileNodeId(doc.path);
    const existing = graph.getNode(id);
    const props = { path: doc.path, kind: doc.kind, size: doc.size, mtimeMs: doc.mtimeMs, lines: doc.lines.length };
    const unchanged =
      existing &&
      existing.props.mtimeMs === props.mtimeMs &&
      existing.props.size === props.size &&
      existing.props.kind === props.kind;
    if (!unchanged) graph.upsertNode({ id, type: "file", name: path.posix.basename(doc.path), props });
    const dir = path.posix.dirname(doc.path);
    graph.link(ensureFolder(dir === "." ? "" : dir), id, "contains");
    return id;
  }

  function resolveImport(from: string, ref: ImportRef): string | undefined {
    const candidates: string[] = [];
    if (ref.lang === "js") {
      const base = posixJoin(from, ref.spec);
      if (base.startsWith("..")) return undefined;
      candidates.push(base);
      const ext = path.posix.extname(base);
      if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
        const bare = base.slice(0, -ext.length);
        candidates.push(`${bare}.ts`, `${bare}.tsx`, `${bare}.mts`, `${bare}.cts`);
      }
      for (const e of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".svelte"]) candidates.push(base + e);
      for (const e of ["ts", "tsx", "js", "jsx", "mjs"]) candidates.push(`${base}/index.${e}`);
    } else {
      const dots = /^\.*/.exec(ref.spec)![0].length;
      const modulePath = ref.spec.slice(dots).split(".").filter(Boolean).join("/");
      if (!modulePath) return undefined;
      const bases: string[] = [];
      if (dots > 0) {
        let dir = path.posix.dirname(from);
        for (let i = 1; i < dots; i++) dir = path.posix.dirname(dir);
        bases.push(dir === "." ? modulePath : `${dir}/${modulePath}`);
      } else {
        const dir = path.posix.dirname(from);
        bases.push(modulePath, `src/${modulePath}`);
        if (dir !== ".") bases.push(`${dir}/${modulePath}`);
      }
      for (const b of bases) candidates.push(`${b}.py`, `${b}/__init__.py`);
    }
    return candidates.find((c) => c !== from && docs.has(c));
  }

  function resolveMention(from: string, token: string): string[] {
    const relative = posixJoin(from, token);
    if (!relative.startsWith("..") && relative !== from && docs.has(relative)) return [relative];
    const clean = token.replace(/^(\.\.?\/)+/, "");
    if (clean !== from && docs.has(clean)) return [clean];
    const base = path.posix.basename(clean).toLowerCase();
    const candidates = [...(byBasename.get(base) ?? [])].filter(
      (p) => p !== from && (p.toLowerCase() === clean.toLowerCase() || p.toLowerCase().endsWith(`/${clean.toLowerCase()}`)),
    );
    // A bare "index.ts" that matches many files says nothing about which one.
    return candidates.length <= 2 ? candidates : [];
  }

  /** Concepts a file is about: its folder or file name names a concept, or its text is dense in concept terms. */
  function conceptsFor(doc: DocEntry): Array<{ concept: ConceptRuntime; score: number }> {
    const out: Array<{ concept: ConceptRuntime; score: number }> = [];
    const dirs = doc.path.split("/").slice(0, -1);
    const dirStems = dirs.map((d) => stem(d.toLowerCase()));
    for (const concept of LEXICON) {
      const pathHit = [...doc.pathTerms].some((t) => concept.stems.has(t));
      let occurrences = 0;
      for (const s of concept.stems) occurrences += doc.tf.get(s) ?? 0;
      const density = doc.length ? occurrences / doc.length : 0;
      const score = (pathHit ? 1 : 0) + Math.min(1, density * 10);
      // Code concepts ("Combat System") need a path signal or real density; docs about them
      // qualify the same way, so a contract full of "Party" does not become part of the Party System.
      if (pathHit || (density >= 0.06 && occurrences >= 6)) out.push({ concept, score: Number(score.toFixed(3)) });
    }
    // Code folders outside the lexicon still become concepts: src/audio/ -> "Audio System".
    if (doc.kind === "code" || doc.kind === "test") {
      for (let i = dirs.length - 1; i >= 0; i--) {
        const dir = dirs[i].toLowerCase();
        if (GENERIC_DIRS.has(dir) || !/^[a-z][a-z0-9_-]*$/.test(dir)) continue;
        if (LEXICON.some((c) => c.stems.has(dirStems[i]))) break;
        const name = `${titleCase(dir)} System`;
        out.push({
          concept: { key: dirStems[i], name, nodeId: `concept:${slugify(name)}`, stems: new Set([dirStems[i]]), source: "directory" },
          score: 1,
        });
        break;
      }
    }
    return out;
  }

  function safeLink(source: string, target: string, kind: EdgeKind, props: Record<string, unknown>): void {
    if (!graph.getNode(source) || !graph.getNode(target)) return;
    graph.link(source, target, kind, props);
  }

  /** Recomputes a file's outgoing imports / references / about edges. */
  function deriveEdges(doc: DocEntry): void {
    const id = fileNodeId(doc.path);
    for (const edge of graph.edges({ nodeId: id, direction: "out", kind: ["imports", "references", "about"] })) {
      graph.unlink(edge.source, edge.target, edge.kind);
    }
    for (const ref of doc.imports) {
      const target = resolveImport(doc.path, ref);
      if (target) safeLink(id, fileNodeId(target), "imports", { specifier: ref.spec });
    }
    for (const token of doc.mentions) {
      for (const target of resolveMention(doc.path, token)) safeLink(id, fileNodeId(target), "references", { mention: token });
    }
    for (const { concept, score } of conceptsFor(doc)) {
      if (!graph.getNode(concept.nodeId)) {
        graph.upsertNode({
          id: concept.nodeId,
          type: "concept",
          name: concept.name,
          props: { key: concept.key, source: concept.source, terms: [...concept.stems] },
        });
      }
      safeLink(id, concept.nodeId, "about", { score });
    }
  }

  /** A newly indexed file may satisfy imports or mentions in files indexed before it. */
  function linkIncoming(newPath: string): void {
    const targetId = fileNodeId(newPath);
    for (const other of docs.values()) {
      if (other.path === newPath) continue;
      const sourceId = fileNodeId(other.path);
      for (const ref of other.imports) {
        if (resolveImport(other.path, ref) === newPath) safeLink(sourceId, targetId, "imports", { specifier: ref.spec });
      }
      for (const token of other.mentions) {
        if (resolveMention(other.path, token).includes(newPath)) safeLink(sourceId, targetId, "references", { mention: token });
      }
    }
  }

  async function walk(absDir: string, relDir: string, out: string[]): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fsp.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      // Symlinks are skipped so the index never follows a link out of the root.
      if (entry.isSymbolicLink()) continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await walk(path.join(absDir, entry.name), rel, out);
      } else if (entry.isFile()) out.push(rel);
    }
  }

  function removeFromGraph(rel: string): void {
    graph.removeNode(fileNodeId(rel));
  }

  // ----- search ------------------------------------------------------------

  function bestLine(doc: DocEntry, terms: Map<string, WeightedTerm>): { line: number; text: string } {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < doc.lines.length; i++) {
      const raw = doc.lines[i];
      if (!raw.trim()) continue;
      const seen = new Set<string>();
      let score = 0;
      for (const t of indexTokens(raw)) {
        const w = terms.get(t);
        if (w && !seen.has(t)) {
          seen.add(t);
          score += w.weight;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) best = Math.max(0, doc.lines.findIndex((l) => l.trim() !== ""));
    let text = (doc.lines[best] ?? "").trim();
    if (text.length > SNIPPET_MAX) text = `${text.slice(0, SNIPPET_MAX - 1)}…`;
    return { line: best + 1, text };
  }

  function search(query: string, options: { limit?: number; kind?: FileKind | FileKind[] } = {}): SearchHit[] {
    const limit = options.limit ?? 10;
    const parsed = parseQuery(query);
    const explicitKinds = options.kind ? (Array.isArray(options.kind) ? options.kind : [options.kind]) : undefined;
    const kinds = explicitKinds ?? parsed.kinds;
    // "combat code" means implementation first; tests are a fallback unless the user asked for tests.
    const testPenalty = kinds && kinds.includes("code") && !/\btests?\b/i.test(query) && !explicitKinds?.includes("test") ? 0.6 : 1;

    const N = docs.size;
    if (N === 0) return [];
    const avgLength = totalLength / N || 1;
    const scored = new Map<string, { score: number; reasons: string[] }>();

    const candidates = [...docs.values()].filter((d) => !kinds || kinds.includes(d.kind));
    for (const doc of candidates) {
      let score = 0;
      const exactHits: string[] = [];
      const expandedHits = new Map<string, string[]>();
      const pathHits: string[] = [];
      const nameTerms = new Set(pathTokens(path.posix.basename(doc.path)));
      let nameHit = false;
      for (const [term, info] of parsed.terms) {
        const f = doc.tf.get(term);
        if (!f) continue;
        const n = df.get(term) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += (info.weight * idf * (f * (BM25_K1 + 1))) / (f + BM25_K1 * (1 - BM25_B + (BM25_B * doc.length) / avgLength));
        if (doc.pathTerms.has(term)) {
          score += info.weight * idf * PATH_BOOST;
          if (info.weight === 1) pathHits.push(info.surface);
          if (info.weight === 1 && nameTerms.has(term)) nameHit = true;
        }
        if (info.expandedFrom) {
          const list = expandedHits.get(info.expandedFrom) ?? [];
          list.push(info.surface);
          expandedHits.set(info.expandedFrom, list);
        } else exactHits.push(info.surface);
      }
      if (parsed.terms.size === 0) score = 1;
      if (score <= 0) continue;
      if (parsed.exactStems.length > 1) score *= 1 + (0.5 * exactHits.length) / parsed.exactStems.length;
      if (doc.kind === "test") score *= testPenalty;

      const reasons: string[] = [];
      if (exactHits.length) reasons.push(`matches: ${exactHits.join(", ")}`);
      for (const [concept, words] of expandedHits) reasons.push(`related to ${concept}: ${words.slice(0, 4).join(", ")}`);
      if (nameHit) reasons.push(`file name: ${path.posix.basename(doc.path)}`);
      else if (pathHits.length) reasons.push(`folder: ${path.posix.dirname(doc.path)}/`);
      if (kinds && !explicitKinds) reasons.push(`kind: ${doc.kind}`);
      scored.set(doc.path, { score, reasons });
    }

    if (parsed.mentions?.length) {
      const mentioning = [...scored.keys()].filter((p) => {
        const doc = docs.get(p)!;
        return parsed.mentions!.some((m) => (doc.tf.get(m) ?? 0) > (doc.pathTerms.has(m) ? 1 : 0));
      });
      if (mentioning.length) {
        for (const p of [...scored.keys()]) if (!mentioning.includes(p)) scored.delete(p);
        for (const p of mentioning) {
          const entry = scored.get(p)!;
          entry.score *= 1.5;
          entry.reasons.push(`mentions ${parsed.mentionText}`);
        }
      }
    }

    if (parsed.related?.length) {
      const seeds = [...scored.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, RELATED_SEEDS);
      const seedPaths = new Set(seeds.map(([p]) => p));
      const seedScores = new Map(seeds.map(([p, e]) => [p, e.score]));
      for (const [seedPath] of seeds) {
        const seedScore = seedScores.get(seedPath)!;
        const seedId = fileNodeId(seedPath);
        const seedName = path.posix.basename(seedPath);
        for (const edge of graph.edges({ nodeId: seedId, direction: "both", kind: ["imports", "references"] })) {
          const otherId = edge.source === seedId ? edge.target : edge.source;
          if (!otherId.startsWith("file:")) continue;
          const other = otherId.slice("file:".length);
          const doc = docs.get(other);
          if (!doc || seedPaths.has(other) || (kinds && !kinds.includes(doc.kind))) continue;
          const outgoing = edge.source === otherId;
          const reason =
            edge.kind === "imports"
              ? outgoing ? `imports ${seedName}` : `imported by ${seedName}`
              : outgoing ? `references ${seedName}` : `referenced by ${seedName}`;
          const entry = scored.get(other) ?? { score: 0, reasons: [] };
          const own = scored.get(other)?.score ?? 0;
          const lifted = Math.min(seedScore * 0.99, seedScore * RELATED_LIFT[edge.kind as "imports" | "references"] + own * 0.15);
          entry.score = Math.max(entry.score, lifted);
          if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
          scored.set(other, entry);
        }
      }
    }

    if (parsed.recent && scored.size > 0) {
      const mtimes = [...scored.keys()].map((p) => docs.get(p)!.mtimeMs);
      const min = Math.min(...mtimes);
      const span = Math.max(...mtimes) - min;
      for (const [p, entry] of scored) {
        const r = span > 0 ? (docs.get(p)!.mtimeMs - min) / span : 1;
        entry.score *= 1 + 0.5 * r;
        if (r >= 0.75) entry.reasons.push("recently modified");
      }
    }

    return [...scored.entries()]
      .sort((a, b) => b[1].score - a[1].score || docs.get(b[0])!.mtimeMs - docs.get(a[0])!.mtimeMs || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([p, entry]) => {
        const doc = docs.get(p)!;
        const { line, text } = bestLine(doc, parsed.terms);
        return {
          path: p,
          nodeId: fileNodeId(p),
          score: Number(entry.score.toFixed(4)),
          snippet: text,
          line,
          kind: doc.kind,
          mtimeMs: doc.mtimeMs,
          reasons: entry.reasons,
        };
      });
  }

  // ----- public API --------------------------------------------------------

  return {
    indexAll() {
      return serial(async () => {
        const started = Date.now();
        await ensureProject();
        const files: string[] = [];
        await walk(root, "", files);

        docs.clear();
        df.clear();
        byBasename.clear();
        ensuredFolders.clear();
        totalLength = 0;

        const BATCH = 32;
        for (let i = 0; i < files.length; i += BATCH) {
          const loaded = await Promise.all(files.slice(i, i + BATCH).map(load));
          for (const doc of loaded) if (doc) addDoc(doc);
        }

        // Drop graph nodes for files and folders that no longer exist (the graph may be persistent).
        for (const node of graph.findNodes({ type: "file" })) {
          if (node.id.startsWith("file:") && !docs.has(node.id.slice(5))) graph.removeNode(node.id);
        }
        const liveFolders = new Set<string>();
        for (const p of docs.keys()) {
          let dir = path.posix.dirname(p);
          while (dir !== ".") {
            liveFolders.add(`folder:${dir}`);
            dir = path.posix.dirname(dir);
          }
        }
        for (const node of graph.findNodes({ type: "folder" })) {
          if (node.id.startsWith("folder:") && !liveFolders.has(node.id)) graph.removeNode(node.id);
        }

        for (const doc of docs.values()) writeFileNode(doc);
        for (const doc of docs.values()) deriveEdges(doc);
        return { files: docs.size, ms: Date.now() - started };
      });
    },

    async indexFile(relPath: string) {
      const rel = normalizeRel(relPath);
      await serial(async () => {
        if (isIgnored(rel)) return;
        const doc = await load(rel);
        if (!doc) {
          if (docs.has(rel)) {
            removeDoc(rel);
            removeFromGraph(rel);
          }
          return;
        }
        const isNew = !docs.has(rel);
        await ensureProject();
        addDoc(doc);
        writeFileNode(doc);
        deriveEdges(doc);
        if (isNew) linkIncoming(rel);
      });
    },

    removeFile(relPath: string) {
      const rel = normalizeRel(relPath);
      removeDoc(rel);
      removeFromGraph(rel);
    },

    search,

    concepts(): ConceptInfo[] {
      return graph
        .findNodes({ type: "concept" })
        .map((node) => ({
          id: node.id,
          name: node.name,
          files: graph
            .edges({ nodeId: node.id, direction: "in", kind: "about" })
            .filter((e) => e.source.startsWith("file:"))
            .map((e) => e.source.slice("file:".length))
            .sort(),
        }))
        .filter((c) => c.files.length > 0)
        .sort((a, b) => b.files.length - a.files.length || a.name.localeCompare(b.name));
    },

    fileCount() {
      return docs.size;
    },

    async readFile(relPath: string) {
      const abs = await confine(relPath);
      return fsp.readFile(abs, "utf8");
    },

    hasFile(relPath: string) {
      try {
        return docs.has(normalizeRel(relPath));
      } catch {
        return false;
      }
    },

    kindOf(relPath: string) {
      try {
        return docs.get(normalizeRel(relPath))?.kind;
      } catch {
        return undefined;
      }
    },
  };
}

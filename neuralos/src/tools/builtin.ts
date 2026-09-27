/**
 * Built-in tools (SAFETY.md section 4). Every path from a model is confined to the root (realpath of the
 * nearest existing ancestor, so symlinks cannot escape), and process tools only ever run a command string
 * that came from configuration, never from model input.
 */
import { execFile, spawn } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { matchGlob } from "../kernel/glob";
import type {
  ActionJournal,
  FileKind,
  JsonSchemaObject,
  KnowledgeGraph,
  MemoryService,
  Principal,
  SemanticIndex,
  ToolContext,
  ToolDefinition,
  ToolHandler,
  ToolRegistry,
  ToolResult,
} from "../kernel/types";
import { MEMORY_CATEGORIES } from "../kernel/types";

export interface BuiltinToolsOptions {
  registry: ToolRegistry;
  root: string;
  index: SemanticIndex;
  memory: MemoryService;
  journal: ActionJournal;
  /** Root-relative output folder for a workspace, e.g. ".neuralos/outputs/ws_3" or ".neuralos/outputs/adhoc". */
  outputDirFor: (workspaceId?: string) => string;
  testCommand?: string;
  deployCommand?: string;
  graph?: KnowledgeGraph;
  /** Timeout for proc.* tools. Default 10 minutes. */
  procTimeoutMs?: number;
}

const OUTPUT_CAP = 20_000;
const MAX_READ_BYTES = 2 * 1024 * 1024;
const MAX_SEARCH_FILE_BYTES = 1024 * 1024;
const MAX_WRITE_CHARS = 5 * 1024 * 1024;
const SEARCH_TIME_BUDGET_MS = 5_000;
const GIT_TIMEOUT_MS = 15_000;
const WALK_SKIP = new Set([".git", "node_modules"]);
const SECRET_ENV_RE = /KEY|TOKEN|SECRET|PASSWORD|ANTHROPIC|AWS_|GITHUB_/i;
// GIT_CONFIG_KEY_<n> matches SECRET_ENV_RE; its COUNT/VALUE siblings must go too or every git command fails.
const GIT_ENV_CONFIG_RE = /^GIT_CONFIG_(COUNT|VALUE_\d+|PARAMETERS)$/;
const FILE_KINDS: FileKind[] = ["code", "doc", "test", "config", "data", "other"];

// ---------------------------------------------------------------------------
// Helpers shared with other modules
// ---------------------------------------------------------------------------

/** A copy of the environment without anything that looks like a credential. */
export function scrubEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (value !== undefined && !SECRET_ENV_RE.test(key) && !GIT_ENV_CONFIG_RE.test(key)) out[key] = value;
  return out;
}

/** Default test command for a project root, or undefined when none is recognisable. */
export function detectTestCommand(root: string): string | undefined {
  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
      const test = pkg.scripts?.test;
      if (test && !/no test specified/.test(test)) return "npm test --silent";
    } catch {
      // Unparseable package.json: fall through.
    }
  }
  if (existsSync(join(root, "pyproject.toml"))) return "python -m pytest -q";
  return undefined;
}

export class PathError extends Error {}

function isInside(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/**
 * Resolves a model-supplied relative path under `base` (an absolute, already real path). Rejects absolute
 * paths, ".." segments and anything whose nearest existing ancestor resolves (through symlinks) outside base.
 */
export function resolveInside(base: string, relPath: string): string {
  if (typeof relPath !== "string") throw new PathError("path must be a string");
  if (relPath.includes("\0")) throw new PathError("path contains a NUL byte");
  if (isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath) || relPath.startsWith("\\")) throw new PathError(`absolute paths are not allowed: ${relPath}`);
  if (relPath.split(/[\\/]/).includes("..")) throw new PathError(`".." is not allowed in paths: ${relPath}`);
  const abs = resolve(base, relPath);
  if (!isInside(base, abs)) throw new PathError(`path escapes the root: ${relPath}`);
  let probe = abs;
  while (!exists(probe)) {
    const parent = dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const real = realpathSync(probe);
  if (!isInside(base, real)) throw new PathError(`path escapes the root through a symlink: ${relPath}`);
  return abs;
}

function exists(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function isBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0);
}

function ok(content: string, data?: unknown): ToolResult {
  return { ok: true, content, data };
}

function fail(message: string): ToolResult {
  return { ok: false, content: message, error: message };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function int(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : fallback;
  return Math.min(max, Math.max(min, n));
}

/** Rejects regexes likely to backtrack catastrophically: long patterns and nested quantifiers like (a+)+. */
function compileSafeRegex(pattern: string, ignoreCase: boolean): RegExp {
  if (pattern.length > 200) throw new Error("pattern is longer than 200 characters");
  if (/\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]/.test(pattern)) throw new Error("pattern has nested quantifiers, which can take exponential time");
  return new RegExp(pattern, ignoreCase ? "i" : "");
}

// ---------------------------------------------------------------------------
// Process runner
// ---------------------------------------------------------------------------

interface ProcResult {
  code: number | null;
  output: string;
  timedOut: boolean;
  aborted: boolean;
  durationMs: number;
}

/** Runs a configured command string through the shell in its own process group, so a timeout kills every child. */
function runCommand(command: string, cwd: string, env: Record<string, string>, timeoutMs: number, signal?: AbortSignal): Promise<ProcResult> {
  const started = Date.now();
  return new Promise((resolvePromise) => {
    let output = "";
    let timedOut = false;
    let aborted = false;
    const child = spawn(command, { shell: true, cwd, env, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const append = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > OUTPUT_CAP * 2) output = output.slice(-OUTPUT_CAP * 2);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const kill = () => {
      try {
        if (!child.pid) child.kill("SIGKILL");
        // Windows has no process groups: killing the shell would leave the real command running, so kill the tree.
        else if (process.platform === "win32") execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => undefined);
        else process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    const onAbort = () => {
      aborted = true;
      kill();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const done = (code: number | null) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolvePromise({ code, output, timedOut, aborted, durationMs: Date.now() - started });
    };
    child.on("error", (err) => {
      output += `\n${err.message}`;
      done(null);
    });
    child.on("close", (code) => done(code));
  });
}

function formatProc(command: string, r: ProcResult, timeoutMs: number): ToolResult {
  const tail = r.output.length > OUTPUT_CAP ? `[output truncated, last ${OUTPUT_CAP} characters]\n${r.output.slice(-OUTPUT_CAP)}` : r.output;
  const status = r.timedOut
    ? `timed out after ${Math.round(timeoutMs / 1000)} s (process group killed)`
    : r.aborted
      ? "aborted"
      : `exit code ${r.code}`;
  const content = `$ ${command}\n${status} in ${(r.durationMs / 1000).toFixed(1)} s\n${tail}`;
  const success = r.code === 0 && !r.timedOut && !r.aborted;
  return { ok: success, content, data: { exitCode: r.code, timedOut: r.timedOut, durationMs: r.durationMs }, error: success ? undefined : status };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

type BuiltinDef = Omit<ToolDefinition, "hash" | "disabled" | "disabledReason">;

function schema(properties: Record<string, unknown>, required: string[] = []): JsonSchemaObject {
  return { type: "object", properties, required, additionalProperties: false };
}

export function registerBuiltinTools(opts: BuiltinToolsOptions): string[] {
  const { registry, index, memory, journal, outputDirFor } = opts;
  const root = realpathSync(opts.root);
  const procTimeoutMs = opts.procTimeoutMs ?? 10 * 60_000;
  const registered: string[] = [];

  const rel = (abs: string) => toPosix(relative(root, abs)) || ".";

  function add(def: BuiltinDef, handler: ToolHandler, preview?: (input: Record<string, unknown>) => string): void {
    const guarded: ToolHandler = async (input, ctx) => {
      try {
        return await handler(input, ctx);
      } catch (err) {
        if (err instanceof PathError) return fail(`Path rejected: ${err.message}`);
        throw err;
      }
    };
    registry.register(def, guarded, preview ? { preview } : undefined);
    registered.push(def.name);
  }

  /** Absolute path of the principal's workspace output folder (created on demand), confined to the root. */
  function outputDir(principal: Principal | undefined, create: boolean): string {
    const dir = resolveInside(root, outputDirFor(principal?.workspaceId));
    if (create) mkdirSync(dir, { recursive: true });
    return dir;
  }

  // --- fs -------------------------------------------------------------------

  add(
    {
      name: "fs.list_files",
      description: "List files under a directory of the project (recursive). Optional glob filter, e.g. \"*.ts\" or \"src/**/*.md\".",
      server: "builtin:fs",
      action: "read",
      reversibility: "reversible",
      scope: "tenant",
      inputSchema: schema({
        dir: { type: "string", description: "Directory relative to the project root. Default: the root." },
        glob: { type: "string", description: "Glob on the relative path (with /) or on the file name (without /)." },
        limit: { type: "integer", minimum: 1, maximum: 2000 },
      }),
    },
    async (input) => {
      const dirRel = str(input.dir) || ".";
      const dirAbs = resolveInside(root, dirRel);
      if (!existsSync(dirAbs) || !statSync(dirAbs).isDirectory()) return fail(`Not a directory: ${dirRel}`);
      const glob = str(input.glob);
      const limit = int(input.limit, 200, 1, 2000);
      const insideData = rel(dirAbs).split("/")[0] === ".neuralos";
      const files: string[] = [];
      let truncated = false;
      const walk = (abs: string) => {
        if (truncated) return;
        let entries;
        try {
          entries = readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
        } catch {
          return;
        }
        for (const e of entries) {
          if (truncated) return;
          const childAbs = join(abs, e.name);
          if (e.isDirectory()) {
            if (WALK_SKIP.has(e.name) || (e.name === ".neuralos" && !insideData)) continue;
            walk(childAbs);
          } else if (e.isFile() || e.isSymbolicLink()) {
            const r = rel(childAbs);
            if (glob && !matchGlob(glob.includes("/") ? r : e.name, glob)) continue;
            if (files.length >= limit) {
              truncated = true;
              return;
            }
            files.push(r);
          }
        }
      };
      walk(dirAbs);
      const note = truncated ? `\n[limit of ${limit} reached]` : "";
      return ok(files.length ? files.join("\n") + note : "(no files)", { files, truncated });
    },
  );

  add(
    {
      name: "fs.read_file",
      description: "Read a text file of the project, optionally a line range. Set lineNumbers to prefix each line with its number.",
      server: "builtin:fs",
      action: "read",
      reversibility: "reversible",
      scope: "tenant",
      inputSchema: schema(
        {
          path: { type: "string" },
          startLine: { type: "integer", minimum: 1 },
          endLine: { type: "integer", minimum: 1 },
          lineNumbers: { type: "boolean" },
        },
        ["path"],
      ),
    },
    async (input) => {
      const path = String(input.path);
      const abs = resolveInside(root, path);
      if (!existsSync(abs)) return fail(`File not found: ${path}`);
      const st = statSync(abs);
      if (!st.isFile()) return fail(`Not a file: ${path}`);
      if (st.size > MAX_READ_BYTES) return fail(`File is too large to read (${st.size} bytes): ${path}`);
      const buf = readFileSync(abs);
      if (isBinary(buf)) return fail(`Binary file: ${path}`);
      const lines = buf.toString("utf8").split("\n");
      const start = int(input.startLine, 1, 1, lines.length || 1);
      const end = int(input.endLine, lines.length, start, lines.length || 1);
      const slice = lines.slice(start - 1, end);
      const text = input.lineNumbers ? slice.map((l, i) => `${String(start + i).padStart(5)}  ${l}`).join("\n") : slice.join("\n");
      return ok(text, { path: rel(abs), startLine: start, endLine: end, totalLines: lines.length });
    },
  );

  add(
    {
      name: "fs.search_text",
      description: "Search project text files with a regular expression (max 200 characters). Returns path:line: text matches.",
      server: "builtin:fs",
      action: "search",
      reversibility: "reversible",
      scope: "tenant",
      inputSchema: schema(
        {
          pattern: { type: "string", minLength: 1, maxLength: 200 },
          glob: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 500 },
          ignoreCase: { type: "boolean" },
        },
        ["pattern"],
      ),
    },
    async (input) => {
      let re: RegExp;
      try {
        re = compileSafeRegex(String(input.pattern), input.ignoreCase === true);
      } catch (err) {
        return fail(`Invalid pattern: ${err instanceof Error ? err.message : String(err)}`);
      }
      const glob = str(input.glob);
      const limit = int(input.limit, 50, 1, 500);
      const deadline = Date.now() + SEARCH_TIME_BUDGET_MS;
      const matches: { path: string; line: number; text: string }[] = [];
      let stopped: string | undefined;
      const walk = (abs: string) => {
        if (stopped) return;
        let entries;
        try {
          entries = readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
        } catch {
          return;
        }
        for (const e of entries) {
          if (stopped) return;
          const childAbs = join(abs, e.name);
          if (e.isDirectory()) {
            if (!WALK_SKIP.has(e.name) && e.name !== ".neuralos") walk(childAbs);
            continue;
          }
          if (!e.isFile()) continue;
          const r = rel(childAbs);
          if (glob && !matchGlob(glob.includes("/") ? r : e.name, glob)) continue;
          let buf: Buffer;
          try {
            if (statSync(childAbs).size > MAX_SEARCH_FILE_BYTES) continue;
            buf = readFileSync(childAbs);
          } catch {
            continue;
          }
          if (isBinary(buf)) continue;
          const lines = buf.toString("utf8").split("\n");
          for (let i = 0; i < lines.length; i++) {
            // Very long lines (minified code) are where a bad regex hurts most; only test their start.
            const line = lines[i].length > 2000 ? lines[i].slice(0, 2000) : lines[i];
            if (re.test(line)) {
              matches.push({ path: r, line: i + 1, text: line.trim().slice(0, 300) });
              if (matches.length >= limit) {
                stopped = `limit of ${limit} matches reached`;
                return;
              }
            }
          }
          if (Date.now() > deadline) {
            stopped = `search stopped after ${SEARCH_TIME_BUDGET_MS / 1000} s`;
            return;
          }
        }
      };
      walk(root);
      const body = matches.map((m) => `${m.path}:${m.line}: ${m.text}`).join("\n");
      return ok((body || "(no matches)") + (stopped ? `\n[${stopped}]` : ""), { matches, truncated: Boolean(stopped) });
    },
  );

  add(
    {
      name: "fs.write_output",
      description: "Write a file into this workspace's output folder (a scratch area). The path is relative to that folder.",
      server: "builtin:fs",
      action: "write",
      reversibility: "reversible",
      scope: "sandbox",
      inputSchema: schema({ path: { type: "string", minLength: 1 }, content: { type: "string" } }, ["path", "content"]),
    },
    async (input, ctx) => {
      const content = String(input.content);
      if (content.length > MAX_WRITE_CHARS) return fail(`Content is too large (${content.length} characters)`);
      const base = realpathSync(outputDir(ctx.principal, true));
      const abs = resolveInside(base, String(input.path));
      if (abs === base) return fail("path must name a file inside the output folder");
      if (existsSync(abs) && statSync(abs).isDirectory()) return fail(`Is a directory: ${input.path}`);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, "utf8");
      const r = rel(abs);
      return ok(`Wrote ${content.length} characters to ${r}`, { path: r, bytes: Buffer.byteLength(content) });
    },
  );

  add(
    {
      name: "fs.write_file",
      description: "Create or overwrite a project file. The previous content is journaled so the platform can undo the write.",
      server: "builtin:fs",
      action: "write",
      reversibility: "compensable",
      scope: "tenant",
      inputSchema: schema({ path: { type: "string", minLength: 1 }, content: { type: "string" } }, ["path", "content"]),
    },
    async (input, ctx) => {
      const path = String(input.path);
      const content = String(input.content);
      if (content.length > MAX_WRITE_CHARS) return fail(`Content is too large (${content.length} characters)`);
      const abs = resolveInside(root, path);
      const r = rel(abs);
      if (r === ".") return fail("path must name a file");
      if (isProtected(r)) return fail(`Refused: ${r} is protected (.git, .neuralos or the kernel config)`);
      // A symlinked file or a symlinked parent directory (even for a new file) could still point into a protected path.
      if (isProtected(rel(realTarget(abs)))) return fail(`Refused: ${r} resolves into a protected path through a symlink`);
      if (existsSync(abs) && statSync(abs).isDirectory()) return fail(`Is a directory: ${r}`);
      const before = existsSync(abs) ? readFileSync(abs, "utf8") : null;
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, "utf8");
      let entryId: string;
      try {
        entryId = journal.recordWrite({ tool: "fs.write_file", path: r, before, after: content, principal: ctx.principal }).id;
      } catch (err) {
        // Never leave an unjournaled compensable write behind.
        if (before === null) rmSync(abs, { force: true });
        else writeFileSync(abs, before, "utf8");
        return fail(`Write rolled back: journal failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return ok(`${before === null ? "Created" : "Updated"} ${r} (${content.length} characters, journal entry ${entryId})`, {
        path: r,
        created: before === null,
        journalEntryId: entryId,
      });
    },
  );

  // --- search and memory ------------------------------------------------------

  add(
    {
      name: "search.semantic",
      description: "Find project files by meaning, e.g. \"latest damage calculations\" or \"design docs referencing merchants\".",
      server: "builtin:search",
      action: "search",
      reversibility: "reversible",
      scope: "tenant",
      inputSchema: schema(
        {
          query: { type: "string", minLength: 1 },
          limit: { type: "integer", minimum: 1, maximum: 100 },
          kind: { type: "string", enum: FILE_KINDS },
        },
        ["query"],
      ),
    },
    async (input) => {
      const hits = index.search(String(input.query), { limit: int(input.limit, 10, 1, 100), kind: input.kind as FileKind | undefined });
      const body = hits.map((h) => `${h.path} (${h.kind}, score ${h.score.toFixed(2)})${h.line ? `:${h.line}` : ""} ${h.reasons.join("; ")}\n  ${h.snippet}`).join("\n");
      return ok(body || "(no results)", { hits });
    },
  );

  add(
    {
      name: "memory.recall",
      description: "Recall confirmed project memory: preferences, decisions, coding standards, guides.",
      server: "builtin:memory",
      action: "read",
      reversibility: "reversible",
      scope: "tenant",
      inputSchema: schema({
        text: { type: "string" },
        category: { type: "string", enum: [...MEMORY_CATEGORIES] },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      }),
    },
    async (input) => {
      const records = memory.recall({
        text: str(input.text),
        category: input.category as (typeof MEMORY_CATEGORIES)[number] | undefined,
        limit: int(input.limit, 10, 1, 100),
      });
      const body = records.map((r) => `[${r.category}] ${r.key}: ${r.content}`).join("\n");
      return ok(body || "(no memory)", { records });
    },
  );

  add(
    {
      name: "memory.remember",
      description: "Propose a memory record. Agent-written memory stays proposed until a human confirms it.",
      server: "builtin:memory",
      action: "write",
      reversibility: "reversible",
      scope: "tenant",
      inputSchema: schema(
        {
          category: { type: "string", enum: [...MEMORY_CATEGORIES] },
          key: { type: "string", minLength: 1, maxLength: 200 },
          content: { type: "string", minLength: 1, maxLength: 20000 },
          tags: { type: "array", items: { type: "string" }, maxItems: 20 },
        },
        ["category", "key", "content"],
      ),
    },
    async (input, ctx) => {
      // Always an agent source, whoever calls: this tool can never write active memory (frozen-weights rule).
      const source = `agent:${ctx.principal.agentId ?? "unknown"}#${ctx.principal.instanceId ?? "none"}`;
      const record = memory.remember({
        category: input.category as (typeof MEMORY_CATEGORIES)[number],
        key: String(input.key),
        content: String(input.content),
        tags: Array.isArray(input.tags) ? input.tags.map(String) : undefined,
        data: ctx.principal.workspaceId ? { workspaceId: ctx.principal.workspaceId } : undefined,
        source,
      });
      return ok(`Proposed memory ${record.id} (${record.category}/${record.key}); status ${record.status} until a human confirms it.`, { record });
    },
  );

  // --- git ------------------------------------------------------------------

  const git = (args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string; missing?: boolean }> =>
    new Promise((resolvePromise) => {
      // fsmonitor and external diff can run arbitrary commands from a repo's config; switch them off.
      const full = ["-c", "core.fsmonitor=false", "-c", "diff.external=", "--no-pager", ...args];
      execFile(
        "git",
        full,
        { cwd: root, timeout: GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, env: { ...scrubEnv(), GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" } },
        (err, stdout, stderr) => {
          const missing = (err as NodeJS.ErrnoException | null)?.code === "ENOENT";
          resolvePromise({ ok: !err, stdout: String(stdout), stderr: String(stderr || (err ? err.message : "")), missing });
        },
      );
    });

  async function gitTool(args: string[], empty: string): Promise<ToolResult> {
    const probe = await git(["rev-parse", "--is-inside-work-tree"]);
    if (probe.missing) return fail("git is not installed on this machine");
    if (!probe.ok || probe.stdout.trim() !== "true") return fail(`Not a git repository: ${root}`);
    const r = await git(args);
    if (!r.ok) return fail(`git ${args[0]} failed: ${r.stderr.trim()}`);
    return ok(r.stdout.trim() || empty, { output: r.stdout });
  }

  add(
    {
      name: "git.status",
      description: "Show the working tree status of the project repository.",
      server: "builtin:git",
      action: "read",
      reversibility: "reversible",
      scope: "tenant",
      inputSchema: schema({}),
    },
    async () => gitTool(["status", "--porcelain=v1", "--branch"], "(clean)"),
  );

  add(
    {
      name: "git.log",
      description: "Show recent commits of the project repository.",
      server: "builtin:git",
      action: "read",
      reversibility: "reversible",
      scope: "tenant",
      inputSchema: schema({ limit: { type: "integer", minimum: 1, maximum: 200 } }),
    },
    async (input) => gitTool(["log", "--no-color", `-n${int(input.limit, 20, 1, 200)}`, "--date=short", "--format=%h %ad %an %s"], "(no commits)"),
  );

  add(
    {
      name: "git.diff",
      description: "Show uncommitted changes of the project repository, optionally for one path.",
      server: "builtin:git",
      action: "read",
      reversibility: "reversible",
      scope: "tenant",
      inputSchema: schema({ path: { type: "string" } }),
    },
    async (input) => {
      const path = str(input.path);
      const args = ["diff", "--no-color", "--no-ext-diff"];
      if (path) args.push("--", rel(resolveInside(root, path)));
      return gitTool(args, "(no changes)");
    },
  );

  // --- processes ------------------------------------------------------------

  add(
    {
      name: "proc.run_tests",
      description: "Run the project's configured test command. Optional filter is passed as the NEURALOS_TEST_FILTER environment variable.",
      server: "builtin:proc",
      action: "execute",
      reversibility: "irreversible",
      scope: "tenant",
      inputSchema: schema({ filter: { type: "string", maxLength: 200 } }),
    },
    async (input, ctx: ToolContext) => {
      const command = opts.testCommand ?? detectTestCommand(root);
      if (!command) return fail("No test command configured and none detected (package.json scripts.test or pyproject.toml)");
      const env = scrubEnv();
      const filter = str(input.filter);
      if (filter) env.NEURALOS_TEST_FILTER = filter;
      return formatProc(command, await runCommand(command, root, env, procTimeoutMs, ctx.signal), procTimeoutMs);
    },
    (input) => {
      const command = opts.testCommand ?? detectTestCommand(root);
      if (!command) return "No test command is configured or detected: the call will fail without running anything.";
      const filter = str(input.filter);
      return [
        `Runs: ${command}`,
        `In: ${root}`,
        filter ? `With NEURALOS_TEST_FILTER=${filter}` : "",
        `Environment: credentials removed; stopped after ${Math.round(procTimeoutMs / 1000)} s.`,
        "This executes project code on this machine.",
      ]
        .filter(Boolean)
        .join("\n");
    },
  );

  add(
    {
      name: "proc.deploy",
      description: "Deploy the project with the configured deploy command. Without one, package the workspace outputs under .neuralos/deployments/.",
      server: "builtin:proc",
      action: "execute",
      reversibility: "irreversible",
      scope: "external",
      inputSchema: schema({}),
    },
    async (_input, ctx) => {
      if (opts.deployCommand) {
        return formatProc(opts.deployCommand, await runCommand(opts.deployCommand, root, scrubEnv(), procTimeoutMs, ctx.signal), procTimeoutMs);
      }
      const source = outputDir(ctx.principal, false);
      if (!existsSync(source)) return fail(`No deploy command configured and nothing to package: ${rel(source)} does not exist`);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const dest = resolveInside(root, `.neuralos/deployments/${stamp}`);
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(source, dest, { recursive: true, dereference: false, verbatimSymlinks: true });
      const files = countFiles(dest);
      return ok(`No deploy command configured, so the workspace outputs were packaged instead: copied ${files} file(s) from ${rel(source)} to ${rel(dest)}.`, {
        packaged: true,
        source: rel(source),
        path: rel(dest),
        files,
      });
    },
    () =>
      opts.deployCommand
        ? `Runs: ${opts.deployCommand}\nIn: ${root}\nEnvironment: credentials removed; stopped after ${Math.round(procTimeoutMs / 1000)} s.\nThis deploys outside this machine.`
        : "No deploy command is configured: copies this workspace's outputs to .neuralos/deployments/<timestamp>/. Nothing leaves this machine.",
  );

  if (opts.graph) {
    const groups = new Map<string, string[]>();
    for (const name of registered) {
      const server = registry.get(name)?.server ?? "builtin";
      groups.set(server, [...(groups.get(server) ?? []), name]);
    }
    for (const [server, names] of groups) {
      const slug = server.replace(":", "-");
      opts.graph.upsertNode({ id: `mcp:${slug}`, type: "mcp", name: slug, props: { transport: "builtin", tools: names, status: "connected" } });
    }
  }

  return registered;
}

/** Kernel config at the root: it sets the tool policy, delegation depth and data dir, so agents must never write it. */
const KERNEL_CONFIG_FILE = "neuralos.config.json";

function isProtected(relPath: string): boolean {
  if (relPath.toLowerCase() === KERNEL_CONFIG_FILE) return true;
  return relPath.split("/").some((seg) => {
    const s = seg.toLowerCase();
    return s === ".git" || s === ".neuralos";
  });
}

/** Where a path really lands: realpath of its nearest existing ancestor plus the not-yet-existing tail. */
function realTarget(abs: string): string {
  let probe = abs;
  const tail: string[] = [];
  while (!exists(probe)) {
    const parent = dirname(probe);
    if (parent === probe) break;
    tail.unshift(basename(probe));
    probe = parent;
  }
  return join(realpathSync(probe), ...tail);
}

function countFiles(dir: string): number {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? countFiles(join(dir, e.name)) : 1;
  return n;
}

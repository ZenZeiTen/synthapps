import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  ActionJournal,
  AuditLog,
  EventBus,
  JournalEntry,
  KnowledgeGraph,
  MemoryRecord,
  MemoryService,
  Principal,
  SearchHit,
  SemanticIndex,
  ToolRegistry,
} from "../src/kernel/types";
import { detectTestCommand, registerBuiltinTools, scrubEnv } from "../src/tools/builtin";
import { createToolRegistry } from "../src/tools/registry";

// --- in-test fakes -----------------------------------------------------------

const bus = { publish: (type: string, data: unknown) => ({ id: "e", seq: 1, type, ts: "", source: "t", data }) } as unknown as EventBus;
const audit: AuditLog = { append: (e) => ({ ...e, seq: 1, ts: "", prevHash: "", hash: "" }), list: () => [], verify: () => null };

function fakeMemory() {
  const records: MemoryRecord[] = [];
  const memory = {
    remember(input) {
      const source = input.source ?? "platform";
      const rec: MemoryRecord = {
        id: `mem_${records.length + 1}`,
        category: input.category,
        key: input.key,
        content: input.content,
        data: input.data ?? {},
        tags: input.tags ?? [],
        source,
        status: source.startsWith("agent:") ? "proposed" : "active",
        createdAt: "",
        updatedAt: "",
      };
      records.push(rec);
      return rec;
    },
    recall: (q) => records.filter((r) => r.status === "active" && (!q?.category || r.category === q.category)),
  } as MemoryService;
  return { memory, records };
}

function fakeJournal() {
  const entries: JournalEntry[] = [];
  const journal = {
    recordWrite(e) {
      const entry: JournalEntry = { ...e, id: `jr_${entries.length + 1}`, ts: "", undone: false };
      entries.push(entry);
      return entry;
    },
    list: () => entries,
    undo: async () => ({ restored: [], skipped: [] }),
  } as ActionJournal;
  return { journal, entries };
}

function fakeIndex() {
  const queries: { query: string; opts: unknown }[] = [];
  const hit: SearchHit = { path: "src/combat/damage.ts", nodeId: "file:src/combat/damage.ts", score: 0.9, snippet: "export function damage()", kind: "code", mtimeMs: 0, reasons: ["matches: damage"] };
  const index = {
    search(query: string, opts?: unknown) {
      queries.push({ query, opts });
      return [hit];
    },
  } as unknown as SemanticIndex;
  return { index, queries };
}

// --- setup -----------------------------------------------------------------------

const agentP: Principal = { userId: "local", agentId: "code_reviewer", instanceId: "ai_1", workspaceId: "ws_1", chain: ["user:local", "agent:code_reviewer#ai_1"], depth: 1 };
const human: Principal = { userId: "local", chain: ["user:local"], depth: 0 };

let base: string;
let root: string;
let outside: string;

function makeTools(extra: { testCommand?: string; deployCommand?: string; procTimeoutMs?: number; graph?: KnowledgeGraph } = {}) {
  const registry = createToolRegistry({ bus, audit, policy: { mode: "auto", allow: ["proc.*"] } });
  registry.setScope("ai_1", ["*"]);
  const mem = fakeMemory();
  const jr = fakeJournal();
  const idx = fakeIndex();
  const names = registerBuiltinTools({
    registry,
    root,
    index: idx.index,
    memory: mem.memory,
    journal: jr.journal,
    outputDirFor: (ws) => `.neuralos/outputs/${ws ?? "adhoc"}`,
    ...extra,
  });
  const call = (name: string, input: Record<string, unknown> = {}, principal: Principal = agentP) => registry.call(name, input, { principal });
  return { registry, call, names, ...mem, ...jr, ...idx };
}

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "neuralos-builtin-")));
  root = join(base, "project");
  outside = join(base, "outside");
  mkdirSync(join(root, "src/combat"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "node_modules/dep"), { recursive: true });
  mkdirSync(join(root, ".git"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(root, "src/combat/damage.ts"), "export function damageCalc(a: number) {\n  return a * 2;\n}\n");
  writeFileSync(join(root, "src/index.ts"), "import { damageCalc } from './combat/damage';\n");
  writeFileSync(join(root, "docs/design.md"), "# Design\nMerchants restock daily.\n");
  writeFileSync(join(root, "node_modules/dep/index.ts"), "export const damageInDep = 1;\n");
  writeFileSync(join(root, ".git/config"), "[core]\n");
  writeFileSync(join(outside, "secret.txt"), "top secret\n");
  symlinkSync(outside, join(root, "linkdir"));
  symlinkSync(join(outside, "secret.txt"), join(root, "linkfile.txt"));
  writeFileSync(join(root, "check-env.cjs"), "console.log('FOO=' + (process.env.FOO_API_KEY ?? 'unset'));\nconsole.log('PLAIN=' + process.env.NEURALOS_PLAIN_VAR);\nconsole.log('FILTER=' + process.env.NEURALOS_TEST_FILTER);\n");
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

// --- tests ----------------------------------------------------------------------------

describe("registration", () => {
  it("registers every tool with the reversibility and scope of SAFETY.md section 4", () => {
    const { registry } = makeTools();
    const shape = (name: string) => {
      const d = registry.get(name)!;
      return `${d.action}/${d.reversibility}/${d.scope}`;
    };
    for (const n of ["fs.list_files", "fs.read_file", "memory.recall", "git.status", "git.log", "git.diff"]) expect(shape(n)).toBe("read/reversible/tenant");
    for (const n of ["fs.search_text", "search.semantic"]) expect(shape(n)).toBe("search/reversible/tenant");
    expect(shape("fs.write_output")).toBe("write/reversible/sandbox");
    expect(shape("memory.remember")).toBe("write/reversible/tenant");
    expect(shape("fs.write_file")).toBe("write/compensable/tenant");
    expect(shape("proc.run_tests")).toBe("execute/irreversible/tenant");
    expect(shape("proc.deploy")).toBe("execute/irreversible/external");
    expect(registry.list()).toHaveLength(13);
  });

  it("adds builtin tool-group nodes to the graph when given one", () => {
    const nodes: { id: string; props?: Record<string, unknown> }[] = [];
    const graph = { upsertNode: (n: { id: string; props?: Record<string, unknown> }) => nodes.push(n) } as unknown as KnowledgeGraph;
    makeTools({ graph });
    expect(nodes.map((n) => n.id).sort()).toEqual(["mcp:builtin-fs", "mcp:builtin-git", "mcp:builtin-memory", "mcp:builtin-proc", "mcp:builtin-search"]);
    expect(nodes.find((n) => n.id === "mcp:builtin-git")!.props!.tools).toEqual(["git.status", "git.log", "git.diff"]);
  });
});

describe("path confinement", () => {
  it("rejects .., absolute paths and symlink escapes", async () => {
    const { call } = makeTools();
    for (const path of ["../outside/secret.txt", "src/../../outside/secret.txt", join(outside, "secret.txt"), "/etc/passwd", "linkdir/secret.txt", "linkfile.txt"]) {
      const r = await call("fs.read_file", { path });
      expect(r.ok, path).toBe(false);
      expect(r.content, path).toMatch(/Path rejected/);
      expect(r.content).not.toContain("top secret");
    }
    expect((await call("fs.list_files", { dir: "linkdir" })).ok).toBe(false);
    expect((await call("fs.list_files", { dir: ".." })).ok).toBe(false);
    expect((await call("fs.write_file", { path: "linkdir/new.txt", content: "x" }, human)).ok).toBe(false);
    expect(existsSync(join(outside, "new.txt"))).toBe(false);
    expect((await call("fs.write_output", { path: "../../../escape.txt", content: "x" })).ok).toBe(false);
    expect((await call("fs.write_output", { path: "/tmp/escape.txt", content: "x" })).ok).toBe(false);
  });
});

describe("fs tools", () => {
  it("lists files with a glob, skipping .git and node_modules", async () => {
    const { call } = makeTools();
    const all = await call("fs.list_files");
    const files = (all.data as { files: string[] }).files;
    expect(files).toContain("src/combat/damage.ts");
    expect(files).toContain("docs/design.md");
    expect(files.some((f) => f.startsWith("node_modules") || f.startsWith(".git/"))).toBe(false);
    const ts = await call("fs.list_files", { glob: "*.ts" });
    expect((ts.data as { files: string[] }).files).toEqual(["src/combat/damage.ts", "src/index.ts"]);
    const limited = await call("fs.list_files", { dir: "src", limit: 1 });
    expect((limited.data as { truncated: boolean }).truncated).toBe(true);
  });

  it("reads a file, a line range, with optional line numbers", async () => {
    const { call } = makeTools();
    const full = await call("fs.read_file", { path: "src/combat/damage.ts" });
    expect(full.ok).toBe(true);
    expect(full.content).toContain("return a * 2;");
    const range = await call("fs.read_file", { path: "src/combat/damage.ts", startLine: 2, endLine: 2, lineNumbers: true });
    expect(range.content).toBe("    2    return a * 2;");
    expect((await call("fs.read_file", { path: "missing.ts" })).ok).toBe(false);
  });

  it("searches text with a regex and guards against dangerous patterns", async () => {
    const { call } = makeTools();
    const r = await call("fs.search_text", { pattern: "damage\\w+" });
    expect(r.ok).toBe(true);
    expect(r.content).toContain("src/combat/damage.ts:1:");
    expect(r.content).toContain("src/index.ts:1:");
    expect(r.content).not.toContain("node_modules");
    const md = await call("fs.search_text", { pattern: "merchants", glob: "*.md", ignoreCase: true });
    expect((md.data as { matches: unknown[] }).matches).toHaveLength(1);

    expect((await call("fs.search_text", { pattern: "(a+)+$" })).content).toMatch(/nested quantifiers/);
    expect((await call("fs.search_text", { pattern: "(" })).content).toMatch(/Invalid pattern/);
    const long = await call("fs.search_text", { pattern: "a".repeat(201) });
    expect(long.ok).toBe(false);
    const capped = await call("fs.search_text", { pattern: ".", limit: 2 });
    expect((capped.data as { matches: unknown[] }).matches).toHaveLength(2);
  });

  it("write_output lands in the workspace output folder", async () => {
    const { call } = makeTools();
    const r = await call("fs.write_output", { path: "reports/review.md", content: "# Review" });
    expect(r.ok).toBe(true);
    expect((r.data as { path: string }).path).toBe(".neuralos/outputs/ws_1/reports/review.md");
    expect(readFileSync(join(root, ".neuralos/outputs/ws_1/reports/review.md"), "utf8")).toBe("# Review");
    const adhoc = await call("fs.write_output", { path: "note.txt", content: "x" }, human);
    expect((adhoc.data as { path: string }).path).toBe(".neuralos/outputs/adhoc/note.txt");
  });

  it("write_file journals a before-image and refuses .git and .neuralos", async () => {
    const { call, entries } = makeTools();
    const upd = await call("fs.write_file", { path: "docs/design.md", content: "# Design v2\n" }, human);
    expect(upd.ok).toBe(true);
    expect(readFileSync(join(root, "docs/design.md"), "utf8")).toBe("# Design v2\n");
    expect(entries[0]).toMatchObject({ tool: "fs.write_file", path: "docs/design.md", before: "# Design\nMerchants restock daily.\n", after: "# Design v2\n" });
    expect(entries[0].principal).toEqual(human);

    const created = await call("fs.write_file", { path: "src/new/file.ts", content: "export {};\n" }, human);
    expect(created.ok).toBe(true);
    expect(entries[1]).toMatchObject({ path: "src/new/file.ts", before: null });

    for (const path of [".git/config", ".neuralos/outputs/x.md", "src/.git/hooks/pre-commit", ".GIT/config"]) {
      const r = await call("fs.write_file", { path, content: "evil" }, human);
      expect(r.ok, path).toBe(false);
      expect(r.content).toMatch(/Refused/);
    }
    expect(readFileSync(join(root, ".git/config"), "utf8")).toBe("[core]\n");
    expect(entries).toHaveLength(2);
  });

  it("write_file refuses the kernel config and new files under a symlink into a protected folder", async () => {
    const { call, entries } = makeTools();
    for (const path of ["neuralos.config.json", "NEURALOS.CONFIG.JSON"]) {
      const r = await call("fs.write_file", { path, content: '{"toolPolicy":{"mode":"auto","allow":["*"]}}' }, human);
      expect(r.ok, path).toBe(false);
      expect(r.content).toMatch(/Refused/);
    }
    // A repo-shipped symlink docs/meta -> ../.neuralos must not let a NEW file land inside .neuralos.
    mkdirSync(join(root, ".neuralos"), { recursive: true });
    symlinkSync("../.neuralos", join(root, "docs/meta"));
    const viaLink = await call("fs.write_file", { path: "docs/meta/preferences.json", content: '{"x":"y"}' }, human);
    expect(viaLink.ok).toBe(false);
    expect(viaLink.content).toMatch(/symlink/);
    expect(existsSync(join(root, ".neuralos/preferences.json"))).toBe(false);
    expect(entries).toHaveLength(0);
  });
});

describe("search and memory", () => {
  it("search.semantic delegates to the index", async () => {
    const { call, queries } = makeTools();
    const r = await call("search.semantic", { query: "latest damage calculations", limit: 3, kind: "code" });
    expect(r.ok).toBe(true);
    expect(r.content).toContain("src/combat/damage.ts");
    expect(queries[0]).toEqual({ query: "latest damage calculations", opts: { limit: 3, kind: "code" } });
  });

  it("memory.remember always writes a proposed record with an agent source", async () => {
    const { call, records } = makeTools();
    const r = await call("memory.remember", { category: "coding_standard", key: "naming", content: "Use camelCase", tags: ["style"] });
    expect(r.ok).toBe(true);
    expect(records[0]).toMatchObject({ source: "agent:code_reviewer#ai_1", status: "proposed", tags: ["style"] });
    // Even a call without an agent identity cannot write active memory through this tool.
    await call("memory.remember", { category: "preference", key: "k", content: "c" }, human);
    expect(records[1].source).toMatch(/^agent:/);
    expect(records[1].status).toBe("proposed");
    expect((await call("memory.recall", {})).content).toBe("(no memory)");
    expect((await call("memory.remember", { category: "nope", key: "k", content: "c" })).ok).toBe(false);
  });
});

describe("process tools", () => {
  it("runs the configured test command with a scrubbed environment; filter goes in an env var", async () => {
    process.env.FOO_API_KEY = "leak-me";
    process.env.NEURALOS_PLAIN_VAR = "visible";
    try {
      const { call } = makeTools({ testCommand: "node check-env.cjs" });
      const r = await call("proc.run_tests", { filter: "combat; echo INJECTED" });
      expect(r.ok).toBe(true);
      expect(r.content).toContain("FOO=unset");
      expect(r.content).toContain("PLAIN=visible");
      expect(r.content).toContain("FILTER=combat; echo INJECTED");
      expect(r.content).not.toMatch(/^INJECTED$/m);
      expect(r.content).not.toContain("leak-me");
    } finally {
      delete process.env.FOO_API_KEY;
      delete process.env.NEURALOS_PLAIN_VAR;
    }
  });

  it("reports a failing command as ok:false", async () => {
    const { call } = makeTools({ testCommand: "node -e \"process.exit(3)\"" });
    const r = await call("proc.run_tests");
    expect(r.ok).toBe(false);
    expect(r.content).toContain("exit code 3");
  });

  it("kills the whole process group on timeout", async () => {
    const { call } = makeTools({ testCommand: "sleep 30 & echo $! > sleeper.pid; wait", procTimeoutMs: 400 });
    const started = Date.now();
    const r = await call("proc.run_tests");
    expect(Date.now() - started).toBeLessThan(5000);
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/timed out/);
    const pid = Number(readFileSync(join(root, "sleeper.pid"), "utf8"));
    await new Promise((res) => setTimeout(res, 100));
    // Killed: gone, or a zombie waiting for an init that does not reap (common in containers).
    let state = "gone";
    try {
      state = readFileSync(`/proc/${pid}/stat`, "utf8").split(" ")[2];
    } catch {
      // No such process.
    }
    expect(["gone", "Z", "X"]).toContain(state);
    rmSync(join(root, "sleeper.pid"));
  });

  it("scrubEnv drops credential-looking variables", () => {
    const env = scrubEnv({ PATH: "/bin", ANTHROPIC_API_KEY: "a", GITHUB_TOKEN: "b", AWS_REGION: "c", DB_PASSWORD: "d", my_secret: "e", HOME: "/h", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraHeader", GIT_CONFIG_VALUE_0: "Authorization: x" });
    expect(env).toEqual({ PATH: "/bin", HOME: "/h" });
  });

  it("detects a default test command", () => {
    const dir = mkdtempSync(join(base, "detect-"));
    expect(detectTestCommand(dir)).toBeUndefined();
    writeFileSync(join(dir, "pyproject.toml"), "[project]\n");
    expect(detectTestCommand(dir)).toBe("python -m pytest -q");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
    expect(detectTestCommand(dir)).toBe("npm test --silent");
  });

  it("deploy without a command packages the workspace outputs", async () => {
    const { call } = makeTools();
    const none = await call("proc.deploy", {}, { ...agentP, workspaceId: "ws_empty" });
    expect(none.ok).toBe(false);
    await call("fs.write_output", { path: "site/index.html", content: "<h1>hi</h1>" });
    const r = await call("proc.deploy");
    expect(r.ok).toBe(true);
    expect(r.content).toMatch(/packaged/);
    const dest = (r.data as { path: string }).path;
    expect(dest).toMatch(/^\.neuralos\/deployments\/\d{4}-/);
    expect(readFileSync(join(root, dest, "site/index.html"), "utf8")).toBe("<h1>hi</h1>");
    expect(readdirSync(join(root, ".neuralos/deployments")).length).toBeGreaterThan(0);
  });

  it("deploy with a configured command runs it", async () => {
    const { call } = makeTools({ deployCommand: "node -e \"console.log('deployed')\"" });
    const r = await call("proc.deploy");
    expect(r.ok).toBe(true);
    expect(r.content).toContain("deployed");
  });
});

let hasGit = true;
try {
  execFileSync("git", ["--version"], { stdio: "ignore" });
} catch {
  hasGit = false;
}

describe.skipIf(!hasGit)("git tools", () => {
  it("fails clearly outside a repository, then reads status, log and diff of a repo", async () => {
    const repo = join(base, "repo");
    mkdirSync(repo);
    const registry: ToolRegistry = createToolRegistry({ bus, audit, policy: { mode: "auto" } });
    registerBuiltinTools({ registry, root: repo, index: fakeIndex().index, memory: fakeMemory().memory, journal: fakeJournal().journal, outputDirFor: () => ".neuralos/outputs/adhoc" });
    const call = (name: string, input: Record<string, unknown> = {}) => registry.call(name, input, { principal: human });

    const notRepo = await call("git.status");
    expect(notRepo.ok).toBe(false);
    expect(notRepo.content).toMatch(/Not a git repository/);

    const g = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
    g("init", "-q");
    g("config", "user.email", "t@example.com");
    g("config", "user.name", "Tester");
    g("config", "commit.gpgsign", "false");
    writeFileSync(join(repo, "a.txt"), "one\n");
    g("add", "a.txt");
    g("commit", "-q", "-m", "first commit");
    writeFileSync(join(repo, "a.txt"), "two\n");
    writeFileSync(join(repo, "b.txt"), "new\n");

    const status = await call("git.status");
    expect(status.ok).toBe(true);
    expect(status.content).toContain(" M a.txt");
    expect(status.content).toContain("?? b.txt");
    const log = await call("git.log", { limit: 5 });
    expect(log.content).toContain("first commit");
    const diff = await call("git.diff", { path: "a.txt" });
    expect(diff.content).toContain("-one");
    expect(diff.content).toContain("+two");
    expect((await call("git.diff", { path: "../x" })).ok).toBe(false);
  });
});

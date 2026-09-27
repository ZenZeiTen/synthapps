import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_CATALOG, findAgent } from "../src/agents/catalog";
import { OFFLINE_SKILLS, runOfflineSkill } from "../src/agents/skills/index";
import type { SkillContext } from "../src/agents/skills/context";
import { matchAny } from "../src/kernel/glob";
import type { AgentDefinition, SearchHit, ToolResult, Workspace } from "../src/kernel/types";

// ---------------------------------------------------------------------------
// Fake tool gateway: an in-memory project behind callTool, with scope enforcement like the registry.
// ---------------------------------------------------------------------------

interface Memory {
  category: string;
  key: string;
  content: string;
  data?: Record<string, unknown>;
}

interface FakeOptions {
  memory?: Memory[];
  hits?: SearchHit[];
  runTests?: ToolResult;
}

function fakeGateway(agent: AgentDefinition, files: Record<string, string>, opts: FakeOptions = {}) {
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const written = new Map<string, string>();
  const callTool = async (name: string, input: Record<string, unknown>): Promise<ToolResult> => {
    calls.push({ name, input });
    if (!matchAny(name, agent.tools, { dots: true })) return { ok: false, content: `Denied: tool "${name}" is outside the scope`, error: `tool "${name}" is outside the scope` };
    switch (name) {
      case "fs.read_file": {
        const text = files[String(input.path)];
        return text === undefined ? { ok: false, content: `File not found: ${input.path}`, error: "not found" } : { ok: true, content: text, data: { path: input.path } };
      }
      case "fs.list_files": {
        const list = Object.keys(files);
        return { ok: true, content: list.join("\n"), data: { files: list, truncated: false } };
      }
      case "memory.recall": {
        const records = (opts.memory ?? []).filter((m) => !input.category || m.category === input.category).map((m) => ({ ...m, data: m.data ?? {} }));
        return { ok: true, content: records.map((r) => `[${r.category}] ${r.key}: ${r.content}`).join("\n") || "(no memory)", data: { records } };
      }
      case "search.semantic":
        return { ok: true, content: "hits", data: { hits: opts.hits ?? [] } };
      case "fs.write_output": {
        const path = `.neuralos/outputs/ws_1/${input.path}`;
        written.set(String(input.path), String(input.content));
        return { ok: true, content: `Wrote ${path}`, data: { path } };
      }
      case "proc.run_tests":
        return opts.runTests ?? { ok: true, content: "$ npm test\nexit code 0 in 1.0 s\nall good", data: { exitCode: 0, timedOut: false } };
      default:
        return { ok: false, content: `unknown tool ${name}`, error: "unknown tool" };
    }
  };
  return { callTool, calls, written };
}

function ctxFor(agentId: string, task: string, files: Record<string, string>, opts: FakeOptions & { tools?: string[]; workspace?: Workspace; inScope?: string[] } = {}) {
  const base = findAgent(agentId)!;
  const agent: AgentDefinition = { ...base, tools: opts.tools ?? base.tools };
  const gw = fakeGateway(agent, files, opts);
  const ctx: SkillContext = { agent, task, files: opts.inScope ?? Object.keys(files), callTool: gw.callTool, ...(opts.workspace ? { workspace: opts.workspace } : {}) };
  return { ctx, ...gw };
}

// Demo-like project content (a small RPG remake).
const DAMAGE_TS = [
  'import { rollCritical } from "./random.ts";', // 1
  "", // 2
  "export interface Attack { power: number; level: number }", // 3
  "", // 4
  "// TODO: apply elemental resistance", // 5
  "export function computeDamage(attacker: any, defender: Attack): number {", // 6
  "  const base = attacker.power * 1.75 - defender.level * 0.5;", // 7
  "  const crit = rollCritical() ? base * 2 : base;", // 8
  "  console.log(crit);", // 9
  "  try { return Math.floor(crit); } catch {}", // 10
  "  return 0;", // 11
  "}", // 12
].join("\n");

const STANDARDS = `# Coding standards

1. **No \`any\`.** Use \`unknown\` and narrow it.
2. **Damage formulas are pure.**
3. **Every module has tests.** Each file in \`src/\` has a matching test in \`tests/\`.
4. **No magic numbers.** Tuning values are named constants or live in data tables.`;

const GLOSSARY = `| English | Indonesian | Notes |
|---|---|---|
| Dragon Tear | Air Mata Naga | Rare restorative item; keep capitalized |
| Merchant | Pedagang | |
| Fire / Ice | Api / Es | |`;

describe("skill registry", () => {
  it("implements every offline skill the catalog uses", () => {
    for (const def of AGENT_CATALOG) expect(OFFLINE_SKILLS).toContain(def.offlineSkill);
  });

  it("skills never import the filesystem: data only comes through callTool", () => {
    const dir = join(import.meta.dirname, "../src/agents/skills");
    for (const file of readdirSync(dir)) {
      const src = readFileSync(join(dir, file), "utf8");
      expect(src, file).not.toMatch(/from\s+["'](node:)?fs(\/promises)?["']/);
      expect(src, file).not.toMatch(/require\(["'](node:)?fs/);
    }
  });

  it("returns an honest zero-confidence output for an unknown skill", async () => {
    const { ctx } = ctxFor("code_reviewer", "x", {});
    const out = await runOfflineSkill("nope", ctx);
    expect(out.confidence).toBe(0);
    expect(out.source).toBe("offline");
    expect(out.limitation).toMatch(/needs Claude/);
  });
});

describe("code_review", () => {
  it("finds the TODO, any, magic numbers, console.log, empty catch and missing test with lines, citing standards", async () => {
    const { ctx } = ctxFor(
      "code_reviewer",
      "Review the combat code",
      { "src/combat/damage.ts": DAMAGE_TS, "src/shop.ts": "export const x = 1;\n", "tests/damage.test.ts": "import '../src/combat/damage.ts';\n" },
      { memory: [{ category: "coding_standard", key: "CODING_STANDARDS.md", content: STANDARDS }], inScope: ["src/combat/damage.ts", "src/shop.ts"] },
    );
    const out = await runOfflineSkill("code_review", ctx);
    expect(out.source).toBe("offline");
    const find = (title: RegExp) => out.findings.filter((f) => title.test(f.title));

    const todo = find(/TODO/);
    expect(todo).toHaveLength(1);
    expect(todo[0]).toMatchObject({ file: "src/combat/damage.ts", line: 5, severity: "low" });

    const any = find(/any/);
    expect(any.map((f) => f.line)).toEqual([6]);
    expect(any[0].detail).toMatch(/coding standard rule 1/);

    const magic = find(/Magic number/);
    expect(magic.map((f) => f.line)).toEqual([7]);
    expect(magic[0].detail).toMatch(/1\.75/);
    expect(magic[0].detail).toMatch(/0\.5/);
    expect(magic[0].detail).toMatch(/rule 4/);

    expect(find(/console\.log/)[0]).toMatchObject({ line: 9 });
    expect(find(/Empty catch/)[0]).toMatchObject({ line: 10 });

    const missing = find(/Missing test/);
    expect(missing.map((f) => f.file)).toEqual(["src/shop.ts"]);
    expect(missing[0].detail).toMatch(/rule 3/);

    expect(out.summary).toMatch(/rule 1/);
    // Ranked by severity.
    const ranks = out.findings.map((f) => ["critical", "high", "medium", "low", "info"].indexOf(f.severity));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it("flags functions longer than 60 lines", async () => {
    const body = Array.from({ length: 70 }, (_, i) => `  total += ${i % 2};`).join("\n");
    const { ctx } = ctxFor("code_reviewer", "review", { "src/long.ts": `export function big(total: number): number {\n${body}\n  return total;\n}\n`, "tests/long.test.ts": "" });
    const out = await runOfflineSkill("code_review", ctx);
    const long = out.findings.find((f) => f.title === "Function too long");
    expect(long).toMatchObject({ file: "src/long.ts", line: 1 });
    expect(long!.detail).toMatch(/big is 73 lines/);
  });
});

describe("security", () => {
  it("reports a secret by file and line without its value, plus unsafe calls", async () => {
    const secret = "sk-live_ABCDEFGHIJKLMNOPQRSTUVWX1234";
    const { ctx } = ctxFor("security_agent", "scan", {
      "src/config.ts": `export const region = "eu";\nexport const API_KEY = "${secret}";\n`,
      "src/ui.ts": 'el.innerHTML = userText;\neval(code);\ndb.query("SELECT * FROM users WHERE id = " + id);\n',
    });
    const out = await runOfflineSkill("security", ctx);
    const s = out.findings.find((f) => f.title.startsWith("Possible secret"));
    expect(s).toMatchObject({ severity: "critical", file: "src/config.ts", line: 2 });
    expect(JSON.stringify(out)).not.toContain(secret);
    expect(JSON.stringify(out)).not.toContain("ABCDEFGH");
    const titles = out.findings.filter((f) => f.file === "src/ui.ts").map((f) => `${f.title}@${f.line}`);
    expect(titles).toEqual(expect.arrayContaining(["innerHTML assignment@1", "eval() call@2", "SQL built by string concatenation@3"]));
  });
});

describe("qa", () => {
  const files = { "src/combat/damage.ts": DAMAGE_TS, "src/shop.ts": "export const x = 1;\n", "tests/damage.test.ts": "test" };

  it("reports a denied test run honestly and never claims the tests passed", async () => {
    const { ctx, calls } = ctxFor("qa_engineer", "check coverage", files, {
      runTests: { ok: false, content: "Denied: approval denied", error: "approval denied" },
      inScope: ["src/combat/damage.ts", "src/shop.ts"],
    });
    const out = await runOfflineSkill("qa", ctx);
    expect(calls.some((c) => c.name === "proc.run_tests")).toBe(true);
    expect(out.findings.find((f) => f.title === "tests not run: approval denied")).toBeTruthy();
    expect(JSON.stringify(out)).not.toMatch(/passed/i);
    expect(out.summary).toMatch(/Tests: not run \(approval denied\)/);
    expect(out.findings.filter((f) => f.title === "Untested source file").map((f) => f.file)).toEqual(["src/shop.ts"]);
    expect(out.confidence).toBeLessThan(0.5);
  });

  it("reports exit status and output tail when the tests ran and failed", async () => {
    const { ctx } = ctxFor("qa_engineer", "run tests", files, {
      runTests: { ok: false, content: "$ node --test\nexit code 1 in 2.0 s\nnot ok 1 - damage", data: { exitCode: 1, timedOut: false }, error: "exit code 1" },
    });
    const out = await runOfflineSkill("qa", ctx);
    const fail = out.findings.find((f) => f.severity === "high");
    expect(fail?.title).toBe("Test suite failed (exit 1)");
    expect(fail?.detail).toMatch(/not ok 1 - damage/);
    expect(out.summary).toMatch(/failed \(exit 1\)/);
  });

  it("reports a pass only with exit status 0", async () => {
    const { ctx } = ctxFor("qa_engineer", "run tests", files);
    const out = await runOfflineSkill("qa", ctx);
    expect(out.summary).toMatch(/passed \(exit 0\)/);
  });

  it("does not call proc.run_tests outside the agent's scope", async () => {
    const { ctx, calls } = ctxFor("qa_engineer", "x", files, { tools: ["fs.read_file", "fs.list_files"] });
    const out = await runOfflineSkill("qa", ctx);
    expect(calls.some((c) => c.name === "proc.run_tests")).toBe(false);
    expect(out.findings.some((f) => f.title.startsWith("tests not run"))).toBe(true);
  });
});

describe("architecture", () => {
  it("maps imports, detects a cycle and writes a Mermaid diagram", async () => {
    const tools = [...findAgent("systems_architect")!.tools, "fs.write_output"];
    const { ctx, written } = ctxFor(
      "systems_architect",
      "map modules",
      {
        "src/combat/damage.ts": 'import { price } from "../shop/prices.ts";\nexport const d = 1;',
        "src/shop/prices.ts": 'import { d } from "../combat/damage";\nexport const price = 2;',
        "src/shop/merchant.ts": 'import { price } from "./prices.js";\nimport lodash from "lodash";',
      },
      { tools },
    );
    const out = await runOfflineSkill("architecture", ctx);
    const cycle = out.findings.find((f) => f.title === "Import cycle");
    expect(cycle?.severity).toBe("high");
    expect(cycle?.detail).toMatch(/src\/combat\/damage\.ts -> src\/shop\/prices\.ts -> src\/combat\/damage\.ts/);
    expect(out.findings.some((f) => f.title === "Bidirectional module coupling")).toBe(true);
    const doc = written.get("architecture.md")!;
    expect(doc).toContain("```mermaid");
    expect(doc).toMatch(/n_src_shop_merchant_ts --> n_src_shop_prices_ts/);
    expect(doc).toContain("lodash");
    expect(out.artifacts).toEqual([{ path: ".neuralos/outputs/ws_1/architecture.md", description: expect.any(String) }]);
  });

  it("says so when the agent may not write outputs", async () => {
    const noWrite = findAgent("systems_architect")!.tools.filter((t) => t !== "fs.write_output");
    const { ctx, calls } = ctxFor("systems_architect", "map", { "src/a.ts": "export const a = 1;" }, { tools: noWrite });
    const out = await runOfflineSkill("architecture", ctx);
    expect(calls.some((c) => c.name === "fs.write_output")).toBe(false);
    expect(out.summary).toMatch(/architecture\.md not written/);
    expect(out.artifacts).toEqual([]);
  });
});

describe("docs", () => {
  it("extracts exported symbols with their leading comments and writes docs", async () => {
    const { ctx, written } = ctxFor("documentation", "document combat", {
      "src/combat/damage.ts": "/**\n * Computes damage.\n */\nexport function computeDamage() {}\n// The cap.\nexport const MAX = 9;\nexport class Undocumented {}\n",
    });
    const out = await runOfflineSkill("docs", ctx);
    const doc = written.get("docs.md")!;
    expect(doc).toContain("### `computeDamage` (function)");
    expect(doc).toContain("Computes damage.");
    expect(doc).toContain("The cap.");
    expect(out.findings).toEqual([expect.objectContaining({ title: "Undocumented export Undocumented", line: 7 })]);
    expect(out.artifacts[0].path).toMatch(/docs\.md$/);
  });
});

describe("planning and scheduler", () => {
  const workspace = {
    id: "ws_1",
    text: "Build inventory feature",
    outputDir: ".neuralos/outputs/ws_1",
    plan: [
      { id: "s2", agent: "fullstack_engineer", task: "Implement inventory", dependsOn: ["s1"], tools: [] },
      { id: "s1", agent: "planner", task: "Plan inventory", dependsOn: [], tools: [] },
      { id: "s3", agent: "qa_engineer", task: "Test inventory", dependsOn: ["s2"], tools: [] },
    ],
    checkpoint: { completedSteps: { s1: { instanceId: "i", agentId: "planner", output: { summary: "", findings: [], artifacts: [], confidence: 1, source: "offline" } } } },
  } as unknown as Workspace;

  it("orders tasks with done conditions and reports plan.md honestly when it cannot write", async () => {
    const noWrite = findAgent("planner")!.tools.filter((t) => t !== "fs.write_output");
    const { ctx } = ctxFor("planner", "Build inventory feature", { "src/inventory.ts": "" }, { workspace, tools: noWrite });
    const out = await runOfflineSkill("planning", ctx);
    expect(out.findings.slice(0, 3).map((f) => f.title.split(":")[0])).toEqual(["Task 1 (s1)", "Task 2 (s2)", "Task 3 (s3)"]);
    expect(out.findings[2].detail).toMatch(/Done when: .*test run result/);
    expect(out.summary).toMatch(/plan\.md not written/);
  });

  it("writes plan.md when fs.write_output is in scope", async () => {
    const { ctx, written } = ctxFor("planner", "Build inventory", {}, { workspace, tools: ["fs.write_output"] });
    await runOfflineSkill("planning", ctx);
    expect(written.get("plan.md")).toMatch(/1\. \*\*s1\*\* \(Planner\)/);
  });

  it("scheduler reports ready and blocked steps", async () => {
    const { ctx } = ctxFor("scheduler_agent", "schedule", {}, { workspace });
    const out = await runOfflineSkill("scheduler", ctx);
    expect(out.summary).toMatch(/1 done, 1 ready \(s2\), 1 blocked \(s3 waits for s2\)/);
  });
});

describe("localization", () => {
  const html = `<!doctype html>
<html>
<body>
  <h1>Welcome, traveller</h1>
  <p>Buy a Dragon Tear from the Merchant.</p>
  <img src="x.png" alt="A dragon tear on a table">
  <script>const notText = "ignore me";</script>
</body>
</html>`;

  it("inventories strings, checks the glossary and states that translation needs Claude", async () => {
    const { ctx, written } = ctxFor("translator", "Translate the shop page into Indonesian", { "web/shop.html": html }, { memory: [{ category: "translation_guide", key: "glossary", content: GLOSSARY }] });
    const out = await runOfflineSkill("localization", ctx);
    expect(out.limitation).toBe("Translation needs Claude; offline mode produced the string inventory and glossary check only");
    const list = written.get("translation-worklist.md")!;
    expect(list).toContain("Welcome, traveller");
    expect(list).toContain("Dragon Tear => Air Mata Naga");
    expect(list).toContain("Merchant => Pedagang");
    expect(list).not.toContain("ignore me");
    const caps = out.findings.find((f) => f.title.startsWith("Glossary term written as"));
    expect(caps).toMatchObject({ file: "web/shop.html", line: 6 });
  });

  it("does not claim a limitation for a review task", async () => {
    const { ctx } = ctxFor("localization_qa", "Check the Indonesian translation", { "web/shop.html": html }, { memory: [{ category: "translation_guide", key: "glossary", content: GLOSSARY }] });
    const out = await runOfflineSkill("localization", ctx);
    expect(out.limitation).toBeUndefined();
  });
});

describe("seo and ux", () => {
  const page = `<html>
<head><title>Shop</title></head>
<body>
<h1>Shop</h1>
<h3>Items</h3>
<img src="a.png">
<button></button>
<input id="qty" type="number">
<label for="name">Name</label><input id="name">
</body>
</html>`;

  it("seo checks title, description, lang, hreflang and og tags per page", async () => {
    const { ctx } = ctxFor("seo_reviewer", "Localize this website to Indonesian", { "web/index.html": page });
    const out = await runOfflineSkill("seo", ctx);
    const titles = out.findings.map((f) => f.title);
    expect(titles).toEqual(expect.arrayContaining(["Missing lang attribute", "Missing meta description", "No hreflang links", "Missing og:title", "Title length"]));
    expect(out.findings.find((f) => f.title === "No hreflang links")?.severity).toBe("medium");
  });

  it("ux checks alt text, button labels, form labels, heading order and lang", async () => {
    const { ctx } = ctxFor("ux_agent", "review accessibility", { "web/index.html": page });
    const out = await runOfflineSkill("ux", ctx);
    const at = (t: string) => out.findings.filter((f) => f.title === t).map((f) => f.line);
    expect(at("Image without alt text")).toEqual([6]);
    expect(at("Button without a label")).toEqual([7]);
    expect(at("Form field without a label")).toEqual([8]);
    expect(at("Skipped heading level")).toEqual([5]);
    expect(at("Missing lang attribute")).toEqual([1]);
  });
});

describe("legal and finance", () => {
  const contract = `# Service Agreement

This agreement is made on 1 January 2026 between the parties.

1. Definitions
"Services" means the translation work described in Schedule A.
The "Fee" is the amount in clause 2.

2. Payment
The Client pays the Fee within 30 days of invoice.

4. Liability
Liability for the Services is limited to the Fee.
`;

  it("legal extracts defined terms, clauses, dates, missing clauses and says it is not legal advice", async () => {
    const { ctx } = ctxFor("legal", "Review this contract", { "docs/contract.md": contract, "docs/design/combat.md": "# Combat\n\n1. Damage\nAttack minus defense.\n" });
    const out = await runOfflineSkill("legal", ctx);
    const terms = out.findings.filter((f) => f.title.startsWith("Defined term \"") && f.severity === "info").map((f) => `${f.title}@${f.line}`);
    expect(terms).toEqual(['Defined term "Services"@6', 'Defined term "Fee"@7']);
    expect(out.findings.find((f) => f.title === "Clause numbering skips from 2 to 4")?.line).toBe(12);
    expect(out.findings.find((f) => f.title === "No termination clause found")?.severity).toBe("medium");
    expect(out.findings.some((f) => f.title === "Payment clause present")).toBe(true);
    expect(out.findings.find((f) => f.title === "1 date(s)")?.detail).toMatch(/1 January 2026/);
    expect(out.summary).toMatch(/not legal advice/);
    // A design doc is not a contract: no clause checks on it.
    expect(out.findings.some((f) => f.file === "docs/design/combat.md")).toBe(false);
    expect(out.summary).toMatch(/1 other document\(s\) do not look like contracts/);
  });

  it("finance lists amounts and flags a total that does not add up", async () => {
    const invoice = "| Item | Price |\n|---|---|\n| Translation | Rp 1.500.000 |\n| Review | Rp 500.000 |\n| Total | Rp 2.100.000 |\n\nDeposit: $1,250.50\n";
    const { ctx } = ctxFor("finance", "check invoice", { "docs/invoice.md": invoice });
    const out = await runOfflineSkill("finance", ctx);
    const bad = out.findings.find((f) => f.title === "Total does not match its items");
    expect(bad).toMatchObject({ severity: "high", line: 5 });
    expect(bad!.detail).toMatch(/2000000\.00 IDR/);
    expect(out.summary).toMatch(/4 monetary amount\(s\) \(3 IDR, 1 USD\)/);
  });
});

describe("other skills", () => {
  it("brand reports terms, phrases and quoted tone", async () => {
    const md = "# Welcome\n\nJoin the adventure! Discover the Dragon Tear.\n\nThe Dragon Tear heals your party. Join the adventure today.\n";
    const { ctx } = ctxFor("brand_analyst", "describe the voice", { "docs/intro.md": md });
    const out = await runOfflineSkill("brand", ctx);
    expect(out.summary).toMatch(/"join adventure" \(2\)|"dragon tear" \(2\)/);
    expect(out.findings.find((f) => f.title === "Voice trait: energetic")?.detail).toMatch(/Join the adventure/);
    expect(out.findings.find((f) => f.title === "Key terms that must not change")?.detail).toMatch(/Dragon Tear \(2\)/);
  });

  it("devops reads package.json scripts and notes missing CI", async () => {
    const { ctx } = ctxFor("devops_engineer", "check build", { "package.json": '{"name":"x","scripts":{"start":"node a.js"}}' });
    const out = await runOfflineSkill("devops", ctx);
    expect(out.findings.map((f) => f.title)).toEqual(expect.arrayContaining(["No test script", "No CI configuration", "No Dockerfile"]));
    expect(out.summary).toMatch(/Scripts: package\.json: start/);
    expect(out.summary).toMatch(/does not deploy/);
  });

  it("research cites search hits", async () => {
    const hits: SearchHit[] = [{ path: "docs/design/combat.md", nodeId: "file:docs/design/combat.md", score: 3, snippet: "Damage uses attack minus defense", line: 4, kind: "doc", mtimeMs: 0, reasons: ["matches: damage"] }];
    const { ctx } = ctxFor("researcher", "how is damage calculated", {}, { hits });
    const out = await runOfflineSkill("research", ctx);
    expect(out.summary).toMatch(/\[1\] docs\/design\/combat\.md:4/);
    expect(out.findings[0]).toMatchObject({ file: "docs/design/combat.md", line: 4 });
  });

  it("implementation produces a plan and states that code changes need Claude", async () => {
    const { ctx, written } = ctxFor("fullstack_engineer", "Add a sell price", { "src/shop.ts": "" });
    const out = await runOfflineSkill("implementation", ctx);
    expect(out.limitation).toBe("Code changes need Claude");
    expect(written.get("implementation-plan.md")).toMatch(/`src\/shop\.ts`/);
  });

  it("memory summarizes recalled records", async () => {
    const { ctx } = ctxFor("memory_agent", "coding rules", {}, { memory: [{ category: "coding_standard", key: "no-any", content: "Never use any" }] });
    const out = await runOfflineSkill("memory", ctx);
    expect(out.summary).toMatch(/\[coding_standard\] no-any/);
  });
});

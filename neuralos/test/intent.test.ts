import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020Module from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import { AGENT_CATALOG } from "../src/agents/catalog";
import { FALLBACK_INTENT, INTENT_CATALOG, findIntentClass } from "../src/intent/catalog";
import {
  classifyHeuristic,
  createIntentEngine,
  detectPriority,
  detectTargetLanguage,
  intersectTools,
  mentionedFiles,
  normalizeDag,
  stem,
  type IntentEngineDeps,
} from "../src/intent/engine";
import { createScriptedProvider } from "../src/llm/scripted";
import {
  LLMError,
  type EventType,
  type JsonSchemaObject,
  type MemoryRecord,
  type PlanStep,
  type SearchHit,
  type ToolDefinition,
} from "../src/kernel/types";

// ajv is CommonJS; depending on the loader the class is the default export or its `.default`.
const Ajv2020 = ((Ajv2020Module as unknown as { default?: typeof Ajv2020Module }).default ?? Ajv2020Module) as typeof Ajv2020Module;
const intentSchema = JSON.parse(readFileSync(fileURLToPath(new URL("../schemas/intent.schema.json", import.meta.url)), "utf8"));
const validateIntent = new Ajv2020({ strict: false }).compile(intentSchema);

// ---------------------------------------------------------------------------
// Small fakes for the interfaces the engine reads
// ---------------------------------------------------------------------------

function hit(path: string, score = 1): SearchHit {
  return { path, nodeId: `file:${path}`, score, snippet: "", kind: "code", mtimeMs: 0, reasons: ["test"] };
}

const FILES = ["src/game/inventory.ts", "src/game/inventory.test.ts", "src/game/items.ts", "docs/inventory.md", "src/game/shop.ts", "src/game/extra.ts", "README.md"];

function fakeIndex() {
  const queries: string[] = [];
  return {
    queries,
    search(query: string, opts?: { limit?: number }) {
      queries.push(query);
      const words = query.toLowerCase().split(/[^a-z0-9.]+/).filter((w) => w.length > 3);
      const hits = FILES.filter((f) => words.some((w) => f.toLowerCase().includes(w.replace(/\.ts$/, "")))).map((f, i) => hit(f, 10 - i));
      return hits.slice(0, opts?.limit ?? 10);
    },
    hasFile: (path: string) => FILES.includes(path),
  };
}

function record(category: MemoryRecord["category"], key: string, content: string): MemoryRecord {
  return { id: `mem_${key}`, category, key, content, data: {}, tags: [], source: "user", status: "active", createdAt: "", updatedAt: "" };
}

const MEMORY = [
  record("coding_standard", "ts-style", "Use strict TypeScript; no any"),
  record("translation_guide", "id-tone", "Indonesian copy uses formal 'Anda'"),
  record("preference", "reports", "Prefer short reports"),
];

function fakeMemory() {
  const queries: unknown[] = [];
  return {
    queries,
    recall(query: { category?: string | string[]; text?: string; limit?: number } = {}) {
      queries.push(query);
      const cats = query.category === undefined ? undefined : ([] as string[]).concat(query.category);
      return MEMORY.filter((m) => (cats ? cats.includes(m.category) : query.text?.toLowerCase().includes("indonesian") && m.category === "translation_guide")).slice(0, query.limit ?? 10);
    },
  };
}

function fakeBus() {
  const events: { type: EventType; data: any; opts?: { source?: string; correlationId?: string } }[] = [];
  return {
    events,
    publish<T>(type: EventType, data: T, opts?: { source?: string; correlationId?: string }) {
      events.push({ type, data, opts });
      return { id: String(events.length), seq: events.length, type, ts: "", source: opts?.source ?? "", correlationId: opts?.correlationId, data };
    },
  };
}

const REGISTERED: ToolDefinition[] = ["fs.list_files", "fs.read_file", "fs.search_text", "fs.write_output", "fs.write_file", "search.semantic", "memory.recall", "memory.remember", "git.status", "git.log", "git.diff", "proc.run_tests", "proc.deploy"].map(
  (name) => ({ name, description: name, server: "builtin", action: "read", reversibility: "reversible", scope: "tenant", inputSchema: { type: "object" } }),
);

function engine(overrides: Partial<IntentEngineDeps> = {}) {
  const index = fakeIndex();
  const memory = fakeMemory();
  const bus = fakeBus();
  const deps: IntentEngineDeps = { llm: null, index, memory, bus, tools: { list: () => REGISTERED }, agents: () => AGENT_CATALOG, ...overrides };
  return { engine: createIntentEngine(deps), index, memory, bus };
}

function expectValidDag(plan: PlanStep[]) {
  const ids = plan.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const step of plan) {
    for (const dep of step.dependsOn) expect(ids).toContain(dep);
    expect(step.agent).not.toBe("commander");
    expect(AGENT_CATALOG.some((a) => a.id === step.agent)).toBe(true);
  }
  expect(normalizeDag(plan)).toEqual(plan);
}

function schemaPart(r: { intent: string; required_agents: string[]; required_tools: string[] }) {
  return { intent: r.intent, required_agents: r.required_agents, required_tools: r.required_tools };
}

// ---------------------------------------------------------------------------

describe("text analysis helpers", () => {
  it("stems inflections consistently", () => {
    expect(["review", "reviews", "reviewer", "reviewing"].map(stem)).toEqual(["review", "review", "review", "review"]);
    expect(["translate", "translated", "translating"].map(stem)).toEqual(["translat", "translat", "translat"]);
    expect(stem("localize")).toBe(stem("localized"));
    expect(stem("fixes")).toBe("fix");
    expect(stem("class")).toBe("class");
  });

  it("detects target languages and file mentions", () => {
    expect(detectTargetLanguage("Localize this website to Indonesian")).toBe("id");
    expect(detectTargetLanguage("translate the manual into bahasa indonesia")).toBe("id");
    expect(detectTargetLanguage("Localize the shop for Japan")).toBe("ja");
    expect(detectTargetLanguage("Summarize the French contract")).toBeUndefined();
    expect(mentionedFiles("Review src/game/inventory.ts and README.md, then contract.docx")).toEqual(["src/game/inventory.ts", "README.md", "contract.docx"]);
  });

  it("intersects intent tool globs with an agent's tools", () => {
    expect(intersectTools(["fs.*", "git.*"], ["fs.read_file", "git.diff", "proc.run_tests"])).toEqual(["fs.read_file", "git.diff"]);
    expect(intersectTools(["git.status", "fs.read_file"], ["git.*"])).toEqual(["git.status"]);
    expect(intersectTools(["git.*"], ["git.*"], ["git.status"])).toEqual(["git.*"]);
  });
});

describe("heuristic classifier: spec examples", () => {
  it("Review inventory module -> engineering_review", () => {
    const c = classifyHeuristic("Review inventory module");
    expect(c.intent).toBe("engineering_review");
    expect(c.required_agents).toEqual(["systems_architect", "code_reviewer", "qa_engineer"]);
    expect(c.required_tools).toEqual(["git", "filesystem"]);
    expect(c.source).toBe("heuristic");
    expect(c.confidence).toBeGreaterThan(0.5);
    expect(c.confidence).toBeLessThanOrEqual(0.95);
  });

  it("Build inventory feature -> feature_build with the spec's five roles", () => {
    const c = classifyHeuristic("Build inventory feature");
    expect(c.intent).toBe("feature_build");
    expect(c.required_agents).toEqual(["planner", "systems_architect", "fullstack_engineer", "qa_engineer", "documentation"]);
  });

  it("Localize this website to Indonesian -> website_localization", () => {
    const c = classifyHeuristic("Localize this website to Indonesian");
    expect(c.intent).toBe("website_localization");
    expect(c.required_agents).toEqual(["brand_analyst", "translator", "localization_qa", "seo_reviewer"]);
    expect(findIntentClass("website_localization")!.resources).toContain("Style Guide");
  });

  it("Translate contract -> legal_translation", () => {
    const c = classifyHeuristic("Translate contract");
    expect(c.intent).toBe("legal_translation");
    expect(c.required_agents).toEqual(["legal", "translator", "qa_reviewer"]);
    expect(findIntentClass("legal_translation")!.resources).toEqual(["Glossary", "Source File", "Output Folder"]);
  });

  it.each([
    ["Fix the crash in checkout", "bug_fix"],
    ["Write the README docs for the save system", "documentation"],
    ["Where is damage calculated?", "research"],
    ["Run the unit tests", "test_run"],
    ["Audit the repo for leaked secrets and API keys", "security_audit"],
    ["Deploy the build to staging", "deployment"],
    ["Review the UI layout and accessibility of the shop screen", "design_review"],
    ["Summarize the architecture notes", "summarize"],
    ["Translate the user manual into Japanese", "document_translation"],
    ["Refactor and implement the new crafting feature", "feature_build"],
  ])("%s -> %s", (text, intent) => {
    expect(classifyHeuristic(text).intent).toBe(intent);
  });

  it("falls back to general_task with low confidence when nothing matches or on a tie", () => {
    const none = classifyHeuristic("hello there");
    expect(none.intent).toBe(FALLBACK_INTENT);
    expect(none.required_agents).toEqual(["researcher", "planner"]);
    expect(none.confidence).toBeLessThan(0.5);
    const tie = classifyHeuristic("fix and deploy");
    expect(tie.intent).toBe(FALLBACK_INTENT);
  });
});

describe("priority engine", () => {
  it.each([
    ["Review inventory module", "engineering_review", "normal"],
    ["Review inventory module asap", "engineering_review", "urgent"],
    ["prod is down, fix it", "bug_fix", "urgent"],
    ["Critical: checkout broken", "bug_fix", "urgent"],
    ["This is blocking the release, review it today", "engineering_review", "high"],
    ["Summarize the docs later", "summarize", "low"],
    ["Fix the typo someday", "bug_fix", "low"],
    ["Fix the save bug", "bug_fix", "high"],
    ["Audit dependencies for vulnerabilities", "security_audit", "high"],
  ])("%s -> %s", (text, intent, priority) => {
    expect(detectPriority(text, intent)).toBe(priority);
  });
});

describe("catalog", () => {
  it("every plan template is a valid DAG over the class's own agents, without the commander", () => {
    const agentIds = new Set(AGENT_CATALOG.map((a) => a.id));
    for (const cls of INTENT_CATALOG) {
      const steps: PlanStep[] = cls.plan.map((s) => ({ ...s, tools: [] }));
      expectValidDag(steps);
      expect(new Set(cls.plan.map((s) => s.agent))).toEqual(new Set(cls.agents));
      for (const a of cls.agents) expect(agentIds.has(a)).toBe(true);
    }
  });

  it("the engine exposes the public catalog", () => {
    const list = engine().engine.catalog();
    expect(list.map((c) => c.intent)).toEqual(expect.arrayContaining([
      "engineering_review", "feature_build", "website_localization", "legal_translation", "bug_fix", "documentation", "research",
      "test_run", "security_audit", "deployment", "design_review", "summarize", "general_task",
    ]));
    expect(list.find((c) => c.intent === "engineering_review")).toMatchObject({ tools: ["git", "filesystem"], label: "Engineering review" });
  });
});

describe("process() without an LLM", () => {
  it("builds an engineering review with context, memory, a DAG plan and scoped tools", async () => {
    const { engine: e, bus, memory } = engine();
    const r = await e.process("Review inventory module");

    expect(r.intent).toBe("engineering_review");
    expect(r.label).toBe("Engineering review");
    expect(r.priority).toBe("normal");
    expect(r.entities.topics).toEqual(["inventory"]);
    expect(r.entities.files.length).toBeLessThanOrEqual(5);
    expect(r.entities.files).toContain("src/game/inventory.ts");
    expect(r.context.files.map((h) => h.path)).toContain("docs/inventory.md");
    expect(r.context.memory.map((m) => m.key)).toContain("ts-style");
    expect(memory.queries).toContainEqual({ category: ["coding_standard", "architecture_decision"], limit: 5 });

    expect(r.plan.map((s) => [s.id, s.agent, s.dependsOn])).toEqual([
      ["s1", "systems_architect", []],
      ["s2", "code_reviewer", []],
      ["s3", "qa_engineer", ["s2"]],
    ]);
    expectValidDag(r.plan);
    const reviewer = r.plan[1];
    expect(reviewer.task).toContain("Review inventory module");
    expect(reviewer.tools).toEqual(expect.arrayContaining(["fs.read_file", "git.diff", "search.semantic"]));
    const qa = r.plan[2];
    expect(qa.tools).not.toContain("proc.run_tests"); // a review is read-only
    for (const step of r.plan) {
      const agentTools = AGENT_CATALOG.find((a) => a.id === step.agent)!.tools;
      for (const t of step.tools) expect(agentTools).toContain(t);
    }

    expect(validateIntent(schemaPart(r))).toBe(true);
    expect(validateIntent(r)).toBe(true);

    expect(bus.events.map((ev) => ev.type)).toEqual(["intent.received", "intent.classified"]);
    expect(bus.events[0].data).toEqual({ id: r.id, text: "Review inventory module" });
    expect(bus.events[1].opts?.correlationId).toBe(r.id);
    expect(bus.events[1].data.context).toBeUndefined();
    expect(bus.events[1].data).toMatchObject({ intent: "engineering_review", plan: r.plan, contextSummary: { files: r.context.files.length } });
  });

  it("builds the feature workspace plan with implementation and test tools", async () => {
    const r = await engine().engine.process("Build inventory feature");
    expect(r.intent).toBe("feature_build");
    expectValidDag(r.plan);
    expect(r.plan.map((s) => s.agent)).toEqual(["planner", "systems_architect", "fullstack_engineer", "qa_engineer", "documentation"]);
    const engineer = r.plan.find((s) => s.agent === "fullstack_engineer")!;
    expect(engineer.tools).toEqual(expect.arrayContaining(["fs.write_file", "proc.run_tests"]));
    expect(r.plan.find((s) => s.agent === "documentation")!.dependsOn).toEqual(["s3"]);
    expect(validateIntent(schemaPart(r))).toBe(true);
  });

  it("localization: target language, translation memory and language-aware tasks", async () => {
    const r = await engine().engine.process("Localize this website to Indonesian");
    expect(r.intent).toBe("website_localization");
    expect(r.entities.targetLanguage).toBe("id");
    expect(r.context.memory.map((m) => m.key)).toContain("id-tone");
    expect(r.plan.find((s) => s.agent === "translator")!.task).toContain("Indonesian");
    expectValidDag(r.plan);
    expect(validateIntent(schemaPart(r))).toBe(true);
  });

  it("legal translation: legal agent, translator and QA reviewer in order", async () => {
    const r = await engine().engine.process("Translate contract");
    expect(r.intent).toBe("legal_translation");
    expect(r.plan.map((s) => [s.agent, s.dependsOn])).toEqual([
      ["legal", []],
      ["translator", ["s1"]],
      ["qa_reviewer", ["s2"]],
    ]);
    expect(validateIntent(schemaPart(r))).toBe(true);
  });

  it("resolves a mentioned bare file name to its indexed path", async () => {
    const r = await engine().engine.process("Review inventory.test.ts");
    expect(r.entities.files[0]).toBe("src/game/inventory.test.ts");
  });

  it("works without index, memory, tools or bus", async () => {
    const e = createIntentEngine({ llm: null });
    const r = await e.process("Fix the crash in checkout");
    expect(r.intent).toBe("bug_fix");
    expect(r.priority).toBe("high");
    expect(r.context).toEqual({ files: [], memory: [] });
    expectValidDag(r.plan);
  });
});

// ---------------------------------------------------------------------------
// LLM path (scripted provider)
// ---------------------------------------------------------------------------

type StructuredReq = { schema: JsonSchemaObject; prompt: string };
const isPlanRequest = (req: StructuredReq) => !!(req.schema.properties as Record<string, unknown>)?.steps;

describe("process() with an LLM", () => {
  it("uses a valid Claude classification and a valid Claude plan", async () => {
    const llm = createScriptedProvider({
      structured: (req: StructuredReq) =>
        isPlanRequest(req)
          ? {
              steps: [
                { id: "a", agent: "code_reviewer", task: "Review inventory.ts for defects", dependsOn: [] },
                { id: "b", agent: "systems_architect", task: "Check module boundaries", dependsOn: ["a", "ghost"] },
              ],
            }
          : { intent: "engineering_review", required_agents: ["code_reviewer", "systems_architect"], required_tools: ["git", "filesystem"], confidence: 0.82 },
    });
    const { engine: e } = engine({ llm });
    const r = await e.process("Please look over the inventory code");

    expect(r.source).toBe("claude");
    expect(r.intent).toBe("engineering_review");
    expect(r.required_agents).toEqual(["code_reviewer", "systems_architect"]);
    expect(r.confidence).toBe(0.82);
    expect(r.plan.map((s) => [s.id, s.agent, s.dependsOn])).toEqual([
      ["s1", "code_reviewer", []],
      ["s2", "systems_architect", ["s1"]], // the unknown dependency was dropped
    ]);
    expect(r.plan[0].tools).toEqual(expect.arrayContaining(["git.diff", "fs.read_file"]));
    expectValidDag(r.plan);
    expect(validateIntent(schemaPart(r))).toBe(true);

    const [classifyCall, planCall] = llm.calls;
    expect(classifyCall.method).toBe("structured");
    const schema = (classifyCall.req as StructuredReq).schema as any;
    expect(schema.properties.required_agents.items.enum).toContain("qa_engineer");
    expect(schema.properties.required_agents.items.enum).not.toContain("commander");
    expect((planCall.req as StructuredReq).schema.properties!.steps).toBeDefined();
    expect((classifyCall.req as StructuredReq).prompt).toContain("<user_intent>");
  });

  it("falls back to the heuristic when Claude returns garbage or errors", async () => {
    for (const bad of ["garbage", { intent: "Not Snake Case", required_agents: [], required_tools: [], confidence: 1 }, new LLMError("declined", "refusal")]) {
      const llm = createScriptedProvider({ structured: [bad] });
      const r = await engine({ llm }).engine.process("Review inventory module");
      expect(r.source).toBe("heuristic");
      expect(r.intent).toBe("engineering_review");
      expect(r.plan.map((s) => s.agent)).toEqual(["systems_architect", "code_reviewer", "qa_engineer"]);
      expect(validateIntent(schemaPart(r))).toBe(true);
    }
  });

  it("rejects a Claude plan with a cycle and uses the catalog template", async () => {
    const llm = createScriptedProvider({
      structured: (req: StructuredReq) =>
        isPlanRequest(req)
          ? {
              steps: [
                { id: "s1", agent: "code_reviewer", task: "Review", dependsOn: ["s2"] },
                { id: "s2", agent: "qa_engineer", task: "Test", dependsOn: ["s1"] },
              ],
            }
          : { intent: "engineering_review", required_agents: ["systems_architect", "code_reviewer", "qa_engineer"], required_tools: ["git", "filesystem"], confidence: 0.9 },
    });
    const r = await engine({ llm }).engine.process("Review inventory module");
    expect(r.source).toBe("claude");
    expect(r.plan.map((s) => [s.id, s.agent, s.dependsOn])).toEqual([
      ["s1", "systems_architect", []],
      ["s2", "code_reviewer", []],
      ["s3", "qa_engineer", ["s2"]],
    ]);
  });

  it("accepts a new snake_case intent class and plans for its agents", async () => {
    const llm = createScriptedProvider({
      structured: (req: StructuredReq) =>
        isPlanRequest(req)
          ? { steps: [{ id: "s1", agent: "commander", task: "merge", dependsOn: [] }] } // not an allowed agent -> template
          : { intent: "database_migration", required_agents: ["planner", "devops_engineer"], required_tools: ["postgres", "git"], confidence: 0.7 },
    });
    const r = await engine({ llm }).engine.process("Migrate the save data to the new schema");
    expect(r.intent).toBe("database_migration");
    expect(r.label).toBe("Database migration");
    expect(r.required_tools).toEqual(["postgres", "git"]);
    expect(r.plan.map((s) => [s.agent, s.dependsOn])).toEqual([
      ["planner", []],
      ["devops_engineer", ["s1"]],
    ]);
    expect(r.plan[1].tools).toEqual(expect.arrayContaining(["git.status"]));
    expect(validateIntent(schemaPart(r))).toBe(true);
  });

  it("propagates an abort instead of falling back", async () => {
    const controller = new AbortController();
    controller.abort();
    const llm = createScriptedProvider({ structured: [{ intent: "research", required_agents: ["researcher"], required_tools: [], confidence: 1 }] });
    await expect(engine({ llm }).engine.process("Where is damage calculated?", { signal: controller.signal })).rejects.toMatchObject({ kind: "aborted" });
  });

  it("classify() alone returns the classification only", async () => {
    const llm = createScriptedProvider({ structured: [{ intent: "research", required_agents: ["researcher"], required_tools: ["search"], confidence: 0.6 }] });
    const c = await engine({ llm }).engine.classify("Where is damage calculated?");
    expect(c).toEqual({ intent: "research", required_agents: ["researcher"], required_tools: ["search"], confidence: 0.6, source: "claude" });
  });
});


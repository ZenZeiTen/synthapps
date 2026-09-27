import { afterEach, describe, expect, it, vi } from "vitest";
import { findAgent } from "../src/agents/catalog";
import { buildSystemPrompt, canTransition, createOrchestrator, parseAgentOutput, type OrchestratorOptions } from "../src/agents/orchestrator";
import { matchAny } from "../src/kernel/glob";
import {
  LLMError,
  type AgentBudget,
  type AgentLoopResult,
  type AgentState,
  type AgentUsage,
  type EventBus,
  type EventType,
  type Governor,
  type GraphEdge,
  type GraphNode,
  type KnowledgeGraph,
  type LLMProvider,
  type MemoryService,
  type PlanStep,
  type Priority,
  type SemanticIndex,
  type ToolContext,
  type ToolDefinition,
  type ToolRegistry,
  type ToolResult,
  type Workspace,
} from "../src/kernel/types";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface Recorded {
  type: EventType;
  data: Record<string, unknown>;
  source?: string;
  correlationId?: string;
}

function fakeBus() {
  const events: Recorded[] = [];
  const bus: EventBus = {
    publish(type, data, opts) {
      events.push({ type, data: data as Record<string, unknown>, source: opts?.source, correlationId: opts?.correlationId });
      return { id: `ev${events.length}`, seq: events.length, type, ts: "", source: opts?.source ?? "kernel", data };
    },
    subscribe: () => () => {},
    history: () => [],
    waitFor: () => new Promise(() => {}),
    drain: async () => {},
    close: () => {},
  };
  return { bus, events };
}

function fakeGraph() {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const graph = {
    upsertNode(input: { id?: string; type: GraphNode["type"]; name: string; props?: Record<string, unknown> }) {
      const id = input.id ?? `n${nodes.size}`;
      const prev = nodes.get(id);
      const node: GraphNode = { id, type: input.type, name: input.name, props: { ...prev?.props, ...input.props }, createdAt: "", updatedAt: "" };
      nodes.set(id, node);
      return node;
    },
    getNode: (id: string) => nodes.get(id),
    link(source: string, target: string, kind: GraphEdge["kind"]) {
      if (!nodes.has(source) || !nodes.has(target)) throw new Error(`missing node ${source} or ${target}`);
      const existing = edges.find((e) => e.source === source && e.target === target && e.kind === kind);
      if (existing) return existing;
      const edge: GraphEdge = { id: `e${edges.length}`, source, target, kind, props: {}, createdAt: "" };
      edges.push(edge);
      return edge;
    },
  } as unknown as KnowledgeGraph;
  return { graph, nodes, edges };
}

type Handler = (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult> | ToolResult;

function tool(name: string, reversibility: ToolDefinition["reversibility"], handler: Handler): { def: ToolDefinition; handler: Handler } {
  return {
    def: { name, description: name, server: "builtin:test", action: reversibility === "irreversible" ? "execute" : "read", reversibility, scope: "tenant", inputSchema: { type: "object" } },
    handler,
  };
}

function fakeRegistry(files: Record<string, string> = {}) {
  const scopes = new Map<string, string[]>();
  const calls: { name: string; input: Record<string, unknown>; ctx: ToolContext; result: ToolResult }[] = [];
  const cleared: string[] = [];
  const defs = new Map<string, { def: ToolDefinition; handler: Handler }>();
  for (const t of [
    tool("fs.read_file", "reversible", (i) => (files[String(i.path)] !== undefined ? { ok: true, content: files[String(i.path)] } : { ok: false, content: "not found", error: "not found" })),
    tool("fs.list_files", "reversible", () => ({ ok: true, content: Object.keys(files).join("\n"), data: { files: Object.keys(files) } })),
    tool("fs.search_text", "reversible", () => ({ ok: true, content: "(no matches)" })),
    tool("search.semantic", "reversible", () => ({ ok: true, content: "(no results)", data: { hits: [] } })),
    tool("memory.recall", "reversible", () => ({ ok: true, content: "(no memory)", data: { records: [] } })),
    tool("fs.write_output", "reversible", (i, ctx) => ({ ok: true, content: "wrote", data: { path: `.nalara/outputs/${ctx.principal.workspaceId ?? "none"}/${i.path}` } })),
    tool("fs.write_file", "compensable", (i) => ({ ok: true, content: "wrote", data: { path: String(i.path) } })),
    tool("proc.run_tests", "irreversible", () => ({ ok: true, content: "exit code 0", data: { exitCode: 0 } })),
  ])
    defs.set(t.def.name, t);
  let budgetError: string | undefined;

  const registry = {
    get: (name: string) => defs.get(name)?.def,
    list: (filter?: { names?: string[] }) => [...defs.values()].map((d) => d.def).filter((d) => !filter?.names || matchAny(d.name, filter.names, { dots: true })),
    async call(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const deny = (reason: string): ToolResult => ({ ok: false, content: `Denied: ${reason}`, error: reason });
      let result: ToolResult;
      if (!ctx?.principal) result = deny("no principal");
      else if (ctx.principal.instanceId && !scopes.has(ctx.principal.instanceId)) result = deny(`instance ${ctx.principal.instanceId} has no tool scope`);
      else if (ctx.principal.instanceId && !matchAny(name, scopes.get(ctx.principal.instanceId), { dots: true })) result = deny(`tool "${name}" is outside the scope of instance ${ctx.principal.instanceId}`);
      else if (budgetError) result = deny(budgetError);
      else result = await defs.get(name)!.handler(input, ctx);
      calls.push({ name, input, ctx, result });
      return result;
    },
    setScope: (id: string, globs: string[]) => void scopes.set(id, [...globs]),
    clearScope: (id: string) => {
      scopes.delete(id);
      cleared.push(id);
    },
  } as unknown as ToolRegistry;
  return {
    registry,
    scopes,
    calls,
    cleared,
    failWithBudget: (reason: string) => {
      budgetError = reason;
    },
  };
}

const zero = (): AgentUsage => ({ inputTokens: 0, outputTokens: 0, toolCalls: 0, turns: 0, wallMs: 0 });

function fakeGovernor(maxLanes = 8) {
  let running = 0;
  let maxRunning = 0;
  const queue: (() => void)[] = [];
  const budgets = new Map<string, AgentBudget>();
  const usage = new Map<string, AgentUsage>();
  const admits: { id: string; priority: Priority }[] = [];
  const released: string[] = [];
  const governor: Governor = {
    admit(id, priority, signal) {
      admits.push({ id, priority });
      return new Promise((resolve, reject) => {
        const grant = () => {
          running++;
          maxRunning = Math.max(maxRunning, running);
          let done = false;
          resolve(() => {
            if (done) return;
            done = true;
            running--;
            queue.shift()?.();
          });
        };
        if (running < maxLanes) return grant();
        queue.push(grant);
        signal?.addEventListener("abort", () => {
          const i = queue.indexOf(grant);
          if (i >= 0) queue.splice(i, 1);
          reject(new Error("admission aborted"));
        });
      });
    },
    setBudget: (id, b) => void budgets.set(id, b),
    charge(id, u) {
      const cur = usage.get(id) ?? zero();
      cur.inputTokens += u.inputTokens ?? 0;
      cur.outputTokens += u.outputTokens ?? 0;
      cur.toolCalls += u.toolCalls ?? 0;
      cur.turns += u.turns ?? 0;
      usage.set(id, cur);
      const b = budgets.get(id);
      if (b && cur.turns > b.maxTurns) return { exceeded: true, reason: `turns ${cur.turns} > ${b.maxTurns}` };
      if (b && cur.outputTokens > b.maxOutputTokens) return { exceeded: true, reason: `output tokens ${cur.outputTokens} > ${b.maxOutputTokens}` };
      return { exceeded: false };
    },
    usage: (id) => ({ ...(usage.get(id) ?? zero()) }),
    reportProvider: () => {},
    snapshot: () => ({ lanes: maxLanes, maxLanes, running, queued: queue.length, circuit: "closed" }),
    release: (id) => void released.push(id),
  };
  return { governor, admits, released, budgets, maxRunning: () => maxRunning };
}

type LoopRequest = Parameters<LLMProvider["runAgentLoop"]>[0];

function fakeLLM(loop: (req: LoopRequest) => Promise<string | AgentLoopResult>) {
  const requests: LoopRequest[] = [];
  const llm: LLMProvider = {
    name: "fake",
    model: "fake-model",
    complete: async () => "",
    structured: async () => {
      throw new LLMError("unused", "invalid_output");
    },
    async runAgentLoop(req) {
      requests.push(req);
      const r = await loop(req);
      return typeof r === "string" ? { text: r, turns: 1, toolCalls: 0, stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 5 } } : r;
    },
  };
  return { llm, requests };
}

function jsonOutput(summary: string, extra: Record<string, unknown> = {}): string {
  return `Done.\n\`\`\`json\n${JSON.stringify({ summary, findings: [], artifacts: [], confidence: 0.8, ...extra })}\n\`\`\``;
}

/** Resolves when the signal aborts, rejecting like a real provider. */
function untilAborted(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal?.aborted) reject(new LLMError("aborted", "aborted"));
    signal?.addEventListener("abort", () => reject(new LLMError("aborted", "aborted")));
  });
}

const BUDGET: AgentBudget = { maxInputTokens: 1e6, maxOutputTokens: 1e6, maxToolCalls: 100, maxTurns: 10, maxWallMs: 60_000, maxRepeatCalls: 10 };

function setup(o: { llm?: LLMProvider | null; lanes?: number; budget?: Partial<AgentBudget>; maxDepth?: number; files?: Record<string, string>; meter?: OrchestratorOptions["meter"] } = {}) {
  const { bus, events } = fakeBus();
  const g = fakeGraph();
  const reg = fakeRegistry(o.files ?? { "src/a.ts": "export const a = 1;\n" });
  const gov = fakeGovernor(o.lanes ?? 8);
  const store = new Map<string, Workspace>();
  const saves: Workspace[] = [];
  const orch = createOrchestrator({
    bus,
    graph: g.graph,
    memory: {} as MemoryService,
    tools: reg.registry,
    llm: o.llm ?? null,
    index: {} as SemanticIndex,
    root: "/tmp/root",
    governor: gov.governor,
    maxDelegationDepth: o.maxDepth ?? 3,
    userId: "local",
    budgetFor: () => ({ ...BUDGET, ...o.budget }),
    getWorkspace: (id) => store.get(id),
    saveWorkspace: (ws) => {
      const copy = structuredClone(ws);
      store.set(ws.id, copy);
      saves.push(copy);
    },
    ...(o.meter ? { meter: o.meter } : {}),
  });
  return { orch, bus, events, ...g, ...reg, ...gov, store, saves };
}

function workspace(plan: PlanStep[], extra: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws_1",
    nodeId: "workspace:ws_1",
    intentId: "in_1",
    intent: "engineering_review",
    label: "Engineering review",
    text: "Review the code",
    priority: "normal",
    status: "ready",
    agents: [],
    tools: [],
    files: ["src/a.ts"],
    resources: [],
    plan,
    outputDir: ".nalara/outputs/ws_1",
    createdAt: "",
    checkpoint: { completedSteps: {} },
    ...extra,
  };
}

const step = (id: string, agent: string, task: string, dependsOn: string[] = []): PlanStep => ({ id, agent, task, dependsOn, tools: [] });

const agentEvents = (events: Recorded[]) => events.filter((e) => e.type.startsWith("agent."));

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("state machine", () => {
  it("allows only the lifecycle transitions", () => {
    const valid: [AgentState, AgentState][] = [
      ["dormant", "summoned"],
      ["summoned", "active"],
      ["active", "collaborating"],
      ["active", "completed"],
      ["collaborating", "completed"],
      ["collaborating", "failed"],
      ["summoned", "terminated"],
      ["active", "terminated"],
      ["collaborating", "terminated"],
      ["completed", "archived"],
      ["failed", "archived"],
      ["terminated", "archived"],
    ];
    const invalid: [AgentState, AgentState][] = [
      ["dormant", "active"],
      ["summoned", "completed"],
      ["completed", "active"],
      ["completed", "terminated"],
      ["failed", "completed"],
      ["archived", "summoned"],
      ["terminated", "active"],
      ["collaborating", "active"],
    ];
    for (const [a, b] of valid) expect(canTransition(a, b), `${a}->${b}`).toBe(true);
    for (const [a, b] of invalid) expect(canTransition(a, b), `${a}->${b}`).toBe(false);
  });

  it("enforces the state machine on instances", async () => {
    const { orch, events } = setup();
    const inst = orch.spawn("code_reviewer", { workspaceId: "ws_1" });
    expect(inst.state).toBe("summoned");
    const done = await orch.assign(inst.instanceId, "Review src/a.ts", { files: ["src/a.ts"] });
    expect(done.state).toBe("completed");
    await expect(orch.assign(inst.instanceId, "again")).rejects.toThrow(/Invalid agent state transition completed -> active/);
    expect(orch.terminate(inst.instanceId)).toBe(false);
    expect(orch.archiveWorkspace("ws_1")).toBe(1);
    expect(orch.instance(inst.instanceId)?.state).toBe("archived");
    await expect(orch.assign(inst.instanceId, "x")).rejects.toThrow(/archived -> active/);
    const transitions = events.filter((e) => e.type === "agent.state").map((e) => `${e.data.from}->${e.data.to}`);
    expect(transitions).toEqual(["dormant->summoned", "summoned->active", "active->collaborating", "collaborating->completed", "completed->archived"]);
  });
});

describe("spawn: identity, scope and delegation depth", () => {
  it("sets scope from the definition; a child never inherits a broad parent scope", () => {
    const { orch, scopes, budgets } = setup();
    const parent = orch.spawn("fullstack_engineer", { workspaceId: "ws_1" });
    expect(scopes.get(parent.instanceId)).toContain("fs.write_file");
    expect(parent.principal).toEqual({ userId: "local", agentId: "fullstack_engineer", instanceId: parent.instanceId, workspaceId: "ws_1", chain: ["user:local", `agent:fullstack_engineer#${parent.instanceId}`], depth: 0 });

    const child = orch.spawn("code_reviewer", { workspaceId: "ws_1", parent: parent.principal });
    expect(scopes.get(child.instanceId)).toEqual(findAgent("code_reviewer")!.tools);
    expect(scopes.get(child.instanceId)).not.toContain("fs.write_file");
    expect(child.principal.chain).toEqual([...parent.principal.chain, `agent:code_reviewer#${child.instanceId}`]);
    expect(child.principal.depth).toBe(1);
    expect(budgets.get(child.instanceId)).toEqual(BUDGET);
  });

  it("a child cannot use a tool only its parent had", async () => {
    const { llm } = fakeLLM(async (req) => {
      const r = await req.callTool("fs.write_file", { path: "src/a.ts", content: "x" });
      return jsonOutput(r.ok ? "wrote" : `denied: ${r.error}`);
    });
    const { orch } = setup({ llm });
    const parent = orch.spawn("fullstack_engineer");
    const child = await orch.runAgent("code_reviewer", "try to write", { parent: parent.principal });
    expect(child.output?.summary).toMatch(/denied: tool "fs.write_file" is outside the scope/);
  });

  it("throws when the delegation depth exceeds the limit", () => {
    const { orch } = setup({ maxDepth: 2 });
    const deep = { userId: "local", chain: ["user:local", "a", "b"], depth: 2 };
    expect(() => orch.spawn("code_reviewer", { parent: deep })).toThrow(/Delegation depth 3 exceeds the limit of 2/);
    expect(() => orch.spawn("qa_engineer", { triggeredBy: "rule:qa-after-review", triggerDepth: 3 })).toThrow(/depth 3/);
    expect(orch.instances()).toEqual([]);
  });

  it("records trigger context and echoes it in agent.finished", async () => {
    const { orch, events } = setup();
    const parent = { userId: "local", chain: ["user:local"], depth: 1 };
    const inst = await orch.runAgent("qa_engineer", "Check coverage for src/a.ts", { triggeredBy: "rule:qa-after-review", files: ["src/a.ts"], parent });
    expect(inst.triggeredBy).toBe("rule:qa-after-review");
    expect(inst.principal.chain).toEqual(["user:local", "trigger:qa-after-review", `agent:qa_engineer#${inst.instanceId}`]);
    expect(inst.principal.depth).toBe(2);
    const finished = events.find((e) => e.type === "agent.finished")!;
    expect(finished.data).toMatchObject({ instanceId: inst.instanceId, agentId: "qa_engineer", success: true, triggeredBy: "rule:qa-after-review", triggerDepth: 2, path: "src/a.ts" });
  });
});

describe("assign: offline and Claude paths", () => {
  it("offline path runs the definition's offline skill through the gateway, emitting events in order", async () => {
    const { orch, events, calls, graph, cleared, released } = setup();
    graph.upsertNode({ id: "workspace:ws_1", type: "workspace", name: "ws" });
    const inst = await orch.runAgent("code_reviewer", "Review src/a.ts", { workspaceId: "ws_1", files: ["src/a.ts"] });
    expect(inst.state).toBe("completed");
    expect(inst.output?.source).toBe("offline");
    expect(inst.output?.summary).toMatch(/^Reviewed 1 of 1 code file/);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.ctx.principal.chain).toEqual(["user:local", `agent:code_reviewer#${inst.instanceId}`]);

    expect(agentEvents(events).map((e) => (e.type === "agent.state" ? `state:${e.data.from}->${e.data.to}` : e.type))).toEqual([
      "state:dormant->summoned",
      "agent.summoned",
      "state:summoned->active",
      "state:active->collaborating",
      "state:collaborating->completed",
      "agent.finished",
    ]);
    const finished = agentEvents(events).at(-1)!;
    expect(finished.data).toMatchObject({ instanceId: inst.instanceId, agentId: "code_reviewer", workspaceId: "ws_1", success: true, summary: inst.output!.summary });
    expect(typeof finished.data.durationMs).toBe("number");
    expect(finished.correlationId).toBe("ws_1");
    expect((graph as unknown as { getNode(id: string): unknown }).getNode("agent:code_reviewer")).toBeTruthy();
    expect(cleared).toContain(inst.instanceId);
    expect(released).toContain(inst.instanceId);
  });

  it("links the agent to its workspace and its artifacts to output nodes", async () => {
    const { llm } = fakeLLM(async (req) => {
      await req.callTool("fs.write_output", { path: "notes.md", content: "x" });
      return jsonOutput("wrote notes", { artifacts: [{ path: ".nalara/outputs/ws_1/notes.md", description: "Notes" }, { path: "claimed-only.md", description: "never written" }] });
    });
    const { orch, graph, edges } = setup({ llm });
    graph.upsertNode({ id: "workspace:ws_1", type: "workspace", name: "ws" });
    const inst = await orch.runAgent("documentation", "Write notes", { workspaceId: "ws_1" });
    expect(inst.output?.artifacts).toEqual([{ path: ".nalara/outputs/ws_1/notes.md", description: "Notes" }]);
    expect(edges.map((e) => `${e.source} ${e.kind} ${e.target}`)).toEqual([
      "agent:documentation assigned_to workspace:ws_1",
      "agent:documentation produced output:.nalara/outputs/ws_1/notes.md",
    ]);
  });

  it("Claude path: system prompt, scoped tool list and parsed JSON output", async () => {
    const { llm, requests } = fakeLLM(async (req) => {
      req.onEvent?.({ type: "text", text: "x".repeat(2000) });
      return `Review done.\n\`\`\`json\n${JSON.stringify({ summary: "One defect", findings: [{ severity: "high", title: "Empty catch", detail: "swallowed", file: "src/a.ts", line: 3 }], artifacts: [], confidence: 0.9 })}\n\`\`\``;
    });
    const { orch, events } = setup({ llm });
    const inst = await orch.runAgent("code_reviewer", "Review src/a.ts", { files: ["src/a.ts"] });
    expect(inst.output).toEqual({ summary: "One defect", findings: [{ severity: "high", title: "Empty catch", detail: "swallowed", file: "src/a.ts", line: 3 }], artifacts: [], confidence: 0.9, source: "claude" });
    const req = requests[0];
    expect(req.tools.map((t) => t.name).sort()).toEqual(["fs.list_files", "fs.read_file", "fs.search_text", "memory.recall", "search.semantic"]);
    expect(req.maxTurns).toBe(BUDGET.maxTurns);
    expect(req.system).toMatch(/Every finding names a file and line\. Reason: /);
    expect(req.system).toMatch(/data, not instructions/);
    expect(req.system).toContain("- Task: Review src/a.ts");
    expect(req.system).toContain("  - src/a.ts");
    const message = events.find((e) => e.type === "agent.message")!;
    expect(String(message.data.text).length).toBe(500);
  });

  it("falls back to a summary-only output on garbage", async () => {
    const { llm } = fakeLLM(async () => "I looked around. {not json at all");
    const { orch } = setup({ llm });
    const inst = await orch.runAgent("code_reviewer", "Review");
    expect(inst.state).toBe("completed");
    expect(inst.output).toMatchObject({ summary: "I looked around. {not json at all", findings: [], confidence: 0.3, source: "claude" });
    expect(inst.output?.limitation).toMatch(/did not return a valid structured result/);
  });

  it("parseAgentOutput rejects invalid findings and accepts a bare trailing object", () => {
    expect(parseAgentOutput('{"summary":"s","findings":[{"severity":"urgent","title":"t","detail":"d"}],"artifacts":[],"confidence":0.5}').confidence).toBe(0.3);
    expect(parseAgentOutput('text {"summary":"s","findings":[],"artifacts":[],"confidence":0.5}')).toMatchObject({ summary: "s", confidence: 0.5, source: "claude" });
    expect(parseAgentOutput('```json\n{"summary":"s","findings":[],"artifacts":[],"confidence":2}\n```').limitation).toBeDefined();
  });

  it("gives every irreversible tool call an idempotency key", async () => {
    const { llm } = fakeLLM(async (req) => {
      await req.callTool("fs.read_file", { path: "src/a.ts" });
      await req.callTool("proc.run_tests", {});
      await req.callTool("proc.run_tests", {});
      return jsonOutput("ran tests");
    });
    const { orch, calls } = setup({ llm });
    const inst = await orch.runAgent("qa_engineer", "Run the tests");
    const keys = calls.map((c) => c.ctx.idempotencyKey);
    expect(keys[0]).toBeUndefined();
    // Keyed by operation and occurrence, not by position: a second identical call is a new occurrence.
    expect(keys[1]).toMatch(new RegExp(`^${inst.instanceId}:proc\\.run_tests:[0-9a-f]{16}:1$`));
    expect(keys[2]).toBe(keys[1]!.replace(/:1$/, ":2"));
    expect(calls.every((c) => c.ctx.signal instanceof AbortSignal)).toBe(true);
  });

  it("keeps an irreversible call's fence key stable across a resumed step that makes other calls first", async () => {
    let extraRead = false;
    const { llm } = fakeLLM(async (req) => {
      if (extraRead) await req.callTool("fs.read_file", { path: "src/a.ts" });
      await req.callTool("proc.run_tests", { filter: "combat" });
      return jsonOutput("ran tests");
    });
    const { orch, calls } = setup({ llm });
    const s1 = step("s1", "qa_engineer", "Run the tests");
    const first = orch.spawn("qa_engineer", { workspaceId: "ws_1" });
    await orch.assign(first.instanceId, "Run the tests", { step: s1 });
    extraRead = true; // the resumed run (a new instance) reads a file before calling the same tool
    const resumed = orch.spawn("qa_engineer", { workspaceId: "ws_1" });
    await orch.assign(resumed.instanceId, "Run the tests", { step: s1 });
    const keys = calls.filter((c) => c.name === "proc.run_tests").map((c) => c.ctx.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^ws_1:s1:proc\.run_tests:[0-9a-f]{16}:1$/);
    expect(keys[1]).toBe(keys[0]); // same logical operation -> the gateway fences the repeat
  });

  it("builds the system prompt with constraint reasons and the pinned plan step", () => {
    const def = findAgent("legal")!;
    const prompt = buildSystemPrompt(def, { task: "Read the contract", files: ["docs/c.md"], step: step("s2", "legal", "Read", ["s1"]) });
    expect(prompt).toMatch(/This is not legal advice; say so in the output\. Reason: users could act/);
    expect(prompt).toContain("- Plan step: s2; depends on s1.");
  });

  it("uses the meter per instance instead of a run lane when one is configured", async () => {
    const { llm } = fakeLLM(async () => jsonOutput("ok"));
    const metered: { id: string; priority: Priority }[] = [];
    const s = setup({
      llm,
      meter: (inner, id, priority) => {
        metered.push({ id, priority });
        return inner;
      },
    });
    s.store.set("ws_1", workspace([], { priority: "high" }));
    const inst = await s.orch.runAgent("code_reviewer", "Review", { workspaceId: "ws_1" });
    expect(metered).toEqual([{ id: inst.instanceId, priority: "high" }]);
    expect(s.admits.map((a) => a.id)).not.toContain(inst.instanceId);
  });
});

describe("stopping runs", () => {
  it("terminate aborts a running LLM loop", async () => {
    let seen: AbortSignal | undefined;
    const { llm } = fakeLLM((req) => {
      seen = req.signal;
      return untilAborted(req.signal);
    });
    const { orch, events, cleared } = setup({ llm });
    const running = orch.runAgent("code_reviewer", "Review forever");
    await vi.waitFor(() => expect(orch.instances({ state: "active" })).toHaveLength(1));
    const id = orch.instances({ state: "active" })[0].instanceId;
    expect(orch.terminate(id, "user stop")).toBe(true);
    const inst = await running;
    expect(inst.state).toBe("terminated");
    expect(inst.error).toBe("user stop");
    expect(seen?.aborted).toBe(true);
    expect(cleared).toContain(id);
    expect(events.some((e) => e.type === "agent.failed" || e.type === "agent.finished")).toBe(false);
    expect(orch.terminate(id)).toBe(false);
  });

  it("terminateAll stops every running instance", async () => {
    const { llm } = fakeLLM((req) => untilAborted(req.signal));
    const { orch } = setup({ llm });
    const runs = [orch.runAgent("code_reviewer", "a"), orch.runAgent("security_agent", "b")];
    orch.spawn("planner"); // summoned, never assigned
    await vi.waitFor(() => expect(orch.instances({ state: "active" })).toHaveLength(2));
    expect(orch.terminateAll("halt")).toBe(3);
    expect((await Promise.all(runs)).map((i) => i.state)).toEqual(["terminated", "terminated"]);
  });

  it("fails the run when the turn budget is exceeded", async () => {
    const { llm } = fakeLLM(async (req) => {
      req.onEvent?.({ type: "turn", turn: 1 });
      req.onEvent?.({ type: "turn", turn: 2 });
      return untilAborted(req.signal);
    });
    const { orch, events } = setup({ llm, budget: { maxTurns: 1 } });
    const inst = await orch.runAgent("code_reviewer", "Review");
    expect(inst.state).toBe("failed");
    expect(inst.error).toBe("budget exceeded: turns 2 > 1");
    expect(events.find((e) => e.type === "agent.failed")?.data).toMatchObject({ success: false, error: "budget exceeded: turns 2 > 1" });
  });

  it("fails the run when the gateway reports an exceeded budget", async () => {
    const { llm } = fakeLLM(async (req) => {
      await req.callTool("fs.read_file", { path: "src/a.ts" });
      return untilAborted(req.signal);
    });
    const s = setup({ llm });
    s.failWithBudget("budget exceeded: tool calls 3 > 2");
    const inst = await s.orch.runAgent("code_reviewer", "Review");
    expect(inst.state).toBe("failed");
    expect(inst.error).toBe("budget exceeded: tool calls 3 > 2");
  });

  it("reaps a run that exceeds its wall-clock budget", async () => {
    vi.useFakeTimers();
    const { llm } = fakeLLM((req) => untilAborted(req.signal));
    const { orch } = setup({ llm, budget: { maxWallMs: 5000 } });
    const running = orch.runAgent("code_reviewer", "Review slowly");
    await vi.advanceTimersByTimeAsync(4999);
    expect(orch.instances({ state: "active" })).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2);
    const inst = await running;
    expect(inst.state).toBe("failed");
    expect(inst.error).toBe("budget exceeded: wall time over 5000 ms");
  });
});

describe("runPlan", () => {
  it("runs the DAG in dependency order with at most two lanes", async () => {
    const log: string[] = [];
    const { llm } = fakeLLM(async (req) => {
      log.push(`start:${req.task}`);
      await new Promise((r) => setTimeout(r, 15));
      log.push(`end:${req.task}`);
      return jsonOutput(`did ${req.task}`);
    });
    const s = setup({ llm, lanes: 2 });
    const ws = workspace([step("s1", "code_reviewer", "a"), step("s2", "security_agent", "b"), step("s3", "qa_engineer", "c"), step("s4", "documentation", "d", ["s1", "s2", "s3"])]);
    s.store.set(ws.id, ws);
    const report = await s.orch.runPlan(ws);

    expect(s.maxRunning()).toBe(2);
    expect(log.slice(0, 2)).toEqual(["start:a", "start:b"]);
    expect(log.indexOf("start:c")).toBeGreaterThan(Math.min(log.indexOf("end:a"), log.indexOf("end:b")));
    expect(log.indexOf("start:d")).toBeGreaterThan(Math.max(log.indexOf("end:a"), log.indexOf("end:b"), log.indexOf("end:c")));

    expect(report.outputs.map((o) => o.agentId)).toEqual(["code_reviewer", "security_agent", "qa_engineer", "documentation"]);
    expect(report.artifactPath).toBe(".nalara/outputs/ws_1/report.md");
    const commanderWrite = s.calls.find((c) => c.name === "fs.write_output" && c.input.path === "report.md")!;
    expect(commanderWrite.ctx.principal.agentId).toBe("commander");

    const wsEvents = s.events.filter((e) => e.type.startsWith("workspace."));
    expect(wsEvents.map((e) => e.type)).toEqual(["workspace.started", "workspace.checkpoint", "workspace.checkpoint", "workspace.checkpoint", "workspace.checkpoint", "workspace.completed"]);
    const saved = s.store.get("ws_1")!;
    expect(saved.status).toBe("completed");
    expect(Object.keys(saved.checkpoint.completedSteps).sort()).toEqual(["s1", "s2", "s3", "s4"]);
    expect(saved.report?.artifactPath).toBe(report.artifactPath);
  });

  it("a failed step skips its dependents only", async () => {
    const { llm, requests } = fakeLLM(async (req) => {
      if (req.task === "breaks") throw new Error("model crashed");
      return jsonOutput(`did ${req.task}`);
    });
    const s = setup({ llm });
    const ws = workspace([step("s1", "code_reviewer", "breaks"), step("s2", "qa_engineer", "after-break", ["s1"]), step("s3", "security_agent", "independent"), step("s4", "documentation", "after-independent", ["s3"])]);
    const report = await s.orch.runPlan(ws);
    expect(requests.map((r) => r.task).sort()).toEqual(["after-independent", "breaks", "independent"]);
    expect(report.outputs.map((o) => o.agentId)).toEqual(["security_agent", "documentation"]);
    const saved = s.store.get("ws_1")!;
    expect(saved.status).toBe("failed");
    expect(saved.error).toMatch(/s1 \(code_reviewer\): model crashed/);
    expect(saved.error).toMatch(/s2 \(qa_engineer\): skipped: depends on s1, which did not complete/);
    const last = s.events.filter((e) => e.type.startsWith("workspace.")).at(-1)!;
    expect(last.type).toBe("workspace.failed");
    expect(last.data.report).toEqual(report);
  });

  it("resumes from the checkpoint: finished steps never run twice", async () => {
    const runs = new Map<string, number>();
    let crash = true;
    const { llm } = fakeLLM(async (req) => {
      runs.set(req.task, (runs.get(req.task) ?? 0) + 1);
      if (req.task === "step two" && crash) throw new Error("kernel crashed");
      return jsonOutput(`did ${req.task}`);
    });
    const s = setup({ llm });
    const ws = workspace([step("s1", "code_reviewer", "step one"), step("s2", "qa_engineer", "step two", ["s1"])]);
    await s.orch.runPlan(ws);
    const afterCrash = s.store.get("ws_1")!;
    expect(Object.keys(afterCrash.checkpoint.completedSteps)).toEqual(["s1"]);

    crash = false;
    const report = await s.orch.runPlan(afterCrash);
    expect(runs.get("step one")).toBe(1);
    expect(runs.get("step two")).toBe(2);
    expect(s.store.get("ws_1")!.status).toBe("completed");
    expect(report.outputs.map((o) => o.agentId)).toEqual(["code_reviewer", "qa_engineer"]);
    const started = s.events.filter((e) => e.type === "workspace.started").at(-1)!;
    expect(started.data.resumedSteps).toEqual(["s1"]);
  });

  it("skips steps with unknown agents or dependencies and still reports", async () => {
    const s = setup();
    const report = await s.orch.runPlan(workspace([step("s1", "no_such_agent", "x"), step("s2", "code_reviewer", "y", ["s9"]), step("s3", "code_reviewer", "Review src/a.ts")]));
    expect(report.outputs.map((o) => o.agentId)).toEqual(["code_reviewer"]);
    expect(s.store.get("ws_1")!.error).toMatch(/s1 \(no_such_agent\): Unknown agent "no_such_agent".*s2 \(code_reviewer\): skipped: depends on unknown step s9/);
  });
});

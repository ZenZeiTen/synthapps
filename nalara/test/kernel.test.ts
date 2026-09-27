/**
 * Kernel integration tests: offline (or scripted-Claude) kernels on a copy of the demo project.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createKernel, type NeuralKernel } from "../src/kernel/kernel";
import { createScriptedProvider, type ScriptedTurn } from "../src/llm/scripted";
import type { AgentFinishedData, AgentInstance, ApprovalRequest, KernelEvent, Workspace } from "../src/kernel/types";

const DEMO = path.resolve(__dirname, "../demo/breath-of-fire-iv-remake");
const temps: string[] = [];

function demoCopy(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "nos-kernel-"));
  cpSync(DEMO, dir, { recursive: true, filter: (src) => !src.split(path.sep).includes(".nalara") });
  temps.push(dir);
  return dir;
}

afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

const approvalOf = (e: KernelEvent) => (e.data as { approval: ApprovalRequest }).approval;

// ---------------------------------------------------------------------------
// The four spec intents, offline
// ---------------------------------------------------------------------------

describe("kernel: the four spec intents offline", () => {
  let root: string;
  let kernel: NeuralKernel;
  const approved: ApprovalRequest[] = [];
  let autoApprove = true;

  beforeAll(async () => {
    root = demoCopy();
    kernel = createKernel({ root, watch: false, useClaude: false }, { llm: null, env: {} });
    await kernel.start();
    // The human in this test approves test runs through the registry, as the UI would.
    kernel.bus.subscribe("tool.approval_requested", (e) => {
      const a = approvalOf(e);
      if (a.tool === "proc.run_tests" && autoApprove) {
        approved.push(a);
        kernel.tools.resolveApproval(a.id, true);
      }
    });
  });

  afterAll(async () => {
    await kernel?.stop();
  });

  async function runIntent(text: string): Promise<Workspace> {
    const { workspace, done } = await kernel.submitIntent(text, { run: true });
    expect(workspace.status).toBe("running");
    const ws = await done;
    await kernel.bus.drain();
    return ws;
  }

  it("starts: indexes the root, seeds memory, loads workflows and reports status", () => {
    const s = kernel.status();
    expect(s.mode).toBe("offline");
    expect(s.root).toBe(root);
    expect(s.projectName).toBe("Breath of Fire IV Remake");
    expect(s.files).toBeGreaterThan(10);
    expect(s.agents.catalog).toBe(kernel.orchestrator.catalog().length);
    expect(s.toolPolicy).toBe("ask");
    expect(s.halted).toBe(false);
    expect(s.audit.chainOk).toBe(true);
    expect(kernel.memory.recall({ category: "coding_standard" }).length).toBeGreaterThan(0);
    expect(kernel.workflows().map((w) => w.id)).toContain("build_pipeline");
    expect(kernel.graph.getNode("workflow:build_pipeline")?.type).toBe("workflow");
    expect(kernel.graph.getNode("mcp:builtin-fs")?.props.status).toBe("connected");
    expect(kernel.bus.history({ types: ["kernel.started"] })).toHaveLength(1);
  });

  it("Review inventory module: engineering review with findings, report and an approved test run", async () => {
    const ws = await runIntent("Review inventory module");
    expect(ws.intent).toBe("engineering_review");
    expect(ws.status).toBe("completed");
    expect(ws.report?.artifactPath).toBe(`${ws.outputDir}/report.md`);
    expect(existsSync(path.join(root, ws.report!.artifactPath!))).toBe(true);
    expect(readFileSync(path.join(root, ws.report!.artifactPath!), "utf8")).toMatch(/Engineering review|Review inventory module/);
    const titles = ws.report!.findings.map((f) => f.title);
    expect(titles.some((t) => /TODO/.test(t))).toBe(true);

    // proc.run_tests needed approval under "ask"; the human approved it and it ran.
    expect(approved.some((a) => a.principal.workspaceId === ws.id && a.principal.agentId === "qa_engineer")).toBe(true);
    const ran = kernel.audit.list({ subject: "proc.run_tests" }).filter((e) => e.kind === "tool_call" && (e.outcome === "ok" || e.outcome === "error"));
    expect(ran.some((e) => e.principal?.workspaceId === ws.id)).toBe(true);
    const qa = ws.report!.outputs.find((o) => o.agentId === "qa_engineer")!;
    expect(qa.output.summary).toMatch(/Tests: passed \(exit 0\)/);

    // Event sequence: intent.classified -> workspace.generated -> agent.summoned -> ... -> workspace.completed
    const events = kernel.bus.history({ limit: 5000 });
    const seqOf = (pred: (e: KernelEvent) => boolean) => events.find(pred)?.seq ?? -1;
    const classified = seqOf((e) => e.type === "intent.classified" && (e.data as { id?: string }).id === ws.intentId);
    const generated = seqOf((e) => e.type === "workspace.generated" && e.correlationId === ws.id);
    const summoned = seqOf((e) => e.type === "agent.summoned" && e.correlationId === ws.id);
    const finished = seqOf((e) => e.type === "agent.finished" && e.correlationId === ws.id);
    const completed = seqOf((e) => e.type === "workspace.completed" && e.correlationId === ws.id);
    expect(classified).toBeGreaterThan(0);
    expect(classified).toBeLessThan(generated);
    expect(generated).toBeLessThan(summoned);
    expect(summoned).toBeLessThan(finished);
    expect(finished).toBeLessThan(completed);
    // Tool events carry the workspace as correlation id.
    expect(events.some((e) => e.type === "tool.called" && e.correlationId === ws.id)).toBe(true);
  });

  it("Review the combat system: the review flags the demo's any, magic number and TODO", async () => {
    const ws = await runIntent("Review the combat system code in src/combat/battle_system.ts and src/combat/damage.ts");
    expect(ws.status).toBe("completed");
    const titles = ws.report!.findings.map((f) => f.title);
    expect(titles).toContain("Use of `any`");
    expect(titles).toContain("Magic number in formula");
    expect(titles.some((t) => /TODO/.test(t))).toBe(true);
  });

  it("Translate contract: legal translation with a glossary resource and an offline limitation", async () => {
    const ws = await runIntent("Translate contract");
    expect(ws.intent).toBe("legal_translation");
    expect(ws.status).toBe("completed");
    expect(ws.files).toContain("contracts/services-agreement.md");
    expect(ws.resources.some((r) => r.startsWith("Glossary: "))).toBe(true);
    expect(readFileSync(path.join(root, ws.outputDir, "glossary.md"), "utf8")).toContain("docs/glossary.md");
    expect(ws.report!.outputs.map((o) => o.agentId)).toEqual(expect.arrayContaining(["legal", "translator"]));
    expect(ws.report!.outputs.find((o) => o.agentId === "translator")?.output.limitation).toMatch(/needs Claude/);
  });

  it("Build inventory feature: the five-agent feature plan completes", async () => {
    const ws = await runIntent("Build inventory feature");
    expect(ws.intent).toBe("feature_build");
    expect(ws.status).toBe("completed");
    expect(ws.agents).toEqual(["planner", "systems_architect", "fullstack_engineer", "qa_engineer", "documentation"]);
    expect(Object.keys(ws.checkpoint.completedSteps).sort()).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    expect(ws.report!.outputs.find((o) => o.agentId === "fullstack_engineer")?.output.limitation).toBeTruthy();
  });

  it("Localize this website to Indonesian: localization with a style guide and the offline limitation", async () => {
    const ws = await runIntent("Localize this website to Indonesian");
    expect(ws.intent).toBe("website_localization");
    expect(ws.status).toBe("completed");
    expect(ws.resources.some((r) => r.startsWith("Style Guide: "))).toBe(true);
    const translator = ws.report!.outputs.find((o) => o.agentId === "translator")!;
    expect(translator.output.limitation).toMatch(/Translation needs Claude/);
    expect(ws.report!.summary.length).toBeGreaterThan(0);
  });

  it("keeps the audit chain intact and records workspace history in memory", () => {
    expect(kernel.audit.verify()).toBeNull();
    expect(kernel.status().audit.chainOk).toBe(true);
    const history = kernel.memory.recall({ category: "project_history", limit: 50 });
    expect(history.length).toBeGreaterThanOrEqual(4);
    expect(kernel.memory.performance("code_reviewer")[0]?.runs).toBeGreaterThan(0);
  });

  it("undoWorkspace restores a file written by fs.write_file in that workspace", async () => {
    const ws = kernel.workspaces.list().find((w) => w.intent === "feature_build")!;
    const file = path.join(root, "src/inventory/inventory.ts");
    const before = readFileSync(file, "utf8");
    const approval = kernel.bus.waitFor("tool.approval_requested", (e) => approvalOf(e).tool === "fs.write_file", 5000);
    const call = kernel.tools.call("fs.write_file", { path: "src/inventory/inventory.ts", content: "// replaced\n" }, { principal: kernel.human(ws.id) });
    kernel.tools.resolveApproval(approvalOf(await approval).id, true);
    const result = await call;
    expect(result.ok).toBe(true);
    expect(readFileSync(file, "utf8")).toBe("// replaced\n");
    expect(kernel.radialActions(ws.nodeId).actions.find((a) => a.id === "undo")?.enabled).toBe(true);

    const undo = await kernel.undoWorkspace(ws.id);
    expect(undo).toEqual({ restored: ["src/inventory/inventory.ts"], skipped: [] });
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(kernel.audit.list({ subject: ws.id }).some((e) => e.kind === "undo" && e.outcome === "ok")).toBe(true);
  });

  it("halt denies a write in progress and terminates running agents; resume lifts it", async () => {
    // A human write waiting for approval, and an agent run waiting on its own approval (proc.run_tests).
    const writeApproval = kernel.bus.waitFor("tool.approval_requested", (e) => approvalOf(e).tool === "fs.write_file", 5000);
    const write = kernel.tools.call("fs.write_file", { path: "halt-test.txt", content: "x" }, { principal: kernel.human() });
    await writeApproval;

    autoApprove = false; // leave the agent's test-run approval pending so the halt catches it mid-run
    const testApproval = kernel.bus.waitFor("tool.approval_requested", (e) => approvalOf(e).tool === "proc.run_tests", 5000);
    const { instance, done } = kernel.startAgent("qa_engineer", "Check test coverage");
    await testApproval;
    expect(kernel.orchestrator.instance(instance.instanceId)?.state).toMatch(/active|collaborating/);

    kernel.halt("test halt");
    const denied = await write;
    expect(denied.ok).toBe(false);
    expect(denied.error).toMatch(/approval denied|halted/);
    expect(existsSync(path.join(root, "halt-test.txt"))).toBe(false);

    const inst: AgentInstance = await done;
    expect(inst.state).toBe("terminated");
    expect(inst.error).toMatch(/halted: test halt/);
    expect(kernel.tools.approvals("pending")).toHaveLength(0);
    expect(kernel.status().halted).toBe(true);
    expect(kernel.audit.list({ subject: "kernel" }).some((e) => e.kind === "halt" && e.detail.reason === "test halt")).toBe(true);
    expect(kernel.bus.history({ types: ["kernel.halted"] }).length).toBe(1);

    // While halted: non-read tools are denied, reads still work, new runs are refused.
    const blocked = await kernel.tools.call("fs.write_output", { path: "x.md", content: "x" }, { principal: kernel.human() });
    expect(blocked.error).toMatch(/halted/);
    const read = await kernel.tools.call("fs.read_file", { path: "README.md" }, { principal: kernel.human() });
    expect(read.ok).toBe(true);
    await expect(kernel.submitIntent("Review inventory module")).rejects.toMatchObject({ status: 409 });
    expect(() => kernel.startAgent("code_reviewer", "x")).toThrow(/halted/);

    kernel.resume();
    autoApprove = true;
    expect(kernel.status().halted).toBe(false);
    expect(kernel.audit.list({ subject: "kernel" }).some((e) => e.kind === "resume")).toBe(true);
    const { done: again } = kernel.startAgent("code_reviewer", "Review src/combat/damage.ts", { files: ["src/combat/damage.ts"] });
    expect((await again).state).toBe("completed");
  });

  it("confirms memory through the kernel with an audit entry", () => {
    const rec = kernel.memory.remember({ category: "preference", key: "tone", content: "friendly", source: "agent:writer#ai_x" });
    expect(rec.status).toBe("proposed");
    const confirmed = kernel.confirmMemory(rec.id)!;
    expect(confirmed.status).toBe("active");
    expect(kernel.audit.list({ subject: rec.id }).some((e) => e.kind === "memory_confirm" && e.outcome === "ok")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Crash-resume with a scripted Claude
// ---------------------------------------------------------------------------

const DONE_JSON = JSON.stringify({ summary: "Scripted agent done.", findings: [], artifacts: [], confidence: 0.8 });

describe("kernel: crash and resume", () => {
  let release: () => void = () => undefined;
  afterEach(() => release());

  it("does not re-run completed steps after a restart", async () => {
    const root = demoCopy();
    const gate = new Promise<void>((r) => (release = r));
    const slow = createScriptedProvider({
      agent: async (req): Promise<ScriptedTurn[]> => {
        if (req.system.includes("You are the Systems Architect agent")) await gate;
        return [{ text: DONE_JSON }];
      },
    });
    const k1 = createKernel({ root, watch: false, triggers: false }, { llm: slow, env: {} });
    await k1.start();
    expect(k1.status().mode).toBe("claude");
    const { workspace } = await k1.submitIntent("Review inventory module");
    // s2 (code reviewer) and s3 (QA, after s2) finish while s1 (architect) hangs.
    await k1.bus.waitFor("workspace.checkpoint", (e) => ((e.data as { completedSteps?: string[] }).completedSteps ?? []).includes("s3"), 10000);
    const mid = k1.workspaces.get(workspace.id)!;
    expect(mid.status).toBe("running");
    expect(Object.keys(mid.checkpoint.completedSteps).sort()).toEqual(["s2", "s3"]);
    await k1.stop(); // "crash": the plan is interrupted mid-way
    release();

    const fast = createScriptedProvider({ agent: [{ text: DONE_JSON }] });
    const k2 = createKernel({ root, watch: false, triggers: false }, { llm: fast, env: {} });
    try {
      await k2.start();
      const resumed = await k2.runWorkspace(workspace.id);
      expect(resumed.status).toBe("completed");
      const loops = fast.calls.filter((c) => c.method === "runAgentLoop");
      expect(loops).toHaveLength(1);
      expect(loops[0].method === "runAgentLoop" && loops[0].req.system).toContain("You are the Systems Architect agent");
      const started = k2.bus.history({ types: ["workspace.started"], correlationId: workspace.id });
      expect((started.at(-1)!.data as { resumedSteps: string[] }).resumedSteps.sort()).toEqual(["s2", "s3"]);
      expect(Object.keys(resumed.checkpoint.completedSteps).sort()).toEqual(["s1", "s2", "s3"]);
      expect(resumed.report?.outputs).toHaveLength(3);
    } finally {
      await k2.stop();
    }
  });

  it("agent memory.remember lands as proposed and is not recalled until confirmed", async () => {
    const root = demoCopy();
    const llm = createScriptedProvider({
      agent: (req) =>
        req.system.includes("You are the Memory Agent agent")
          ? [{ text: "Saving a preference", toolCalls: [{ name: "memory.remember", input: { category: "preference", key: "report_style", content: "Prefer short reports" } }] }, { text: DONE_JSON }]
          : [{ text: DONE_JSON }],
    });
    const k = createKernel({ root, watch: false, triggers: false }, { llm, env: {} });
    try {
      await k.start();
      const inst = await k.orchestrator.runAgent("memory_agent", "Remember that the user prefers short reports");
      expect(inst.state).toBe("completed");
      const all = k.memory.recall({ category: "preference", includeProposed: true });
      const proposed = all.find((r) => r.key === "report_style")!;
      expect(proposed.status).toBe("proposed");
      expect(proposed.source).toBe(`agent:memory_agent#${inst.instanceId}`);
      expect(k.memory.recall({ category: "preference" }).some((r) => r.key === "report_style")).toBe(false);
      expect(k.memory.recall({ text: "short reports" }).some((r) => r.key === "report_style")).toBe(false);

      k.confirmMemory(proposed.id);
      expect(k.memory.recall({ category: "preference" }).find((r) => r.key === "report_style")?.status).toBe("active");
      expect(k.audit.list({ subject: proposed.id }).some((e) => e.kind === "memory_confirm")).toBe(true);
    } finally {
      await k.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// Trigger chain with the watcher on
// ---------------------------------------------------------------------------

describe("kernel: File Changed -> Review -> QA -> Documentation", () => {
  it("runs the chain with a growing delegation chain and depth <= 3", async () => {
    const root = demoCopy();
    const k = createKernel({ root, watch: true, triggers: true, useClaude: false }, { llm: null, env: {} });
    try {
      await k.start();
      k.bus.subscribe("tool.approval_requested", (e) => void k.tools.resolveApproval(approvalOf(e).id, false));
      const docsDone = k.bus.waitFor(
        "agent.finished",
        (e) => (e.data as AgentFinishedData).agentId === "documentation" && (e.data as AgentFinishedData).triggeredBy === "rule:docs-after-qa",
        18000,
      );
      appendFileSync(path.join(root, "src/combat/damage.ts"), "\n// tuning pass\n");
      await docsDone;
      await k.bus.drain();

      const byAgent = (agentId: string) => k.orchestrator.instances({ agentId }).find((i) => i.triggeredBy?.startsWith("rule:"))!;
      const review = byAgent("code_reviewer");
      const qa = byAgent("qa_engineer");
      const docs = byAgent("documentation");
      expect(review.triggeredBy).toBe("rule:review-on-change");
      expect(qa.triggeredBy).toBe("rule:qa-after-review");
      expect(docs.triggeredBy).toBe("rule:docs-after-qa");
      expect([review.principal.depth, qa.principal.depth, docs.principal.depth]).toEqual([1, 2, 3]);
      expect(review.principal.chain).toEqual([`user:${k.config.userId}`, "trigger:review-on-change", `agent:code_reviewer#${review.instanceId}`]);
      expect(qa.principal.chain).toEqual([...review.principal.chain, "trigger:qa-after-review", `agent:qa_engineer#${qa.instanceId}`]);
      expect(docs.principal.chain).toEqual([...qa.principal.chain, "trigger:docs-after-qa", `agent:documentation#${docs.instanceId}`]);
      expect(Math.max(...[review, qa, docs].map((i) => i.principal.depth))).toBeLessThanOrEqual(3);

      const fired = k.bus.history({ types: ["trigger.fired"] }).map((e) => e.data as { ruleId: string; depth: number; path?: string });
      expect(fired.map((f) => f.ruleId)).toEqual(["review-on-change", "qa-after-review", "docs-after-qa"]);
      expect(fired.map((f) => f.depth)).toEqual([1, 2, 3]);
      expect(fired.every((f) => f.path === "src/combat/damage.ts")).toBe(true);
    } finally {
      await k.stop();
    }
  });

  it("writes into .nalara never trigger the chain", async () => {
    const root = demoCopy();
    const k = createKernel({ root, watch: true, triggers: true, useClaude: false }, { llm: null, env: {} });
    try {
      await k.start();
      writeFileSync(path.join(root, ".nalara", "outputs-note.ts"), "export const x = 1;\n");
      await new Promise((r) => setTimeout(r, 2500));
      expect(k.bus.history({ types: ["trigger.fired"] })).toHaveLength(0);
    } finally {
      await k.stop();
    }
  });
});

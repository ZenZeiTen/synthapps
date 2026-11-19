/**
 * Intent output: a run in a project without tests does not stall on a pointless approval, and every finished run
 * leaves a report the user can open (Reports/ in the Nalara home), also in the readonly ("safe") tool policy.
 */
import { afterAll, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createEventBus } from "../src/events/bus";
import { createTriggerEngine } from "../src/events/triggers";
import { createKernel, type NeuralKernel } from "../src/kernel/kernel";
import { LLMError, type KernelEvent, type TriggerAction, type Workspace } from "../src/kernel/types";
import { createScriptedProvider } from "../src/llm/scripted";
import { reportFileName } from "../src/workspace/reports";

const DEMO = path.resolve(__dirname, "../demo/lantern-road");
const temps: string[] = [];
const kernels: NeuralKernel[] = [];

afterAll(async () => {
  for (const k of kernels) await k.stop().catch(() => undefined);
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

function demoCopy(opts: { withoutTests?: boolean } = {}): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "nos-output-"));
  cpSync(DEMO, dir, { recursive: true, filter: (src) => !src.split(path.sep).includes(".nalara") });
  if (opts.withoutTests) {
    const pkgPath = path.join(dir, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
      delete pkg.scripts?.test;
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    }
    rmSync(path.join(dir, "pyproject.toml"), { force: true });
  }
  temps.push(dir);
  return dir;
}

async function boot(root: string, llm: ReturnType<typeof createScriptedProvider> | null = null, env: Record<string, string> = {}) {
  const kernel = createKernel({ root, watch: false, triggers: false, useClaude: !!llm }, { llm, env });
  kernels.push(kernel);
  await kernel.start();
  return kernel;
}

async function run(kernel: NeuralKernel, text: string): Promise<Workspace> {
  const { done } = await kernel.submitIntent(text, { run: true });
  const ws = await done;
  await kernel.bus.drain();
  return kernel.workspaces.get(ws.id)!;
}

describe("a project without tests", () => {
  it("finishes without asking to approve a test run that could not do anything", async () => {
    const root = demoCopy({ withoutTests: true });
    const kernel = await boot(root);
    const asked: KernelEvent[] = [];
    kernel.bus.subscribe("tool.approval_requested", (e) => void asked.push(e));
    const started = Date.now();
    const ws = await run(kernel, "Review inventory module");
    expect(ws.status).toBe("completed");
    expect(asked).toEqual([]);
    expect(Date.now() - started).toBeLessThan(30_000);
    // The QA agent's call failed at once, before approval, and is in the audit log.
    const calls = kernel.audit.list({ subject: "proc.run_tests" }).filter((e) => e.kind === "tool_call");
    expect(calls.some((e) => e.outcome === "error" && e.detail?.via === "precheck")).toBe(true);
  });
});

describe("reports", () => {
  it("are saved in the Reports folder, and the results point there", async () => {
    const root = demoCopy({ withoutTests: true });
    const kernel = await boot(root);
    const ws = await run(kernel, "Review inventory module");
    expect(ws.report?.artifactPath).toMatch(/^Reports\/\d{4}-\d\d-\d\d \d{4} Engineering review \(ws_[a-z0-9]+\)\.md$/);
    const text = readFileSync(path.join(root, ws.report!.artifactPath!), "utf8");
    expect(text).toMatch(/^# Commander report: Engineering review/);
    expect(text).toContain("Review inventory module");
    // Visible in Files.
    const listing = await kernel.files.list("home", "Reports");
    expect(listing.entries.map((e) => e.path)).toContain(ws.report!.artifactPath);
  });

  it("are saved in readonly mode too, where agents may not write", async () => {
    const root = demoCopy();
    const kernel = await boot(root);
    kernel.setPolicy({ ...kernel.tools.policy(), mode: "readonly" });
    const ws = await run(kernel, "Review inventory module");
    expect(ws.status).toBe("completed");
    // The agents' own write was refused...
    expect(existsSync(path.join(root, `${ws.outputDir}/report.md`))).toBe(false);
    // ...but the user still gets the report.
    expect(ws.report?.artifactPath).toMatch(/^Reports\//);
    expect(existsSync(path.join(root, ws.report!.artifactPath!))).toBe(true);
  });

  it("get names that are safe on Windows and sort by time", () => {
    const at = new Date(2026, 10, 19, 8, 5);
    expect(reportFileName({ id: "ws_abc123", label: "Engineering review" }, at)).toBe("2026-11-19 0805 Engineering review (ws_abc123).md");
    expect(reportFileName({ id: "ws_1", label: 'Fix a/b: "c"? <d>|*. ' }, at)).toBe("2026-11-19 0805 Fix a-b- -c-- -d--- (ws_1).md");
    expect(reportFileName({ id: "ws_1", label: "" }, at)).toBe("2026-11-19 0805 Report (ws_1).md");
  });

  it("never start trigger rules", async () => {
    const bus = createEventBus();
    const calls: TriggerAction[] = [];
    const rule = { id: "md", name: "Any Markdown", on: "file.created" as const, when: { pathGlob: "**/*.md" }, then: { kind: "run_agent" as const, agentId: "documentation", task: "x" }, enabled: true };
    const engine = createTriggerEngine({ bus, rules: [rule], fileDebounceMs: 5, executor: async (a) => void calls.push(a) });
    engine.start();
    bus.publish("file.created", { path: "Reports/2026-11-19 0805 Engineering review (ws_1).md" });
    bus.publish("file.created", { path: "Notes/today.md" });
    await new Promise((r) => setTimeout(r, 40));
    await bus.drain();
    engine.stop();
    expect(calls).toHaveLength(1);
  });
});

describe("web access for agents", () => {
  const DONE = JSON.stringify({ summary: "Scripted agent done.", findings: [], artifacts: [], confidence: 0.8 });

  it("Claude-backed agents get web search and web.fetch", async () => {
    const llm = createScriptedProvider({ agent: [{ text: DONE }] });
    const kernel = await boot(demoCopy({ withoutTests: true }), llm);
    await run(kernel, "Review inventory module");
    const loops = llm.calls.filter((c) => c.method === "runAgentLoop").map((c) => c.req as { serverTools?: string[]; tools: { name: string }[] });
    expect(loops.length).toBeGreaterThan(0);
    for (const req of loops) {
      expect(req.serverTools).toEqual(["web_search"]);
      expect(req.tools.map((t) => t.name)).toContain("web.fetch");
    }
  });

  it("an agent works on without web search when the organization turns it off", async () => {
    let refused = 0;
    const llm = createScriptedProvider({
      agent: async (req) => {
        if (req.serverTools?.length) {
          refused++;
          throw new LLMError("web_search is not enabled for this organization", "api");
        }
        return [{ text: DONE }];
      },
    });
    const kernel = await boot(demoCopy({ withoutTests: true }), llm);
    const ws = await run(kernel, "Review inventory module");
    expect(refused).toBeGreaterThan(0);
    expect(ws.status).toBe("completed");
  });

  it("NALARA_WEB_TOOLS=0 turns web access off", async () => {
    const llm = createScriptedProvider({ agent: [{ text: DONE }] });
    const kernel = await boot(demoCopy({ withoutTests: true }), llm, { NALARA_WEB_TOOLS: "0" });
    expect(kernel.tools.get("web.fetch")).toBeUndefined();
    await run(kernel, "Review inventory module");
    const loops = llm.calls.filter((c) => c.method === "runAgentLoop").map((c) => c.req as { serverTools?: string[] });
    for (const req of loops) expect(req.serverTools ?? []).toEqual([]);
  });
});

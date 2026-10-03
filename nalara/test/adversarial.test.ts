import { afterAll, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createKernel, type NeuralKernel } from "../src/kernel/kernel";
import { createScriptedProvider, type AgentLoopRequest, type ScriptedTurn } from "../src/llm/scripted";
import type { Finding, StepReview, Workspace } from "../src/kernel/types";

const DEMO = path.resolve(__dirname, "../demo/breath-of-fire-iv-remake");
const temps: string[] = [];
const kernels: NeuralKernel[] = [];

function demoCopy(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "nos-adv-"));
  cpSync(DEMO, dir, { recursive: true, filter: (src) => !src.split(path.sep).includes(".nalara") });
  temps.push(dir);
  return dir;
}

afterAll(async () => {
  for (const k of kernels) await k.stop().catch(() => undefined);
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

const done = (summary: string, findings: Finding[] = []) => JSON.stringify({ summary, findings, artifacts: [], confidence: 0.8 });
const isBuilder = (req: AgentLoopRequest) => req.system.includes("You are the Fullstack Engineer agent");
const isCritic = (req: AgentLoopRequest) => req.system.includes("You are the Code Reviewer agent");
/** The artifact path the critic task names ("Artifacts under review: a, b"). */
const artifactOf = (req: AgentLoopRequest) => /Artifacts under review: ([^\n,]+)/.exec(req.task)?.[1]?.trim() ?? "";

const BUILD: ScriptedTurn[] = [
  { text: "Writing the discount module", toolCalls: [{ name: "fs.write_output", input: { path: "discount.ts", content: "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n" } }] },
  { text: done("Implemented discount.ts") },
];

/** Critic findings per call (the last entry repeats). */
function provider(criticRounds: ((artifact: string) => Finding[])[]) {
  let criticCalls = 0;
  return createScriptedProvider({
    agent: (req): ScriptedTurn[] => {
      if (isBuilder(req)) return BUILD;
      if (isCritic(req)) {
        const findings = criticRounds[Math.min(criticCalls++, criticRounds.length - 1)](artifactOf(req));
        return [{ text: done(findings.length ? "Found problems" : "Looks good", findings) }];
      }
      return [{ text: done("Scripted agent done.") }];
    },
  });
}

async function run(opts: { critic: ((artifact: string) => Finding[])[]; maxRounds?: number; fleetBudget?: Record<string, number> }) {
  const root = demoCopy();
  const llm = provider(opts.critic);
  const kernel = createKernel(
    {
      root,
      watch: false,
      triggers: false,
      adversarial: { enabled: true, maxRounds: opts.maxRounds ?? 3, blockingSeverity: "high", critics: { fullstack_engineer: ["code_reviewer"] } },
      ...(opts.fleetBudget ? { fleetBudget: opts.fleetBudget } : {}),
    },
    { llm, env: {} },
  );
  kernels.push(kernel);
  await kernel.start();
  const { workspace, done: finished } = await kernel.submitIntent("Implement a new feature: shop discounts");
  const ws: Workspace = await finished;
  return { kernel, llm, workspace, ws };
}

const high = (file: string, line: number, title = "Off-by-one in discount"): Finding => ({ severity: "high", title, detail: "The discount applies twice.", file, line });

describe("adversarial review: build -> attack -> converge", () => {
  it("sends the builder back when a critic raises a verified blocking challenge, and converges when the next round survives", async () => {
    const { kernel, ws } = await run({ critic: [(a) => [high(a, 2)], () => []] });
    expect(ws.status).toBe("completed");
    const review = ws.checkpoint.completedSteps.s3.review as StepReview;
    expect(review).toMatchObject({ stepId: "s3", builderId: "fullstack_engineer", critics: ["code_reviewer"], verdict: "survived", rounds: 2, open: [] });
    expect(review.history.map((h) => h.blocking)).toEqual([1, 0]);
    expect(ws.report?.reviews?.map((r) => r.verdict)).toEqual(["survived"]);
    expect(ws.report?.summary).toMatch(/Adversarial review: 1 builder step\(s\), 1 survived/);

    // Process tree: round 2 builder descends from round 1; each critic descends from the builder it attacked.
    const tree = kernel.fleetTree(ws.id);
    const builders = tree.nodes.filter((n) => n.role === "builder").sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
    const critics = tree.nodes.filter((n) => n.role === "critic").sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
    expect(builders.map((b) => b.round)).toEqual([1, 2]);
    expect(builders[1].parentInstanceId).toBe(builders[0].instanceId);
    expect(critics.map((c) => c.parentInstanceId)).toEqual([builders[0].instanceId, builders[1].instanceId]);
    expect(critics[0].depth).toBe(1);
    expect(tree.edges).toEqual(expect.arrayContaining([{ parent: builders[0].instanceId, child: critics[0].instanceId }]));
    expect(tree.nodes.find((n) => n.role === "commander")).toBeTruthy();

    // Relay: every hop is a message, the challenge went from the critic to the builder it attacked.
    const msgs = kernel.relay.list({ workspaceId: ws.id });
    const kinds = new Set(msgs.map((m) => m.kind));
    for (const k of ["spawn", "handoff", "challenge", "verdict", "result"]) expect(kinds.has(k as never)).toBe(true);
    const challenge = msgs.find((m) => m.kind === "challenge")!;
    expect(challenge).toMatchObject({ fromInstanceId: critics[0].instanceId, toInstanceId: builders[0].instanceId, stepId: "s3", round: 1 });
    expect(challenge.data).toMatchObject({ severity: "high", evidence: "verified" });
    // The round 2 builder was told about the challenge, as data.
    expect(builders[1].task).toMatch(/Adversarial round 2/);
    expect(builders[1].task).toMatch(/Off-by-one in discount/);

    // Audit and fleet memory.
    const verdicts = kernel.audit.list({ limit: 5000 }).filter((e) => e.kind === "verdict");
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({ subject: `${ws.id}:s3`, outcome: "ok" });
    expect(kernel.audit.list({ limit: 5000 }).some((e) => e.kind === "relay")).toBe(true);
    expect(kernel.audit.verify()).toBeNull();
    const records = kernel.fleet.records({ workspaceId: ws.id });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ verdict: "survived", rounds: 2, agentId: "fullstack_engineer" });
  });

  it("reports unresolved work as a high finding when rounds run out, and later fleets are told about it", async () => {
    const { kernel, llm, ws } = await run({ critic: [(a) => [high(a, 2)]], maxRounds: 2 });
    expect(ws.status).toBe("completed");
    const review = ws.checkpoint.completedSteps.s3.review as StepReview;
    expect(review.verdict).toBe("unresolved");
    expect(review.rounds).toBe(2);
    expect(review.open).toHaveLength(1);
    expect(review.open[0]).toMatchObject({ criticId: "code_reviewer", evidence: "verified", blocking: true });
    const top = ws.report!.findings.find((f) => /did not survive adversarial review/.test(f.title));
    expect(top?.severity).toBe("high");
    expect(kernel.audit.list({ limit: 5000 }).find((e) => e.kind === "verdict")?.outcome).toBe("error");

    // Fleet memory: a later run on the same file gets the open challenge in its pinned context.
    const artifact = review.open[0].finding.file!;
    const { done: later } = kernel.startAgent("fullstack_engineer", "Follow up on the discount module", { files: [artifact] });
    await later;
    const loops = llm.calls.filter((c) => c.method === "runAgentLoop");
    const last = loops[loops.length - 1];
    expect(last.method === "runAgentLoop" && last.req.system).toContain("Fleet memory");
    expect(last.method === "runAgentLoop" && last.req.system).toContain("unresolved after 2 round(s)");
  });

  it("settles disagreements on evidence: unverified or off-target challenges do not block", async () => {
    const { ws } = await run({
      critic: [(a) => [high(a, 999, "Phantom line"), high("src/combat/damage.ts", 1, "Not this step's work"), { severity: "critical", title: "No citation", detail: "Trust me." }]],
    });
    const review = ws.checkpoint.completedSteps.s3.review as StepReview;
    expect(review).toMatchObject({ verdict: "survived", rounds: 1, open: [] });
    const criticOut = ws.checkpoint.completedSteps.s3.critics?.[0].output;
    const byTitle = Object.fromEntries((criticOut?.findings ?? []).map((f) => [f.title, f.evidence]));
    expect(byTitle).toEqual({ "Phantom line": "unverified", "Not this step's work": "verified", "No citation": "none" });
    // Non-blocking challenges still reach the report, with their evidence status.
    expect(ws.report!.findings.find((f) => f.title === "Phantom line")?.evidence).toBe("unverified");
  });

  it("enforces the fleet budget across the whole run", async () => {
    const { kernel, ws } = await run({ critic: [() => []], fleetBudget: { maxAgents: 3 } });
    expect(ws.status).toBe("failed");
    expect(ws.error).toMatch(/fleet budget: agents 4 > 3/);
    expect(kernel.audit.list({ limit: 5000 }).some((e) => e.kind === "budget" && (e.detail as { fleet?: boolean }).fleet)).toBe(true);
    const obs = kernel.observatory();
    const row = obs.workspaces.find((w) => w.workspaceId === ws.id);
    expect(row?.fleet?.exceeded).toMatch(/agents 4 > 3/);
  });

  it("can be switched off: builder steps then run once with no critics", async () => {
    const root = demoCopy();
    const llm = provider([() => []]);
    const kernel = createKernel({ root, watch: false, triggers: false, adversarial: { enabled: false } }, { llm, env: {} });
    kernels.push(kernel);
    await kernel.start();
    const { done: finished } = await kernel.submitIntent("Implement a new feature: shop discounts");
    const ws = await finished;
    expect(ws.status).toBe("completed");
    expect(ws.report?.reviews ?? []).toHaveLength(0);
    expect(kernel.fleetTree(ws.id).nodes.some((n) => n.role === "critic")).toBe(false);
  });
});

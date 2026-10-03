import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGovernor } from "../src/agents/governor";
import { createEventBus } from "../src/events/bus";
import { createEvidenceChecker } from "../src/fleet/evidence";
import { createRelay, MAX_RELAY_BODY_CHARS, RelayBudgetError } from "../src/fleet/relay";
import { createFleetStore } from "../src/fleet/store";
import { createAuditLog } from "../src/kernel/audit";
import { openDatabase } from "../src/kernel/db";
import type { AgentUsage, Challenge, FleetBudget, KernelEvent, StepReview } from "../src/kernel/types";

const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

const usage = (n = 0): AgentUsage => ({ inputTokens: n, outputTokens: n, toolCalls: n, turns: n, wallMs: n });

describe("evidence check", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "nos-evidence-"));
  temps.push(root);
  mkdirSync(path.join(root, "src"));
  writeFileSync(path.join(root, "src/a.ts"), "one\ntwo\nthree\n");
  writeFileSync(path.join(root, "src/empty.ts"), "");
  const outside = mkdtempSync(path.join(os.tmpdir(), "nos-evidence-out-"));
  temps.push(outside);
  writeFileSync(path.join(outside, "secret.ts"), "x\n");
  symlinkSync(path.join(outside, "secret.ts"), path.join(root, "src/link.ts"));
  const check = createEvidenceChecker(root);

  it("verifies a cited file and a cited line inside it", async () => {
    expect(await check({ file: "src/a.ts" })).toMatchObject({ status: "verified" });
    expect(await check({ file: "src/a.ts", line: 3 })).toMatchObject({ status: "verified", note: "src/a.ts:3 exists" });
    expect(await check({ file: "./src/a.ts", line: 1 })).toMatchObject({ status: "verified" });
  });

  it("rejects lines past the end, missing files and paths that leave the root", async () => {
    expect((await check({ file: "src/a.ts", line: 4 })).note).toMatch(/past the end of src\/a.ts \(3 lines\)/);
    expect(await check({ file: "src/empty.ts", line: 1 })).toMatchObject({ status: "unverified" });
    expect(await check({ file: "src/a.ts", line: 0 })).toMatchObject({ status: "unverified" });
    expect(await check({ file: "src/missing.ts" })).toMatchObject({ status: "unverified", note: expect.stringMatching(/does not exist/) });
    expect(await check({ file: "../etc/passwd" })).toMatchObject({ status: "unverified", note: expect.stringMatching(/outside/) });
    expect(await check({ file: "/etc/passwd" })).toMatchObject({ status: "unverified" });
    expect(await check({ file: "src/link.ts", line: 1 })).toMatchObject({ status: "unverified", note: expect.stringMatching(/resolves outside/) });
    expect(await check({ file: "src" })).toMatchObject({ status: "unverified", note: expect.stringMatching(/not a file/) });
  });

  it("reports none when nothing is cited", async () => {
    expect(await check({})).toEqual({ status: "none", note: "no file cited" });
    expect(await check({ file: "  " })).toMatchObject({ status: "none" });
  });
});

describe("fleet store", () => {
  const base = { name: "X", chain: ["user:local"], depth: 0, usage: usage() };

  it("keeps the process tree durably: parent edges, roots and live updates", () => {
    const db = openDatabase(":memory:");
    const fleet = createFleetStore({ db });
    fleet.upsertNode({ ...base, instanceId: "a", agentId: "fullstack_engineer", workspaceId: "ws", role: "builder", state: "summoned", stepId: "s1", round: 1 });
    fleet.upsertNode({ ...base, instanceId: "b", agentId: "code_reviewer", workspaceId: "ws", role: "critic", state: "summoned", parentInstanceId: "a", round: 1, depth: 1 });
    fleet.upsertNode({ ...base, instanceId: "c", agentId: "fullstack_engineer", workspaceId: "ws", role: "builder", state: "summoned", parentInstanceId: "a", round: 2 });
    fleet.upsertNode({ ...base, instanceId: "z", agentId: "qa_engineer", workspaceId: "other", role: "worker", state: "summoned", parentInstanceId: "a" });
    fleet.updateNode("b", { state: "completed", summary: "found 1 issue", usage: usage(5) });
    expect(fleet.updateNode("missing", { state: "failed" })).toBeUndefined();

    const tree = fleet.tree("ws");
    expect(tree.nodes.map((n) => n.instanceId)).toEqual(["a", "b", "c"]);
    expect(tree.edges).toEqual([
      { parent: "a", child: "b" },
      { parent: "a", child: "c" },
    ]);
    expect(tree.roots).toEqual(["a"]);
    // A parent outside the workspace makes the node a root of its own tree.
    expect(fleet.tree("other").roots).toEqual(["z"]);
    expect(fleet.node("b")).toMatchObject({ state: "completed", summary: "found 1 issue", usage: usage(5), role: "critic", round: 1, depth: 1 });
    expect(fleet.nodes({ parentInstanceId: "a" }).map((n) => n.instanceId)).toEqual(["b", "c", "z"]);

    const ws = fleet.usageByWorkspace().find((u) => u.workspaceId === "ws")!;
    expect(ws).toMatchObject({ agents: 3, byRole: { builder: 2, critic: 1 }, failed: 0 });
    expect(ws.usage.toolCalls).toBe(5);
  });

  it("records reviews as fleet memory, found again by file", () => {
    const fleet = createFleetStore({ db: openDatabase(":memory:") });
    const challenge: Challenge = {
      finding: { severity: "high", title: "Off by one", detail: "d", file: "src/a.ts", line: 2 },
      criticId: "code_reviewer",
      criticInstanceId: "ai_c",
      round: 2,
      evidence: "verified",
      evidenceNote: "ok",
      blocking: true,
    };
    const review: StepReview = { workspaceId: "ws1", stepId: "s3", builderId: "fullstack_engineer", critics: ["code_reviewer"], rounds: 2, verdict: "unresolved", reason: "r", open: [challenge], history: [] };
    const rec = fleet.recordReview(review, ["src/a.ts", "src/a.ts", "src/b.ts"], "Implemented the thing");
    expect(rec).toMatchObject({ verdict: "unresolved", rounds: 2, files: ["src/a.ts", "src/b.ts"], open: [{ severity: "high", title: "Off by one", file: "src/a.ts", line: 2 }] });
    fleet.recordReview({ ...review, workspaceId: "ws2", verdict: "survived", open: [] }, ["src/c.ts"], "Other");
    expect(fleet.records({ files: ["src/b.ts"] }).map((r) => r.workspaceId)).toEqual(["ws1"]);
    expect(fleet.records({ files: ["src/a.ts", "src/c.ts"] })).toHaveLength(2);
    expect(fleet.records({ workspaceId: "ws2" })).toHaveLength(1);
    expect(fleet.records({ files: ["nope.ts"] })).toEqual([]);
  });
});

describe("relay", () => {
  function setup(charge?: (ws: string) => string | undefined) {
    const db = openDatabase(":memory:");
    const bus = createEventBus({ db });
    const audit = createAuditLog({ db });
    const events: KernelEvent[] = [];
    bus.subscribe("relay.message", (e) => {
      events.push(e);
    });
    return { db, bus, audit, events, relay: createRelay({ db, bus, audit, ...(charge ? { charge } : {}) }) };
  }

  it("numbers, persists, audits and publishes every message", async () => {
    const { relay, audit, bus, events } = setup();
    const m1 = relay.send({ workspaceId: "ws", kind: "spawn", from: "kernel", to: "agent:a#1", toInstanceId: "1", body: "do it" });
    const m2 = relay.send({ workspaceId: "ws", kind: "challenge", from: "agent:c#2", to: "agent:a#1", fromInstanceId: "2", toInstanceId: "1", stepId: "s1", round: 1, body: "x".repeat(MAX_RELAY_BODY_CHARS + 10), refs: ["a.ts", "a.ts"] });
    relay.send({ workspaceId: "other", kind: "result", from: "agent:q#3", to: "commander", fromInstanceId: "3", body: "done" });
    expect([m1.seq, m2.seq]).toEqual([1, 2]);
    expect(m2.body).toHaveLength(MAX_RELAY_BODY_CHARS);
    expect(m2.refs).toEqual(["a.ts"]);
    expect(relay.list({ workspaceId: "ws" }).map((m) => m.kind)).toEqual(["spawn", "challenge"]);
    expect(relay.list({ instanceId: "1" })).toHaveLength(2);
    expect(relay.list({ kind: ["result"] })).toHaveLength(1);
    expect(relay.list({ sinceSeq: 2 })).toHaveLength(1);
    expect(relay.count("ws")).toBe(2);
    expect(audit.list().filter((e) => e.kind === "relay")).toHaveLength(3);
    await bus.drain();
    expect(events.map((e) => (e.data as { kind: string }).kind)).toEqual(["spawn", "challenge", "result"]);
    expect(events[1].correlationId).toBe("ws");
  });

  it("continues numbering after a restart on the same database", () => {
    const { db, bus, audit, relay } = setup();
    relay.send({ kind: "verdict", from: "kernel", to: "step:s1", body: "survived" });
    const again = createRelay({ db, bus, audit });
    expect(again.send({ kind: "verdict", from: "kernel", to: "step:s2", body: "x" }).seq).toBe(2);
  });

  it("refuses a message when the fleet's message budget is spent, and audits the refusal", () => {
    let left = 1;
    const { relay, audit } = setup(() => (left-- > 0 ? undefined : "fleet budget: relay messages 2 > 1"));
    relay.send({ workspaceId: "ws", kind: "spawn", from: "kernel", to: "agent:a#1", body: "" });
    expect(() => relay.send({ workspaceId: "ws", kind: "spawn", from: "kernel", to: "agent:b#2", body: "" })).toThrow(RelayBudgetError);
    expect(relay.count("ws")).toBe(1);
    expect(audit.list().some((e) => e.kind === "relay" && e.outcome === "denied")).toBe(true);
    // Messages outside a workspace are not charged to any fleet.
    expect(relay.send({ kind: "result", from: "agent:x#9", to: "commander", body: "" }).seq).toBe(2);
  });
});

describe("governor: fleet budgets", () => {
  const BUDGET = { maxInputTokens: 1e9, maxOutputTokens: 1e9, maxToolCalls: 1e9, maxTurns: 1e9, maxWallMs: 1e9, maxRepeatCalls: 1e9 };
  const FLEET: FleetBudget = { maxAgents: 2, maxInputTokens: 100, maxOutputTokens: 100, maxToolCalls: 3, maxMessages: 2 };

  it("counts agents, tool calls, tokens and messages across every instance of a fleet", () => {
    const db = openDatabase(":memory:");
    const audit = createAuditLog({ db });
    const gov = createGovernor({ maxLanes: 2, audit });
    gov.setFleetBudget!("ws", FLEET);
    expect(gov.assignFleet!("a", "ws")).toEqual({ exceeded: false });
    expect(gov.assignFleet!("b", "ws")).toEqual({ exceeded: false });
    gov.setBudget("a", BUDGET);
    gov.setBudget("b", BUDGET);
    expect(gov.charge("a", { toolCalls: 2 }).exceeded).toBe(false);
    // b alone is far under its own budget, but the fleet is over.
    const over = gov.charge("b", { toolCalls: 2 });
    expect(over).toEqual({ exceeded: true, reason: "fleet budget: tool calls 4 > 3" });
    expect(gov.charge("a", {}).exceeded).toBe(true);
    expect(gov.fleetUsage!("ws")).toMatchObject({ usage: { agents: 2, toolCalls: 4 }, exceeded: "tool calls 4 > 3" });
    expect(audit.list().some((e) => e.kind === "budget" && (e.detail as { fleet?: boolean }).fleet === true)).toBe(true);
  });

  it("refuses an agent beyond maxAgents and a message beyond maxMessages; a new run resets the fleet", () => {
    const gov = createGovernor({ maxLanes: 2 });
    gov.setFleetBudget!("ws", FLEET);
    gov.assignFleet!("a", "ws");
    gov.assignFleet!("b", "ws");
    expect(gov.assignFleet!("c", "ws")).toEqual({ exceeded: true, reason: "fleet budget: agents 3 > 2" });
    gov.setFleetBudget!("ws", FLEET);
    expect(gov.chargeFleet!("ws", { messages: 2 })).toEqual({ exceeded: false });
    expect(gov.chargeFleet!("ws", { messages: 1 })).toEqual({ exceeded: true, reason: "fleet budget: relay messages 3 > 2" });
    // Fleets without a budget only count.
    expect(gov.assignFleet!("x", "free")).toEqual({ exceeded: false });
    expect(gov.fleetUsage!("free")?.usage.agents).toBe(1);
    expect(gov.fleetUsage!("unknown")).toBeUndefined();
  });

  it("charges the fleet only for instances assigned to it", () => {
    const gov = createGovernor({ maxLanes: 1 });
    gov.setFleetBudget!("ws", FLEET);
    gov.setBudget("solo", BUDGET);
    expect(gov.charge("solo", { toolCalls: 50, inputTokens: 1000 }).exceeded).toBe(false);
    expect(gov.fleetUsage!("ws")?.usage.toolCalls).toBe(0);
  });
});

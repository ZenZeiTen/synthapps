import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AuditEntry, AuditLog, EventBus, EventType, Governor, KernelEvent, Principal, ToolDefinition, ToolPolicy, ToolRegistry } from "../src/kernel/types";
import { createToolRegistry, stableStringify, toolHash } from "../src/tools/registry";

// --- in-test fakes -----------------------------------------------------------

function fakeBus() {
  const events: KernelEvent[] = [];
  const bus: EventBus = {
    publish(type, data, opts) {
      const e: KernelEvent<typeof data> = { id: `e${events.length + 1}`, seq: events.length + 1, type, ts: new Date().toISOString(), source: opts?.source ?? "test", correlationId: opts?.correlationId, data };
      events.push(e);
      return e;
    },
    subscribe: () => () => {},
    history: () => events,
    waitFor: () => Promise.reject(new Error("not implemented")),
    drain: async () => {},
    close: () => {},
  };
  const of = (type: EventType) => events.filter((e) => e.type === type).map((e) => e.data as Record<string, unknown>);
  return { bus, events, of };
}

function fakeAudit() {
  const entries: AuditEntry[] = [];
  const audit: AuditLog = {
    append(e) {
      const entry: AuditEntry = { ...e, seq: entries.length + 1, ts: new Date().toISOString(), prevHash: "", hash: "" };
      entries.push(entry);
      return entry;
    },
    list: (q) => entries.filter((e) => !q?.subject || e.subject === q.subject),
    verify: () => null,
  };
  return { audit, entries };
}

function fakeGovernor(maxToolCalls: number) {
  const charges: { instanceId: string; toolKey?: string }[] = [];
  const governor = {
    charge(instanceId: string, usage: { toolCalls?: number; toolKey?: string }) {
      charges.push({ instanceId, toolKey: usage.toolKey });
      const used = charges.filter((c) => c.instanceId === instanceId).length;
      return used > maxToolCalls ? { exceeded: true as const, reason: `maxToolCalls ${maxToolCalls}` } : { exceeded: false as const };
    },
  } as unknown as Governor;
  return { governor, charges };
}

// --- fixtures ------------------------------------------------------------------

const human: Principal = { userId: "local", chain: ["user:local"], depth: 0 };
const agent = (instanceId = "ai_1", depth = 1): Principal => ({
  userId: "local",
  agentId: "code_reviewer",
  instanceId,
  workspaceId: "ws_1",
  chain: ["user:local", `agent:code_reviewer#${instanceId}`],
  depth,
});

const objectSchema = { type: "object" as const, properties: { text: { type: "string" } }, additionalProperties: true };

function def(name: string, over: Partial<ToolDefinition> = {}): ToolDefinition {
  return { name, description: `tool ${name}`, server: "builtin:test", action: "read", reversibility: "reversible", scope: "tenant", inputSchema: objectSchema, ...over };
}

function setup(policy: Partial<ToolPolicy> = {}, extra: { maxDelegationDepth?: number; governor?: Governor } = {}) {
  const b = fakeBus();
  const a = fakeAudit();
  const registry = createToolRegistry({ bus: b.bus, audit: a.audit, policy: { mode: "ask", ...policy }, ...extra });
  const calls: Record<string, number> = {};
  const add = (d: ToolDefinition, content = `${d.name} ran`) =>
    registry.register(d, async () => {
      calls[d.name] = (calls[d.name] ?? 0) + 1;
      return { ok: true, content };
    });
  add(def("t.read"));
  add(def("t.search", { action: "search" }));
  add(def("t.write", { action: "write" }));
  add(def("t.edit", { action: "write", reversibility: "compensable" }));
  add(def("t.exec", { action: "execute", reversibility: "irreversible", scope: "external" }));
  return { registry, calls, add, ...b, ...a };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

async function pendingFor(registry: ToolRegistry, tool: string) {
  await vi.waitFor(() => expect(registry.approvals("pending").some((a) => a.tool === tool)).toBe(true));
  return registry.approvals("pending").find((a) => a.tool === tool)!;
}

// --- tests ----------------------------------------------------------------------

describe("register", () => {
  it("computes the definition hash from name, description and schema", () => {
    const { registry } = setup();
    const d = registry.get("t.read")!;
    const expected = createHash("sha256").update("t.read" + "tool t.read" + stableStringify(objectSchema)).digest("hex");
    expect(d.hash).toBe(expected);
    expect(d.hash).toBe(toolHash(def("t.read")));
    expect(toolHash(def("t.read", { description: "other" }))).not.toBe(d.hash);
  });

  it("rejects bad names, duplicates and non-object schemas", () => {
    const { registry } = setup();
    const noop = async () => ({ ok: true, content: "" });
    expect(() => registry.register(def("bad name"), noop)).toThrow(/Invalid tool name/);
    expect(() => registry.register(def("bad/name"), noop)).toThrow(/Invalid tool name/);
    expect(() => registry.register(def("mcp.x.ünï"), noop)).toThrow(/Invalid tool name/);
    expect(() => registry.register(def("t.read"), noop)).toThrow(/already registered/);
    expect(() => registry.register({ ...def("t.arr"), inputSchema: { type: "array" } as never }, noop)).toThrow(/object/);
    expect(() => registry.register(def("ok_name-1.x"), noop)).not.toThrow();
  });

  it("lists with server, action and name-glob filters", () => {
    const { registry } = setup();
    expect(registry.list({ names: ["t.e*"] }).map((d) => d.name).sort()).toEqual(["t.edit", "t.exec"]);
    expect(registry.list({ action: "search" }).map((d) => d.name)).toEqual(["t.search"]);
    expect(registry.list({ server: "builtin:none" })).toEqual([]);
    expect(registry.unregister("t.read")).toBe(true);
    expect(registry.get("t.read")).toBeUndefined();
  });
});

describe("call pipeline", () => {
  it("halted: denies writes but still allows reversible reads and searches", async () => {
    const { registry, calls } = setup({ mode: "auto" });
    registry.setHalted(true);
    expect((await registry.call("t.read", {}, { principal: human })).ok).toBe(true);
    expect((await registry.call("t.search", {}, { principal: human })).ok).toBe(true);
    const w = await registry.call("t.write", {}, { principal: human });
    expect(w.ok).toBe(false);
    expect(w.error).toMatch(/halted/);
    expect((await registry.call("t.nope", {}, { principal: human })).error).toMatch(/halted/);
    expect(calls["t.write"]).toBeUndefined();
    registry.setHalted(false);
    expect((await registry.call("t.write", {}, { principal: human })).ok).toBe(true);
  });

  it("unknown and disabled tools return ok:false", async () => {
    const { registry, calls } = setup();
    const r = await registry.call("t.missing", {}, { principal: human });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown tool/);
    registry.setDisabled("t.read", true, "definition changed since approval");
    expect(registry.get("t.read")!.disabled).toBe(true);
    const d = await registry.call("t.read", {}, { principal: human });
    expect(d.ok).toBe(false);
    expect(d.error).toMatch(/disabled: definition changed/);
    expect(calls["t.read"]).toBeUndefined();
    registry.setDisabled("t.read", false);
    expect((await registry.call("t.read", {}, { principal: human })).ok).toBe(true);
  });

  it("denies a call without a principal", async () => {
    const { registry } = setup();
    const r = await registry.call("t.read", {}, {} as never);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no principal/);
  });

  it("enforces the delegation depth limit", async () => {
    const { registry } = setup({}, { maxDelegationDepth: 2 });
    registry.setScope("ai_1", ["*"]);
    registry.setScope("ai_2", ["*"]);
    expect((await registry.call("t.read", {}, { principal: agent("ai_1", 2) })).ok).toBe(true);
    const r = await registry.call("t.read", {}, { principal: agent("ai_2", 3) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/depth 3 exceeds the limit of 2/);
  });

  it("default depth limit is 3", async () => {
    const { registry } = setup();
    registry.setScope("ai_1", ["*"]);
    expect((await registry.call("t.read", {}, { principal: agent("ai_1", 3) })).ok).toBe(true);
    expect((await registry.call("t.read", {}, { principal: agent("ai_1", 4) })).ok).toBe(false);
  });

  it("scope: unscoped instances are denied, globs allow and deny, the human skips the scope check", async () => {
    const { registry } = setup({ mode: "auto" });
    const noScope = await registry.call("t.read", {}, { principal: agent("ai_9") });
    expect(noScope.ok).toBe(false);
    expect(noScope.error).toMatch(/no tool scope/);

    registry.setScope("ai_1", ["t.r*", "t.search"]);
    expect((await registry.call("t.read", {}, { principal: agent("ai_1") })).ok).toBe(true);
    expect((await registry.call("t.search", {}, { principal: agent("ai_1") })).ok).toBe(true);
    const out = await registry.call("t.write", {}, { principal: agent("ai_1") });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/outside the scope/);

    // No inheritance: another instance of the same agent has its own (missing) scope.
    expect((await registry.call("t.read", {}, { principal: agent("ai_2") })).ok).toBe(false);

    registry.clearScope("ai_1");
    expect((await registry.call("t.read", {}, { principal: agent("ai_1") })).ok).toBe(false);
    expect((await registry.call("t.write", {}, { principal: human })).ok).toBe(true);
  });

  it("deny rules beat allow rules; allow skips approval and is audited", async () => {
    const { registry, entries, calls } = setup({ mode: "ask", allow: ["t.exec", "t.write"], deny: ["t.write"] });
    const w = await registry.call("t.write", {}, { principal: human });
    expect(w.ok).toBe(false);
    expect(w.error).toMatch(/deny rule/);
    expect(calls["t.write"]).toBeUndefined();

    const x = await registry.call("t.exec", {}, { principal: human });
    expect(x.ok).toBe(true);
    expect(registry.approvals()).toHaveLength(0);
    expect(entries.some((e) => e.subject === "t.exec" && e.outcome === "allowed" && e.detail.via === "allow")).toBe(true);
  });

  const matrix: [ToolPolicy["mode"], string, "run" | "approval" | "deny"][] = [
    ["readonly", "t.read", "run"],
    ["readonly", "t.search", "run"],
    ["readonly", "t.write", "deny"],
    ["readonly", "t.edit", "deny"],
    ["readonly", "t.exec", "deny"],
    ["ask", "t.read", "run"],
    ["ask", "t.write", "run"],
    ["ask", "t.edit", "approval"],
    ["ask", "t.exec", "approval"],
    ["auto", "t.read", "run"],
    ["auto", "t.write", "run"],
    ["auto", "t.edit", "run"],
    ["auto", "t.exec", "approval"],
  ];
  it.each(matrix)("mode %s x %s -> %s", async (mode, tool, expected) => {
    const { registry, calls } = setup({ mode });
    registry.setScope("ai_1", ["t.*"]);
    const p = registry.call(tool, {}, { principal: agent() });
    if (expected === "approval") {
      const req = await pendingFor(registry, tool);
      expect(req.status).toBe("pending");
      expect(calls[tool]).toBeUndefined();
      registry.resolveApproval(req.id, true);
      expect((await p).ok).toBe(true);
    } else {
      const r = await p;
      expect(registry.approvals()).toHaveLength(0);
      expect(r.ok).toBe(expected === "run");
      if (expected === "deny") expect(r.error).toMatch(/readonly mode/);
    }
    expect(calls[tool] ?? 0).toBe(expected === "deny" ? 0 : 1);
  });

  it("the human still needs approval for irreversible tools in auto mode", async () => {
    const { registry } = setup({ mode: "auto" });
    const p = registry.call("t.exec", {}, { principal: human });
    const req = await pendingFor(registry, "t.exec");
    expect(req.principal.chain).toEqual(["user:local"]);
    registry.resolveApproval(req.id, true);
    expect((await p).ok).toBe(true);
  });
});

describe("approvals", () => {
  it("approve runs the tool, emits events and audits the decision", async () => {
    const { registry, of, entries } = setup();
    const p = registry.call("t.exec", { text: "go" }, { principal: human });
    const req = await pendingFor(registry, "t.exec");
    expect(of("tool.approval_requested")).toHaveLength(1);
    const resolved = registry.resolveApproval(req.id, true)!;
    expect(resolved.status).toBe("approved");
    expect(resolved.resolvedAt).toBeTruthy();
    expect((await p).ok).toBe(true);
    expect(of("tool.approval_resolved")).toHaveLength(1);
    expect(entries.some((e) => e.kind === "approval" && e.outcome === "allowed")).toBe(true);
    expect(registry.approvals("approved")).toHaveLength(1);
    // Resolving twice changes nothing.
    expect(registry.resolveApproval(req.id, false)!.status).toBe("approved");
    expect(registry.resolveApproval("appr_missing", true)).toBeUndefined();
  });

  it("deny returns ok:false without running", async () => {
    const { registry, calls } = setup();
    const p = registry.call("t.edit", {}, { principal: human });
    registry.resolveApproval((await pendingFor(registry, "t.edit")).id, false);
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/approval denied/);
    expect(calls["t.edit"]).toBeUndefined();
  });

  it("an unanswered approval expires as denied", async () => {
    const { registry, calls, entries } = setup({ approvalTimeoutMs: 30 });
    const r = await registry.call("t.exec", {}, { principal: human });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/approval expired/);
    expect(registry.approvals("expired")).toHaveLength(1);
    expect(calls["t.exec"]).toBeUndefined();
    expect(entries.some((e) => e.kind === "approval" && e.detail.status === "expired")).toBe(true);
  });

  it("the abort signal cancels a pending approval", async () => {
    const { registry } = setup();
    const ac = new AbortController();
    const p = registry.call("t.exec", {}, { principal: human, signal: ac.signal });
    await pendingFor(registry, "t.exec");
    ac.abort();
    const r = await p;
    expect(r.ok).toBe(false);
    expect(registry.approvals("denied")).toHaveLength(1);

    const pre = new AbortController();
    pre.abort();
    expect((await registry.call("t.exec", {}, { principal: human, signal: pre.signal })).ok).toBe(false);
  });

  it("halting denies every pending approval", async () => {
    const { registry, calls } = setup();
    const p1 = registry.call("t.exec", {}, { principal: human });
    const p2 = registry.call("t.edit", {}, { principal: human });
    await pendingFor(registry, "t.exec");
    await pendingFor(registry, "t.edit");
    registry.setHalted(true);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    expect(registry.approvals("pending")).toHaveLength(0);
    expect(registry.approvals("denied")).toHaveLength(2);
    expect(calls["t.exec"]).toBeUndefined();
  });
});

describe("after authorization", () => {
  it("rejects input that does not match the schema, with the errors", async () => {
    const { registry, add, calls } = setup({ mode: "auto" });
    add(def("t.strict", { inputSchema: { type: "object", properties: { path: { type: "string" }, n: { type: "integer" } }, required: ["path"], additionalProperties: false } }));
    const r = await registry.call("t.strict", { n: "x", extra: 1 }, { principal: human });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/required property 'path'/);
    expect(r.error).toMatch(/must be integer/); // allErrors
    expect(calls["t.strict"]).toBeUndefined();
    expect((await registry.call("t.strict", { path: "a" }, { principal: human })).ok).toBe(true);
  });

  it("replay fence: an irreversible call runs once per idempotency key and the refusal returns the first result", async () => {
    const { registry, calls, audit, bus } = setup({ allow: ["t.exec"] });
    const first = await registry.call("t.exec", {}, { principal: human, idempotencyKey: "k1" });
    expect(first.ok).toBe(true);
    const second = await registry.call("t.exec", {}, { principal: human, idempotencyKey: "k1" });
    expect(second.ok).toBe(false);
    expect(second.error).toBe("already executed");
    expect((second.data as { firstResult: { content: string } }).firstResult.content).toBe("t.exec ran");
    expect(calls["t.exec"]).toBe(1);

    expect((await registry.call("t.exec", {}, { principal: human, idempotencyKey: "k2" })).ok).toBe(true);
    expect(calls["t.exec"]).toBe(2);
    // Reversible tools are not fenced.
    await registry.call("t.read", {}, { principal: human, idempotencyKey: "k1" });
    await registry.call("t.read", {}, { principal: human, idempotencyKey: "k1" });
    expect(calls["t.read"]).toBe(2);

    // After a restart the audit ledger still fences the key.
    const restarted = createToolRegistry({ bus, audit, policy: { mode: "ask", allow: ["t.exec"] } });
    let ran = 0;
    restarted.register(def("t.exec", { action: "execute", reversibility: "irreversible" }), async () => {
      ran++;
      return { ok: true, content: "again" };
    });
    const replay = await restarted.call("t.exec", {}, { principal: human, idempotencyKey: "k1" });
    expect(replay.ok).toBe(false);
    expect(replay.error).toBe("already executed");
    expect(replay.content).toContain("t.exec ran");
    expect(ran).toBe(0);
  });

  it("replay fence holds for concurrent calls with the same key", async () => {
    const { registry, calls } = setup({ allow: ["t.slow"] });
    registry.register(def("t.slow", { action: "execute", reversibility: "irreversible" }), async () => {
      calls["t.slow"] = (calls["t.slow"] ?? 0) + 1;
      await tick();
      return { ok: true, content: "slow done" };
    });
    const [a, b] = await Promise.all([
      registry.call("t.slow", {}, { principal: human, idempotencyKey: "same" }),
      registry.call("t.slow", {}, { principal: human, idempotencyKey: "same" }),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(calls["t.slow"]).toBe(1);
  });

  it("charges the governor per instance call and denies when the budget is exceeded", async () => {
    const { governor, charges } = fakeGovernor(2);
    const { registry, calls } = setup({ mode: "auto" }, { governor });
    registry.setScope("ai_1", ["*"]);
    expect((await registry.call("t.read", { text: "a", b: 1 }, { principal: agent() })).ok).toBe(true);
    expect((await registry.call("t.read", { b: 1, text: "a" }, { principal: agent() })).ok).toBe(true);
    const third = await registry.call("t.read", {}, { principal: agent() });
    expect(third.ok).toBe(false);
    expect(third.error).toMatch(/budget exceeded: maxToolCalls 2/);
    expect(calls["t.read"]).toBe(2);
    expect(charges[0].toolKey).toBe(charges[1].toolKey); // stable JSON: key order does not matter
    expect(charges[0].toolKey).toBe('t.read:{"b":1,"text":"a"}');
    // The human is not charged.
    await registry.call("t.read", {}, { principal: human });
    expect(charges).toHaveLength(3);
  });

  it("a throwing handler yields ok:false instead of an exception", async () => {
    const { registry, entries } = setup({ mode: "auto" });
    registry.register(def("t.boom"), async () => {
      throw new Error("kaboom");
    });
    const r = await registry.call("t.boom", {}, { principal: human });
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/kaboom/);
    expect(r.error).toBe("kaboom");
    expect(entries.at(-1)!.outcome).toBe("error");
  });

  it("caps content at 20 000 characters with a truncation note", async () => {
    const { registry, add } = setup();
    add(def("t.big"), "x".repeat(30_000));
    const r = await registry.call("t.big", {}, { principal: human });
    expect(r.ok).toBe(true);
    expect(r.content.startsWith("x".repeat(20_000))).toBe(true);
    expect(r.content).toMatch(/\[truncated: 10000 more characters\]$/);
    expect(r.content.length).toBeLessThan(20_100);
  });
});

describe("observability", () => {
  it("emits tool.called and tool.result with the principal chain, never the full input of write tools", async () => {
    const { registry, of } = setup({ mode: "auto" });
    registry.setScope("ai_1", ["*"]);
    const secretish = "y".repeat(5000);
    await registry.call("t.write", { text: secretish, path: "a.txt" }, { principal: agent() });
    const called = of("tool.called").at(-1)!;
    expect(called.name).toBe("t.write");
    expect(called.chain).toEqual(["user:local", "agent:code_reviewer#ai_1"]);
    expect(called.input).toBeUndefined();
    expect(called.inputKeys).toEqual(["text", "path"]);
    expect(String(called.inputPreview).length).toBeLessThanOrEqual(201);
    const result = of("tool.result").at(-1)!;
    expect(result).toMatchObject({ name: "t.write", ok: true, reversibility: "reversible", chain: ["user:local", "agent:code_reviewer#ai_1"] });
    expect(typeof result.durationMs).toBe("number");

    await registry.call("t.read", { text: "q" }, { principal: human });
    expect(of("tool.called").at(-1)!.input).toEqual({ text: "q" });

    await registry.call("t.missing", {}, { principal: human });
    expect(of("tool.result").at(-1)).toMatchObject({ ok: false, outcome: "denied" });
  });

  it("writes audit entries for denials, successes, errors and policy changes", async () => {
    const { registry, entries } = setup({ mode: "readonly" });
    await registry.call("t.read", {}, { principal: human });
    await registry.call("t.write", {}, { principal: human });
    expect(entries.map((e) => [e.kind, e.subject, e.outcome])).toEqual([
      ["tool_call", "t.read", "ok"],
      ["tool_call", "t.write", "denied"],
    ]);
    expect(entries[0].principal).toEqual(human);
    expect(entries[1].detail.reason).toMatch(/readonly/);

    registry.setPolicy({ mode: "auto", deny: ["proc.*"] });
    const policyEntry = entries.at(-1)!;
    expect(policyEntry.kind).toBe("policy");
    expect((policyEntry.detail.after as ToolPolicy).mode).toBe("auto");
    expect(registry.policy()).toMatchObject({ mode: "auto", deny: ["proc.*"], approvalTimeoutMs: 600_000 });
  });
});

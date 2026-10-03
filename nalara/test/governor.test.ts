import { describe, expect, it } from "vitest";
import { createGovernor } from "../src/agents/governor";
import { createEventBus } from "../src/events/bus";
import { createAuditLog } from "../src/kernel/audit";
import { openDatabase } from "../src/kernel/db";
import type { AgentBudget } from "../src/kernel/types";

const budget: AgentBudget = { maxInputTokens: 1000, maxOutputTokens: 500, maxToolCalls: 3, maxTurns: 5, maxWallMs: 60_000, maxRepeatCalls: 2 };

/** Deterministic clock and timers. */
function fakeTime() {
  let t = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let ids = 0;
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => {
      const id = ++ids;
      timers.push({ at: t + ms, fn, id });
      return id;
    },
    clearTimer: (id: unknown) => {
      const i = timers.findIndex((x) => x.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    advance(ms: number) {
      t += ms;
      for (const timer of timers.filter((x) => x.at <= t)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.fn();
      }
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("governor", () => {
  it("admits up to maxLanes and queues the rest", async () => {
    const gov = createGovernor({ maxLanes: 2 });
    const r1 = await gov.admit("a", "normal");
    await gov.admit("b", "normal");
    let admitted = false;
    const p = gov.admit("c", "normal").then((rel) => {
      admitted = true;
      return rel;
    });
    await flush();
    expect(admitted).toBe(false);
    expect(gov.snapshot()).toMatchObject({ running: 2, queued: 1, lanes: 2, circuit: "closed" });
    r1();
    r1(); // releasing twice frees only one lane
    await p;
    expect(gov.snapshot()).toMatchObject({ running: 2, queued: 0 });
  });

  it("orders the queue by priority, FIFO within a priority", async () => {
    const gov = createGovernor({ maxLanes: 1 });
    const hold = await gov.admit("holder", "normal");
    const order: string[] = [];
    const wait = (id: string, pr: "low" | "normal" | "high" | "urgent") =>
      gov.admit(id, pr).then((rel) => {
        order.push(id);
        rel();
      });
    const all = [wait("low1", "low"), wait("n1", "normal"), wait("h1", "high"), wait("n2", "normal"), wait("u1", "urgent"), wait("h2", "high")];
    hold();
    await Promise.all(all);
    expect(order).toEqual(["u1", "h1", "h2", "n1", "n2", "low1"]);
  });

  it("removes an aborted waiter from the queue and rejects it", async () => {
    const gov = createGovernor({ maxLanes: 1 });
    const hold = await gov.admit("holder", "normal");
    const ac = new AbortController();
    const p = gov.admit("x", "urgent", ac.signal);
    expect(gov.snapshot().queued).toBe(1);
    ac.abort();
    await expect(p).rejects.toThrow(/aborted/);
    expect(gov.snapshot().queued).toBe(0);
    const pre = new AbortController();
    pre.abort();
    await expect(gov.admit("y", "normal", pre.signal)).rejects.toThrow(/aborted/);
    hold();
    expect(gov.snapshot().running).toBe(0);
  });

  it("charges usage and reports the first exceeded dimension once", async () => {
    const bus = createEventBus();
    const audit = createAuditLog({ db: openDatabase(":memory:") });
    const time = fakeTime();
    const gov = createGovernor({ maxLanes: 2, bus, audit, now: time.now });
    gov.setBudget("i1", budget);
    expect(gov.charge("i1", { inputTokens: 600, outputTokens: 100, turns: 1 })).toEqual({ exceeded: false });
    time.advance(500);
    expect(gov.usage("i1")).toMatchObject({ inputTokens: 600, outputTokens: 100, turns: 1, toolCalls: 0, wallMs: 500 });
    const r = gov.charge("i1", { inputTokens: 500 });
    expect(r).toEqual({ exceeded: true, reason: expect.stringMatching(/input tokens 1100 > 1000/) });
    expect(gov.charge("i1", { turns: 1 })).toMatchObject({ exceeded: true }); // sticky
    await bus.drain();
    expect(bus.history({ types: ["budget.exceeded"] })).toHaveLength(1);
    expect(audit.list()).toHaveLength(1);
    expect(audit.list()[0]).toMatchObject({ kind: "budget", subject: "i1", outcome: "denied" });
    gov.release("i1");
    expect(gov.usage("i1")).toEqual({ inputTokens: 0, outputTokens: 0, toolCalls: 0, turns: 0, wallMs: 0 });
  });

  it("enforces tool calls, turns and wall time", () => {
    const time = fakeTime();
    const gov = createGovernor({ maxLanes: 1, now: time.now });
    gov.setBudget("t", budget);
    for (let i = 0; i < 3; i++) expect(gov.charge("t", { toolCalls: 1 }).exceeded).toBe(false);
    expect(gov.charge("t", { toolCalls: 1 })).toMatchObject({ exceeded: true, reason: expect.stringContaining("tool calls") });

    gov.setBudget("w", budget);
    time.advance(60_001);
    expect(gov.charge("w", {})).toMatchObject({ exceeded: false }); // clock starts at first admit/charge
    time.advance(60_001);
    expect(gov.charge("w", {})).toMatchObject({ exceeded: true, reason: expect.stringContaining("wall time") });

    gov.setBudget("u", budget);
    expect(gov.charge("u", { turns: 6 })).toMatchObject({ exceeded: true, reason: expect.stringContaining("turns") });
  });

  it("detects repeated identical tool calls", () => {
    const gov = createGovernor({ maxLanes: 1 });
    gov.setBudget("r", { ...budget, maxToolCalls: 100 });
    expect(gov.charge("r", { toolCalls: 1, toolKey: 'fs.read_file {"path":"a"}' }).exceeded).toBe(false);
    expect(gov.charge("r", { toolCalls: 1, toolKey: 'fs.read_file {"path":"b"}' }).exceeded).toBe(false);
    expect(gov.charge("r", { toolCalls: 1, toolKey: 'fs.read_file {"path":"a"}' }).exceeded).toBe(false);
    const r = gov.charge("r", { toolCalls: 1, toolKey: 'fs.read_file {"path":"a"}' });
    expect(r).toMatchObject({ exceeded: true, reason: expect.stringContaining("repeated identical call 3 times") });
  });

  it("does not enforce anything without a budget", () => {
    const gov = createGovernor({ maxLanes: 1 });
    expect(gov.charge("free", { inputTokens: 1e9, toolKey: "x" })).toEqual({ exceeded: false });
  });

  it("AIMD: halves lanes on rate limits and adds one per three oks", () => {
    const gov = createGovernor({ maxLanes: 8 });
    gov.reportProvider("rate_limited");
    expect(gov.snapshot().lanes).toBe(4);
    gov.reportProvider("overloaded");
    expect(gov.snapshot().lanes).toBe(2);
    gov.reportProvider("error"); // plain errors do not shrink lanes
    expect(gov.snapshot().lanes).toBe(2);
    gov.reportProvider("rate_limited");
    gov.reportProvider("rate_limited");
    expect(gov.snapshot().lanes).toBe(1); // floor at 1
    gov.reportProvider("ok");
    gov.reportProvider("ok");
    expect(gov.snapshot().lanes).toBe(1);
    gov.reportProvider("ok");
    expect(gov.snapshot().lanes).toBe(2);
    for (let i = 0; i < 30; i++) gov.reportProvider("ok");
    expect(gov.snapshot().lanes).toBe(8); // capped at maxLanes
  });

  it("shrinking lanes holds new admissions until running drops", async () => {
    const gov = createGovernor({ maxLanes: 2 });
    const a = await gov.admit("a", "normal");
    const b = await gov.admit("b", "normal");
    gov.reportProvider("rate_limited"); // lanes 1, running 2
    let got = false;
    const p = gov.admit("c", "normal").then((rel) => ((got = true), rel));
    a();
    await flush();
    expect(got).toBe(false); // running 1 = lanes 1
    b();
    (await p)();
    expect(got).toBe(true);
  });

  it("opens the circuit after 5 failures, probes once when half-open, closes on ok", async () => {
    const time = fakeTime();
    const bus = createEventBus();
    const gov = createGovernor({ maxLanes: 4, bus, now: time.now, setTimer: time.setTimer, clearTimer: time.clearTimer });
    for (let i = 0; i < 4; i++) gov.reportProvider("error");
    expect(gov.snapshot().circuit).toBe("closed");
    gov.reportProvider("error");
    expect(gov.snapshot().circuit).toBe("open");

    const admitted: string[] = [];
    const p1 = gov.admit("p1", "normal").then((rel) => (admitted.push("p1"), rel));
    const p2 = gov.admit("p2", "normal").then((rel) => (admitted.push("p2"), rel));
    await flush();
    expect(admitted).toEqual([]);
    expect(gov.snapshot().queued).toBe(2);

    time.advance(9_999);
    expect(gov.snapshot().circuit).toBe("open");
    time.advance(1);
    expect(gov.snapshot().circuit).toBe("half_open");
    await flush();
    expect(admitted).toEqual(["p1"]); // exactly one probe

    gov.reportProvider("ok");
    expect(gov.snapshot().circuit).toBe("closed");
    await flush();
    expect(admitted).toEqual(["p1", "p2"]);
    (await p1)();
    (await p2)();
    await bus.drain();
    expect(bus.history({ types: ["kernel.log"] }).length).toBeGreaterThanOrEqual(3);
  });

  it("re-opens the circuit when the half-open probe fails", async () => {
    const time = fakeTime();
    const gov = createGovernor({ maxLanes: 2, now: time.now, setTimer: time.setTimer, clearTimer: time.clearTimer });
    for (let i = 0; i < 5; i++) gov.reportProvider("overloaded");
    time.advance(10_000);
    expect(gov.snapshot().circuit).toBe("half_open");
    const probe = await gov.admit("probe", "normal");
    gov.reportProvider("rate_limited");
    expect(gov.snapshot().circuit).toBe("open");
    probe();
    let got = false;
    void gov.admit("next", "normal").then(() => (got = true));
    await flush();
    expect(got).toBe(false);
    time.advance(10_000);
    await flush();
    expect(got).toBe(true);
  });

  it("a probe released without a report lets another probe through", async () => {
    const time = fakeTime();
    const gov = createGovernor({ maxLanes: 2, now: time.now, setTimer: time.setTimer, clearTimer: time.clearTimer });
    for (let i = 0; i < 5; i++) gov.reportProvider("error");
    time.advance(10_000);
    const first = await gov.admit("a", "normal");
    let second = false;
    void gov.admit("b", "normal").then(() => (second = true));
    await flush();
    expect(second).toBe(false);
    first();
    await flush();
    expect(second).toBe(true);
  });
});

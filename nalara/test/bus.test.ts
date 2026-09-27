import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEventBus } from "../src/events/bus";
import { openDatabase } from "../src/kernel/db";
import type { KernelEvent } from "../src/kernel/types";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("event bus", () => {
  it("numbers events from 1 and delivers after publish returns", async () => {
    const bus = createEventBus();
    const seen: number[] = [];
    bus.subscribe("file.updated", (e) => void seen.push(e.seq));
    const e1 = bus.publish("file.updated", { path: "a.ts" });
    const e2 = bus.publish("file.updated", { path: "b.ts" });
    expect([e1.seq, e2.seq]).toEqual([1, 2]);
    expect(seen).toEqual([]); // not synchronous
    await bus.drain();
    expect(seen).toEqual([1, 2]);
  });

  it("matches exact, wildcard and prefix patterns", async () => {
    const bus = createEventBus();
    const got: Record<string, string[]> = { exact: [], all: [], agent: [] };
    bus.subscribe("agent.finished", (e) => void got.exact.push(e.type));
    bus.subscribe("*", (e) => void got.all.push(e.type));
    bus.subscribe("agent.*", (e) => void got.agent.push(e.type));
    bus.publish("agent.finished", {});
    bus.publish("agent.failed", {});
    bus.publish("file.created", {});
    await bus.drain();
    expect(got.exact).toEqual(["agent.finished"]);
    expect(got.all).toEqual(["agent.finished", "agent.failed", "file.created"]);
    expect(got.agent).toEqual(["agent.finished", "agent.failed"]);
  });

  it("isolates a throwing handler and reports it as kernel.log", async () => {
    const bus = createEventBus();
    const ok: number[] = [];
    bus.subscribe("file.updated", () => {
      throw new Error("boom");
    });
    bus.subscribe("file.updated", (e) => void ok.push(e.seq));
    bus.subscribe("file.updated", async () => {
      await Promise.resolve();
      throw new Error("async boom");
    });
    bus.publish("file.updated", {});
    await bus.drain();
    expect(ok).toEqual([1]);
    const logs = bus.history({ types: ["kernel.log"] });
    expect(logs).toHaveLength(2);
    expect((logs[0].data as { message: string }).message).toContain("boom");
  });

  it("does not recurse when a kernel.log handler throws", async () => {
    const bus = createEventBus();
    let calls = 0;
    bus.subscribe("kernel.log", () => {
      calls++;
      throw new Error("log handler broken");
    });
    bus.publish("kernel.log", { level: "info", message: "hello" });
    await bus.drain();
    // Original log + one error report, and the error report's failure is swallowed.
    expect(calls).toBe(2);
    expect(bus.history({ types: ["kernel.log"] })).toHaveLength(2);
  });

  it("drain waits for async handlers and events they publish", async () => {
    const bus = createEventBus();
    const order: string[] = [];
    bus.subscribe("agent.finished", async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push("finished");
      bus.publish("task.completed", {});
    });
    bus.subscribe("task.completed", async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push("task");
    });
    bus.publish("agent.finished", {});
    await bus.drain();
    expect(order).toEqual(["finished", "task"]);
  });

  it("history filters by since, types, correlation and limit", () => {
    const bus = createEventBus({ maxHistory: 3 });
    for (let i = 0; i < 5; i++) bus.publish(i % 2 ? "file.updated" : "agent.finished", { i }, { correlationId: i < 3 ? "ws_1" : "ws_2" });
    expect(bus.history().map((e) => e.seq)).toEqual([3, 4, 5]); // ring of 3
    expect(bus.history({ sinceSeq: 3 }).map((e) => e.seq)).toEqual([4, 5]);
    expect(bus.history({ types: ["file.*"] }).map((e) => e.seq)).toEqual([4]);
    expect(bus.history({ correlationId: "ws_2" }).map((e) => e.seq)).toEqual([4, 5]);
    expect(bus.history({ limit: 1 }).map((e) => e.seq)).toEqual([5]);
    expect(bus.history({ sinceSeq: 2, limit: 1 }).map((e) => e.seq)).toEqual([3]);
  });

  it("waitFor resolves on a matching event and rejects on timeout", async () => {
    const bus = createEventBus();
    const p = bus.waitFor("agent.*", (e) => (e.data as { id: number }).id === 2, 1000);
    bus.publish("agent.finished", { id: 1 });
    bus.publish("agent.finished", { id: 2 });
    expect(((await p) as KernelEvent<{ id: number }>).data.id).toBe(2);
    await expect(bus.waitFor("deployment.succeeded", undefined, 20)).rejects.toThrow(/timed out/);
  });

  it("close stops delivery and rejects waiters", async () => {
    const bus = createEventBus();
    const seen: number[] = [];
    bus.subscribe("*", (e) => void seen.push(e.seq));
    const waiting = bus.waitFor("kernel.stopped");
    bus.publish("kernel.started", {});
    bus.close();
    bus.publish("kernel.started", {});
    await bus.drain();
    expect(seen).toEqual([]);
    await expect(waiting).rejects.toThrow(/closed/);
  });

  it("persists events and continues seq after reopening", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nalara-bus-"));
    dirs.push(dir);
    const file = join(dir, "bus.db");
    const db1 = openDatabase(file);
    const bus1 = createEventBus({ db: db1 });
    bus1.publish("kernel.started", { n: 1 }, { correlationId: "c" });
    bus1.publish("kernel.stopped", { n: 2 });
    bus1.close();
    db1.close();

    const db2 = openDatabase(file);
    const bus2 = createEventBus({ db: db2 });
    expect(bus2.publish("kernel.started", {}).seq).toBe(3);
    const hist = bus2.history();
    expect(hist.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(hist[0]).toMatchObject({ type: "kernel.started", correlationId: "c", data: { n: 1 } });
    db2.close();
  });
});

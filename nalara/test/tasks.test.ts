import { afterAll, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTaskStore } from "../src/apps/tasks";
import { assistantSystemPrompt, localTime } from "../src/assistant/assistant";
import { createEventBus } from "../src/events/bus";
import { openDatabase } from "../src/kernel/db";
import { createKernel, type NeuralKernel } from "../src/kernel/kernel";
import { createScriptedProvider } from "../src/llm/scripted";
import { createHttpServer, type NeuralHttpServer } from "../src/server/http";
import type { KernelEvent } from "../src/kernel/types";

const DEMO = path.resolve(__dirname, "../demo/breath-of-fire-iv-remake");
const temps: string[] = [];
const kernels: NeuralKernel[] = [];
const servers: NeuralHttpServer[] = [];

afterAll(async () => {
  for (const s of servers) await s.close().catch(() => undefined);
  for (const k of kernels) await k.stop().catch(() => undefined);
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

async function boot(llm: ReturnType<typeof createScriptedProvider> | null = null) {
  const root = mkdtempSync(path.join(os.tmpdir(), "nos-tasks-"));
  temps.push(root);
  cpSync(DEMO, root, { recursive: true, filter: (src) => !src.split(path.sep).includes(".nalara") });
  const kernel = createKernel({ root, watch: false, triggers: false, port: 0 }, { env: {}, llm });
  kernels.push(kernel);
  await kernel.start();
  return kernel;
}

describe("task store", () => {
  it("adds, orders open tasks by due time, completes, edits and deletes", () => {
    let t = new Date("2026-11-18T10:00:00Z");
    const bus = createEventBus({ db: openDatabase(":memory:") });
    const store = createTaskStore({ db: openDatabase(":memory:"), bus, now: () => t });
    const later = store.add({ title: "  Pay   the invoice ", due: "2026-11-20T09:00:00+07:00" });
    const sooner = store.add({ title: "Call Ana", due: "2026-11-18T12:00:00Z" });
    const undated = store.add({ title: "Read the contract" });
    expect(later.title).toBe("Pay the invoice");
    expect(later.due).toBe("2026-11-20T02:00:00.000Z");
    expect(store.list().map((x) => x.title)).toEqual(["Call Ana", "Pay the invoice", "Read the contract"]);
    t = new Date("2026-11-18T10:05:00Z");
    const done = store.update(sooner.id, { done: true });
    expect(done).toMatchObject({ done: true, completedAt: "2026-11-18T10:05:00.000Z" });
    expect(store.list().at(-1)?.id).toBe(sooner.id); // done tasks last
    expect(store.list({ includeDone: false }).map((x) => x.id)).not.toContain(sooner.id);
    expect(store.update(sooner.id, { done: false }).completedAt).toBeNull();
    expect(() => store.add({ title: "   " })).toThrow(/title is required/);
    expect(() => store.add({ title: "x", due: "next tuesday-ish" })).toThrow(/not a date-time/);
    expect(store.update(undated.id, { notes: "clause 4", due: null })).toMatchObject({ notes: "clause 4", due: null });
    expect(store.remove(undated.id)).toBe(true);
    expect(store.remove(undated.id)).toBe(false);
  });

  it("publishes reminder.due once when the due time passes, and again after a new due time", async () => {
    let t = new Date("2026-11-18T10:00:00Z");
    const bus = createEventBus({ db: openDatabase(":memory:") });
    const seen: KernelEvent[] = [];
    bus.subscribe("reminder.due", (e) => void seen.push(e));
    const store = createTaskStore({ db: openDatabase(":memory:"), bus, now: () => t });
    const task = store.add({ title: "Stand-up", due: "2026-11-18T10:30:00Z" });
    expect(store.checkDue()).toEqual([]);
    t = new Date("2026-11-18T10:31:00Z");
    expect(store.checkDue().map((x) => x.id)).toEqual([task.id]);
    expect(store.checkDue()).toEqual([]); // once
    await bus.drain();
    expect(seen.map((e) => e.data)).toEqual([{ taskId: task.id, title: "Stand-up", due: "2026-11-18T10:30:00.000Z" }]);
    expect(store.get(task.id)?.reminded).toBe(true);
    store.update(task.id, { due: "2026-11-18T11:00:00Z" });
    expect(store.get(task.id)?.reminded).toBe(false);
    t = new Date("2026-11-18T11:00:01Z");
    expect(store.checkDue()).toHaveLength(1);
    // Done tasks never remind.
    const done = store.add({ title: "Done already", due: "2026-11-18T09:00:00Z" });
    store.update(done.id, { done: true });
    expect(store.checkDue()).toEqual([]);
  });
});

describe("tasks in the kernel", () => {
  it("tasks.* is not offered to the assistant, and its prompt carries the local time", async () => {
    const llm = createScriptedProvider({ agent: [{ text: "Add it in Tasks; I can't set reminders." }] });
    const kernel = await boot(llm);
    await kernel.assistant.ask("Remind me to call Ana on 1 January 2030 at 5pm");
    expect(kernel.tasks.list()).toEqual([]);
    const req = llm.calls.find((c) => c.method === "runAgentLoop")!.req as { system: string; tools: { name: string }[] };
    expect(req.system).toMatch(/It is \d{4}-\d\d-\d\d \d\d:\d\d \(UTC[+-]\d\d:\d\d, \w+day\)/);
    expect(req.system).not.toMatch(/tasks\./);
    expect(req.tools.map((t) => t.name).filter((n) => n.startsWith("tasks."))).toEqual([]);
    expect(kernel.tools.list().find((t) => t.name === "tasks.delete")?.reversibility).toBe("compensable");
  });

  it("serves tasks over HTTP", async () => {
    const kernel = await boot();
    const http = createHttpServer(kernel);
    servers.push(http);
    const { url } = await http.listen(0, "127.0.0.1");
    const h = { "Content-Type": "application/json", "X-Nalara-Client": "1" };
    const created = (await (await fetch(`${url}/api/tasks`, { method: "POST", headers: h, body: JSON.stringify({ title: "Buy milk" }) })).json()) as { id: string };
    const put = await fetch(`${url}/api/tasks/${created.id}`, { method: "PUT", headers: h, body: JSON.stringify({ done: true }) });
    expect(((await put.json()) as { done: boolean }).done).toBe(true);
    expect(((await (await fetch(`${url}/api/tasks?done=0`)).json()) as unknown[]).length).toBe(0);
    expect((await fetch(`${url}/api/tasks`, { method: "POST", headers: h, body: JSON.stringify({ title: "x", due: "soon" }) })).status).toBe(400);
    expect((await fetch(`${url}/api/tasks/${created.id}`, { method: "DELETE", headers: h })).status).toBe(200);
    expect((await fetch(`${url}/api/tasks/${created.id}`, { method: "DELETE", headers: h })).status).toBe(404);
  });
});

describe("assistant prompt", () => {
  it("states the local time with its offset and the weekday", () => {
    const s = localTime(new Date(2026, 10, 18, 9, 5));
    expect(s).toMatch(/^2026-11-18 09:05 \(UTC[+-]\d\d:\d\d, Wednesday\)$/);
    expect(assistantSystemPrompt({ root: "/r", date: new Date(), memories: [], web: false, toolNames: [] })).toMatch(/Notes folder/);
  });
});

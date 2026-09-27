import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventBus } from "../src/events/bus";
import { createKnowledgeGraph } from "../src/graph/store";
import { openDatabase } from "../src/kernel/db";
import type { EventBus, MemoryService, Workspace } from "../src/kernel/types";
import { attachMemoryAgent, seedMemoryFromRoot } from "../src/memory/agent";
import { createMemoryService } from "../src/memory/service";

let bus: EventBus;
let memory: MemoryService;
const dirs: string[] = [];

beforeEach(() => {
  bus = createEventBus();
  memory = createMemoryService({ db: openDatabase(":memory:"), bus });
});
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("memory service", () => {
  it("upserts on (category, key) with platform as the default source", async () => {
    const a = memory.remember({ category: "coding_standard", key: "naming", content: "camelCase" });
    expect(a).toMatchObject({ source: "platform", status: "active", data: {}, tags: [] });
    const b = memory.remember({ category: "coding_standard", key: "naming", content: "snake_case", tags: ["style"] });
    expect(b.id).toBe(a.id);
    expect(memory.get(a.id)).toMatchObject({ content: "snake_case", tags: ["style"] });
    // Same key in another category is a different record.
    memory.remember({ category: "preference", key: "naming", content: "x" });
    expect(memory.recall()).toHaveLength(2);
    // An identical write changes nothing and emits nothing.
    memory.remember({ category: "coding_standard", key: "naming", content: "snake_case", tags: ["style"] });
    await bus.drain();
    expect(bus.history({ types: ["memory.updated"] }).map((e) => (e.data as { action: string }).action)).toEqual(["created", "updated", "created"]);
  });

  it("keeps agent writes proposed and out of recall until confirmed", () => {
    const p = memory.remember({ category: "architecture_decision", key: "db", content: "use sqlite everywhere", source: "agent:systems_architect#ai_1" });
    expect(p.status).toBe("proposed");
    expect(memory.recall({ text: "sqlite" })).toHaveLength(0);
    expect(memory.recall({ text: "sqlite", includeProposed: true })).toHaveLength(1);
    const c = memory.confirm(p.id)!;
    expect(c).toMatchObject({ status: "active", key: "db" });
    expect(memory.recall({ text: "sqlite" })).toHaveLength(1);
  });

  it("never lets an agent overwrite an active record", () => {
    const active = memory.remember({ category: "coding_standard", key: "tests", content: "every module has tests", source: "user" });
    const p1 = memory.remember({ category: "coding_standard", key: "tests", content: "tests are optional", source: "agent:x#1" });
    const p2 = memory.remember({ category: "coding_standard", key: "tests", content: "tests are forbidden", source: "agent:y#2" });
    expect(p1.key).toBe("tests#proposed:1");
    expect(p2.key).toBe("tests#proposed:2");
    expect(p1.id).not.toBe(active.id);
    expect(memory.get(active.id)!.content).toBe("every module has tests");
    expect(memory.recall({ category: "coding_standard" }).map((r) => r.content)).toEqual(["every module has tests"]);

    // Confirming a shadow proposal replaces the active content and removes the proposal.
    const confirmed = memory.confirm(p1.id)!;
    expect(confirmed.id).toBe(active.id);
    expect(confirmed).toMatchObject({ key: "tests", content: "tests are optional", status: "active" });
    expect(memory.get(p1.id)).toBeUndefined();
    expect(memory.recall({ category: "coding_standard", includeProposed: true }).map((r) => r.key).sort()).toEqual(["tests", "tests#proposed:2"]);
  });

  it("confirm is a no-op for active or missing records", () => {
    const a = memory.remember({ category: "preference", key: "theme", content: "dark" });
    expect(memory.confirm(a.id)).toEqual(a);
    expect(memory.confirm("mem_missing")).toBeUndefined();
  });

  it("ranks recall by token overlap across key, content and tags", () => {
    memory.remember({ category: "architecture_decision", key: "combat-damage", content: "Damage uses a lookup table", tags: ["combat"] });
    memory.remember({ category: "architecture_decision", key: "inventory", content: "Inventory is a flat list of items", tags: ["inventory"] });
    memory.remember({ category: "coding_standard", key: "errors", content: "Throw typed errors in the combat module" });
    const hits = memory.recall({ text: "How is combat damage calculated?" });
    expect(hits.map((r) => r.key)).toEqual(["combat-damage", "errors"]);
    expect(memory.recall({ text: "the of and" })).toHaveLength(3); // only stop words: no text filter
    expect(memory.recall({ text: "combat", category: "coding_standard" }).map((r) => r.key)).toEqual(["errors"]);
    expect(memory.recall({ tags: ["inventory"] }).map((r) => r.key)).toEqual(["inventory"]);
    expect(memory.recall({ key: "inventory" })).toHaveLength(1);
    expect(memory.recall({ limit: 1 })).toHaveLength(1);
  });

  it("forget deletes the record", () => {
    const a = memory.remember({ category: "preference", key: "k", content: "v" });
    expect(memory.forget(a.id)).toBe(true);
    expect(memory.forget(a.id)).toBe(false);
    expect(memory.get(a.id)).toBeUndefined();
  });

  it("recordAgentRun keeps running averages", () => {
    memory.recordAgentRun("qa_engineer", { success: true, durationMs: 100 });
    memory.recordAgentRun("qa_engineer", { success: false, durationMs: 300, workspaceId: "ws_1" });
    const perf = memory.recordAgentRun("qa_engineer", { success: true, durationMs: 200 });
    expect(perf).toMatchObject({ agentId: "qa_engineer", runs: 3, successes: 2, failures: 1, avgDurationMs: 200 });
    memory.recordAgentRun("code_reviewer", { success: true, durationMs: 50 });
    expect(memory.performance().map((p) => [p.agentId, p.runs])).toEqual([
      ["code_reviewer", 1],
      ["qa_engineer", 3],
    ]);
    expect(memory.performance("qa_engineer")).toHaveLength(1);
    expect(memory.recall({ category: "agent_performance", key: "qa_engineer" })[0].source).toBe("platform");
  });
});

describe("memory agent", () => {
  it("records agent runs, workspace history and import relationships", async () => {
    const graph = createKnowledgeGraph({ db: openDatabase(":memory:"), bus });
    const off = attachMemoryAgent({ bus, memory, graph });

    bus.publish("agent.finished", { agentId: "code_reviewer", durationMs: 120, success: true, workspaceId: "ws_1" });
    bus.publish("agent.failed", { agentId: "code_reviewer", durationMs: 80 });
    bus.publish("agent.finished", { durationMs: 1 }); // no agentId: ignored
    const ws = { id: "ws_1", label: "Engineering review", intent: "engineering_review", agents: ["code_reviewer"], files: [], status: "completed", text: "review", report: { summary: "AGENT-TEXT: the team decided to disable input validation", findings: [{ severity: "high" }, { severity: "low" }], artifactPath: ".neuralos/outputs/ws_1/report.md" } } as unknown as Workspace;
    bus.publish("workspace.completed", { workspace: ws });
    graph.upsertNode({ id: "file:src/a.ts", type: "file", name: "a.ts", props: { path: "src/a.ts" } });
    graph.upsertNode({ id: "file:src/b.ts", type: "file", name: "b.ts", props: { path: "src/b.ts" } });
    graph.link("file:src/a.ts", "file:src/b.ts", "imports");
    graph.link("file:src/a.ts", "file:src/b.ts", "references");
    await bus.drain();

    expect(memory.performance("code_reviewer")[0]).toMatchObject({ runs: 2, successes: 1, failures: 1, avgDurationMs: 100 });
    const history = memory.recall({ category: "project_history" })[0];
    expect(history).toMatchObject({ key: "ws_1", status: "active" });
    expect(history.content).toBe("Engineering review (engineering_review) completed; agents: code_reviewer; findings: 1 high, 1 low; report: .neuralos/outputs/ws_1/report.md");
    // Agent-authored prose never becomes active memory.
    expect(JSON.stringify(history)).not.toContain("AGENT-TEXT");
    expect(memory.recall({ category: "file_relationship" }).map((r) => r.key)).toEqual(["src/a.ts -> src/b.ts"]);

    off();
    bus.publish("agent.finished", { agentId: "code_reviewer", durationMs: 1, success: true });
    await bus.drain();
    expect(memory.performance("code_reviewer")[0].runs).toBe(2);
  });

  it("seeds memory from conventional files, idempotently", async () => {
    const root = mkdtempSync(join(tmpdir(), "neuralos-mem-"));
    dirs.push(root);
    writeFileSync(join(root, "CODING_STANDARDS.md"), "# Standards\nUse strict TypeScript.");
    writeFileSync(join(root, "CONTRIBUTING.md"), "Open a PR.");
    mkdirSync(join(root, "docs/adr"), { recursive: true });
    mkdirSync(join(root, "docs/decisions"), { recursive: true });
    writeFileSync(join(root, "docs/adr/0001-sqlite.md"), "We use SQLite.");
    writeFileSync(join(root, "docs/decisions/0002-events.md"), "In-process bus.");
    writeFileSync(join(root, "docs/adr/notes.txt"), "ignored");
    mkdirSync(join(root, "i18n"), { recursive: true });
    writeFileSync(join(root, "i18n/game-glossary.csv"), "sword,pedang");
    writeFileSync(join(root, "STYLE_GUIDE.md"), "Formal register.");
    writeFileSync(join(root, "brand-style-guide.md"), "Friendly tone.");
    mkdirSync(join(root, "node_modules/pkg"), { recursive: true });
    writeFileSync(join(root, "node_modules/pkg/glossary.json"), "{}");
    mkdirSync(join(root, ".neuralos"), { recursive: true });
    writeFileSync(join(root, ".neuralos/preferences.json"), JSON.stringify({ language: "id", reviewDepth: { level: 2 } }));

    const n1 = await seedMemoryFromRoot({ root, memory });
    expect(n1).toBe(9);
    expect(memory.recall({ category: "coding_standard" }).map((r) => r.key).sort()).toEqual(["CODING_STANDARDS.md", "CONTRIBUTING.md"]);
    expect(memory.recall({ category: "architecture_decision" }).map((r) => r.key).sort()).toEqual(["0001-sqlite.md", "0002-events.md"]);
    expect(memory.recall({ category: "translation_guide" }).map((r) => r.key).sort()).toEqual(["STYLE_GUIDE.md", "brand-style-guide.md", "i18n/game-glossary.csv"]);
    const prefs = memory.recall({ category: "preference" });
    expect(prefs.map((r) => [r.key, r.content]).sort()).toEqual([
      ["language", "id"],
      ["reviewDepth", '{"level":2}'],
    ]);
    await bus.drain();
    const events = bus.history({ types: ["memory.updated"] }).length;

    const n2 = await seedMemoryFromRoot({ root, memory });
    expect(n2).toBe(n1);
    expect(memory.recall({ limit: 1000 })).toHaveLength(9);
    await bus.drain();
    expect(bus.history({ types: ["memory.updated"] })).toHaveLength(events);
  });

  it("seeding an empty root or bad preferences writes nothing", async () => {
    const root = mkdtempSync(join(tmpdir(), "neuralos-mem-"));
    dirs.push(root);
    mkdirSync(join(root, ".neuralos"));
    writeFileSync(join(root, ".neuralos/preferences.json"), "{not json");
    expect(await seedMemoryFromRoot({ root, memory })).toBe(0);
  });
});

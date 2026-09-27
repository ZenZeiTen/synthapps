import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createEventBus } from "../src/events/bus";
import { createKnowledgeGraph } from "../src/graph/store";
import { openDatabase, type Database } from "../src/kernel/db";
import { createMemoryService } from "../src/memory/service";
import type { IntentResult, KernelEvent, PlanStep } from "../src/kernel/types";
import { createWorkspaceGenerator, outputDirFor, toolServerNode } from "../src/workspace/generator";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0).reverse()) c();
});

function setup(dbFile = ":memory:", root?: string) {
  const dir = root ?? mkdtempSync(path.join(os.tmpdir(), "nos-ws-"));
  if (!root) cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const db: Database = openDatabase(dbFile === ":memory:" ? ":memory:" : path.join(dir, dbFile));
  const bus = createEventBus({ db });
  const graph = createKnowledgeGraph({ db, bus });
  const memory = createMemoryService({ db, bus });
  const files = new Set(["src/inventory/inventory.ts", "src/merchants/shop.ts", "contracts/services-agreement.md", "website/index.html"]);
  graph.upsertNode({ id: "project:demo", type: "project", name: "Demo", props: {} });
  for (const f of files) graph.upsertNode({ id: `file:${f}`, type: "file", name: path.basename(f), props: { path: f, kind: f.endsWith(".ts") ? "code" : "doc" } });
  const index = { hasFile: (p: string) => files.has(p) };
  const gen = createWorkspaceGenerator({ db, graph, bus, root: dir, dataDir: path.join(dir, ".neuralos"), index, memory });
  const events: KernelEvent[] = [];
  bus.subscribe("workspace.*", (e) => void events.push(e));
  cleanups.push(() => {
    bus.close();
    db.close();
  });
  return { dir, db, bus, graph, memory, gen, events };
}

function step(id: string, agent: string, tools: string[], dependsOn: string[] = []): PlanStep {
  return { id, agent, task: `${agent} task`, dependsOn, tools };
}

function intent(over: Partial<IntentResult> = {}): IntentResult {
  return {
    id: "intent_1",
    text: "Review inventory module",
    intent: "engineering_review",
    required_agents: ["systems_architect", "code_reviewer", "qa_engineer"],
    required_tools: ["git", "filesystem"],
    confidence: 0.9,
    source: "heuristic",
    label: "Engineering review",
    priority: "normal",
    entities: { files: ["src/inventory/inventory.ts", "missing/file.ts"], topics: ["inventory"] },
    context: {
      files: [
        { path: "src/merchants/shop.ts", nodeId: "file:src/merchants/shop.ts", score: 1, snippet: "", kind: "code", mtimeMs: 0, reasons: [] },
        { path: "src/inventory/inventory.ts", nodeId: "file:src/inventory/inventory.ts", score: 0.5, snippet: "", kind: "code", mtimeMs: 0, reasons: [] },
      ],
      memory: [],
    },
    plan: [
      step("s1", "systems_architect", ["fs.read_file", "git.*"]),
      step("s2", "code_reviewer", ["fs.read_file", "search.semantic", "mcp.github.search_code"]),
      step("s3", "qa_engineer", ["fs.read_file", "proc.run_tests"], ["s2"]),
    ],
    resources: [],
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe("workspace generator", () => {
  it("maps tool names to server nodes", () => {
    expect(toolServerNode("fs.read_file")).toBe("mcp:builtin-fs");
    expect(toolServerNode("git.*")).toBe("mcp:builtin-git");
    expect(toolServerNode("mcp.github.search")).toBe("mcp:github");
    expect(toolServerNode("mcp.*")).toBeUndefined();
    expect(outputDirFor("ws_1")).toBe(".neuralos/outputs/ws_1");
    expect(outputDirFor(undefined)).toBe(".neuralos/outputs/adhoc");
    expect(outputDirFor("../x")).toBe(".neuralos/outputs/adhoc");
  });

  it("builds the graph node, edges, output folder and checkpoint, and emits workspace.generated", async () => {
    const { gen, graph, dir, events, bus, memory } = setup();
    memory.remember({ category: "coding_standard", key: "CODING_STANDARDS.md", content: "1. No magic numbers." });
    const ws = await gen.generate(intent());
    await bus.drain();

    expect(ws.id).toMatch(/^ws_/);
    expect(ws.nodeId).toBe(`workspace:${ws.id}`);
    expect(ws.status).toBe("ready");
    expect(ws.checkpoint).toEqual({ completedSteps: {} });
    expect(ws.files).toEqual(["src/inventory/inventory.ts", "src/merchants/shop.ts"]); // unknown files dropped, de-duplicated
    expect(ws.agents).toEqual(["systems_architect", "code_reviewer", "qa_engineer"]);
    expect(ws.tools).toContain("git.*");
    expect(ws.outputDir).toBe(`.neuralos/outputs/${ws.id}`);
    expect(existsSync(path.join(dir, ws.outputDir))).toBe(true);

    const node = graph.getNode(ws.nodeId)!;
    expect(node.type).toBe("workspace");
    expect(node.props).toMatchObject({ workspaceId: ws.id, intent: "engineering_review", label: "Engineering review", status: "ready", createdAt: ws.createdAt });

    const inbound = graph.edges({ nodeId: ws.nodeId, direction: "in" });
    const outbound = graph.edges({ nodeId: ws.nodeId, direction: "out" });
    expect(inbound.filter((e) => e.kind === "member_of").map((e) => e.source).sort()).toEqual(["file:src/inventory/inventory.ts", "file:src/merchants/shop.ts"]);
    expect(inbound.filter((e) => e.kind === "assigned_to").map((e) => e.source).sort()).toEqual(["agent:code_reviewer", "agent:qa_engineer", "agent:systems_architect"]);
    expect(inbound.some((e) => e.kind === "contains" && e.source === "project:demo")).toBe(true);
    expect(outbound.filter((e) => e.kind === "uses_tool").map((e) => e.target).sort()).toEqual(["mcp:builtin-fs", "mcp:builtin-git", "mcp:builtin-proc", "mcp:builtin-search", "mcp:github"]);
    expect(graph.getNode("mcp:builtin-fs")?.type).toBe("mcp");
    expect(graph.getNode("agent:code_reviewer")?.props.group).toBe("engineering");

    // engineering review gets the coding standards from memory as a resource
    expect(ws.resources).toContain(`Coding Standards: ${ws.outputDir}/coding-standards.md`);
    expect(readFileSync(path.join(dir, ws.outputDir, "coding-standards.md"), "utf8")).toContain("No magic numbers");
    expect(ws.resources).toContain(`Output Folder: ${ws.outputDir}`);

    const generated = events.filter((e) => e.type === "workspace.generated");
    expect(generated).toHaveLength(1);
    expect(generated[0].correlationId).toBe(ws.id);
    expect((generated[0].data as { workspace: { id: string } }).workspace.id).toBe(ws.id);
  });

  it("writes a glossary for legal translation and a style guide for localization from memory", async () => {
    const { gen, dir, memory, graph } = setup();
    memory.remember({ category: "translation_guide", key: "docs/glossary.md", content: "| Shop | Toko |", data: { path: "docs/glossary.md" } });
    memory.remember({ category: "preference", key: "tone", content: "friendly, informal" });

    const legal = await gen.generate(
      intent({ intent: "legal_translation", label: "Legal translation", text: "Translate contract", entities: { files: ["contracts/services-agreement.md"], topics: [] }, resources: ["Glossary", "Source File", "Output Folder"] }),
    );
    const glossary = readFileSync(path.join(dir, legal.outputDir, "glossary.md"), "utf8");
    expect(glossary).toContain("| Shop | Toko |");
    expect(glossary).toContain("docs/glossary.md");
    expect(legal.resources).toEqual(expect.arrayContaining([`Glossary: ${legal.outputDir}/glossary.md`, "Source File: contracts/services-agreement.md", `Output Folder: ${legal.outputDir}`]));
    expect(graph.edges({ nodeId: legal.nodeId, direction: "out", kind: "contains" }).map((e) => e.target)).toContain(`output:${legal.outputDir}/glossary.md`);

    const site = await gen.generate(intent({ intent: "website_localization", label: "Website localization", resources: ["Style Guide"], entities: { files: ["website/index.html"], topics: [], targetLanguage: "id" } }));
    const guide = readFileSync(path.join(dir, site.outputDir, "style-guide.md"), "utf8");
    expect(guide).toContain("friendly, informal");
    expect(guide).toContain("target language: id");
    expect(site.resources).toContain(`Style Guide: ${site.outputDir}/style-guide.md`);
  });

  it("gets, lists, updates and archives, and keeps workspaces across a restart", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "nos-ws-persist-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(path.join(dir, ".neuralos"), { recursive: true });
    const first = setup("state.db", dir);
    const a = await first.gen.generate(intent());
    const b = await first.gen.generate(intent({ text: "second" }));
    expect(first.gen.list().map((w) => w.id)).toEqual([a.id, b.id]);

    const updated = first.gen.update(a.id, { status: "running", checkpoint: { completedSteps: { s1: { instanceId: "ai_1", agentId: "systems_architect", output: { summary: "ok", findings: [], artifacts: [], confidence: 1, source: "offline" } } } } });
    expect(updated.status).toBe("running");
    expect(first.graph.getNode(a.nodeId)?.props.status).toBe("running");
    expect(() => first.gen.update("ws_missing", { status: "failed" })).toThrow(/Unknown workspace/);

    // undefined in a patch removes the field
    first.gen.update(a.id, { error: "boom" });
    expect(first.gen.get(a.id)?.error).toBe("boom");
    first.gen.update(a.id, { error: undefined });
    expect(first.gen.get(a.id)?.error).toBeUndefined();

    const archived = first.gen.archive(b.id)!;
    expect(archived.status).toBe("archived");
    await first.bus.drain();
    expect(first.events.some((e) => e.type === "workspace.archived" && e.correlationId === b.id)).toBe(true);
    expect(first.gen.archive("ws_missing")).toBeUndefined();

    // "restart": a new generator on the same database file
    first.bus.close();
    first.db.close();
    cleanups.pop();
    const second = setup("state.db", dir);
    const again = second.gen.get(a.id)!;
    expect(again.status).toBe("running");
    expect(Object.keys(again.checkpoint.completedSteps)).toEqual(["s1"]);
    expect(second.gen.get(b.id)?.status).toBe("archived");
    expect(second.gen.list()).toHaveLength(2);
  });
});

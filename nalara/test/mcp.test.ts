import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuditLog, EventBus, EventType, GraphNode, KernelEvent, KnowledgeGraph, McpServerConfig, Principal, ToolRegistry } from "../src/kernel/types";
import { classifyMcpTool, createMcpManager, mcpToolName, type NeuralMcpManager } from "../src/tools/mcp";
import { createToolRegistry } from "../src/tools/registry";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const NOTES: McpServerConfig = { command: "node", args: ["--import", "tsx", "test/fixtures/mcp-notes-server.ts"], cwd: ROOT };
const human: Principal = { userId: "local", chain: ["user:local"], depth: 0 };

// --- in-test fakes -----------------------------------------------------------

function fakeBus() {
  const events: KernelEvent[] = [];
  const bus = {
    publish(type: EventType, data: unknown, opts?: { source?: string }) {
      const e = { id: `e${events.length + 1}`, seq: events.length + 1, type, ts: "", source: opts?.source ?? "t", data } as KernelEvent;
      events.push(e);
      return e;
    },
  } as unknown as EventBus;
  return { bus, events, of: (type: EventType) => events.filter((e) => e.type === type).map((e) => e.data as Record<string, unknown>) };
}

function fakeGraph() {
  const nodes = new Map<string, GraphNode>();
  const graph = {
    upsertNode(input: { id?: string; type: GraphNode["type"]; name: string; props?: Record<string, unknown> }) {
      const prev = nodes.get(input.id!);
      const node: GraphNode = { id: input.id!, type: input.type, name: input.name, props: { ...(prev?.props ?? {}), ...(input.props ?? {}) }, createdAt: "", updatedAt: "" };
      nodes.set(node.id, node);
      return node;
    },
    getNode: (id: string) => nodes.get(id),
  } as unknown as KnowledgeGraph;
  return { graph, nodes };
}

const audit: AuditLog = { append: (e) => ({ ...e, seq: 1, ts: "", prevHash: "", hash: "" }), list: () => [], verify: () => null };

let managers: NeuralMcpManager[] = [];

function setup(approvedHashes?: Record<string, string>) {
  const b = fakeBus();
  const g = fakeGraph();
  const registry: ToolRegistry = createToolRegistry({ bus: b.bus, audit, policy: { mode: "ask" } });
  const mcp = createMcpManager({ registry, graph: g.graph, bus: b.bus, approvedHashes });
  managers.push(mcp);
  return { registry, mcp, ...b, ...g };
}

afterEach(async () => {
  await Promise.all(managers.map((m) => m.closeAll()));
  managers = [];
});

// --- tests ----------------------------------------------------------------------

describe("helpers", () => {
  it("classifies tools from annotations and sanitizes names", () => {
    expect(classifyMcpTool({ name: "list_issues", annotations: { readOnlyHint: true } })).toEqual({ action: "read", reversibility: "reversible" });
    expect(classifyMcpTool({ name: "query_db", annotations: { readOnlyHint: true } })).toEqual({ action: "search", reversibility: "reversible" });
    expect(classifyMcpTool({ name: "create_issue" })).toEqual({ action: "write", reversibility: "irreversible" });
    expect(classifyMcpTool({ name: "run_workflow", annotations: { readOnlyHint: false } })).toEqual({ action: "execute", reversibility: "irreversible" });
    expect(mcpToolName("git hub", "get/file.v2")).toBe("mcp.git_hub.get_file_v2");
  });
});

describe("MCP manager over stdio", () => {
  it("registers the server's tools with action and reversibility from annotations, and adds a graph node", async () => {
    const { registry, mcp, nodes, of } = setup();
    const status = await mcp.connect("notes", NOTES);
    expect(status.status).toBe("connected");
    expect(status.transport).toBe("stdio");
    expect(status.tools.sort()).toEqual(["mcp.notes.add_note", "mcp.notes.list_notes", "mcp.notes.search_notes"]);
    expect(status.changedTools).toEqual([]);

    const shape = (n: string) => {
      const d = registry.get(n)!;
      return [d.server, d.action, d.reversibility, d.scope].join("/");
    };
    expect(shape("mcp.notes.list_notes")).toBe("mcp:notes/read/reversible/external");
    expect(shape("mcp.notes.search_notes")).toBe("mcp:notes/search/reversible/external");
    expect(shape("mcp.notes.add_note")).toBe("mcp:notes/write/irreversible/external");
    expect(registry.get("mcp.notes.add_note")!.hash).toMatch(/^[0-9a-f]{64}$/);

    const node = nodes.get("mcp:notes")!;
    expect(node.type).toBe("mcp");
    expect(node.props).toMatchObject({ transport: "stdio", status: "connected" });
    expect((node.props.tools as string[]).length).toBe(3);
    expect(of("mcp.connected")[0]).toMatchObject({ name: "notes", transport: "stdio" });
    expect(mcp.status()).toHaveLength(1);
  });

  it("calls tools through the registry; writes need approval under ask", async () => {
    const { registry, mcp } = setup();
    await mcp.connect("notes", NOTES);

    const list = await registry.call("mcp.notes.list_notes", {}, { principal: human });
    expect(list.ok).toBe(true);
    expect(list.content).toContain("Combat damage");

    const search = await registry.call("mcp.notes.search_notes", { query: "MERCHANT" }, { principal: human });
    expect(search.content).toBe("#2 Merchants restock every in-game day");

    const pending = registry.call("mcp.notes.add_note", { text: "Boss has 3 phases" }, { principal: human });
    await vi.waitFor(() => expect(registry.approvals("pending")).toHaveLength(1));
    const approval = registry.approvals("pending")[0];
    expect(approval.tool).toBe("mcp.notes.add_note");
    registry.resolveApproval(approval.id, true);
    const added = await pending;
    expect(added.ok).toBe(true);
    expect(added.content).toBe("Added note #3");
    expect(added.data).toEqual({ id: 3 });
    expect((await registry.call("mcp.notes.list_notes", {}, { principal: human })).content).toContain("#3 Boss has 3 phases");

    // isError results become ok:false
    const failing = registry.call("mcp.notes.add_note", { text: "fail" }, { principal: human });
    await vi.waitFor(() => expect(registry.approvals("pending")).toHaveLength(1));
    registry.resolveApproval(registry.approvals("pending")[0].id, true);
    const failed = await failing;
    expect(failed.ok).toBe(false);
    expect(failed.content).toContain("refusing");
  });

  it("disconnect removes the tools, updates the graph and emits mcp.disconnected", async () => {
    const { registry, mcp, nodes, of } = setup();
    await mcp.connect("notes", NOTES);
    await mcp.disconnect("notes");
    expect(registry.list({ server: "mcp:notes" })).toHaveLength(0);
    expect(mcp.status()[0]).toMatchObject({ status: "disconnected", tools: [] });
    expect(nodes.get("mcp:notes")!.props.status).toBe("disconnected");
    expect(of("mcp.disconnected")[0]).toMatchObject({ name: "notes" });
    const r = await registry.call("mcp.notes.list_notes", {}, { principal: human });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown tool/);
  });

  it("reports a connection failure as an error status instead of throwing", async () => {
    const { registry, mcp, nodes } = setup();
    const bad = await mcp.connect("broken", { command: "definitely-not-a-real-command-nalara" });
    expect(bad.status).toBe("error");
    expect(bad.error).toBeTruthy();
    expect(registry.list()).toHaveLength(0);
    expect(nodes.get("mcp:broken")!.props.status).toBe("error");

    const crash = await mcp.connect("crash", { command: "node", args: ["-e", "process.stderr.write('boom'); process.exit(1)"] });
    expect(crash.status).toBe("error");

    const empty = await mcp.connect("empty", {});
    expect(empty).toMatchObject({ status: "error", error: expect.stringMatching(/command .* or url/) });
  });

  it("disables a tool whose hash differs from the approved one", async () => {
    const { registry, mcp } = setup({ "mcp.notes.add_note": "0".repeat(64) });
    const status = await mcp.connect("notes", NOTES);
    expect(status.changedTools).toEqual(["mcp.notes.add_note"]);
    const def = registry.get("mcp.notes.add_note")!;
    expect(def.disabled).toBe(true);
    expect(def.disabledReason).toBe("definition changed since approval");
    expect(registry.get("mcp.notes.list_notes")!.disabled).toBeFalsy();
    const r = await registry.call("mcp.notes.add_note", { text: "x" }, { principal: human });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/disabled: definition changed/);

    expect(mcp.reapprove("mcp.notes.add_note")).toBe(true);
    expect(registry.get("mcp.notes.add_note")!.disabled).toBe(false);
    expect(mcp.status()[0].changedTools).toEqual([]);
    expect(mcp.approvedHashes()["mcp.notes.add_note"]).toBe(def.hash);
  });

  it("keeps first-connect hashes: an unchanged reconnect passes, a changed definition is disabled", async () => {
    const { registry, mcp } = setup();
    const first = await mcp.connect("notes", NOTES);
    const pinned = mcp.approvedHashes();
    expect(Object.keys(pinned)).toHaveLength(3);

    const again = await mcp.connect("notes", NOTES);
    expect(again.changedTools).toEqual([]);

    const changed = await mcp.connect("notes", { ...NOTES, env: { NOTES_VARIANT: "changed" } });
    expect(changed.status).toBe("connected");
    expect(changed.changedTools).toEqual(["mcp.notes.search_notes"]);
    expect(registry.get("mcp.notes.search_notes")!.disabled).toBe(true);
    expect(registry.get("mcp.notes.list_notes")!.disabled).toBeFalsy();
    expect(mcp.approvedHashes()).toEqual(pinned);
    expect(first.tools.sort()).toEqual(changed.tools.sort());
  });

  it("re-lists on notifications/tools/list_changed and disables a tool that changed", async () => {
    const { registry, mcp, of } = setup();
    const status = await mcp.connect("notes", { ...NOTES, env: { NOTES_MUTATE_AFTER_MS: "500" } });
    expect(status.changedTools).toEqual([]);
    await vi.waitFor(() => expect(registry.get("mcp.notes.search_notes")?.disabled).toBe(true), { timeout: 5000 });
    expect(mcp.status()[0].changedTools).toEqual(["mcp.notes.search_notes"]);
    expect(registry.get("mcp.notes.search_notes")!.description).toMatch(/changed at runtime/);
    expect(of("mcp.connected").some((d) => d.refreshed === true)).toBe(true);
  });

  it("closeAll disconnects every server", async () => {
    const { registry, mcp } = setup();
    await Promise.all([mcp.connect("notes", NOTES), mcp.connect("notes2", NOTES)]);
    expect(registry.list()).toHaveLength(6);
    await mcp.closeAll();
    expect(registry.list()).toHaveLength(0);
    expect(mcp.status().every((s) => s.status === "disconnected")).toBe(true);
  });
});

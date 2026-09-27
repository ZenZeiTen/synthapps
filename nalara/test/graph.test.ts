import { beforeEach, describe, expect, it } from "vitest";
import { createEventBus } from "../src/events/bus";
import { createKnowledgeGraph } from "../src/graph/store";
import { openDatabase } from "../src/kernel/db";
import type { EventBus, KnowledgeGraph } from "../src/kernel/types";

let bus: EventBus;
let graph: KnowledgeGraph;

beforeEach(() => {
  bus = createEventBus();
  graph = createKnowledgeGraph({ db: openDatabase(":memory:"), bus });
});

const file = (p: string) => graph.upsertNode({ id: `file:${p}`, type: "file", name: p, props: { path: p } });

describe("knowledge graph", () => {
  it("creates, merges props and emits only on change", async () => {
    const n = graph.upsertNode({ id: "file:a.ts", type: "file", name: "a.ts", props: { size: 1, lang: "ts" } });
    expect(n.createdAt).toBe(n.updatedAt);
    const same = graph.upsertNode({ id: "file:a.ts", type: "file", name: "a.ts", props: { size: 1 } });
    expect(same.props).toEqual({ size: 1, lang: "ts" });
    const upd = graph.upsertNode({ id: "file:a.ts", type: "file", name: "a.ts", props: { size: 2 } });
    expect(upd.props).toEqual({ size: 2, lang: "ts" });
    expect(graph.getNode("file:a.ts")!.props).toEqual({ size: 2, lang: "ts" });
    await bus.drain();
    expect(bus.history({ types: ["node.*"] }).map((e) => e.type)).toEqual(["node.created", "node.updated"]);
  });

  it("generates an id when none is given", () => {
    const n = graph.upsertNode({ type: "concept", name: "Combat System" });
    expect(n.id).toMatch(/^concept_/);
    expect(graph.getNode(n.id)?.name).toBe("Combat System");
  });

  it("finds nodes by type, name, substring and prop", () => {
    file("src/Combat.ts");
    file("src/inventory.ts");
    graph.upsertNode({ id: "agent:qa", type: "agent", name: "QA Engineer", props: { group: "engineering" } });
    expect(graph.findNodes({ type: "file" })).toHaveLength(2);
    expect(graph.findNodes({ type: ["file", "agent"] })).toHaveLength(3);
    expect(graph.findNodes({ name: "src/inventory.ts" }).map((n) => n.id)).toEqual(["file:src/inventory.ts"]);
    expect(graph.findNodes({ nameContains: "combat" }).map((n) => n.id)).toEqual(["file:src/Combat.ts"]);
    expect(graph.findNodes({ prop: { key: "group", value: "engineering" } }).map((n) => n.id)).toEqual(["agent:qa"]);
    expect(graph.findNodes({ limit: 1 })).toHaveLength(1);
  });

  it("link is idempotent and requires both nodes", async () => {
    file("a.ts");
    file("b.ts");
    const e1 = graph.link("file:a.ts", "file:b.ts", "imports");
    const e2 = graph.link("file:a.ts", "file:b.ts", "imports", { x: 1 });
    expect(e2.id).toBe(e1.id);
    graph.link("file:a.ts", "file:b.ts", "references");
    expect(graph.edges({ nodeId: "file:a.ts" })).toHaveLength(2);
    expect(() => graph.link("file:a.ts", "file:missing.ts", "imports")).toThrow(/not found/);
    expect(() => graph.link("file:missing.ts", "file:a.ts", "imports")).toThrow(/not found/);
    await bus.drain();
    expect(bus.history({ types: ["edge.created"] })).toHaveLength(2);
  });

  it("filters edges by direction and kind, and unlinks", () => {
    file("a.ts");
    file("b.ts");
    file("c.ts");
    graph.link("file:a.ts", "file:b.ts", "imports");
    graph.link("file:c.ts", "file:a.ts", "imports");
    graph.link("file:a.ts", "file:c.ts", "references");
    expect(graph.edges({ nodeId: "file:a.ts", direction: "out" })).toHaveLength(2);
    expect(graph.edges({ nodeId: "file:a.ts", direction: "in" })).toHaveLength(1);
    expect(graph.edges({ nodeId: "file:a.ts", kind: "imports" })).toHaveLength(2);
    expect(graph.edges({ kind: ["references"] })).toHaveLength(1);
    expect(graph.unlink("file:a.ts", "file:c.ts", "imports")).toBe(0);
    expect(graph.unlink("file:a.ts", "file:c.ts")).toBe(1);
    expect(graph.edges({})).toHaveLength(2);
  });

  it("removeNode cascades incident edges", async () => {
    file("a.ts");
    file("b.ts");
    file("c.ts");
    graph.link("file:a.ts", "file:b.ts", "imports");
    graph.link("file:c.ts", "file:a.ts", "imports");
    graph.link("file:b.ts", "file:c.ts", "imports");
    expect(graph.removeNode("file:a.ts")).toBe(true);
    expect(graph.removeNode("file:a.ts")).toBe(false);
    expect(graph.edges({}).map((e) => [e.source, e.target])).toEqual([["file:b.ts", "file:c.ts"]]);
    await bus.drain();
    expect(bus.history({ types: ["node.removed"] })[0].data).toMatchObject({ id: "file:a.ts", edges: 2 });
  });

  it("neighbors walks BFS with depth, direction and kind", () => {
    for (const p of ["a", "b", "c", "d"]) file(p);
    graph.link("file:a", "file:b", "imports");
    graph.link("file:b", "file:c", "imports");
    graph.link("file:c", "file:d", "references");
    graph.link("file:d", "file:a", "imports");
    const ids = (ns: { id: string }[]) => ns.map((n) => n.id).sort();
    expect(ids(graph.neighbors("file:a"))).toEqual(["file:b", "file:d"]);
    expect(ids(graph.neighbors("file:a", { direction: "out" }))).toEqual(["file:b"]);
    expect(ids(graph.neighbors("file:a", { direction: "out", depth: 2 }))).toEqual(["file:b", "file:c"]);
    expect(ids(graph.neighbors("file:a", { depth: 3 }))).toEqual(["file:b", "file:c", "file:d"]);
    expect(ids(graph.neighbors("file:b", { kind: "references", depth: 5 }))).toEqual([]);
    // c <-imports- b <-imports- a <-imports- d
    expect(ids(graph.neighbors("file:c", { kind: "imports", direction: "in", depth: 5 }))).toEqual(["file:a", "file:b", "file:d"]);
  });

  it("shortestPath ignores direction and respects maxDepth", () => {
    for (const p of ["a", "b", "c", "d", "e"]) file(p);
    graph.link("file:a", "file:b", "imports");
    graph.link("file:c", "file:b", "imports");
    graph.link("file:c", "file:d", "imports");
    expect(graph.shortestPath("file:a", "file:d")).toEqual(["file:a", "file:b", "file:c", "file:d"]);
    expect(graph.shortestPath("file:a", "file:a")).toEqual(["file:a"]);
    expect(graph.shortestPath("file:a", "file:e")).toBeNull();
    expect(graph.shortestPath("file:a", "file:d", 2)).toBeNull();
    expect(graph.shortestPath("file:a", "file:nope")).toBeNull();
  });

  it("subgraph from a root or the whole graph, with edges restricted to returned nodes", () => {
    for (const p of ["a", "b", "c", "d"]) file(p);
    graph.upsertNode({ id: "agent:qa", type: "agent", name: "QA" });
    graph.link("file:a", "file:b", "imports");
    graph.link("file:b", "file:c", "imports");
    graph.link("file:c", "file:d", "imports");
    graph.link("agent:qa", "file:a", "relates_to");

    const s1 = graph.subgraph({ rootId: "file:a", depth: 1 });
    expect(s1.nodes.map((n) => n.id).sort()).toEqual(["agent:qa", "file:a", "file:b"]);
    expect(s1.edges).toHaveLength(2);

    const s2 = graph.subgraph({ rootId: "file:a", depth: 2, types: ["file"] });
    expect(s2.nodes.map((n) => n.id).sort()).toEqual(["file:a", "file:b", "file:c"]);
    expect(s2.edges.every((e) => e.source.startsWith("file:") && e.target.startsWith("file:"))).toBe(true);

    const all = graph.subgraph({ limit: 2 });
    expect(all.nodes).toHaveLength(2);
    const ids = new Set(all.nodes.map((n) => n.id));
    expect(all.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
    expect(graph.subgraph({ rootId: "missing" })).toEqual({ nodes: [], edges: [] });
  });

  it("stats counts nodes, edges and types", () => {
    file("a");
    file("b");
    graph.upsertNode({ id: "agent:x", type: "agent", name: "X" });
    graph.link("file:a", "file:b", "imports");
    expect(graph.stats()).toEqual({ nodes: 3, edges: 1, byType: { file: 2, agent: 1 } });
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSemanticIndex, detectKind, stem, type SemanticIndexImpl } from "../src/search/index";
import type { EdgeKind, EdgeQuery, GraphEdge, GraphNode, KnowledgeGraph, NodeQuery, NodeType } from "../src/kernel/types";

const DEMO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../demo/breath-of-fire-iv-remake");

/** Map-backed KnowledgeGraph, so these tests do not depend on the SQLite graph store. */
export function createFakeGraph(): KnowledgeGraph & { nodes: Map<string, GraphNode>; edgeList: GraphEdge[] } {
  const nodes = new Map<string, GraphNode>();
  let edgeList: GraphEdge[] = [];
  let seq = 0;
  const now = () => new Date().toISOString();
  const kinds = (k?: EdgeKind | EdgeKind[]) => (k === undefined ? undefined : Array.isArray(k) ? k : [k]);
  const edgesOf = (q: EdgeQuery) => {
    const ks = kinds(q.kind);
    const dir = q.direction ?? "both";
    return edgeList.filter((e) => {
      if (ks && !ks.includes(e.kind)) return false;
      if (!q.nodeId) return true;
      if (dir === "out") return e.source === q.nodeId;
      if (dir === "in") return e.target === q.nodeId;
      return e.source === q.nodeId || e.target === q.nodeId;
    });
  };
  const graph = {
    nodes,
    get edgeList() {
      return edgeList;
    },
    upsertNode(input: { id?: string; type: NodeType; name: string; props?: Record<string, unknown> }) {
      const id = input.id ?? `node_${++seq}`;
      const existing = nodes.get(id);
      const node: GraphNode = existing
        ? { ...existing, type: input.type, name: input.name, props: { ...existing.props, ...input.props }, updatedAt: now() }
        : { id, type: input.type, name: input.name, props: { ...input.props }, createdAt: now(), updatedAt: now() };
      nodes.set(id, node);
      return node;
    },
    getNode: (id: string) => nodes.get(id),
    findNodes(q: NodeQuery) {
      const types = q.type === undefined ? undefined : Array.isArray(q.type) ? q.type : [q.type];
      return [...nodes.values()]
        .filter((n) => (!types || types.includes(n.type)) && (!q.name || n.name === q.name))
        .filter((n) => !q.nameContains || n.name.toLowerCase().includes(q.nameContains.toLowerCase()))
        .filter((n) => !q.prop || n.props[q.prop.key] === q.prop.value)
        .slice(0, q.limit ?? Infinity);
    },
    removeNode(id: string) {
      edgeList = edgeList.filter((e) => e.source !== id && e.target !== id);
      return nodes.delete(id);
    },
    link(source: string, target: string, kind: EdgeKind, props: Record<string, unknown> = {}) {
      if (!nodes.has(source) || !nodes.has(target)) throw new Error(`link: missing node ${source} -> ${target}`);
      const found = edgeList.find((e) => e.source === source && e.target === target && e.kind === kind);
      if (found) return found;
      const edge: GraphEdge = { id: `edge_${++seq}`, source, target, kind, props, createdAt: now() };
      edgeList.push(edge);
      return edge;
    },
    unlink(source: string, target: string, kind?: EdgeKind) {
      const before = edgeList.length;
      edgeList = edgeList.filter((e) => !(e.source === source && e.target === target && (!kind || e.kind === kind)));
      return before - edgeList.length;
    },
    edges: edgesOf,
    neighbors(id: string, opts: { kind?: EdgeKind | EdgeKind[]; direction?: "out" | "in" | "both" } = {}) {
      return edgesOf({ nodeId: id, kind: opts.kind, direction: opts.direction })
        .map((e) => nodes.get(e.source === id ? e.target : e.source))
        .filter((n): n is GraphNode => Boolean(n));
    },
    shortestPath: () => null,
    subgraph: () => ({ nodes: [...nodes.values()], edges: edgeList }),
    stats() {
      const byType: Record<string, number> = {};
      for (const n of nodes.values()) byType[n.type] = (byType[n.type] ?? 0) + 1;
      return { nodes: nodes.size, edges: edgeList.length, byType };
    },
  };
  return graph;
}

async function copyDemo(): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "neuralos-search-"));
  await fsp.cp(DEMO, dir, { recursive: true });
  return dir;
}

const top = (hits: { path: string }[], n = 3) => hits.slice(0, n).map((h) => h.path);

describe("helpers", () => {
  it("stems plurals and derivations to shared bases", () => {
    expect(stem("calculations")).toBe("calcul");
    expect(stem("calculate")).toBe("calcul");
    expect(stem("damaged")).toBe(stem("damage"));
    expect(stem("merchants")).toBe("merchant");
    expect(stem("inventories")).toBe("inventory");
    expect(stem("shopping")).toBe("shop");
  });

  it("detects file kinds", () => {
    expect(detectKind("src/combat/damage.ts")).toBe("code");
    expect(detectKind("tests/damage.test.ts")).toBe("test");
    expect(detectKind("lib/foo.spec.js")).toBe("test");
    expect(detectKind("docs/design/combat.md")).toBe("doc");
    expect(detectKind("website/index.html")).toBe("doc");
    expect(detectKind("package.json")).toBe("config");
    expect(detectKind("data/prices.csv")).toBe("data");
  });
});

describe("semantic index over the demo project", () => {
  let root: string;
  let graph: ReturnType<typeof createFakeGraph>;
  let index: SemanticIndexImpl;

  beforeAll(async () => {
    root = await copyDemo();
    // Make damage.ts the most recently modified file so "latest" has something to prefer.
    const old = new Date(Date.now() - 86_400_000);
    for (const p of ["src/combat/battle_system.ts", "src/combat/elements.ts", "tests/damage.test.ts", "docs/design/combat.md"]) {
      await fsp.utimes(path.join(root, p), old, old);
    }
    graph = createFakeGraph();
    index = createSemanticIndex({ root, graph });
    const result = await index.indexAll();
    expect(result.files).toBeGreaterThanOrEqual(19);
  });

  afterAll(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('"combat code" returns the combat sources', () => {
    const hits = index.search("combat code");
    expect(top(hits).every((p) => p.startsWith("src/combat/"))).toBe(true);
    expect(hits.every((h) => h.kind === "code" || h.kind === "test")).toBe(true);
    expect(hits[0].reasons.length).toBeGreaterThan(0);
  });

  it('"latest damage calculations" puts damage.ts first', () => {
    const hits = index.search("latest damage calculations");
    expect(hits[0].path).toBe("src/combat/damage.ts");
    expect(hits[0].reasons.join(" ")).toMatch(/matches: damage, calculations/);
    expect(hits[0].reasons).toContain("recently modified");
    expect(hits[0].line).toBeGreaterThan(0);
    expect(hits[0].snippet.toLowerCase()).toMatch(/damage|calculat/);
  });

  it('"files related to inventory" finds inventory.ts and the shop that imports it', () => {
    const hits = index.search("files related to inventory");
    expect(hits[0].path).toBe("src/inventory/inventory.ts");
    const shop = hits.findIndex((h) => h.path === "src/merchants/shop.ts");
    expect(shop).toBeGreaterThan(-1);
    expect(shop).toBeLessThan(3);
    expect(hits[shop].reasons).toContain("imports inventory.ts");
  });

  it('"design docs referencing merchants" puts the merchants design doc first', () => {
    const hits = index.search("design docs referencing merchants");
    expect(hits[0].path).toBe("docs/design/merchants.md");
    expect(hits.every((h) => h.kind === "doc")).toBe(true);
    expect(hits[0].reasons.join(" ")).toMatch(/mentions merchants/);
  });

  it("expands concepts: battle finds combat files with a lower weight than exact matches", () => {
    const hits = index.search("fight");
    expect(top(hits, 5)).toContain("src/combat/battle_system.ts");
    expect(hits[0].reasons.join(" ")).toMatch(/Combat System/);
  });

  it("honours an explicit kind filter and the tests keyword", () => {
    expect(index.search("inventory", { kind: "test" }).map((h) => h.path)).toEqual(["tests/inventory.test.ts"]);
    expect(index.search("tests for damage")[0].path).toBe("tests/damage.test.ts");
  });

  it("writes project, folder and file nodes with contains edges", () => {
    const project = graph.getNode("project:breath-of-fire-iv-remake");
    expect(project?.name).toBe("Breath of Fire IV Remake");
    const file = graph.getNode("file:src/combat/damage.ts");
    expect(file?.type).toBe("file");
    expect(file?.props).toMatchObject({ path: "src/combat/damage.ts", kind: "code" });
    expect(file?.props.lines).toBeGreaterThan(10);
    const contains = (s: string, t: string) => graph.edges({ nodeId: s, direction: "out", kind: "contains" }).some((e) => e.target === t);
    expect(contains("folder:src/combat", "file:src/combat/damage.ts")).toBe(true);
    expect(contains("folder:src", "folder:src/combat")).toBe(true);
    expect(contains("project:breath-of-fire-iv-remake", "folder:src")).toBe(true);
    expect(contains("project:breath-of-fire-iv-remake", "file:README.md")).toBe(true);
  });

  it("creates import and reference edges", () => {
    const imports = (from: string) => graph.edges({ nodeId: `file:${from}`, direction: "out", kind: "imports" }).map((e) => e.target);
    expect(imports("src/merchants/shop.ts").sort()).toEqual(["file:src/inventory/inventory.ts", "file:src/inventory/items.ts"]);
    expect(imports("src/combat/damage.ts")).toEqual(["file:src/combat/elements.ts"]);
    expect(imports("tests/damage.test.ts").sort()).toEqual(["file:src/combat/damage.ts", "file:src/combat/elements.ts"]);
    const refs = graph.edges({ nodeId: "file:docs/design/merchants.md", direction: "out", kind: "references" }).map((e) => e.target);
    expect(refs).toContain("file:src/merchants/shop.ts");
    expect(refs).toContain("file:docs/glossary.md");
  });

  it('turns the combat folder into a "Combat System" concept', () => {
    const combat = index.concepts().find((c) => c.name === "Combat System");
    expect(combat?.id).toBe("concept:combat-system");
    expect(combat?.files).toEqual(expect.arrayContaining(["src/combat/battle_system.ts", "src/combat/damage.ts", "src/combat/elements.ts"]));
    expect(combat?.files).not.toContain("contracts/services-agreement.md");
    const names = index.concepts().map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["Inventory System", "Merchant System", "Party System", "Localization", "Contracts"]));
    expect(graph.getNode("concept:party-system")).toBeDefined();
  });

  it("reads files inside the root and rejects escapes", async () => {
    expect(await index.readFile("README.md")).toMatch(/Breath of Fire IV Remake/);
    expect(await index.readFile("./src/../src/party/party.ts").catch((e: Error) => e.message)).toMatch(/\.\./);
    await expect(index.readFile("../outside.txt")).rejects.toThrow();
    await expect(index.readFile("/etc/passwd")).rejects.toThrow(/relative/);
    await expect(index.readFile("src/../../x")).rejects.toThrow();
    const outside = await fsp.mkdtemp(path.join(os.tmpdir(), "neuralos-outside-"));
    await fsp.writeFile(path.join(outside, "secret.txt"), "top secret");
    await fsp.symlink(path.join(outside, "secret.txt"), path.join(root, "link.txt"));
    await expect(index.readFile("link.txt")).rejects.toThrow(/outside/);
    await fsp.rm(path.join(root, "link.txt"));
    await fsp.rm(outside, { recursive: true, force: true });
  });
});

describe("incremental updates", () => {
  let root: string;
  let graph: ReturnType<typeof createFakeGraph>;
  let index: SemanticIndexImpl;

  beforeAll(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), "neuralos-incr-"));
    await fsp.mkdir(path.join(root, "src/audio"), { recursive: true });
    await fsp.mkdir(path.join(root, "node_modules/lib"), { recursive: true });
    await fsp.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "sound-lab" }));
    await fsp.writeFile(path.join(root, "src/audio/mixer.ts"), 'import { gain } from "./gain";\nexport const mix = () => gain(2);\n');
    await fsp.writeFile(path.join(root, "src/audio/gain.ts"), "export const gain = (x: number) => x * 0.5;\n");
    await fsp.writeFile(path.join(root, "src/main.ts"), 'import { mix } from "./audio/mixer.js";\nimport { later } from "./later";\n');
    await fsp.writeFile(path.join(root, "notes.md"), "The mixer lives in mixer.ts.\n");
    await fsp.writeFile(path.join(root, "node_modules/lib/index.js"), "module.exports = 1;\n");
    await fsp.writeFile(path.join(root, "sprite.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x0d]));
    await fsp.writeFile(path.join(root, "huge.txt"), "x".repeat(1024 * 1024 + 10));
    graph = createFakeGraph();
    index = createSemanticIndex({ root, graph });
    await index.indexAll();
  });

  afterAll(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  const outEdges = (p: string, kind: EdgeKind) => graph.edges({ nodeId: `file:${p}`, direction: "out", kind }).map((e) => e.target).sort();

  it("skips binaries, oversized files and ignored folders", () => {
    expect(index.hasFile("sprite.png")).toBe(false);
    expect(index.hasFile("huge.txt")).toBe(false);
    expect(index.hasFile("node_modules/lib/index.js")).toBe(false);
    expect(graph.getNode("file:sprite.png")).toBeUndefined();
    expect(index.fileCount()).toBe(5);
    expect(graph.getNode("project:sound-lab")?.name).toBe("Sound Lab");
  });

  it("resolves extensionless and .js-suffixed imports to .ts files", () => {
    expect(outEdges("src/audio/mixer.ts", "imports")).toEqual(["file:src/audio/gain.ts"]);
    expect(outEdges("src/main.ts", "imports")).toEqual(["file:src/audio/mixer.ts"]);
    expect(outEdges("notes.md", "references")).toEqual(["file:src/audio/mixer.ts"]);
  });

  it("names a concept after a code folder outside the lexicon", () => {
    expect(index.concepts().find((c) => c.name === "Audio System")?.files).toEqual(["src/audio/gain.ts", "src/audio/mixer.ts"]);
  });

  it("indexFile re-derives a file's edges and links files that were waiting for it", async () => {
    await fsp.writeFile(path.join(root, "src/audio/mixer.ts"), "export const mix = () => 1; // no imports now\n");
    await index.indexFile("src/audio/mixer.ts");
    expect(outEdges("src/audio/mixer.ts", "imports")).toEqual([]);

    await fsp.writeFile(path.join(root, "src/later.ts"), "export const later = 1;\n");
    await index.indexFile("src/later.ts");
    expect(outEdges("src/main.ts", "imports")).toEqual(["file:src/audio/mixer.ts", "file:src/later.ts"]);
    expect(index.search("later")[0].path).toBe("src/later.ts");
  });

  it("removeFile drops the node, its edges and its search hits", () => {
    index.removeFile("src/audio/gain.ts");
    expect(index.hasFile("src/audio/gain.ts")).toBe(false);
    expect(graph.getNode("file:src/audio/gain.ts")).toBeUndefined();
    expect(graph.edgeList.some((e) => e.source === "file:src/audio/gain.ts" || e.target === "file:src/audio/gain.ts")).toBe(false);
    expect(index.search("gain").map((h) => h.path)).not.toContain("src/audio/gain.ts");
  });

  it("indexFile on a deleted file removes it", async () => {
    await fsp.rm(path.join(root, "src/later.ts"));
    await index.indexFile("src/later.ts");
    expect(index.hasFile("src/later.ts")).toBe(false);
    expect(graph.getNode("file:src/later.ts")).toBeUndefined();
  });

  it("rejects paths outside the root for indexFile and removeFile", async () => {
    await expect(index.indexFile("../x.ts")).rejects.toThrow();
    expect(() => index.removeFile("/etc/passwd")).toThrow();
  });
});

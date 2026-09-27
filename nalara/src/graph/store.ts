import type { Database } from "../kernel/db";
import { newId, nowIso } from "../kernel/ids";
import type { EdgeKind, EdgeQuery, EventBus, GraphEdge, GraphNode, KnowledgeGraph, NodeQuery, NodeType } from "../kernel/types";

type Row = Record<string, unknown>;
type Direction = "out" | "in" | "both";

const toNode = (r: Row): GraphNode => ({
  id: r.id as string,
  type: r.type as NodeType,
  name: r.name as string,
  props: JSON.parse(r.props as string),
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

const toEdge = (r: Row): GraphEdge => ({
  id: r.id as string,
  source: r.source as string,
  target: r.target as string,
  kind: r.kind as EdgeKind,
  props: JSON.parse(r.props as string),
  createdAt: r.created_at as string,
});

const asList = <T>(v: T | T[] | undefined): T[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);

/**
 * Knowledge graph on SQLite (graph_nodes / graph_edges). Events: node.created / node.updated `{ node }`,
 * node.removed `{ id, type, edges }` (number of cascaded edges), edge.created `{ edge }`.
 */
export function createKnowledgeGraph(opts: { db: Database; bus?: EventBus }): KnowledgeGraph {
  const { db, bus } = opts;
  db.exec(`CREATE TABLE IF NOT EXISTS graph_nodes (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    props TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS graph_nodes_type ON graph_nodes(type);
  CREATE TABLE IF NOT EXISTS graph_edges (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    kind TEXT NOT NULL,
    props TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    UNIQUE (source, target, kind)
  );
  CREATE INDEX IF NOT EXISTS graph_edges_source ON graph_edges(source);
  CREATE INDEX IF NOT EXISTS graph_edges_target ON graph_edges(target);`);

  const q = {
    getNode: db.prepare("SELECT * FROM graph_nodes WHERE id = ?"),
    insertNode: db.prepare("INSERT INTO graph_nodes (id, type, name, props, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"),
    updateNode: db.prepare("UPDATE graph_nodes SET type = ?, name = ?, props = ?, updated_at = ? WHERE id = ?"),
    deleteNode: db.prepare("DELETE FROM graph_nodes WHERE id = ?"),
    deleteIncident: db.prepare("DELETE FROM graph_edges WHERE source = ? OR target = ?"),
    getEdge: db.prepare("SELECT * FROM graph_edges WHERE source = ? AND target = ? AND kind = ?"),
    insertEdge: db.prepare("INSERT INTO graph_edges (id, source, target, kind, props, created_at) VALUES (?, ?, ?, ?, ?, ?)"),
    out: db.prepare("SELECT * FROM graph_edges WHERE source = ?"),
    in: db.prepare("SELECT * FROM graph_edges WHERE target = ?"),
    both: db.prepare("SELECT * FROM graph_edges WHERE source = ? OR target = ?"),
    countNodes: db.prepare("SELECT COUNT(*) AS n FROM graph_nodes"),
    countEdges: db.prepare("SELECT COUNT(*) AS n FROM graph_edges"),
    byType: db.prepare("SELECT type, COUNT(*) AS n FROM graph_nodes GROUP BY type"),
  };

  const emit = (type: "node.created" | "node.updated" | "node.removed" | "edge.created", data: unknown) =>
    bus?.publish(type, data, { source: "graph" });

  function getNode(id: string): GraphNode | undefined {
    const row = q.getNode.get(id) as Row | undefined;
    return row ? toNode(row) : undefined;
  }

  function incident(id: string, direction: Direction, kinds?: EdgeKind[]): GraphEdge[] {
    const rows = (direction === "both" ? q.both.all(id, id) : q[direction].all(id)) as Row[];
    const edges = rows.map(toEdge);
    return kinds ? edges.filter((e) => kinds.includes(e.kind)) : edges;
  }

  const other = (e: GraphEdge, id: string) => (e.source === id ? e.target : e.source);

  /** BFS distances from start, up to maxDepth hops. */
  function bfs(start: string, maxDepth: number, direction: Direction, kinds?: EdgeKind[], stopAt?: string) {
    const parent = new Map<string, string | null>([[start, null]]);
    const order: string[] = [];
    let frontier = [start];
    for (let d = 0; d < maxDepth && frontier.length > 0; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const e of incident(id, direction, kinds)) {
          // For "both" a self-loop or either end works; for out/in follow the direction.
          const n = direction === "out" ? e.target : direction === "in" ? e.source : other(e, id);
          if (parent.has(n)) continue;
          parent.set(n, id);
          order.push(n);
          next.push(n);
          if (n === stopAt) return { parent, order };
        }
      }
      frontier = next;
    }
    return { parent, order };
  }

  const graph: KnowledgeGraph = {
    upsertNode(input) {
      const now = nowIso();
      const existing = input.id ? getNode(input.id) : undefined;
      if (!existing) {
        const node: GraphNode = { id: input.id ?? newId(input.type), type: input.type, name: input.name, props: { ...input.props }, createdAt: now, updatedAt: now };
        q.insertNode.run(node.id, node.type, node.name, JSON.stringify(node.props), now, now);
        emit("node.created", { node });
        return node;
      }
      const props = { ...existing.props, ...input.props };
      const changed = existing.type !== input.type || existing.name !== input.name || JSON.stringify(props) !== JSON.stringify(existing.props);
      if (!changed) return existing;
      const node: GraphNode = { ...existing, type: input.type, name: input.name, props, updatedAt: now };
      q.updateNode.run(node.type, node.name, JSON.stringify(props), now, node.id);
      emit("node.updated", { node });
      return node;
    },

    getNode,

    findNodes(query) {
      const where: string[] = [];
      const args: (string | number)[] = [];
      const types = asList(query.type);
      if (types?.length) {
        where.push(`type IN (${types.map(() => "?").join(",")})`);
        args.push(...types);
      }
      if (query.name !== undefined) {
        where.push("name = ?");
        args.push(query.name);
      }
      if (query.nameContains) {
        where.push("instr(lower(name), lower(?)) > 0");
        args.push(query.nameContains);
      }
      const sql = `SELECT * FROM graph_nodes ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id`;
      let nodes = (db.prepare(sql).all(...args) as Row[]).map(toNode);
      if (query.prop) {
        const { key, value } = query.prop;
        nodes = nodes.filter((n) => Object.is(n.props[key], value));
      }
      return query.limit !== undefined ? nodes.slice(0, query.limit) : nodes;
    },

    removeNode(id) {
      const node = getNode(id);
      if (!node) return false;
      const edges = Number(q.deleteIncident.run(id, id).changes);
      q.deleteNode.run(id);
      emit("node.removed", { id, type: node.type, edges });
      return true;
    },

    link(source, target, kind, props = {}) {
      if (!getNode(source)) throw new Error(`link: source node not found: ${source}`);
      if (!getNode(target)) throw new Error(`link: target node not found: ${target}`);
      const existing = q.getEdge.get(source, target, kind) as Row | undefined;
      if (existing) return toEdge(existing);
      const edge: GraphEdge = { id: newId("edge"), source, target, kind, props: { ...props }, createdAt: nowIso() };
      q.insertEdge.run(edge.id, source, target, kind, JSON.stringify(edge.props), edge.createdAt);
      emit("edge.created", { edge });
      return edge;
    },

    unlink(source, target, kind) {
      const res = kind
        ? db.prepare("DELETE FROM graph_edges WHERE source = ? AND target = ? AND kind = ?").run(source, target, kind)
        : db.prepare("DELETE FROM graph_edges WHERE source = ? AND target = ?").run(source, target);
      return Number(res.changes);
    },

    edges(query: EdgeQuery) {
      const kinds = asList(query.kind);
      if (query.nodeId) return incident(query.nodeId, query.direction ?? "both", kinds);
      const edges = (db.prepare("SELECT * FROM graph_edges ORDER BY created_at, id").all() as Row[]).map(toEdge);
      return kinds ? edges.filter((e) => kinds.includes(e.kind)) : edges;
    },

    neighbors(id, o = {}) {
      const { order } = bfs(id, o.depth ?? 1, o.direction ?? "both", asList(o.kind));
      return order.map(getNode).filter((n): n is GraphNode => n !== undefined);
    },

    shortestPath(from, to, maxDepth = 6) {
      if (!getNode(from) || !getNode(to)) return null;
      if (from === to) return [from];
      const { parent } = bfs(from, maxDepth, "both", undefined, to);
      if (!parent.has(to)) return null;
      const path: string[] = [];
      for (let cur: string | null | undefined = to; cur; cur = parent.get(cur)) path.unshift(cur);
      return path;
    },

    subgraph(o = {}) {
      const limit = o.limit ?? 500;
      const typeOk = (n: GraphNode) => !o.types?.length || o.types.includes(n.type);
      let nodes: GraphNode[];
      if (o.rootId) {
        const root = getNode(o.rootId);
        if (!root) return { nodes: [], edges: [] };
        const { order } = bfs(o.rootId, o.depth ?? 2, "both");
        nodes = [root, ...order.map(getNode).filter((n): n is GraphNode => n !== undefined)].filter((n) => n.id === root.id || typeOk(n));
      } else {
        nodes = graph.findNodes({ type: o.types });
      }
      nodes = nodes.slice(0, limit);
      const ids = new Set(nodes.map((n) => n.id));
      const seen = new Set<string>();
      const edges: GraphEdge[] = [];
      for (const n of nodes) {
        for (const e of incident(n.id, "out")) {
          if (ids.has(e.target) && !seen.has(e.id)) {
            seen.add(e.id);
            edges.push(e);
          }
        }
      }
      return { nodes, edges };
    },

    stats() {
      const byType: Record<string, number> = {};
      for (const r of q.byType.all() as Row[]) byType[r.type as string] = Number(r.n);
      return {
        nodes: Number((q.countNodes.get() as Row).n),
        edges: Number((q.countEdges.get() as Row).n),
        byType,
      };
    },
  };
  return graph;
}

/**
 * Deterministic canvas layout. The same graph always yields the same positions, so the canvas stays stable across
 * refreshes and live updates only move what changed.
 *
 *   concepts | project / folders / files (tree) | workspaces with their agents | MCP servers | other nodes
 *
 * Columns right of the tree start where the tree ends (a deep tree or a folder with many files pushes them right),
 * and the MCP column follows the rightmost workspace or pool agent instead of a fixed far-away x.
 */
import type { GraphEdge, GraphNode, GraphSlice, NodeType } from "./types";

export type ShapeKind = "project" | "file" | "folder" | "agent" | "mcp" | "workflow" | "workspace" | "concept" | "output" | "generic";

export function shapeOf(type: NodeType): ShapeKind {
  switch (type) {
    case "project":
    case "file":
    case "folder":
    case "agent":
    case "mcp":
    case "workflow":
    case "workspace":
    case "concept":
    case "output":
      return type;
    default:
      return "generic";
  }
}

/**
 * Offset from a node's top-left corner to the centre of its dot (where edges attach). In the Field every node is a
 * 160 px wide button with its dot centred 14 px from the top. Matches `.cn` / `.cn-dot` in styles.css.
 */
const DOT = { x: 80, y: 14 };
export const ANCHOR: Record<ShapeKind, { x: number; y: number }> = {
  project: DOT,
  file: DOT,
  folder: DOT,
  agent: DOT,
  mcp: DOT,
  workflow: DOT,
  workspace: DOT,
  concept: DOT,
  output: DOT,
  generic: DOT,
};

export interface Point {
  x: number;
  y: number;
}

const TREE_X = 40;
const INDENT = 44;
const FILE_COLS = 3;
const COL_W = 172;
const ROW_H = 116;
const CONCEPT_X = -210;
/** Minimum x of the first workspace column; moves right when the tree is wider. */
const WS_X = 1180;
/** Half the width of a node box (every shape is at most 160 wide). */
const HALF_W = 80;
/** Clear space between the tree and the workspace / agent-pool columns. */
const COLUMN_GAP = 60;
/** Workspaces fill a two-column grid, oldest first, so a new one never moves the others. */
const WS_COLS = 2;
const WS_COL_GAP = 840;
const WS_ROW_GAP = 820;
const MCP_GAP = 94;
/** Distance from the rightmost workspace / pool node to the MCP column. */
const MCP_OFFSET = 260;
const POOL_COLS = 6;

const byName = (a: GraphNode, b: GraphNode) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

function created(n: GraphNode): string {
  const p = n.props?.createdAt;
  return typeof p === "string" ? p : n.createdAt;
}

const GROUP_ORDER: Record<string, number> = { system: 0, engineering: 1, creative: 2, business: 3 };

export function layoutGraph(graph: GraphSlice): Map<string, Point> {
  const pos = new Map<string, Point>();
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const edgesOf = (kind: GraphEdge["kind"]) => graph.edges.filter((e) => e.kind === kind && nodes.has(e.source) && nodes.has(e.target));

  // ---- tree: project -> folder -> file ------------------------------------------------------------
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const e of edgesOf("contains").sort((a, b) => a.id.localeCompare(b.id))) {
    const s = nodes.get(e.source)!;
    const t = nodes.get(e.target)!;
    if (!(s.type === "project" || s.type === "folder")) continue;
    if (!(t.type === "folder" || t.type === "file")) continue;
    if (hasParent.has(t.id)) continue; // first parent wins
    hasParent.add(t.id);
    const list = children.get(s.id) ?? [];
    list.push(t.id);
    children.set(s.id, list);
  }
  const kids = (id: string, type: NodeType) =>
    (children.get(id) ?? [])
      .map((c) => nodes.get(c)!)
      .filter((n) => n.type === type)
      .sort(byName);

  let y = 0;
  const visited = new Set<string>();

  const placeFiles = (files: GraphNode[], xStart: number) => {
    files.forEach((f, i) => {
      const col = i % FILE_COLS;
      const row = Math.floor(i / FILE_COLS);
      pos.set(f.id, { x: xStart + col * COL_W, y: y + 32 + row * ROW_H });
      visited.add(f.id);
    });
    return Math.max(1, Math.ceil(files.length / FILE_COLS)) * ROW_H;
  };

  const placeFolder = (folder: GraphNode, depth: number) => {
    if (visited.has(folder.id)) return;
    visited.add(folder.id);
    const fx = TREE_X + 80 + depth * INDENT;
    pos.set(folder.id, { x: fx, y: y + 32 });
    const files = kids(folder.id, "file");
    const h = files.length ? placeFiles(files, fx + COL_W + 10) : ROW_H;
    y += h;
    for (const sub of kids(folder.id, "folder")) placeFolder(sub, depth + 1);
  };

  const projects = graph.nodes.filter((n) => n.type === "project").sort(byName);
  for (const p of projects) {
    pos.set(p.id, { x: TREE_X + 96, y: y + 56 });
    visited.add(p.id);
    y += 160;
    const files = kids(p.id, "file");
    if (files.length) y += placeFiles(files, TREE_X + 80 + COL_W + 10);
    for (const f of kids(p.id, "folder")) placeFolder(f, 0);
    y += 40;
  }
  for (const f of graph.nodes.filter((n) => n.type === "folder" && !hasParent.has(n.id)).sort(byName)) placeFolder(f, 0);

  // Files that belong only to a workspace are placed next to it later; truly loose files go under the tree.
  const memberOf = new Map<string, string>();
  for (const e of edgesOf("member_of")) {
    const file = nodes.get(e.source)!.type === "workspace" ? e.target : e.source;
    const ws = file === e.source ? e.target : e.source;
    if (!memberOf.has(file)) memberOf.set(file, ws);
  }
  const looseFiles = graph.nodes.filter((n) => n.type === "file" && !visited.has(n.id) && !memberOf.has(n.id)).sort(byName);
  if (looseFiles.length) y += placeFiles(looseFiles, TREE_X + 80 + COL_W + 10);

  // ---- workflows under the tree --------------------------------------------------------------------
  y += 30;
  for (const w of graph.nodes.filter((n) => n.type === "workflow").sort(byName)) {
    pos.set(w.id, { x: TREE_X + 96, y: y + 32 });
    y += ROW_H;
  }

  // ---- concepts beside their files -----------------------------------------------------------------
  const conceptLinks = new Map<string, number[]>();
  for (const e of graph.edges) {
    if (e.kind !== "about" && e.kind !== "relates_to") continue;
    const s = nodes.get(e.source);
    const t = nodes.get(e.target);
    if (!s || !t) continue;
    const [concept, other] = s.type === "concept" ? [s, t] : t.type === "concept" ? [t, s] : [null, null];
    if (!concept || !other) continue;
    const p = pos.get(other.id);
    if (!p) continue;
    const list = conceptLinks.get(concept.id) ?? [];
    list.push(p.y);
    conceptLinks.set(concept.id, list);
  }
  const concepts = graph.nodes
    .filter((n) => n.type === "concept")
    .map((n) => {
      const ys = conceptLinks.get(n.id);
      return { n, want: ys && ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : Number.POSITIVE_INFINITY };
    })
    .sort((a, b) => a.want - b.want || byName(a.n, b.n));
  let cy = -Infinity;
  let tail = y;
  for (const { n, want } of concepts) {
    const target = Number.isFinite(want) ? want : tail;
    cy = Math.max(target, cy + 84);
    if (!Number.isFinite(want)) tail = cy + 84;
    pos.set(n.id, { x: CONCEPT_X, y: cy });
  }

  // Everything placed so far is the tree column (concepts sit left of it). Later columns must clear it.
  let treeRight = -Infinity;
  for (const [id, p] of pos) if (nodes.get(id)?.type !== "concept") treeRight = Math.max(treeRight, p.x + HALF_W);
  const poolHalf = ((POOL_COLS - 1) * COL_W) / 2 + HALF_W;
  // The first workspace column: its ring (rx <= 300), the files it owns (rx + 200 to its left) and the pool centred
  // under it all stay right of the tree.
  const baseX = Number.isFinite(treeRight) ? Math.max(WS_X, treeRight + COLUMN_GAP + Math.max(300 + 200 + HALF_W, poolHalf)) : WS_X;

  // ---- workspaces with their agents ---------------------------------------------------------------
  const workspaces = graph.nodes
    .filter((n) => n.type === "workspace")
    .sort((a, b) => created(a).localeCompare(created(b)) || a.id.localeCompare(b.id));
  const agentHome = new Map<string, string>();
  const wsAgents = new Map<string, GraphNode[]>();
  const assigned = edgesOf("assigned_to").sort((a, b) => a.id.localeCompare(b.id));
  // An agent node is drawn once, in the ring of the newest live workspace that uses it (archived ones claim last),
  // so a new intent gathers its swarm around itself. Positions change only when the graph changes.
  const claimOrder = [...workspaces].reverse().sort((a, b) => Number(a.props?.status === "archived") - Number(b.props?.status === "archived"));
  for (const ws of claimOrder) {
    const list: GraphNode[] = [];
    for (const e of assigned) {
      const agentId = e.target === ws.id ? e.source : e.source === ws.id ? e.target : null;
      if (!agentId) continue;
      const a = nodes.get(agentId);
      if (!a || a.type !== "agent" || agentHome.has(a.id)) continue;
      agentHome.set(a.id, ws.id);
      list.push(a);
    }
    wsAgents.set(ws.id, list.sort(byName));
  }

  const produced = edgesOf("produced");
  let wsY = 300;
  workspaces.forEach((ws, i) => {
    wsY = 300 + Math.floor(i / WS_COLS) * WS_ROW_GAP;
    const wsX = baseX + (i % WS_COLS) * WS_COL_GAP;
    pos.set(ws.id, { x: wsX, y: wsY });
    const agents = wsAgents.get(ws.id) ?? [];
    const n = agents.length;
    const rx = n > 6 ? 300 : 270;
    const ry = n > 6 ? 250 : 215;
    agents.forEach((a, k) => {
      const ang = ((-90 + ((k + 0.5) * 360) / n) * Math.PI) / 180;
      pos.set(a.id, { x: Math.round(wsX + rx * Math.cos(ang)), y: Math.round(wsY + ry * Math.sin(ang)) });
    });
    // Outputs the workspace (or its agents) produced sit under the ring.
    const outs = new Set<string>();
    for (const e of produced) {
      const t = nodes.get(e.target)!;
      if (t.type !== "output" || pos.has(t.id)) continue;
      if (e.source === ws.id || agentHome.get(e.source) === ws.id) outs.add(t.id);
    }
    [...outs].sort().forEach((id, k, arr) => {
      pos.set(id, { x: wsX + (k - (arr.length - 1) / 2) * COL_W, y: wsY + ry + 150 });
    });
    // Files that exist only in this workspace (generated glossary, source file...) sit to its left.
    const own = graph.nodes.filter((f) => f.type === "file" && !pos.has(f.id) && memberOf.get(f.id) === ws.id).sort(byName);
    own.forEach((f, k) => {
      const side = i % WS_COLS === 0 ? -1 : 1; // outside the grid, never between two columns
      pos.set(f.id, { x: wsX + side * (rx + 200), y: wsY - ((own.length - 1) * ROW_H) / 2 + k * ROW_H });
    });
  });

  // ---- agent pool: agents not in any workspace -----------------------------------------------------
  const pool = graph.nodes
    .filter((n) => n.type === "agent" && !pos.has(n.id))
    .sort((a, b) => {
      const ga = GROUP_ORDER[String(a.props?.group ?? "")] ?? 9;
      const gb = GROUP_ORDER[String(b.props?.group ?? "")] ?? 9;
      return ga - gb || byName(a, b);
    });
  const poolY = workspaces.length ? wsY + 520 : 300;
  const poolCenter = baseX + ((Math.min(WS_COLS, Math.max(1, workspaces.length)) - 1) * WS_COL_GAP) / 2;
  pool.forEach((a, i) => {
    pos.set(a.id, {
      x: poolCenter - ((POOL_COLS - 1) * COL_W) / 2 + (i % POOL_COLS) * COL_W,
      y: poolY + Math.floor(i / POOL_COLS) * ROW_H,
    });
  });

  // ---- MCP column: right of the workspaces and the pool --------------------------------------------
  let right = baseX;
  for (const p of pos.values()) right = Math.max(right, p.x);
  const mcpX = right + MCP_OFFSET;
  graph.nodes
    .filter((n) => n.type === "mcp")
    .sort(byName)
    .forEach((m, i) => pos.set(m.id, { x: mcpX, y: 60 + i * MCP_GAP }));

  // ---- everything else -------------------------------------------------------------------------------
  graph.nodes
    .filter((n) => !pos.has(n.id))
    .sort((a, b) => a.type.localeCompare(b.type) || byName(a, b))
    .forEach((n, i) => pos.set(n.id, { x: mcpX + 200, y: 60 + i * ROW_H }));

  return pos;
}

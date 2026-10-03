import { createContext, memo, useContext, useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import type { AgentState, GraphEdge, GraphNode, GraphSlice } from "../types";
import { ANCHOR, layoutGraph, shapeOf, type ShapeKind } from "../layout";
import { IconAlert, IconRefresh } from "./Icons";

export interface CanvasNodeData extends Record<string, unknown> {
  node: GraphNode;
  shape: ShapeKind;
  sub: string;
  ext?: string;
  state?: AgentState;
  /** Part of the selected workspace (or in use by it). */
  active: boolean;
  /** Focused from search / file tree. */
  focused: boolean;
  dim: boolean;
}
type CanvasNode = Node<CanvasNodeData, "canvas">;

type Activate = (node: GraphNode, el: HTMLElement) => void;
const ActivateContext = createContext<Activate>(() => {});

const BUSY: AgentState[] = ["active", "collaborating"];

function extOf(node: GraphNode): string {
  const path = typeof node.props?.path === "string" ? (node.props.path as string) : node.name;
  const m = /\.([a-z0-9]{1,5})$/i.exec(path);
  return m ? m[1].toLowerCase() : node.type === "folder" ? "dir" : "";
}

const TYPE_WORD: Record<string, string> = {
  mcp: "MCP server",
  workflow: "workflow",
  workspace: "workspace",
  project: "project",
  agent: "agent",
  file: "file",
  folder: "folder",
  concept: "concept",
  output: "output",
};

/** A graph node in the Field: a glowing dot with a tiny letter-spaced label. */
const CanvasNodeView = memo(function CanvasNodeView({ id, data }: NodeProps<CanvasNode>) {
  const activate = useContext(ActivateContext);
  const { node, shape, sub, state, active, focused, dim } = data;
  const anchor = ANCHOR[shape];
  const busy = state ? BUSY.includes(state) : false;
  const aria = `${node.name}, ${TYPE_WORD[node.type] ?? node.type}${sub ? `, ${sub}` : ""}. Open actions`;

  const cls = [
    "cn",
    `cn-${shape}`,
    active ? "is-active" : "",
    focused ? "is-focused" : "",
    busy ? "is-busy" : "",
    dim ? "is-dim" : "",
    state ? `st-${state}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const handleStyle = { left: anchor.x, top: anchor.y };
  return (
    <div className="cn-wrap" data-node-id={id} data-node-type={node.type}>
      <Handle type="target" id="t" position={Position.Top} isConnectable={false} className="cn-handle" style={handleStyle} />
      <Handle type="source" id="s" position={Position.Top} isConnectable={false} className="cn-handle" style={handleStyle} />
      <button type="button" className={cls} aria-label={aria} onClick={(e) => activate(node, e.currentTarget)}>
        <span className="cn-dot" aria-hidden="true" />
        <span className="cn-label" title={node.name}>
          {node.name}
        </span>
        {sub ? <span className="cn-sub">{sub}</span> : null}
      </button>
    </div>
  );
});

const nodeTypes = { canvas: CanvasNodeView };

interface EdgeLook {
  stroke: string;
  width: number;
  dash?: string;
  opacity: number;
}

const CYAN = "#5fcfe0";
const VIOLET = "#9d8bff";
const EDGE_LOOK: Record<GraphEdge["kind"], EdgeLook> = {
  uses_tool: { stroke: "#6fb6ff", width: 1, dash: "4 4", opacity: 0.45 },
  imports: { stroke: CYAN, width: 1, opacity: 0.28 },
  references: { stroke: CYAN, width: 0.8, dash: "2 4", opacity: 0.25 },
  member_of: { stroke: CYAN, width: 1, dash: "4 4", opacity: 0.3 },
  assigned_to: { stroke: VIOLET, width: 1.1, opacity: 0.4 },
  produced: { stroke: "#f0c27a", width: 1, dash: "3 3", opacity: 0.4 },
  contains: { stroke: CYAN, width: 0.9, opacity: 0.18 },
  about: { stroke: CYAN, width: 0.8, dash: "1 4", opacity: 0.2 },
  relates_to: { stroke: CYAN, width: 0.8, dash: "3 4", opacity: 0.2 },
  depends_on: { stroke: CYAN, width: 0.9, dash: "6 3", opacity: 0.28 },
  triggered: { stroke: "#f0c27a", width: 0.9, dash: "2 3", opacity: 0.35 },
};

/** Fit padding that keeps nodes clear of the HUD (top) and the edges. */
const PAD = { top: 110, bottom: 60, left: 40, right: 40 } as const;
const FIT_PADDING = { top: `${PAD.top}px`, bottom: `${PAD.bottom}px`, left: `${PAD.left}px`, right: `${PAD.right}px` } as const;
/** Below this zoom node labels are unreadable; the first view of a large graph starts here instead of fitting all. */
const READABLE_ZOOM = 0.72;
const FIT_ALL = { padding: FIT_PADDING, duration: 400 };

const WS_KINDS = new Set<GraphEdge["kind"]>(["uses_tool", "assigned_to", "member_of", "produced"]);

export interface CanvasProps {
  graph: GraphSlice | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** Keyed by graph node id (`agent:<agentId>`). */
  agentStates: Map<string, AgentState>;
  selectedWorkspaceNodeId: string | null;
  focus: { id: string; n: number } | null;
  onNodeActivate: (node: GraphNode, at: { x: number; y: number }) => void;
  onPaneActivate: (at: { x: number; y: number }) => void;
}

function subtitle(n: GraphNode, agentState: AgentState | undefined, active: boolean): string {
  switch (n.type) {
    case "agent":
      return agentState ?? "dormant";
    case "workspace":
      return String(n.props?.workspaceId ?? n.props?.intent ?? n.id.replace(/^workspace:/, ""));
    case "file":
      return active ? "in workspace" : String(n.props?.kind ?? "file");
    case "mcp":
      return active ? "in use" : String(n.props?.status ?? "");
    case "folder":
      return "folder";
    case "workflow":
      return "workflow";
    case "output":
      return "output";
    default:
      return n.type;
  }
}

function CanvasInner(props: CanvasProps) {
  const { graph, agentStates, selectedWorkspaceNodeId, focus, onNodeActivate, onPaneActivate } = props;
  const rf = useReactFlow<CanvasNode, Edge>();
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const initialized = useNodesInitialized();
  const paneWidth = useStore((s) => s.width);
  const paneHeight = useStore((s) => s.height);
  const didFit = useRef<string | null>(null);

  const positions = useMemo(() => (graph ? layoutGraph(graph) : new Map()), [graph]);

  // Nodes that belong to the selected workspace: its agents, member files, tools and outputs.
  const cluster = useMemo(() => {
    const set = new Set<string>();
    if (!graph || !selectedWorkspaceNodeId) return set;
    set.add(selectedWorkspaceNodeId);
    for (const e of graph.edges) {
      if (e.source === selectedWorkspaceNodeId) set.add(e.target);
      if (e.target === selectedWorkspaceNodeId) set.add(e.source);
    }
    return set;
  }, [graph, selectedWorkspaceNodeId]);

  const focusId = focus?.id ?? null;

  useEffect(() => {
    if (!graph) return;
    const next: CanvasNode[] = graph.nodes.map((n) => {
      const shape = shapeOf(n.type);
      const c = positions.get(n.id) ?? { x: 0, y: 0 };
      const a = ANCHOR[shape];
      const state = n.type === "agent" ? agentStates.get(n.id) : undefined;
      const active = cluster.has(n.id);
      const archived = n.type === "workspace" && n.props?.status === "archived";
      return {
        id: n.id,
        type: "canvas",
        position: { x: c.x - a.x, y: c.y - a.y },
        data: {
          node: n,
          shape,
          sub: subtitle(n, state, active && n.id !== selectedWorkspaceNodeId),
          ext: shape === "file" || shape === "output" ? extOf(n) : undefined,
          state,
          active,
          focused: n.id === focusId,
          dim: archived || state === "archived",
        },
        draggable: false,
        selectable: false,
        connectable: false,
        zIndex: n.type === "workspace" ? 2 : 1,
      };
    });
    setNodes((prev) => {
      const measured = new Map(prev.map((p) => [p.id, p.measured]));
      return next.map((n) => (measured.get(n.id) ? { ...n, measured: measured.get(n.id) } : n));
    });
    const ids = new Set(graph.nodes.map((n) => n.id));
    setEdges(
      graph.edges
        .filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
        .map((e) => {
          const look = EDGE_LOOK[e.kind] ?? EDGE_LOOK.relates_to;
          const hot = selectedWorkspaceNodeId !== null && (e.source === selectedWorkspaceNodeId || e.target === selectedWorkspaceNodeId);
          return {
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: "s",
            targetHandle: "t",
            type: "straight",
            selectable: false,
            focusable: false,
            className: `edge-${e.kind}`,
            style: {
              stroke: look.stroke,
              strokeWidth: look.width,
              strokeDasharray: look.dash,
              // With a workspace selected, other workspaces' wiring recedes.
              opacity: hot ? Math.min(1, look.opacity + 0.35) : selectedWorkspaceNodeId && WS_KINDS.has(e.kind) ? look.opacity * 0.35 : look.opacity,
            },
          } satisfies Edge;
        }),
    );
  }, [graph, positions, agentStates, cluster, selectedWorkspaceNodeId, focusId, setNodes, setEdges]);

  // First fit: the selected workspace and its members, else everything. Refit when the selection changes.
  useEffect(() => {
    if (!initialized || !graph || nodes.length === 0) return;
    const key = selectedWorkspaceNodeId ?? "*";
    if (didFit.current === key) return;
    if (selectedWorkspaceNodeId && !graph.nodes.some((n) => n.id === selectedWorkspaceNodeId)) return; // wait for the refetch
    const first = didFit.current === null;
    didFit.current = key;
    // Fit the swarm (hub, agents, outputs); files and tools stay reachable along their edges.
    const members = selectedWorkspaceNodeId
      ? [
          selectedWorkspaceNodeId,
          ...graph.edges
            .filter((e) => (e.kind === "assigned_to" || e.kind === "produced") && (e.source === selectedWorkspaceNodeId || e.target === selectedWorkspaceNodeId))
            .map((e) => (e.source === selectedWorkspaceNodeId ? e.target : e.source)),
        ].filter((id) => {
          // Agents shared with another workspace sit in that workspace's ring; leave them out of the fit.
          const hub = positions.get(selectedWorkspaceNodeId);
          const p = positions.get(id);
          return !!hub && !!p && Math.abs(p.x - hub.x) < 520 && Math.abs(p.y - hub.y) < 520;
        })
      : [];
    if (selectedWorkspaceNodeId && members.length <= 1) {
      // Every agent of this workspace lives in another workspace's ring: centre on the hub instead.
      const hub = positions.get(selectedWorkspaceNodeId);
      if (hub) void rf.setCenter(hub.x, hub.y + 60, { zoom: 0.85, duration: first ? 0 : 450 });
      return;
    }
    const target = members.length > 1 ? members.map((id) => ({ id })) : undefined;
    if (!target) {
      // The whole graph. When it only fits below a readable zoom (a real project: dozens of files and the full agent
      // catalog), start readable at its top-left, where the project and its tree begin; the minimap and the
      // fit-view control still show everything.
      const b = rf.getNodesBounds(rf.getNodes());
      const w = paneWidth - PAD.left - PAD.right;
      const h = paneHeight - PAD.top - PAD.bottom;
      if (w > 0 && h > 0 && b.width > 0 && b.height > 0 && Math.min(w / b.width, h / b.height) < READABLE_ZOOM) {
        const zoom = READABLE_ZOOM;
        void rf.setViewport({ x: PAD.left - b.x * zoom, y: PAD.top - b.y * zoom, zoom }, { duration: first ? 0 : 450 });
        return;
      }
    }
    // Leave room for the legend on top and the intent bar at the bottom.
    void rf.fitView({ nodes: target, padding: FIT_PADDING, maxZoom: 1, minZoom: 0.2, duration: first ? 0 : 450 });
  }, [initialized, graph, positions, nodes.length, selectedWorkspaceNodeId, rf, paneWidth, paneHeight]);

  // Focus a node (Projects panel, search): also when the Field opens with a focus already set.
  const focusedFor = useRef<number | null>(null);
  useEffect(() => {
    if (!focus || !initialized || focusedFor.current === focus.n) return;
    const n = rf.getNode(focus.id);
    if (!n) return;
    focusedFor.current = focus.n;
    const a = ANCHOR[n.data.shape];
    void rf.setCenter(n.position.x + a.x, n.position.y + a.y, { zoom: 1.1, duration: 450 });
  }, [focus, rf, initialized, nodes.length]);

  const activate = useMemo<Activate>(
    () => (node, el) => {
      const r = el.getBoundingClientRect();
      const a = ANCHOR[shapeOf(node.type)];
      // Centre the menu on the shape, not the label (the button is 2 * anchor.x wide at zoom 1).
      const zoom = r.width / (a.x * 2) || 1;
      onNodeActivate(node, { x: r.left + a.x * zoom, y: r.top + a.y * zoom });
    },
    [onNodeActivate],
  );

  return (
    <ActivateContext.Provider value={activate}>
      <ReactFlow<CanvasNode, Edge>
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        zoomOnDoubleClick={false}
        fitViewOptions={FIT_ALL}
        minZoom={0.15}
        maxZoom={2}
        onPaneClick={(e) => onPaneActivate({ x: e.clientX, y: e.clientY })}
        ariaLabelConfig={{ "controls.ariaLabel": "Canvas zoom controls", "minimap.ariaLabel": "Canvas overview" }}
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="rgba(95, 207, 224, 0.12)" bgColor="transparent" />
        <Controls position="bottom-left" showInteractive={false} fitViewOptions={FIT_ALL} />
      </ReactFlow>
      {props.loading && !graph ? (
        <div className="canvas-state" role="status">
          Loading the knowledge graph...
        </div>
      ) : null}
      {props.error && !graph ? (
        <div className="canvas-state canvas-state-error" role="alert">
          <IconAlert size={18} />
          <span>Could not load the graph: {props.error}</span>
          <button type="button" className="btn btn-sm" onClick={props.onRetry}>
            <IconRefresh size={14} /> Retry
          </button>
        </div>
      ) : null}
      {graph && graph.nodes.length === 0 ? (
        <div className="canvas-state" role="status">
          The field is empty. State an intent to generate the first workspace.
        </div>
      ) : null}
    </ActivateContext.Provider>
  );
}

export function Canvas(props: CanvasProps) {
  return (
    <div className="canvas field" aria-label="Knowledge field">
      <ReactFlowProvider>
        <CanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}

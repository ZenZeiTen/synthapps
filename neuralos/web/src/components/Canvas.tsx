import { createContext, memo, useContext, useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import type { AgentState, GraphEdge, GraphNode, GraphSlice } from "../types";
import { ANCHOR, layoutGraph, shapeOf, type ShapeKind } from "../layout";
import { IconAlert, IconMenu, IconRefresh } from "./Icons";

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

function FileGlyph({ stroke, fill, ext, output }: { stroke: string; fill: string; ext: string; output?: boolean }) {
  return (
    <svg width="46" height="56" viewBox="0 0 46 56" aria-hidden="true" focusable="false">
      <path d="M1.5 1.5H31L44.5 15V54.5H1.5Z" fill={fill} stroke={stroke} strokeWidth="1.5" strokeDasharray={output ? "4 3" : undefined} />
      <path d="M31 1.5V15H44.5" fill="none" stroke={stroke} strokeWidth="1.5" />
      <text x="23" y="45" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="10.5" fill="#A9ADB5">
        {ext}
      </text>
    </svg>
  );
}

function FolderGlyph({ stroke }: { stroke: string }) {
  return (
    <svg width="54" height="44" viewBox="0 0 54 44" aria-hidden="true" focusable="false">
      <path d="M1.5 5.5a3 3 0 013-3h14l5 5h26a3 3 0 013 3v29a3 3 0 01-3 3h-45a3 3 0 01-3-3z" fill="#1C2027" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
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

const CanvasNodeView = memo(function CanvasNodeView({ id, data }: NodeProps<CanvasNode>) {
  const activate = useContext(ActivateContext);
  const { node, shape, sub, ext, state, active, focused, dim } = data;
  const anchor = ANCHOR[shape];
  const busy = state ? BUSY.includes(state) : false;
  const aria = `${node.name}, ${TYPE_WORD[node.type] ?? node.type}${sub ? `, ${sub}` : ""}. Open actions`;

  let body;
  switch (shape) {
    case "project":
      body = (
        <>
          <span className="cn-kind">Project</span>
          <span className="cn-project-name">{node.name}</span>
        </>
      );
      break;
    case "workspace":
      body = (
        <>
          <span className="cn-kind cn-amber">Workspace</span>
          <span className="cn-ws-label">{node.name}</span>
          <span className="cn-mono">{sub}</span>
        </>
      );
      break;
    case "concept":
      body = <span className="cn-concept-name">{node.name}</span>;
      break;
    default: {
      let glyph;
      if (shape === "file" || shape === "output") {
        glyph = (
          <FileGlyph
            stroke={focused ? "#FFFFFF" : shape === "output" ? "#E8A547" : active ? "#C9C4BA" : "#6A717C"}
            fill="#1C2027"
            ext={ext ?? ""}
            output={shape === "output"}
          />
        );
      } else if (shape === "folder") {
        glyph = <FolderGlyph stroke={focused ? "#FFFFFF" : "#6A717C"} />;
      } else if (shape === "agent") {
        glyph = <span className="cn-diamond" />;
      } else if (shape === "mcp") {
        glyph = (
          <span className="cn-hex">
            <span className="cn-hex-in" />
          </span>
        );
      } else if (shape === "workflow") {
        glyph = (
          <span className="cn-flathex">
            <span className="cn-flathex-in" />
          </span>
        );
      } else {
        glyph = <span className="cn-generic-glyph">{node.type.slice(0, 1).toUpperCase()}</span>;
      }
      body = (
        <>
          <span className="cn-shape">{glyph}</span>
          <span className="cn-label" title={node.name}>
            {node.name}
          </span>
          {sub ? <span className={`cn-sub${busy ? " cn-amber" : ""}`}>{sub}</span> : null}
        </>
      );
    }
  }

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
        {body}
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

const EDGE_LOOK: Record<GraphEdge["kind"], EdgeLook> = {
  uses_tool: { stroke: "#6FA8E8", width: 2, dash: "7 5", opacity: 0.8 },
  imports: { stroke: "#C9C4BA", width: 1.6, opacity: 0.45 },
  references: { stroke: "#C9C4BA", width: 1.2, dash: "2 4", opacity: 0.45 },
  member_of: { stroke: "#C9C4BA", width: 1.5, dash: "6 5", opacity: 0.5 },
  assigned_to: { stroke: "#E8A547", width: 2, opacity: 0.45 },
  produced: { stroke: "#E8A547", width: 1.5, dash: "4 4", opacity: 0.6 },
  contains: { stroke: "#4A515C", width: 1.5, dash: "5 5", opacity: 0.9 },
  about: { stroke: "#5A616C", width: 1.2, dash: "1 4", opacity: 0.9 },
  relates_to: { stroke: "#5A616C", width: 1.2, dash: "3 4", opacity: 0.8 },
  depends_on: { stroke: "#9AA1AC", width: 1.4, dash: "6 3", opacity: 0.6 },
  triggered: { stroke: "#E8A547", width: 1.2, dash: "2 3", opacity: 0.6 },
};

/** Fit padding that keeps nodes clear of the legend (top) and the intent bar (bottom). */
const FIT_PADDING = { top: "70px", bottom: "180px", left: "40px", right: "40px" } as const;
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
    // Leave room for the legend on top and the intent bar at the bottom.
    void rf.fitView({ nodes: target, padding: FIT_PADDING, maxZoom: 1, minZoom: 0.2, duration: first ? 0 : 450 });
  }, [initialized, graph, positions, nodes.length, selectedWorkspaceNodeId, rf]);

  // Search / file tree focus.
  useEffect(() => {
    if (!focus) return;
    const n = rf.getNode(focus.id);
    if (!n) return;
    const a = ANCHOR[n.data.shape];
    void rf.setCenter(n.position.x + a.x, n.position.y + a.y, { zoom: 1.1, duration: 450 });
  }, [focus, rf]);

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
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.3} color="#272C35" bgColor="#111317" />
        <Panel position="top-left" className="canvas-top-left">
          <Legend />
          <button
            type="button"
            className="btn btn-ghost btn-sm canvas-menu-btn"
            onClick={(e) => {
              const box = (e.currentTarget.closest(".react-flow") as HTMLElement | null)?.getBoundingClientRect();
              onPaneActivate(box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 - 60 } : { x: 400, y: 300 });
            }}
          >
            <IconMenu size={15} /> Open menu
          </button>
        </Panel>
        <MiniMap
          position="top-right"
          pannable
          zoomable
          bgColor="#0C0E11"
          maskColor="rgba(12, 14, 17, 0.72)"
          nodeColor={(n) => MINIMAP_COLOR[(n.data as CanvasNodeData).node.type] ?? "#5A616C"}
          nodeStrokeWidth={0}
          nodeBorderRadius={3}
          style={{ width: 180, height: 120 }}
        />
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
          The graph is empty. State an intent below to generate the first workspace.
        </div>
      ) : null}
    </ActivateContext.Provider>
  );
}

const MINIMAP_COLOR: Partial<Record<GraphNode["type"], string>> = {
  agent: "#E8A547",
  workspace: "#E8A547",
  mcp: "#6FA8E8",
  project: "#C9C4BA",
  file: "#8A909A",
  folder: "#6A717C",
  concept: "#5A616C",
  workflow: "#9AA1AC",
  output: "#C98A34",
};

function Legend() {
  return (
    <div className="legend" aria-label="Legend" role="group">
      <span className="lg">
        <span className="lg-project" />
        Project
      </span>
      <span className="lg">
        <span className="lg-file" />
        File
      </span>
      <span className="lg">
        <span className="lg-agent" />
        Agent
      </span>
      <span className="lg">
        <span className="lg-mcp" />
        MCP tool
      </span>
      <span className="lg">
        <span className="lg-workflow" />
        Workflow
      </span>
      <span className="lg">
        <span className="lg-ws" />
        Workspace
      </span>
      <span className="lg">
        <span className="lg-edge lg-edge-tool" />
        uses tool
      </span>
      <span className="lg">
        <span className="lg-edge lg-edge-assigned" />
        assigned
      </span>
    </div>
  );
}

export function Canvas(props: CanvasProps) {
  return (
    <div className="canvas" aria-label="Neural canvas">
      <ReactFlowProvider>
        <CanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}

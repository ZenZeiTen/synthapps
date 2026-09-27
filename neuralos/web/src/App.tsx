import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { useDebouncedCallback, useGraph, useKernelEvents } from "./hooks";
import type { AgentDefinition, AgentInstance, AgentState, ApprovalRequest, GraphNode, KernelStatus, RadialAction, RadialResult, SearchHit, Workspace } from "./types";
import { ApprovalsBar } from "./components/ApprovalsBar";
import { AgentsPanel, AppsPanel, FilesPanel, ProjectsPanel } from "./components/BrowsePanels";
import { Canvas } from "./components/Canvas";
import { EventLog } from "./components/EventLog";
import { ExecutionPanel } from "./components/ExecutionPanel";
import { FileViewer } from "./components/FileViewer";
import { IconAlert, IconRefresh } from "./components/Icons";
import { IntentBar } from "./components/IntentBar";
import { HaltBanner, KillSwitch } from "./components/KillSwitch";
import { MemoryPanel } from "./components/MemoryPanel";
import { RadialMenu, type RadialTarget } from "./components/RadialMenu";
import { SearchPanel } from "./components/SearchPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { TopBar } from "./components/TopBar";

type PanelId = "search" | "files" | "agents" | "projects" | "apps" | "memory" | "settings";
const PANELS: PanelId[] = ["search", "files", "agents", "projects", "apps", "memory", "settings"];

interface Toast {
  id: number;
  message: string;
  tone: "ok" | "error";
}

const ACTIVE_STATES: AgentState[] = ["summoned", "active", "collaborating"];

function prettyId(id: string): string {
  return id
    .split(/[_-]/)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function App() {
  const { events, connection, onEvent } = useKernelEvents();
  const { graph, error: graphError, loading: graphLoading, reload: reloadGraph } = useGraph(onEvent);

  const [status, setStatus] = useState<KernelStatus | null>(null);
  const [unreachable, setUnreachable] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [selectedWs, setSelectedWs] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<AgentDefinition[] | null>(null);
  const [instances, setInstances] = useState<AgentInstance[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [panel, setPanel] = useState<PanelId | null>(null);
  const [fileView, setFileView] = useState<{ path: string; line?: number } | null>(null);
  const [radial, setRadial] = useState<RadialTarget | null>(null);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const canvasArea = useRef<HTMLDivElement>(null);
  const toastId = useRef(0);
  const autoSelected = useRef(false);

  const toast = useCallback((message: string, tone: "ok" | "error" = "ok") => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 8000 : 5000);
  }, []);

  // ---- loaders ---------------------------------------------------------------------------------------
  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api.status());
      setUnreachable(null);
    } catch (err) {
      setUnreachable((err as Error).message);
    }
  }, []);
  const loadWorkspaces = useCallback(async () => {
    try {
      const list = await api.workspaces();
      setWorkspaces(list);
      if (!autoSelected.current) {
        autoSelected.current = true;
        const pick = [...list].reverse().find((w) => w.status !== "archived");
        if (pick) setSelectedWs((cur) => cur ?? pick.id);
      }
    } catch {
      /* the unreachable banner covers this */
    }
  }, []);
  const loadInstances = useCallback(async () => {
    try {
      setInstances(await api.instances());
    } catch {
      /* ignore */
    }
  }, []);
  const loadApprovals = useCallback(async () => {
    try {
      setApprovals(await api.approvals("pending"));
    } catch {
      /* ignore */
    }
  }, []);
  const loadCatalog = useCallback(async () => {
    try {
      setCatalog(await api.agents());
    } catch {
      /* ignore */
    }
  }, []);

  const loadAll = useCallback(() => {
    void loadStatus();
    void loadWorkspaces();
    void loadInstances();
    void loadApprovals();
    void loadCatalog();
    void reloadGraph();
  }, [loadStatus, loadWorkspaces, loadInstances, loadApprovals, loadCatalog, reloadGraph]);

  useEffect(() => {
    loadAll();
    const t = setInterval(() => void loadStatus(), 20000);
    return () => clearInterval(t);
  }, [loadAll, loadStatus]);

  // Retry everything once the kernel comes back.
  const wasDown = useRef(false);
  useEffect(() => {
    if (unreachable) wasDown.current = true;
    else if (wasDown.current) {
      wasDown.current = false;
      loadAll();
    }
  }, [unreachable, loadAll]);

  const refreshInstances = useDebouncedCallback(() => void loadInstances(), 300);
  const refreshWorkspaces = useDebouncedCallback(() => void loadWorkspaces(), 300);
  const refreshStatus = useDebouncedCallback(() => void loadStatus(), 500);

  useEffect(
    () =>
      onEvent((ev) => {
        if (ev.type.startsWith("agent.")) refreshInstances();
        if (ev.type.startsWith("workspace.")) {
          refreshWorkspaces();
          refreshInstances();
        }
        if (ev.type === "tool.approval_requested" || ev.type === "tool.approval_resolved") void loadApprovals();
        if (ev.type === "kernel.halted" || ev.type === "kernel.resumed") {
          void loadStatus();
          void loadApprovals();
          refreshInstances();
        }
        if (ev.type.startsWith("mcp.") || ev.type === "workspace.generated") refreshStatus();
      }),
    [onEvent, refreshInstances, refreshWorkspaces, refreshStatus, loadApprovals, loadStatus],
  );

  // ---- derived ---------------------------------------------------------------------------------------
  const agentNames = useMemo(() => new Map((catalog ?? []).map((a) => [a.id, a.name])), [catalog]);
  const agentName = useCallback((id: string) => agentNames.get(id) ?? prettyId(id), [agentNames]);

  const selectedWorkspace = workspaces?.find((w) => w.id === selectedWs) ?? null;
  const selectedNodeId = selectedWorkspace?.nodeId ?? (selectedWs ? `workspace:${selectedWs}` : null);

  const agentStates = useMemo(() => {
    const m = new Map<string, AgentState>();
    const sorted = [...instances].sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
    for (const i of sorted) m.set(`agent:${i.agentId}`, i.state);
    // Running beats finished, and the selected workspace's own instances win over both.
    for (const i of sorted) if (ACTIVE_STATES.includes(i.state)) m.set(`agent:${i.agentId}`, i.state);
    for (const i of sorted) if (selectedWs && i.workspaceId === selectedWs) m.set(`agent:${i.agentId}`, i.state);
    return m;
  }, [instances, selectedWs]);

  const projectName = useMemo(() => {
    const p = graph?.nodes.find((n) => n.type === "project");
    if (p) return p.name;
    const root = status?.root?.split(/[\\/]/).filter(Boolean).pop();
    return root ?? "NeuralOS";
  }, [graph, status]);

  const halted = status?.halted ?? false;

  // ---- actions ---------------------------------------------------------------------------------------
  const focusNode = useCallback((id: string) => setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 })), []);
  const openFile = useCallback((path: string, line?: number) => setFileView({ path, line }), []);

  const selectWorkspace = useCallback(
    (id: string) => {
      setSelectedWs(id);
      void loadWorkspaces();
    },
    [loadWorkspaces],
  );

  const onClientAction = useCallback(
    (action: RadialAction, target: RadialTarget) => {
      const key = action.id.toLowerCase() as PanelId;
      if (target.nodeId === "root" && PANELS.includes(key)) {
        setPanel(key);
        return;
      }
      const label = action.label.toLowerCase() as PanelId;
      if (PANELS.includes(label)) {
        setPanel(label);
        return;
      }
      const node = target.node;
      if (node?.type === "file" && (action.id === "open" || action.id === "open_file")) {
        openFile(typeof node.props?.path === "string" ? (node.props.path as string) : node.id.replace(/^file:/, ""));
        return;
      }
      if (node?.type === "workspace") {
        selectWorkspace(String(node.props?.workspaceId ?? node.id.replace(/^workspace:/, "")));
        return;
      }
      toast(`${action.label}${action.hint ? `: ${action.hint}` : ""}`);
    },
    [openFile, selectWorkspace, toast],
  );

  const onRadialResult = useCallback(
    (result: RadialResult, action: RadialAction) => {
      toast(result.message || `${action.label} ${result.ok ? "done" : "failed"}`, result.ok ? "ok" : "error");
      if (result.workspaceId) selectWorkspace(result.workspaceId);
      const d = result.data as { path?: unknown; content?: unknown } | undefined;
      if (result.ok && d && typeof d.path === "string" && typeof d.content === "string") openFile(d.path);
      if (result.instanceId) refreshInstances();
    },
    [toast, selectWorkspace, openFile, refreshInstances],
  );

  const onNodeActivate = useCallback((node: GraphNode, at: { x: number; y: number }) => {
    setRadial((cur) => (cur && cur.nodeId === node.id ? null : { nodeId: node.id, node, at }));
  }, []);
  const onPaneActivate = useCallback((at: { x: number; y: number }) => {
    setRadial((cur) => (cur ? null : { nodeId: "root", at }));
  }, []);

  const onOpenHit = useCallback(
    (hit: SearchHit) => {
      openFile(hit.path, hit.line);
      focusNode(hit.nodeId);
    },
    [openFile, focusNode],
  );

  const showApprovals = () => {
    document.querySelector<HTMLElement>(".approvals .btn-approve")?.focus();
  };

  return (
    <div className="app">
      <TopBar
        status={status}
        projectName={projectName}
        instances={instances}
        pendingApprovals={approvals.length}
        onShowApprovals={showApprovals}
        killSwitch={<KillSwitch halted={halted} disabled={!status} onStatus={setStatus} onToast={toast} />}
      />
      {unreachable ? (
        <div className="offline-banner" role="alert">
          <IconAlert size={16} />
          <span>
            <strong>Kernel unreachable.</strong> The canvas shows the last known state. ({unreachable})
          </span>
          <button type="button" className="btn btn-sm" onClick={loadAll}>
            <IconRefresh size={14} /> Retry
          </button>
        </div>
      ) : null}
      {halted ? <HaltBanner onStatus={setStatus} onToast={toast} /> : null}
      <ApprovalsBar
        approvals={approvals}
        onResolved={(a) => setApprovals((list) => list.filter((x) => x.id !== a.id))}
        onToast={toast}
      />

      <div className="main">
        <div className={`canvas-area${panel ? " has-panel" : ""}${panel === "settings" ? " has-wide-panel" : ""}`} ref={canvasArea}>
          <Canvas
            graph={graph}
            loading={graphLoading}
            error={graphError}
            onRetry={() => void reloadGraph()}
            agentStates={agentStates}
            selectedWorkspaceNodeId={selectedNodeId}
            focus={focus}
            onNodeActivate={onNodeActivate}
            onPaneActivate={onPaneActivate}
          />
          <IntentBar agentName={agentName} onGenerated={(ws) => {
            toast(`Workspace generated: ${ws.label}`);
            setSelectedWs(ws.id);
            void loadWorkspaces();
          }} onError={(m) => toast(m, "error")} disabled={halted} />

          {panel === "search" ? <SearchPanel onClose={() => setPanel(null)} onOpenHit={onOpenHit} /> : null}
          {panel === "files" ? (
            <FilesPanel
              graph={graph}
              onClose={() => setPanel(null)}
              onOpen={(path, nodeId) => {
                openFile(path);
                focusNode(nodeId);
              }}
            />
          ) : null}
          {panel === "agents" ? (
            <AgentsPanel agents={catalog} instances={instances} onClose={() => setPanel(null)} onFocus={focusNode} onToast={toast} halted={halted} />
          ) : null}
          {panel === "projects" ? <ProjectsPanel graph={graph} onClose={() => setPanel(null)} onFocus={focusNode} /> : null}
          {panel === "apps" ? (
            <AppsPanel workspaces={workspaces} selectedId={selectedWs} onClose={() => setPanel(null)} onSelect={selectWorkspace} />
          ) : null}
          {panel === "memory" ? <MemoryPanel onClose={() => setPanel(null)} onToast={toast} onEvent={onEvent} /> : null}
          {panel === "settings" ? (
            <SettingsPanel status={status} onClose={() => setPanel(null)} onToast={toast} onEvent={onEvent} onStatusChanged={() => void loadStatus()} />
          ) : null}

          {radial ? (
            <RadialMenu
              key={`${radial.nodeId}@${radial.at.x},${radial.at.y}`}
              target={radial}
              container={canvasArea.current}
              onClose={() => setRadial(null)}
              onClientAction={onClientAction}
              onResult={onRadialResult}
            />
          ) : null}

          <div className="toasts" aria-live="polite" role="status">
            {toasts.map((t) => (
              <div key={t.id} className={`toast toast-${t.tone}`}>
                {t.message}
              </div>
            ))}
          </div>
        </div>

        <aside className="side" aria-label="Execution">
          <ExecutionPanel
            workspaceId={selectedWs}
            workspaces={workspaces ?? []}
            onSelect={selectWorkspace}
            agentName={agentName}
            onOpenFile={openFile}
            onToast={toast}
            onEvent={onEvent}
            halted={halted}
          />
          <EventLog events={events} workspaces={workspaces ?? []} connection={connection} />
        </aside>
      </div>

      {fileView ? <FileViewer path={fileView.path} line={fileView.line} onClose={() => setFileView(null)} /> : null}
    </div>
  );
}

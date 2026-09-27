import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api } from "./api";
import { BRAND } from "./brand";
import { coreStatusLine, coreWord, deriveMood, fieldState, FINISHED_STATES, restingSystemAgents, RUNNING_STATES, type MoodInput } from "./core/model";
import { usePacedInstances, usePacer } from "./core/pacing";
import { useDebouncedCallback, useGraph, useKernelEvents } from "./hooks";
import type { AgentDefinition, AgentInstance, AgentState, ApprovalRequest, GraphNode, KernelEvent, KernelStatus, RadialAction, RadialResult, SearchHit, Workspace } from "./types";
import { ApprovalCard } from "./components/ApprovalCard";
import { AgentsPanel, AppsPanel, FilesPanel, ProjectsPanel } from "./components/BrowsePanels";
import { Canvas } from "./components/Canvas";
import { EventLog } from "./components/EventLog";
import { FileViewer } from "./components/FileViewer";
import { Hud } from "./components/Hud";
import { IconRefresh } from "./components/Icons";
import { IntentDock } from "./components/IntentDock";
import { KillSwitch, ResumeButton } from "./components/KillSwitch";
import { MemoryPanel } from "./components/MemoryPanel";
import { CoreHalo, NeuralCore } from "./components/NeuralCore";
import { RadialMenu, type RadialTarget } from "./components/RadialMenu";
import { ResultsSheet } from "./components/ResultsSheet";
import type { SatelliteInfo } from "./components/Satellites";
import { Scene } from "./components/Scene";
import { SearchPanel } from "./components/SearchPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { SidePanel } from "./components/SidePanel";
import { Ticker } from "./components/Ticker";

type PanelId = "search" | "files" | "agents" | "projects" | "apps" | "memory" | "settings" | "events";
const ROOT_PANELS: PanelId[] = ["search", "files", "agents", "projects", "apps", "memory", "settings"];

/** Panel and sheet widths (px) plus their 20 px margin; the stage centres the core in the space left between them. */
const PANEL_W = 400;
const PANEL_WIDE_W = 560;
const SHEET_W = 460;
const EDGE = 20;
/** A finished agent outside the focused workspace stays in orbit this long before it drifts away. */
const LINGER_MS = 6000;
/** The ticker shows a live event this long. */
const TICKER_MS = 12000;

interface Toast {
  id: number;
  message: string;
  tone: "ok" | "error";
}

interface LiveEventData {
  instanceId?: string;
  agentId?: string;
  name?: string;
  workspaceId?: string;
  /** The kernel sends `to`; older senders (the mock) send `state`. */
  to?: AgentState;
  state?: AgentState;
}

function prettyId(id: string): string {
  return id
    .split(/[_-]/)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

function useViewport() {
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const h = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return vp;
}

export function App() {
  const { events, connection, onEvent, reconnect } = useKernelEvents();
  const { graph, error: graphError, loading: graphLoading, reload: reloadGraph } = useGraph(onEvent);
  const vp = useViewport();

  const [status, setStatus] = useState<KernelStatus | null>(null);
  const [unreachable, setUnreachable] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [catalog, setCatalog] = useState<AgentDefinition[] | null>(null);
  const [instances, setInstances] = useState<AgentInstance[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [focusWs, setFocusWs] = useState<string | null>(null);
  const [sheetWs, setSheetWs] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [panel, setPanel] = useState<PanelId | null>(null);
  const [fieldOpen, setFieldOpen] = useState(false);
  const [fieldFocus, setFieldFocus] = useState<{ id: string; n: number } | null>(null);
  const [fileView, setFileView] = useState<{ path: string; line?: number } | null>(null);
  const [radial, setRadial] = useState<RadialTarget | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [lastLive, setLastLive] = useState<KernelEvent | null>(null);
  const [tick, setTick] = useState(0);
  const toastId = useRef(0);
  const mountedAt = useRef(Date.now());
  /** When each instance last changed state, as seen live (ms). Only live changes make a finished agent linger. */
  const changedAt = useRef(new Map<string, number>());
  const autoOpened = useRef(new Set<string>());
  /** Workspaces whose results were closed: their agents leave the orbit at once instead of lingering. */
  const dismissed = useRef(new Set<string>());
  const pacer = usePacer();
  const observe = pacer.observe;

  useEffect(() => {
    document.title = BRAND;
  }, []);

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
      setWorkspaces(await api.workspaces());
    } catch {
      /* the offline core covers this */
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

  // Reload everything once the kernel comes back.
  const wasDown = useRef(false);
  useEffect(() => {
    if (unreachable) wasDown.current = true;
    else if (wasDown.current) {
      wasDown.current = false;
      loadAll();
    }
  }, [unreachable, loadAll]);

  // The event stream dropping is the first sign of an outage: confirm with a status call.
  useEffect(() => {
    if (connection === "reconnecting") void loadStatus();
  }, [connection, loadStatus]);

  const refreshInstances = useDebouncedCallback(() => void loadInstances(), 250);
  const refreshWorkspaces = useDebouncedCallback(() => void loadWorkspaces(), 250);
  const refreshStatus = useDebouncedCallback(() => void loadStatus(), 700);

  // ---- derived names -----------------------------------------------------------------------------------
  const agentNames = useMemo(() => new Map((catalog ?? []).map((a) => [a.id, a.name])), [catalog]);
  const agentName = useCallback((id: string) => agentNames.get(id) ?? prettyId(id), [agentNames]);
  const agentNameRef = useRef(agentName);
  agentNameRef.current = agentName;

  // ---- live events -------------------------------------------------------------------------------------
  useEffect(
    () =>
      onEvent((ev) => {
        const live = Date.parse(ev.ts) >= mountedAt.current - 250;
        if (live && ev.type !== "kernel.log") setLastLive(ev);

        // Agent state straight from the stream, so satellites change colour without waiting for a refetch.
        if (live && (ev.type === "agent.summoned" || ev.type === "agent.state" || ev.type === "agent.finished" || ev.type === "agent.failed")) {
          const d = (ev.data ?? {}) as LiveEventData;
          const state: AgentState | undefined =
            ev.type === "agent.summoned" ? "summoned" : ev.type === "agent.state" ? (d.to ?? d.state) : ev.type === "agent.finished" ? "completed" : "failed";
          if (d.instanceId && state) {
            const instanceId = d.instanceId;
            changedAt.current.set(instanceId, Date.now());
            observe(instanceId, state, true);
            setInstances((list) => {
              const i = list.findIndex((x) => x.instanceId === instanceId);
              if (i >= 0) {
                if (list[i].state === state || FINISHED_STATES.includes(list[i].state)) return list;
                const next = list.slice();
                next[i] = { ...list[i], state };
                return next;
              }
              if (ev.type !== "agent.summoned" || !d.agentId) return list;
              const stub = {
                instanceId,
                agentId: d.agentId,
                name: d.name ?? agentNameRef.current(d.agentId),
                workspaceId: d.workspaceId,
                state,
                startedAt: ev.ts,
              } as AgentInstance;
              return [...list, stub];
            });
          }
        }
        if (ev.type.startsWith("agent.")) {
          refreshInstances();
          refreshStatus();
        }
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
    [onEvent, refreshInstances, refreshWorkspaces, refreshStatus, loadApprovals, loadStatus, observe],
  );

  // The ticker hides after a quiet spell.
  useEffect(() => {
    if (!lastLive) return;
    const t = setTimeout(() => setLastLive(null), TICKER_MS);
    return () => clearTimeout(t);
  }, [lastLive]);

  // ---- the core's state --------------------------------------------------------------------------------
  const halted = status?.halted ?? false;
  const offline = !!unreachable || connection === "reconnecting";
  // What the core shows is paced (see core/pacing.ts): every agent state stays visible long enough to be seen.
  const paced = usePacedInstances(instances, pacer);
  const running = useMemo(() => paced.filter((i) => RUNNING_STATES.includes(i.state)), [paced]);
  const focusWorkspace = workspaces?.find((w) => w.id === focusWs) ?? null;
  // Busy while any of its agents is still shown working or still waiting to be shown ("dormant" in the paced view).
  const focusSwarmBusy = !!focusWs && paced.some((i) => i.workspaceId === focusWs && (RUNNING_STATES.includes(i.state) || i.state === "dormant"));
  const focusStatus = focusWs ? (focusSwarmBusy ? "running" : (focusWorkspace?.status ?? "ready")) : null;

  const moodInput: MoodInput = {
    unreachable: offline,
    halted,
    pendingApprovals: approvals.length,
    submitting,
    runningAgents: running.length,
    focusStatus,
    sheetOpen: sheetWs !== null,
  };
  const mood = deriveMood(moodInput);
  const statusLine = coreStatusLine(mood, moodInput);

  const systemIds = useMemo(() => (catalog ?? []).filter((a) => a.group === "system").map((a) => a.id), [catalog]);
  const resting = catalog ? restingSystemAgents(systemIds, paced) : null;
  const field = fieldState(status, offline, running.length);

  // Open the results when the focused workspace finishes (once; closing it returns to the idle core).
  useEffect(() => {
    if (!focusWs || focusSwarmBusy) return;
    if ((focusStatus === "completed" || focusStatus === "failed") && !autoOpened.current.has(focusWs)) {
      autoOpened.current.add(focusWs);
      setSheetWs(focusWs);
    }
  }, [focusWs, focusStatus, focusSwarmBusy]);

  // Satellites: the focused workspace's swarm (latest instance per agent), every running agent anywhere, and agents
  // that just finished, which linger briefly before drifting away.
  const sats = useMemo<SatelliteInfo[]>(() => {
    void tick;
    const out = new Map<string, SatelliteInfo>();
    const sorted = [...paced].sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
    const sat = (i: AgentInstance): SatelliteInfo => ({ key: i.instanceId, agentId: i.agentId, name: agentName(i.agentId), state: i.state });
    if (focusWs) {
      const latest = new Map<string, AgentInstance>();
      for (const i of sorted) if (i.workspaceId === focusWs && i.state !== "dormant") latest.set(i.agentId, i);
      for (const i of latest.values()) out.set(i.instanceId, sat(i));
    }
    const now = Date.now();
    for (const i of sorted) {
      if (out.has(i.instanceId) || i.state === "dormant") continue;
      if (i.workspaceId && i.workspaceId === focusWs) continue; // an older run of an agent already shown
      if (RUNNING_STATES.includes(i.state)) out.set(i.instanceId, sat(i));
      else if (!(i.workspaceId && dismissed.current.has(i.workspaceId)) && now - (changedAt.current.get(i.instanceId) ?? 0) < LINGER_MS) out.set(i.instanceId, sat(i));
    }
    return [...out.values()];
  }, [paced, focusWs, agentName, tick]);

  // Wake up when the next lingering satellite should leave.
  useEffect(() => {
    const now = Date.now();
    let soonest = Infinity;
    for (const i of paced) {
      if (RUNNING_STATES.includes(i.state)) continue;
      const at = changedAt.current.get(i.instanceId);
      if (at && now - at < LINGER_MS) soonest = Math.min(soonest, at + LINGER_MS - now);
    }
    if (!Number.isFinite(soonest)) return;
    const t = setTimeout(() => setTick((n) => n + 1), soonest + 30);
    return () => clearTimeout(t);
  }, [paced, tick]);

  // ---- actions -----------------------------------------------------------------------------------------
  const openFile = useCallback((path: string, line?: number) => setFileView({ path, line }), []);

  const coreGeometry = useCallback(() => {
    const el = document.querySelector<HTMLElement>(".core-orb");
    const b = el?.getBoundingClientRect();
    if (b && b.width > 0 && !fieldOpen)
      return { center: { x: b.left + b.width / 2, y: b.top + b.height / 2 }, radius: b.width / 2 + 104, followCore: { pad: 104 } };
    return { center: { x: window.innerWidth / 2, y: window.innerHeight * 0.5 }, radius: 230 };
  }, [fieldOpen]);

  const openRoot = useCallback(() => {
    setRadial((cur) => (cur?.nodeId === "root" ? null : { nodeId: "root", ...coreGeometry() }));
  }, [coreGeometry]);

  const openAgent = useCallback(
    (agentId: string) => {
      setRadial({ nodeId: `agent:${agentId}`, title: agentName(agentId), ...coreGeometry() });
    },
    [agentName, coreGeometry],
  );

  const showWorkspace = useCallback(
    (id: string) => {
      setFocusWs(id);
      setSheetWs(id);
      autoOpened.current.add(id);
      void loadWorkspaces();
    },
    [loadWorkspaces],
  );

  const closeSheet = useCallback(() => {
    setSheetWs((cur) => {
      if (cur) dismissed.current.add(cur);
      return null;
    });
    setFocusWs((cur) => {
      if (cur) dismissed.current.add(cur);
      return null;
    });
  }, []);

  const submitIntent = useCallback(
    async (text: string) => {
      setSubmitting(true);
      setRadial(null);
      try {
        const { workspace } = await api.submitIntent(text, true);
        setWorkspaces((list) => [...(list ?? []).filter((w) => w.id !== workspace.id), workspace]);
        setSheetWs(null);
        setFocusWs(workspace.id);
        return true;
      } catch (err) {
        toast(`Intent failed: ${(err as Error).message}`, "error");
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [toast],
  );

  const onClientAction = useCallback(
    (action: RadialAction, target: RadialTarget) => {
      const key = action.id.toLowerCase() as PanelId;
      if (target.nodeId === "root" && ROOT_PANELS.includes(key)) {
        setPanel(key);
        return;
      }
      const label = action.label.toLowerCase() as PanelId;
      if (ROOT_PANELS.includes(label)) {
        setPanel(label);
        return;
      }
      const node = target.node;
      const nodePath = node?.type === "file" ? (typeof node.props?.path === "string" ? (node.props.path as string) : node.id.replace(/^file:/, "")) : null;
      const idPath = target.nodeId.startsWith("file:") ? target.nodeId.slice(5) : null;
      if ((action.id === "open" || action.id === "open_file") && (nodePath ?? idPath)) {
        openFile((nodePath ?? idPath)!);
        return;
      }
      if (node?.type === "workspace" || target.nodeId.startsWith("workspace:")) {
        showWorkspace(String(node?.props?.workspaceId ?? target.nodeId.replace(/^workspace:/, "")));
        return;
      }
      toast(`${action.label}${action.hint ? `: ${action.hint}` : ""}`);
    },
    [openFile, showWorkspace, toast],
  );

  const onRadialResult = useCallback(
    (result: RadialResult, action: RadialAction) => {
      toast(result.message || `${action.label} ${result.ok ? "done" : "failed"}`, result.ok ? "ok" : "error");
      if (result.workspaceId) {
        setSheetWs(null);
        setFocusWs(result.workspaceId);
        void loadWorkspaces();
      }
      const d = result.data as { path?: unknown; content?: unknown } | undefined;
      if (result.ok && d && typeof d.path === "string" && typeof d.content === "string") openFile(d.path);
      if (result.instanceId) refreshInstances();
    },
    [toast, openFile, refreshInstances, loadWorkspaces],
  );

  const onFieldNode = useCallback((node: GraphNode, at: { x: number; y: number }) => {
    setRadial((cur) => (cur && cur.nodeId === node.id ? null : { nodeId: node.id, node, center: at, radius: 150 }));
  }, []);

  const onOpenHit = useCallback(
    (hit: SearchHit) => {
      openFile(hit.path, hit.line);
      if (fieldOpen) setFieldFocus((f) => ({ id: hit.nodeId, n: (f?.n ?? 0) + 1 }));
    },
    [openFile, fieldOpen],
  );

  const showInField = useCallback((nodeId?: string) => {
    setFieldOpen(true);
    setPanel(null);
    if (nodeId) setFieldFocus((f) => ({ id: nodeId, n: (f?.n ?? 0) + 1 }));
  }, []);

  // ---- layout ------------------------------------------------------------------------------------------
  const leftW = panel ? (panel === "settings" ? PANEL_WIDE_W : PANEL_W) + EDGE : 0;
  const rightW = sheetWs ? SHEET_W + EDGE : 0;
  // Shrink the core when panels leave it less room than its orbit needs.
  const orbPx = Math.min(vp.h * 0.266, 300);
  const room = vp.w - leftW - rightW;
  const scale = Math.max(0.5, Math.min(1, room / (orbPx * 3.2)));
  const stageStyle = { left: leftW, right: rightW, "--core-scale": scale.toFixed(3) } as CSSProperties;

  const selectedNodeId = focusWorkspace?.nodeId ?? (focusWs ? `workspace:${focusWs}` : null);
  const agentStates = useMemo(() => {
    const m = new Map<string, AgentState>();
    const sorted = [...paced].sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
    for (const i of sorted) m.set(`agent:${i.agentId}`, i.state);
    for (const i of sorted) if (RUNNING_STATES.includes(i.state)) m.set(`agent:${i.agentId}`, i.state);
    return m;
  }, [paced]);

  const coreAction = halted ? (
    <ResumeButton onStatus={setStatus} onToast={toast} />
  ) : offline ? (
    <button
      type="button"
      className="core-btn btn-retry"
      onClick={() => {
        loadAll();
        reconnect();
      }}
    >
      <IconRefresh size={12} /> Retry
    </button>
  ) : null;

  return (
    <div className={`app mood-${mood}${fieldOpen ? " field-open" : ""}`}>
      <div className="stage stage-back" style={stageStyle} aria-hidden="true">
        <CoreHalo mood={mood} lifted={approvals.length > 0} />
      </div>
      <Scene mood={mood} orbits={!fieldOpen} />

      {fieldOpen ? (
        <div className="field-layer">
          <Canvas
            graph={graph}
            loading={graphLoading}
            error={graphError}
            onRetry={() => void reloadGraph()}
            agentStates={agentStates}
            selectedWorkspaceNodeId={selectedNodeId}
            focus={fieldFocus}
            onNodeActivate={onFieldNode}
            onPaneActivate={() => setRadial(null)}
          />
        </div>
      ) : null}

      <Hud
        coreWord={coreWord(mood)}
        resting={resting}
        field={field}
        activeAgents={running.length}
        fieldOpen={fieldOpen}
        onToggleField={() => {
          setRadial(null);
          setFieldOpen((f) => !f);
        }}
        killSwitch={<KillSwitch halted={halted} disabled={!status || offline} onStatus={setStatus} onToast={toast} />}
      />

      <main className={`stage${room < 720 ? " is-narrow" : ""}`} style={stageStyle} aria-label={`${BRAND} core`} aria-hidden={fieldOpen || undefined}>
        <NeuralCore
          mood={mood}
          statusLine={statusLine}
          sats={sats}
          lifted={approvals.length > 0}
          radialOpen={radial !== null && !fieldOpen}
          onCoreClick={() => openRoot()}
          onSatellite={(s) => openAgent(s.agentId)}
          action={coreAction}
        />
        <ApprovalCard approvals={approvals} onResolved={(a) => setApprovals((list) => list.filter((x) => x.id !== a.id))} onToast={toast} />
        <IntentDock
          agentName={agentName}
          onSubmit={submitIntent}
          busy={submitting}
          disabled={halted || offline}
          disabledReason={halted ? "Halted. Resume to state an intent" : offline ? `${BRAND} is offline` : undefined}
        />
      </main>

      {panel === "search" ? <SearchPanel onClose={() => setPanel(null)} onOpenHit={onOpenHit} /> : null}
      {panel === "files" ? (
        <FilesPanel
          graph={graph}
          onClose={() => setPanel(null)}
          onOpen={(path) => openFile(path)}
          onActions={(path, nodeId) => {
            setPanel(null);
            setRadial({ nodeId, title: path.split("/").pop() ?? path, ...coreGeometry() });
          }}
          onField={() => showInField()}
        />
      ) : null}
      {panel === "agents" ? (
        <AgentsPanel
          agents={catalog}
          instances={instances}
          onClose={() => setPanel(null)}
          onFocus={(agentId) => {
            setPanel(null);
            openAgent(agentId);
          }}
          onToast={toast}
          halted={halted}
        />
      ) : null}
      {panel === "projects" ? <ProjectsPanel graph={graph} onClose={() => setPanel(null)} onFocus={(id) => showInField(id)} /> : null}
      {panel === "apps" ? (
        <AppsPanel
          workspaces={workspaces}
          selectedId={sheetWs}
          onClose={() => setPanel(null)}
          onSelect={(id) => {
            setPanel(null);
            showWorkspace(id);
          }}
        />
      ) : null}
      {panel === "memory" ? <MemoryPanel onClose={() => setPanel(null)} onToast={toast} onEvent={onEvent} /> : null}
      {panel === "settings" ? (
        <SettingsPanel
          status={status}
          onClose={() => setPanel(null)}
          onToast={toast}
          onEvent={onEvent}
          onStatusChanged={() => void loadStatus()}
          onOpenEvents={() => setPanel("events")}
        />
      ) : null}
      {panel === "events" ? (
        <SidePanel title="Events" subtitle="The kernel's event bus, live." onClose={() => setPanel(null)}>
          <EventLog events={events} workspaces={workspaces ?? []} connection={connection} />
        </SidePanel>
      ) : null}

      {fieldOpen ? null : <Ticker event={lastLive} connection={connection} onOpen={() => setPanel("events")} />}

      {sheetWs ? (
        <ResultsSheet
          key={sheetWs}
          workspaceId={sheetWs}
          agentName={agentName}
          onOpenFile={openFile}
          onAgent={openAgent}
          onToast={toast}
          onEvent={onEvent}
          onClose={closeSheet}
          halted={halted}
        />
      ) : null}

      {radial ? (
        <RadialMenu
          key={`${radial.nodeId}@${Math.round(radial.center.x)},${Math.round(radial.center.y)}`}
          target={radial}
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

      {fileView ? <FileViewer path={fileView.path} line={fileView.line} onClose={() => setFileView(null)} /> : null}
    </div>
  );
}

/**
 * The Nalara kernel: the composition root (ARCHITECTURE.md). It is the only module that wires the others
 * together; components talk to each other through the event bus and the contracts in types.ts.
 *
 * Safety wiring (SAFETY.md 2): every tool call goes through the ToolRegistry (with the audit log, the Governor
 * and the tool policy), every model call through a provider metered per agent instance, and the kill switch
 * (halt) is reachable only from this object, which the HTTP API and CLI expose to the human.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_CATALOG } from "../agents/catalog";
import { createGovernor } from "../agents/governor";
import { createOrchestrator, type NeuralOrchestrator } from "../agents/orchestrator";
import { createEventBus } from "../events/bus";
import { createTriggerEngine, DEFAULT_TRIGGER_RULES } from "../events/triggers";
import { createKnowledgeGraph } from "../graph/store";
import { createIntentEngine } from "../intent/engine";
import { createAnthropicProvider, hasClaudeCredentials } from "../llm/anthropic";
import { meterProvider } from "../llm/meter";
import { attachMemoryAgent, seedMemoryFromRoot } from "../memory/agent";
import { createMemoryService } from "../memory/service";
import { createSemanticIndex, type SemanticIndexImpl } from "../search/index";
import { createFileWatcher } from "../search/watcher";
import { registerBuiltinTools } from "../tools/builtin";
import { createMcpManager, type NeuralMcpManager } from "../tools/mcp";
import { createToolRegistry } from "../tools/registry";
import { createWorkspaceGenerator, outputDirFor } from "../workspace/generator";
import { createAuditLog } from "./audit";
import { loadConfig, type ConfigOverrides } from "./config";
import { openDatabase, type Database } from "./db";
import { createActionJournal } from "./journal";
import { createRadial, RadialError, type Radial } from "./radial";
import { loadWorkflows } from "./workflows";
import type {
  AgentInstance,
  ApprovalRequest,
  Kernel,
  KernelStatus,
  LLMProvider,
  McpServerConfig,
  McpServerStatus,
  MemoryRecord,
  NalaraConfig,
  Principal,
  RadialAction,
  RadialKind,
  RadialResult,
  ToolPolicy,
  TriggerExecutor,
  TriggerRule,
  WorkflowDefinition,
  Workspace,
} from "./types";

export const KERNEL_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

/** The kill switch is on: new runs are refused (HTTP 409). */
export class KernelHaltedError extends Error {
  readonly status = 409;
  constructor(reason: string) {
    super(`Kernel is halted${reason ? ` (${reason})` : ""}: resume it before starting new work`);
    this.name = "KernelHaltedError";
  }
}

/** A lookup that failed: HTTP 404. */
export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/** A request that conflicts with current state: HTTP 409. */
export class ConflictError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export interface KernelDeps {
  /** Use this provider (tests pass a scripted one). `null` forces offline mode. Omitted: Claude when credentials exist. */
  llm?: LLMProvider | null;
  /** Environment for config loading (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
  /** Resume workspaces left "running" by a previous process (default true; short-lived CLI commands pass false). */
  resume?: boolean;
}

/** The Kernel contract plus what the HTTP server and CLI need. */
export interface NeuralKernel extends Kernel {
  readonly orchestrator: NeuralOrchestrator;
  readonly mcp: NeuralMcpManager;
  readonly index: SemanticIndexImpl;
  readonly radial: Radial;
  /** Workflow files that failed validation at start. */
  readonly workflowErrors: string[];
  isHalted(): boolean;
  /** The human principal: root of every delegation chain. */
  human(workspaceId?: string): Principal;
  /** Marks the workspace running and starts its plan in the background. */
  startWorkspace(id: string): { workspace: Workspace; done: Promise<Workspace> };
  /** Spawns an agent and runs it in the background. */
  startAgent(agentId: string, task: string, opts?: { files?: string[]; workspaceId?: string }): { instance: AgentInstance; done: Promise<AgentInstance> };
  /** Starts a workflow in the background. */
  startWorkflow(id: string): Promise<{ workspaces: string[]; instances: string[] }>;
  archiveWorkspace(id: string): Workspace | undefined;
  /** Human confirmation of a proposed memory record, written to the audit ledger. */
  confirmMemory(id: string): MemoryRecord | undefined;
  resolveApproval(id: string, approved: boolean): ApprovalRequest | undefined;
  setPolicy(policy: ToolPolicy): ToolPolicy;
  setTriggerEnabled(id: string, enabled: boolean): TriggerRule | undefined;
  connectMcp(name: string, config: McpServerConfig): Promise<McpServerStatus>;
  disconnectMcp(name: string): Promise<boolean>;
  reapproveMcpTool(toolName: string): boolean;
}

const RESUME_REASON = "resumed after restart";
const STOP_WAIT_MS = 5000;

export function createKernel(configOverrides: ConfigOverrides = {}, deps: KernelDeps = {}): NeuralKernel {
  const config: NalaraConfig = loadConfig(configOverrides, deps.env ?? process.env);
  const { root, dataDir } = config;
  mkdirSync(dataDir, { recursive: true });
  const db: Database = openDatabase(join(dataDir, "nalara.db"));

  // --- storage, events, knowledge ------------------------------------------------
  const bus = createEventBus({ db });
  const audit = createAuditLog({ db });
  const journal = createActionJournal({ db, root, bus });
  const graph = createKnowledgeGraph({ db, bus });
  const memory = createMemoryService({ db, bus });
  const index = createSemanticIndex({ root, graph, bus });

  // --- governor, tools --------------------------------------------------------------
  const governor = createGovernor({ maxLanes: config.maxConcurrentAgents, bus, audit });
  const tools = createToolRegistry({ bus, audit, governor, policy: config.toolPolicy as ToolPolicy, maxDelegationDepth: config.maxDelegationDepth });
  registerBuiltinTools({
    registry: tools,
    root,
    index,
    memory,
    journal,
    outputDirFor,
    graph,
    ...(config.testCommand ? { testCommand: config.testCommand } : {}),
    ...(config.deployCommand ? { deployCommand: config.deployCommand } : {}),
    ...(config.procTimeoutMs ? { procTimeoutMs: config.procTimeoutMs } : {}),
  });
  const hashesFile = join(dataDir, "mcp-approved.json");
  const mcp = createMcpManager({ registry: tools, graph, bus, approvedHashes: readHashes(hashesFile) });

  // --- Claude or offline --------------------------------------------------------------
  const llm: LLMProvider | null =
    deps.llm !== undefined
      ? deps.llm
      : config.useClaude && hasClaudeCredentials(deps.env ?? process.env)
        ? createAnthropicProvider({ model: config.model, effort: config.effort, onProviderOutcome: (o) => governor.reportProvider(o) })
        : null;
  const meter = (provider: LLMProvider, instanceId: string, priority: "low" | "normal" | "high" | "urgent") =>
    meterProvider(provider, {
      beforeCall: (signal) => governor.admit(instanceId, priority, signal),
      afterCall: (usage) => governor.charge(instanceId, usage),
    });

  // --- workspaces, agents, intents ------------------------------------------------------
  const workspaces = createWorkspaceGenerator({ db, graph, bus, root, dataDir, index, memory });
  let stopping = false;
  let halted = false;
  let haltReason = "";

  /** Full replace of a stored workspace (fields the new value lacks are removed). */
  function saveWorkspace(ws: Workspace): void {
    if (stopping) return; // an interrupted plan stays "running" so the next start resumes it
    workspaces.update(ws.id, { ...ws, error: ws.error, completedAt: ws.completedAt, report: ws.report });
  }

  const orchestrator = createOrchestrator({
    bus,
    graph,
    memory,
    tools,
    llm,
    index,
    root,
    governor,
    maxDelegationDepth: config.maxDelegationDepth,
    userId: config.userId,
    budgetFor: () => ({ ...config.budget }),
    getWorkspace: (id) => workspaces.get(id),
    saveWorkspace,
    ...(llm ? { meter } : {}),
    effort: config.effort,
  });

  const intents = createIntentEngine({
    llm: llm ? meter(llm, "intent-engine", "high") : null,
    index,
    memory,
    tools,
    bus,
    agents: () => orchestrator.catalog(),
  });

  // --- background work --------------------------------------------------------------------
  const inflight = new Set<Promise<unknown>>();
  function track<T>(p: Promise<T>): Promise<T> {
    inflight.add(p);
    p.then(
      () => inflight.delete(p),
      () => inflight.delete(p),
    );
    return p;
  }
  const runs = new Map<string, Promise<Workspace>>();

  function log(level: "info" | "warn" | "error", message: string, extra: Record<string, unknown> = {}) {
    bus.publish("kernel.log", { level, message, ...extra }, { source: "kernel" });
  }

  function human(workspaceId?: string): Principal {
    return { userId: config.userId, chain: [`user:${config.userId}`], depth: 0, ...(workspaceId ? { workspaceId } : {}) };
  }

  function assertRunning() {
    if (halted) throw new KernelHaltedError(haltReason);
    if (stopping) throw new ConflictError("Kernel is stopping");
  }

  function startWorkspace(id: string, resume = false): { workspace: Workspace; done: Promise<Workspace> } {
    const existing = runs.get(id);
    const current = workspaces.get(id);
    if (!current) throw new NotFoundError(`No workspace "${id}"`);
    if (existing) return { workspace: current, done: existing };
    assertRunning();
    if (current.status === "archived") throw new ConflictError(`Workspace ${id} is archived`);
    const patch: Partial<Workspace> = { status: "running", error: undefined };
    if (current.status === "completed") Object.assign(patch, { checkpoint: { completedSteps: {} }, report: undefined, completedAt: undefined });
    const ws = workspaces.update(id, patch);
    if (resume) log("info", `workspace ${id} ${RESUME_REASON}: ${Object.keys(ws.checkpoint.completedSteps).length} finished step(s) will be skipped`, { workspaceId: id });
    const done = track(
      (async (): Promise<Workspace> => {
        try {
          await orchestrator.runPlan(ws);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!stopping) {
            const failed = workspaces.update(id, { status: "failed", error: message, completedAt: new Date().toISOString() });
            bus.publish("workspace.failed", { workspace: failed, workspaceId: id, error: message }, { source: "kernel", correlationId: id });
          }
        } finally {
          runs.delete(id);
        }
        return workspaces.get(id) ?? ws;
      })(),
    );
    runs.set(id, done);
    return { workspace: ws, done };
  }

  function startAgent(agentId: string, task: string, opts: { files?: string[]; workspaceId?: string } = {}) {
    assertRunning();
    if (!orchestrator.definition(agentId)) throw new NotFoundError(`Unknown agent "${agentId}"`);
    if (opts.workspaceId && !workspaces.get(opts.workspaceId)) throw new NotFoundError(`No workspace "${opts.workspaceId}"`);
    const instance = orchestrator.spawn(agentId, { task, ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}) });
    const done = track(orchestrator.assign(instance.instanceId, task, opts.files ? { files: opts.files } : {}));
    return { instance, done };
  }

  async function submitIntent(text: string, opts: { run?: boolean } = {}) {
    const run = opts.run ?? true;
    if (!text || !text.trim()) throw Object.assign(new Error("Intent text is required"), { status: 400 });
    if (run) assertRunning();
    const intent = await intents.process(text.trim());
    const workspace = await workspaces.generate(intent);
    if (!run) return { workspace, done: Promise.resolve(workspace) };
    const started = startWorkspace(workspace.id);
    started.done.catch(() => undefined);
    return started;
  }

  // --- triggers -------------------------------------------------------------------------------
  const executor: TriggerExecutor = async (action, event, rule) => {
    if (halted || stopping) return;
    const data = (event.data ?? {}) as Record<string, unknown>;
    if (action.kind === "run_agent") {
      const triggerDepth = typeof data.triggerDepth === "number" ? data.triggerDepth : 1;
      const triggeredBy = typeof data.triggeredBy === "string" ? data.triggeredBy : `rule:${rule.id}`;
      const path = typeof data.path === "string" ? data.path : undefined;
      // The parent is whoever caused the event: the finished agent instance for chain hops, else the human.
      const parentInstance = typeof data.instanceId === "string" ? orchestrator.instance(data.instanceId) : undefined;
      const base = parentInstance?.principal ?? human();
      const parent: Principal = { userId: base.userId, chain: [...base.chain], depth: triggerDepth - 1 };
      await track(
        orchestrator.runAgent(action.agentId, action.task, {
          triggeredBy,
          triggerDepth,
          parent,
          ...(path ? { path, files: [path] } : {}),
        }),
      );
    } else if (action.kind === "intent") {
      const { done } = await submitIntent(action.text, { run: true });
      await done;
    }
  };
  const triggers = createTriggerEngine({
    bus,
    executor,
    rules: config.triggers ? DEFAULT_TRIGGER_RULES : [],
    maxDepth: config.maxDelegationDepth,
  });

  const watcher = config.watch ? createFileWatcher({ root, index, bus }) : undefined;
  const detachMemoryAgent = attachMemoryAgent({ bus, memory, graph });

  // Deployments: proc.deploy results become deployment.* events.
  const unsubDeploy = bus.subscribe("tool.result", (event) => {
    const d = (event.data ?? {}) as { name?: string; ok?: boolean; outcome?: string; error?: string; instanceId?: string };
    if (d.name !== "proc.deploy" || (d.outcome !== "ok" && d.outcome !== "error")) return;
    bus.publish(d.ok ? "deployment.succeeded" : "deployment.failed", { tool: d.name, error: d.error, instanceId: d.instanceId }, { source: "kernel", correlationId: event.correlationId });
  });
  const unsubMcp = bus.subscribe("mcp.connected", () => persistHashes());

  // --- workflows ----------------------------------------------------------------------------
  let workflowList: WorkflowDefinition[] = [];
  const workflowErrors: string[] = [];

  function projectNode() {
    return graph.findNodes({ type: "project", limit: 1 })[0];
  }

  function defaultWorkflowFiles(): string[] {
    return graph
      .findNodes({ type: "file" })
      .filter((n) => n.props.kind === "code" || n.props.kind === "test")
      .map((n) => String(n.props.path))
      .sort()
      .slice(0, 50);
  }

  async function runWorkflow(id: string): Promise<{ workspaces: string[]; instances: string[] }> {
    const wf = workflowList.find((w) => w.id === id);
    if (!wf) throw new NotFoundError(`No workflow "${id}"`);
    assertRunning();
    const out = { workspaces: [] as string[], instances: [] as string[] };
    bus.publish("kernel.log", { level: "info", message: `workflow ${wf.name} started`, workflowId: wf.id }, { source: `workflow:${wf.id}` });
    for (const step of wf.steps) {
      if (halted || stopping) break;
      if (step.kind === "intent") {
        const { workspace, done } = await submitIntent(step.text, { run: true });
        out.workspaces.push(workspace.id);
        await done;
      } else {
        const { instance, done } = startAgent(step.agentId, step.task, { files: step.files ?? defaultWorkflowFiles() });
        out.instances.push(instance.instanceId);
        await done;
      }
    }
    bus.publish("kernel.log", { level: "info", message: `workflow ${wf.name} finished`, workflowId: wf.id, ...out }, { source: `workflow:${wf.id}` });
    return out;
  }

  // --- MCP persistence ------------------------------------------------------------------------
  function persistHashes() {
    try {
      writeFileSync(hashesFile, `${JSON.stringify(mcp.approvedHashes(), null, 2)}\n`, "utf8");
    } catch (err) {
      log("warn", `could not persist MCP tool hashes: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // --- radial -----------------------------------------------------------------------------------
  let kernel!: NeuralKernel;
  const radial = createRadial({
    config,
    graph,
    index,
    memory,
    tools,
    orchestrator,
    workspaces,
    journal,
    governor,
    bus,
    llm,
    human,
    submitIntent: (text, opts) => submitIntent(text, opts),
    runWorkspace: (id) => startWorkspace(id).done,
    startAgent,
    undoWorkspace: (id) => kernel.undoWorkspace(id),
    archiveWorkspace: (id) => kernel.archiveWorkspace(id),
    workflows: () => workflowList,
    runWorkflow: (id) => track(runWorkflow(id)),
  });

  // --- status -----------------------------------------------------------------------------------
  const startedAt = new Date().toISOString();
  let chainCache: { head: number; ok: boolean } | undefined;
  function auditSummary(): { entries: number; chainOk: boolean } {
    const head = audit.list({ limit: 1 })[0]?.seq ?? 0;
    if (!chainCache || chainCache.head !== head) chainCache = { head, ok: audit.verify() === null };
    return { entries: head, chainOk: chainCache.ok };
  }

  kernel = {
    config,
    bus,
    graph,
    memory,
    index,
    tools,
    mcp,
    llm,
    intents,
    orchestrator,
    workspaces,
    triggers,
    governor,
    audit,
    journal,
    radial,
    get workflowErrors() {
      return [...workflowErrors];
    },

    async start() {
      bus.publish("kernel.log", { level: "info", message: `starting on ${root}` }, { source: "kernel" });
      try {
        await seedMemoryFromRoot({ root, memory });
      } catch (err) {
        log("warn", `memory seeding failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      await index.indexAll();
      const project = projectNode();
      for (const def of AGENT_CATALOG) {
        graph.upsertNode({ id: `agent:${def.id}`, type: "agent", name: def.name, props: { agentId: def.id, group: def.group, role: def.role } });
      }
      if (project) {
        for (const node of graph.findNodes({ type: "mcp" })) {
          if (node.id.startsWith("mcp:builtin-")) graph.link(project.id, node.id, "uses_tool");
        }
      }
      const loaded = loadWorkflows({ root, knownAgent: (id) => Boolean(orchestrator.definition(id)), graph, projectId: project?.id });
      workflowList = loaded.workflows;
      workflowErrors.splice(0, workflowErrors.length, ...loaded.errors);
      for (const e of loaded.errors) log("warn", `workflow skipped: ${e}`);

      await Promise.all(
        Object.entries(config.mcpServers).map(async ([name, cfg]) => {
          const status = await mcp.connect(name, cfg);
          if (status.status === "error") log("warn", `MCP server ${name} did not connect: ${status.error ?? "unknown error"}`);
        }),
      );
      persistHashes();

      if (config.triggers) triggers.start();
      if (watcher) await watcher.start();

      // Crash recovery: plans that were running when the last process stopped resume from their checkpoint.
      for (const ws of deps.resume === false ? [] : workspaces.list()) {
        if (ws.status === "running") {
          try {
            startWorkspace(ws.id, true).done.catch(() => undefined);
          } catch (err) {
            log("warn", `could not resume ${ws.id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
      bus.publish("kernel.started", { root, mode: llm ? "claude" : "offline", model: llm?.model ?? config.model, version: KERNEL_VERSION }, { source: "kernel" });
    },

    halt(reason: string) {
      const why = String(reason ?? "").trim() || "halted by the user";
      halted = true;
      haltReason = why;
      tools.setHalted(true);
      triggers.stop();
      const terminated = orchestrator.terminateAll(`halted: ${why}`);
      audit.append({ kind: "halt", principal: human(), subject: "kernel", outcome: "info", detail: { reason: why, terminated } });
      bus.publish("kernel.halted", { reason: why, terminated }, { source: "kernel" });
    },

    resume() {
      if (!halted) return;
      halted = false;
      haltReason = "";
      tools.setHalted(false);
      if (config.triggers) triggers.start();
      audit.append({ kind: "resume", principal: human(), subject: "kernel", outcome: "info", detail: {} });
      bus.publish("kernel.resumed", {}, { source: "kernel" });
    },

    async undoWorkspace(id: string) {
      if (!workspaces.get(id)) throw new NotFoundError(`No workspace "${id}"`);
      const result = await journal.undo({ workspaceId: id });
      audit.append({ kind: "undo", principal: human(id), subject: id, outcome: result.skipped.length ? "error" : "ok", detail: { ...result } });
      return result;
    },

    async stop() {
      if (stopping) return;
      stopping = true;
      try {
        await watcher?.stop();
      } catch {
        // stopping anyway
      }
      triggers.stop();
      orchestrator.terminateAll("kernel stopping");
      const settle = Promise.allSettled([...inflight]);
      await Promise.race([settle, new Promise((r) => setTimeout(r, STOP_WAIT_MS).unref?.())]);
      persistHashes();
      try {
        await mcp.closeAll();
      } catch {
        // servers may already be gone
      }
      unsubDeploy();
      unsubMcp();
      detachMemoryAgent();
      bus.publish("kernel.stopped", {}, { source: "kernel" });
      await bus.drain();
      bus.close();
      db.close();
    },

    status(): KernelStatus {
      const all = workspaces.list();
      const project = projectNode();
      return {
        version: KERNEL_VERSION,
        root,
        ...(project ? { projectName: project.name } : {}),
        mode: llm ? "claude" : "offline",
        model: llm?.model ?? config.model,
        startedAt,
        graph: graph.stats(),
        files: index.fileCount(),
        agents: { catalog: orchestrator.catalog().length, running: orchestrator.instances({ state: ["summoned", "active", "collaborating"] }).length },
        workspaces: { total: all.length, running: all.filter((w) => w.status === "running").length },
        mcp: mcp.status(),
        pendingApprovals: tools.approvals("pending").length,
        toolPolicy: tools.policy().mode,
        halted,
        governor: governor.snapshot(),
        audit: auditSummary(),
      };
    },

    submitIntent,
    runWorkspace: (id: string) => startWorkspace(id).done,
    startWorkspace: (id: string) => startWorkspace(id),
    startAgent,
    startWorkflow: (id: string) => {
      if (!workflowList.some((w) => w.id === id)) throw new NotFoundError(`No workflow "${id}"`);
      assertRunning();
      const p = track(runWorkflow(id));
      p.catch((err) => log("warn", `workflow ${id} failed: ${err instanceof Error ? err.message : String(err)}`));
      return p;
    },

    radialActions(nodeId: string): { kind: RadialKind; actions: RadialAction[] } {
      return radial.actions(nodeId);
    },
    radialAction(nodeId: string, actionId: string, input?: Record<string, unknown>): Promise<RadialResult> {
      return radial.run(nodeId, actionId, input);
    },
    workflows: () => workflowList.map((w) => structuredClone(w)),
    runWorkflow: (id: string) => track(runWorkflow(id)),

    isHalted: () => halted,
    human,

    archiveWorkspace(id: string) {
      const ws = workspaces.get(id);
      if (!ws) return undefined;
      if (ws.status === "running") throw new ConflictError(`Workspace ${id} is still running`);
      orchestrator.archiveWorkspace(id);
      return workspaces.archive(id);
    },

    confirmMemory(id: string) {
      const before = memory.get(id);
      const record = memory.confirm(id);
      audit.append({
        kind: "memory_confirm",
        principal: human(),
        subject: id,
        outcome: record ? "ok" : "error",
        detail: record ? { category: record.category, key: record.key, proposedBy: before?.source } : { error: "no such proposed record" },
      });
      return record;
    },

    resolveApproval(id: string, approved: boolean) {
      return tools.resolveApproval(id, approved);
    },

    setPolicy(policy: ToolPolicy) {
      tools.setPolicy(policy);
      return tools.policy();
    },

    setTriggerEnabled(id: string, enabled: boolean) {
      const rule = triggers.setEnabled(id, enabled);
      if (rule) audit.append({ kind: "policy", principal: human(), subject: `trigger:${id}`, outcome: "info", detail: { enabled } });
      return rule;
    },

    async connectMcp(name: string, cfg: McpServerConfig) {
      const status = await mcp.connect(name, cfg);
      persistHashes();
      const project = projectNode();
      if (project && graph.getNode(`mcp:${name}`)) {
        try {
          graph.link(project.id, `mcp:${name}`, "uses_tool");
        } catch {
          // cosmetic
        }
      }
      return status;
    },

    async disconnectMcp(name: string) {
      const known = mcp.status().some((s) => s.name === name);
      if (!known) return false;
      await mcp.disconnect(name);
      persistHashes();
      return true;
    },

    reapproveMcpTool(toolName: string) {
      const ok = mcp.reapprove(toolName);
      if (ok) {
        persistHashes();
        audit.append({ kind: "approval", principal: human(), subject: toolName, outcome: "allowed", detail: { via: "reapprove", hash: mcp.approvedHashes()[toolName] } });
      }
      return ok;
    },
  } as NeuralKernel;

  return kernel;
}

function readHashes(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return {};
  }
}

export { RadialError };

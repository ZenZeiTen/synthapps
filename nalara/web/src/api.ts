/**
 * Typed client for the kernel HTTP API (src/server/api-contract.ts).
 * Mutating requests carry `X-Nalara-Client: 1`; errors surface as ApiError with the server's message.
 */
import type {
  AgentDefinition,
  AgentInstance,
  AgentPerformance,
  ApprovalRequest,
  AuditEntry,
  ConceptInfo,
  FileKind,
  GovernorSnapshot,
  GraphSlice,
  IntentClassification,
  JournalEntry,
  KernelEvent,
  KernelStatus,
  McpServerConfig,
  McpServerStatus,
  MemoryCategory,
  MemoryRecord,
  NodeDetail,
  NodeType,
  RadialMenu,
  RadialResult,
  SearchHit,
  ToolAction,
  ToolDefinition,
  ToolPolicy,
  ToolResult,
  TriggerRule,
  WorkflowDefinition,
  Workspace,
  WorkspaceDetail,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Method = "GET" | "POST" | "PUT" | "DELETE";

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

const enc = encodeURIComponent;

async function request<T>(method: Method, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET") headers["X-Nalara-Client"] = "1";
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      credentials: "same-origin",
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new ApiError("Kernel unreachable", 0);
  }
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      if (!res.ok) throw new ApiError(text.slice(0, 200) || res.statusText, res.status);
      throw new ApiError("Malformed JSON from kernel", res.status);
    }
  }
  if (!res.ok) {
    const msg =
      parsed && typeof parsed === "object" && typeof (parsed as { error?: unknown }).error === "string"
        ? (parsed as { error: string }).error
        : res.statusText || `HTTP ${res.status}`;
    throw new ApiError(msg, res.status);
  }
  return parsed as T;
}

export const api = {
  status: (signal?: AbortSignal) => request<KernelStatus>("GET", "/api/status", undefined, signal),

  graph: (opts: { rootId?: string; depth?: number; types?: NodeType[]; limit?: number } = {}, signal?: AbortSignal) =>
    request<GraphSlice>(
      "GET",
      `/api/graph${qs({ rootId: opts.rootId, depth: opts.depth, types: opts.types?.join(","), limit: opts.limit })}`,
      undefined,
      signal,
    ),
  node: (id: string) => request<NodeDetail>("GET", `/api/nodes/${enc(id)}`),

  submitIntent: (text: string, run = true) => request<{ workspace: Workspace }>("POST", "/api/intents", { text, run }),
  classifyIntent: (text: string, signal?: AbortSignal) =>
    request<IntentClassification>("POST", "/api/intents/classify", { text }, signal),

  workspaces: () => request<Workspace[]>("GET", "/api/workspaces"),
  workspace: (id: string, signal?: AbortSignal) => request<WorkspaceDetail>("GET", `/api/workspaces/${enc(id)}`, undefined, signal),
  runWorkspace: (id: string) => request<{ workspace: Workspace }>("POST", `/api/workspaces/${enc(id)}/run`),
  archiveWorkspace: (id: string) => request<{ workspace: Workspace }>("POST", `/api/workspaces/${enc(id)}/archive`),
  undoWorkspace: (id: string) =>
    request<{ restored: string[]; skipped: { path: string; reason: string }[] }>("POST", `/api/workspaces/${enc(id)}/undo`),

  agents: () => request<AgentDefinition[]>("GET", "/api/agents"),
  instances: (workspaceId?: string) => request<AgentInstance[]>("GET", `/api/agents/instances${qs({ workspaceId })}`),
  runAgent: (agentId: string, body: { task: string; files?: string[]; workspaceId?: string }) =>
    request<{ instance: AgentInstance }>("POST", `/api/agents/${enc(agentId)}/run`, body),
  terminateInstance: (id: string) => request<{ ok: boolean }>("POST", `/api/agents/instances/${enc(id)}/terminate`),
  performance: () => request<AgentPerformance[]>("GET", "/api/agents/performance"),

  radial: (nodeId: string, signal?: AbortSignal) => request<RadialMenu>("GET", `/api/radial/${enc(nodeId)}`, undefined, signal),
  radialAction: (nodeId: string, actionId: string, input?: Record<string, unknown>) =>
    request<RadialResult>("POST", `/api/radial/${enc(nodeId)}/${enc(actionId)}`, input ? { input } : {}),

  search: (q: string, opts: { limit?: number; kind?: FileKind } = {}, signal?: AbortSignal) =>
    request<SearchHit[]>("GET", `/api/search${qs({ q, limit: opts.limit, kind: opts.kind })}`, undefined, signal),
  concepts: () => request<ConceptInfo[]>("GET", "/api/concepts"),
  fileContent: (path: string, signal?: AbortSignal) =>
    request<{ path: string; content: string; kind: FileKind }>("GET", `/api/files/content${qs({ path })}`, undefined, signal),

  /**
   * `includeProposed` is not in api-contract.ts; it is sent so a server that supports it returns proposed records
   * (the UI needs them for Confirm / Forget). A server that ignores it is still correct.
   */
  memory: (opts: { category?: MemoryCategory; q?: string; limit?: number; includeProposed?: boolean } = {}) =>
    request<MemoryRecord[]>(
      "GET",
      `/api/memory${qs({ category: opts.category, q: opts.q, limit: opts.limit, includeProposed: opts.includeProposed ? "true" : undefined })}`,
    ),
  remember: (body: { category: MemoryCategory; key: string; content: string; tags?: string[] }) =>
    request<MemoryRecord>("POST", "/api/memory", body),
  forget: (id: string) => request<{ ok: boolean }>("DELETE", `/api/memory/${enc(id)}`),
  confirmMemory: (id: string) => request<MemoryRecord>("POST", `/api/memory/${enc(id)}/confirm`),

  tools: (opts: { server?: string; action?: ToolAction } = {}) =>
    request<ToolDefinition[]>("GET", `/api/tools${qs({ server: opts.server, action: opts.action })}`),
  callTool: (name: string, input: Record<string, unknown>) => request<ToolResult>("POST", `/api/tools/${enc(name)}/call`, { input }),

  mcp: () => request<McpServerStatus[]>("GET", "/api/mcp"),
  connectMcp: (name: string, config: McpServerConfig) => request<McpServerStatus>("POST", "/api/mcp", { name, config }),
  disconnectMcp: (name: string) => request<{ ok: boolean }>("DELETE", `/api/mcp/${enc(name)}`),

  approvals: (status?: ApprovalRequest["status"]) => request<ApprovalRequest[]>("GET", `/api/approvals${qs({ status })}`),
  resolveApproval: (id: string, approved: boolean) => request<ApprovalRequest>("POST", `/api/approvals/${enc(id)}`, { approved }),

  policy: () => request<ToolPolicy>("GET", "/api/policy"),
  setPolicy: (policy: ToolPolicy) => request<ToolPolicy>("PUT", "/api/policy", policy),

  triggers: () => request<TriggerRule[]>("GET", "/api/triggers"),
  setTrigger: (id: string, enabled: boolean) => request<TriggerRule>("PUT", `/api/triggers/${enc(id)}`, { enabled }),

  workflows: () => request<WorkflowDefinition[]>("GET", "/api/workflows"),
  runWorkflow: (id: string) => request<{ started: true }>("POST", `/api/workflows/${enc(id)}/run`),

  halt: (reason: string) => request<KernelStatus>("POST", "/api/kernel/halt", { reason }),
  resume: () => request<KernelStatus>("POST", "/api/kernel/resume"),

  audit: (opts: { since?: number; limit?: number } = {}) =>
    request<{ entries: AuditEntry[]; chainBrokenAt: number | null }>("GET", `/api/audit${qs({ since: opts.since, limit: opts.limit })}`),
  journal: (workspaceId?: string) => request<JournalEntry[]>("GET", `/api/journal${qs({ workspaceId })}`),
  governor: () => request<GovernorSnapshot>("GET", "/api/governor"),

  events: (opts: { since?: number; limit?: number; correlationId?: string } = {}) =>
    request<KernelEvent[]>("GET", `/api/events${qs({ since: opts.since, limit: opts.limit, correlationId: opts.correlationId })}`),
};

export type ConnectionState = "connecting" | "open" | "reconnecting";

/**
 * SSE client for /api/events/stream. Reconnects with exponential backoff and resumes from the last seq it saw,
 * so no event is lost or duplicated across a reconnect.
 */
export function subscribeEvents(
  onEvent: (ev: KernelEvent) => void,
  onState: (s: ConnectionState) => void,
  opts: { since?: number } = {},
): () => void {
  let lastSeq = opts.since ?? 0;
  let es: EventSource | null = null;
  let closed = false;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (closed) return;
    onState(retry === 0 ? "connecting" : "reconnecting");
    es = new EventSource(`/api/events/stream${lastSeq > 0 ? `?since=${lastSeq}` : ""}`);
    es.onopen = () => {
      retry = 0;
      onState("open");
    };
    es.onmessage = (msg) => {
      let ev: KernelEvent;
      try {
        ev = JSON.parse(msg.data) as KernelEvent;
      } catch {
        return;
      }
      const seq = typeof ev.seq === "number" ? ev.seq : Number(msg.lastEventId) || 0;
      if (seq && seq <= lastSeq) return; // duplicate after reconnect
      if (seq) lastSeq = seq;
      onEvent(ev);
    };
    es.onerror = () => {
      // Take over reconnection so the resume point is our own `since`, not the browser's default retry.
      es?.close();
      es = null;
      if (closed) return;
      retry += 1;
      onState("reconnecting");
      const delay = Math.min(15000, 500 * 2 ** Math.min(retry, 5));
      timer = setTimeout(connect, delay);
    };
  };
  connect();
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    es?.close();
  };
}

/**
 * Typed client for the kernel HTTP API (src/server/api-contract.ts).
 * Mutating requests carry `X-Nalara-Client: 1`; errors surface as ApiError with the server's message.
 */
import type {
  TaskItem,
  InstalledApp,
  TerminalEvent,
  FileEntry,
  FileListing,
  Place,
  TrashItem,
  AssistantEvent,
  AssistantMessage,
  Conversation,
  AgentDefinition,
  ClaudeState,
  IntentPreview,
  AgentInstance,
  AgentPerformance,
  ApprovalRequest,
  AuditEntry,
  ConceptInfo,
  FileKind,
  GovernorSnapshot,
  GraphSlice,
  JournalEntry,
  KernelEvent,
  KernelStatus,
  McpServerConfig,
  McpServerStatus,
  MemoryCategory,
  MemoryRecord,
  NodeDetail,
  NodeType,
  FleetRecord,
  FleetTree,
  Observatory,
  RelayKind,
  RelayMessage,
  SecretInfo,
  StepReview,
  WorkQueue,
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
    /** Stable error code from the kernel's structured errors (e.g. "kernel_halted", "not_found"). */
    readonly code?: string,
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
    const code = parsed && typeof parsed === "object" && typeof (parsed as { code?: unknown }).code === "string" ? (parsed as { code: string }).code : undefined;
    throw new ApiError(msg, res.status, code);
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

  /** `offlineAnyway`: run the offline checks even when the intent needs Claude (otherwise 422 needs_claude). */
  submitIntent: (text: string, run = true, offlineAnyway = false) =>
    request<{ workspace: Workspace }>("POST", "/api/intents", { text, run, ...(offlineAnyway ? { offlineAnyway: true } : {}) }),
  classifyIntent: (text: string, signal?: AbortSignal) =>
    request<IntentPreview>("POST", "/api/intents/classify", { text }, signal),

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
  /** 501 restart_unavailable when this Nalara has no supervisor (then the user restarts it). */
  restart: () => request<{ restarting: true }>("POST", "/api/kernel/restart", {}),
  claude: () => request<ClaudeState>("GET", "/api/claude"),
  /** Checks the key with Anthropic first: 400 claude_key_rejected, 502 claude_unreachable. */
  setClaudeKey: (key: string) => request<{ saved: true; replaced: boolean; canRestart: boolean }>("PUT", "/api/claude/key", { key }),
  deleteClaudeKey: () => request<{ ok: boolean; canRestart: boolean }>("DELETE", "/api/claude/key"),
  resume: () => request<KernelStatus>("POST", "/api/kernel/resume"),

  audit: (opts: { since?: number; limit?: number } = {}) =>
    request<{ entries: AuditEntry[]; chainBrokenAt: number | null }>("GET", `/api/audit${qs({ since: opts.since, limit: opts.limit })}`),
  journal: (workspaceId?: string) => request<JournalEntry[]>("GET", `/api/journal${qs({ workspaceId })}`),
  governor: () => request<GovernorSnapshot>("GET", "/api/governor"),

  fleetTree: (workspaceId: string, signal?: AbortSignal) => request<FleetTree & { reviews: StepReview[] }>("GET", `/api/workspaces/${enc(workspaceId)}/tree`, undefined, signal),
  relay: (opts: { workspaceId?: string; instanceId?: string; kind?: RelayKind[]; since?: number; limit?: number } = {}, signal?: AbortSignal) =>
    request<RelayMessage[]>("GET", `/api/relay${qs({ workspaceId: opts.workspaceId, instanceId: opts.instanceId, kind: opts.kind?.join(","), since: opts.since, limit: opts.limit })}`, undefined, signal),
  fleetRecords: (opts: { workspaceId?: string; limit?: number } = {}) => request<FleetRecord[]>("GET", `/api/fleet/records${qs(opts)}`),
  observatory: (signal?: AbortSignal) => request<Observatory>("GET", "/api/observatory", undefined, signal),
  queue: (signal?: AbortSignal) => request<WorkQueue>("GET", "/api/queue", undefined, signal),
  secrets: () => request<SecretInfo[]>("GET", "/api/secrets"),
  setSecret: (name: string, value: string) => request<SecretInfo>("PUT", `/api/secrets/${enc(name)}`, { value }),
  deleteSecret: (name: string) => request<{ ok: boolean }>("DELETE", `/api/secrets/${enc(name)}`),

  events: (opts: { since?: number; limit?: number; correlationId?: string } = {}) =>
    request<KernelEvent[]>("GET", `/api/events${qs({ since: opts.since, limit: opts.limit, correlationId: opts.correlationId })}`),

  places: () => request<{ places: Place[]; suggested: { name: string; path: string }[] }>("GET", "/api/places"),
  addPlace: (path: string, name?: string) => request<Place>("POST", "/api/places", { path, ...(name ? { name } : {}) }),
  removePlace: (id: string) => request<{ ok: true }>("DELETE", `/api/places/${enc(id)}`),
  listFiles: (place: string, path: string, opts: { hidden?: boolean } = {}, signal?: AbortSignal) =>
    request<FileListing>("GET", `/api/files/list${qs({ place, path, hidden: opts.hidden ? 1 : undefined })}`, undefined, signal),
  readText: (place: string, path: string, signal?: AbortSignal) =>
    request<{ path: string; content: string; kind: FileKind }>("GET", `/api/files/content${qs({ path, place: place === "home" ? undefined : place })}`, undefined, signal),
  saveText: (place: string, path: string, content: string, mode: "create" | "overwrite" | "any" = "any") =>
    request<FileEntry>("PUT", "/api/files/content", { place, path, content, mode }),
  mkdir: (place: string, path: string) => request<FileEntry>("POST", "/api/files/mkdir", { place, path }),
  /** Creates a top-level folder of a place unless it exists (checked first, so no error response is logged). */
  ensureFolder: async (place: string, name: string) => {
    const top = await request<FileListing>("GET", `/api/files/list${qs({ place, path: "" })}`);
    if (!top.entries.some((e) => e.type === "dir" && e.name === name)) await request<FileEntry>("POST", "/api/files/mkdir", { place, path: name });
  },
  moveFile: (place: string, from: string, to: string) => request<FileEntry>("POST", "/api/files/move", { place, from, to }),
  copyFile: (place: string, from: string, to: string) => request<FileEntry>("POST", "/api/files/copy", { place, from, to }),
  trashFile: (place: string, path: string) => request<TrashItem>("POST", "/api/files/trash", { place, path }),
  openExternal: (place: string, path: string) => request<{ ok: true }>("POST", "/api/files/open", { place, path }),
  rawUrl: (place: string, path: string) => `/api/files/raw${qs({ place, path })}`,
  trash: () => request<TrashItem[]>("GET", "/api/trash"),
  restore: (id: string) => request<FileEntry>("POST", `/api/trash/${enc(id)}/restore`),
  purge: (id: string) => request<{ ok: true }>("DELETE", `/api/trash/${enc(id)}`),
  emptyTrash: () => request<{ removed: number }>("DELETE", "/api/trash"),

  assistant: () => request<{ online: boolean; mode: "claude" | "offline"; model: string }>("GET", "/api/assistant"),
  conversations: () => request<Conversation[]>("GET", "/api/assistant/conversations"),
  conversation: (id: string) => request<AssistantMessage[]>("GET", `/api/assistant/conversations/${enc(id)}`),
  deleteConversation: (id: string) => request<{ ok: true }>("DELETE", `/api/assistant/conversations/${enc(id)}`),
  ask: askAssistant,

  terminal: () => request<{ shell: string; home: string; running: string[] }>("GET", "/api/terminal"),
  run: runCommand,
  terminalInput: (id: string, text: string) => request<{ ok: true }>("POST", `/api/terminal/${enc(id)}/input`, { text }),
  terminalKill: (id: string) => request<{ ok: true }>("POST", `/api/terminal/${enc(id)}/kill`),
  tasks: () => request<TaskItem[]>("GET", "/api/tasks"),
  addTask: (input: { title: string; notes?: string; due?: string | null }) => request<TaskItem>("POST", "/api/tasks", input),
  updateTask: (id: string, patch: { title?: string; notes?: string; due?: string | null; done?: boolean }) => request<TaskItem>("PUT", `/api/tasks/${enc(id)}`, patch),
  deleteTask: (id: string) => request<{ ok: true }>("DELETE", `/api/tasks/${enc(id)}`),
  installedApps: (q?: string) => request<InstalledApp[]>("GET", `/api/launcher${qs({ q })}`),
  refreshApps: () => request<InstalledApp[]>("POST", "/api/launcher/refresh"),
  launchApp: (id: string) => request<InstalledApp>("POST", "/api/launcher/launch", { id }),
};

/** POSTs JSON and reads an NDJSON response, one event per line. Errors before the stream starts throw ApiError. */
async function streamNdjson<E>(path: string, body: unknown, onEvent: (ev: E) => void, signal?: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson", "X-Nalara-Client": "1" },
      body: JSON.stringify(body),
      signal,
      credentials: "same-origin",
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new ApiError("Kernel unreachable", 0);
  }
  if (!res.ok || !res.body) {
    let msg = res.statusText || `HTTP ${res.status}`;
    let code: string | undefined;
    try {
      const b = (await res.json()) as { error?: string; code?: string };
      msg = b.error ?? msg;
      code = b.code;
    } catch {
      /* not JSON */
    }
    throw new ApiError(msg, res.status, code);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const handle = (line: string) => {
    if (!line.trim()) return;
    try {
      onEvent(JSON.parse(line) as E);
    } catch {
      /* a malformed line is skipped */
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      handle(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  handle(buffer + decoder.decode());
}

/**
 * POST /api/assistant/ask: calls `onEvent` for each streamed event and resolves with the saved answer.
 * Aborting the signal stops the answer on the kernel too.
 */
export async function askAssistant(
  text: string,
  opts: { conversationId?: string; signal?: AbortSignal; onEvent: (ev: AssistantEvent) => void },
): Promise<AssistantMessage | undefined> {
  let answer: AssistantMessage | undefined;
  await streamNdjson<AssistantEvent>(
    "/api/assistant/ask",
    { text, ...(opts.conversationId ? { conversationId: opts.conversationId } : {}) },
    (ev) => {
      if (ev.type === "done") answer = ev.message;
      opts.onEvent(ev);
    },
    opts.signal,
  );
  return answer;
}

/** POST /api/terminal/run: streams the command's output. Aborting the signal stops the command. */
export function runCommand(command: string, cwd: string | undefined, onEvent: (ev: TerminalEvent) => void, signal?: AbortSignal): Promise<void> {
  return streamNdjson<TerminalEvent>("/api/terminal/run", { command, ...(cwd ? { cwd } : {}) }, onEvent, signal);
}

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

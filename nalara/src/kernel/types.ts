/**
 * Nalara shared contracts.
 *
 * Every component codes against these interfaces. A change here is a change to
 * the whole system: keep it backwards compatible or update every implementer.
 * The section numbers refer to DESIGN.md.
 */

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

/** A JSON Schema object (draft 2020-12 subset) with `type: "object"` at the root. */
export interface JsonSchemaObject {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean | Record<string, unknown>;
  description?: string;
  [key: string]: unknown;
}

export type Unsubscribe = () => void;

// ---------------------------------------------------------------------------
// Knowledge graph (DESIGN.md 3.4)
// ---------------------------------------------------------------------------

export const NODE_TYPES = [
  "file",
  "folder",
  "agent",
  "mcp",
  "repository",
  "database",
  "meeting",
  "prompt",
  "task",
  "project",
  "workflow",
  "workspace",
  "memory",
  "concept",
  "output",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const EDGE_KINDS = [
  "contains", // folder/project -> file, workspace -> resource
  "imports", // file -> file (code import)
  "references", // file -> file (doc mentions another file)
  "about", // file -> concept
  "uses_tool", // agent/workspace -> mcp
  "assigned_to", // agent -> workspace
  "produced", // agent/workspace -> output
  "member_of", // file -> workspace
  "relates_to", // generic
  "depends_on", // task -> task
  "triggered", // event source -> agent run
] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  props: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  props: Record<string, unknown>;
  createdAt: string;
}

export interface NodeQuery {
  type?: NodeType | NodeType[];
  /** Exact name match. */
  name?: string;
  /** Case-insensitive substring match on name. */
  nameContains?: string;
  /** Match a top-level prop by strict equality. */
  prop?: { key: string; value: unknown };
  limit?: number;
}

export interface EdgeQuery {
  nodeId?: string;
  direction?: "out" | "in" | "both";
  kind?: EdgeKind | EdgeKind[];
}

export interface KnowledgeGraph {
  /** Insert or update by id. Without an id, a new id is generated. Merges props on update. Emits node.created / node.updated. */
  upsertNode(input: { id?: string; type: NodeType; name: string; props?: Record<string, unknown> }): GraphNode;
  getNode(id: string): GraphNode | undefined;
  findNodes(query: NodeQuery): GraphNode[];
  /** Removes the node and every incident edge. Emits node.removed. */
  removeNode(id: string): boolean;
  /** Idempotent on (source, target, kind): returns the existing edge if present. Both nodes must exist. Emits edge.created for new edges. */
  link(source: string, target: string, kind: EdgeKind, props?: Record<string, unknown>): GraphEdge;
  /** Removes matching edges; returns how many. */
  unlink(source: string, target: string, kind?: EdgeKind): number;
  edges(query: EdgeQuery): GraphEdge[];
  /** Nodes reachable within `depth` hops (default 1), excluding the start node. */
  neighbors(id: string, opts?: { kind?: EdgeKind | EdgeKind[]; direction?: "out" | "in" | "both"; depth?: number }): GraphNode[];
  /** Node ids from `from` to `to` inclusive, ignoring edge direction, or null. */
  shortestPath(from: string, to: string, maxDepth?: number): string[] | null;
  /** A bounded slice for the canvas. With rootId: BFS from root to depth (default 2). Without: all nodes up to limit (default 500). */
  subgraph(opts?: { rootId?: string; depth?: number; types?: NodeType[]; limit?: number }): { nodes: GraphNode[]; edges: GraphEdge[] };
  stats(): { nodes: number; edges: number; byType: Record<string, number> };
}

// ---------------------------------------------------------------------------
// Events (DESIGN.md 10)
// ---------------------------------------------------------------------------

export const EVENT_TYPES = [
  "kernel.started",
  "kernel.stopped",
  "kernel.log",
  "node.created",
  "node.updated",
  "node.removed",
  "edge.created",
  "file.created",
  "file.updated",
  "file.deleted",
  "intent.received",
  "intent.classified",
  "workspace.generated",
  "workspace.started",
  "workspace.completed",
  "workspace.failed",
  "workspace.archived",
  "agent.summoned",
  "agent.state",
  "agent.message",
  "agent.finished",
  "agent.failed",
  "task.assigned",
  "task.completed",
  "tool.called",
  "tool.result",
  "tool.approval_requested",
  "tool.approval_resolved",
  "mcp.connected",
  "mcp.disconnected",
  "memory.updated",
  "trigger.fired",
  "deployment.succeeded",
  "deployment.failed",
  "workspace.checkpoint",
  "kernel.halted",
  "kernel.resumed",
  "budget.exceeded",
  "journal.undone",
  "relay.message",
  "review.round",
  "review.verdict",
  "secret.changed",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Display names used by the UI, matching the spec's wording where it has one. */
export const EVENT_LABELS: Partial<Record<EventType, string>> = {
  "node.created": "Node Created",
  "file.updated": "File Updated",
  "file.created": "File Created",
  "file.deleted": "File Deleted",
  "agent.finished": "Agent Finished",
  "mcp.connected": "MCP Connected",
  "workspace.generated": "Workspace Generated",
  "deployment.succeeded": "Deployment Succeeded",
  "intent.classified": "Intent Classified",
  "agent.summoned": "Agent Summoned",
  "trigger.fired": "Agent Triggered",
  "workspace.completed": "Workspace Completed",
  "tool.approval_requested": "Approval Requested",
  "memory.updated": "Memory Updated",
  "relay.message": "Relay Message",
  "review.verdict": "Review Verdict",
};

export interface KernelEvent<T = unknown> {
  id: string;
  /** Monotonic per bus, starting at 1. */
  seq: number;
  type: EventType;
  ts: string;
  source: string;
  /** Usually the workspace id the event belongs to. */
  correlationId?: string;
  data: T;
}

/** An exact type, "*" for everything, or a prefix pattern like "agent.*". */
export type EventPattern = EventType | "*" | `${string}.*`;

export interface EventBus {
  publish<T>(type: EventType, data: T, opts?: { source?: string; correlationId?: string }): KernelEvent<T>;
  /** Handlers run after publish returns (microtask). A throwing handler never breaks the bus; it is reported as kernel.log. */
  subscribe(pattern: EventPattern, handler: (event: KernelEvent) => void | Promise<void>): Unsubscribe;
  history(query?: { sinceSeq?: number; types?: EventPattern[]; correlationId?: string; limit?: number }): KernelEvent[];
  waitFor(pattern: EventPattern, predicate?: (event: KernelEvent) => boolean, timeoutMs?: number): Promise<KernelEvent>;
  /** Resolves when every handler started so far has settled. For tests and shutdown. */
  drain(): Promise<void>;
  close(): void;
}

export interface TriggerRule {
  id: string;
  name: string;
  on: EventType;
  when?: {
    /** Glob against data.path (file events). Supports *, **, ? and {a,b}. */
    pathGlob?: string;
    /** Match data.agentId (agent events). */
    agentId?: string;
    /** Only fire when the event itself came from this trigger chain (data.triggeredBy starts with this rule id prefix). */
    triggeredBy?: string;
  };
  then: TriggerAction;
  enabled: boolean;
  /** Collapse bursts: fire once per key within this window. Default 1500 ms for file events, 0 otherwise. */
  debounceMs?: number;
}

export type TriggerAction =
  | { kind: "run_agent"; agentId: string; task: string }
  | { kind: "emit"; type: EventType; data?: Record<string, unknown> }
  | { kind: "intent"; text: string };

/**
 * Executes a trigger action. `task`/`text` have {{path}}, {{agentId}}, {{summary}} placeholders already filled.
 * Only run_agent and intent actions reach the executor; emit actions are published by the engine itself.
 * The event passed in is a copy whose data carries TriggerContext (triggeredBy = "rule:<id>", triggerDepth = depth of the new run).
 */
export type TriggerExecutor = (action: TriggerAction, event: KernelEvent, rule: TriggerRule) => Promise<void>;

/**
 * Chain fields. The executor receives them on event.data; agent.finished / agent.failed events for a triggered
 * run MUST echo them back (plus agentId, path, summary) or the chain stops and the depth limit cannot work.
 */
export interface TriggerContext {
  triggeredBy: string;
  triggerDepth: number;
  path?: string;
}

/** data of agent.finished and agent.failed. */
export interface AgentFinishedData {
  instanceId: string;
  agentId: string;
  workspaceId?: string;
  success: boolean;
  durationMs: number;
  summary: string;
  path?: string;
  triggeredBy?: string;
  triggerDepth?: number;
  error?: string;
}

export interface TriggerEngine {
  rules(): TriggerRule[];
  upsert(rule: TriggerRule): TriggerRule;
  setEnabled(id: string, enabled: boolean): TriggerRule | undefined;
  remove(id: string): boolean;
  start(): void;
  stop(): void;
}

// ---------------------------------------------------------------------------
// Memory (DESIGN.md 3.5)
// ---------------------------------------------------------------------------

export const MEMORY_CATEGORIES = [
  "preference",
  "project_history",
  "architecture_decision",
  "coding_standard",
  "translation_guide",
  "file_relationship",
  "agent_performance",
] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export interface MemoryRecord {
  id: string;
  category: MemoryCategory;
  /** Unique within a category. remember() upserts on (category, key). */
  key: string;
  content: string;
  data: Record<string, unknown>;
  tags: string[];
  /** "platform" for records written by kernel code, "user", or "agent:<agentId>#<instanceId>". */
  source: string;
  /**
   * Frozen-weights rule: records written by agents start as "proposed" and do not affect recall
   * (and so later runs) until a human confirms them. Platform and user records are "active".
   */
  status: "active" | "proposed";
  createdAt: string;
  updatedAt: string;
}

export interface AgentPerformance {
  agentId: string;
  runs: number;
  successes: number;
  failures: number;
  avgDurationMs: number;
  lastRunAt: string;
}

export interface MemoryService {
  remember(input: {
    category: MemoryCategory;
    key: string;
    content: string;
    data?: Record<string, unknown>;
    tags?: string[];
    /** Defaults to "platform". A source starting with "agent:" makes the record "proposed". */
    source?: string;
  }): MemoryRecord;
  get(id: string): MemoryRecord | undefined;
  /** Filters combine with AND. `text` ranks by token overlap with key, content and tags. Proposed records are excluded unless includeProposed. */
  recall(query?: { category?: MemoryCategory | MemoryCategory[]; key?: string; tags?: string[]; text?: string; limit?: number; includeProposed?: boolean }): MemoryRecord[];
  /** Human confirmation of a proposed record. */
  confirm(id: string): MemoryRecord | undefined;
  forget(id: string): boolean;
  /** Updates the agent_performance record for agentId (key = agentId). */
  recordAgentRun(agentId: string, outcome: { success: boolean; durationMs: number; workspaceId?: string }): AgentPerformance;
  performance(agentId?: string): AgentPerformance[];
}

// ---------------------------------------------------------------------------
// Semantic filesystem (DESIGN.md 9)
// ---------------------------------------------------------------------------

export type FileKind = "code" | "doc" | "test" | "config" | "data" | "other";

export interface SearchHit {
  /** Path relative to the kernel root, forward slashes. */
  path: string;
  /** Graph node id, always `file:<path>`. */
  nodeId: string;
  score: number;
  snippet: string;
  line?: number;
  kind: FileKind;
  mtimeMs: number;
  /** Human-readable reasons, e.g. "matches: damage, calculation", "recent", "imports inventory.ts". */
  reasons: string[];
}

export interface ConceptInfo {
  id: string; // concept:<slug>
  name: string; // e.g. "Combat System"
  files: string[];
}

export interface SemanticIndex {
  /** Walks the root and indexes every text file (skips .git, node_modules, .nalara, binaries, files > 1 MB). Also writes file/folder/concept nodes and imports/references/about edges into the graph. */
  indexAll(): Promise<{ files: number; ms: number }>;
  indexFile(relPath: string): Promise<void>;
  removeFile(relPath: string): void;
  /** Natural-language search. Understands recency ("latest"), kind filters ("design docs", "code", "tests") and relations ("related to X", "referencing X"). */
  search(query: string, opts?: { limit?: number; kind?: FileKind | FileKind[] }): SearchHit[];
  concepts(): ConceptInfo[];
  fileCount(): number;
  hasFile(relPath: string): boolean;
  kindOf(relPath: string): FileKind | undefined;
  /** Read a file under the root (throws on paths outside the root). */
  readFile(relPath: string): Promise<string>;
}

/** data of file.created, file.updated and file.deleted events. */
export interface FileEventData {
  path: string;
  kind: FileKind;
}

export interface FileWatcher {
  start(): Promise<void>;
  stop(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Tools and MCP (DESIGN.md 8)
// ---------------------------------------------------------------------------

export type ToolAction = "read" | "write" | "search" | "execute";

/**
 * Reversibility class (agent-os-architect primitive 4).
 * reversible: no lasting effect (reads, writes inside the workspace output dir, which is a scratch area).
 * compensable: a lasting effect the platform can undo from its action journal (overwriting a project file).
 * irreversible: cannot be undone by the platform (deploys, test runs with side effects, external MCP writes).
 */
export type Reversibility = "reversible" | "compensable" | "irreversible";

/** Where a tool's side effects land. */
export type ToolScope = "sandbox" | "tenant" | "external";

/**
 * Who is acting (primitive 8). Delegation, never impersonation: `chain` lists every hop from the human
 * down to the acting agent instance, e.g. ["user:local", "trigger:review-on-change", "agent:code_reviewer#ai_12"].
 */
export interface Principal {
  userId: string;
  agentId?: string;
  instanceId?: string;
  workspaceId?: string;
  chain: string[];
  /** Number of agent/trigger hops below the human. Bounded by config.maxDelegationDepth. */
  depth: number;
}

export interface ToolDefinition {
  /** Unique. Built-ins: "fs.read_file". MCP: "mcp.<server>.<tool>". Only [a-zA-Z0-9_.-]. */
  name: string;
  description: string;
  /** "builtin:fs", "builtin:git", "builtin:proc", "builtin:search", "builtin:memory" or "mcp:<server>". */
  server: string;
  action: ToolAction;
  reversibility: Reversibility;
  scope: ToolScope;
  inputSchema: JsonSchemaObject;
  /** sha256 of name+description+schema, set by the registry. MCP tools whose hash changes after approval are disabled. */
  hash?: string;
  /** Disabled tools stay listed but every call is denied. */
  disabled?: boolean;
  disabledReason?: string;
}

export interface ToolContext {
  /** Required for every call: the registry denies calls without a principal. */
  principal: Principal;
  /** Stable id for this logical call. The registry refuses to run an irreversible call twice with the same key (replay fencing). */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface ToolResult {
  ok: boolean;
  /** Text for the model / UI. Always set, also on failure. */
  content: string;
  data?: unknown;
  error?: string;
}

export type ToolHandler = (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

export interface ToolPolicy {
  /**
   * auto: reversible and compensable calls run; irreversible calls still need approval.
   * ask: compensable and irreversible calls need approval.
   * readonly: only read/search tools with reversibility "reversible" run.
   * Deny rules always win over allow rules and modes.
   */
  mode: "auto" | "ask" | "readonly";
  /** Tool-name globs that always run (after deny). */
  allow?: string[];
  /** Tool-name globs that never run. */
  deny?: string[];
  /** How long an approval waits before it expires as denied. Default 10 minutes. */
  approvalTimeoutMs?: number;
}

export interface ApprovalRequest {
  id: string;
  tool: string;
  action: ToolAction;
  reversibility: Reversibility;
  scope: ToolScope;
  input: Record<string, unknown>;
  principal: Principal;
  /** What will actually happen, described by the tool, e.g. the resolved shell command for proc.run_tests. */
  detail?: string;
  status: "pending" | "approved" | "denied" | "expired";
  createdAt: string;
  resolvedAt?: string;
}

export interface McpServerConfig {
  /** stdio servers */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** Streamable HTTP servers */
  url?: string;
  headers?: Record<string, string>;
}

export interface McpServerStatus {
  name: string;
  status: "connecting" | "connected" | "disconnected" | "error";
  transport: "stdio" | "http";
  tools: string[];
  error?: string;
  connectedAt?: string;
  /** Tools whose definition changed since the connection was first approved (disabled until re-approved). */
  changedTools?: string[];
}

export interface ToolRegistry {
  /** `preview` describes a concrete call for the approval prompt (for tools whose input does not show what will run). */
  register(def: ToolDefinition, handler: ToolHandler, opts?: { preview?: (input: Record<string, unknown>) => string }): void;
  unregister(name: string): boolean;
  get(name: string): ToolDefinition | undefined;
  /** `names` accepts globs ("fs.*"). */
  list(filter?: { server?: string; action?: ToolAction; names?: string[] }): ToolDefinition[];
  /**
   * The single enforcement point for tool use. In order: kernel halted? -> tool disabled? -> principal present and
   * depth within limit? -> tool within the principal's scope (agent tool globs) -> deny/allow rules -> policy mode and
   * reversibility (may wait for approval) -> input schema -> replay fence -> governor charge -> handler -> audit.
   * Emits tool.called and tool.result. Never throws for tool failures; returns ok:false.
   * Schema rejections are audited as "denied" (reason "invalid input"); handler failures as "error".
   */
  call(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
  /** Tool-name globs a principal may call; set by the orchestrator when it spawns an instance. No inheritance between instances. */
  setScope(instanceId: string, toolGlobs: string[]): void;
  clearScope(instanceId: string): void;
  /** Kill switch: while halted every non-read call is denied, pending approvals are denied, and non-read calls already running are aborted. */
  setHalted(halted: boolean): void;
  /** Disable or re-enable a tool (for example after an MCP tool definition changed). */
  setDisabled(name: string, disabled: boolean, reason?: string): void;
  policy(): ToolPolicy;
  setPolicy(policy: ToolPolicy): void;
  approvals(status?: ApprovalRequest["status"]): ApprovalRequest[];
  resolveApproval(id: string, approved: boolean): ApprovalRequest | undefined;
}

/** Append-only, hash-chained audit ledger outside every agent's write scope (primitive 10). */
export interface AuditEntry {
  seq: number;
  ts: string;
  kind: "tool_call" | "approval" | "halt" | "resume" | "undo" | "budget" | "memory_confirm" | "policy" | "relay" | "verdict" | "secret";
  principal: Principal | null;
  subject: string; // tool name, workspace id, ...
  outcome: "allowed" | "denied" | "ok" | "error" | "info";
  detail: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export interface AuditLog {
  append(entry: Omit<AuditEntry, "seq" | "ts" | "prevHash" | "hash">): AuditEntry;
  list(query?: { sinceSeq?: number; subject?: string; limit?: number }): AuditEntry[];
  /** Recomputes the chain; returns the first broken seq or null. */
  verify(): number | null;
}

/** Records compensable effects with a before-image so the platform can undo them (primitive 11). */
export interface JournalEntry {
  id: string;
  ts: string;
  tool: string;
  path: string;
  /** null when the file did not exist before. */
  before: string | null;
  after: string;
  principal: Principal;
  undone: boolean;
}

export interface ActionJournal {
  recordWrite(entry: { tool: string; path: string; before: string | null; after: string; principal: Principal }): JournalEntry;
  list(query?: { workspaceId?: string; instanceId?: string; includeUndone?: boolean }): JournalEntry[];
  /** Restores before-images newest first. Refuses (returns skipped) when the file changed since the write. */
  undo(query: { workspaceId?: string; entryId?: string }): Promise<{ restored: string[]; skipped: { path: string; reason: string }[] }>;
}

/** Per-instance budget (primitive 2). Every dimension is enforced by the platform, not the prompt. */
export interface AgentBudget {
  maxInputTokens: number;
  maxOutputTokens: number;
  maxToolCalls: number;
  maxTurns: number;
  maxWallMs: number;
  /** Abort when the same tool is called with identical input more than this many times in one run. */
  maxRepeatCalls: number;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  turns: number;
  wallMs: number;
}

export interface Governor {
  /**
   * Admission control: resolves when a model/agent lane is free for this priority. Call the returned release when done.
   * One instance must not hold a run lane while its metered model calls also wait for lanes (deadlock at 1 lane):
   * metered Claude runs admit per model call only; offline runs hold one lane for the whole run.
   */
  admit(instanceId: string, priority: Priority, signal?: AbortSignal): Promise<() => void>;
  setBudget(instanceId: string, budget: AgentBudget): void;
  /** Adds usage and returns the reason if a budget is now exceeded. */
  charge(instanceId: string, usage: Partial<AgentUsage> & { toolKey?: string }): { exceeded: false } | { exceeded: true; reason: string };
  usage(instanceId: string): AgentUsage;
  /** AIMD backpressure: rate-limit/overload errors halve the lane count, successes grow it back by one. Opens a circuit after repeated failures. */
  reportProvider(outcome: "ok" | "rate_limited" | "overloaded" | "error"): void;
  snapshot(): { lanes: number; maxLanes: number; running: number; queued: number; circuit: "closed" | "open" | "half_open" };
  release(instanceId: string): void;
  /** Fleet budgets (one fleet per workspace run). Starts a fresh run: usage counters reset to zero. */
  setFleetBudget?(fleetId: string, budget: FleetBudget): void;
  /** Counts an agent against its fleet and charges the instance's later usage to the fleet too. */
  assignFleet?(instanceId: string, fleetId: string): { exceeded: false } | { exceeded: true; reason: string };
  /** Charges fleet-only dimensions (relay messages). */
  chargeFleet?(fleetId: string, usage: { messages?: number }): { exceeded: false } | { exceeded: true; reason: string };
  fleetUsage?(fleetId: string): { budget?: FleetBudget; usage: FleetUsage; exceeded?: string } | undefined;
}

export interface McpManager {
  connect(name: string, config: McpServerConfig): Promise<McpServerStatus>;
  disconnect(name: string): Promise<void>;
  status(): McpServerStatus[];
  closeAll(): Promise<void>;
  /** Tool-definition hashes pinned at first sight, keyed by full tool name ("mcp.<server>.<tool>"). Persist to survive restarts. */
  approvedHashes(): Record<string, string>;
  /** Human re-approval of a tool whose definition changed: pins the new hash and re-enables it. */
  reapprove(toolName: string): boolean;
}

// ---------------------------------------------------------------------------
// LLM (Claude)
// ---------------------------------------------------------------------------

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AgentLoopEvent {
  type: "text" | "tool_call" | "tool_result" | "turn";
  text?: string;
  tool?: string;
  input?: Record<string, unknown>;
  result?: ToolResult;
  turn?: number;
}

export interface AgentLoopResult {
  text: string;
  turns: number;
  toolCalls: number;
  stopReason: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  complete(req: { system: string; prompt: string; maxTokens?: number; effort?: Effort; signal?: AbortSignal }): Promise<string>;
  /** Returns an object validated against `schema`. Throws LLMError if the model refuses or the output does not validate. */
  structured<T>(req: { system: string; prompt: string; schema: JsonSchemaObject; effort?: Effort; signal?: AbortSignal }): Promise<T>;
  /** Tool-use loop until the model stops calling tools, maxTurns (default 12) is hit, or the signal aborts. */
  runAgentLoop(req: {
    system: string;
    task: string;
    tools: ToolDefinition[];
    callTool: (name: string, input: Record<string, unknown>) => Promise<ToolResult>;
    maxTurns?: number;
    effort?: Effort;
    signal?: AbortSignal;
    onEvent?: (event: AgentLoopEvent) => void;
  }): Promise<AgentLoopResult>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly kind: "refusal" | "invalid_output" | "api" | "aborted" | "max_tokens" | "budget",
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "LLMError";
  }
}

// ---------------------------------------------------------------------------
// Intent engine (DESIGN.md 3.1)
// ---------------------------------------------------------------------------

export type Priority = "low" | "normal" | "high" | "urgent";

export interface PlanStep {
  id: string; // "s1", "s2", ...
  /** Agent catalog id, e.g. "code_reviewer". */
  agent: string;
  task: string;
  dependsOn: string[];
  /** Tool-name globs the step may use. */
  tools: string[];
}

export interface IntentClassification {
  /** snake_case intent class, e.g. "engineering_review". Matches schemas/intent.schema.json. */
  intent: string;
  required_agents: string[];
  required_tools: string[];
  confidence: number; // 0..1
  source: "claude" | "heuristic";
}

export interface IntentResult extends IntentClassification {
  id: string;
  text: string;
  /** Short title for the workspace, e.g. "Engineering review". */
  label: string;
  priority: Priority;
  entities: { files: string[]; topics: string[]; targetLanguage?: string };
  context: { files: SearchHit[]; memory: MemoryRecord[] };
  plan: PlanStep[];
  /** Generated resources the workspace should provide, e.g. "Glossary", "Style Guide", "Output Folder". */
  resources?: string[];
  createdAt: string;
}

export interface IntentEngine {
  /** Intent Classifier. */
  classify(text: string, opts?: { signal?: AbortSignal }): Promise<IntentClassification>;
  /** Classifier -> Enricher -> Context Loader -> Priority Engine -> Planner. Emits intent.received and intent.classified. */
  process(text: string, opts?: { signal?: AbortSignal }): Promise<IntentResult>;
  /** The intent classes the heuristic classifier knows. */
  catalog(): { intent: string; label: string; description: string; agents: string[]; tools: string[] }[];
}

// ---------------------------------------------------------------------------
// Agents (DESIGN.md 3.2, 6)
// ---------------------------------------------------------------------------

export type AgentGroup = "system" | "engineering" | "creative" | "business";

/** Matches schemas/agent.schema.json (the `agent` object) plus runtime extras. */
export interface AgentDefinition {
  id: string; // snake_case, e.g. "code_reviewer"
  name: string; // "Code Reviewer"
  role: string;
  group: AgentGroup;
  goals: string[];
  /** Tool-name globs the agent may call, e.g. ["fs.read_file", "fs.search_*", "git.*"]. */
  tools: string[];
  memory: MemoryCategory[];
  constraints: string[];
  /** Name of the offline skill used when no LLM is configured (see agents/skills). */
  offlineSkill: string;
}

export type AgentState =
  | "dormant"
  | "summoned"
  | "active"
  | "collaborating"
  | "completed"
  | "archived"
  | "failed"
  | "terminated";

export interface Finding {
  severity: "info" | "low" | "medium" | "high" | "critical";
  title: string;
  detail: string;
  file?: string;
  line?: number;
  /** Set by the platform's evidence check (src/fleet/evidence.ts), never by the agent. */
  evidence?: EvidenceStatus;
}

export interface AgentOutput {
  summary: string;
  findings: Finding[];
  /** Files the agent wrote, relative to the kernel root. */
  artifacts: { path: string; description: string }[];
  confidence: number; // 0..1
  source: "claude" | "offline";
  /** Set when the agent could not do its job offline (e.g. translation without Claude). */
  limitation?: string;
}

export interface AgentInstance {
  instanceId: string;
  agentId: string;
  name: string;
  workspaceId?: string;
  state: AgentState;
  task?: string;
  triggeredBy?: string;
  startedAt?: string;
  finishedAt?: string;
  output?: AgentOutput;
  error?: string;
  toolCalls: number;
  principal: Principal;
  budget: AgentBudget;
  usage: AgentUsage;
  /** Process tree: the instance this one was spawned for (builder of a critic, previous round of a builder, finished agent of a trigger hop). */
  parentInstanceId?: string;
  /** Plan step this instance works on. */
  stepId?: string;
  /** Adversarial round (1-based) for builders and critics. */
  round?: number;
  role?: FleetRole;
}

export interface CommanderReport {
  workspaceId: string;
  summary: string;
  outputs: { agentId: string; instanceId: string; output: AgentOutput }[];
  conflicts: { topic: string; agents: string[]; resolution: string }[];
  /** Merged, de-duplicated and ranked most severe first. */
  findings: Finding[];
  /** Markdown report written under the workspace output dir, relative to root. */
  artifactPath?: string;
  /** Adversarial review of builder steps: rounds, challenges and the verdict each step reached. */
  reviews?: StepReview[];
}

export interface Orchestrator {
  catalog(): AgentDefinition[];
  definition(agentId: string): AgentDefinition | undefined;
  instances(filter?: { workspaceId?: string; state?: AgentState | AgentState[]; agentId?: string }): AgentInstance[];
  instance(instanceId: string): AgentInstance | undefined;
  /** Spawn: creates an instance in state "summoned" and emits agent.summoned. */
  /** Only platform code (kernel, trigger engine) can spawn; agents have no spawn tool. `parent` extends the delegation chain; the child never inherits the parent's tool scope. Throws if depth > maxDelegationDepth. */
  spawn(agentId: string, opts?: { workspaceId?: string; task?: string; triggeredBy?: string; parent?: Principal; triggerDepth?: number; path?: string }): AgentInstance;
  /** Assign a task to a summoned instance and run it (active -> collaborating -> completed|failed). */
  assign(instanceId: string, task: string, opts?: { files?: string[]; step?: PlanStep }): Promise<AgentInstance>;
  /** Terminate: aborts a running instance and moves it to "terminated". */
  terminate(instanceId: string, reason?: string): boolean;
  /** spawn + assign. */
  runAgent(
    agentId: string,
    task: string,
    opts?: { workspaceId?: string; files?: string[]; triggeredBy?: string; parent?: Principal; triggerDepth?: number; path?: string },
  ): Promise<AgentInstance>;
  /**
   * Runs a plan as a DAG under the governor, then merges results through the Commander. Checkpoints after each step
   * (workspace.checkpoint); steps already in the checkpoint are not re-run, so a restarted kernel resumes instead of replaying.
   */
  runPlan(workspace: Workspace): Promise<CommanderReport>;
  /** Kill switch support: terminates every running instance. */
  terminateAll(reason: string): number;
  /** Moves every finished instance of a workspace to "archived". */
  archiveWorkspace(workspaceId: string): number;
}


// ---------------------------------------------------------------------------
// Fleet: process tree, relay, adversarial review, fleet memory (docs/orc-gap-analysis.md)
// ---------------------------------------------------------------------------

/** builder: a plan step whose agent produces artifacts and is attacked by critics. */
export type FleetRole = "worker" | "builder" | "critic" | "commander" | "triggered";

/** Durable process-tree node: one per agent instance, kept after the process exits. */
export interface FleetNode {
  instanceId: string;
  agentId: string;
  name: string;
  workspaceId?: string;
  parentInstanceId?: string;
  stepId?: string;
  round?: number;
  role: FleetRole;
  state: AgentState;
  chain: string[];
  depth: number;
  task?: string;
  /** First line of the output summary or the error. */
  summary?: string;
  usage: AgentUsage;
  createdAt: string;
  updatedAt: string;
}

/**
 * Kernel-relayed inter-agent message. Agents have no messaging tool: the orchestrator is the only sender, so every
 * hop is scheduled, budgeted (fleet maxMessages) and audited. Bodies that come from an agent are untrusted data.
 */
export type RelayKind = "spawn" | "handoff" | "challenge" | "verdict" | "result";

export interface RelayMessage {
  id: string;
  /** Monotonic per kernel. */
  seq: number;
  ts: string;
  workspaceId?: string;
  kind: RelayKind;
  /** "kernel" or the sending instance's address `agent:<agentId>#<instanceId>`. */
  from: string;
  /** An instance address, `step:<id>` or `commander`. */
  to: string;
  fromInstanceId?: string;
  toInstanceId?: string;
  stepId?: string;
  round?: number;
  /** Capped at 4000 characters. */
  body: string;
  /** Paths the message points at (artifacts under review, cited files). */
  refs: string[];
  data: Record<string, unknown>;
}

export interface RelayQuery {
  workspaceId?: string;
  instanceId?: string;
  kind?: RelayKind | RelayKind[];
  sinceSeq?: number;
  limit?: number;
}

/** verified: the cited file exists under the root and the cited line is inside it. none: nothing was cited. */
export type EvidenceStatus = "verified" | "unverified" | "none";

export interface Challenge {
  finding: Finding;
  criticId: string;
  criticInstanceId: string;
  round: number;
  evidence: EvidenceStatus;
  evidenceNote: string;
  /** Blocking challenges send the builder into another round: severity at or above the threshold, about the builder's own artifacts, with verified evidence. */
  blocking: boolean;
}

/** survived: the final round raised no blocking challenge. unresolved: rounds ran out with blocking challenges left. unreviewed: no critic could attack the work (no artifacts, critic failed, budget). */
export type Verdict = "survived" | "unresolved" | "unreviewed";

export interface StepReview {
  workspaceId: string;
  stepId: string;
  builderId: string;
  critics: string[];
  rounds: number;
  verdict: Verdict;
  reason: string;
  /** Blocking challenges still open at the end (empty when the work survived). */
  open: Challenge[];
  history: { round: number; builderInstanceId: string; criticInstanceIds: string[]; blocking: number; challenges: number }[];
}

export interface AdversarialConfig {
  enabled: boolean;
  /** Build/attack rounds per step, including the first. */
  maxRounds: number;
  /** Lowest severity that blocks convergence. */
  blockingSeverity: Finding["severity"];
  /** Builder agent id -> critic agent ids that attack its work. */
  critics: Record<string, string[]>;
}

/** Fleet memory: the durable result of one reviewed step, consulted by later fleets working on the same files. */
export interface FleetRecord {
  id: string;
  workspaceId: string;
  stepId: string;
  agentId: string;
  verdict: Verdict;
  rounds: number;
  files: string[];
  summary: string;
  open: { severity: Finding["severity"]; title: string; file?: string; line?: number }[];
  createdAt: string;
}

export interface FleetBudget {
  maxAgents: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxToolCalls: number;
  maxMessages: number;
}

export interface FleetUsage {
  agents: number;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  messages: number;
}

/** A workspace's process tree (GET /api/workspaces/:id/tree without reviews). */
export interface FleetTree {
  workspaceId: string;
  nodes: FleetNode[];
  /** parent -> child edges of the process tree. */
  edges: { parent: string; child: string }[];
  /** Instances whose parent is not part of this workspace's tree (plan steps, the Commander). */
  roots: string[];
}

export interface WorkspaceUsage {
  workspaceId: string;
  agents: number;
  byRole: Partial<Record<FleetRole, number>>;
  usage: AgentUsage;
  failed: number;
  lastActivity: string;
}

/** Telemetry for every fleet and agent (GET /api/observatory). */
export interface Observatory {
  generatedAt: string;
  totals: AgentUsage & { agents: number; workspaces: number; messages: number };
  fleetBudget: FleetBudget;
  workspaces: (WorkspaceUsage & { label: string; status: string; messages: number; reviews: { survived: number; unresolved: number; unreviewed: number }; fleet?: { usage: FleetUsage; exceeded?: string } })[];
  agents: { agentId: string; runs: number; failures: number; usage: AgentUsage }[];
  governor: ReturnType<Governor["snapshot"]>;
}

/** What is waiting or running, across every workspace (GET /api/queue). */
export interface WorkQueue {
  generatedAt: string;
  approvals: { id: string; tool: string; requestedBy: string; workspaceId?: string; createdAt: string; detail?: string }[];
  running: { instanceId: string; agentId: string; name: string; workspaceId?: string; state: string; role?: string; stepId?: string; round?: number; owner: string; startedAt?: string }[];
  workspaces: { id: string; label: string; status: string; owner: string; createdAt: string; steps: number; completedSteps: number }[];
  admission: { queued: number; running: number; lanes: number };
}

/** A stored secret as listed: never the value. */
export interface SecretInfo {
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Whether the value is long enough to be redacted from output. */
  redacted: boolean;
}

// ---------------------------------------------------------------------------
// Workspaces (DESIGN.md 3.3, 7)
// ---------------------------------------------------------------------------

export type WorkspaceStatus = "ready" | "running" | "completed" | "failed" | "archived";

export interface Workspace {
  id: string; // "ws_<n>" or random
  /** Graph node id: `workspace:<id>`. */
  nodeId: string;
  intentId: string;
  intent: string;
  label: string;
  text: string;
  priority: Priority;
  status: WorkspaceStatus;
  agents: string[];
  tools: string[];
  /** Files assembled into the workspace, relative paths. */
  files: string[];
  /** Other resources: memory keys, generated artifacts such as a glossary. */
  resources: string[];
  plan: PlanStep[];
  /** Relative to root, e.g. ".nalara/outputs/ws_3". */
  outputDir: string;
  createdAt: string;
  completedAt?: string;
  report?: CommanderReport;
  error?: string;
  /** Turn-aligned checkpoint: finished plan steps and their outputs. */
  checkpoint: {
    completedSteps: Record<
      string,
      {
        instanceId: string;
        agentId: string;
        output: AgentOutput;
        /** Critic outputs of the final review round (merged by the Commander with the builder's output). */
        critics?: { instanceId: string; agentId: string; output: AgentOutput }[];
        review?: StepReview;
      }
    >;
  };
}

export interface WorkspaceGenerator {
  /** Builds the workspace from an intent: graph node, member_of/uses_tool/assigned_to edges, output folder, generated resources. Emits workspace.generated. */
  generate(intent: IntentResult): Promise<Workspace>;
  get(id: string): Workspace | undefined;
  list(): Workspace[];
  update(id: string, patch: Partial<Workspace>): Workspace;
  archive(id: string): Workspace | undefined;
}

// ---------------------------------------------------------------------------
// Radial OS (DESIGN.md 5)
// ---------------------------------------------------------------------------

export type RadialKind = "root" | "agent" | "file" | "project" | "workspace" | "mcp" | "workflow" | "folder" | "concept" | "output";

export interface RadialAction {
  id: string; // "review", "attach_agent", ...
  label: string; // "Review", "Attach Agent"
  enabled: boolean;
  /** Why it is disabled, or what it will do. */
  hint?: string;
  /** Actions handled entirely by the UI (e.g. root "Search" opens the search panel). */
  clientOnly?: boolean;
}

export interface RadialResult {
  ok: boolean;
  message: string;
  /** Optional payload: workspace, agent instance, file content, stats... */
  data?: unknown;
  workspaceId?: string;
  instanceId?: string;
}

// ---------------------------------------------------------------------------
// Workflows (canvas node type)
// ---------------------------------------------------------------------------

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  /** Run in order; each step is an intent or a single agent run. */
  steps: ({ kind: "intent"; text: string } | { kind: "agent"; agentId: string; task: string; files?: string[] })[];
}

// ---------------------------------------------------------------------------
// Kernel
// ---------------------------------------------------------------------------

export interface NalaraConfig {
  /** Directory Nalara manages (the user's projects). */
  root: string;
  /** Where the database and outputs live. Default <root>/.nalara */
  dataDir: string;
  port: number;
  host: string;
  /** Claude model id. Default "claude-opus-5". */
  model: string;
  effort: Effort;
  /** Use Claude when credentials exist. Set false to force offline mode. */
  useClaude: boolean;
  toolPolicy: ToolPolicy;
  mcpServers: Record<string, McpServerConfig>;
  /** Enable the default File Changed -> Review -> QA -> Documentation chain. */
  triggers: boolean;
  watch: boolean;
  maxConcurrentAgents: number;
  /** Who the kernel acts for; the root of every delegation chain. */
  userId: string;
  /** Maximum agent/trigger hops below the human (trigger chains, collaborations). */
  maxDelegationDepth: number;
  /** Default per-instance budget; per-group overrides merge on top. */
  budget: AgentBudget;
  /** Test command for proc.run_tests, run in root. Default: detect from package.json / pyproject. */
  testCommand?: string;
  /** Timeout for proc.run_tests and proc.deploy. Default 10 minutes. */
  procTimeoutMs?: number;
  /** Deploy command for the project radial Deploy action. Without it, Deploy packages the outputs. */
  deployCommand?: string;
  /** Build -> attack -> converge: critics shadow builder steps until the work survives or rounds run out. */
  adversarial: AdversarialConfig;
  /** Whole-fleet budget for one workspace run (every agent, critic and relay message of the run together). */
  fleetBudget: FleetBudget;
}

export interface KernelStatus {
  version: string;
  root: string;
  /** Name of the project node the index detected (README title, package name or folder name). */
  projectName?: string;
  mode: "claude" | "offline";
  model: string;
  startedAt: string;
  graph: { nodes: number; edges: number; byType: Record<string, number> };
  files: number;
  agents: { catalog: number; running: number };
  workspaces: { total: number; running: number };
  mcp: McpServerStatus[];
  pendingApprovals: number;
  toolPolicy: ToolPolicy["mode"];
  halted: boolean;
  governor: ReturnType<Governor["snapshot"]>;
  audit: { entries: number; chainOk: boolean };
}

export interface Kernel {
  readonly config: NalaraConfig;
  readonly bus: EventBus;
  readonly graph: KnowledgeGraph;
  readonly memory: MemoryService;
  readonly index: SemanticIndex;
  readonly tools: ToolRegistry;
  readonly mcp: McpManager;
  readonly llm: LLMProvider | null;
  readonly intents: IntentEngine;
  readonly orchestrator: Orchestrator;
  readonly workspaces: WorkspaceGenerator;
  readonly triggers: TriggerEngine;
  readonly governor: Governor;
  readonly audit: AuditLog;
  readonly journal: ActionJournal;
  start(): Promise<void>;
  /** Kill switch, reachable only from the human-facing API/CLI (never an agent tool): terminate all agents, deny all non-read tools, pause triggers. */
  halt(reason: string): void;
  resume(): void;
  /** Undo compensable writes made in a workspace, from the action journal. */
  undoWorkspace(id: string): Promise<{ restored: string[]; skipped: { path: string; reason: string }[] }>;
  stop(): Promise<void>;
  status(): KernelStatus;
  /** Intent -> workspace. With run (default true) the plan starts in the background; await `done` to wait for it. */
  submitIntent(text: string, opts?: { run?: boolean }): Promise<{ workspace: Workspace; done: Promise<Workspace> }>;
  runWorkspace(id: string): Promise<Workspace>;
  radialActions(nodeId: string | "root"): { kind: RadialKind; actions: RadialAction[] };
  radialAction(nodeId: string | "root", actionId: string, input?: Record<string, unknown>): Promise<RadialResult>;
  workflows(): WorkflowDefinition[];
  runWorkflow(id: string): Promise<{ workspaces: string[]; instances: string[] }>;
}

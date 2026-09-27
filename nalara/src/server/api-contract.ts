/**
 * HTTP API contract between the kernel server (src/server) and the Nalara UI (web/).
 * JSON in, JSON out. Errors: status >= 400 with body { error: string }.
 * The server binds 127.0.0.1 by default. Requests from the UI and CLI act as config.userId.
 * Mutating requests must send header `X-Nalara-Client: 1` (blocks cross-site form posts); the server rejects
 * requests whose Origin header is present and not the server's own origin.
 * Path parameters are URL-encoded single segments (node ids contain ":" and "/"): the server splits the raw path
 * on "/" and then decodes each segment.
 *
 * Method  Path                                   Body                         Response
 * GET     /api/status                            -                            KernelStatus
 * GET     /api/graph?rootId=&depth=&types=&limit= -                           GraphSlice          (types: comma list)
 * GET     /api/nodes/:id                         -                            NodeDetail          (id is URL-encoded)
 * POST    /api/intents                           { text, run?: boolean }      { workspace: Workspace }
 * POST    /api/intents/classify                  { text }                     IntentClassification (no workspace created)
 * GET     /api/workspaces                        -                            Workspace[]
 * GET     /api/workspaces/:id                    -                            WorkspaceDetail
 * POST    /api/workspaces/:id/run                -                            { workspace: Workspace }   (starts in background)
 * POST    /api/workspaces/:id/archive            -                            { workspace: Workspace }
 * GET     /api/agents                            -                            AgentDefinition[]
 * GET     /api/agents/instances?workspaceId=     -                            AgentInstance[]
 * POST    /api/agents/:agentId/run               { task, files?, workspaceId? } { instance: AgentInstance } (starts in background)
 * POST    /api/agents/instances/:id/terminate    -                            { ok: boolean }
 * GET     /api/agents/performance                -                            AgentPerformance[]
 * GET     /api/radial/:nodeId                    -                            RadialMenu          (nodeId "root" for empty canvas)
 * POST    /api/radial/:nodeId/:actionId          { input?: object }           RadialResult
 * GET     /api/search?q=&limit=&kind=            -                            SearchHit[]
 * GET     /api/concepts                          -                            ConceptInfo[]
 * GET     /api/files/content?path=               -                            { path, content, kind }
 * GET     /api/memory?category=&q=&limit=&includeProposed= - MemoryRecord[]  (includeProposed=true also returns proposed records)
 * POST    /api/memory                            { category, key, content, tags? } MemoryRecord
 * DELETE  /api/memory/:id                        -                            { ok: boolean }
 * GET     /api/tools?server=&action=             -                            ToolDefinition[]
 * POST    /api/tools/:name/call                  { input }                    ToolResult          (subject to tool policy)
 * GET     /api/mcp                               -                            McpServerStatus[]
 * POST    /api/mcp                               { name, config: McpServerConfig } McpServerStatus
 * DELETE  /api/mcp/:name                         -                            { ok: boolean }
 * POST    /api/mcp/tools/:name/reapprove         -                            { ok: boolean }     (re-enable a changed MCP tool)
 * GET     /api/approvals?status=                 -                            ApprovalRequest[]
 * POST    /api/approvals/:id                     { approved: boolean }        ApprovalRequest
 * GET     /api/policy                            -                            ToolPolicy
 * PUT     /api/policy                            ToolPolicy                   ToolPolicy
 * GET     /api/triggers                          -                            TriggerRule[]
 * PUT     /api/triggers/:id                      { enabled: boolean }         TriggerRule
 * GET     /api/workflows                         -                            WorkflowDefinition[]
 * POST    /api/workflows/:id/run                 -                            { started: true }
 * POST    /api/memory/:id/confirm                -                            MemoryRecord        (proposed -> active)
 * POST    /api/workspaces/:id/undo               -                            { restored: string[], skipped: {path, reason}[] }
 * POST    /api/kernel/halt                       { reason }                   KernelStatus        (kill switch; human only)
 * POST    /api/kernel/resume                     -                            KernelStatus
 * GET     /api/audit?since=&limit=               -                            { entries: AuditEntry[], chainBrokenAt: number | null }
 * GET     /api/journal?workspaceId=              -                            JournalEntry[]
 * GET     /api/governor                          -                            Governor snapshot
 * GET     /api/events?since=&limit=&correlationId= -                          KernelEvent[]
 * GET     /api/events/stream?since=              -                            text/event-stream: each message `id: <seq>\ndata: <KernelEvent JSON>\n\n`
 *                                                                              (replays seq > since, or > Last-Event-ID; without either the latest 200; then live)
 * GET     /*                                     -                            web/dist static files (index.html fallback for non-/api paths)
 */
import type {
  AgentInstance,
  GraphEdge,
  GraphNode,
  RadialAction,
  RadialKind,
  Workspace,
} from "../kernel/types";

export interface GraphSlice {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface NodeDetail {
  node: GraphNode;
  edges: GraphEdge[];
  neighbors: GraphNode[];
}

export interface WorkspaceDetail {
  workspace: Workspace;
  instances: AgentInstance[];
}

export interface RadialMenu {
  nodeId: string;
  kind: RadialKind;
  actions: RadialAction[];
}

export const DEFAULT_PORT = 7437;

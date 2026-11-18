/**
 * HTTP API contract between the kernel server (src/server) and the Nalara UI (web/).
 * JSON in, JSON out. Errors: status >= 400 with body { error: string, code: string } (codes below).
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
 * POST    /api/intents                           { text, run?, offlineAnyway? } { workspace: Workspace }  (offline: 422 needs_claude for
 *                                                                              intents that need Claude, unless offlineAnyway)
 * POST    /api/intents/classify                  { text }                     IntentClassification & { label, needsClaude } (no workspace)
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
 * GET     /api/files/content?path=[&place=]      -                            { path, content, kind } (other places: + place, size, mtimeMs)
 * Places and paths below: `place` is a place id (default "home", the Nalara folder); paths are relative to it.
 * GET     /api/places                            -                            { places: Place[], suggested: {name, path}[] }
 * POST    /api/places                            { path, name? }              Place (an absolute folder path on this computer)
 * DELETE  /api/places/:id                        -                            { ok: true } (the folder itself is untouched)
 * GET     /api/files/list?place=&path=&hidden=   -                            FileListing (folders first)
 * PUT     /api/files/content                     { place?, path, content, mode?: "create"|"overwrite"|"any" }  FileEntry
 * POST    /api/files/mkdir                       { place?, path }             FileEntry
 * POST    /api/files/move                        { place?, from, to }         FileEntry (rename or move; 409 if the target exists)
 * POST    /api/files/copy                        { place?, from, to }         FileEntry
 * POST    /api/files/trash                       { place?, path }             TrashItem (recoverable)
 * POST    /api/files/open                        { place?, path }             { ok: true } (default app; 403 for programs and scripts)
 * GET     /api/files/raw?place=&path=            -                            the file bytes, images and PDF only, CSP sandbox
 * GET     /api/trash                             -                            TrashItem[] (newest first)
 * POST    /api/trash/:id/restore                 -                            FileEntry (its old place, or "name (restored).ext")
 * DELETE  /api/trash/:id                         -                            { ok: true } (deleted for good)
 * DELETE  /api/trash                             -                            { removed: number } (empty the trash)
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
 * GET     /api/version                           -                            { name, version, apiVersion, supportedApiVersions, features }
 * GET     /api/workspaces/:id/tree               -                            FleetTree & { reviews: StepReview[] }  (process tree, live states)
 * GET     /api/relay?workspaceId=&instanceId=&kind=&since=&limit= -           RelayMessage[]      (kind: comma list of spawn,handoff,challenge,verdict,result)
 * GET     /api/fleet/records?file=&workspaceId=&limit= -                      FleetRecord[]       (fleet memory; file may repeat)
 * GET     /api/observatory                       -                            Observatory         (usage and burn per fleet and agent)
 * GET     /api/queue                             -                            WorkQueue           (approvals, running agents, waiting workspaces)
 * GET     /api/secrets                           -                            SecretInfo[]        (names only, never values)
 * PUT     /api/secrets/:name                     { value }                    SecretInfo
 * DELETE  /api/secrets/:name                     -                            { ok: boolean }
 * GET     /api/claude                            -                            { mode, model, credentials: "environment"|"settings"|"none", canRestart }
 * PUT     /api/claude/key                        { key }                      { saved, replaced, canRestart }  (checked with Anthropic first:
 *                                                                              400 claude_key_rejected, 502 claude_unreachable)
 * DELETE  /api/claude/key                        -                            { ok, canRestart }
 * POST    /api/kernel/restart                    -                            { restarting: true }  (501 restart_unavailable without a supervisor)
 * GET     /api/assistant                         -                            { online, mode, model }
 * POST    /api/assistant/ask                     { text, conversationId? }    NDJSON stream, one event per line: start, delta,
 *                                                                              turn_text, tool, tool_result, done (the saved
 *                                                                              answer) or error. Closing the request stops it.
 * GET     /api/assistant/conversations[?limit]   -                            Conversation[] (newest first)
 * GET     /api/assistant/conversations/:id       -                            AssistantMessage[]
 * DELETE  /api/assistant/conversations/:id       -                            { ok: true }
 * GET     /*                                     -                            web/dist static files (index.html fallback for non-/api paths)
 *
 * System interface (every route):
 * - Responses carry X-Nalara-Api-Version. A request may send X-Nalara-Api-Version; an unsupported version gets 400
 *   unsupported_version.
 * - Errors are { error: string, code: string }. Codes: invalid_request, forbidden, not_found, conflict,
 *   payload_too_large, unprocessable, internal_error, kernel_halted, invalid_secret, unsupported_version,
 *   idempotency_conflict, needs_claude, claude_key_rejected, claude_unreachable, restart_unavailable.
 * - Mutating requests may send Idempotency-Key (at most 200 characters). The same key and body on the same route
 *   within 10 minutes replays the first response (any status below 500) with Idempotent-Replayed: true; the same key
 *   with a different body gets 422 idempotency_conflict.
 * - JSON responses and SSE events pass through secret redaction: stored secret values never leave the server.
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

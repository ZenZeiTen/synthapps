/**
 * Mock Nalara kernel for UI development and the smoke test. Implements every endpoint in
 * src/server/api-contract.ts with canned data and serves web/dist.
 *
 *   node --import tsx web/mock/mock-server.ts            (port 7437, or PORT=...)
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_CATALOG } from "../../src/agents/catalog";
import type {
  AgentInstance,
  AgentOutput,
  AgentState,
  ApprovalRequest,
  AuditEntry,
  EdgeKind,
  EventType,
  GraphEdge,
  GraphNode,
  IntentClassification,
  JournalEntry,
  KernelEvent,
  KernelStatus,
  McpServerStatus,
  MemoryCategory,
  MemoryRecord,
  NodeType,
  PlanStep,
  Principal,
  RadialAction,
  RadialKind,
  RadialResult,
  SearchHit,
  ToolDefinition,
  ToolPolicy,
  TriggerRule,
  WorkflowDefinition,
  Workspace,
} from "../../src/kernel/types";
import type { GraphSlice, NodeDetail, RadialMenu, WorkspaceDetail } from "../../src/server/api-contract";
import { FILES, PROJECT_NAME, kindOf } from "./fixtures";

const PORT = Number(process.env.PORT ?? 7437);
const HOST = process.env.HOST ?? "127.0.0.1";
const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const QUIET = process.env.MOCK_QUIET === "1";

const T0 = Date.parse("2026-09-26T09:00:00Z");
const at = (min: number) => new Date(T0 + min * 60000).toISOString();
const now = () => new Date().toISOString();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

// ---------------------------------------------------------------------------------------------------------
// Event bus

let seq = 0;
const events: KernelEvent[] = [];
const sseClients = new Set<ServerResponse>();

function publish<T>(type: EventType, data: T, correlationId?: string, source = "kernel"): KernelEvent<T> {
  const ev: KernelEvent<T> = { id: `ev_${randomUUID().slice(0, 8)}`, seq: ++seq, type, ts: now(), source, correlationId, data };
  events.push(ev as KernelEvent);
  if (events.length > 2000) events.splice(0, events.length - 2000);
  const frame = `id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`;
  for (const c of sseClients) c.write(frame);
  return ev;
}

// ---------------------------------------------------------------------------------------------------------
// Graph

const nodes = new Map<string, GraphNode>();
const edges: GraphEdge[] = [];

function upsertNode(id: string, type: NodeType, name: string, props: Record<string, unknown> = {}, ts = at(0), emit = false): GraphNode {
  const prev = nodes.get(id);
  const n: GraphNode = { id, type, name, props: { ...(prev?.props ?? {}), ...props }, createdAt: prev?.createdAt ?? ts, updatedAt: emit ? now() : ts };
  nodes.set(id, n);
  if (emit) publish(prev ? "node.updated" : "node.created", { node: n }, undefined, "graph");
  return n;
}

function link(source: string, target: string, kind: EdgeKind, emit = false): GraphEdge | undefined {
  if (!nodes.has(source) || !nodes.has(target)) return undefined;
  const existing = edges.find((e) => e.source === source && e.target === target && e.kind === kind);
  if (existing) return existing;
  const e: GraphEdge = { id: `e_${edges.length + 1}_${kind}`, source, target, kind, props: {}, createdAt: now() };
  edges.push(e);
  if (emit) publish("edge.created", { edge: e }, undefined, "graph");
  return e;
}

const PROJECT_ID = "project:breath-of-fire-iv-remake";
upsertNode(PROJECT_ID, "project", PROJECT_NAME, { root: "/projects/bof4-remake" });

const folders = new Set<string>();
for (const path of Object.keys(FILES)) {
  if (path.startsWith(".nalara/")) continue;
  const parts = path.split("/");
  let parent = PROJECT_ID;
  for (let i = 0; i < parts.length - 1; i++) {
    const fp = parts.slice(0, i + 1).join("/");
    const fid = `folder:${fp}`;
    if (!folders.has(fp)) {
      folders.add(fp);
      upsertNode(fid, "folder", parts[i], { path: fp });
      link(parent, fid, "contains");
    }
    parent = fid;
  }
  const id = `file:${path}`;
  upsertNode(id, "file", parts[parts.length - 1], { path, kind: kindOf(path), size: FILES[path].length });
  link(parent, id, "contains");
}

const IMPORTS: [string, string][] = [
  ["src/combat/battle_system.ts", "src/combat/damage_calc.ts"],
  ["src/combat/battle_system.ts", "src/combat/status_effects.ts"],
  ["src/combat/battle_system.ts", "src/world/field_map.ts"],
  ["src/inventory/inventory.ts", "src/inventory/items.ts"],
  ["src/inventory/merchant_shop.ts", "src/inventory/inventory.ts"],
  ["src/inventory/merchant_shop.ts", "src/inventory/items.ts"],
  ["src/world/field_map.ts", "src/world/npc_dialogue.ts"],
  ["tests/inventory.test.ts", "src/inventory/inventory.ts"],
  ["tests/damage_calc.test.ts", "src/combat/damage_calc.ts"],
];
for (const [a, b] of IMPORTS) link(`file:${a}`, `file:${b}`, "imports");
link("file:docs/design/combat.md", "file:src/combat/battle_system.ts", "references");
link("file:docs/design/combat.md", "file:src/combat/damage_calc.ts", "references");
link("file:docs/design/merchants.md", "file:src/inventory/merchant_shop.ts", "references");
link("file:docs/design/inventory.md", "file:src/inventory/inventory.ts", "references");

const CONCEPTS: Record<string, { name: string; files: string[] }> = {
  "concept:combat-system": { name: "Combat System", files: ["src/combat/battle_system.ts", "src/combat/damage_calc.ts", "src/combat/status_effects.ts", "docs/design/combat.md"] },
  "concept:inventory": { name: "Inventory", files: ["src/inventory/inventory.ts", "src/inventory/items.ts", "docs/design/inventory.md", "tests/inventory.test.ts"] },
  "concept:merchants": { name: "Merchants", files: ["src/inventory/merchant_shop.ts", "docs/design/merchants.md"] },
  "concept:world-map": { name: "World Map", files: ["src/world/field_map.ts", "src/world/npc_dialogue.ts"] },
};
for (const [id, c] of Object.entries(CONCEPTS)) {
  upsertNode(id, "concept", c.name, { files: c.files });
  for (const f of c.files) link(`file:${f}`, id, "about");
}

for (const a of AGENT_CATALOG) upsertNode(`agent:${a.id}`, "agent", a.name, { agentId: a.id, group: a.group, role: a.role });

const MCP: { id: string; name: string; tools: string[]; builtin?: boolean }[] = [
  { id: "builtin-fs", name: "Filesystem", tools: ["fs.list_files", "fs.read_file", "fs.search_text", "fs.write_output", "fs.write_file"], builtin: true },
  { id: "builtin-git", name: "Git", tools: ["git.status", "git.log", "git.diff"], builtin: true },
  { id: "builtin-proc", name: "Processes", tools: ["proc.run_tests", "proc.deploy"], builtin: true },
  { id: "github", name: "GitHub", tools: ["mcp.github.search_issues", "mcp.github.create_pr"] },
  { id: "postgres", name: "PostgreSQL", tools: ["mcp.postgres.query"] },
  { id: "notion", name: "Notion", tools: ["mcp.notion.search", "mcp.notion.create_page"] },
  { id: "google-drive", name: "Google Drive", tools: ["mcp.google-drive.read", "mcp.google-drive.upload"] },
];
for (const m of MCP) upsertNode(`mcp:${m.id}`, "mcp", m.name, { server: m.id, status: "connected", tools: m.tools.length });

upsertNode("workflow:build-pipeline", "workflow", "Build Pipeline", { steps: 3 });
link(PROJECT_ID, "workflow:build-pipeline", "contains");

function serverForTool(tool: string): string | undefined {
  if (tool.startsWith("fs.")) return "mcp:builtin-fs";
  if (tool.startsWith("git.")) return "mcp:builtin-git";
  if (tool.startsWith("proc.")) return "mcp:builtin-proc";
  const m = /^mcp\.([^.]+)\./.exec(tool);
  return m ? `mcp:${m[1]}` : undefined;
}

// ---------------------------------------------------------------------------------------------------------
// Workspaces and agent instances

const USER = "user:local";
const BUDGET = { maxInputTokens: 200000, maxOutputTokens: 32000, maxToolCalls: 60, maxTurns: 12, maxWallMs: 600000, maxRepeatCalls: 3 };
const workspaces = new Map<string, Workspace>();
const instances = new Map<string, AgentInstance>();
let instSeq = 1;

function principal(agentId: string, instanceId: string, workspaceId?: string): Principal {
  return { userId: "local", agentId, instanceId, workspaceId, chain: [USER, ...(workspaceId ? [`workspace:${workspaceId}`] : []), `agent:${agentId}#${instanceId}`], depth: 1 };
}

function newInstance(agentId: string, workspaceId: string | undefined, state: AgentState, task: string, startedMin: number, output?: AgentOutput): AgentInstance {
  const instanceId = `ai_${instSeq++}`;
  const def = AGENT_CATALOG.find((a) => a.id === agentId);
  const inst: AgentInstance = {
    instanceId,
    agentId,
    name: def?.name ?? agentId,
    workspaceId,
    state,
    task,
    startedAt: at(startedMin),
    finishedAt: state === "completed" ? at(startedMin + 2) : undefined,
    output,
    toolCalls: state === "dormant" ? 0 : 4,
    principal: principal(agentId, instanceId, workspaceId),
    budget: BUDGET,
    usage: { inputTokens: 5200, outputTokens: 900, toolCalls: 4, turns: 3, wallMs: 41000 },
  };
  instances.set(instanceId, inst);
  return inst;
}

interface Template {
  intent: string;
  label: string;
  agents: string[];
  tools: string[];
  files: string[];
  resources: string[];
  plan: [string, string][];
}

const TEMPLATES: Record<string, Template> = {
  engineering_review: {
    intent: "engineering_review",
    label: "Engineering review",
    agents: ["systems_architect", "code_reviewer", "qa_engineer"],
    tools: ["fs.read_file", "fs.search_text", "git.diff", "mcp.github.search_issues"],
    files: ["src/inventory/inventory.ts", "src/inventory/items.ts", "src/inventory/merchant_shop.ts", "docs/design/inventory.md"],
    resources: ["memory: coding standards", "memory: past review decisions"],
    plan: [
      ["systems_architect", "Check module boundaries and what the inventory module depends on"],
      ["code_reviewer", "Read the inventory code and flag defects"],
      ["qa_engineer", "Check test coverage on inventory paths"],
    ],
  },
  feature_build: {
    intent: "feature_build",
    label: "Feature build",
    agents: ["planner", "fullstack_engineer", "qa_engineer", "documentation"],
    tools: ["fs.read_file", "fs.write_file", "proc.run_tests", "git.status", "mcp.postgres.query"],
    files: ["src/inventory/inventory.ts", "src/inventory/items.ts", "src/combat/battle_system.ts", "tests/inventory.test.ts"],
    resources: ["memory: coding standards", "memory: architecture decisions"],
    plan: [
      ["planner", "Split the storage-chest feature into tasks"],
      ["fullstack_engineer", "Route inventory overflow to the camp storage chest"],
      ["qa_engineer", "Write and run tests for overflow and storage"],
      ["documentation", "Update docs/design/inventory.md"],
    ],
  },
  website_localization: {
    intent: "website_localization",
    label: "Localization",
    agents: ["brand_analyst", "translator", "localization_qa", "seo_reviewer"],
    tools: ["fs.read_file", "fs.write_output", "mcp.notion.search"],
    files: ["site/index.html", "README.md"],
    resources: ["Style Guide", "memory: translation guides"],
    plan: [
      ["brand_analyst", "Extract voice and key terms"],
      ["translator", "Write Indonesian copy against the Style Guide"],
      ["seo_reviewer", "Localize titles and metadata"],
      ["localization_qa", "Check terms, length and tone"],
    ],
  },
  legal_translation: {
    intent: "legal_translation",
    label: "Contract translation",
    agents: ["legal", "translator", "qa_reviewer"],
    tools: ["fs.read_file", "fs.write_output", "mcp.google-drive.read"],
    files: ["docs/legal/distribution_agreement.md", "docs/legal/glossary.csv"],
    resources: ["Glossary", "Output Folder"],
    plan: [
      ["legal", "Mark defined terms and key clauses"],
      ["translator", "Translate against the Glossary"],
      ["qa_reviewer", "Check terms, numbering and cross-references"],
    ],
  },
  general_task: {
    intent: "general_task",
    label: "General task",
    agents: ["planner", "researcher"],
    tools: ["fs.read_file", "search.semantic"],
    files: ["README.md"],
    resources: [],
    plan: [
      ["planner", "Break the request into steps"],
      ["researcher", "Collect the relevant files and notes"],
    ],
  },
};

function classify(text: string): IntentClassification {
  const t = text.toLowerCase();
  let intent = "general_task";
  if (/contract|legal|agreement|clause/.test(t)) intent = "legal_translation";
  else if (/locali|indonesia|translat|website|seo/.test(t)) intent = "website_localization";
  else if (/review|audit|inspect|check/.test(t)) intent = "engineering_review";
  else if (/build|feature|implement|add /.test(t)) intent = "feature_build";
  const tpl = TEMPLATES[intent];
  return { intent, required_agents: tpl.agents, required_tools: tpl.tools, confidence: intent === "general_task" ? 0.41 : 0.86, source: "heuristic" };
}

function planOf(tpl: Template): PlanStep[] {
  return tpl.plan.map(([agent, task], i) => ({ id: `s${i + 1}`, agent, task, dependsOn: i === 0 ? [] : [`s${i}`], tools: tpl.tools }));
}

function makeWorkspace(id: string, text: string, tpl: Template, createdMin: number, emit = false): Workspace {
  const ws: Workspace = {
    id,
    nodeId: `workspace:${id}`,
    intentId: `int_${id}`,
    intent: tpl.intent,
    label: tpl.label,
    text,
    priority: "normal",
    status: "ready",
    agents: tpl.agents,
    tools: tpl.tools,
    files: tpl.files,
    resources: tpl.resources,
    plan: planOf(tpl),
    outputDir: `.nalara/outputs/${id}`,
    createdAt: at(createdMin),
    checkpoint: { completedSteps: {} },
  };
  workspaces.set(id, ws);
  upsertNode(ws.nodeId, "workspace", tpl.label, { workspaceId: id, intent: tpl.intent, status: ws.status, createdAt: ws.createdAt }, ws.createdAt, emit);
  for (const a of tpl.agents) link(`agent:${a}`, ws.nodeId, "assigned_to", emit);
  for (const f of tpl.files) link(`file:${f}`, ws.nodeId, "member_of", emit);
  for (const t of tpl.tools) {
    const s = serverForTool(t);
    if (s) link(ws.nodeId, s, "uses_tool", emit);
  }
  return ws;
}

function out(summary: string, findings: AgentOutput["findings"] = []): AgentOutput {
  return { summary, findings, artifacts: [], confidence: 0.8, source: "offline" };
}

// Contract (oldest), localization, review (completed), feature build (running, newest).
const wsContract = makeWorkspace("ws_contract", "Translate contract", TEMPLATES.legal_translation, 10);
const wsLocal = makeWorkspace("ws_localize", "Localize this website to Indonesian", TEMPLATES.website_localization, 20);
const wsReview = makeWorkspace("ws_review", "Review inventory module", TEMPLATES.engineering_review, 30);
const wsFeature = makeWorkspace("ws_feature", "Build inventory feature", TEMPLATES.feature_build, 40);
void wsContract;
void wsLocal;

{
  const f1 = out("Inventory depends only on items; merchant_shop couples to both. Boundaries are fine.", [
    { severity: "low", title: "Inventory.value() ignores merchant markup", detail: "Value uses base price; shops use price * markup.", file: "src/inventory/inventory.ts", line: 26 },
  ]);
  const f2 = out("Two defects in the inventory module.", [
    { severity: "high", title: "Inventory overflow is silently dropped", detail: "add() clamps at MAX_STACK and the caller ignores the return value; the design doc says overflow goes to storage.", file: "src/inventory/inventory.ts", line: 12 },
    { severity: "medium", title: "buy() adds items before checking the stack cap", detail: "The player pays for items that are then dropped.", file: "src/inventory/merchant_shop.ts", line: 15 },
  ]);
  const f3 = out("Coverage is thin on selling.", [{ severity: "info", title: "No test covers sell()", detail: "Add a test for sell() with insufficient stock." }]);
  const i1 = newInstance("systems_architect", "ws_review", "completed", wsReview.plan[0].task, 31, f1);
  const i2 = newInstance("code_reviewer", "ws_review", "completed", wsReview.plan[1].task, 32, f2);
  const i3 = newInstance("qa_engineer", "ws_review", "completed", wsReview.plan[2].task, 33, f3);
  wsReview.status = "completed";
  wsReview.completedAt = at(36);
  wsReview.checkpoint.completedSteps = {
    s1: { instanceId: i1.instanceId, agentId: i1.agentId, output: f1 },
    s2: { instanceId: i2.instanceId, agentId: i2.agentId, output: f2 },
    s3: { instanceId: i3.instanceId, agentId: i3.agentId, output: f3 },
  };
  wsReview.report = {
    workspaceId: "ws_review",
    summary: "The inventory module is small and well bounded, but overflow handling contradicts the design doc and merchants can charge for items that are dropped. Fix overflow first.",
    outputs: [i1, i2, i3].map((i) => ({ agentId: i.agentId, instanceId: i.instanceId, output: i.output! })),
    conflicts: [{ topic: "Stack overflow", agents: ["code_reviewer", "systems_architect"], resolution: "Route overflow to the storage chest, as the design doc says." }],
    findings: [...f2.findings, ...f1.findings, ...f3.findings],
    artifactPath: ".nalara/outputs/ws_review/report.md",
  };
  upsertNode(wsReview.nodeId, "workspace", wsReview.label, { status: "completed" });
  upsertNode("output:.nalara/outputs/ws_review/report.md", "output", "report.md", { path: ".nalara/outputs/ws_review/report.md" });
  link(wsReview.nodeId, "output:.nalara/outputs/ws_review/report.md", "produced");
}
{
  const p1 = out("Four tasks: storage model, overflow routing, UI hook, tests.");
  const i1 = newInstance("planner", "ws_feature", "completed", wsFeature.plan[0].task, 41, p1);
  newInstance("fullstack_engineer", "ws_feature", "active", wsFeature.plan[1].task, 43);
  newInstance("qa_engineer", "ws_feature", "summoned", wsFeature.plan[2].task, 43);
  newInstance("documentation", "ws_feature", "summoned", wsFeature.plan[3].task, 43);
  wsFeature.status = "running";
  wsFeature.checkpoint.completedSteps = { s1: { instanceId: i1.instanceId, agentId: "planner", output: p1 } };
  upsertNode(wsFeature.nodeId, "workspace", wsFeature.label, { status: "running" });
}

// ---------------------------------------------------------------------------------------------------------
// Memory, approvals, policy, triggers, MCP, audit

const memory = new Map<string, MemoryRecord>();
function remember(category: MemoryCategory, key: string, content: string, source = "platform", tags: string[] = []): MemoryRecord {
  const existing = [...memory.values()].find((r) => r.category === category && r.key === key);
  const id = existing?.id ?? `mem_${memory.size + 1}`;
  const rec: MemoryRecord = {
    id,
    category,
    key,
    content,
    data: {},
    tags,
    source,
    status: source.startsWith("agent:") ? "proposed" : "active",
    createdAt: existing?.createdAt ?? at(1),
    updatedAt: now(),
  };
  memory.set(id, rec);
  return rec;
}
remember("coding_standard", "strict-typescript", "All code is strict TypeScript; no any in exported signatures.", "user", ["typescript"]);
remember("coding_standard", "tests-next-to-feature", "Every feature ships with vitest tests under tests/.", "user", ["tests"]);
remember("architecture_decision", "inventory-storage", "Inventory overflow goes to the camp storage chest, never dropped.", "platform", ["inventory"]);
remember("translation_guide", "id-formality", "Indonesian copy uses formal 'Anda', never 'kamu'.", "user", ["indonesian"]);
remember("preference", "report-format", "Reports rank findings most severe first.", "user");
remember("project_history", "ws_review", "Engineering review of the inventory module found 4 issues (1 high).", "platform", ["ws_review"]);
remember("file_relationship", "merchant-inventory", "merchant_shop.ts depends on inventory.ts and items.ts.", "agent:code_reviewer#ai_2", ["inventory"]);
remember("coding_standard", "no-silent-clamp", "Functions that clamp input must report what they dropped.", "agent:systems_architect#ai_1", ["inventory"]);

let policy: ToolPolicy = { mode: "ask", allow: [], deny: ["mcp.*.delete_*"], approvalTimeoutMs: 600000 };
const approvals = new Map<string, ApprovalRequest>();
{
  const qa = [...instances.values()].find((i) => i.workspaceId === "ws_feature" && i.agentId === "qa_engineer")!;
  const a: ApprovalRequest = {
    id: "apr_1",
    tool: "proc.run_tests",
    action: "execute",
    reversibility: "irreversible",
    scope: "tenant",
    input: { command: "npm test -- tests/inventory.test.ts", cwd: "." },
    principal: qa.principal,
    status: "pending",
    createdAt: at(44),
  };
  approvals.set(a.id, a);
}

const triggers = new Map<string, TriggerRule>(
  [
    { id: "review-on-change", name: "File Changed: Review Agent", on: "file.updated", when: { pathGlob: "src/**/*.ts" }, then: { kind: "run_agent", agentId: "code_reviewer", task: "Review the change to {{path}}" }, enabled: true, debounceMs: 1500 },
    { id: "qa-after-review", name: "Review finished: QA Agent", on: "agent.finished", when: { agentId: "code_reviewer", triggeredBy: "review-on-change" }, then: { kind: "run_agent", agentId: "qa_engineer", task: "Check tests for {{path}}" }, enabled: true },
    { id: "docs-after-qa", name: "QA finished: Documentation Agent", on: "agent.finished", when: { agentId: "qa_engineer", triggeredBy: "review-on-change" }, then: { kind: "run_agent", agentId: "documentation", task: "Update docs for {{path}}" }, enabled: false },
  ].map((r) => [r.id, r as TriggerRule]),
);

const mcpStatus = new Map<string, McpServerStatus>(
  MCP.filter((m) => !m.builtin).map((m) => [m.id, { name: m.id, status: "connected", transport: "stdio", tools: m.tools, connectedAt: at(2) }]),
);

const audit: AuditEntry[] = [];
function appendAudit(e: Omit<AuditEntry, "seq" | "ts" | "prevHash" | "hash">, ts = now()) {
  const prevHash = audit.length ? audit[audit.length - 1].hash : "0".repeat(64);
  const seqNo = audit.length + 1;
  const hash = sha(prevHash + JSON.stringify({ ...e, seq: seqNo, ts }));
  audit.push({ ...e, seq: seqNo, ts, prevHash, hash });
}
appendAudit({ kind: "policy", principal: null, subject: "policy", outcome: "info", detail: { mode: "ask" } }, at(0));
for (const i of [...instances.values()].filter((x) => x.state === "completed")) {
  appendAudit({ kind: "tool_call", principal: i.principal, subject: "fs.read_file", outcome: "ok", detail: { path: "src/inventory/inventory.ts" } }, at(34));
}
appendAudit({ kind: "approval", principal: approvals.get("apr_1")!.principal, subject: "proc.run_tests", outcome: "info", detail: { status: "pending" } }, at(44));

const journal: JournalEntry[] = [];
let halted = false;

const WORKFLOWS: WorkflowDefinition[] = [
  { id: "build-pipeline", name: "Build Pipeline", description: "Review, test and document the current changes.", steps: [{ kind: "intent", text: "Review inventory module" }, { kind: "agent", agentId: "qa_engineer", task: "Run the test suite" }, { kind: "agent", agentId: "documentation", task: "Update the changelog" }] },
];

const TOOLS: ToolDefinition[] = MCP.flatMap((m) =>
  m.tools.map<ToolDefinition>((name) => ({
    name,
    description: `${name} (${m.name})`,
    server: m.builtin ? `builtin:${m.id.replace("builtin-", "")}` : `mcp:${m.id}`,
    action: /write|create|upload/.test(name) ? "write" : /run|deploy|query/.test(name) ? "execute" : /search/.test(name) ? "search" : "read",
    reversibility: /write_output|read|list|search|status|log|diff/.test(name) ? "reversible" : name === "fs.write_file" ? "compensable" : "irreversible",
    scope: m.builtin ? "tenant" : "external",
    inputSchema: { type: "object" },
  })),
);

// ---------------------------------------------------------------------------------------------------------
// Search

const STOP = new Set(["files", "file", "related", "to", "the", "a", "latest", "code", "docs", "doc", "design", "referencing", "about", "for", "of", "and"]);

function search(q: string, limit = 20): SearchHit[] {
  const ql = q.toLowerCase();
  const wantKind = /\bdocs?\b/.test(ql) ? "doc" : /\bcode\b/.test(ql) ? "code" : /\btests?\b/.test(ql) ? "test" : undefined;
  const recent = /\blatest\b|\brecent\b/.test(ql);
  const tokens = ql
    .split(/[^a-z0-9_]+/)
    .filter((t) => t && !STOP.has(t))
    .map((t) => (t.endsWith("s") && t.length > 4 ? t.slice(0, -1) : t))
    .map((t) => (t.startsWith("calculation") ? "calc" : t));
  const hits: SearchHit[] = [];
  for (const [path, content] of Object.entries(FILES)) {
    if (path.startsWith(".nalara/")) continue;
    const kind = kindOf(path);
    if (wantKind && kind !== wantKind && !(wantKind === "code" && kind === "test")) continue;
    const lower = content.toLowerCase();
    const matched: string[] = [];
    let score = 0;
    for (const t of tokens) {
      const inPath = path.toLowerCase().includes(t);
      const count = lower.split(t).length - 1;
      const concept = Object.values(CONCEPTS).some((c) => c.name.toLowerCase().includes(t) && c.files.includes(path));
      if (inPath || count || concept) matched.push(t);
      score += (inPath ? 3 : 0) + Math.min(count, 5) * 0.5 + (concept ? 2 : 0);
    }
    if (!matched.length) continue;
    const reasons = [`matches: ${matched.join(", ")}`];
    if (wantKind) reasons.push(`kind: ${kind}`);
    if (recent && path.includes("damage_calc")) {
      score += 3;
      reasons.push("recent");
    }
    for (const [a, b] of IMPORTS) if (a === path && tokens.some((t) => b.includes(t))) reasons.push(`imports ${b.split("/").pop()}`);
    const lines = content.split("\n");
    const li = Math.max(0, lines.findIndex((l) => matched.some((t) => l.toLowerCase().includes(t))));
    hits.push({ path, nodeId: `file:${path}`, score: Math.round(score * 100) / 100, snippet: lines.slice(li, li + 2).join("\n").trim(), line: li + 1, kind, mtimeMs: T0, reasons });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ---------------------------------------------------------------------------------------------------------
// Radial menus

function radialFor(nodeId: string): RadialMenu | undefined {
  const mk = (kind: RadialKind, list: [string, string, boolean?, string?, boolean?][]): RadialMenu => ({
    nodeId,
    kind,
    actions: list.map<RadialAction>(([id, label, enabled = true, hint, clientOnly]) => ({ id, label, enabled, hint, clientOnly })),
  });
  if (nodeId === "root")
    return mk("root", [
      ["search", "Search", true, "Find files by meaning", true],
      ["files", "Files", true, "Browse the file tree", true],
      ["agents", "Agents", true, "The agent catalog", true],
      ["projects", "Projects", true, "Projects in the graph", true],
      ["apps", "Apps", true, "Workspaces", true],
      ["memory", "Memory", true, "Project memory", true],
      ["settings", "Settings", true, "Kernel settings", true],
    ]);
  const n = nodes.get(nodeId);
  if (!n) return undefined;
  switch (n.type) {
    case "agent":
      return mk("agent", [
        ["review", "Review"],
        ["explain", "Explain"],
        ["compare", "Compare", false, "Select a second agent to compare with"],
        ["improve", "Improve"],
        ["test", "Test"],
        ["collaborate", "Collaborate"],
        ["replace", "Replace", false, "No other agent fills this role"],
      ]);
    case "file":
      return mk("file", [
        ["open", "Open", true, "Show the file", true],
        ["summarize", "Summarize"],
        ["translate", "Translate", true, "Needs Claude for real translation; offline gives a term list"],
        ["refactor", "Refactor", true, "Compensable write: needs approval in ask mode"],
        ["analyze", "Analyze"],
        ["attach_agent", "Attach Agent"],
      ]);
    case "project":
      return mk("project", [
        ["open_workspace", "Open Workspace"],
        ["launch_swarm", "Launch Swarm"],
        ["review_status", "Review Status"],
        ["memory", "Memory"],
        ["deploy", "Deploy", false, "No deploy command configured"],
        ["archive", "Archive"],
      ]);
    case "mcp":
      return mk("mcp", [
        ["read", "Read"],
        ["write", "Write", false, "Irreversible external write: approval required"],
        ["search", "Search"],
        ["execute", "Execute", false, "No executable tools on this server"],
      ]);
    case "workspace":
      return mk("workspace", [
        ["open_workspace", "Open Workspace", true, "Show in the execution panel", true],
        ["launch_swarm", "Launch Swarm"],
        ["review_status", "Review Status"],
        ["memory", "Memory"],
        ["archive", "Archive"],
      ]);
    case "workflow":
      return mk("workflow", [["run", "Run"], ["inspect", "Inspect"], ["edit", "Edit", false, "Edit .nalara/workflows/build-pipeline.json"], ["pause", "Pause", false, "Not running"]]);
    default:
      return mk((["folder", "concept", "output"].includes(n.type) ? n.type : "file") as RadialKind, [
        ["open", "Open"],
        ["summarize", "Summarize"],
        ["search", "Search related"],
      ]);
  }
}

function radialAction(nodeId: string, actionId: string): RadialResult {
  const n = nodes.get(nodeId);
  const name = n?.name ?? nodeId;
  if (n?.type === "file" && actionId === "open") {
    const path = String(n.props.path);
    return { ok: true, message: `Opened ${path}`, data: { path, content: FILES[path] ?? "", kind: kindOf(path) } };
  }
  if (n?.type === "project" && (actionId === "launch_swarm" || actionId === "open_workspace")) {
    const ws = submitIntent(`Review status of ${name}`, actionId === "launch_swarm");
    return { ok: true, message: `Workspace ${ws.label} generated for ${name}`, workspaceId: ws.id };
  }
  if (n?.type === "workspace" && actionId === "archive") {
    const id = String(n.props.workspaceId);
    archiveWorkspace(id);
    return { ok: true, message: `Archived ${name}`, workspaceId: id };
  }
  if (n?.type === "agent") {
    const agentId = String(n.props.agentId);
    const inst = newInstance(agentId, undefined, "active", `${actionId} requested from the canvas`, 0);
    inst.startedAt = now();
    publish("agent.summoned", { agentId, instanceId: inst.instanceId, name: inst.name }, undefined, "orchestrator");
    setTimeout(() => {
      inst.state = "completed";
      inst.finishedAt = now();
      publish("agent.finished", { agentId, instanceId: inst.instanceId, name: inst.name, state: "completed" }, undefined, "orchestrator");
    }, 2500);
    return { ok: true, message: `${name}: ${actionId} started`, instanceId: inst.instanceId };
  }
  return { ok: true, message: `${actionId.replace(/_/g, " ")} on ${name}: done (mock)` };
}

// ---------------------------------------------------------------------------------------------------------
// Kernel operations

let wsSeq = 5;
function submitIntent(text: string, run: boolean): Workspace {
  const c = classify(text);
  publish("intent.received", { text }, undefined, "intent");
  const id = `ws_${wsSeq++}`;
  publish("intent.classified", { ...c, text }, id, "intent");
  const ws = makeWorkspace(id, text, TEMPLATES[c.intent], 0, true);
  ws.createdAt = now();
  upsertNode(ws.nodeId, "workspace", ws.label, { createdAt: ws.createdAt });
  publish("workspace.generated", { workspace: { id: ws.id, label: ws.label, intent: ws.intent } }, ws.id, "workspace");
  for (const a of ws.agents) {
    const inst = newInstance(a, ws.id, "summoned", ws.plan.find((p) => p.agent === a)?.task ?? "", 0);
    inst.startedAt = now();
    publish("agent.summoned", { agentId: a, instanceId: inst.instanceId, name: inst.name, workspaceId: ws.id }, ws.id, "orchestrator");
  }
  if (run) runWorkspace(ws.id);
  return ws;
}

function setWsStatus(ws: Workspace, status: Workspace["status"]) {
  ws.status = status;
  upsertNode(ws.nodeId, "workspace", ws.label, { status }, undefined, true);
}

function runWorkspace(id: string): Workspace | undefined {
  const ws = workspaces.get(id);
  if (!ws || halted) return ws;
  setTimeout(() => {
    setWsStatus(ws, "running");
    publish("workspace.started", { workspaceId: ws.id, label: ws.label }, ws.id, "orchestrator");
    for (const i of instances.values()) {
      if (i.workspaceId !== ws.id) continue;
      i.state = "active";
      publish("agent.state", { agentId: i.agentId, instanceId: i.instanceId, name: i.name, state: "active", workspaceId: ws.id }, ws.id, "orchestrator");
    }
  }, 600);
  setTimeout(() => {
    if (halted) return;
    const outs: { agentId: string; instanceId: string; output: AgentOutput }[] = [];
    ws.plan.forEach((step) => {
      const inst = [...instances.values()].find((i) => i.workspaceId === ws.id && i.agentId === step.agent);
      if (!inst) return;
      const o = out(`${inst.name} finished: ${step.task}.`, step.agent === "code_reviewer" ? [{ severity: "medium", title: "Mock finding", detail: "Generated by the mock kernel." }] : []);
      inst.state = "completed";
      inst.finishedAt = now();
      inst.output = o;
      ws.checkpoint.completedSteps[step.id] = { instanceId: inst.instanceId, agentId: inst.agentId, output: o };
      outs.push({ agentId: inst.agentId, instanceId: inst.instanceId, output: o });
      publish("agent.finished", { agentId: inst.agentId, instanceId: inst.instanceId, name: inst.name, workspaceId: ws.id }, ws.id, "orchestrator");
      publish("workspace.checkpoint", { workspaceId: ws.id, step: step.id }, ws.id, "orchestrator");
    });
    ws.report = { workspaceId: ws.id, summary: `Commander merged ${outs.length} outputs for "${ws.text}".`, outputs: outs, conflicts: [], findings: outs.flatMap((o) => o.output.findings) };
    ws.completedAt = now();
    setWsStatus(ws, "completed");
    publish("workspace.completed", { workspaceId: ws.id, label: ws.label }, ws.id, "commander");
  }, 3500);
  return ws;
}

function archiveWorkspace(id: string): Workspace | undefined {
  const ws = workspaces.get(id);
  if (!ws) return undefined;
  setWsStatus(ws, "archived");
  for (const i of instances.values()) if (i.workspaceId === id && ["completed", "failed", "terminated"].includes(i.state)) i.state = "archived";
  publish("workspace.archived", { workspaceId: id, label: ws.label }, id, "workspace");
  return ws;
}

function status(): KernelStatus {
  const byType: Record<string, number> = {};
  for (const n of nodes.values()) byType[n.type] = (byType[n.type] ?? 0) + 1;
  const running = [...instances.values()].filter((i) => i.state === "active" || i.state === "collaborating").length;
  return {
    version: "0.1.0-mock",
    root: "/projects/bof4-remake",
    mode: "offline",
    model: "claude-opus-5",
    startedAt: at(0),
    graph: { nodes: nodes.size, edges: edges.length, byType },
    files: Object.keys(FILES).length - 1,
    agents: { catalog: AGENT_CATALOG.length, running },
    workspaces: { total: workspaces.size, running: [...workspaces.values()].filter((w) => w.status === "running").length },
    mcp: [...mcpStatus.values()],
    pendingApprovals: [...approvals.values()].filter((a) => a.status === "pending").length,
    toolPolicy: policy.mode,
    halted,
    governor: governor(),
    audit: { entries: audit.length, chainOk: true },
  };
}

function governor() {
  const running = [...instances.values()].filter((i) => i.state === "active" || i.state === "collaborating").length;
  return { lanes: 4, maxLanes: 4, running, queued: [...instances.values()].filter((i) => i.state === "summoned").length, circuit: "closed" as const };
}

// ---------------------------------------------------------------------------------------------------------
// Background activity so the canvas has something live to show.

const TICKS: (() => void)[] = [
  () => {
    const i = [...instances.values()].find((x) => x.workspaceId === "ws_feature" && x.agentId === "fullstack_engineer");
    if (!i || i.state === "completed") return;
    i.state = i.state === "active" ? "collaborating" : "active";
    publish("agent.state", { agentId: i.agentId, instanceId: i.instanceId, name: i.name, state: i.state, workspaceId: "ws_feature" }, "ws_feature", "orchestrator");
  },
  () => publish("tool.called", { tool: "fs.read_file", path: "src/inventory/inventory.ts", workspaceId: "ws_feature" }, "ws_feature", "tools"),
  () => publish("file.updated", { path: "src/combat/damage_calc.ts" }, undefined, "watcher"),
  () => publish("trigger.fired", { rule: "review-on-change", agentId: "code_reviewer", path: "src/combat/damage_calc.ts" }, undefined, "triggers"),
  () => publish("memory.updated", { key: "inventory-storage", category: "architecture_decision" }, undefined, "memory"),
  () => publish("tool.result", { tool: "fs.read_file", ok: true, workspaceId: "ws_feature" }, "ws_feature", "tools"),
];
let tick = 0;
publish("kernel.started", { version: "0.1.0-mock", mode: "offline" });
publish("mcp.connected", { name: "github", tools: 2 }, undefined, "mcp");
publish("workspace.generated", { workspace: { id: "ws_feature", label: "Feature build", intent: "feature_build" } }, "ws_feature", "workspace");
publish("tool.approval_requested", { id: "apr_1", tool: "proc.run_tests", workspaceId: "ws_feature" }, "ws_feature", "tools");
const interval = setInterval(() => {
  if (!halted) TICKS[tick++ % TICKS.length]();
}, Number(process.env.MOCK_TICK_MS ?? 2500));

// ---------------------------------------------------------------------------------------------------------
// HTTP

const requestLog: { method: string; path: string; ts: string }[] = [];

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(json);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function serveStatic(res: ServerResponse, urlPath: string) {
  let rel = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, "");
  if (rel.includes("..")) rel = "";
  let file = join(DIST, rel);
  if (!rel || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
  if (!existsSync(file)) {
    res.writeHead(503, { "Content-Type": "text/plain" });
    res.end("web/dist not built. Run: npx vite build --config web/vite.config.ts");
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}

function neighborsOf(id: string): NodeDetail {
  const node = nodes.get(id);
  if (!node) throw new HttpError(404, `No node ${id}`);
  const es = edges.filter((e) => e.source === id || e.target === id);
  const ids = new Set(es.map((e) => (e.source === id ? e.target : e.source)));
  return { node, edges: es, neighbors: [...ids].map((x) => nodes.get(x)!).filter(Boolean) };
}

function graphSlice(q: URLSearchParams): GraphSlice {
  const types = q.get("types")?.split(",").filter(Boolean);
  const limit = Number(q.get("limit") ?? 500);
  const rootId = q.get("rootId");
  let list = [...nodes.values()];
  if (rootId) {
    const depth = Number(q.get("depth") ?? 2);
    const seen = new Set([rootId]);
    let frontier = [rootId];
    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const f of frontier)
        for (const e of edges) {
          const o = e.source === f ? e.target : e.target === f ? e.source : null;
          if (o && !seen.has(o)) {
            seen.add(o);
            next.push(o);
          }
        }
      frontier = next;
    }
    list = list.filter((n) => seen.has(n.id));
  }
  if (types?.length) list = list.filter((n) => types.includes(n.type));
  list = list.slice(0, limit);
  const ids = new Set(list.map((n) => n.id));
  return { nodes: list, edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const method = req.method ?? "GET";
  const p = url.pathname;
  const q = url.searchParams;

  if (!p.startsWith("/api/") && p !== "/__mock/requests") return serveStatic(res, p);
  requestLog.push({ method, path: p + url.search, ts: now() });

  // Contract rules: same-origin only; mutations need the client header.
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}`) throw new HttpError(403, `Origin ${origin} not allowed`);
  if (method !== "GET" && req.headers["x-nalara-client"] !== "1") throw new HttpError(403, "Missing X-Nalara-Client header");

  if (p === "/__mock/requests") return send(res, 200, requestLog);

  const seg = p.split("/").slice(2).map(decodeURIComponent); // after /api/
  const body = method === "GET" || method === "DELETE" ? {} : await readBody(req);
  const [a, b, c] = seg;

  // --- status, graph -----------------------------------------------------------------------------------
  if (method === "GET" && a === "status") return send(res, 200, status());
  if (method === "GET" && a === "graph") return send(res, 200, graphSlice(q));
  if (method === "GET" && a === "nodes" && b) return send(res, 200, neighborsOf(b));

  // --- intents -------------------------------------------------------------------------------------------
  if (method === "POST" && a === "intents" && b === "classify") {
    const text = String(body.text ?? "").trim();
    if (!text) throw new HttpError(400, "text is required");
    return send(res, 200, classify(text));
  }
  if (method === "POST" && a === "intents" && !b) {
    const text = String(body.text ?? "").trim();
    if (!text) throw new HttpError(400, "text is required");
    if (halted) throw new HttpError(409, "Kernel is halted");
    const ws = submitIntent(text, body.run !== false);
    return send(res, 200, { workspace: ws });
  }

  // --- workspaces -----------------------------------------------------------------------------------------
  if (a === "workspaces") {
    if (method === "GET" && !b) return send(res, 200, [...workspaces.values()].sort((x, y) => x.createdAt.localeCompare(y.createdAt)));
    const ws = b ? workspaces.get(b) : undefined;
    if (b && !ws) throw new HttpError(404, `No workspace ${b}`);
    if (method === "GET" && ws && !c) {
      const detail: WorkspaceDetail = { workspace: ws, instances: [...instances.values()].filter((i) => i.workspaceId === ws.id) };
      return send(res, 200, detail);
    }
    if (method === "POST" && ws && c === "run") {
      if (halted) throw new HttpError(409, "Kernel is halted");
      for (const i of instances.values()) if (i.workspaceId === ws.id && i.state === "dormant") i.state = "summoned";
      if (![...instances.values()].some((i) => i.workspaceId === ws.id))
        for (const ag of ws.agents) newInstance(ag, ws.id, "summoned", ws.plan.find((s) => s.agent === ag)?.task ?? "", 0).startedAt = now();
      runWorkspace(ws.id);
      return send(res, 200, { workspace: ws });
    }
    if (method === "POST" && ws && c === "archive") return send(res, 200, { workspace: archiveWorkspace(ws.id) });
    if (method === "POST" && ws && c === "undo") {
      const restored = journal.filter((j) => j.principal.workspaceId === ws.id && !j.undone).map((j) => j.path);
      publish("journal.undone", { workspaceId: ws.id, restored }, ws.id, "journal");
      return send(res, 200, { restored, skipped: ws.id === "ws_feature" ? [{ path: "src/inventory/inventory.ts", reason: "changed since the write" }] : [] });
    }
  }

  // --- agents ----------------------------------------------------------------------------------------------
  if (a === "agents") {
    if (method === "GET" && !b) return send(res, 200, AGENT_CATALOG);
    if (method === "GET" && b === "instances") {
      const wid = q.get("workspaceId");
      return send(res, 200, [...instances.values()].filter((i) => !wid || i.workspaceId === wid));
    }
    if (method === "GET" && b === "performance")
      return send(res, 200, AGENT_CATALOG.slice(5, 12).map((d, i) => ({ agentId: d.id, runs: 3 + i, successes: 3 + i, failures: i % 2, avgDurationMs: 30000 + i * 1000, lastRunAt: at(30) })));
    if (method === "POST" && b === "instances" && seg[3] === "terminate") {
      const inst = instances.get(c);
      if (!inst) throw new HttpError(404, `No instance ${c}`);
      inst.state = "terminated";
      publish("agent.state", { agentId: inst.agentId, instanceId: inst.instanceId, state: "terminated" }, inst.workspaceId, "orchestrator");
      return send(res, 200, { ok: true });
    }
    if (method === "POST" && b && c === "run") {
      if (!AGENT_CATALOG.some((d) => d.id === b)) throw new HttpError(404, `No agent ${b}`);
      if (halted) throw new HttpError(409, "Kernel is halted");
      const inst = newInstance(b, typeof body.workspaceId === "string" ? body.workspaceId : undefined, "active", String(body.task ?? ""), 0);
      inst.startedAt = now();
      publish("agent.summoned", { agentId: b, instanceId: inst.instanceId, name: inst.name }, inst.workspaceId, "orchestrator");
      return send(res, 200, { instance: inst });
    }
  }

  // --- radial ----------------------------------------------------------------------------------------------
  if (a === "radial" && b) {
    if (method === "GET" && !c) {
      const m = radialFor(b);
      if (!m) throw new HttpError(404, `No node ${b}`);
      return send(res, 200, m);
    }
    if (method === "POST" && c) {
      const m = radialFor(b);
      const action = m?.actions.find((x) => x.id === c);
      if (!m || !action) throw new HttpError(404, `No action ${c} on ${b}`);
      if (!action.enabled) throw new HttpError(409, action.hint ?? "Action disabled");
      return send(res, 200, radialAction(b, c));
    }
  }

  // --- search, files, concepts -------------------------------------------------------------------------------
  if (method === "GET" && a === "search") return send(res, 200, search(q.get("q") ?? "", Number(q.get("limit") ?? 20)));
  if (method === "GET" && a === "concepts") return send(res, 200, Object.entries(CONCEPTS).map(([id, c2]) => ({ id, name: c2.name, files: c2.files })));
  if (method === "GET" && a === "files" && b === "content") {
    const path = q.get("path") ?? "";
    if (!(path in FILES)) throw new HttpError(404, `No file ${path}`);
    return send(res, 200, { path, content: FILES[path], kind: kindOf(path) });
  }

  // --- memory ------------------------------------------------------------------------------------------------
  if (a === "memory") {
    if (method === "GET" && !b) {
      const cat = q.get("category");
      const text = (q.get("q") ?? "").toLowerCase();
      const includeProposed = q.get("includeProposed") === "true" || q.get("includeProposed") === "1";
      const list = [...memory.values()].filter(
        (r) => (!cat || r.category === cat) && (!text || `${r.key} ${r.content} ${r.tags.join(" ")}`.toLowerCase().includes(text)) && (includeProposed || r.status === "active"),
      );
      return send(res, 200, list.slice(0, Number(q.get("limit") ?? 100)));
    }
    if (method === "POST" && !b) {
      if (!body.category || !body.key || !body.content) throw new HttpError(400, "category, key and content are required");
      const r = remember(body.category as MemoryCategory, String(body.key), String(body.content), "user", Array.isArray(body.tags) ? (body.tags as string[]) : []);
      publish("memory.updated", { id: r.id, key: r.key, category: r.category }, undefined, "memory");
      return send(res, 200, r);
    }
    if (method === "POST" && b && c === "confirm") {
      const r = memory.get(b);
      if (!r) throw new HttpError(404, `No memory ${b}`);
      r.status = "active";
      r.updatedAt = now();
      appendAudit({ kind: "memory_confirm", principal: null, subject: r.id, outcome: "ok", detail: { key: r.key } });
      publish("memory.updated", { id: r.id, key: r.key, status: "active" }, undefined, "memory");
      return send(res, 200, r);
    }
    if (method === "DELETE" && b) {
      const ok = memory.delete(b);
      if (ok) publish("memory.updated", { id: b, removed: true }, undefined, "memory");
      return send(res, 200, { ok });
    }
  }

  // --- tools, MCP ----------------------------------------------------------------------------------------------
  if (method === "GET" && a === "tools") {
    const server = q.get("server");
    const action = q.get("action");
    return send(res, 200, TOOLS.filter((t) => (!server || t.server === server) && (!action || t.action === action)));
  }
  if (method === "POST" && a === "tools" && b && c === "call") {
    const t = TOOLS.find((x) => x.name === b);
    if (!t) throw new HttpError(404, `No tool ${b}`);
    return send(res, 200, { ok: t.reversibility === "reversible", content: t.reversibility === "reversible" ? `${b}: ok (mock)` : `${b} needs approval`, error: t.reversibility === "reversible" ? undefined : "approval_required" });
  }
  if (a === "mcp") {
    if (method === "GET" && !b) return send(res, 200, [...mcpStatus.values()]);
    if (method === "POST" && !b) {
      const name = String(body.name ?? "").trim();
      const cfg = (body.config ?? {}) as { command?: string; url?: string };
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new HttpError(400, "name must match [a-zA-Z0-9_-]+");
      if (!cfg.command && !cfg.url) throw new HttpError(400, "config.command or config.url is required");
      const st: McpServerStatus = { name, status: "connected", transport: cfg.url ? "http" : "stdio", tools: [`mcp.${name}.search`], connectedAt: now() };
      mcpStatus.set(name, st);
      upsertNode(`mcp:${name}`, "mcp", name, { server: name, status: "connected" }, undefined, true);
      publish("mcp.connected", { name, tools: st.tools.length }, undefined, "mcp");
      return send(res, 200, st);
    }
    if (method === "DELETE" && b) {
      const ok = mcpStatus.delete(b);
      if (ok) {
        nodes.delete(`mcp:${b}`);
        for (let i = edges.length - 1; i >= 0; i--) if (edges[i].source === `mcp:${b}` || edges[i].target === `mcp:${b}`) edges.splice(i, 1);
        publish("mcp.disconnected", { name: b }, undefined, "mcp");
        publish("node.removed", { id: `mcp:${b}` }, undefined, "graph");
      }
      return send(res, 200, { ok });
    }
  }

  // --- approvals, policy, triggers, workflows ---------------------------------------------------------------
  if (a === "approvals") {
    if (method === "GET" && !b) {
      const st = q.get("status");
      return send(res, 200, [...approvals.values()].filter((x) => !st || x.status === st));
    }
    if (method === "POST" && b) {
      const ap = approvals.get(b);
      if (!ap) throw new HttpError(404, `No approval ${b}`);
      if (ap.status !== "pending") throw new HttpError(409, `Approval ${b} is ${ap.status}`);
      ap.status = body.approved === true ? "approved" : "denied";
      ap.resolvedAt = now();
      appendAudit({ kind: "approval", principal: ap.principal, subject: ap.tool, outcome: ap.status === "approved" ? "allowed" : "denied", detail: { id: ap.id } });
      publish("tool.approval_resolved", { id: ap.id, tool: ap.tool, status: ap.status }, ap.principal.workspaceId, "tools");
      return send(res, 200, ap);
    }
  }
  if (a === "policy") {
    if (method === "GET") return send(res, 200, policy);
    if (method === "PUT") {
      if (!["auto", "ask", "readonly"].includes(String(body.mode))) throw new HttpError(400, "mode must be auto, ask or readonly");
      policy = { ...policy, ...(body as Partial<ToolPolicy>) } as ToolPolicy;
      appendAudit({ kind: "policy", principal: null, subject: "policy", outcome: "info", detail: { mode: policy.mode } });
      return send(res, 200, policy);
    }
  }
  if (a === "triggers") {
    if (method === "GET" && !b) return send(res, 200, [...triggers.values()]);
    if (method === "PUT" && b) {
      const t = triggers.get(b);
      if (!t) throw new HttpError(404, `No trigger ${b}`);
      t.enabled = body.enabled === true;
      return send(res, 200, t);
    }
  }
  if (a === "workflows") {
    if (method === "GET" && !b) return send(res, 200, WORKFLOWS);
    if (method === "POST" && b && c === "run") {
      if (!WORKFLOWS.some((w) => w.id === b)) throw new HttpError(404, `No workflow ${b}`);
      submitIntent("Review inventory module", true);
      return send(res, 200, { started: true });
    }
  }

  // --- kernel, audit, journal, governor, events ------------------------------------------------------------
  if (a === "kernel" && method === "POST" && b === "halt") {
    halted = true;
    let n = 0;
    for (const i of instances.values())
      if (["active", "collaborating", "summoned"].includes(i.state)) {
        i.state = "terminated";
        n++;
      }
    for (const ap of approvals.values())
      if (ap.status === "pending") {
        ap.status = "denied";
        ap.resolvedAt = now();
      }
    appendAudit({ kind: "halt", principal: null, subject: "kernel", outcome: "info", detail: { reason: body.reason ?? "", terminated: n } });
    publish("kernel.halted", { reason: body.reason ?? "", terminated: n });
    return send(res, 200, status());
  }
  if (a === "kernel" && method === "POST" && b === "resume") {
    halted = false;
    appendAudit({ kind: "resume", principal: null, subject: "kernel", outcome: "info", detail: {} });
    publish("kernel.resumed", {});
    return send(res, 200, status());
  }
  if (method === "GET" && a === "audit") {
    const since = Number(q.get("since") ?? 0);
    const limit = Number(q.get("limit") ?? 100);
    return send(res, 200, { entries: audit.filter((e) => e.seq > since).slice(-limit), chainBrokenAt: null });
  }
  if (method === "GET" && a === "journal") return send(res, 200, journal.filter((j) => !q.get("workspaceId") || j.principal.workspaceId === q.get("workspaceId")));
  if (method === "GET" && a === "governor") return send(res, 200, governor());
  if (method === "GET" && a === "events" && b === "stream") {
    const since = Number(q.get("since") ?? req.headers["last-event-id"] ?? 0);
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write(": connected\n\n");
    for (const ev of events.filter((e) => e.seq > since).slice(-300)) res.write(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`);
    sseClients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => {
      clearInterval(ping);
      sseClients.delete(res);
    });
    return;
  }
  if (method === "GET" && a === "events" && !b) {
    const since = Number(q.get("since") ?? 0);
    const corr = q.get("correlationId");
    return send(res, 200, events.filter((e) => e.seq > since && (!corr || e.correlationId === corr)).slice(-Number(q.get("limit") ?? 200)));
  }

  throw new HttpError(404, `No route ${method} ${p}`);
}

const server = createServer((req, res) => {
  route(req, res).catch((err: unknown) => {
    const status = err instanceof HttpError ? err.status : 500;
    if (!(err instanceof HttpError) && !QUIET) console.error(err);
    if (!res.headersSent) send(res, status, { error: (err as Error).message });
    else res.end();
  });
});

server.listen(PORT, HOST, () => {
  if (!QUIET) console.log(`Nalara mock kernel on http://${HOST}:${PORT} (serving ${DIST})`);
});

function shutdown() {
  clearInterval(interval);
  for (const c of sseClients) c.end();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

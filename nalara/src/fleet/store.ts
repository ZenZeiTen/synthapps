/**
 * Fleet store: the durable side of the process tree and of fleet memory.
 *
 * - fleet_nodes: one row per agent instance (parent, step, round, role, state, usage). Instances live in memory in
 *   the orchestrator; their lineage outlives the process here, so a workspace's tree can be shown after a restart.
 * - fleet_records: one row per reviewed step (verdict, rounds, files, open challenges). Later fleets that touch the
 *   same files are told what earlier fleets proved and what they left open, as data.
 */
import type { Database } from "../kernel/db";
import { newId, nowIso } from "../kernel/ids";
import type { AgentUsage, FleetNode, FleetRecord, FleetRole, FleetTree, StepReview, WorkspaceUsage } from "../kernel/types";

type Row = Record<string, unknown>;

export type { FleetTree, WorkspaceUsage };

export interface FleetStore {
  upsertNode(node: Omit<FleetNode, "createdAt" | "updatedAt">): FleetNode;
  updateNode(instanceId: string, patch: Partial<Pick<FleetNode, "state" | "summary" | "usage" | "task">>): FleetNode | undefined;
  node(instanceId: string): FleetNode | undefined;
  nodes(filter?: { workspaceId?: string; parentInstanceId?: string; limit?: number }): FleetNode[];
  tree(workspaceId: string): FleetTree;
  usageByWorkspace(): WorkspaceUsage[];
  recordReview(review: StepReview, files: string[], summary: string): FleetRecord;
  /** Records for any of the files (newest first), or all records of a workspace. */
  records(query?: { files?: string[]; workspaceId?: string; limit?: number }): FleetRecord[];
}

const zeroUsage = (): AgentUsage => ({ inputTokens: 0, outputTokens: 0, toolCalls: 0, turns: 0, wallMs: 0 });

function parse<T>(raw: unknown, fallback: T): T {
  try {
    return raw === null || raw === undefined ? fallback : (JSON.parse(String(raw)) as T);
  } catch {
    return fallback;
  }
}

const toNode = (r: Row): FleetNode => ({
  instanceId: String(r.instance_id),
  agentId: String(r.agent_id),
  name: String(r.name),
  ...(r.workspace_id ? { workspaceId: String(r.workspace_id) } : {}),
  ...(r.parent_instance_id ? { parentInstanceId: String(r.parent_instance_id) } : {}),
  ...(r.step_id ? { stepId: String(r.step_id) } : {}),
  ...(r.round !== null && r.round !== undefined ? { round: Number(r.round) } : {}),
  role: String(r.role) as FleetRole,
  state: String(r.state) as FleetNode["state"],
  chain: parse<string[]>(r.chain, []),
  depth: Number(r.depth),
  ...(r.task ? { task: String(r.task) } : {}),
  ...(r.summary ? { summary: String(r.summary) } : {}),
  usage: { ...zeroUsage(), ...parse<Partial<AgentUsage>>(r.usage, {}) },
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

const toRecord = (r: Row): FleetRecord => ({
  id: String(r.id),
  workspaceId: String(r.workspace_id),
  stepId: String(r.step_id),
  agentId: String(r.agent_id),
  verdict: String(r.verdict) as FleetRecord["verdict"],
  rounds: Number(r.rounds),
  files: parse<string[]>(r.files, []),
  summary: String(r.summary),
  open: parse<FleetRecord["open"]>(r.open_items, []),
  createdAt: String(r.created_at),
});

const MAX_TASK_CHARS = 2000;
const MAX_SUMMARY_CHARS = 500;

export function createFleetStore(opts: { db: Database }): FleetStore {
  const { db } = opts;
  db.exec(`CREATE TABLE IF NOT EXISTS fleet_nodes (
    instance_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    name TEXT NOT NULL,
    workspace_id TEXT,
    parent_instance_id TEXT,
    step_id TEXT,
    round INTEGER,
    role TEXT NOT NULL,
    state TEXT NOT NULL,
    chain TEXT NOT NULL,
    depth INTEGER NOT NULL,
    task TEXT,
    summary TEXT,
    usage TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS fleet_nodes_workspace ON fleet_nodes(workspace_id);
  CREATE INDEX IF NOT EXISTS fleet_nodes_parent ON fleet_nodes(parent_instance_id);
  CREATE TABLE IF NOT EXISTS fleet_records (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    verdict TEXT NOT NULL,
    rounds INTEGER NOT NULL,
    files TEXT NOT NULL,
    summary TEXT NOT NULL,
    open_items TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS fleet_record_files (
    record_id TEXT NOT NULL,
    path TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS fleet_record_files_path ON fleet_record_files(path);`);

  const insertNode = db.prepare(`INSERT INTO fleet_nodes
    (instance_id, agent_id, name, workspace_id, parent_instance_id, step_id, round, role, state, chain, depth, task, summary, usage, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(instance_id) DO UPDATE SET state = excluded.state, task = excluded.task, summary = excluded.summary, usage = excluded.usage, updated_at = excluded.updated_at`);
  const getNode = db.prepare("SELECT * FROM fleet_nodes WHERE instance_id = ?");
  const insertRecord = db.prepare("INSERT INTO fleet_records (id, workspace_id, step_id, agent_id, verdict, rounds, files, summary, open_items, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const insertRecordFile = db.prepare("INSERT INTO fleet_record_files (record_id, path) VALUES (?, ?)");

  function node(instanceId: string): FleetNode | undefined {
    const row = getNode.get(instanceId) as Row | undefined;
    return row ? toNode(row) : undefined;
  }

  function upsertNode(n: Omit<FleetNode, "createdAt" | "updatedAt">): FleetNode {
    const now = nowIso();
    const existing = node(n.instanceId);
    insertNode.run(
      n.instanceId,
      n.agentId,
      n.name,
      n.workspaceId ?? null,
      n.parentInstanceId ?? null,
      n.stepId ?? null,
      n.round ?? null,
      n.role,
      n.state,
      JSON.stringify(n.chain),
      n.depth,
      n.task ? n.task.slice(0, MAX_TASK_CHARS) : null,
      n.summary ? n.summary.slice(0, MAX_SUMMARY_CHARS) : null,
      JSON.stringify(n.usage),
      existing?.createdAt ?? now,
      now,
    );
    return node(n.instanceId)!;
  }

  function nodes(filter: { workspaceId?: string; parentInstanceId?: string; limit?: number } = {}): FleetNode[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (filter.workspaceId) {
      where.push("workspace_id = ?");
      args.push(filter.workspaceId);
    }
    if (filter.parentInstanceId) {
      where.push("parent_instance_id = ?");
      args.push(filter.parentInstanceId);
    }
    const sql = `SELECT * FROM fleet_nodes${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at, rowid LIMIT ?`;
    return (db.prepare(sql).all(...args, filter.limit ?? 10_000) as Row[]).map(toNode);
  }

  return {
    upsertNode,
    updateNode(instanceId, patch) {
      const current = node(instanceId);
      if (!current) return undefined;
      return upsertNode({ ...current, ...patch });
    },
    node,
    nodes,
    tree(workspaceId) {
      const list = nodes({ workspaceId });
      const ids = new Set(list.map((n) => n.instanceId));
      const edges = list.filter((n) => n.parentInstanceId && ids.has(n.parentInstanceId)).map((n) => ({ parent: n.parentInstanceId!, child: n.instanceId }));
      const roots = list.filter((n) => !n.parentInstanceId || !ids.has(n.parentInstanceId)).map((n) => n.instanceId);
      return { workspaceId, nodes: list, edges, roots };
    },
    usageByWorkspace() {
      const out = new Map<string, WorkspaceUsage>();
      for (const n of (db.prepare("SELECT * FROM fleet_nodes WHERE workspace_id IS NOT NULL ORDER BY created_at").all() as Row[]).map(toNode)) {
        const w = out.get(n.workspaceId!) ?? { workspaceId: n.workspaceId!, agents: 0, byRole: {}, usage: zeroUsage(), failed: 0, lastActivity: n.updatedAt };
        w.agents++;
        w.byRole[n.role] = (w.byRole[n.role] ?? 0) + 1;
        for (const k of Object.keys(w.usage) as (keyof AgentUsage)[]) w.usage[k] += n.usage[k] ?? 0;
        if (n.state === "failed" || n.state === "terminated") w.failed++;
        if (n.updatedAt > w.lastActivity) w.lastActivity = n.updatedAt;
        out.set(n.workspaceId!, w);
      }
      return [...out.values()].sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
    },
    recordReview(review, files, summary) {
      const record: FleetRecord = {
        id: newId("fr"),
        workspaceId: review.workspaceId,
        stepId: review.stepId,
        agentId: review.builderId,
        verdict: review.verdict,
        rounds: review.rounds,
        files: [...new Set(files)].slice(0, 200),
        summary: summary.slice(0, MAX_SUMMARY_CHARS),
        open: review.open.map((c) => ({ severity: c.finding.severity, title: c.finding.title.slice(0, 200), ...(c.finding.file ? { file: c.finding.file } : {}), ...(c.finding.line ? { line: c.finding.line } : {}) })),
        createdAt: nowIso(),
      };
      insertRecord.run(record.id, record.workspaceId, record.stepId, record.agentId, record.verdict, record.rounds, JSON.stringify(record.files), record.summary, JSON.stringify(record.open), record.createdAt);
      for (const f of record.files) insertRecordFile.run(record.id, f);
      return record;
    },
    records(query = {}) {
      const limit = query.limit ?? 50;
      if (query.files?.length) {
        const files = [...new Set(query.files)].slice(0, 500);
        const rows = db
          .prepare(`SELECT DISTINCT r.* FROM fleet_records r JOIN fleet_record_files f ON f.record_id = r.id WHERE f.path IN (${files.map(() => "?").join(",")})${query.workspaceId ? " AND r.workspace_id = ?" : ""} ORDER BY r.created_at DESC, r.rowid DESC LIMIT ?`)
          .all(...files, ...(query.workspaceId ? [query.workspaceId] : []), limit) as Row[];
        return rows.map(toRecord);
      }
      const rows = db
        .prepare(`SELECT * FROM fleet_records${query.workspaceId ? " WHERE workspace_id = ?" : ""} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
        .all(...(query.workspaceId ? [query.workspaceId] : []), limit) as Row[];
      return rows.map(toRecord);
    },
  };
}

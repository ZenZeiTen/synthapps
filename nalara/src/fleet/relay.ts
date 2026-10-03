/**
 * Message relay: inter-agent communication as a kernel primitive.
 *
 * Agents have no messaging tool and no handle to each other. Spawns, handoffs, challenges, verdicts and results are
 * sent by the orchestrator on their behalf through this relay, which numbers, persists, budgets and audits every
 * message and publishes it as `relay.message`. A message body that came from an agent is untrusted data; whoever
 * receives it gets it wrapped as data, never as instructions.
 */
import type { Database } from "../kernel/db";
import { newId, nowIso } from "../kernel/ids";
import type { AuditLog, EventBus, RelayKind, RelayMessage, RelayQuery } from "../kernel/types";

export const MAX_RELAY_BODY_CHARS = 4000;
const MAX_REFS = 50;

/** The fleet's message budget is spent: the message was not sent. */
export class RelayBudgetError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "RelayBudgetError";
  }
}

export interface RelaySendInput {
  workspaceId?: string;
  kind: RelayKind;
  from: string;
  to: string;
  fromInstanceId?: string;
  toInstanceId?: string;
  stepId?: string;
  round?: number;
  body: string;
  refs?: string[];
  data?: Record<string, unknown>;
}

export interface Relay {
  /** Throws RelayBudgetError when the workspace's fleet message budget is spent. */
  send(input: RelaySendInput): RelayMessage;
  list(query?: RelayQuery): RelayMessage[];
  count(workspaceId: string): number;
}

type Row = Record<string, unknown>;

const toMessage = (r: Row): RelayMessage => ({
  id: String(r.id),
  seq: Number(r.seq),
  ts: String(r.ts),
  ...(r.workspace_id ? { workspaceId: String(r.workspace_id) } : {}),
  kind: String(r.kind) as RelayKind,
  from: String(r.sender),
  to: String(r.recipient),
  ...(r.from_instance_id ? { fromInstanceId: String(r.from_instance_id) } : {}),
  ...(r.to_instance_id ? { toInstanceId: String(r.to_instance_id) } : {}),
  ...(r.step_id ? { stepId: String(r.step_id) } : {}),
  ...(r.round !== null && r.round !== undefined ? { round: Number(r.round) } : {}),
  body: String(r.body),
  refs: JSON.parse(String(r.refs)) as string[],
  data: JSON.parse(String(r.data)) as Record<string, unknown>,
});

export function createRelay(opts: {
  db: Database;
  bus: EventBus;
  audit: AuditLog;
  /** Budget gate (the governor's fleet message budget). Returns the reason when the message must not be sent. */
  charge?: (workspaceId: string) => string | undefined;
}): Relay {
  const { db, bus, audit } = opts;
  db.exec(`CREATE TABLE IF NOT EXISTS relay_messages (
    seq INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    ts TEXT NOT NULL,
    workspace_id TEXT,
    kind TEXT NOT NULL,
    sender TEXT NOT NULL,
    recipient TEXT NOT NULL,
    from_instance_id TEXT,
    to_instance_id TEXT,
    step_id TEXT,
    round INTEGER,
    body TEXT NOT NULL,
    refs TEXT NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS relay_messages_workspace ON relay_messages(workspace_id);`);
  const insert = db.prepare(
    "INSERT INTO relay_messages (seq, id, ts, workspace_id, kind, sender, recipient, from_instance_id, to_instance_id, step_id, round, body, refs, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const head = db.prepare("SELECT MAX(seq) AS seq FROM relay_messages").get() as { seq: number | null };
  let seq = head.seq ?? 0;

  return {
    send(input) {
      if (input.workspaceId && opts.charge) {
        const reason = opts.charge(input.workspaceId);
        if (reason) {
          audit.append({ kind: "relay", principal: null, subject: input.workspaceId, outcome: "denied", detail: { kind: input.kind, from: input.from, to: input.to, reason } });
          throw new RelayBudgetError(reason);
        }
      }
      const message: RelayMessage = {
        id: newId("msg"),
        seq: ++seq,
        ts: nowIso(),
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        kind: input.kind,
        from: input.from,
        to: input.to,
        ...(input.fromInstanceId ? { fromInstanceId: input.fromInstanceId } : {}),
        ...(input.toInstanceId ? { toInstanceId: input.toInstanceId } : {}),
        ...(input.stepId ? { stepId: input.stepId } : {}),
        ...(input.round !== undefined ? { round: input.round } : {}),
        body: String(input.body ?? "").slice(0, MAX_RELAY_BODY_CHARS),
        refs: [...new Set(input.refs ?? [])].slice(0, MAX_REFS),
        data: input.data ?? {},
      };
      insert.run(
        message.seq,
        message.id,
        message.ts,
        message.workspaceId ?? null,
        message.kind,
        message.from,
        message.to,
        message.fromInstanceId ?? null,
        message.toInstanceId ?? null,
        message.stepId ?? null,
        message.round ?? null,
        message.body,
        JSON.stringify(message.refs),
        JSON.stringify(message.data),
      );
      audit.append({
        kind: "relay",
        principal: null,
        subject: message.workspaceId ?? message.to,
        outcome: "ok",
        detail: { id: message.id, seq: message.seq, kind: message.kind, from: message.from, to: message.to, stepId: message.stepId, round: message.round, refs: message.refs.length },
      });
      try {
        bus.publish("relay.message", message, { source: message.from, ...(message.workspaceId ? { correlationId: message.workspaceId } : {}) });
      } catch {
        // The bus must never undo a delivered message.
      }
      return message;
    },
    list(query = {}) {
      const where: string[] = [];
      const args: (string | number)[] = [];
      if (query.workspaceId) {
        where.push("workspace_id = ?");
        args.push(query.workspaceId);
      }
      if (query.instanceId) {
        where.push("(from_instance_id = ? OR to_instance_id = ?)");
        args.push(query.instanceId, query.instanceId);
      }
      const kinds = query.kind === undefined ? [] : Array.isArray(query.kind) ? query.kind : [query.kind];
      if (kinds.length) {
        where.push(`kind IN (${kinds.map(() => "?").join(",")})`);
        args.push(...kinds);
      }
      if (query.sinceSeq !== undefined) {
        where.push("seq > ?");
        args.push(query.sinceSeq);
      }
      const sql = `SELECT * FROM relay_messages${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY seq LIMIT ?`;
      return (db.prepare(sql).all(...args, query.limit ?? 500) as Row[]).map(toMessage);
    },
    count(workspaceId) {
      return Number((db.prepare("SELECT COUNT(*) AS n FROM relay_messages WHERE workspace_id = ?").get(workspaceId) as { n: number }).n);
    },
  };
}

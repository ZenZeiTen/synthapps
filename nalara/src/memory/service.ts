import type { Database } from "../kernel/db";
import { newId, nowIso } from "../kernel/ids";
import type { AgentPerformance, EventBus, MemoryCategory, MemoryRecord, MemoryService } from "../kernel/types";

type Row = Record<string, unknown>;

const STOP_WORDS = new Set(
  "a an and are as at be by for from has have in is it its of on or that the this to was were will with we you i our your not do does".split(" "),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

const toRecord = (r: Row): MemoryRecord => ({
  id: r.id as string,
  category: r.category as MemoryCategory,
  key: r.key as string,
  content: r.content as string,
  data: JSON.parse(r.data as string),
  tags: JSON.parse(r.tags as string),
  source: r.source as string,
  status: r.status as MemoryRecord["status"],
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

const PROPOSAL_KEY = /^(.*)#proposed:(\d+)$/;

/**
 * Memory records in SQLite (memory_records, unique on category + key).
 *
 * Frozen-weights rule: a source starting with "agent:" writes a "proposed" record. If an ACTIVE record
 * already holds that key, the agent's write never touches it: it is stored as a separate proposal under
 * `<key>#proposed:<n>`. confirm() on such a proposal copies its content into the active record and deletes
 * the proposal. Emits memory.updated `{ action, record }` (action: created | updated | proposed | confirmed | forgotten).
 */
export function createMemoryService(opts: { db: Database; bus?: EventBus }): MemoryService {
  const { db, bus } = opts;
  db.exec(`CREATE TABLE IF NOT EXISTS memory_records (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    key TEXT NOT NULL,
    content TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    tags TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (category, key)
  );`);

  const q = {
    byId: db.prepare("SELECT * FROM memory_records WHERE id = ?"),
    byKey: db.prepare("SELECT * FROM memory_records WHERE category = ? AND key = ?"),
    proposals: db.prepare("SELECT key FROM memory_records WHERE category = ? AND key LIKE ? ESCAPE '\\'"),
    insert: db.prepare(
      "INSERT INTO memory_records (id, category, key, content, data, tags, source, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ),
    update: db.prepare("UPDATE memory_records SET key = ?, content = ?, data = ?, tags = ?, source = ?, status = ?, updated_at = ? WHERE id = ?"),
    delete: db.prepare("DELETE FROM memory_records WHERE id = ?"),
  };

  const emit = (action: string, record: MemoryRecord | { id: string }) => bus?.publish("memory.updated", { action, record }, { source: "memory" });
  const get = (id: string) => {
    const row = q.byId.get(id) as Row | undefined;
    return row ? toRecord(row) : undefined;
  };
  const getByKey = (category: MemoryCategory, key: string) => {
    const row = q.byKey.get(category, key) as Row | undefined;
    return row ? toRecord(row) : undefined;
  };

  function insert(rec: Omit<MemoryRecord, "id" | "createdAt" | "updatedAt">): MemoryRecord {
    const now = nowIso();
    const record: MemoryRecord = { id: newId("mem"), ...rec, createdAt: now, updatedAt: now };
    q.insert.run(record.id, record.category, record.key, record.content, JSON.stringify(record.data), JSON.stringify(record.tags), record.source, record.status, now, now);
    return record;
  }

  function save(record: MemoryRecord): MemoryRecord {
    const next = { ...record, updatedAt: nowIso() };
    q.update.run(next.key, next.content, JSON.stringify(next.data), JSON.stringify(next.tags), next.source, next.status, next.updatedAt, next.id);
    return next;
  }

  function nextProposalKey(category: MemoryCategory, key: string): string {
    const like = `${key.replace(/[\\%_]/g, (c) => `\\${c}`)}#proposed:%`;
    let max = 0;
    for (const r of q.proposals.all(category, like) as Row[]) {
      const m = PROPOSAL_KEY.exec(r.key as string);
      if (m && m[1] === key) max = Math.max(max, Number(m[2]));
    }
    return `${key}#proposed:${max + 1}`;
  }

  const service: MemoryService = {
    remember(input) {
      const source = input.source ?? "platform";
      const status: MemoryRecord["status"] = source.startsWith("agent:") ? "proposed" : "active";
      const existing = getByKey(input.category, input.key);
      const fields = { content: input.content, data: input.data ?? existing?.data ?? {}, tags: input.tags ?? existing?.tags ?? [], source, status };

      if (!existing) {
        const record = insert({ category: input.category, key: input.key, ...fields });
        emit(status === "proposed" ? "proposed" : "created", record);
        return record;
      }
      if (status === "proposed" && existing.status === "active") {
        const record = insert({ category: input.category, key: nextProposalKey(input.category, input.key), ...fields });
        emit("proposed", record);
        return record;
      }
      const unchanged =
        existing.content === fields.content &&
        existing.source === fields.source &&
        existing.status === fields.status &&
        JSON.stringify(existing.data) === JSON.stringify(fields.data) &&
        JSON.stringify(existing.tags) === JSON.stringify(fields.tags);
      if (unchanged) return existing;
      const record = save({ ...existing, ...fields });
      emit(status === "proposed" ? "proposed" : "updated", record);
      return record;
    },

    get,

    recall(query = {}) {
      const where: string[] = [];
      const args: string[] = [];
      const categories = query.category === undefined ? [] : Array.isArray(query.category) ? query.category : [query.category];
      if (categories.length) {
        where.push(`category IN (${categories.map(() => "?").join(",")})`);
        args.push(...categories);
      }
      if (query.key !== undefined) {
        where.push("key = ?");
        args.push(query.key);
      }
      if (!query.includeProposed) where.push("status = 'active'");
      const sql = `SELECT * FROM memory_records ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC, id`;
      let records = (db.prepare(sql).all(...args) as Row[]).map(toRecord);
      if (query.tags?.length) records = records.filter((r) => query.tags!.every((t) => r.tags.includes(t)));

      const terms = query.text ? [...new Set(tokenize(query.text))] : [];
      if (terms.length) {
        const scored = records
          .map((r) => {
            const keyTokens = new Set(tokenize(r.key));
            const all = new Set([...keyTokens, ...tokenize(r.content), ...r.tags.flatMap(tokenize)]);
            // Distinct query terms found anywhere; a key hit counts a little extra.
            const score = terms.reduce((s, t) => s + (all.has(t) ? 1 : 0) + (keyTokens.has(t) ? 0.5 : 0), 0);
            return { r, score };
          })
          .filter((x) => x.score > 0);
        scored.sort((a, b) => b.score - a.score);
        records = scored.map((x) => x.r);
      }
      return records.slice(0, query.limit ?? 100);
    },

    confirm(id) {
      const record = get(id);
      if (!record || record.status === "active") return record;
      const m = PROPOSAL_KEY.exec(record.key);
      const base = m ? getByKey(record.category, m[1]) : undefined;
      let confirmed: MemoryRecord;
      if (base) {
        confirmed = save({ ...base, content: record.content, data: record.data, tags: record.tags, source: record.source, status: "active" });
        q.delete.run(record.id);
      } else {
        // The shadowed record is gone (or this never was a shadow): the proposal takes the plain key.
        confirmed = save({ ...record, key: m ? m[1] : record.key, status: "active" });
      }
      emit("confirmed", confirmed);
      return confirmed;
    },

    forget(id) {
      const removed = Number(q.delete.run(id).changes) > 0;
      if (removed) emit("forgotten", { id });
      return removed;
    },

    recordAgentRun(agentId, outcome) {
      const prev = getByKey("agent_performance", agentId);
      const p = (prev?.data ?? {}) as Partial<AgentPerformance>;
      const runs = (p.runs ?? 0) + 1;
      const prevAvg = p.avgDurationMs ?? 0;
      const perf: AgentPerformance = {
        agentId,
        runs,
        successes: (p.successes ?? 0) + (outcome.success ? 1 : 0),
        failures: (p.failures ?? 0) + (outcome.success ? 0 : 1),
        avgDurationMs: Math.round(prevAvg + (outcome.durationMs - prevAvg) / runs),
        lastRunAt: nowIso(),
      };
      service.remember({
        category: "agent_performance",
        key: agentId,
        content: `${agentId}: ${perf.runs} runs, ${perf.successes} succeeded, ${perf.failures} failed, avg ${perf.avgDurationMs} ms`,
        data: { ...perf, ...(outcome.workspaceId ? { lastWorkspaceId: outcome.workspaceId } : {}) },
        tags: ["agent", agentId],
        source: "platform",
      });
      return perf;
    },

    performance(agentId) {
      return service
        .recall({ category: "agent_performance", key: agentId, limit: 10_000 })
        .map((r) => {
          const d = r.data as Partial<AgentPerformance>;
          return {
            agentId: r.key,
            runs: d.runs ?? 0,
            successes: d.successes ?? 0,
            failures: d.failures ?? 0,
            avgDurationMs: d.avgDurationMs ?? 0,
            lastRunAt: d.lastRunAt ?? r.updatedAt,
          };
        })
        .sort((a, b) => a.agentId.localeCompare(b.agentId));
    },
  };
  return service;
}

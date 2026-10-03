import { createHash } from "node:crypto";
import type { Database } from "./db";
import { nowIso } from "./ids";
import type { AuditEntry, AuditLog } from "./types";

export const GENESIS_HASH = "0".repeat(64);

type Row = Record<string, unknown>;

/** JSON with object keys sorted at every level, so the hash does not depend on key order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

function hashEntry(entry: Omit<AuditEntry, "hash">): string {
  return createHash("sha256").update(entry.prevHash + canonicalJson(entry)).digest("hex");
}

const toEntry = (r: Row): AuditEntry => ({
  seq: Number(r.seq),
  ts: r.ts as string,
  kind: r.kind as AuditEntry["kind"],
  principal: JSON.parse(r.principal as string),
  subject: r.subject as string,
  outcome: r.outcome as AuditEntry["outcome"],
  detail: JSON.parse(r.detail as string),
  prevHash: r.prev_hash as string,
  hash: r.hash as string,
});

/**
 * Append-only, hash-chained ledger: hash = sha256(prevHash + canonical JSON of the entry without hash).
 * There is deliberately no update or delete API. verify() detects edited rows and gaps in seq; truncating
 * the newest rows is not detectable from the table alone (anchor the head hash elsewhere for that).
 */
export function createAuditLog(opts: { db: Database }): AuditLog {
  const { db } = opts;
  db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
    seq INTEGER PRIMARY KEY,
    ts TEXT NOT NULL,
    kind TEXT NOT NULL,
    principal TEXT NOT NULL,
    subject TEXT NOT NULL,
    outcome TEXT NOT NULL,
    detail TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS audit_log_subject ON audit_log(subject);`);

  const last = db.prepare("SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1");
  const insert = db.prepare("INSERT INTO audit_log (seq, ts, kind, principal, subject, outcome, detail, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");

  return {
    append(input) {
      const head = last.get() as Row | undefined;
      // Round-trip through JSON so the hashed form is exactly what verify() will read back.
      const principal = JSON.parse(JSON.stringify(input.principal ?? null));
      const detail = JSON.parse(JSON.stringify(input.detail ?? {}));
      const unhashed: Omit<AuditEntry, "hash"> = {
        seq: head ? Number(head.seq) + 1 : 1,
        ts: nowIso(),
        kind: input.kind,
        principal,
        subject: input.subject,
        outcome: input.outcome,
        detail,
        prevHash: head ? (head.hash as string) : GENESIS_HASH,
      };
      const entry: AuditEntry = { ...unhashed, hash: hashEntry(unhashed) };
      insert.run(entry.seq, entry.ts, entry.kind, JSON.stringify(principal), entry.subject, entry.outcome, JSON.stringify(detail), entry.prevHash, entry.hash);
      return entry;
    },

    list(query = {}) {
      const where: string[] = [];
      const args: (string | number)[] = [];
      if (query.sinceSeq !== undefined) {
        where.push("seq > ?");
        args.push(query.sinceSeq);
      }
      if (query.subject !== undefined) {
        where.push("subject = ?");
        args.push(query.subject);
      }
      const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
      if (query.limit === undefined) return (db.prepare(`SELECT * FROM audit_log ${filter} ORDER BY seq`).all(...args) as Row[]).map(toEntry);
      // Same convention as the event bus: with sinceSeq page forward, otherwise the newest `limit`.
      const order = query.sinceSeq !== undefined ? "ASC" : "DESC";
      const rows = (db.prepare(`SELECT * FROM audit_log ${filter} ORDER BY seq ${order} LIMIT ?`).all(...args, query.limit) as Row[]).map(toEntry);
      return order === "DESC" ? rows.reverse() : rows;
    },

    verify() {
      let prevHash = GENESIS_HASH;
      let expectedSeq = 1;
      for (const row of db.prepare("SELECT * FROM audit_log ORDER BY seq").iterate() as Iterable<Row>) {
        let entry: AuditEntry;
        try {
          entry = toEntry(row);
        } catch {
          return Number(row.seq);
        }
        const { hash, ...unhashed } = entry;
        if (entry.seq !== expectedSeq || entry.prevHash !== prevHash || hashEntry(unhashed) !== hash) return entry.seq;
        prevHash = hash;
        expectedSeq++;
      }
      return null;
    },
  };
}

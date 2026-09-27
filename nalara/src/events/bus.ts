import type { Database } from "../kernel/db";
import { newId, nowIso } from "../kernel/ids";
import type { EventBus, EventPattern, EventType, KernelEvent, Unsubscribe } from "../kernel/types";

type Handler = (event: KernelEvent) => void | Promise<void>;

interface Subscription {
  pattern: EventPattern;
  handler: Handler;
}

export function matchPattern(type: string, pattern: EventPattern): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) return type.startsWith(pattern.slice(0, -1));
  return type === pattern;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null) ?? "null";
  } catch {
    return JSON.stringify({ unserializable: String(value) });
  }
}

/**
 * In-process event bus. Events are numbered from 1, kept in a ring of `maxHistory` for history()
 * and, when a database is given, persisted to `events` so seq continues after a restart.
 *
 * history(): with sinceSeq, returns the first `limit` events after it (paging forward);
 * without, the most recent `limit` events. Both in ascending seq order.
 */
export function createEventBus(opts: { db?: Database; maxHistory?: number } = {}): EventBus {
  const { db } = opts;
  const maxHistory = opts.maxHistory ?? 5000;
  const ring: KernelEvent[] = [];
  const subs = new Set<Subscription>();
  const pending = new Set<Promise<void>>();
  const waiters = new Set<(err: Error) => void>();
  let seq = 0;
  let closed = false;

  const insert = db ? prepare(db) : undefined;
  if (db) {
    const last = db.prepare("SELECT MAX(seq) AS seq FROM events").get() as { seq: number | null };
    seq = last.seq ?? 0;
    // Warm the ring so history() spans restarts.
    const rows = db.prepare("SELECT * FROM events ORDER BY seq DESC LIMIT ?").all(maxHistory) as Record<string, unknown>[];
    for (const row of rows.reverse()) ring.push(rowToEvent(row));
  }

  function report(err: unknown, event: KernelEvent, pattern: EventPattern) {
    // A kernel.log handler that throws on handler-error reports would otherwise loop forever.
    const data = event.data as { handlerError?: boolean } | null;
    if (event.type === "kernel.log" && data?.handlerError) return;
    publish("kernel.log", {
      level: "error",
      message: `event handler for "${pattern}" failed on ${event.type}#${event.seq}: ${err instanceof Error ? err.message : String(err)}`,
      handlerError: true,
      eventType: event.type,
      eventSeq: event.seq,
    }, { source: "bus" });
  }

  function publish<T>(type: EventType, data: T, o: { source?: string; correlationId?: string } = {}): KernelEvent<T> {
    const event: KernelEvent<T> = {
      id: newId("ev"),
      seq: ++seq,
      type,
      ts: nowIso(),
      source: o.source ?? "kernel",
      ...(o.correlationId ? { correlationId: o.correlationId } : {}),
      data,
    };
    if (closed) return event;
    ring.push(event as KernelEvent);
    if (ring.length > maxHistory) ring.splice(0, ring.length - maxHistory);
    insert?.run(event.seq, event.id, event.type, event.ts, event.source, event.correlationId ?? null, safeJson(event.data));

    for (const sub of subs) {
      if (!matchPattern(type, sub.pattern)) continue;
      const p = new Promise<void>((resolve) => queueMicrotask(resolve))
        .then(() => {
          if (!closed && subs.has(sub)) return sub.handler(event as KernelEvent);
        })
        .catch((err) => report(err, event as KernelEvent, sub.pattern))
        .finally(() => pending.delete(p));
      pending.add(p);
    }
    return event;
  }

  function subscribe(pattern: EventPattern, handler: Handler): Unsubscribe {
    const sub = { pattern, handler };
    if (!closed) subs.add(sub);
    return () => void subs.delete(sub);
  }

  function history(q: { sinceSeq?: number; types?: EventPattern[]; correlationId?: string; limit?: number } = {}): KernelEvent[] {
    let out = ring.filter(
      (e) =>
        (q.sinceSeq === undefined || e.seq > q.sinceSeq) &&
        (!q.types?.length || q.types.some((p) => matchPattern(e.type, p))) &&
        (q.correlationId === undefined || e.correlationId === q.correlationId),
    );
    if (q.limit !== undefined && out.length > q.limit) {
      out = q.sinceSeq !== undefined ? out.slice(0, q.limit) : out.slice(out.length - q.limit);
    }
    return out;
  }

  function waitFor(pattern: EventPattern, predicate?: (e: KernelEvent) => boolean, timeoutMs?: number): Promise<KernelEvent> {
    return new Promise((resolve, reject) => {
      if (closed) return reject(new Error("event bus closed"));
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (err?: Error, event?: KernelEvent) => {
        unsubscribe();
        waiters.delete(fail);
        if (timer) clearTimeout(timer);
        if (err) reject(err);
        else resolve(event!);
      };
      const fail = (err: Error) => finish(err);
      const unsubscribe = subscribe(pattern, (e) => {
        if (!predicate || predicate(e)) finish(undefined, e);
      });
      waiters.add(fail);
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => finish(new Error(`waitFor("${pattern}") timed out after ${timeoutMs} ms`)), timeoutMs);
      }
    });
  }

  async function drain(): Promise<void> {
    // Handlers can publish more events, so loop until nothing new was started.
    while (pending.size > 0) await Promise.allSettled([...pending]);
  }

  function close() {
    closed = true;
    subs.clear();
    for (const fail of [...waiters]) fail(new Error("event bus closed"));
  }

  return { publish, subscribe, history, waitFor, drain, close };
}

function prepare(db: Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS events (
    seq INTEGER PRIMARY KEY,
    id TEXT NOT NULL,
    type TEXT NOT NULL,
    ts TEXT NOT NULL,
    source TEXT NOT NULL,
    correlation_id TEXT,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS events_correlation ON events(correlation_id);`);
  return db.prepare("INSERT INTO events (seq, id, type, ts, source, correlation_id, data) VALUES (?, ?, ?, ?, ?, ?, ?)");
}

function rowToEvent(row: Record<string, unknown>): KernelEvent {
  return {
    id: row.id as string,
    seq: Number(row.seq),
    type: row.type as EventType,
    ts: row.ts as string,
    source: row.source as string,
    ...(row.correlation_id ? { correlationId: row.correlation_id as string } : {}),
    data: JSON.parse(row.data as string),
  };
}

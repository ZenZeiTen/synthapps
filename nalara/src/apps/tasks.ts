/**
 * Tasks and reminders: a to-do list kept in Nalara's database.
 *
 * - A task has a title, optional notes, an optional due time and a done flag.
 * - When a due time passes, the kernel publishes `reminder.due` once for that task (the UI shows it as a
 *   notification). Editing the due time re-arms the reminder.
 * - The tasks.* tools let the assistant read and keep the list ("remind me to call Ana at 5"). The list is
 *   Nalara's own data, not the user's files, so adding and completing need no approval; deleting does.
 */
import type { Database } from "../kernel/db";
import { newId } from "../kernel/ids";
import type { EventBus, JsonSchemaObject, ToolRegistry, ToolResult } from "../kernel/types";
import type { TaskItem } from "./types";

export type { TaskItem } from "./types";

export class TaskError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "TaskError";
  }
}

const MAX_TITLE = 300;
const MAX_NOTES = 10_000;
export const REMINDER_CHECK_MS = 15_000;

export interface TaskStore {
  list(opts?: { includeDone?: boolean }): TaskItem[];
  get(id: string): TaskItem | undefined;
  add(input: { title: string; notes?: string; due?: string | null }): TaskItem;
  update(id: string, patch: { title?: string; notes?: string; due?: string | null; done?: boolean }): TaskItem;
  remove(id: string): boolean;
  /** Publishes reminder.due for tasks whose due time has passed; returns them. Called on a timer. */
  checkDue(): TaskItem[];
  start(): void;
  stop(): void;
}

function dueOf(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") throw new TaskError("due must be an ISO date-time string", 400, "invalid_request");
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new TaskError(`due is not a date-time: ${v}`, 400, "invalid_request");
  return new Date(t).toISOString();
}

function titleOf(v: unknown): string {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  if (!t) throw new TaskError("title is required", 400, "invalid_request");
  if (t.length > MAX_TITLE) throw new TaskError(`title is longer than ${MAX_TITLE} characters`, 400, "invalid_request");
  return t;
}

export function createTaskStore(deps: { db: Database; bus: EventBus; now?: () => Date }): TaskStore {
  const { db, bus } = deps;
  const now = deps.now ?? (() => new Date());
  let timer: ReturnType<typeof setInterval> | undefined;

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      due TEXT,
      done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      reminded_at TEXT
    );
  `);

  type Row = { id: string; title: string; notes: string; due: string | null; done: number; created_at: string; updated_at: string; completed_at: string | null; reminded_at: string | null };
  const toTask = (r: Row): TaskItem => ({
    id: r.id,
    title: r.title,
    notes: r.notes,
    due: r.due,
    done: r.done === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
    reminded: r.reminded_at !== null,
  });

  const get = (id: string) => {
    const r = db.prepare("SELECT * FROM user_tasks WHERE id = ?").get(id) as Row | undefined;
    return r ? toTask(r) : undefined;
  };

  const publish = (type: "reminder.due", data: Record<string, unknown>) => {
    try {
      bus.publish(type, data, { source: "tasks" });
    } catch {
      // bus closed during shutdown
    }
  };

  const store: TaskStore = {
    list(opts = {}) {
      const rows = db
        .prepare(
          `SELECT * FROM user_tasks ${opts.includeDone === false ? "WHERE done = 0" : ""}
           ORDER BY done, CASE WHEN due IS NULL THEN 1 ELSE 0 END, due, created_at`,
        )
        .all() as Row[];
      return rows.map(toTask);
    },
    get,
    add(input) {
      const ts = now().toISOString();
      const notes = String(input.notes ?? "").slice(0, MAX_NOTES);
      const task = { id: newId("task"), title: titleOf(input.title), notes, due: dueOf(input.due) };
      db.prepare("INSERT INTO user_tasks (id, title, notes, due, done, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)").run(task.id, task.title, task.notes, task.due, ts, ts);
      return get(task.id)!;
    },
    update(id, patch) {
      const cur = get(id);
      if (!cur) throw new TaskError(`No task "${id}"`, 404, "not_found");
      const ts = now().toISOString();
      const title = patch.title !== undefined ? titleOf(patch.title) : cur.title;
      const notes = patch.notes !== undefined ? String(patch.notes).slice(0, MAX_NOTES) : cur.notes;
      const due = patch.due !== undefined ? dueOf(patch.due) : cur.due;
      const done = patch.done !== undefined ? Boolean(patch.done) : cur.done;
      const completedAt = done ? (cur.completedAt ?? ts) : null;
      // A new due time re-arms the reminder.
      const rearm = patch.due !== undefined && due !== cur.due;
      db.prepare(
        `UPDATE user_tasks SET title = ?, notes = ?, due = ?, done = ?, updated_at = ?, completed_at = ?${rearm ? ", reminded_at = NULL" : ""} WHERE id = ?`,
      ).run(title, notes, due, done ? 1 : 0, ts, completedAt, id);
      return get(id)!;
    },
    remove(id) {
      return db.prepare("DELETE FROM user_tasks WHERE id = ?").run(id).changes > 0;
    },
    checkDue() {
      const at = now().toISOString();
      const rows = db.prepare("SELECT * FROM user_tasks WHERE done = 0 AND due IS NOT NULL AND due <= ? AND reminded_at IS NULL ORDER BY due").all(at) as Row[];
      const due = rows.map(toTask);
      for (const t of due) {
        db.prepare("UPDATE user_tasks SET reminded_at = ? WHERE id = ?").run(at, t.id);
        publish("reminder.due", { taskId: t.id, title: t.title, due: t.due });
      }
      return due.map((t) => ({ ...t, reminded: true }));
    },
    start() {
      if (timer) return;
      store.checkDue();
      timer = setInterval(() => {
        try {
          store.checkDue();
        } catch {
          // the database may be closing
        }
      }, REMINDER_CHECK_MS);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
  return store;
}

function schema(properties: Record<string, unknown>, required: string[] = []): JsonSchemaObject {
  return { type: "object", properties, required, additionalProperties: false };
}

const fail = (err: unknown): ToolResult => {
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, content: message, error: message };
};

const line = (t: TaskItem) => `${t.id}\t${t.done ? "[x]" : "[ ]"} ${t.title}${t.due ? `\tdue ${t.due}` : ""}`;

export function registerTaskTools(registry: ToolRegistry, tasks: TaskStore): string[] {
  const base = { server: "builtin:tasks", scope: "tenant" as const };
  const due = { type: "string", description: "Due date-time in ISO 8601 with the user's UTC offset, e.g. 2026-11-18T17:00:00+07:00. Omit for no due time." };
  registry.register(
    { ...base, name: "tasks.list", description: "The user's tasks and reminders, open ones first.", action: "read", reversibility: "reversible", inputSchema: schema({ includeDone: { type: "boolean" } }) },
    async (input) => {
      const list = tasks.list({ includeDone: input.includeDone === true });
      return { ok: true, content: list.length ? list.map(line).join("\n") : "(no tasks)", data: list };
    },
  );
  registry.register(
    {
      ...base,
      name: "tasks.add",
      description: "Add a task to the user's list; with a due time it becomes a reminder that Nalara shows when the time comes.",
      action: "write",
      reversibility: "reversible",
      inputSchema: schema({ title: { type: "string", minLength: 1 }, notes: { type: "string" }, due }, ["title"]),
    },
    async (input) => {
      try {
        const t = tasks.add({ title: String(input.title), ...(typeof input.notes === "string" ? { notes: input.notes } : {}), ...(typeof input.due === "string" ? { due: input.due } : {}) });
        return { ok: true, content: `Added: ${line(t)}`, data: t };
      } catch (err) {
        return fail(err);
      }
    },
  );
  registry.register(
    {
      ...base,
      name: "tasks.update",
      description: "Change a task: mark it done or not done, rename it, change its notes or due time (null removes the due time).",
      action: "write",
      reversibility: "reversible",
      inputSchema: schema({ id: { type: "string", minLength: 1 }, title: { type: "string" }, notes: { type: "string" }, due: { type: ["string", "null"] }, done: { type: "boolean" } }, ["id"]),
    },
    async (input) => {
      try {
        const patch: { title?: string; notes?: string; due?: string | null; done?: boolean } = {};
        if (typeof input.title === "string") patch.title = input.title;
        if (typeof input.notes === "string") patch.notes = input.notes;
        if (input.due !== undefined) patch.due = input.due as string | null;
        if (typeof input.done === "boolean") patch.done = input.done;
        const t = tasks.update(String(input.id), patch);
        return { ok: true, content: `Updated: ${line(t)}`, data: t };
      } catch (err) {
        return fail(err);
      }
    },
  );
  registry.register(
    { ...base, name: "tasks.delete", description: "Delete a task for good.", action: "write", reversibility: "compensable", inputSchema: schema({ id: { type: "string", minLength: 1 } }, ["id"]) },
    async (input) => (tasks.remove(String(input.id)) ? { ok: true, content: `Deleted ${String(input.id)}` } : fail(new Error(`No task "${String(input.id)}"`))),
  );
  return ["tasks.list", "tasks.add", "tasks.update", "tasks.delete"];
}

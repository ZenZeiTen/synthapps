import { lstatSync, realpathSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Database } from "./db";
import { newId, nowIso } from "./ids";
import type { ActionJournal, EventBus, JournalEntry } from "./types";

type Row = Record<string, unknown>;

const toEntry = (r: Row): JournalEntry => ({
  id: r.id as string,
  ts: r.ts as string,
  tool: r.tool as string,
  path: r.path as string,
  before: (r.before as string | null) ?? null,
  after: r.after as string,
  principal: JSON.parse(r.principal as string),
  undone: Number(r.undone) === 1,
});

const inside = (root: string, target: string) => {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
};

/**
 * Resolves a path under root and rejects anything that leaves it, including through symlinks: the nearest
 * existing ancestor (and the file itself, if it exists) must realpath inside the root.
 * Returns the absolute path and the normalized relative path (forward slashes).
 */
export function confinePath(root: string, path: string): { abs: string; rel: string } {
  const realRoot = realpathSync(root);
  const abs = resolve(realRoot, path);
  if (!inside(realRoot, abs)) throw new Error(`path escapes the root: ${path}`);
  // lstat (not exists) so a dangling symlink is caught: realpath of it throws and counts as an escape.
  let probe = abs;
  while (!lexists(probe)) probe = dirname(probe);
  let real: string;
  try {
    real = realpathSync(probe);
  } catch {
    throw new Error(`path escapes the root through a symlink: ${path}`);
  }
  if (!inside(realRoot, real)) throw new Error(`path escapes the root through a symlink: ${path}`);
  const rel = relative(realRoot, abs).split(sep).join("/");
  if (rel === "") throw new Error("path must name a file under the root");
  return { abs, rel };
}

function lexists(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

async function readOrNull(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Journal of compensable writes with before-images (SQLite table `journal`). list() returns newest first.
 * undo() restores newest first and refuses any entry whose file no longer holds the content it wrote.
 * Emits journal.undone `{ workspaceId?, entryId?, restored, skipped }`.
 */
export function createActionJournal(opts: { db: Database; root: string; bus?: EventBus }): ActionJournal {
  const { db, root, bus } = opts;
  db.exec(`CREATE TABLE IF NOT EXISTS journal (
    n INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    ts TEXT NOT NULL,
    tool TEXT NOT NULL,
    path TEXT NOT NULL,
    before TEXT,
    after TEXT NOT NULL,
    principal TEXT NOT NULL,
    workspace_id TEXT,
    instance_id TEXT,
    undone INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS journal_workspace ON journal(workspace_id);`);

  const insert = db.prepare(
    "INSERT INTO journal (id, ts, tool, path, before, after, principal, workspace_id, instance_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const byId = db.prepare("SELECT * FROM journal WHERE id = ?");
  const markUndone = db.prepare("UPDATE journal SET undone = 1 WHERE id = ?");

  const journal: ActionJournal = {
    recordWrite(input) {
      const { rel } = confinePath(root, input.path);
      const entry: JournalEntry = { id: newId("jr"), ts: nowIso(), tool: input.tool, path: rel, before: input.before, after: input.after, principal: input.principal, undone: false };
      insert.run(entry.id, entry.ts, entry.tool, rel, entry.before, entry.after, JSON.stringify(entry.principal), entry.principal.workspaceId ?? null, entry.principal.instanceId ?? null);
      return entry;
    },

    list(query = {}) {
      const where: string[] = [];
      const args: string[] = [];
      if (query.workspaceId !== undefined) {
        where.push("workspace_id = ?");
        args.push(query.workspaceId);
      }
      if (query.instanceId !== undefined) {
        where.push("instance_id = ?");
        args.push(query.instanceId);
      }
      if (!query.includeUndone) where.push("undone = 0");
      const sql = `SELECT * FROM journal ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY n DESC`;
      return (db.prepare(sql).all(...args) as Row[]).map(toEntry);
    },

    async undo(query) {
      const restored: string[] = [];
      const skipped: { path: string; reason: string }[] = [];
      let entries: JournalEntry[] = [];
      if (query.entryId !== undefined) {
        const row = byId.get(query.entryId) as Row | undefined;
        if (row) entries = [toEntry(row)];
        if (row && query.workspaceId !== undefined && entries[0].principal.workspaceId !== query.workspaceId) entries = [];
      } else if (query.workspaceId !== undefined) {
        entries = journal.list({ workspaceId: query.workspaceId });
      }

      for (const entry of entries) {
        if (entry.undone) {
          skipped.push({ path: entry.path, reason: "already undone" });
          continue;
        }
        try {
          const { abs } = confinePath(root, entry.path);
          const current = await readOrNull(abs);
          if (current !== entry.after) {
            skipped.push({ path: entry.path, reason: "changed since write" });
            continue;
          }
          if (entry.before === null) await unlink(abs);
          else await writeFile(abs, entry.before, "utf8");
          markUndone.run(entry.id);
          restored.push(entry.path);
        } catch (err) {
          skipped.push({ path: entry.path, reason: err instanceof Error ? err.message : String(err) });
        }
      }
      if (entries.length > 0) {
        bus?.publish("journal.undone", { workspaceId: query.workspaceId, entryId: query.entryId, restored, skipped }, { source: "journal", correlationId: query.workspaceId });
      }
      return { restored, skipped };
    },
  };
  return journal;
}

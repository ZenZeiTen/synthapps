import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventBus } from "../src/events/bus";
import { openDatabase } from "../src/kernel/db";
import { createActionJournal } from "../src/kernel/journal";
import type { ActionJournal, EventBus, Principal } from "../src/kernel/types";

let root: string;
let outside: string;
let bus: EventBus;
let journal: ActionJournal;

const p = (workspaceId: string, instanceId = "ai_1"): Principal => ({ userId: "local", agentId: "fullstack_engineer", instanceId, workspaceId, chain: ["user:local"], depth: 1 });

/** Writes a file the way fs.write_file would: read before-image, write, journal. */
function write(path: string, content: string, principal = p("ws_1")) {
  const abs = join(root, path);
  const before = existsSync(abs) ? readFileSync(abs, "utf8") : null;
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
  return journal.recordWrite({ tool: "fs.write_file", path, before, after: content, principal });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neuralos-journal-"));
  outside = mkdtempSync(join(tmpdir(), "neuralos-outside-"));
  bus = createEventBus();
  journal = createActionJournal({ db: openDatabase(":memory:"), root, bus });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("action journal", () => {
  it("records writes and lists them newest first with filters", () => {
    writeFileSync(join(root, "a.txt"), "v0");
    const e1 = write("a.txt", "v1");
    const e2 = write("src/b.txt", "new", p("ws_2", "ai_2"));
    expect(e1).toMatchObject({ path: "a.txt", before: "v0", after: "v1", undone: false });
    expect(e2.before).toBeNull();
    expect(journal.list().map((e) => e.id)).toEqual([e2.id, e1.id]);
    expect(journal.list({ workspaceId: "ws_1" }).map((e) => e.id)).toEqual([e1.id]);
    expect(journal.list({ instanceId: "ai_2" }).map((e) => e.id)).toEqual([e2.id]);
  });

  it("undoes a workspace newest first, restoring the original content", async () => {
    writeFileSync(join(root, "a.txt"), "v0");
    write("a.txt", "v1");
    write("a.txt", "v2");
    write("other.txt", "keep", p("ws_other"));
    const res = await journal.undo({ workspaceId: "ws_1" });
    expect(res).toEqual({ restored: ["a.txt", "a.txt"], skipped: [] });
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("v0");
    expect(readFileSync(join(root, "other.txt"), "utf8")).toBe("keep");
    expect(journal.list({ workspaceId: "ws_1" })).toHaveLength(0);
    expect(journal.list({ workspaceId: "ws_1", includeUndone: true }).every((e) => e.undone)).toBe(true);
    await bus.drain();
    expect(bus.history({ types: ["journal.undone"] })[0].data).toMatchObject({ workspaceId: "ws_1", restored: ["a.txt", "a.txt"] });
  });

  it("deletes a file the write created", async () => {
    const e = write("new/file.ts", "export {}");
    const res = await journal.undo({ entryId: e.id });
    expect(res.restored).toEqual(["new/file.ts"]);
    expect(existsSync(join(root, "new/file.ts"))).toBe(false);
  });

  it("skips a file that changed since the write", async () => {
    writeFileSync(join(root, "a.txt"), "v0");
    const e = write("a.txt", "v1");
    writeFileSync(join(root, "a.txt"), "human edit");
    const res = await journal.undo({ workspaceId: "ws_1" });
    expect(res).toEqual({ restored: [], skipped: [{ path: "a.txt", reason: "changed since write" }] });
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("human edit");
    expect(journal.list().map((x) => x.id)).toEqual([e.id]); // still undoable later
  });

  it("skips a created file that was deleted since", async () => {
    const e = write("gone.txt", "x");
    rmSync(join(root, "gone.txt"));
    const res = await journal.undo({ entryId: e.id });
    expect(res.skipped).toEqual([{ path: "gone.txt", reason: "changed since write" }]);
  });

  it("does not undo an entry twice", async () => {
    const e = write("a.txt", "x");
    await journal.undo({ entryId: e.id });
    const res = await journal.undo({ entryId: e.id });
    expect(res.skipped).toEqual([{ path: "a.txt", reason: "already undone" }]);
  });

  it("rejects paths that escape the root", () => {
    expect(() => journal.recordWrite({ tool: "fs.write_file", path: "../escape.txt", before: null, after: "x", principal: p("ws_1") })).toThrow(/escapes/);
    expect(() => journal.recordWrite({ tool: "fs.write_file", path: join(outside, "x.txt"), before: null, after: "x", principal: p("ws_1") })).toThrow(/escapes/);
    symlinkSync(outside, join(root, "link"));
    expect(() => journal.recordWrite({ tool: "fs.write_file", path: "link/x.txt", before: null, after: "x", principal: p("ws_1") })).toThrow(/symlink/);
    symlinkSync(join(outside, "dangling.txt"), join(root, "dangle.txt"));
    expect(() => journal.recordWrite({ tool: "fs.write_file", path: "dangle.txt", before: null, after: "x", principal: p("ws_1") })).toThrow(/symlink/);
  });

  it("normalizes paths relative to the root", () => {
    const e = journal.recordWrite({ tool: "fs.write_file", path: "./src/../src/x.ts", before: null, after: "x", principal: p("ws_1") });
    expect(e.path).toBe("src/x.ts");
  });

  it("undo with no matching entries restores nothing and emits nothing", async () => {
    expect(await journal.undo({ workspaceId: "ws_none" })).toEqual({ restored: [], skipped: [] });
    await bus.drain();
    expect(bus.history({ types: ["journal.undone"] })).toHaveLength(0);
  });
});

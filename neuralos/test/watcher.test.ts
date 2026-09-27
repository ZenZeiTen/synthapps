import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFileWatcher } from "../src/search/watcher";
import type { EventBus, EventType, FileKind, FileWatcher, KernelEvent, SemanticIndex } from "../src/kernel/types";

interface Published {
  type: EventType;
  data: { path: string; kind: FileKind };
  source?: string;
}

function createFakeBus(): EventBus & { published: Published[] } {
  const published: Published[] = [];
  let seq = 0;
  return {
    published,
    publish<T>(type: EventType, data: T, opts?: { source?: string }) {
      published.push({ type, data: data as Published["data"], source: opts?.source });
      return { id: `evt_${++seq}`, seq, type, ts: new Date().toISOString(), source: opts?.source ?? "test", data } as KernelEvent<T>;
    },
    subscribe: () => () => undefined,
    history: () => [],
    waitFor: () => Promise.reject(new Error("not implemented")),
    drain: async () => undefined,
    close: () => undefined,
  };
}

function createFakeIndex(): SemanticIndex & { files: Set<string>; calls: string[]; hasFile(p: string): boolean } {
  const files = new Set<string>();
  const calls: string[] = [];
  return {
    files,
    calls,
    hasFile: (p) => files.has(p),
    kindOf: (p) => (files.has(p) ? "code" : undefined),
    indexAll: async () => ({ files: files.size, ms: 0 }),
    async indexFile(p) {
      calls.push(`index:${p}`);
      files.add(p);
    },
    removeFile(p) {
      calls.push(`remove:${p}`);
      files.delete(p);
    },
    search: () => [],
    concepts: () => [],
    fileCount: () => files.size,
    readFile: async () => "",
  };
}

async function until(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for watcher");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("file watcher", () => {
  let root: string;
  let bus: ReturnType<typeof createFakeBus>;
  let index: ReturnType<typeof createFakeIndex>;
  let watcher: FileWatcher;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), "neuralos-watch-"));
    await fsp.mkdir(path.join(root, "src"));
    await fsp.mkdir(path.join(root, ".git"));
    await fsp.mkdir(path.join(root, "node_modules"));
    bus = createFakeBus();
    index = createFakeIndex();
    watcher = createFileWatcher({ root, index, bus, debounceMs: 80 });
    await watcher.start();
  });

  afterEach(async () => {
    await watcher.stop();
    await fsp.rm(root, { recursive: true, force: true });
  });

  it("reports create, update and delete in order and keeps the index in step", async () => {
    const file = path.join(root, "src/damage.ts");
    await fsp.writeFile(file, "export const a = 1;\n");
    await until(() => bus.published.length >= 1);
    expect(index.files.has("src/damage.ts")).toBe(true);

    await fsp.writeFile(file, "export const a = 2;\n");
    await until(() => bus.published.length >= 2);

    await fsp.rm(file);
    await until(() => bus.published.length >= 3);
    await settle(200);

    expect(bus.published).toEqual([
      { type: "file.created", data: { path: "src/damage.ts", kind: "code" }, source: "watcher" },
      { type: "file.updated", data: { path: "src/damage.ts", kind: "code" }, source: "watcher" },
      { type: "file.deleted", data: { path: "src/damage.ts", kind: "code" }, source: "watcher" },
    ]);
    expect(index.calls).toEqual(["index:src/damage.ts", "index:src/damage.ts", "remove:src/damage.ts"]);
  });

  it("debounces bursts of writes to one event per path", async () => {
    const file = path.join(root, "notes.md");
    for (let i = 0; i < 5; i++) {
      await fsp.writeFile(file, `draft ${i}\n`);
      await settle(10);
    }
    await until(() => bus.published.length >= 1);
    await settle(250);
    expect(bus.published).toEqual([{ type: "file.created", data: { path: "notes.md", kind: "doc" }, source: "watcher" }]);
  });

  it("ignores .git and node_modules and ignores files that vanish within the debounce window", async () => {
    await fsp.writeFile(path.join(root, ".git/HEAD"), "ref: refs/heads/main\n");
    await fsp.writeFile(path.join(root, "node_modules/x.js"), "1\n");
    const tmp = path.join(root, "src/.swap.tmp");
    await fsp.writeFile(tmp, "x");
    await fsp.rm(tmp);
    await fsp.writeFile(path.join(root, "src/marker.ts"), "export {};\n");
    await until(() => bus.published.some((e) => e.data.path === "src/marker.ts"));
    await settle(200);
    expect(bus.published.map((e) => e.data.path)).toEqual(["src/marker.ts"]);
  });

  it("picks up files inside a newly created directory", async () => {
    await fsp.mkdir(path.join(root, "src/combat/deep"), { recursive: true });
    await fsp.writeFile(path.join(root, "src/combat/deep/elements.ts"), "export {};\n");
    await until(() => bus.published.some((e) => e.data.path === "src/combat/deep/elements.ts"));
    expect(bus.published.filter((e) => e.data.path === "src/combat/deep/elements.ts")).toHaveLength(1);
  });

  it("stop() closes the watcher and drops pending events", async () => {
    await fsp.writeFile(path.join(root, "late.txt"), "x");
    await watcher.stop();
    await settle(200);
    expect(bus.published).toEqual([]);
  });
});

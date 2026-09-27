/**
 * File watcher: keeps the semantic index and graph in step with the disk and
 * publishes file.created / file.updated / file.deleted on the bus.
 *
 * Uses fs.watch with { recursive: true } (supported on Linux since Node 20).
 * Events are debounced per path because editors write files in several steps
 * (truncate, write, rename), which would otherwise produce bursts.
 */
import { watch, promises as fsp, type FSWatcher } from "node:fs";
import path from "node:path";
import type { EventBus, EventType, FileKind, FileWatcher, SemanticIndex } from "../kernel/types";
import { detectKind } from "./index";

const WATCH_IGNORED = new Set([".git", "node_modules", ".nalara"]);
const DEFAULT_DEBOUNCE_MS = 300;

/** Optional extras a SemanticIndex implementation may offer (createSemanticIndex does). */
interface IndexExtras {
  hasFile?(relPath: string): boolean;
  kindOf?(relPath: string): FileKind | undefined;
}

export function createFileWatcher(opts: {
  root: string;
  index: SemanticIndex;
  bus: EventBus;
  debounceMs?: number;
}): FileWatcher {
  const root = path.resolve(opts.root);
  const index = opts.index as SemanticIndex & IndexExtras;
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const timers = new Map<string, NodeJS.Timeout>();
  /** Files this watcher has seen exist; used when the index cannot tell us what it knows. */
  const seen = new Set<string>();
  let watcher: FSWatcher | undefined;
  let queue: Promise<void> = Promise.resolve();
  let stopped = true;

  function isIgnored(rel: string): boolean {
    return rel === "" || rel.split("/").some((segment) => WATCH_IGNORED.has(segment));
  }

  function known(rel: string): boolean {
    return index.hasFile ? index.hasFile(rel) || seen.has(rel) : seen.has(rel);
  }

  function publish(type: EventType, rel: string, kind: FileKind): void {
    opts.bus.publish(type, { path: rel, kind }, { source: "watcher" });
  }

  function schedule(rel: string): void {
    if (stopped || isIgnored(rel)) return;
    clearTimeout(timers.get(rel));
    timers.set(
      rel,
      setTimeout(() => {
        timers.delete(rel);
        // One queue for all paths keeps index updates and published events in arrival order.
        queue = queue.then(() => handle(rel)).catch(() => undefined);
      }, debounceMs),
    );
  }

  async function handle(rel: string): Promise<void> {
    if (stopped) return;
    let stat;
    try {
      stat = await fsp.lstat(path.join(root, rel));
    } catch {
      stat = undefined;
    }

    if (!stat) {
      if (!known(rel)) return; // created and deleted within the debounce window, or never ours
      const kind = index.kindOf?.(rel) ?? detectKind(rel);
      seen.delete(rel);
      try {
        index.removeFile(rel);
      } catch {
        // an invalid path cannot be in the index
      }
      publish("file.deleted", rel, kind);
      return;
    }

    if (stat.isDirectory()) {
      // Files written into a brand-new directory can land before the recursive watch covers it.
      await scanDirectory(rel);
      return;
    }
    if (!stat.isFile()) return;

    const existed = known(rel);
    try {
      await index.indexFile(rel);
    } catch {
      // unreadable or vanished mid-read: still report the change below
    }
    seen.add(rel);
    publish(existed ? "file.updated" : "file.created", rel, index.kindOf?.(rel) ?? detectKind(rel));
  }

  async function scanDirectory(relDir: string): Promise<void> {
    let entries;
    try {
      entries = await fsp.readdir(path.join(root, relDir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = `${relDir}/${entry.name}`;
      if (isIgnored(rel) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await scanDirectory(rel);
      else if (entry.isFile() && !known(rel)) schedule(rel);
    }
  }

  return {
    async start() {
      if (watcher) return;
      stopped = false;
      watcher = watch(root, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const rel = filename.toString().split(path.sep).join("/").replace(/^\.\//, "");
        schedule(rel);
      });
      watcher.on("error", () => {
        // A watched subdirectory disappearing can raise EPERM/ENOENT; the per-path events still arrive.
      });
    },

    async stop() {
      stopped = true;
      watcher?.close();
      watcher = undefined;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      await queue;
    },
  };
}

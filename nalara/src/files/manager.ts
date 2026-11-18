/**
 * File manager: the user's files as a real file manager sees them.
 *
 * - Places: the Nalara home folder (always), plus folders the user adds (Documents, Desktop...). Every path is
 *   relative to a place and confined to it: no "..", no absolute paths, no symlink that leads outside.
 * - Operations: list, read, save, new folder, rename/move, copy, trash (recoverable) and restore, and open in the
 *   operating system's default app (never for programs or scripts).
 * - Nalara's own data folder (.nalara in the home folder) is hidden and cannot be changed through here.
 * - Every change is audited, published as a file.* event, and (in the home folder) re-indexed for search.
 */
import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform as osPlatform } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Database } from "../kernel/db";
import { newId } from "../kernel/ids";
import { detectKind } from "../search/index";
import type { AuditLog, EventBus, FileKind, Principal, SemanticIndex } from "../kernel/types";
import type { FileEntry, FileListing, Place, TextFile, TrashItem } from "./types";

export type { FileEntry, FileListing, Place, TextFile, TrashItem } from "./types";

export const HOME_PLACE = "home";
/** Largest file read or saved as text. */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
/** Files that run code when opened: never handed to the system opener. */
export const BLOCKED_OPEN_EXTENSIONS = new Set(
  ".exe .msi .bat .cmd .com .scr .pif .ps1 .psm1 .vbs .vbe .js .jse .wsf .wsh .hta .cpl .lnk .reg .jar .sh .bash .zsh .command .app .apk .appimage .run .bin .deb .rpm .dmg .pkg .py .pl .rb"
    .split(" "),
);

export class FileError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "FileError";
  }
}

const notFound = (what: string) => new FileError(`${what} does not exist`, 404, "not_found");
const bad = (msg: string) => new FileError(msg, 400, "invalid_request");
const forbidden = (msg: string) => new FileError(msg, 403, "forbidden");
const conflict = (msg: string) => new FileError(msg, 409, "conflict");

function inside(base: string, target: string): boolean {
  const r = relative(base, target);
  return r === "" || (!r.startsWith(`..${sep}`) && r !== ".." && !isAbsolute(r));
}

const toSlash = (p: string) => p.split(sep).join("/");

/** "a/b/../c" and absolute paths are refused; "" and "." are the place itself. */
export function cleanRelPath(path: unknown): string {
  if (path === undefined || path === null) return "";
  if (typeof path !== "string") throw bad("path must be a string");
  if (path.includes("\0")) throw bad("path contains a NUL byte");
  const p = path.trim().replace(/\\/g, "/");
  if (isAbsolute(p) || /^[a-zA-Z]:/.test(p) || p.startsWith("/")) throw bad(`Use a path inside the place, not an absolute path: ${path}`);
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  if (parts.includes("..")) throw bad(`".." is not allowed in paths: ${path}`);
  return parts.join("/");
}

/** A file or folder name: no separators, not empty, not "." or "..", nothing Windows would refuse. */
export function checkName(name: string): string {
  const n = String(name ?? "").trim();
  if (!n || n === "." || n === "..") throw bad("A name is required");
  if (/[\\/:*?"<>|\0]/.test(n)) throw bad(`A name cannot contain \\ / : * ? " < > |`);
  if (n.length > 255) throw bad("The name is longer than 255 characters");
  return n;
}

export type Opener = (absPath: string) => Promise<void>;

/** Opens a file or folder with the operating system's default app. */
export const systemOpener: Opener = (absPath) =>
  new Promise((resolvePromise, reject) => {
    const os = osPlatform();
    const [cmd, args] =
      os === "win32" ? ["explorer.exe", [absPath]] : os === "darwin" ? ["open", [absPath]] : ["xdg-open", [absPath]];
    try {
      const child = spawn(cmd, args as string[], { detached: true, stdio: "ignore", windowsHide: true });
      child.once("error", (err) => reject(new FileError(`Could not open it: ${err.message}`, 500, "open_failed")));
      child.once("spawn", () => {
        child.unref();
        resolvePromise();
      });
    } catch (err) {
      reject(new FileError(`Could not open it: ${err instanceof Error ? err.message : String(err)}`, 500, "open_failed"));
    }
  });

export interface FileManagerDeps {
  db: Database;
  root: string;
  dataDir: string;
  bus: EventBus;
  audit: AuditLog;
  index?: SemanticIndex;
  principal: () => Principal;
  opener?: Opener;
  /** Folders offered as one-click places (default: Documents, Desktop, Downloads, Pictures, Music, Videos in the user's home). */
  suggestions?: () => { name: string; path: string }[];
  now?: () => Date;
}

export interface FileManager {
  places(): Place[];
  suggestedPlaces(): { name: string; path: string }[];
  addPlace(path: string, name?: string): Place;
  removePlace(id: string): boolean;
  list(place: string | undefined, path: string, opts?: { hidden?: boolean }): FileListing;
  read(place: string | undefined, path: string): TextFile;
  /** Saves text. `mode` "create" refuses to overwrite; "overwrite" refuses to create. Default: either. */
  write(place: string | undefined, path: string, content: string, opts?: { mode?: "create" | "overwrite" | "any"; actor?: Principal }): FileEntry;
  mkdir(place: string | undefined, path: string, opts?: { actor?: Principal }): FileEntry;
  move(place: string | undefined, from: string, to: string, opts?: { actor?: Principal }): FileEntry;
  copy(place: string | undefined, from: string, to: string, opts?: { actor?: Principal }): FileEntry;
  trash(place: string | undefined, path: string, opts?: { actor?: Principal }): TrashItem;
  trashList(): TrashItem[];
  restore(id: string, opts?: { actor?: Principal }): FileEntry;
  purge(id: string): boolean;
  emptyTrash(): number;
  open(place: string | undefined, path: string, opts?: { actor?: Principal }): Promise<void>;
  /** Absolute path of an existing file inside a place (for previews). */
  resolveFile(place: string | undefined, path: string): string;
}

const DEFAULT_SUGGESTIONS = ["Documents", "Desktop", "Downloads", "Pictures", "Music", "Videos"];

export function createFileManager(deps: FileManagerDeps): FileManager {
  const { db, bus, audit } = deps;
  const now = deps.now ?? (() => new Date());
  const opener = deps.opener ?? systemOpener;
  const homeRoot = realpathSync(deps.root);
  const dataDir = existsSync(deps.dataDir) ? realpathSync(deps.dataDir) : resolve(deps.dataDir);
  const trashDir = join(dataDir, "trash");

  db.exec(`
    CREATE TABLE IF NOT EXISTS file_places (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      added_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS file_trash (
      id TEXT PRIMARY KEY,
      place TEXT NOT NULL,
      path TEXT NOT NULL,
      type TEXT NOT NULL,
      size INTEGER NOT NULL,
      trashed_at TEXT NOT NULL
    );
  `);

  function places(): Place[] {
    const rows = db.prepare("SELECT id, name, path FROM file_places ORDER BY added_at, rowid").all() as { id: string; name: string; path: string }[];
    return [
      { id: HOME_PLACE, name: "Nalara", path: homeRoot, builtin: true, exists: true },
      ...rows.map((r) => ({ id: r.id, name: r.name, path: r.path, builtin: false, exists: existsSync(r.path) })),
    ];
  }

  function placeRoot(id: string | undefined): { place: Place; root: string } {
    const want = id || HOME_PLACE;
    const place = places().find((p) => p.id === want);
    if (!place) throw notFound(`The place "${want}"`);
    if (!place.exists) throw new FileError(`The folder for "${place.name}" is missing: ${place.path}`, 404, "not_found");
    return { place, root: realpathSync(place.path) };
  }

  /** Absolute path for a relative one, confined to the place: the nearest existing ancestor must resolve inside it. */
  function resolveIn(root: string, rel: string, placeId: string): string {
    const abs = resolve(root, rel);
    if (!inside(root, abs)) throw forbidden(`The path leaves the place: ${rel}`);
    let probe = abs;
    while (!existsSync(probe) && probe !== root) probe = dirname(probe);
    let real: string;
    try {
      real = realpathSync(probe);
    } catch {
      throw forbidden(`The path cannot be resolved: ${rel}`);
    }
    if (!inside(root, real)) throw forbidden(`The path leads outside the place through a link: ${rel}`);
    // Lstat the target itself: a symlink inside the place that points outside is refused too.
    try {
      if (lstatSync(abs).isSymbolicLink() && !inside(root, realpathSync(abs))) throw forbidden(`The path is a link that leads outside the place: ${rel}`);
    } catch (err) {
      if (err instanceof FileError) throw err;
    }
    if (placeId === HOME_PLACE && (inside(dataDir, abs) || inside(abs, dataDir))) {
      // Reading the place root is fine; touching Nalara's own data folder is not.
      if (rel !== "") throw forbidden("Nalara's own data folder cannot be changed here");
    }
    return abs;
  }

  function entryFor(placeId: string, root: string, abs: string): FileEntry {
    const st = statSync(abs);
    const rel = toSlash(relative(root, abs));
    const name = basename(abs);
    const type = st.isDirectory() ? "dir" : "file";
    return {
      name,
      path: rel,
      place: placeId,
      type,
      size: type === "file" ? st.size : 0,
      mtimeMs: st.mtimeMs,
      hidden: name.startsWith("."),
      ...(type === "file" ? { kind: detectKind(rel) } : {}),
    };
  }

  function actorOf(opts?: { actor?: Principal }): Principal {
    return opts?.actor ?? deps.principal();
  }

  function record(action: string, actor: Principal, detail: Record<string, unknown>, outcome: "ok" | "error" = "ok") {
    audit.append({ kind: "file", principal: actor, subject: `files.${action}`, outcome, detail });
  }

  function publish(type: "file.created" | "file.updated" | "file.deleted", data: Record<string, unknown>) {
    try {
      bus.publish(type, data, { source: "files" });
    } catch {
      // bus closed during shutdown
    }
  }

  function reindex(placeId: string, rel: string, removed = false) {
    if (placeId !== HOME_PLACE || !deps.index) return;
    try {
      if (removed) deps.index.removeFile(rel);
      else void deps.index.indexFile(rel).catch(() => undefined);
    } catch {
      // the watcher catches up
    }
  }

  function suggestedPlaces() {
    const taken = new Set(places().map((p) => p.path));
    const list = deps.suggestions
      ? deps.suggestions()
      : DEFAULT_SUGGESTIONS.map((name) => ({ name, path: join(homedir(), name) }));
    return list.filter((s) => existsSync(s.path) && !taken.has(s.path) && !taken.has(safeReal(s.path)));
  }

  function safeReal(p: string): string {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  }

  function copyTarget(root: string, placeId: string, rel: string): string {
    const abs = resolveIn(root, rel, placeId);
    if (existsSync(abs)) throw conflict(`"${rel}" already exists`);
    if (!existsSync(dirname(abs))) throw notFound(`The folder "${toSlash(relative(root, dirname(abs))) || "/"}"`);
    return abs;
  }

  /** rename, falling back to copy and delete across file systems. */
  function moveAbs(from: string, to: string) {
    try {
      renameSync(from, to);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
      cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
      rmSync(from, { recursive: true, force: true });
    }
  }

  function sizeOf(abs: string): number {
    const st = statSync(abs);
    if (!st.isDirectory()) return st.size;
    let total = 0;
    for (const name of readdirSync(abs)) {
      try {
        total += sizeOf(join(abs, name));
      } catch {
        // unreadable entries count as 0
      }
    }
    return total;
  }

  const manager: FileManager = {
    places,
    suggestedPlaces,

    addPlace(path, name) {
      const raw = String(path ?? "").trim();
      if (!raw) throw bad("path is required");
      const expanded = raw === "~" ? homedir() : raw.startsWith("~/") || raw.startsWith("~\\") ? join(homedir(), raw.slice(2)) : raw;
      if (!isAbsolute(expanded)) throw bad("Use the folder's full path, e.g. C:\\Users\\you\\Documents or /home/you/Documents");
      if (!existsSync(expanded) || !statSync(expanded).isDirectory()) throw notFound(`The folder ${expanded}`);
      const real = realpathSync(expanded);
      if (real === realpathSync(homedir()) || real === resolve(real, "/") || /^[a-zA-Z]:\\?$/.test(real)) {
        throw bad("Add a specific folder (Documents, Projects...), not your whole home folder or drive");
      }
      if (inside(dataDir, real) || inside(real, dataDir)) throw bad("That folder holds Nalara's own data; add a folder inside it or next to it instead");
      const existing = places().find((p) => safeReal(p.path) === real);
      if (existing) return existing;
      const place: Place = { id: newId("place"), name: (name && checkName(name)) || basename(real) || real, path: real, builtin: false, exists: true };
      db.prepare("INSERT INTO file_places (id, name, path, added_at) VALUES (?, ?, ?, ?)").run(place.id, place.name, place.path, now().toISOString());
      record("add_place", deps.principal(), { place: place.id, path: real });
      return place;
    },

    removePlace(id) {
      if (id === HOME_PLACE) throw bad("The Nalara folder is always a place");
      const ok = db.prepare("DELETE FROM file_places WHERE id = ?").run(id).changes > 0;
      if (ok) record("remove_place", deps.principal(), { place: id });
      return ok;
    },

    list(placeId, path, opts = {}) {
      const { place, root } = placeRoot(placeId);
      const rel = cleanRelPath(path);
      const abs = resolveIn(root, rel, place.id);
      if (!existsSync(abs)) throw notFound(`The folder "${rel || "/"}"`);
      if (!statSync(abs).isDirectory()) throw bad(`"${rel}" is a file, not a folder`);
      const entries: FileEntry[] = [];
      for (const name of readdirSync(abs)) {
        const child = join(abs, name);
        if (place.id === HOME_PLACE && (inside(dataDir, child) || child === dataDir)) continue;
        if (!opts.hidden && name.startsWith(".")) continue;
        try {
          entries.push(entryFor(place.id, root, child));
        } catch {
          // broken links and unreadable entries are skipped
        }
      }
      entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) : a.type === "dir" ? -1 : 1));
      const parent = rel ? rel.split("/").slice(0, -1).join("/") : null;
      return { place: place.id, path: rel, parent, entries };
    },

    read(placeId, path) {
      const { place, root } = placeRoot(placeId);
      const rel = cleanRelPath(path);
      if (!rel) throw bad("path must name a file");
      const abs = resolveIn(root, rel, place.id);
      if (!existsSync(abs)) throw notFound(`"${rel}"`);
      const st = statSync(abs);
      if (st.isDirectory()) throw bad(`"${rel}" is a folder`);
      if (st.size > MAX_TEXT_BYTES) throw new FileError(`"${rel}" is too large to open as text (${Math.round(st.size / 1024)} KB)`, 413, "too_large");
      const buf = readFileSync(abs);
      if (buf.includes(0)) throw new FileError(`"${rel}" is not a text file. Open it in its own app instead.`, 415, "binary_file");
      return { place: place.id, path: rel, content: buf.toString("utf8"), kind: detectKind(rel) as FileKind, size: st.size, mtimeMs: st.mtimeMs };
    },

    write(placeId, path, content, opts = {}) {
      const { place, root } = placeRoot(placeId);
      const rel = cleanRelPath(path);
      if (!rel) throw bad("path must name a file");
      if (typeof content !== "string") throw bad("content must be text");
      if (Buffer.byteLength(content) > MAX_TEXT_BYTES) throw new FileError("The text is larger than 2 MB", 413, "too_large");
      checkName(basename(rel));
      const abs = resolveIn(root, rel, place.id);
      const existed = existsSync(abs);
      if (existed && statSync(abs).isDirectory()) throw conflict(`"${rel}" is a folder`);
      if (opts.mode === "create" && existed) throw conflict(`"${rel}" already exists`);
      if (opts.mode === "overwrite" && !existed) throw notFound(`"${rel}"`);
      if (!existsSync(dirname(abs))) throw notFound(`The folder "${toSlash(dirname(rel)) || "/"}"`);
      writeFileSync(abs, content, "utf8");
      const actor = actorOf(opts);
      record(existed ? "save" : "create", actor, { place: place.id, path: rel, bytes: Buffer.byteLength(content) });
      publish(existed ? "file.updated" : "file.created", { path: rel, place: place.id, by: actor.chain.at(-1) });
      reindex(place.id, rel);
      return entryFor(place.id, root, abs);
    },

    mkdir(placeId, path, opts = {}) {
      const { place, root } = placeRoot(placeId);
      const rel = cleanRelPath(path);
      if (!rel) throw bad("path must name a folder");
      checkName(basename(rel));
      const abs = resolveIn(root, rel, place.id);
      if (existsSync(abs)) throw conflict(`"${rel}" already exists`);
      if (!existsSync(dirname(abs))) throw notFound(`The folder "${toSlash(dirname(rel)) || "/"}"`);
      mkdirSync(abs);
      record("mkdir", actorOf(opts), { place: place.id, path: rel });
      publish("file.created", { path: rel, place: place.id, folder: true });
      return entryFor(place.id, root, abs);
    },

    move(placeId, from, to, opts = {}) {
      const { place, root } = placeRoot(placeId);
      const src = cleanRelPath(from);
      const dst = cleanRelPath(to);
      if (!src || !dst) throw bad("from and to must name a file or folder");
      if (src === dst) throw bad("The new path is the same as the old one");
      checkName(basename(dst));
      const absFrom = resolveIn(root, src, place.id);
      if (!existsSync(absFrom)) throw notFound(`"${src}"`);
      if (dst === src || dst.startsWith(`${src}/`)) throw bad("A folder cannot be moved into itself");
      // Renaming only the letter case ("a.txt" -> "A.txt") must work on case-insensitive file systems.
      const caseOnly = src.toLowerCase() === dst.toLowerCase();
      const absTo = caseOnly ? resolveIn(root, dst, place.id) : copyTarget(root, place.id, dst);
      moveAbs(absFrom, absTo);
      record("move", actorOf(opts), { place: place.id, from: src, to: dst });
      publish("file.deleted", { path: src, place: place.id, movedTo: dst });
      publish("file.created", { path: dst, place: place.id, movedFrom: src });
      reindex(place.id, src, true);
      reindex(place.id, dst);
      return entryFor(place.id, root, absTo);
    },

    copy(placeId, from, to, opts = {}) {
      const { place, root } = placeRoot(placeId);
      const src = cleanRelPath(from);
      const dst = cleanRelPath(to);
      if (!src || !dst) throw bad("from and to must name a file or folder");
      checkName(basename(dst));
      const absFrom = resolveIn(root, src, place.id);
      if (!existsSync(absFrom)) throw notFound(`"${src}"`);
      if (dst.startsWith(`${src}/`)) throw bad("A folder cannot be copied into itself");
      const absTo = copyTarget(root, place.id, dst);
      cpSync(absFrom, absTo, { recursive: true, errorOnExist: true, force: false });
      record("copy", actorOf(opts), { place: place.id, from: src, to: dst });
      publish("file.created", { path: dst, place: place.id, copiedFrom: src });
      reindex(place.id, dst);
      return entryFor(place.id, root, absTo);
    },

    trash(placeId, path, opts = {}) {
      const { place, root } = placeRoot(placeId);
      const rel = cleanRelPath(path);
      if (!rel) throw bad("The place itself cannot be moved to the trash");
      const abs = resolveIn(root, rel, place.id);
      if (!existsSync(abs)) throw notFound(`"${rel}"`);
      const st = statSync(abs);
      const id = newId("trash");
      const slot = join(trashDir, id);
      mkdirSync(slot, { recursive: true });
      const item: TrashItem = { id, place: place.id, path: rel, type: st.isDirectory() ? "dir" : "file", size: sizeOf(abs), trashedAt: now().toISOString() };
      moveAbs(abs, join(slot, basename(abs)));
      db.prepare("INSERT INTO file_trash (id, place, path, type, size, trashed_at) VALUES (?, ?, ?, ?, ?, ?)").run(item.id, item.place, item.path, item.type, item.size, item.trashedAt);
      record("trash", actorOf(opts), { place: place.id, path: rel, trashId: id });
      publish("file.deleted", { path: rel, place: place.id, trashId: id });
      reindex(place.id, rel, true);
      return item;
    },

    trashList() {
      const rows = db.prepare("SELECT id, place, path, type, size, trashed_at FROM file_trash ORDER BY trashed_at DESC, rowid DESC").all() as {
        id: string;
        place: string;
        path: string;
        type: "file" | "dir";
        size: number;
        trashed_at: string;
      }[];
      return rows.map((r) => ({ id: r.id, place: r.place, path: r.path, type: r.type, size: r.size, trashedAt: r.trashed_at }));
    },

    restore(id, opts = {}) {
      const item = manager.trashList().find((t) => t.id === id);
      if (!item) throw notFound(`The trash item "${id}"`);
      const { place, root } = placeRoot(item.place);
      const held = join(trashDir, id, basename(item.path));
      if (!existsSync(held)) {
        db.prepare("DELETE FROM file_trash WHERE id = ?").run(id);
        throw notFound(`The trashed copy of "${item.path}"`);
      }
      // Back to where it was; if that name is taken now, next to it as "name (restored).ext".
      let target = item.path;
      const ext = extname(target);
      for (let n = 1; existsSync(resolveIn(root, target, place.id)); n++) {
        target = `${item.path.slice(0, item.path.length - ext.length)} (restored${n > 1 ? ` ${n}` : ""})${ext}`;
      }
      const abs = resolveIn(root, target, place.id);
      mkdirSync(dirname(abs), { recursive: true });
      moveAbs(held, abs);
      rmSync(join(trashDir, id), { recursive: true, force: true });
      db.prepare("DELETE FROM file_trash WHERE id = ?").run(id);
      record("restore", actorOf(opts), { place: place.id, path: target, trashId: id });
      publish("file.created", { path: target, place: place.id, restoredFrom: id });
      reindex(place.id, target);
      return entryFor(place.id, root, abs);
    },

    purge(id) {
      const found = db.prepare("DELETE FROM file_trash WHERE id = ?").run(id).changes > 0;
      rmSync(join(trashDir, id), { recursive: true, force: true });
      if (found) record("purge", deps.principal(), { trashId: id });
      return found;
    },

    emptyTrash() {
      const items = manager.trashList();
      for (const t of items) rmSync(join(trashDir, t.id), { recursive: true, force: true });
      db.prepare("DELETE FROM file_trash").run();
      if (items.length) record("empty_trash", deps.principal(), { items: items.length });
      return items.length;
    },

    async open(placeId, path, opts = {}) {
      const { place, root } = placeRoot(placeId);
      const rel = cleanRelPath(path);
      const abs = resolveIn(root, rel, place.id);
      if (!existsSync(abs)) throw notFound(`"${rel || "/"}"`);
      if (!statSync(abs).isDirectory() && BLOCKED_OPEN_EXTENSIONS.has(extname(abs).toLowerCase())) {
        throw forbidden(`Nalara does not open programs or scripts (${extname(abs)}). Open it yourself if you trust it.`);
      }
      await opener(abs);
      record("open", actorOf(opts), { place: place.id, path: rel });
    },

    resolveFile(placeId, path) {
      const { place, root } = placeRoot(placeId);
      const rel = cleanRelPath(path);
      const abs = resolveIn(root, rel, place.id);
      if (!existsSync(abs) || !statSync(abs).isFile()) throw notFound(`"${rel}"`);
      return abs;
    },
  };
  return manager;
}

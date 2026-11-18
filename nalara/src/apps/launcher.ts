/**
 * Launcher: the programs installed on this computer, found where the operating system lists them, and started
 * the way the operating system starts them.
 *
 * - Windows: shortcuts in the Start menu (all users and the current user), started with explorer.exe.
 * - macOS: .app bundles in /Applications, /System/Applications and ~/Applications, started with `open`.
 * - Linux: .desktop entries in the XDG application folders (system, user, Flatpak, Snap), started with gtk-launch
 *   or gio when present, otherwise from the entry's Exec line without a shell.
 * - Only ids from the scan can be launched: no command line ever comes from a request.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir, platform as osPlatform } from "node:os";
import { basename, join } from "node:path";
import type { AuditLog, Principal } from "../kernel/types";
import type { InstalledApp } from "../shell/types";

export type { InstalledApp } from "../shell/types";

export class LauncherError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "LauncherError";
  }
}

interface Found extends InstalledApp {
  /** How to start it; never sent to clients. */
  start: { command: string; args: string[] };
}

export type Spawner = (command: string, args: string[]) => Promise<void>;

const detachedSpawn: Spawner = (command, args) =>
  new Promise((resolvePromise, reject) => {
    try {
      const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: false });
      child.once("error", (err) => reject(new LauncherError(`Could not start it: ${err.message}`, 500, "launch_failed")));
      child.once("spawn", () => {
        child.unref();
        resolvePromise();
      });
    } catch (err) {
      reject(new LauncherError(`Could not start it: ${err instanceof Error ? err.message : String(err)}`, 500, "launch_failed"));
    }
  });

const idOf = (key: string) => `app_${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;

function walk(dir: string, depth: number, match: (name: string, full: string, isDir: boolean) => boolean, out: string[]) {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const full = join(dir, name);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (match(name, full, isDir)) out.push(full);
    else if (isDir && depth > 0) walk(full, depth - 1, match, out);
  }
}

/** Splits an Exec line into words, honouring double quotes and backslash escapes (Desktop Entry spec). */
export function splitExec(exec: string): string[] {
  const words: string[] = [];
  let cur = "";
  let quoted = false;
  let any = false;
  for (let i = 0; i < exec.length; i++) {
    const c = exec[i];
    if (quoted && c === "\\" && i + 1 < exec.length) {
      cur += exec[++i];
    } else if (c === '"') {
      quoted = !quoted;
      any = true;
    } else if (!quoted && /\s/.test(c)) {
      if (cur || any) words.push(cur);
      cur = "";
      any = false;
    } else cur += c;
  }
  if (cur || any) words.push(cur);
  // Field codes (%f %U %i ...) are for files and icons; a launch without files drops them. %% is a literal %.
  return words.filter((w) => !/^%[fFuUdDnNickvm]$/.test(w)).map((w) => w.replace(/%%/g, "%"));
}

/** The [Desktop Entry] group of a .desktop file, or null when it is not a visible application. */
export function parseDesktopEntry(text: string, locale?: string): { name: string; exec: string; comment?: string; terminal: boolean } | null {
  let inEntry = false;
  const kv = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      inEntry = line === "[Desktop Entry]";
      continue;
    }
    if (!inEntry) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    kv.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  if ((kv.get("Type") ?? "Application") !== "Application") return null;
  if (kv.get("NoDisplay") === "true" || kv.get("Hidden") === "true") return null;
  const lang = locale?.split(/[._@]/)[0];
  const name = (lang && kv.get(`Name[${lang}]`)) || kv.get("Name");
  const exec = kv.get("Exec");
  if (!name || !exec) return null;
  const comment = (lang && kv.get(`Comment[${lang}]`)) || kv.get("Comment") || kv.get("GenericName");
  return { name, exec, ...(comment ? { comment } : {}), terminal: kv.get("Terminal") === "true" };
}

export interface LauncherDeps {
  audit: AuditLog;
  principal: () => Principal;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
  spawner?: Spawner;
  /** Overrides the folders scanned (tests). */
  dirs?: string[];
  /** Whether a command exists on PATH (tests). */
  hasCommand?: (cmd: string) => boolean;
  now?: () => number;
}

export interface Launcher {
  list(query?: string): InstalledApp[];
  launch(id: string, opts?: { actor?: Principal }): Promise<InstalledApp>;
  refresh(): void;
}

const CACHE_MS = 60_000;

export function createLauncher(deps: LauncherDeps): Launcher {
  const os = deps.platform ?? osPlatform();
  const env = deps.env ?? process.env;
  const home = deps.home ?? homedir();
  const spawner = deps.spawner ?? detachedSpawn;
  const now = deps.now ?? Date.now;
  let cache: { at: number; apps: Found[] } | null = null;

  const pathDirs = (env.PATH ?? "").split(os === "win32" ? ";" : ":").filter(Boolean);
  const hasCommand =
    deps.hasCommand ??
    ((cmd: string) => pathDirs.some((d) => existsSync(join(d, cmd)) || (os === "win32" && existsSync(join(d, `${cmd}.exe`)))));

  function scanWindows(): Found[] {
    const dirs = deps.dirs ?? [
      join(env.ProgramData ?? "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs"),
      join(env.APPDATA ?? join(home, "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs"),
    ];
    const files: string[] = [];
    for (const d of dirs) walk(d, 4, (name, _full, isDir) => !isDir && /\.(lnk|url|appref-ms)$/i.test(name), files);
    return files
      .filter((f) => !/uninstall|readme|help|documentation|release notes|website/i.test(basename(f)))
      .map((f) => ({
        id: idOf(f),
        name: basename(f).replace(/\.(lnk|url|appref-ms)$/i, ""),
        source: "Start menu",
        start: { command: "explorer.exe", args: [f] },
      }));
  }

  function scanMac(): Found[] {
    const dirs = deps.dirs ?? ["/Applications", "/System/Applications", join(home, "Applications")];
    const apps: string[] = [];
    for (const d of dirs) walk(d, 2, (name, _full, isDir) => isDir && name.endsWith(".app"), apps);
    return apps.map((a) => ({ id: idOf(a), name: basename(a, ".app"), source: a.startsWith(home) ? "~/Applications" : "/Applications", start: { command: "open", args: [a] } }));
  }

  function scanLinux(): Found[] {
    const dataHome = env.XDG_DATA_HOME || join(home, ".local", "share");
    const dataDirs = (env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":").filter(Boolean);
    const dirs =
      deps.dirs ??
      [join(dataHome, "applications"), ...dataDirs.map((d) => join(d, "applications")), "/var/lib/flatpak/exports/share/applications", join(dataHome, "flatpak", "exports", "share", "applications"), "/var/lib/snapd/desktop/applications"];
    const seen = new Set<string>();
    const out: Found[] = [];
    const gtk = hasCommand("gtk-launch");
    const gio = hasCommand("gio");
    for (const dir of dirs) {
      const files: string[] = [];
      walk(dir, 2, (name, _full, isDir) => !isDir && name.endsWith(".desktop"), files);
      for (const file of files) {
        const desktopId = basename(file);
        if (seen.has(desktopId)) continue; // the first folder wins, as in the XDG spec
        seen.add(desktopId);
        let entry;
        try {
          entry = parseDesktopEntry(readFileSync(file, "utf8"), env.LANG);
        } catch {
          continue;
        }
        if (!entry || entry.terminal) continue;
        const words = splitExec(entry.exec);
        if (!words.length) continue;
        const start = gtk
          ? { command: "gtk-launch", args: [desktopId.replace(/\.desktop$/, "")] }
          : gio
            ? { command: "gio", args: ["launch", file] }
            : { command: words[0], args: words.slice(1) };
        out.push({ id: idOf(file), name: entry.name, source: "applications", ...(entry.comment ? { comment: entry.comment } : {}), start });
      }
    }
    return out;
  }

  function scan(): Found[] {
    if (cache && now() - cache.at < CACHE_MS) return cache.apps;
    const found = os === "win32" ? scanWindows() : os === "darwin" ? scanMac() : scanLinux();
    // One entry per name (Start menu folders often hold the same shortcut twice).
    const byName = new Map<string, Found>();
    for (const f of found) if (!byName.has(f.name.toLowerCase())) byName.set(f.name.toLowerCase(), f);
    const apps = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    cache = { at: now(), apps };
    return apps;
  }

  const pub = ({ start: _start, ...app }: Found): InstalledApp => app;

  return {
    list(query) {
      const q = query?.trim().toLowerCase();
      const apps = scan();
      return (q ? apps.filter((a) => a.name.toLowerCase().includes(q) || a.comment?.toLowerCase().includes(q)) : apps).map(pub);
    },
    async launch(id, opts = {}) {
      const app = scan().find((a) => a.id === id);
      if (!app) throw new LauncherError(`No installed app "${id}". Refresh the list and try again.`, 404, "not_found");
      const actor = opts.actor ?? deps.principal();
      try {
        await spawner(app.start.command, app.start.args);
      } catch (err) {
        deps.audit.append({ kind: "app", principal: actor, subject: app.name, outcome: "error", detail: { id, error: err instanceof Error ? err.message : String(err) } });
        throw err;
      }
      deps.audit.append({ kind: "app", principal: actor, subject: app.name, outcome: "ok", detail: { id } });
      return pub(app);
    },
    refresh() {
      cache = null;
    },
  };
}

/**
 * Nalara desktop launcher: double-click, and the Neural Core opens in its own window.
 *
 * Built into one executable (a Node single executable application) by scripts/build-app.ts. It also runs from
 * source for development:
 *
 *   node --import tsx src/app/launcher.ts [--root DIR] [--port N] [--fullscreen] [--no-open] [--stay] [--offline] [--check]
 *
 * What it does:
 * - uses ~/Nalara as the home folder (NALARA_ROOT or --root to change it); on the first run it creates the
 *   folder with a sample project inside;
 * - if Nalara is already running on the port, it only opens another window;
 * - starts the kernel and the HTTP server on 127.0.0.1, serving the UI unpacked from the executable;
 * - opens the UI in an app window of Chrome, Edge, Chromium or Brave (no tabs, no address bar), or the default
 *   browser when none is found;
 * - stops by itself about 20 seconds after the last Nalara window closes (--stay keeps it running).
 *   Plans that were still running resume on the next start.
 */
import "./quiet";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createKernel, type NeuralKernel } from "../kernel/kernel";
import { createHttpServer, type NeuralHttpServer } from "../server/http";
import { packDir, unpackOnce, unpackTo, type FileBundle } from "./bundle";

export const DEFAULT_APP_PORT = 7437;
/** How long Nalara keeps running after its last window closed (a reload reconnects well within this). */
export const IDLE_QUIT_MS = 20_000;
const SAMPLE_FOLDER = "breath-of-fire-iv-remake";

export interface LaunchOptions {
  root: string;
  port: number;
  open: boolean;
  fullscreen: boolean;
  stay: boolean;
  offline: boolean;
  sample: boolean;
  /** Start on a free port in a temporary folder, check the API and the UI, then exit (used by CI). */
  check: boolean;
  browser?: string;
}

export class LaunchError extends Error {}

const HELP = `Nalara desktop app

  Nalara [--root DIR] [--port N] [--fullscreen] [--no-open] [--stay] [--offline] [--no-sample]
  Nalara --check

  --root DIR      Folder Nalara manages (default: ~/Nalara, or NALARA_ROOT)
  --port N        Port on 127.0.0.1 (default ${DEFAULT_APP_PORT}; a free one is used if it is taken)
  --fullscreen    Open the window full screen (F11 leaves full screen)
  --no-open       Do not open a window; print the address instead
  --stay          Keep running after the last window closes (stop with Ctrl+C)
  --offline       Do not use Claude even if ANTHROPIC_API_KEY is set
  --no-sample     Do not add the sample project to a new home folder
  --check         Self-test: start in a temporary folder, check the API and the UI, exit 0 or 1

  Claude: set ANTHROPIC_API_KEY before starting. Without it Nalara runs offline (rule-based agents).
  NALARA_BROWSER=/path/to/browser picks the browser used for the window.`;

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env, home = homedir()): LaunchOptions | "help" {
  const o: LaunchOptions = {
    root: env.NALARA_ROOT?.trim() || join(home, "Nalara"),
    port: DEFAULT_APP_PORT,
    open: true,
    fullscreen: false,
    stay: false,
    offline: false,
    sample: true,
    check: false,
    ...(env.NALARA_BROWSER?.trim() ? { browser: env.NALARA_BROWSER.trim() } : {}),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new LaunchError(`${a} needs a value`);
      return v;
    };
    switch (a) {
      case "--root":
        o.root = value();
        break;
      case "--port": {
        const n = Number(value());
        if (!Number.isInteger(n) || n < 0 || n > 65535) throw new LaunchError("--port must be a whole number from 0 to 65535");
        o.port = n;
        break;
      }
      case "--fullscreen":
        o.fullscreen = true;
        break;
      case "--no-open":
        o.open = false;
        break;
      case "--stay":
        o.stay = true;
        break;
      case "--offline":
        o.offline = true;
        break;
      case "--no-sample":
        o.sample = false;
        break;
      case "--check":
        o.check = true;
        break;
      case "-h":
      case "--help":
        return "help";
      default:
        // macOS adds -psn_... when an app is opened from Finder; ignore it and anything else unknown.
        if (a.startsWith("-psn_")) break;
        throw new LaunchError(`Unknown option ${a} (see --help)`);
    }
  }
  o.root = resolve(o.root);
  return o;
}

// --- assets ---------------------------------------------------------------------------------------------------

interface SeaModule {
  isSea(): boolean;
  getAsset(key: string, encoding: string): string;
}

function seaModule(): SeaModule | undefined {
  try {
    // node:sea exists on Node 20.12+/21.7+; process.getBuiltinModule keeps it out of the bundler's way.
    const sea = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule?.("node:sea") as SeaModule | undefined;
    return sea?.isSea() ? sea : undefined;
  } catch {
    return undefined;
  }
}

/** The UI and the sample project: from the executable when built, from the repository when run from source. */
export function loadBundle(name: "ui" | "sample"): FileBundle {
  const sea = seaModule();
  if (sea) return JSON.parse(sea.getAsset(`${name}.json`, "utf8")) as FileBundle;
  const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const dir = name === "ui" ? join(repo, "web", "dist") : join(repo, "demo", SAMPLE_FOLDER);
  if (!existsSync(dir)) throw new LaunchError(name === "ui" ? `The UI is not built (${dir}). Run: npm run build` : `Sample project missing: ${dir}`);
  return packDir(dir);
}

/** Creates the home folder on the first run, with the sample project in it. Returns true when it was created. */
export function prepareHome(root: string, sample: boolean, bundle: () => FileBundle): boolean {
  if (existsSync(root)) {
    if (!statSync(root).isDirectory()) throw new LaunchError(`${root} exists and is not a folder`);
    return false;
  }
  mkdirSync(root, { recursive: true });
  if (sample) unpackTo(bundle(), join(root, SAMPLE_FOLDER));
  return true;
}

// --- browser window -------------------------------------------------------------------------------------------

/** Chromium-family browsers that can open a site as an app window (--app), most common first. */
export function browserCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === "win32") {
    const roots = [env["ProgramFiles(x86)"], env.ProgramFiles, env.LOCALAPPDATA].filter((r): r is string => Boolean(r));
    const rel = ["Microsoft\\Edge\\Application\\msedge.exe", "Google\\Chrome\\Application\\chrome.exe", "BraveSoftware\\Brave-Browser\\Application\\brave.exe", "Chromium\\Application\\chrome.exe"];
    return rel.flatMap((r) => roots.map((root) => `${root}\\${r}`));
  }
  if (platform === "darwin") {
    const apps = [
      "Google Chrome.app/Contents/MacOS/Google Chrome",
      "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "Chromium.app/Contents/MacOS/Chromium",
      "Brave Browser.app/Contents/MacOS/Brave Browser",
    ];
    return apps.flatMap((a) => [`/Applications/${a}`, ...(env.HOME ? [`${env.HOME}/Applications/${a}`] : [])]);
  }
  const names = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable", "brave-browser"];
  const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
  return names.flatMap((n) => dirs.map((d) => join(d, n)));
}

export function findBrowser(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, exists: (p: string) => boolean = existsSync): string | undefined {
  return browserCandidates(platform, env).find((p) => exists(p));
}

export function appWindowArgs(url: string, profileDir: string, fullscreen: boolean): string[] {
  return [
    `--app=${url}`,
    // A profile of its own: the window gets its own browser process and never mixes with your browsing.
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1600,940",
    ...(fullscreen ? ["--start-fullscreen"] : []),
  ];
}

function openDefaultBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  const child = spawn(cmd, args as string[], { stdio: "ignore", detached: true, windowsHide: true });
  child.on("error", () => console.log(`Open ${url} in your browser.`));
  child.unref();
}

function openWindow(o: LaunchOptions, url: string, profileDir: string): ChildProcess | undefined {
  const browser = o.browser ?? findBrowser(process.platform, process.env);
  if (!browser) {
    console.log("No Chrome, Edge, Chromium or Brave found: opening your default browser instead.");
    openDefaultBrowser(url);
    return undefined;
  }
  mkdirSync(profileDir, { recursive: true });
  const child = spawn(browser, appWindowArgs(url, profileDir, o.fullscreen), { stdio: "ignore", windowsHide: false });
  child.on("error", (err) => {
    console.log(`Could not start ${browser} (${err.message}): opening your default browser instead.`);
    openDefaultBrowser(url);
  });
  return child;
}

// --- running ----------------------------------------------------------------------------------------------------

/** Is a Nalara server already answering on this port? Returns its address, or undefined. */
async function existingNalara(port: number): Promise<string | undefined> {
  if (port === 0) return undefined;
  const url = `http://127.0.0.1:${port}`;
  try {
    const r = await fetch(`${url}/api/version`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return undefined;
    const v = (await r.json()) as { name?: string };
    return v.name === "nalara" ? url : undefined;
  } catch {
    return undefined;
  }
}

async function listen(http: NeuralHttpServer, port: number): Promise<string> {
  try {
    return (await http.listen(port, "127.0.0.1")).url;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE" || port === 0) throw err;
    console.log(`Port ${port} is in use by another program; using a free port instead.`);
    return (await http.listen(0, "127.0.0.1")).url;
  }
}

function startKernel(o: LaunchOptions): NeuralKernel {
  return createKernel({
    root: o.root,
    host: "127.0.0.1",
    port: o.port,
    watch: !o.check,
    triggers: !o.check,
    ...(o.offline ? { useClaude: false } : {}),
  });
}

/** The self-test: everything a double-click needs, without a window. */
async function check(o: LaunchOptions): Promise<void> {
  const temp = mkdtempSync(join(tmpdir(), "nalara-check-"));
  const root = join(temp, "Nalara");
  const opts: LaunchOptions = { ...o, root, port: 0, offline: true };
  let kernel: NeuralKernel | undefined;
  let http: NeuralHttpServer | undefined;
  const results: string[] = [];
  try {
    prepareHome(root, true, () => loadBundle("sample"));
    kernel = startKernel(opts);
    await kernel.start();
    const ui = unpackOnce(loadBundle("ui"), join(kernel.config.dataDir, "app-ui"));
    http = createHttpServer(kernel, { staticDir: ui });
    const url = await listen(http, 0);
    const get = async (path: string) => {
      const r = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
      return r;
    };
    const v = (await (await get("/api/version")).json()) as { name: string; version: string; apiVersion: number };
    if (v.name !== "nalara") throw new Error(`/api/version answered ${JSON.stringify(v)}`);
    results.push(`api ${v.version} (v${v.apiVersion})`);
    const st = (await (await get("/api/status")).json()) as { files: number; mode: string };
    if (st.files < 5) throw new Error(`the sample project was not indexed (${st.files} files)`);
    results.push(`${st.files} files indexed, mode ${st.mode}`);
    const hits = (await (await get("/api/search?q=combat%20code")).json()) as { path: string }[];
    if (!hits.length) throw new Error("search returned nothing for \"combat code\"");
    results.push(`search -> ${hits[0].path}`);
    const html = await (await get("/")).text();
    if (!html.includes('id="root"')) throw new Error("the UI page did not load");
    const js = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    if (!js) throw new Error("the UI page has no script");
    await get(js);
    results.push("ui served");
    console.log(`Nalara check passed: ${results.join("; ")}`);
  } finally {
    await http?.close().catch(() => undefined);
    await kernel?.stop().catch(() => undefined);
    rmSync(temp, { recursive: true, force: true });
  }
}

/** Resolves "running" while the server should keep the process alive, "done" when there is nothing left to do. */
async function run(o: LaunchOptions): Promise<"running" | "done"> {
  const already = await existingNalara(o.port);
  if (already) {
    console.log(`Nalara is already running at ${already}; opening a window.`);
    if (o.open) {
      const child = openWindow(o, already, join(o.root, ".nalara", "app-window"));
      child?.unref();
    }
    return "done";
  }

  const created = prepareHome(o.root, o.sample, () => loadBundle("sample"));
  if (!process.stdout.isTTY) logTo(join(o.root, ".nalara", "app.log"));
  const kernel = startKernel(o);
  await kernel.start();
  const ui = unpackOnce(loadBundle("ui"), join(kernel.config.dataDir, "app-ui"));
  const http = createHttpServer(kernel, { staticDir: ui });
  let url: string;
  try {
    url = await listen(http, o.port);
  } catch (err) {
    await kernel.stop();
    throw new LaunchError(`Could not start the server: ${(err as Error).message}`);
  }

  const s = kernel.status();
  console.log(`Nalara ${s.version}`);
  console.log(`  Home folder: ${s.root}${created ? " (created, with a sample project)" : ""}`);
  console.log(`  Mode:        ${s.mode === "claude" ? `Claude (${s.model})` : "offline: rule-based agents (set ANTHROPIC_API_KEY to use Claude)"}`);
  console.log(`  Address:     ${url}`);

  let stopping = false;
  const stop = async (why: string, code = 0) => {
    if (stopping) return;
    stopping = true;
    console.log(`${why} Stopping Nalara; unfinished plans resume next time.`);
    try {
      await http.close();
      await kernel.stop();
    } finally {
      process.exit(code);
    }
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => void stop(`${sig}:`));

  if (o.open) {
    openWindow(o, url, join(kernel.config.dataDir, "app-window"));
    console.log(o.stay ? "Nalara's window is open. Press Ctrl+C here to stop Nalara." : "Nalara's window is open. Closing it stops Nalara; you can also press Ctrl+C here.");
  } else {
    console.log(`Open ${url} in a browser.${o.stay ? " Press Ctrl+C to stop." : ""}`);
  }

  if (o.stay) return "running";
  // Quit once every window has been closed for IDLE_QUIT_MS. Until the first window connects, wait (up to 5 minutes).
  let sawWindow = false;
  let idleSince = Date.now();
  const started = Date.now();
  setInterval(() => {
    if (http.liveClients() > 0) {
      sawWindow = true;
      idleSince = Date.now();
      return;
    }
    if (!sawWindow && Date.now() - started < 5 * 60_000) return;
    if (Date.now() - idleSince >= IDLE_QUIT_MS) void stop(sawWindow ? "The last Nalara window was closed." : "No window connected within 5 minutes.");
  }, 1000).unref();
  return "running";
}

/**
 * Without a console (Nalara.app on macOS, a double-click in a Linux file manager) output would vanish; copy it to
 * <home>/.nalara/app.log as well.
 */
function logTo(file: string): void {
  try {
    mkdirSync(join(file, ".."), { recursive: true });
    appendFileSync(file, `\n--- ${new Date().toISOString()}\n`);
  } catch {
    return;
  }
  for (const level of ["log", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      try {
        appendFileSync(file, `${args.map(String).join(" ")}\n`);
      } catch {
        // the log is a convenience; never let it stop Nalara
      }
    };
  }
}

/** Plain text for a dialog: one paragraph, no quotes or backslashes that the dialog tools would interpret. */
export function dialogText(message: string): string {
  return message.replace(/[\r\n]+/g, " ").replace(/["\\]/g, "'").slice(0, 500);
}

/** Makes a startup error visible: a console prompt when there is a console, a system dialog when there is none. */
async function reportStartupError(message: string): Promise<void> {
  if (process.stdin.isTTY) {
    // A double-clicked console window closes the moment the process ends; keep the error readable.
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    await rl.question("Press Enter to close.");
    rl.close();
    return;
  }
  const text = dialogText(message);
  if (process.platform === "darwin") {
    spawnSync("osascript", ["-e", `display alert "Nalara could not start" message "${text}" as critical`], { stdio: "ignore" });
  } else if (process.platform === "linux") {
    const z = spawnSync("zenity", ["--error", "--title=Nalara", `--text=Nalara could not start: ${text}`], { stdio: "ignore" });
    if (z.error) spawnSync("notify-send", ["Nalara could not start", text], { stdio: "ignore" });
  }
}

/** Exit code, or undefined while Nalara keeps running (the server holds the process open). */
export async function main(argv = process.argv.slice(2)): Promise<number | undefined> {
  let o: LaunchOptions | "help";
  try {
    o = parseArgs(argv);
  } catch (err) {
    console.error(`Nalara: ${(err as Error).message}`);
    return 2;
  }
  if (o === "help") {
    console.log(HELP);
    return 0;
  }
  try {
    if (o.check) {
      await check(o);
      return 0;
    }
    return (await run(o)) === "running" ? undefined : 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Nalara could not start: ${message}`);
    if (!o.check) await reportStartupError(message);
    return 1;
  }
}

/** True when this file is the program being run (the built executable, or `node ... src/app/launcher.ts`). */
function isEntry(): boolean {
  if (seaModule()) return true;
  try {
    return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntry()) {
  void main().then((code) => {
    if (code !== undefined) process.exit(code);
  });
}

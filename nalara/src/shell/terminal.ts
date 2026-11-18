/**
 * Terminal: run commands on this computer from Nalara.
 *
 * - Each command runs in the system shell (PowerShell on Windows, the user's sh/bash/zsh elsewhere) in the
 *   terminal's current folder, with output streamed as it comes. It is a command console, not a full TTY:
 *   full-screen programs (vim, top) do not work; input can be sent line by line.
 * - `cd <folder>` on its own changes the terminal's folder (each command starts a fresh shell, so a `cd` inside
 *   a longer command line does not carry over). `cd` alone goes to the Nalara folder, `cd ~` to the user's home.
 * - Commands typed by the user run as the user. Commands from the assistant or an agent go through the
 *   shell.run tool, which always needs the user's approval. Every command is audited; none run while halted.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir, platform as osPlatform } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";
import { newId } from "../kernel/ids";
import type { AuditLog, Principal } from "../kernel/types";
import type { TerminalEvent } from "./types";

export type { TerminalEvent } from "./types";

/** Output kept per command for the audit log and the tool result; the stream itself is not capped. */
const TAIL_CHARS = 20_000;
export const TOOL_TIMEOUT_MS = 120_000;

export class TerminalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "TerminalError";
  }
}

export interface ShellSpec {
  command: string;
  args: (line: string) => string[];
  name: string;
}

/** The shell used for each command line. */
export function defaultShell(os = osPlatform(), env: NodeJS.ProcessEnv = process.env): ShellSpec {
  if (os === "win32") {
    return {
      name: "PowerShell",
      command: "powershell.exe",
      // UTF-8 output, so non-ASCII text survives.
      args: (line) => ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${line}`],
    };
  }
  const user = env.SHELL && /\/(bash|zsh|sh|dash|ksh|fish)$/.test(env.SHELL) && existsSync(env.SHELL) ? env.SHELL : "/bin/sh";
  return { name: basename(user), command: user, args: (line) => ["-c", line] };
}

/** `cd`, `cd ~`, `cd ..`, `cd "My Folder"` alone on the line; anything more complex runs in the shell. */
export function parseCd(line: string): string | null | undefined {
  const m = /^\s*cd(?:\s+(.*?))?\s*$/i.exec(line);
  if (!m) return undefined;
  if (/[;&|<>`$]/.test(m[1] ?? "")) return undefined;
  const arg = (m[1] ?? "").trim().replace(/^(["'])(.*)\1$/, "$2");
  return arg || null;
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*(\u0007|\u001b\\)|\u001b[()][AB012]/g;
export const stripAnsi = (text: string) => text.replace(ANSI, "");

export interface RunOptions {
  cwd?: string;
  actor?: Principal;
  signal?: AbortSignal;
  onEvent?: (ev: TerminalEvent) => void;
  /** Kill after this long (the tool sets 2 minutes; the user's own commands have none). */
  timeoutMs?: number;
}

export interface RunResult {
  id: string;
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  output: string;
  timedOut: boolean;
}

export interface Terminal {
  readonly shellName: string;
  readonly home: string;
  run(line: string, opts?: RunOptions): Promise<RunResult>;
  input(id: string, text: string): boolean;
  kill(id: string): boolean;
  running(): string[];
  killAll(): void;
}

export interface TerminalDeps {
  home: string;
  audit: AuditLog;
  principal: () => Principal;
  isHalted: () => boolean;
  redact?: (text: string) => string;
  shell?: ShellSpec;
  env?: NodeJS.ProcessEnv;
}

export function createTerminal(deps: TerminalDeps): Terminal {
  const shell = deps.shell ?? defaultShell();
  const children = new Map<string, ChildProcess>();
  const redact = deps.redact ?? ((t: string) => t);

  function resolveCwd(cwd: string | undefined): string {
    const dir = cwd && cwd.trim() ? cwd : deps.home;
    if (!isAbsolute(dir)) throw new TerminalError(`The folder must be a full path: ${dir}`, 400, "invalid_request");
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new TerminalError(`The folder does not exist: ${dir}`, 404, "not_found");
    return dir;
  }

  async function run(line: string, opts: RunOptions = {}): Promise<RunResult> {
    const command = String(line ?? "").replace(/\r?\n$/, "");
    if (!command.trim()) throw new TerminalError("command is required", 400, "invalid_request");
    if (deps.isHalted()) throw new TerminalError("Nalara is halted. Resume it to run commands.", 409, "kernel_halted");
    const cwd = resolveCwd(opts.cwd);
    const actor = opts.actor ?? deps.principal();
    const id = newId("cmd");
    const emit = opts.onEvent ?? (() => undefined);
    emit({ type: "start", id, cwd, shell: shell.name });

    // cd is handled here: the next command starts in the new folder.
    const cd = parseCd(command);
    if (cd !== undefined) {
      // `cd` alone: the Nalara folder. `cd ~`: the user's home folder, as in any shell.
      const target = cd === null ? deps.home : cd === "~" ? homedir() : cd.startsWith("~/") || cd.startsWith("~\\") ? resolve(homedir(), cd.slice(2)) : resolve(cwd, cd);
      const ok = existsSync(target) && statSync(target).isDirectory();
      const output = ok ? "" : `cd: no such folder: ${cd}\n`;
      if (!ok) emit({ type: "output", stream: "stderr", text: output });
      const result: RunResult = { id, cwd: ok ? target : cwd, exitCode: ok ? 0 : 1, signal: null, output, timedOut: false };
      deps.audit.append({ kind: "shell", principal: actor, subject: "terminal", outcome: ok ? "ok" : "error", detail: { command, cwd, exitCode: result.exitCode } });
      emit({ type: "exit", id, exitCode: result.exitCode, signal: null, cwd: result.cwd });
      return result;
    }

    return new Promise<RunResult>((resolvePromise) => {
      let tail = "";
      let timedOut = false;
      const started = Date.now();
      const child = spawn(shell.command, shell.args(command), {
        cwd,
        env: { ...(deps.env ?? process.env), TERM: "dumb", NO_COLOR: "1", PAGER: "cat", GIT_PAGER: "cat" },
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        // Its own process group on Unix, so Stop ends the whole command line (pipes, subshells).
        detached: osPlatform() !== "win32",
      });
      children.set(id, child);
      const out = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
        const text = redact(stripAnsi(chunk.toString("utf8")));
        tail = (tail + text).slice(-TAIL_CHARS);
        emit({ type: "output", stream, text });
      };
      child.stdout?.on("data", out("stdout"));
      child.stderr?.on("data", out("stderr"));
      child.stdin?.on("error", () => undefined);
      const timer = opts.timeoutMs
        ? setTimeout(() => {
            timedOut = true;
            kill(id);
          }, opts.timeoutMs)
        : undefined;
      const onAbort = () => kill(id);
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      let done = false;
      const finish = (exitCode: number | null, signal: string | null, error?: string) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        children.delete(id);
        if (error) {
          const text = `${error}\n`;
          tail += text;
          emit({ type: "output", stream: "stderr", text });
        }
        deps.audit.append({
          kind: "shell",
          principal: actor,
          subject: "terminal",
          outcome: exitCode === 0 ? "ok" : "error",
          detail: { command, cwd, exitCode, signal, durationMs: Date.now() - started, ...(timedOut ? { timedOut: true } : {}) },
        });
        emit({ type: "exit", id, exitCode, signal, cwd, ...(timedOut ? { timedOut: true } : {}) });
        resolvePromise({ id, cwd, exitCode, signal, output: tail, timedOut });
      };
      child.once("error", (err) => finish(null, null, `Could not start ${shell.name}: ${err.message}`));
      child.once("close", (code, sig) => finish(code, sig));
    });
  }

  function kill(id: string): boolean {
    const child = children.get(id);
    if (!child || child.exitCode !== null) return false;
    try {
      if (osPlatform() === "win32") {
        // Ends the whole tree (PowerShell and what it started).
        spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" }).on("error", () => child.kill());
      } else if (child.pid) {
        process.kill(-child.pid, "SIGTERM");
        setTimeout(() => {
          try {
            if (child.exitCode === null && child.pid) process.kill(-child.pid, "SIGKILL");
          } catch {
            // already gone
          }
        }, 2000).unref?.();
      }
    } catch {
      child.kill();
    }
    return true;
  }

  return {
    shellName: shell.name,
    home: deps.home,
    run,
    input(id, text) {
      const child = children.get(id);
      if (!child?.stdin || child.stdin.destroyed) return false;
      child.stdin.write(text.endsWith("\n") ? text : `${text}\n`);
      return true;
    },
    kill,
    running: () => [...children.keys()],
    killAll() {
      for (const id of [...children.keys()]) kill(id);
    },
  };
}

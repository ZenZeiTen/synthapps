import { afterAll, describe, expect, it } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseDesktopEntry, splitExec } from "../src/apps/launcher";
import { createKernel, type NeuralKernel } from "../src/kernel/kernel";
import { createScriptedProvider } from "../src/llm/scripted";
import { createHttpServer, type NeuralHttpServer } from "../src/server/http";
import { parseCd, stripAnsi, type TerminalEvent } from "../src/shell/terminal";

const DEMO = path.resolve(__dirname, "../demo/lantern-road");
const temps: string[] = [];
const kernels: NeuralKernel[] = [];
const servers: NeuralHttpServer[] = [];
const isWin = process.platform === "win32";

afterAll(async () => {
  for (const s of servers) await s.close().catch(() => undefined);
  for (const k of kernels) await k.stop().catch(() => undefined);
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

function tmp(prefix: string) {
  const d = mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(d);
  return d;
}

/** A fake XDG applications folder: two visible apps, one hidden, one terminal app. */
function appsDir() {
  const dir = tmp("nos-apps-");
  const entry = (file: string, body: string) => writeFileSync(path.join(dir, file), `[Desktop Entry]\nType=Application\n${body}\n`);
  entry("org.example.Writer.desktop", 'Name=Writer\nComment=Write documents\nExec=writer --new-window %U\nIcon=writer');
  entry("calc.desktop", 'Name=Calculator\nExec="/opt/my apps/calc" --mode=basic');
  entry("hidden.desktop", "Name=Hidden\nExec=hidden\nNoDisplay=true");
  entry("htop.desktop", "Name=htop\nExec=htop\nTerminal=true");
  return dir;
}

async function boot(llm: ReturnType<typeof createScriptedProvider> | null = null) {
  const root = tmp("nos-shell-");
  cpSync(DEMO, root, { recursive: true, filter: (src) => !src.split(path.sep).includes(".nalara") });
  const launched: { command: string; args: string[] }[] = [];
  const kernel = createKernel(
    { root, watch: false, triggers: false, port: 0 },
    { env: {}, llm, appDirs: [appsDir()], appSpawner: async (command, args) => void launched.push({ command, args }) },
  );
  kernels.push(kernel);
  await kernel.start();
  return { kernel, root: realpathSync(root), launched };
}

describe("terminal helpers", () => {
  it("recognises a plain cd and leaves compound lines to the shell", () => {
    expect(parseCd("cd")).toBeNull();
    expect(parseCd("cd src/combat")).toBe("src/combat");
    expect(parseCd('cd "My Folder"')).toBe("My Folder");
    expect(parseCd("cd .. && ls")).toBeUndefined();
    expect(parseCd("cdx")).toBeUndefined();
    expect(parseCd("echo cd")).toBeUndefined();
  });
  it("strips colour codes", () => {
    expect(stripAnsi("\u001b[31mred\u001b[0m plain")).toBe("red plain");
  });
});

describe.skipIf(isWin)("terminal", () => {
  it("runs a command in the Nalara folder, streams its output and audits it", async () => {
    const { kernel, root } = await boot();
    const events: TerminalEvent[] = [];
    const r = await kernel.terminal.run("echo hello && echo oops 1>&2 && pwd", { onEvent: (e) => events.push(e) });
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain("hello");
    expect(r.output).toContain(root);
    expect(events[0]).toMatchObject({ type: "start", cwd: root });
    expect(events.some((e) => e.type === "output" && e.stream === "stderr" && e.text.includes("oops"))).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "exit", exitCode: 0, cwd: root });
    const audited = kernel.audit.list({ limit: 5000 }).filter((e) => e.kind === "shell");
    expect(audited.at(-1)).toMatchObject({ outcome: "ok", detail: { command: "echo hello && echo oops 1>&2 && pwd", exitCode: 0 } });
  });

  it("changes folder with cd, reports failures, and can be stopped", async () => {
    const { kernel, root } = await boot();
    const cd = await kernel.terminal.run("cd src/combat", { cwd: root });
    expect(cd.cwd).toBe(path.join(root, "src/combat"));
    const ls = await kernel.terminal.run("ls", { cwd: cd.cwd });
    expect(ls.output).toMatch(/damage/);
    expect((await kernel.terminal.run("cd nowhere", { cwd: root })).exitCode).toBe(1);
    expect((await kernel.terminal.run("cd", { cwd: cd.cwd })).cwd).toBe(root);
    expect((await kernel.terminal.run("exit 3")).exitCode).toBe(3);

    let id = "";
    const long = kernel.terminal.run("sleep 30", { onEvent: (e) => e.type === "start" && (id = e.id) });
    await new Promise((r) => setTimeout(r, 200));
    expect(kernel.terminal.running()).toContain(id);
    expect(kernel.terminal.kill(id)).toBe(true);
    const stopped = await long;
    expect(stopped.exitCode === null || stopped.exitCode !== 0).toBe(true);
    expect(kernel.terminal.running()).toEqual([]);
  });

  it("sends input to a running command", async () => {
    const { kernel } = await boot();
    let id = "";
    const p = kernel.terminal.run("read name; echo hi $name", { onEvent: (e) => e.type === "start" && (id = e.id) });
    await new Promise((r) => setTimeout(r, 150));
    expect(kernel.terminal.input(id, "Ada")).toBe(true);
    expect((await p).output).toContain("hi Ada");
  });

  it("refuses commands while halted and stops running ones on halt", async () => {
    const { kernel } = await boot();
    const long = kernel.terminal.run("sleep 30");
    await new Promise((r) => setTimeout(r, 150));
    kernel.halt("test");
    expect((await long).exitCode).not.toBe(0);
    await expect(kernel.terminal.run("echo hi")).rejects.toMatchObject({ code: "kernel_halted" });
  });

  it("redacts saved secrets from the output", async () => {
    const { kernel } = await boot();
    kernel.setSecret("MY_TOKEN", "tok-1234567890");
    const r = await kernel.terminal.run("echo tok-1234567890");
    expect(r.output).not.toContain("tok-1234567890");
  });

  it("shell.run is not offered to the assistant, and needs approval when called", async () => {
    const llm = createScriptedProvider({ agent: [{ text: "I can't run commands; open Terminal for that." }] });
    const { kernel } = await boot(llm);
    await kernel.assistant.ask("Run echo");
    const req = llm.calls.find((c) => c.method === "runAgentLoop")!.req as { tools: { name: string }[] };
    expect(req.tools.map((t) => t.name).filter((n) => n.startsWith("shell."))).toEqual([]);
    expect(kernel.tools.list().find((t) => t.name === "shell.run")).toMatchObject({ reversibility: "irreversible" });
  });

  it("streams over HTTP as NDJSON", async () => {
    const { kernel } = await boot();
    const http = createHttpServer(kernel);
    servers.push(http);
    const { url } = await http.listen(0, "127.0.0.1");
    const r = await fetch(`${url}/api/terminal/run`, { method: "POST", headers: { "Content-Type": "application/json", "X-Nalara-Client": "1" }, body: JSON.stringify({ command: "echo over-http" }) });
    const events = (await r.text()).trim().split("\n").map((l) => JSON.parse(l) as TerminalEvent);
    expect(events.map((e) => e.type)).toEqual(["start", "output", "exit"]);
    expect(JSON.stringify(events)).toContain("over-http");
    expect(((await (await fetch(`${url}/api/terminal`)).json()) as { home: string }).home).toBe(kernel.terminal.home);
  });
});

describe("launcher", () => {
  it("parses desktop entries and their Exec lines", () => {
    expect(parseDesktopEntry("[Desktop Entry]\nName=A\nName[de]=B\nExec=a %F\nNoDisplay=false", "de_DE.UTF-8")).toMatchObject({ name: "B", exec: "a %F" });
    expect(parseDesktopEntry("[Desktop Entry]\nType=Link\nName=A\nURL=x")).toBeNull();
    expect(splitExec('"/opt/my apps/calc" --mode=basic %U')).toEqual(["/opt/my apps/calc", "--mode=basic"]);
    expect(splitExec("app --pct=100%%")).toEqual(["app", "--pct=100%"]);
  });

  it("lists visible apps by name, launches only listed ids, and audits launches", async () => {
    const { kernel, launched } = await boot();
    const apps = kernel.launcher.list();
    expect(apps.map((a) => a.name)).toEqual(["Calculator", "Writer"]);
    expect(kernel.launcher.list("document").map((a) => a.name)).toEqual(["Writer"]);
    expect(JSON.stringify(apps)).not.toContain("--new-window"); // how it starts is never sent out
    await kernel.launcher.launch(apps[1].id);
    expect(launched).toHaveLength(1);
    // gtk-launch or gio when installed, otherwise the Exec line without its field codes.
    const [l] = launched;
    const started =
      (l.command === "gtk-launch" && l.args.join(" ") === "org.example.Writer") ||
      (l.command === "gio" && l.args[0] === "launch" && l.args[1].endsWith("org.example.Writer.desktop")) ||
      (l.command === "writer" && l.args.join(" ") === "--new-window");
    expect(started, JSON.stringify(l)).toBe(true);
    await expect(kernel.launcher.launch("app_nope")).rejects.toMatchObject({ code: "not_found" });
    expect(kernel.audit.list({ limit: 5000 }).filter((e) => e.kind === "app").map((e) => e.subject)).toEqual(["Writer"]);
  });

  it("apps.* is not offered to the assistant; apps.launch is irreversible", async () => {
    const llm = createScriptedProvider({ agent: [{ text: "Open Start to see your apps." }] });
    const { kernel } = await boot(llm);
    await kernel.assistant.ask("Do I have a calculator?");
    const req = llm.calls.find((c) => c.method === "runAgentLoop")!.req as { tools: { name: string }[] };
    expect(req.tools.map((t) => t.name).filter((n) => n.startsWith("apps."))).toEqual([]);
    const def = kernel.tools.list().find((t) => t.name === "apps.launch");
    expect(def).toMatchObject({ action: "execute", reversibility: "irreversible" });
  });
});

describe("folders", () => {
  it("a cd target with spaces works", async () => {
    if (isWin) return;
    const { kernel, root } = await boot();
    mkdirSync(path.join(root, "My Folder"));
    expect((await kernel.terminal.run('cd "My Folder"', { cwd: root })).cwd).toBe(path.join(root, "My Folder"));
  });
});

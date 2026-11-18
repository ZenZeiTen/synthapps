/**
 * shell.run and apps.* tools for agents and the assistant. Running a command or starting a program is
 * irreversible, so the ToolRegistry asks the user every time (in "ask" and "auto" mode alike).
 */
import { isAbsolute, resolve } from "node:path";
import type { Launcher } from "../apps/launcher";
import type { JsonSchemaObject, ToolRegistry, ToolResult } from "../kernel/types";
import { TOOL_TIMEOUT_MS, type Terminal } from "./terminal";

function schema(properties: Record<string, unknown>, required: string[] = []): JsonSchemaObject {
  return { type: "object", properties, required, additionalProperties: false };
}

const failed = (err: unknown): ToolResult => {
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, content: message, error: message };
};

export function registerShellTools(registry: ToolRegistry, terminal: Terminal, launcher: Launcher): string[] {
  registry.register(
    {
      name: "shell.run",
      description:
        "Run one command line in the system shell on the user's computer and return its output (2 minute limit). The user approves each command. Prefer files.* and fs.* tools for reading and writing files.",
      server: "builtin:shell",
      action: "execute",
      reversibility: "irreversible",
      scope: "external",
      inputSchema: schema(
        {
          command: { type: "string", minLength: 1, description: "The command line, e.g. \"git log -5 --oneline\"." },
          cwd: { type: "string", description: "Folder to run in: a full path, or a path relative to the Nalara folder. Default: the Nalara folder." },
        },
        ["command"],
      ),
    },
    async (input, ctx) => {
      try {
        const cwd = typeof input.cwd === "string" && input.cwd.trim() ? (isAbsolute(input.cwd) ? input.cwd : resolve(terminal.home, input.cwd)) : terminal.home;
        const r = await terminal.run(String(input.command), { cwd, actor: ctx.principal, timeoutMs: TOOL_TIMEOUT_MS, ...(ctx.signal ? { signal: ctx.signal } : {}) });
        const status = r.timedOut ? "stopped after 2 minutes" : `exit code ${r.exitCode ?? r.signal}`;
        return { ok: r.exitCode === 0, content: `${r.output || "(no output)"}\n[${status}]`, data: { exitCode: r.exitCode, cwd: r.cwd }, ...(r.exitCode === 0 ? {} : { error: status }) };
      } catch (err) {
        return failed(err);
      }
    },
    { preview: (input) => `${typeof input.cwd === "string" && input.cwd ? `[${input.cwd}] ` : ""}${String(input.command ?? "")}` },
  );

  registry.register(
    {
      name: "apps.list",
      description: "List the programs installed on the user's computer (from the system's app menus), optionally filtered by name.",
      server: "builtin:apps",
      action: "read",
      reversibility: "reversible",
      scope: "tenant",
      inputSchema: schema({ query: { type: "string" } }),
    },
    async (input) => {
      try {
        const apps = launcher.list(typeof input.query === "string" ? input.query : undefined);
        return { ok: true, content: apps.length ? apps.map((a) => `${a.id}\t${a.name}${a.comment ? `\t${a.comment}` : ""}`).join("\n") : "(no matching apps)", data: apps };
      } catch (err) {
        return failed(err);
      }
    },
  );

  registry.register(
    {
      name: "apps.launch",
      description: "Start an installed program by its id from apps.list. The user approves each launch.",
      server: "builtin:apps",
      action: "execute",
      reversibility: "irreversible",
      scope: "external",
      inputSchema: schema({ id: { type: "string", minLength: 1 } }, ["id"]),
    },
    async (input, ctx) => {
      try {
        const app = await launcher.launch(String(input.id), { actor: ctx.principal });
        return { ok: true, content: `Started ${app.name}`, data: app };
      } catch (err) {
        return failed(err);
      }
    },
    { preview: (input) => `start ${launcher.list().find((a) => a.id === input.id)?.name ?? String(input.id)}` },
  );
  return ["shell.run", "apps.list", "apps.launch"];
}

/**
 * files.* tools: the file manager for agents and the assistant. Each call passes the ToolRegistry, so the tool
 * policy decides what needs the user's approval (moves, copies, saves and trashing are compensable; opening a file
 * in another app is irreversible).
 */
import type { JsonSchemaObject, ToolDefinition, ToolHandler, ToolRegistry, ToolResult } from "../kernel/types";
import { FileError, type FileManager } from "./manager";

const place = { type: "string", description: 'Place id from files.places; default "home" (the Nalara folder).' };
const path = { type: "string", description: "Path relative to the place, with / separators." };

function schema(properties: Record<string, unknown>, required: string[] = []): JsonSchemaObject {
  return { type: "object", properties, required, additionalProperties: false };
}

function result(fn: () => ToolResult | Promise<ToolResult>): Promise<ToolResult> {
  return Promise.resolve()
    .then(fn)
    .catch((err: unknown) => {
      const message = err instanceof FileError || err instanceof Error ? err.message : String(err);
      return { ok: false, content: message, error: message };
    });
}

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

export function registerFileTools(registry: ToolRegistry, files: FileManager): string[] {
  const defs: [Omit<ToolDefinition, "server" | "scope">, ToolHandler][] = [
    [
      {
        name: "files.places",
        description: "List the folders the user's file manager can reach (the Nalara folder and folders the user added), with their ids.",
        action: "read",
        reversibility: "reversible",
        inputSchema: schema({}),
      },
      () =>
        result(() => {
          const list = files.places();
          return { ok: true, content: list.map((p) => `${p.id}\t${p.name}\t${p.path}${p.exists ? "" : " (missing)"}`).join("\n"), data: list };
        }),
    ],
    [
      {
        name: "files.list",
        description: "List a folder: subfolders first, then files with size and modification time.",
        action: "read",
        reversibility: "reversible",
        inputSchema: schema({ place, path, hidden: { type: "boolean", description: "Include hidden files (names starting with a dot)." } }),
      },
      (input) =>
        result(() => {
          const listing = files.list(str(input.place), str(input.path) ?? "", { hidden: input.hidden === true });
          const lines = listing.entries.map((e) => (e.type === "dir" ? `${e.path}/` : `${e.path}\t${size(e.size)}\t${new Date(e.mtimeMs).toISOString().slice(0, 16)}`));
          return { ok: true, content: lines.length ? lines.join("\n") : "(empty folder)", data: listing };
        }),
    ],
    [
      {
        name: "files.read",
        description: "Read a text file in any place (up to 2 MB).",
        action: "read",
        reversibility: "reversible",
        inputSchema: schema({ place, path }, ["path"]),
      },
      (input) =>
        result(() => {
          const f = files.read(str(input.place), String(input.path));
          return { ok: true, content: f.content, data: { place: f.place, path: f.path, size: f.size } };
        }),
    ],
    [
      {
        name: "files.write",
        description: "Create or overwrite a text file in any place.",
        action: "write",
        reversibility: "compensable",
        inputSchema: schema({ place, path, content: { type: "string" } }, ["path", "content"]),
      },
      (input, ctx) =>
        result(() => {
          const e = files.write(str(input.place), String(input.path), String(input.content), { actor: ctx.principal });
          return { ok: true, content: `Saved ${e.path} (${size(e.size)})`, data: e };
        }),
    ],
    [
      {
        name: "files.mkdir",
        description: "Create a folder (its parent must exist).",
        action: "write",
        reversibility: "reversible",
        inputSchema: schema({ place, path }, ["path"]),
      },
      (input, ctx) =>
        result(() => {
          const e = files.mkdir(str(input.place), String(input.path), { actor: ctx.principal });
          return { ok: true, content: `Created folder ${e.path}`, data: e };
        }),
    ],
    [
      {
        name: "files.move",
        description: "Rename or move a file or folder within a place. Fails if the target exists.",
        action: "write",
        reversibility: "compensable",
        inputSchema: schema({ place, from: path, to: path }, ["from", "to"]),
      },
      (input, ctx) =>
        result(() => {
          const e = files.move(str(input.place), String(input.from), String(input.to), { actor: ctx.principal });
          return { ok: true, content: `Moved ${String(input.from)} to ${e.path}`, data: e };
        }),
    ],
    [
      {
        name: "files.copy",
        description: "Copy a file or folder within a place. Fails if the target exists.",
        action: "write",
        reversibility: "compensable",
        inputSchema: schema({ place, from: path, to: path }, ["from", "to"]),
      },
      (input, ctx) =>
        result(() => {
          const e = files.copy(str(input.place), String(input.from), String(input.to), { actor: ctx.principal });
          return { ok: true, content: `Copied ${String(input.from)} to ${e.path}`, data: e };
        }),
    ],
    [
      {
        name: "files.trash",
        description: "Move a file or folder to Nalara's trash, from where the user can restore it.",
        action: "write",
        reversibility: "compensable",
        inputSchema: schema({ place, path }, ["path"]),
      },
      (input, ctx) =>
        result(() => {
          const t = files.trash(str(input.place), String(input.path), { actor: ctx.principal });
          return { ok: true, content: `Moved ${t.path} to the trash (${t.id})`, data: t };
        }),
    ],
    [
      {
        name: "files.open",
        description: "Open a file or folder in the computer's default app (never programs or scripts).",
        action: "execute",
        reversibility: "irreversible",
        inputSchema: schema({ place, path }, ["path"]),
      },
      (input, ctx) =>
        result(async () => {
          await files.open(str(input.place), String(input.path), { actor: ctx.principal });
          return { ok: true, content: `Opened ${String(input.path)}` };
        }),
    ],
  ];
  for (const [def, handler] of defs) registry.register({ ...def, server: "builtin:files", scope: "tenant" }, handler);
  return defs.map(([d]) => d.name);
}

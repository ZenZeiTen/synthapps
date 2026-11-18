import { afterAll, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanRelPath } from "../src/files/manager";
import { createKernel, type NeuralKernel } from "../src/kernel/kernel";
import { createScriptedProvider } from "../src/llm/scripted";
import { createHttpServer, type NeuralHttpServer } from "../src/server/http";
import type { KernelEvent } from "../src/kernel/types";

const DEMO = path.resolve(__dirname, "../demo/breath-of-fire-iv-remake");
const temps: string[] = [];
const kernels: NeuralKernel[] = [];
const servers: NeuralHttpServer[] = [];

afterAll(async () => {
  for (const s of servers) await s.close().catch(() => undefined);
  for (const k of kernels) await k.stop().catch(() => undefined);
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

async function boot(opts: { llm?: ReturnType<typeof createScriptedProvider> | null } = {}) {
  const root = tmp("nos-files-");
  cpSync(DEMO, root, { recursive: true, filter: (src) => !src.split(path.sep).includes(".nalara") });
  const opened: string[] = [];
  const docs = tmp("nos-docs-");
  writeFileSync(path.join(docs, "letter.txt"), "Dear team,\n");
  const kernel = createKernel(
    { root, watch: false, triggers: false, port: 0 },
    {
      env: {},
      llm: opts.llm ?? null,
      opener: async (abs) => void opened.push(abs),
      placeSuggestions: () => [
        { name: "Documents", path: docs },
        { name: "Nowhere", path: path.join(docs, "missing") },
      ],
    },
  );
  kernels.push(kernel);
  await kernel.start();
  const events: KernelEvent[] = [];
  kernel.bus.subscribe("file.*", (e) => void events.push(e));
  return { kernel, root, docs, opened, events };
}

describe("paths", () => {
  it("accepts relative paths and refuses absolute ones and ..", () => {
    expect(cleanRelPath("src//combat/./damage.ts")).toBe("src/combat/damage.ts");
    expect(cleanRelPath("src\\combat")).toBe("src/combat");
    expect(cleanRelPath("")).toBe("");
    for (const bad of ["/etc/passwd", "C:\\Windows", "../x", "a/../../b", "a\0b"]) expect(() => cleanRelPath(bad), bad).toThrow();
  });
});

describe("file manager", () => {
  it("lists folders first, hides .nalara and dot files, and reads text", async () => {
    const { kernel } = await boot();
    const top = kernel.files.list(undefined, "");
    expect(top.parent).toBeNull();
    const names = top.entries.map((e) => e.name);
    expect(names).not.toContain(".nalara");
    const firstFile = top.entries.findIndex((e) => e.type === "file");
    expect(top.entries.slice(0, firstFile).every((e) => e.type === "dir")).toBe(true);
    expect(names).toContain("src");
    const combat = kernel.files.list("home", "src/combat");
    expect(combat.parent).toBe("src");
    expect(combat.entries.some((e) => e.name === "damage.ts" && e.kind === "code")).toBe(true);
    expect(kernel.files.read(undefined, "src/combat/damage.ts").content).toMatch(/damage/i);
    expect(() => kernel.files.list(undefined, ".nalara")).toThrow(/data folder/);
    expect(() => kernel.files.read(undefined, "../outside.txt")).toThrow();
  });

  it("creates, saves, makes folders, renames, copies, trashes and restores, with events and audit", async () => {
    const { kernel, root, events } = await boot();
    const f = kernel.files;
    f.mkdir(undefined, "notes");
    f.write(undefined, "notes/a.md", "# A\n", { mode: "create" });
    expect(() => f.write(undefined, "notes/a.md", "again", { mode: "create" })).toThrow(/already exists/);
    f.write(undefined, "notes/a.md", "# A, edited\n", { mode: "overwrite" });
    expect(readFileSync(path.join(root, "notes/a.md"), "utf8")).toBe("# A, edited\n");
    expect(() => f.write(undefined, "missing/x.md", "x")).toThrow(/does not exist/);

    f.move(undefined, "notes/a.md", "notes/b.md");
    expect(existsSync(path.join(root, "notes/a.md"))).toBe(false);
    f.copy(undefined, "notes/b.md", "notes/c.md");
    expect(() => f.move(undefined, "notes/b.md", "notes/c.md")).toThrow(/already exists/);
    expect(() => f.move(undefined, "notes", "notes/inner")).toThrow(/into itself/);

    const item = f.trash(undefined, "notes/b.md");
    expect(existsSync(path.join(root, "notes/b.md"))).toBe(false);
    expect(f.trashList()[0]).toMatchObject({ id: item.id, path: "notes/b.md", type: "file" });
    // The name is taken again before the restore: it comes back next to it.
    f.write(undefined, "notes/b.md", "new b");
    const restored = f.restore(item.id);
    expect(restored.path).toBe("notes/b (restored).md");
    expect(readFileSync(path.join(root, "notes/b (restored).md"), "utf8")).toBe("# A, edited\n");
    expect(f.trashList()).toEqual([]);

    // A whole folder goes to the trash and is emptied for good.
    f.trash(undefined, "notes");
    expect(f.emptyTrash()).toBe(1);
    expect(existsSync(path.join(root, "notes"))).toBe(false);

    await kernel.bus.drain();
    expect(events.map((e) => e.type)).toContain("file.created");
    expect(events.map((e) => e.type)).toContain("file.deleted");
    const audited = kernel.audit.list({ limit: 5000 }).filter((e) => e.kind === "file").map((e) => e.subject);
    expect(audited).toEqual(expect.arrayContaining(["files.mkdir", "files.create", "files.save", "files.move", "files.copy", "files.trash", "files.restore", "files.empty_trash"]));
  });

  it("refuses names with separators and changes to Nalara's data folder", async () => {
    const { kernel } = await boot();
    expect(() => kernel.files.mkdir(undefined, "bad:name")).toThrow(/cannot contain/);
    expect(() => kernel.files.write(undefined, ".nalara/x.json", "{}")).toThrow(/data folder/);
    expect(() => kernel.files.trash(undefined, "")).toThrow(/place itself/);
  });

  it("refuses a link that leads outside the place", async () => {
    const { kernel, root } = await boot();
    const outside = tmp("nos-outside-");
    writeFileSync(path.join(outside, "secret.txt"), "s3cret");
    try {
      symlinkSync(outside, path.join(root, "escape"), "dir");
    } catch {
      return; // no symlink permission (Windows without developer mode)
    }
    expect(() => kernel.files.read(undefined, "escape/secret.txt")).toThrow(/outside/);
    expect(() => kernel.files.list(undefined, "escape")).toThrow(/outside/);
  });

  it("adds places, suggests existing folders only, and works inside them", async () => {
    const { kernel, docs } = await boot();
    expect(kernel.files.suggestedPlaces().map((s) => s.name)).toEqual(["Documents"]);
    expect(() => kernel.files.addPlace("relative/path")).toThrow(/full path/);
    expect(() => kernel.files.addPlace(os.homedir())).toThrow(/specific folder/);
    const place = kernel.files.addPlace(docs, "Documents");
    expect(kernel.files.addPlace(docs).id).toBe(place.id); // added once
    expect(kernel.files.suggestedPlaces()).toEqual([]);
    expect(kernel.files.list(place.id, "").entries.map((e) => e.name)).toEqual(["letter.txt"]);
    kernel.files.write(place.id, "letter.txt", "Dear team,\nThanks.\n");
    expect(readFileSync(path.join(docs, "letter.txt"), "utf8")).toBe("Dear team,\nThanks.\n");
    const t = kernel.files.trash(place.id, "letter.txt");
    expect(existsSync(path.join(docs, "letter.txt"))).toBe(false);
    kernel.files.restore(t.id);
    expect(existsSync(path.join(docs, "letter.txt"))).toBe(true);
    expect(() => kernel.files.removePlace("home")).toThrow();
    expect(kernel.files.removePlace(place.id)).toBe(true);
    expect(existsSync(docs)).toBe(true);
  });

  it("opens files in the default app, but never programs or scripts", async () => {
    const { kernel, root, opened } = await boot();
    mkdirSync(path.join(root, "bin2"));
    writeFileSync(path.join(root, "bin2/setup.exe"), "MZ");
    writeFileSync(path.join(root, "bin2/run.sh"), "echo hi");
    await kernel.files.open(undefined, "README.md");
    expect(opened).toEqual([path.join(realpathSync(root), "README.md")]);
    await expect(kernel.files.open(undefined, "bin2/setup.exe")).rejects.toThrow(/programs or scripts/);
    await expect(kernel.files.open(undefined, "bin2/run.sh")).rejects.toThrow(/programs or scripts/);
    expect(opened).toHaveLength(1);
  });

  it("refuses binary files as text", async () => {
    const { kernel, root } = await boot();
    writeFileSync(path.join(root, "pic.bin"), Buffer.from([0x89, 0x50, 0x00, 0x01]));
    expect(() => kernel.files.read(undefined, "pic.bin")).toThrow(/not a text file/);
  });
});

describe("files.* tools", () => {
  it("are available to the assistant, and moving a file waits for approval", async () => {
    const llm = createScriptedProvider({
      agent: [{ toolCalls: [{ name: "files.list", input: { path: "src" } }, { name: "files.move", input: { from: "README.md", to: "README-old.md" } }] }, { text: "Done." }],
    });
    const { kernel, root } = await boot({ llm });
    const pending = kernel.assistant.ask("Rename the README");
    let approval;
    for (let i = 0; i < 50 && !approval; i++) {
      await new Promise((r) => setTimeout(r, 20));
      approval = kernel.tools.approvals("pending")[0];
    }
    expect(approval?.tool).toBe("files.move");
    kernel.resolveApproval(approval!.id, false);
    const answer = await pending;
    expect(answer.tools?.map((t) => [t.tool, t.ok])).toEqual([
      ["files.list", true],
      ["files.move", false],
    ]);
    expect(existsSync(path.join(root, "README.md"))).toBe(true);
  });
});

describe("file manager over HTTP", () => {
  it("lists, saves, renames, trashes and restores; previews only images and PDFs, sandboxed", async () => {
    const { kernel, root } = await boot();
    writeFileSync(path.join(root, "photo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(path.join(root, "page.svg"), "<svg onload=alert(1)>");
    const http = createHttpServer(kernel);
    servers.push(http);
    const { url } = await http.listen(0, "127.0.0.1");
    const h = { "Content-Type": "application/json", "X-Nalara-Client": "1" };
    const call = async (method: string, p: string, body?: unknown) => {
      const r = await fetch(`${url}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, json: (await r.json()) as any };
    };

    const places = await call("GET", "/api/places");
    expect(places.json.places[0]).toMatchObject({ id: "home", builtin: true });
    expect((await call("GET", "/api/files/list?path=src")).json.entries.some((e: { name: string }) => e.name === "combat")).toBe(true);
    expect((await call("PUT", "/api/files/content", { path: "hello.txt", content: "hi", mode: "create" })).status).toBe(200);
    expect((await call("PUT", "/api/files/content", { path: "hello.txt", content: "hi", mode: "create" })).json.code).toBe("conflict");
    expect((await call("POST", "/api/files/mkdir", { path: "docs2" })).status).toBe(200);
    expect((await call("POST", "/api/files/move", { from: "hello.txt", to: "docs2/hello.txt" })).json.path).toBe("docs2/hello.txt");
    expect((await call("GET", "/api/files/content?path=docs2/hello.txt")).json.content).toBe("hi");
    const trashed = await call("POST", "/api/files/trash", { path: "docs2/hello.txt" });
    expect((await call("GET", "/api/trash")).json).toHaveLength(1);
    expect((await call("POST", `/api/trash/${trashed.json.id}/restore`)).json.path).toBe("docs2/hello.txt");
    expect((await call("POST", "/api/files/move", { from: "../x", to: "y" })).status).toBe(400);
    expect((await call("GET", "/api/files/list?path=.nalara")).status).toBe(403);
    expect((await call("POST", "/api/places", { path: "not/absolute" })).status).toBe(400);

    const png = await fetch(`${url}/api/files/raw?path=photo.png`);
    expect(png.headers.get("content-type")).toBe("image/png");
    expect(png.headers.get("content-security-policy")).toMatch(/sandbox/);
    expect((await fetch(`${url}/api/files/raw?path=page.svg`)).status).toBe(415);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import { createKernel, type NeuralKernel } from "../src/kernel/kernel";
import { createHttpServer, type NeuralHttpServer } from "../src/server/http";
import type { ApprovalRequest, KernelEvent, Workspace } from "../src/kernel/types";

const DEMO = path.resolve(__dirname, "../demo/breath-of-fire-iv-remake");
let root: string;
let staticDir: string;
let kernel: NeuralKernel;
let server: NeuralHttpServer;
let base: string;
let port: number;

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
  json: any;
}

/** Raw node:http request so tests control Host and Origin. */
function req(method: string, p: string, opts: { body?: unknown; rawBody?: string; headers?: Record<string, string> } = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const body = opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined);
    const headers: Record<string, string> = { ...(method !== "GET" ? { "X-Nalara-Client": "1" } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...opts.headers };
    for (const [k, v] of Object.entries(headers)) if (v === "") delete headers[k];
    const r = httpRequest({ host: "127.0.0.1", port, method, path: p, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
      });
    });
    r.on("error", reject);
    if (body !== undefined) r.write(body);
    r.end();
  });
}

const get = (p: string, headers?: Record<string, string>) => req("GET", p, { headers });
const post = (p: string, body?: unknown, headers?: Record<string, string>) => req("POST", p, { body: body ?? {}, headers });
const enc = encodeURIComponent;

beforeAll(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "nos-http-"));
  cpSync(DEMO, root, { recursive: true, filter: (src) => !src.split(path.sep).includes(".nalara") });
  staticDir = mkdtempSync(path.join(os.tmpdir(), "nos-static-"));
  mkdirSync(path.join(staticDir, "assets"));
  writeFileSync(path.join(staticDir, "index.html"), "<!doctype html><title>Nalara</title><div id=root></div>");
  writeFileSync(path.join(staticDir, "assets", "app.js"), "console.log('app');");
  writeFileSync(path.join(staticDir, "assets", "app.css"), "body{}");
  writeFileSync(path.join(root, "secret.txt"), "top secret");
  kernel = createKernel({ root, watch: false, triggers: false, useClaude: false, port: 0 }, { llm: null, env: {} });
  await kernel.start();
  kernel.bus.subscribe("tool.approval_requested", (e) => {
    const a = (e.data as { approval: ApprovalRequest }).approval;
    if (a.tool === "proc.run_tests") kernel.resolveApproval(a.id, false);
  });
  server = createHttpServer(kernel, { staticDir });
  const bound = await server.listen(0, "127.0.0.1");
  base = bound.url;
  port = bound.port;
});

afterAll(async () => {
  await server?.close();
  await kernel?.stop();
  rmSync(root, { recursive: true, force: true });
  rmSync(staticDir, { recursive: true, force: true });
});

describe("HTTP API: contract shapes", () => {
  it("GET /api/status returns KernelStatus", async () => {
    const r = await get("/api/status");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/application\/json/);
    expect(r.json).toMatchObject({ version: expect.any(String), root, mode: "offline", halted: false, toolPolicy: "ask", projectName: "Breath of Fire IV Remake" });
    expect(r.json.graph).toMatchObject({ nodes: expect.any(Number), edges: expect.any(Number), byType: expect.any(Object) });
    expect(r.json.agents).toMatchObject({ catalog: expect.any(Number), running: expect.any(Number) });
    expect(r.json.workspaces).toMatchObject({ total: expect.any(Number), running: expect.any(Number) });
    expect(r.json.governor).toMatchObject({ lanes: expect.any(Number), circuit: "closed" });
    expect(r.json.audit).toMatchObject({ entries: expect.any(Number), chainOk: true });
    expect(Array.isArray(r.json.mcp)).toBe(true);
    expect(r.json.pendingApprovals).toBe(0);
  });

  it("graph, nodes (URL-encoded ids with ':' and '/'), concepts and search", async () => {
    const all = await get("/api/graph?limit=1000");
    expect(all.status).toBe(200);
    expect(all.json.nodes.length).toBeGreaterThan(20);
    expect(Array.isArray(all.json.edges)).toBe(true);
    const files = await get("/api/graph?types=file,folder");
    expect(files.json.nodes.every((n: { type: string }) => n.type === "file" || n.type === "folder")).toBe(true);
    expect((await get("/api/graph?types=bogus")).status).toBe(400);
    const project = all.json.nodes.find((n: { type: string }) => n.type === "project");
    const slice = await get(`/api/graph?rootId=${enc(project.id)}&depth=1`);
    expect(slice.json.nodes[0].id).toBe(project.id);

    const node = await get(`/api/nodes/${enc("file:src/combat/damage.ts")}`);
    expect(node.status).toBe(200);
    expect(node.json.node).toMatchObject({ id: "file:src/combat/damage.ts", type: "file", props: { path: "src/combat/damage.ts", kind: "code" } });
    expect(Array.isArray(node.json.edges)).toBe(true);
    expect(node.json.neighbors.length).toBeGreaterThan(0);
    expect((await get(`/api/nodes/${enc("file:nope.ts")}`)).status).toBe(404);

    const concepts = await get("/api/concepts");
    expect(concepts.json[0]).toMatchObject({ id: expect.stringMatching(/^concept:/), name: expect.any(String), files: expect.any(Array) });

    const hits = await get(`/api/search?q=${enc("combat code")}&limit=5`);
    expect(hits.status).toBe(200);
    expect(hits.json.length).toBeGreaterThan(0);
    expect(hits.json[0]).toMatchObject({ path: expect.any(String), nodeId: expect.stringMatching(/^file:/), score: expect.any(Number), kind: expect.any(String), reasons: expect.any(Array) });
    expect((await get("/api/search?q=")).json).toEqual([]);
  });

  it("intents: classify, submit, and the workspace routes", async () => {
    const cls = await post("/api/intents/classify", { text: "Review inventory module" });
    expect(cls.status).toBe(200);
    expect(cls.json).toMatchObject({ intent: "engineering_review", required_agents: expect.any(Array), required_tools: expect.any(Array), confidence: expect.any(Number), source: "heuristic" });
    expect(kernel.workspaces.list()).toHaveLength(0); // classify creates no workspace
    expect((await post("/api/intents", { text: "" })).status).toBe(400);

    const created = await post("/api/intents", { text: "Review inventory module", run: false });
    expect(created.status).toBe(200);
    const ws: Workspace = created.json.workspace;
    expect(ws).toMatchObject({ id: expect.stringMatching(/^ws_/), nodeId: `workspace:${ws.id}`, status: "ready", intent: "engineering_review" });

    const list = await get("/api/workspaces");
    expect(list.json.map((w: Workspace) => w.id)).toContain(ws.id);
    const detail = await get(`/api/workspaces/${ws.id}`);
    expect(detail.json).toMatchObject({ workspace: { id: ws.id }, instances: [] });
    expect((await get("/api/workspaces/ws_missing")).status).toBe(404);

    const finished = kernel.bus.waitFor("workspace.*", (e) => (e.type === "workspace.completed" || e.type === "workspace.failed") && e.correlationId === ws.id, 15000);
    const run = await post(`/api/workspaces/${ws.id}/run`);
    expect(run.status).toBe(200);
    expect(run.json.workspace).toMatchObject({ id: ws.id, status: "running" });
    await finished;
    const after = await get(`/api/workspaces/${ws.id}`);
    expect(after.json.workspace.status).toBe("completed");
    expect(after.json.instances.length).toBeGreaterThanOrEqual(3);
    const instances = await get(`/api/agents/instances?workspaceId=${ws.id}`);
    expect(instances.json.every((i: { workspaceId?: string }) => i.workspaceId === ws.id)).toBe(true);

    const report = await get(`/api/files/content?path=${enc(after.json.workspace.report.artifactPath)}`);
    expect(report.status).toBe(200);
    expect(report.json).toMatchObject({ path: after.json.workspace.report.artifactPath, content: expect.stringContaining("#"), kind: "doc" });

    const undo = await post(`/api/workspaces/${ws.id}/undo`);
    expect(undo.json).toEqual({ restored: [], skipped: [] });
    const archived = await post(`/api/workspaces/${ws.id}/archive`);
    expect(archived.json.workspace).toMatchObject({ id: ws.id, status: "archived" });

    const journal = await get(`/api/journal?workspaceId=${ws.id}`);
    expect(journal.json).toEqual([]);
  });

  it("agents: catalog, run, instances, terminate and performance", async () => {
    const agents = await get("/api/agents");
    expect(agents.json.find((a: { id: string }) => a.id === "code_reviewer")).toMatchObject({ name: "Code Reviewer", group: "engineering", tools: expect.any(Array) });
    const done = kernel.bus.waitFor("agent.finished", (e) => (e.data as { agentId?: string }).agentId === "security_agent", 10000);
    const run = await post("/api/agents/security_agent/run", { task: "Scan for secrets", files: ["src/combat/damage.ts"] });
    expect(run.status).toBe(200);
    expect(run.json.instance).toMatchObject({ agentId: "security_agent", state: "summoned", instanceId: expect.stringMatching(/^ai_/) });
    await done;
    expect((await post("/api/agents/nobody/run", { task: "x" })).status).toBe(404);
    expect((await post("/api/agents/code_reviewer/run", {})).status).toBe(400);
    const term = await post(`/api/agents/instances/${run.json.instance.instanceId}/terminate`);
    expect(term.json).toEqual({ ok: false }); // already finished
    expect((await post("/api/agents/instances/ai_missing/terminate")).status).toBe(404);
    const perf = await get("/api/agents/performance");
    expect(perf.json.find((p: { agentId: string }) => p.agentId === "security_agent")).toMatchObject({ runs: 1, successes: 1 });
  });

  it("radial: menus and actions with URL-encoded node ids", async () => {
    const rootMenu = await get("/api/radial/root");
    expect(rootMenu.json).toMatchObject({ nodeId: "root", kind: "root" });
    expect(rootMenu.json.actions.map((a: { id: string }) => a.id)).toEqual(["search", "files", "agents", "projects", "apps", "memory", "settings"]);
    const fileMenu = await get(`/api/radial/${enc("file:src/combat/damage.ts")}`);
    expect(fileMenu.json.kind).toBe("file");
    const open = await post(`/api/radial/${enc("file:src/combat/damage.ts")}/open`, {});
    expect(open.json).toMatchObject({ ok: true, data: { path: "src/combat/damage.ts", content: expect.stringContaining("export") } });
    const explain = await post(`/api/radial/${enc("agent:code_reviewer")}/explain`, { input: {} });
    expect(explain.json.ok).toBe(true);
    expect((await get(`/api/radial/${enc("file:missing.ts")}`)).status).toBe(404);
    expect((await post(`/api/radial/${enc("agent:code_reviewer")}/nope`)).status).toBe(404);
    expect((await post(`/api/radial/${enc("mcp:builtin-fs")}/execute`)).status).toBe(409);
    expect((await post(`/api/radial/${enc("agent:code_reviewer")}/explain`, { input: "x" })).status).toBe(400);
  });

  it("memory: list (with proposed on request), remember, confirm (audited) and forget", async () => {
    const created = await post("/api/memory", { category: "preference", key: "http_tone", content: "concise", tags: ["style"] });
    expect(created.json).toMatchObject({ category: "preference", key: "http_tone", status: "active", source: "user" });
    expect((await post("/api/memory", { category: "nonsense", key: "k", content: "c" })).status).toBe(400);
    const listed = await get("/api/memory?category=preference&q=concise");
    expect(listed.json.map((r: { key: string }) => r.key)).toContain("http_tone");

    const proposed = kernel.memory.remember({ category: "preference", key: "agent_idea", content: "use tables", source: "agent:writer#ai_1" });
    expect((await get("/api/memory?category=preference")).json.map((r: { id: string }) => r.id)).not.toContain(proposed.id);
    expect((await get("/api/memory?category=preference&includeProposed=true")).json.map((r: { id: string }) => r.id)).toContain(proposed.id);
    const confirmed = await post(`/api/memory/${proposed.id}/confirm`);
    expect(confirmed.json).toMatchObject({ id: proposed.id, status: "active" });
    expect(kernel.audit.list({ subject: proposed.id }).some((e) => e.kind === "memory_confirm")).toBe(true);
    expect((await post("/api/memory/mem_missing/confirm")).status).toBe(404);

    const del = await req("DELETE", `/api/memory/${created.json.id}`);
    expect(del.json).toEqual({ ok: true });
  });

  it("tools, policy, approvals and triggers", async () => {
    const tools = await get("/api/tools?server=builtin:fs");
    expect(tools.json.map((t: { name: string }) => t.name)).toContain("fs.read_file");
    expect((await get("/api/tools?action=execute")).json.every((t: { action: string }) => t.action === "execute")).toBe(true);
    const call = await post("/api/tools/fs.read_file/call", { input: { path: "README.md" } });
    expect(call.json).toMatchObject({ ok: true, content: expect.stringContaining("Breath of Fire") });
    expect((await post("/api/tools/nope/call", { input: {} })).status).toBe(404);

    // An approval-gated call from the human: the HTTP call waits while the approval is pending.
    const pendingCall = post("/api/tools/fs.write_file/call", { input: { path: "from-http.txt", content: "hello" } });
    const approval = (await kernel.bus.waitFor("tool.approval_requested", (e) => (e.data as { approval: ApprovalRequest }).approval.tool === "fs.write_file", 5000)).data as { approval: ApprovalRequest };
    const pending = await get("/api/approvals?status=pending");
    expect(pending.json.map((a: ApprovalRequest) => a.id)).toContain(approval.approval.id);
    const resolved = await post(`/api/approvals/${approval.approval.id}`, { approved: true });
    expect(resolved.json).toMatchObject({ id: approval.approval.id, status: "approved" });
    expect((await pendingCall).json).toMatchObject({ ok: true });
    expect((await post(`/api/approvals/${approval.approval.id}`, { approved: true })).status).toBe(409);
    expect((await post("/api/approvals/appr_missing", { approved: true })).status).toBe(404);
    expect((await post(`/api/approvals/${approval.approval.id}`, { approved: "yes" })).status).toBe(400);

    const policy = await get("/api/policy");
    expect(policy.json.mode).toBe("ask");
    const put = await req("PUT", "/api/policy", { body: { mode: "readonly", deny: ["proc.*"] } });
    expect(put.json).toMatchObject({ mode: "readonly", deny: ["proc.*"] });
    expect((await req("PUT", "/api/policy", { body: { mode: "yolo" } })).status).toBe(400);
    await req("PUT", "/api/policy", { body: { mode: "ask" } });

    const triggers = await get("/api/triggers");
    expect(triggers.json).toEqual([]); // the default chain is off in this kernel
    kernel.triggers.upsert({ id: "http-test", name: "HTTP test rule", on: "file.updated", then: { kind: "emit", type: "kernel.log" }, enabled: true });
    const toggled = await req("PUT", "/api/triggers/http-test", { body: { enabled: false } });
    expect(toggled.json).toMatchObject({ id: "http-test", enabled: false });
    expect(kernel.audit.list({ subject: "trigger:http-test" }).some((e) => e.kind === "policy")).toBe(true);
    expect((await req("PUT", "/api/triggers/http-test", { body: { enabled: "no" } })).status).toBe(400);
    expect((await req("PUT", "/api/triggers/nope", { body: { enabled: false } })).status).toBe(404);
  });

  it("mcp, workflows, governor, audit and events", async () => {
    expect((await get("/api/mcp")).json).toEqual([]);
    expect((await post("/api/mcp", { name: "bad name", config: { command: "x" } })).status).toBe(400);
    expect((await post("/api/mcp", { name: "x", config: {} })).status).toBe(400);
    expect((await req("DELETE", "/api/mcp/none")).json).toEqual({ ok: false });
    expect((await post("/api/mcp/tools/fs.read_file/reapprove")).json).toEqual({ ok: false });

    const workflows = await get("/api/workflows");
    expect(workflows.json[0]).toMatchObject({ id: "build_pipeline", name: "Build Pipeline", steps: expect.any(Array) });
    const docs = kernel.bus.waitFor("agent.finished", (e) => (e.data as { agentId?: string }).agentId === "documentation", 15000);
    expect((await post("/api/workflows/build_pipeline/run")).json).toEqual({ started: true });
    await docs;
    expect((await post("/api/workflows/nope/run")).status).toBe(404);

    expect((await get("/api/governor")).json).toMatchObject({ lanes: expect.any(Number), maxLanes: expect.any(Number), running: expect.any(Number), queued: expect.any(Number) });
    const audit = await get("/api/audit?limit=5");
    expect(audit.json.entries.length).toBe(5);
    expect(audit.json.chainBrokenAt).toBeNull();
    const since = await get(`/api/audit?since=${audit.json.entries[0].seq}&limit=2`);
    expect(since.json.entries[0].seq).toBe(audit.json.entries[0].seq + 1);

    const events = await get("/api/events?limit=10");
    expect(events.json).toHaveLength(10);
    const after = await get(`/api/events?since=${events.json[0].seq}&limit=3`);
    expect(after.json.map((e: KernelEvent) => e.seq)).toEqual([events.json[0].seq + 1, events.json[0].seq + 2, events.json[0].seq + 3]);
    const ws = kernel.workspaces.list()[0];
    const corr = await get(`/api/events?correlationId=${ws.id}&limit=1000`);
    expect(corr.json.length).toBeGreaterThan(0);
    expect(corr.json.every((e: KernelEvent) => e.correlationId === ws.id)).toBe(true);
  });

  it("kill switch: halt and resume return KernelStatus", async () => {
    const halted = await post("/api/kernel/halt", { reason: "http test" });
    expect(halted.json).toMatchObject({ halted: true });
    expect((await post("/api/intents", { text: "Review inventory module" })).status).toBe(409);
    const resumed = await post("/api/kernel/resume");
    expect(resumed.json).toMatchObject({ halted: false });
  });
});

describe("HTTP API: security", () => {
  it("rejects a foreign Origin, allows the server's own origin and its loopback aliases", async () => {
    expect((await get("/api/status", { Origin: "http://evil.example" })).status).toBe(403);
    expect((await get("/api/status", { Origin: `http://127.0.0.1:${port + 1}` })).status).toBe(403);
    const bad = await post("/api/kernel/halt", { reason: "csrf" }, { Origin: "https://evil.example" });
    expect(bad.status).toBe(403);
    expect(bad.json.error).toMatch(/Origin/);
    expect(kernel.isHalted()).toBe(false);
    expect((await get("/api/status", { Origin: base })).status).toBe(200);
    expect((await get("/api/status", { Origin: `http://localhost:${port}` })).status).toBe(200);
  });

  it("rejects a non-loopback Host header (DNS rebinding)", async () => {
    expect((await get("/api/status", { Host: `evil.example:${port}` })).status).toBe(403);
    expect((await get("/api/status", { Host: `localhost:${port}` })).status).toBe(200);
  });

  it("requires X-Nalara-Client: 1 on mutating requests", async () => {
    const r = await req("POST", "/api/kernel/halt", { body: { reason: "x" }, headers: { "X-Nalara-Client": "" } });
    expect(r.status).toBe(403);
    expect(r.json.error).toMatch(/X-Nalara-Client/);
    expect((await req("DELETE", "/api/memory/x", { headers: { "X-Nalara-Client": "" } })).status).toBe(403);
    expect((await req("PUT", "/api/policy", { body: { mode: "auto" }, headers: { "X-Nalara-Client": "0" } })).status).toBe(403);
    expect(kernel.tools.policy().mode).toBe("ask");
  });

  it("limits JSON bodies to 1 MB and rejects malformed JSON", async () => {
    const big = await req("POST", "/api/intents/classify", { rawBody: JSON.stringify({ text: "x".repeat(1024 * 1024 + 10) }) });
    expect(big.status).toBe(413);
    expect((await req("POST", "/api/intents/classify", { rawBody: "{nope" })).status).toBe(400);
    expect((await req("POST", "/api/intents/classify", { rawBody: "[1,2]" })).status).toBe(400);
  });

  it("returns 404 JSON for unknown API paths and wrong methods", async () => {
    const r = await get("/api/nope");
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: expect.any(String) });
    expect((await req("DELETE", "/api/status")).status).toBe(404);
    expect((await get("/api/files/content?path=nope.md")).status).toBe(404);
    expect((await get(`/api/files/content?path=${enc("../outside.txt")}`)).status).toBe(403);
    expect((await get("/api/files/content")).status).toBe(400);
    expect((await get("/api/nodes/%E0%A4%A")).status).toBe(400);
  });
});

describe("HTTP API: server-sent events", () => {
  function openStream(p: string, headers: Record<string, string> = {}): Promise<{ events: KernelEvent[]; raw: () => string; headers: Record<string, unknown>; close: () => void; waitFor: (pred: (e: KernelEvent) => boolean) => Promise<KernelEvent> }> {
    return new Promise((resolve, reject) => {
      const events: KernelEvent[] = [];
      const waiters: { pred: (e: KernelEvent) => boolean; resolve: (e: KernelEvent) => void }[] = [];
      let buffer = "";
      let raw = "";
      const r = httpRequest({ host: "127.0.0.1", port, path: p, headers: { Accept: "text/event-stream", ...headers } }, (res) => {
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          raw += chunk;
          buffer += chunk;
          let idx: number;
          while ((idx = buffer.indexOf("\n\n")) >= 0) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const data = block.split("\n").find((l) => l.startsWith("data: "));
            const id = block.split("\n").find((l) => l.startsWith("id: "));
            if (!data) continue;
            const ev = JSON.parse(data.slice(6)) as KernelEvent;
            expect(Number(id?.slice(4))).toBe(ev.seq);
            events.push(ev);
            for (const w of [...waiters]) if (w.pred(ev)) {
              waiters.splice(waiters.indexOf(w), 1);
              w.resolve(ev);
            }
          }
        });
        resolve({
          events,
          raw: () => raw,
          headers: res.headers,
          close: () => r.destroy(),
          waitFor: (pred) => {
            const hit = events.find(pred);
            if (hit) return Promise.resolve(hit);
            return new Promise((res2) => waiters.push({ pred, resolve: res2 }));
          },
        });
      });
      r.on("error", (err) => {
        if ((err as NodeJS.ErrnoException).code !== "ECONNRESET") reject(err);
      });
      r.end();
    });
  }

  it("replays history after ?since, then streams live events", async () => {
    const history = kernel.bus.history({ limit: 5 });
    const since = history[0].seq;
    const s = await openStream(`/api/events/stream?since=${since}`);
    try {
      expect(s.headers["content-type"]).toMatch(/text\/event-stream/);
      expect(s.headers["cache-control"]).toBe("no-cache");
      expect(s.headers["connection"]).toBe("keep-alive");
      await s.waitFor((e) => e.seq === history.at(-1)!.seq);
      expect(s.events[0].seq).toBe(since + 1);
      const live = kernel.bus.publish("kernel.log", { level: "info", message: "sse live test" });
      const got = await s.waitFor((e) => e.seq === live.seq);
      expect(got.data).toMatchObject({ message: "sse live test" });
      const seqs = s.events.map((e) => e.seq);
      expect(new Set(seqs).size).toBe(seqs.length); // no duplicates
      expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
      expect(s.raw()).toContain(": connected");
    } finally {
      s.close();
    }
  });

  it("honours Last-Event-ID", async () => {
    const last = kernel.bus.publish("kernel.log", { level: "info", message: "marker" });
    const next = kernel.bus.publish("kernel.log", { level: "info", message: "after marker" });
    const s = await openStream("/api/events/stream", { "Last-Event-ID": String(last.seq) });
    try {
      const got = await s.waitFor((e) => e.seq === next.seq);
      expect(got.data).toMatchObject({ message: "after marker" });
      expect(s.events[0].seq).toBe(next.seq);
    } finally {
      s.close();
    }
  });

  it("cleans up the subscription when the client disconnects", async () => {
    const s = await openStream("/api/events/stream?since=0");
    s.close();
    await new Promise((r) => setTimeout(r, 100));
    // Publishing after the disconnect must not throw or write to a closed socket.
    expect(() => kernel.bus.publish("kernel.log", { level: "info", message: "after close" })).not.toThrow();
    await kernel.bus.drain();
  });
});

describe("HTTP: static files", () => {
  it("serves index.html, assets with content types, and falls back to index.html for app routes", async () => {
    const index = await get("/");
    expect(index.status).toBe(200);
    expect(index.headers["content-type"]).toMatch(/text\/html/);
    expect(index.text).toContain("Nalara");
    const js = await get("/assets/app.js");
    expect(js.headers["content-type"]).toMatch(/text\/javascript/);
    expect(js.text).toContain("console.log");
    expect((await get("/assets/app.css")).headers["content-type"]).toMatch(/text\/css/);
    const fallback = await get("/workspace/ws_1");
    expect(fallback.status).toBe(200);
    expect(fallback.text).toContain("Nalara");
    expect((await get("/assets/missing.js")).status).toBe(404);
  });

  it("blocks path traversal out of the static directory", async () => {
    for (const p of ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt", "/..%5csecret.txt", `/${enc(path.join(root, "secret.txt"))}`]) {
      const r = await get(p);
      expect([400, 403, 404, 200]).toContain(r.status);
      expect(r.text).not.toContain("top secret");
    }
    const r = await get("/%2e%2e/%2e%2e/etc/passwd");
    expect(r.text).not.toContain("root:");
  });
});

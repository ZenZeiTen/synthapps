import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createKernel, type NeuralKernel } from "../src/kernel/kernel";
import { RadialError } from "../src/kernel/radial";
import type { AgentInstance, ApprovalRequest, KernelEvent, Workspace } from "../src/kernel/types";

const DEMO = path.resolve(__dirname, "../demo/breath-of-fire-iv-remake");
let root: string;
let kernel: NeuralKernel;

beforeAll(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "nos-radial-"));
  cpSync(DEMO, root, { recursive: true, filter: (src) => !src.split(path.sep).includes(".nalara") });
  kernel = createKernel({ root, watch: false, triggers: false, useClaude: false }, { llm: null, env: {} });
  await kernel.start();
});

afterAll(async () => {
  await kernel?.stop();
  rmSync(root, { recursive: true, force: true });
});

const ids = (nodeId: string) => kernel.radialActions(nodeId).actions.map((a) => a.id);
const action = (nodeId: string, id: string) => kernel.radialActions(nodeId).actions.find((a) => a.id === id)!;

function finished(instanceId: string): Promise<AgentInstance> {
  const existing = kernel.orchestrator.instance(instanceId);
  if (existing && ["completed", "failed", "terminated"].includes(existing.state)) return Promise.resolve(existing);
  return kernel.bus
    .waitFor("agent.*", (e) => (e.type === "agent.finished" || e.type === "agent.failed") && (e.data as { instanceId?: string }).instanceId === instanceId, 15000)
    .then(() => kernel.orchestrator.instance(instanceId)!);
}

async function workspaceDone(id: string): Promise<Workspace> {
  return kernel.runWorkspace(id);
}

function nextApproval(tool: string): Promise<ApprovalRequest> {
  return kernel.bus
    .waitFor("tool.approval_requested", (e) => (e.data as { approval: ApprovalRequest }).approval.tool === tool, 10000)
    .then((e: KernelEvent) => (e.data as { approval: ApprovalRequest }).approval);
}

describe("radial menus", () => {
  it("offer exactly the spec actions per node type", () => {
    const rootMenu = kernel.radialActions("root");
    expect(rootMenu.kind).toBe("root");
    expect(rootMenu.actions.map((a) => a.id)).toEqual(["search", "files", "agents", "projects", "apps", "memory", "settings"]);
    expect(rootMenu.actions.map((a) => a.label)).toEqual(["Search", "Files", "Agents", "Projects", "Apps", "Memory", "Settings"]);
    expect(rootMenu.actions.every((a) => a.clientOnly && a.enabled)).toBe(true);

    expect(ids("agent:code_reviewer")).toEqual(["review", "explain", "compare", "improve", "test", "collaborate", "replace"]);
    expect(kernel.radialActions("agent:code_reviewer").actions.map((a) => a.label)).toEqual(["Review", "Explain", "Compare", "Improve", "Test", "Collaborate", "Replace"]);
    expect(ids("file:src/combat/damage.ts")).toEqual(["open", "summarize", "translate", "refactor", "analyze", "attach_agent"]);
    expect(kernel.radialActions("file:src/combat/damage.ts").actions.map((a) => a.label)).toEqual(["Open", "Summarize", "Translate", "Refactor", "Analyze", "Attach Agent"]);
    const project = kernel.graph.findNodes({ type: "project" })[0];
    expect(ids(project.id)).toEqual(["open_workspace", "launch_swarm", "review_status", "memory", "deploy", "archive"]);
    expect(kernel.radialActions(project.id).actions.map((a) => a.label)).toEqual(["Open Workspace", "Launch Swarm", "Review Status", "Memory", "Deploy", "Archive"]);
    expect(ids("mcp:builtin-fs")).toEqual(["read", "write", "search", "execute"]);
    expect(ids("workflow:build_pipeline")).toEqual(["run", "inspect"]);
    expect(ids("folder:src/combat")).toEqual(["open", "summarize", "analyze"]);
    const concept = kernel.graph.findNodes({ type: "concept" })[0];
    expect(ids(concept.id)).toEqual(["open", "summarize", "analyze"]);
  });

  it("disables actions with a hint, and rejects unknown nodes, actions and disabled actions", async () => {
    const project = kernel.graph.findNodes({ type: "project" })[0];
    // No workspace yet: nothing to deploy, open or archive.
    if (kernel.workspaces.list().length === 0) {
      const deploy = action(project.id, "deploy");
      expect(deploy.enabled).toBe(false);
      expect(deploy.hint).toMatch(/deploy command/);
      await expect(kernel.radialAction(project.id, "deploy")).rejects.toMatchObject({ status: 409 });
      expect(action("agent:code_reviewer", "replace")).toMatchObject({ enabled: false });
    }
    expect(action("mcp:builtin-fs", "execute")).toMatchObject({ enabled: false, hint: expect.stringMatching(/No execute tools/) });
    expect(action("file:docs/glossary.md", "refactor")).toMatchObject({ enabled: false });
    await expect(kernel.radialAction("file:nope.ts", "open")).rejects.toBeInstanceOf(RadialError);
    await expect(kernel.radialAction("file:nope.ts", "open")).rejects.toMatchObject({ status: 404 });
    await expect(kernel.radialAction("agent:code_reviewer", "dance")).rejects.toMatchObject({ status: 404 });
  });
});

describe("file actions", () => {
  const file = "file:src/combat/battle_system.ts";

  it("open reads the file through the gateway", async () => {
    const r = await kernel.radialAction(file, "open");
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ path: "src/combat/battle_system.ts", kind: "code" });
    expect((r.data as { content: string }).content).toContain("handleEvent");
    expect(kernel.audit.list({ subject: "fs.read_file" }).some((e) => e.principal?.chain[0]?.startsWith("user:"))).toBe(true);
  });

  it("summarize runs the documentation agent on code and the researcher on documents", async () => {
    const code = await kernel.radialAction(file, "summarize");
    expect((await finished(code.instanceId!)).agentId).toBe("documentation");
    const doc = await kernel.radialAction("file:docs/design/combat.md", "summarize");
    const inst = await finished(doc.instanceId!);
    expect(inst.agentId).toBe("researcher");
    expect(inst.state).toBe("completed");
  });

  it("translate submits a translation intent (default target language named in the message)", async () => {
    const r = await kernel.radialAction("file:website/index.html", "translate");
    expect(r.workspaceId).toBeTruthy();
    expect(r.message).toMatch(/target: Indonesian/);
    const ws = await workspaceDone(r.workspaceId!);
    expect(ws.text).toBe("Translate website/index.html to Indonesian");
    expect(ws.agents).toContain("translator");
  });

  it("refactor runs the fullstack engineer, which offline returns a plan and a limitation", async () => {
    const r = await kernel.radialAction(file, "refactor");
    const inst = await finished(r.instanceId!);
    expect(inst.agentId).toBe("fullstack_engineer");
    expect(inst.output?.limitation).toBeTruthy();
  });

  it("analyze runs code reviewer and systems architect and the Commander merges them", async () => {
    const r = await kernel.radialAction(file, "analyze");
    const ws = await workspaceDone(r.workspaceId!);
    expect(ws.status).toBe("completed");
    expect(ws.files).toEqual(["src/combat/battle_system.ts"]);
    // The systems architect builds (it writes architecture.md), so the security agent attacks its work as a critic.
    expect(ws.report?.outputs.map((o) => o.agentId).sort()).toEqual(["code_reviewer", "security_agent", "systems_architect"]);
    expect(ws.report?.reviews).toHaveLength(1);
    expect(ws.report?.reviews?.[0]).toMatchObject({ builderId: "systems_architect", critics: ["security_agent"], verdict: "survived", rounds: 1 });
    const titles = ws.report!.findings.map((f) => f.title);
    expect(titles).toContain("Use of `any`");
    expect(titles.some((t) => /TODO/.test(t))).toBe(true);
    expect(ws.report?.artifactPath).toBe(`${ws.outputDir}/report.md`);
  });

  it("attach_agent defaults to the code reviewer, or links and runs the chosen agent", async () => {
    const byDefault = await kernel.radialAction(file, "attach_agent");
    expect(byDefault.message).toMatch(/attached Code Reviewer/);
    expect((await finished(byDefault.instanceId!)).agentId).toBe("code_reviewer");
    const chosen = await kernel.radialAction(file, "attach_agent", { agentId: "security_agent" });
    await finished(chosen.instanceId!);
    expect(kernel.graph.edges({ nodeId: "agent:security_agent", direction: "out", kind: "relates_to" }).map((e) => e.target)).toContain(file);
    await expect(kernel.radialAction(file, "attach_agent", { agentId: "nobody" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("agent actions", () => {
  it("explain, compare and improve report definition and performance", async () => {
    const explain = await kernel.radialAction("agent:code_reviewer", "explain");
    expect(explain.message).toMatch(/Code Reviewer \(engineering\)/);
    expect((explain.data as { performance: { runs: number } }).performance.runs).toBeGreaterThan(0);
    const compare = await kernel.radialAction("agent:code_reviewer", "compare");
    const rows = (compare.data as { rows: { agentId: string }[] }).rows;
    expect(rows.map((r) => r.agentId)).toContain("qa_engineer");
    expect(rows.every((r) => kernel.orchestrator.definition(r.agentId)?.group === "engineering")).toBe(true);
    const improve = await kernel.radialAction("agent:fullstack_engineer", "improve");
    expect((improve.data as { suggestions: string[]; source: string }).source).toBe("heuristic");
    expect((improve.data as { suggestions: string[] }).suggestions.join(" ")).toMatch(/Offline limits seen/);
  });

  it("test runs the agent on a sample task and reports pass/fail", async () => {
    const r = await kernel.radialAction("agent:code_reviewer", "test");
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/^PASS: Code Reviewer completed/);
    expect((r.data as { pass: boolean }).pass).toBe(true);
  });

  it("review runs the agent on the latest workspace's files", async () => {
    const r = await kernel.radialAction("agent:systems_architect", "review");
    const inst = await finished(r.instanceId!);
    expect(inst.state).toBe("completed");
    expect(inst.task).toMatch(/from workspace/);
  });

  it("collaborate runs both agents in one workspace merged by the Commander, choosing a partner when none is given", async () => {
    const r = await kernel.radialAction("agent:code_reviewer", "collaborate");
    expect(r.message).toMatch(/partner chosen/);
    const ws = await workspaceDone(r.workspaceId!);
    expect(ws.plan).toHaveLength(2);
    expect(ws.plan[0].agent).toBe("code_reviewer");
    // Plan-step outputs; critics of builder steps add their own outputs on top.
    const stepInstances = Object.values(ws.checkpoint.completedSteps).map((c) => c.instanceId);
    expect(ws.report?.outputs.filter((o) => stepInstances.includes(o.instanceId))).toHaveLength(2);
    const commander = kernel.orchestrator.instances({ workspaceId: ws.id, agentId: "commander" });
    expect(commander).toHaveLength(1);

    const explicit = await kernel.radialAction("agent:code_reviewer", "collaborate", { with: "security_agent" });
    const ws2 = await workspaceDone(explicit.workspaceId!);
    expect(ws2.plan.map((s) => s.agent).sort()).toEqual(["code_reviewer", "security_agent"]);
  });

  it("replace swaps an agent into the latest workspace plan", async () => {
    const { workspace, done } = await kernel.submitIntent("Review inventory module", { run: false });
    await done;
    expect(action("agent:qa_engineer", "replace").enabled).toBe(true);
    const r = await kernel.radialAction("agent:qa_engineer", "replace", { with: "security_agent" });
    expect(r.workspaceId).toBe(workspace.id);
    const updated = kernel.workspaces.get(workspace.id)!;
    expect(updated.plan.find((s) => s.id === "s3")?.agent).toBe("security_agent");
    expect(updated.agents).not.toContain("qa_engineer");
    expect(kernel.graph.edges({ nodeId: workspace.nodeId, direction: "in", kind: "assigned_to" }).map((e) => e.source)).toContain("agent:security_agent");
    await expect(kernel.radialAction("agent:qa_engineer", "replace", { with: "qa_engineer" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("project, workspace, mcp and workflow actions", () => {
  it("project review_status and memory summarize the project", async () => {
    const project = kernel.graph.findNodes({ type: "project" })[0];
    const status = await kernel.radialAction(project.id, "review_status");
    expect(status.message).toMatch(/completed/);
    expect((status.data as { topFindings: unknown[] }).topFindings.length).toBeGreaterThan(0);
    const memory = await kernel.radialAction(project.id, "memory");
    expect((memory.data as { records: { category: string }[] }).records.some((r) => r.category === "coding_standard")).toBe(true);
    const open = await kernel.radialAction(project.id, "open_workspace");
    expect(open.workspaceId).toBeTruthy();
  });

  it("launch_swarm submits a review intent for the project", async () => {
    const project = kernel.graph.findNodes({ type: "project" })[0];
    const approval = nextApproval("proc.run_tests");
    const r = await kernel.radialAction(project.id, "launch_swarm");
    kernel.resolveApproval((await approval).id, false);
    const ws = await workspaceDone(r.workspaceId!);
    expect(ws.text).toBe(`Review ${project.name}`);
    expect(ws.intent).toBe("engineering_review");
  });

  it("deploy goes through proc.deploy and waits for approval; without a deploy command it packages outputs", async () => {
    const project = kernel.graph.findNodes({ type: "project" })[0];
    expect(action(project.id, "deploy").hint).toMatch(/packages the latest workspace outputs/);
    const approval = nextApproval("proc.deploy");
    const r = await kernel.radialAction(project.id, "deploy");
    expect(r.message).toMatch(/waiting for your approval/);
    const a = await approval;
    expect(a.principal.chain).toEqual([`user:${kernel.config.userId}`]);
    const succeeded = kernel.bus.waitFor("deployment.succeeded", undefined, 10000);
    kernel.resolveApproval(a.id, true);
    await succeeded;
    expect(existsSync(path.join(root, ".nalara/deployments"))).toBe(true);
    expect(readdirSync(path.join(root, ".nalara/deployments")).length).toBe(1);
  });

  it("workspace actions: open, review_status, undo (disabled without writes), run and archive", async () => {
    const ws = kernel.workspaces.list().find((w) => w.status === "completed")!;
    const node = ws.nodeId;
    expect(ids(node)).toEqual(["open", "run", "review_status", "undo", "archive"]);
    const open = await kernel.radialAction(node, "open");
    expect((open.data as { workspace: Workspace }).workspace.id).toBe(ws.id);
    expect(action(node, "undo").enabled).toBe(false);
    const status = await kernel.radialAction(node, "review_status");
    expect(status.workspaceId).toBe(ws.id);
    const archived = await kernel.radialAction(node, "archive");
    expect(archived.ok).toBe(true);
    expect(kernel.workspaces.get(ws.id)?.status).toBe("archived");
    expect(action(node, "run")).toMatchObject({ enabled: false, hint: "Archived" });
  });

  it("mcp actions list a server's tools by action and call one as the human through the registry", async () => {
    const list = await kernel.radialAction("mcp:builtin-fs", "read");
    expect((list.data as { tools: { name: string }[] }).tools.map((t) => t.name)).toEqual(expect.arrayContaining(["fs.read_file", "fs.list_files"]));
    const read = await kernel.radialAction("mcp:builtin-fs", "read", { tool: "fs.read_file", input: { path: "README.md" } });
    expect(read.ok).toBe(true);
    expect(read.message).toMatch(/Breath of Fire/);
    await expect(kernel.radialAction("mcp:builtin-fs", "read", { tool: "fs.write_file" })).rejects.toMatchObject({ status: 400 });

    const approval = nextApproval("fs.write_file");
    const write = await kernel.radialAction("mcp:builtin-fs", "write", { tool: "fs.write_file", input: { path: "notes.txt", content: "hi" } });
    expect(write.message).toMatch(/waiting for your approval/);
    kernel.resolveApproval((await approval).id, false);
    await kernel.bus.drain();
    expect(existsSync(path.join(root, "notes.txt"))).toBe(false);
  });

  it("workflow inspect shows the steps and run starts review -> test -> docs", async () => {
    const inspect = await kernel.radialAction("workflow:build_pipeline", "inspect");
    expect(inspect.message).toMatch(/Build Pipeline: 1\. code_reviewer/);
    const approval = nextApproval("proc.run_tests");
    const docs = kernel.bus.waitFor("agent.finished", (e) => (e.data as { agentId?: string }).agentId === "documentation", 15000);
    const run = await kernel.radialAction("workflow:build_pipeline", "run");
    expect(run.ok).toBe(true);
    kernel.resolveApproval((await approval).id, false);
    await docs;
  });

  it("project archive archives every finished workspace", async () => {
    const project = kernel.graph.findNodes({ type: "project" })[0];
    const r = await kernel.radialAction(project.id, "archive");
    expect(r.ok).toBe(true);
    expect(kernel.workspaces.list().filter((w) => w.status !== "archived" && w.status !== "running")).toHaveLength(0);
  });

  it("refuses to start agents while the kernel is halted", async () => {
    kernel.halt("test");
    try {
      await expect(kernel.radialAction("file:src/combat/damage.ts", "summarize")).rejects.toMatchObject({ status: 409 });
    } finally {
      kernel.resume();
    }
    const r = await kernel.radialAction("file:src/combat/damage.ts", "summarize");
    expect((await finished(r.instanceId!)).state).toBe("completed");
  });
});

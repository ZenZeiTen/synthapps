/**
 * Workspace Generator (DESIGN.md 3.3): turns an IntentResult into a persisted workspace without any user
 * configuration. A workspace is a graph node plus its resources:
 *
 *   file    -member_of->   workspace      (files the intent named, then the top context hits)
 *   workspace -uses_tool-> mcp:builtin-<group> | mcp:<server>
 *   agent   -assigned_to-> workspace      (every agent the plan needs)
 *   project -contains->    workspace
 *   workspace -contains->  output:<path>  (generated resources such as a glossary or style guide)
 *
 * Workspaces live in the `workspaces` table as JSON and survive restarts. Output files go to
 * <root>/.nalara/outputs/<id>, the folder the built-in fs.write_output tool writes to.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_CATALOG } from "../agents/catalog";
import type { Database } from "../kernel/db";
import { newId, nowIso } from "../kernel/ids";
import type {
  EventBus,
  IntentResult,
  KnowledgeGraph,
  MemoryCategory,
  MemoryRecord,
  MemoryService,
  SemanticIndex,
  Workspace,
  WorkspaceGenerator,
} from "../kernel/types";

/** Context files (after the ones the intent names) that join a workspace. */
export const MAX_CONTEXT_FILES = 8;
const BUILTIN_GROUPS = ["fs", "git", "proc", "search", "memory"] as const;

/** Root-relative output folder of a workspace; ad-hoc runs (no workspace) share ".nalara/outputs/adhoc". */
export function outputDirFor(workspaceId?: string): string {
  return `.nalara/outputs/${workspaceId && /^[\w-]+$/.test(workspaceId) ? workspaceId : "adhoc"}`;
}

/** Which tool-server node a tool name or glob belongs to: "fs.*" -> mcp:builtin-fs, "mcp.github.*" -> mcp:github. */
export function toolServerNode(toolOrGlob: string): string | undefined {
  const [head, second] = toolOrGlob.split(".");
  if ((BUILTIN_GROUPS as readonly string[]).includes(head)) return `mcp:builtin-${head}`;
  if (head === "mcp" && second && !second.includes("*")) return `mcp:${second}`;
  return undefined;
}

export interface WorkspaceGeneratorOptions {
  db: Database;
  graph: KnowledgeGraph;
  bus: EventBus;
  root: string;
  dataDir: string;
  index: Pick<SemanticIndex, "hasFile"> & Partial<SemanticIndex>;
  memory: Pick<MemoryService, "recall">;
}

type Row = { id: string; data: string };

export function createWorkspaceGenerator(opts: WorkspaceGeneratorOptions): WorkspaceGenerator {
  const { db, graph, bus, root, index, memory } = opts;
  db.exec(`CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`);
  const q = {
    get: db.prepare("SELECT id, data FROM workspaces WHERE id = ?"),
    all: db.prepare("SELECT id, data FROM workspaces ORDER BY created_at ASC, id ASC"),
    insert: db.prepare("INSERT INTO workspaces (id, data, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"),
    update: db.prepare("UPDATE workspaces SET data = ?, status = ?, updated_at = ? WHERE id = ?"),
  };

  const parse = (row: Row | undefined): Workspace | undefined => (row ? (JSON.parse(row.data) as Workspace) : undefined);

  function publish(type: "workspace.generated" | "workspace.archived", ws: Workspace) {
    bus.publish(type, { workspace: ws, workspaceId: ws.id, label: ws.label, status: ws.status }, { source: "workspace", correlationId: ws.id });
  }

  function safeGraph(fn: () => void) {
    try {
      fn();
    } catch (err) {
      bus.publish("kernel.log", { level: "warn", message: `workspace graph update failed: ${err instanceof Error ? err.message : String(err)}` }, { source: "workspace" });
    }
  }

  function syncNode(ws: Workspace) {
    safeGraph(() => {
      graph.upsertNode({
        id: ws.nodeId,
        type: "workspace",
        name: ws.label,
        props: {
          workspaceId: ws.id,
          intent: ws.intent,
          label: ws.label,
          text: ws.text,
          status: ws.status,
          priority: ws.priority,
          outputDir: ws.outputDir,
          agents: ws.agents,
          createdAt: ws.createdAt,
          ...(ws.completedAt ? { completedAt: ws.completedAt } : {}),
          ...(ws.report ? { findings: ws.report.findings.length, artifactPath: ws.report.artifactPath } : {}),
        },
      });
    });
  }

  function isIndexed(path: string): boolean {
    try {
      return index.hasFile(path) || Boolean(graph.getNode(`file:${path}`));
    } catch {
      return false;
    }
  }

  function writeResource(dirAbs: string, name: string, content: string): void {
    writeFileSync(join(dirAbs, name), content, "utf8");
  }

  function memoryDoc(title: string, intro: string, records: MemoryRecord[], empty: string): string {
    const lines = [`# ${title}`, "", intro, ""];
    if (!records.length) lines.push(empty, "");
    for (const r of records) {
      const from = typeof r.data?.path === "string" ? ` (from ${r.data.path})` : "";
      lines.push(`## ${r.key}${from}`, "", r.content.trim(), "");
    }
    return lines.join("\n");
  }

  function recall(category: MemoryCategory | MemoryCategory[], limit = 10): MemoryRecord[] {
    try {
      return memory.recall({ category, limit });
    } catch {
      return [];
    }
  }

  /** Generated resources for an intent: files written to the output folder, recorded as "Name: path". */
  function generateResources(intent: IntentResult, ws: Workspace, dirAbs: string): { resources: string[]; outputs: string[] } {
    const resources: string[] = [];
    const outputs: string[] = [];
    const wanted = new Set(intent.resources ?? []);
    const out = (file: string) => `${ws.outputDir}/${file}`;

    if (wanted.has("Glossary")) {
      const guides = recall("translation_guide");
      writeResource(
        dirAbs,
        "glossary.md",
        memoryDoc(
          "Glossary",
          `Terms to keep consistent for "${intent.text}"${intent.entities.targetLanguage ? ` (target language: ${intent.entities.targetLanguage})` : ""}. Assembled from project memory (translation guides).`,
          guides,
          "No glossary or translation guide is in project memory yet. The agents in this workspace build the term list from the source.",
        ),
      );
      resources.push(`Glossary: ${out("glossary.md")}`);
      outputs.push(out("glossary.md"));
    }
    if (wanted.has("Style Guide")) {
      const guides = [...recall("translation_guide"), ...recall("preference")];
      writeResource(
        dirAbs,
        "style-guide.md",
        memoryDoc(
          "Style Guide",
          `Voice, tone and terminology rules for "${intent.text}"${intent.entities.targetLanguage ? ` (target language: ${intent.entities.targetLanguage})` : ""}. Assembled from translation guides and user preferences in project memory; the Brand Analyst extends it.`,
          guides,
          "No translation guide or preference is in project memory yet.",
        ),
      );
      resources.push(`Style Guide: ${out("style-guide.md")}`);
      outputs.push(out("style-guide.md"));
    }
    if (["engineering_review", "feature_build", "bug_fix"].includes(intent.intent)) {
      const standards = [...recall("coding_standard"), ...recall("architecture_decision", 5)];
      if (standards.length) {
        writeResource(
          dirAbs,
          "coding-standards.md",
          memoryDoc("Coding Standards", "The coding standards and architecture decisions this workspace is held to (from project memory).", standards, ""),
        );
        resources.push(`Coding Standards: ${out("coding-standards.md")}`);
        outputs.push(out("coding-standards.md"));
      }
    }
    if (wanted.has("Source File") && ws.files[0]) resources.push(`Source File: ${ws.files[0]}`);
    resources.push(`Output Folder: ${ws.outputDir}`);
    const memoryRefs = (intent.context?.memory ?? []).filter((m) => m.category !== "file_relationship" && m.category !== "agent_performance");
    for (const m of memoryRefs.slice(0, 5)) resources.push(`Memory: ${m.category}/${m.key}`);
    return { resources: [...new Set(resources)], outputs };
  }

  function save(ws: Workspace, insert = false): void {
    const now = nowIso();
    if (insert) q.insert.run(ws.id, JSON.stringify(ws), ws.status, ws.createdAt, now);
    else q.update.run(JSON.stringify(ws), ws.status, now, ws.id);
  }

  const generator: WorkspaceGenerator = {
    async generate(intent: IntentResult): Promise<Workspace> {
      const id = newId("ws");
      const nodeId = `workspace:${id}`;
      const outputDir = outputDirFor(id);
      const dirAbs = join(root, outputDir);
      mkdirSync(dirAbs, { recursive: true });

      const named = (intent.entities?.files ?? []).filter(isIndexed);
      const context = (intent.context?.files ?? []).map((h) => h.path).filter(isIndexed).slice(0, MAX_CONTEXT_FILES);
      const files = [...new Set([...named, ...context])];
      const agents = [...new Set([...(intent.plan ?? []).map((s) => s.agent), ...(intent.required_agents ?? [])])].filter((a) =>
        AGENT_CATALOG.some((d) => d.id === a) || Boolean(graph.getNode(`agent:${a}`)),
      );
      const tools = [...new Set((intent.plan ?? []).flatMap((s) => s.tools ?? []))].sort();

      const ws: Workspace = {
        id,
        nodeId,
        intentId: intent.id,
        intent: intent.intent,
        label: intent.label,
        text: intent.text,
        priority: intent.priority,
        status: "ready",
        agents,
        tools,
        files,
        resources: [],
        plan: intent.plan ?? [],
        outputDir,
        createdAt: nowIso(),
        checkpoint: { completedSteps: {} },
      };

      let outputs: string[] = [];
      try {
        const generated = generateResources(intent, ws, dirAbs);
        ws.resources = generated.resources;
        outputs = generated.outputs;
      } catch (err) {
        ws.resources = [`Output Folder: ${outputDir}`];
        bus.publish("kernel.log", { level: "warn", message: `resources for ${id} could not be generated: ${err instanceof Error ? err.message : String(err)}` }, { source: "workspace" });
      }

      save(ws, true);
      syncNode(ws);
      safeGraph(() => {
        const project = graph.findNodes({ type: "project", limit: 1 })[0];
        if (project) graph.link(project.id, nodeId, "contains");
        for (const f of files) if (graph.getNode(`file:${f}`)) graph.link(`file:${f}`, nodeId, "member_of");
        const servers = new Set(tools.map(toolServerNode).filter((s): s is string => Boolean(s)));
        for (const server of servers) {
          if (!graph.getNode(server)) {
            const name = server.slice("mcp:".length);
            graph.upsertNode({ id: server, type: "mcp", name, props: { status: name.startsWith("builtin-") ? "connected" : "not connected", transport: name.startsWith("builtin-") ? "builtin" : undefined } });
          }
          graph.link(nodeId, server, "uses_tool");
        }
        for (const agentId of agents) {
          const def = AGENT_CATALOG.find((d) => d.id === agentId);
          const agentNode = `agent:${agentId}`;
          graph.upsertNode({ id: agentNode, type: "agent", name: def?.name ?? agentId, props: { agentId, ...(def ? { group: def.group, role: def.role } : {}) } });
          graph.link(agentNode, nodeId, "assigned_to");
        }
        for (const path of outputs) {
          const node = graph.upsertNode({ id: `output:${path}`, type: "output", name: path.split("/").pop() ?? path, props: { path, workspaceId: id, generated: true } });
          graph.link(nodeId, node.id, "contains");
        }
      });

      publish("workspace.generated", ws);
      return structuredClone(ws);
    },

    get(id) {
      return parse(q.get.get(id) as Row | undefined);
    },

    list() {
      return (q.all.all() as Row[]).map((r) => JSON.parse(r.data) as Workspace);
    },

    update(id, patch) {
      const current = generator.get(id);
      if (!current) throw new Error(`Unknown workspace "${id}"`);
      const next: Workspace = { ...current, ...patch, id: current.id, nodeId: current.nodeId, createdAt: current.createdAt };
      for (const key of Object.keys(patch) as (keyof Workspace)[]) if (patch[key] === undefined) delete next[key];
      save(next);
      if (next.status !== current.status || next.label !== current.label || next.report !== current.report || next.agents !== current.agents) syncNode(next);
      return structuredClone(next);
    },

    archive(id) {
      const current = generator.get(id);
      if (!current) return undefined;
      if (current.status === "archived") return current;
      const ws = generator.update(id, { status: "archived" });
      publish("workspace.archived", ws);
      return ws;
    },
  };
  return generator;
}

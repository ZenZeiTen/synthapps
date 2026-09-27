import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import type { EventBus, KernelEvent, KnowledgeGraph, MemoryCategory, MemoryService, Unsubscribe, Workspace } from "../kernel/types";

const MAX_CONTENT = 20_000;
const SKIP_DIRS = new Set([".git", "node_modules", ".nalara", "dist", "build", "target", ".venv", "venv", "__pycache__"]);
const MAX_WALK_DEPTH = 6;
const MAX_WALK_ENTRIES = 20_000;

/**
 * The Memory Agent is platform code (source "platform"), not an LLM agent: it turns kernel events into
 * active memory records.
 *   agent.finished / agent.failed `{ agentId, durationMs, success?, workspaceId? }` -> recordAgentRun
 *   workspace.completed `{ workspace }` -> project_history (key = workspace id)
 *   edge.created `{ edge }` with kind "imports" -> file_relationship (key "a -> b", file paths)
 */
export function attachMemoryAgent(opts: { bus: EventBus; memory: MemoryService; graph: KnowledgeGraph }): Unsubscribe {
  const { bus, memory, graph } = opts;

  const onAgent = (event: KernelEvent) => {
    const d = (event.data ?? {}) as { agentId?: unknown; durationMs?: unknown; success?: unknown; workspaceId?: unknown };
    if (typeof d.agentId !== "string" || !d.agentId) return;
    memory.recordAgentRun(d.agentId, {
      success: event.type === "agent.failed" ? false : d.success !== false,
      durationMs: typeof d.durationMs === "number" && Number.isFinite(d.durationMs) ? d.durationMs : 0,
      workspaceId: typeof d.workspaceId === "string" ? d.workspaceId : undefined,
    });
  };

  const onWorkspace = (event: KernelEvent) => {
    const ws = (event.data as { workspace?: Workspace } | undefined)?.workspace;
    if (!ws?.id) return;
    // Only platform facts go into active memory. Agent-authored text (the Commander summary, finding titles) stays in
    // the report: memory written from it would reach later agents as confirmed fact without a human confirming it.
    const counts: Record<string, number> = {};
    for (const f of ws.report?.findings ?? []) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
    const countText = Object.entries(counts).map(([sev, n]) => `${n} ${sev}`).join(", ");
    const facts = [`${ws.label} (${ws.intent}) ${ws.status}`, `agents: ${(ws.agents ?? []).join(", ")}`];
    if (countText) facts.push(`findings: ${countText}`);
    if (ws.report?.artifactPath) facts.push(`report: ${ws.report.artifactPath}`);
    memory.remember({
      category: "project_history",
      key: ws.id,
      content: facts.join("; "),
      data: { intent: ws.intent, text: ws.text, agents: ws.agents, files: ws.files, status: ws.status, completedAt: ws.completedAt, findingCounts: counts, report: ws.report?.artifactPath },
      tags: [ws.intent, ...(ws.agents ?? [])].filter(Boolean),
      source: "platform",
    });
  };

  const pathOf = (nodeId: string) => {
    const p = graph.getNode(nodeId)?.props.path;
    return typeof p === "string" ? p : nodeId.replace(/^file:/, "");
  };

  const onEdge = (event: KernelEvent) => {
    const d = (event.data ?? {}) as { edge?: { source: string; target: string; kind: string } };
    const edge = d.edge;
    if (!edge || edge.kind !== "imports") return;
    const a = pathOf(edge.source);
    const b = pathOf(edge.target);
    memory.remember({
      category: "file_relationship",
      key: `${a} -> ${b}`,
      content: `${a} imports ${b}`,
      data: { source: a, target: b, kind: "imports" },
      tags: ["imports"],
      source: "platform",
    });
  };

  const subs = [
    bus.subscribe("agent.finished", onAgent),
    bus.subscribe("agent.failed", onAgent),
    bus.subscribe("workspace.completed", onWorkspace),
    bus.subscribe("edge.created", onEdge),
  ];
  return () => subs.forEach((u) => u());
}

async function readText(file: string): Promise<string | undefined> {
  try {
    const s = await stat(file);
    if (!s.isFile()) return undefined;
    return (await readFile(file, "utf8")).slice(0, MAX_CONTENT);
  } catch {
    return undefined;
  }
}

async function listMd(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md"))
      .map((e) => join(dir, e.name))
      .sort();
  } catch {
    return [];
  }
}

const isTranslationGuide = (name: string) => {
  const n = name.toLowerCase();
  return /glossary.*\.(md|csv|json)$/.test(n) || /style-guide.*\.md$/.test(n) || n === "style_guide.md";
};

async function findTranslationGuides(root: string): Promise<string[]> {
  const found: string[] = [];
  let seen = 0;
  async function walk(dir: string, depth: number) {
    if (depth > MAX_WALK_DEPTH || seen > MAX_WALK_ENTRIES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (++seen > MAX_WALK_ENTRIES) return;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(join(dir, e.name), depth + 1);
      } else if (e.isFile() && isTranslationGuide(e.name)) {
        found.push(join(dir, e.name));
      }
    }
  }
  await walk(root, 0);
  return found.sort();
}

/**
 * Seeds memory from conventional project files. Idempotent: records are keyed by file (remember() upserts
 * and leaves unchanged records alone), so a second run writes nothing new. Returns how many records the
 * root provides (created, updated or already up to date).
 *   CODING_STANDARDS.md, CONTRIBUTING.md            -> coding_standard (key = file name)
 *   docs/adr/*.md, docs/decisions/*.md              -> architecture_decision (key = file name)
 *   *glossary*.{md,csv,json}, *style-guide*.md, STYLE_GUIDE.md anywhere -> translation_guide (key = relative path)
 *   .nalara/preferences.json                      -> preference (one record per top-level key)
 */
export async function seedMemoryFromRoot(opts: { root: string; memory: MemoryService }): Promise<number> {
  const { root, memory } = opts;
  let count = 0;
  const put = (category: MemoryCategory, key: string, content: string, data: Record<string, unknown>, tags: string[]) => {
    memory.remember({ category, key, content, data, tags: ["seed", ...tags], source: "platform" });
    count++;
  };
  const rel = (file: string) => relative(root, file).split("\\").join("/");

  for (const name of ["CODING_STANDARDS.md", "CONTRIBUTING.md"]) {
    const text = await readText(join(root, name));
    if (text !== undefined) put("coding_standard", name, text, { path: name }, [name]);
  }

  for (const dir of ["docs/adr", "docs/decisions"]) {
    for (const file of await listMd(join(root, dir))) {
      const text = await readText(file);
      if (text !== undefined) put("architecture_decision", basename(file), text, { path: rel(file) }, ["adr"]);
    }
  }

  for (const file of await findTranslationGuides(root)) {
    const text = await readText(file);
    if (text !== undefined) put("translation_guide", rel(file), text, { path: rel(file) }, [basename(file)]);
  }

  const prefsText = await readText(join(root, ".nalara", "preferences.json"));
  if (prefsText !== undefined) {
    let prefs: unknown;
    try {
      prefs = JSON.parse(prefsText);
    } catch {
      prefs = undefined; // malformed preferences are ignored rather than failing kernel start
    }
    if (prefs && typeof prefs === "object" && !Array.isArray(prefs)) {
      for (const [key, value] of Object.entries(prefs as Record<string, unknown>)) {
        put("preference", key, typeof value === "string" ? value : JSON.stringify(value), { value, path: ".nalara/preferences.json" }, [key]);
      }
    }
  }
  return count;
}

/**
 * Workflows (the canvas "Workflow" node type): named, ordered sequences of intents and agent runs.
 *
 * Built-in: "build_pipeline" (Build Pipeline: review -> test -> docs). Users add their own as JSON files in
 * <root>/.nalara/workflows/*.json. Every file is validated; an invalid file is reported and skipped, never
 * half-loaded. Workflows appear in the graph as `workflow:<id>` nodes contained by the project.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { KnowledgeGraph, WorkflowDefinition } from "./types";

export const WORKFLOWS_DIR = ".nalara/workflows";
const MAX_STEPS = 20;
const MAX_FILE_BYTES = 256 * 1024;

export const BUILTIN_WORKFLOWS: WorkflowDefinition[] = [
  {
    id: "build_pipeline",
    name: "Build Pipeline",
    description: "Review the code, run the tests, then update the documentation.",
    steps: [
      { kind: "agent", agentId: "code_reviewer", task: "Review the project code for defects, risky patterns and coding-standard violations" },
      { kind: "agent", agentId: "qa_engineer", task: "Run the tests and check test coverage for the reviewed code" },
      { kind: "agent", agentId: "documentation", task: "Update the documentation for the reviewed code and its public symbols" },
    ],
  },
];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** Validates one workflow definition; returns the definition or throws with a readable reason. */
export function validateWorkflow(raw: unknown, knownAgent: (id: string) => boolean, where = "workflow"): WorkflowDefinition {
  if (!isObj(raw)) throw new Error(`${where}: must be a JSON object`);
  for (const key of Object.keys(raw)) if (!["id", "name", "description", "steps"].includes(key)) throw new Error(`${where}: unknown key "${key}"`);
  if (!nonEmpty(raw.id) || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(raw.id)) throw new Error(`${where}: id must be lowercase letters, digits, "_" or "-"`);
  if (!nonEmpty(raw.name)) throw new Error(`${where}: name is required`);
  if (raw.description !== undefined && typeof raw.description !== "string") throw new Error(`${where}: description must be a string`);
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) throw new Error(`${where}: steps must be a non-empty array`);
  if (raw.steps.length > MAX_STEPS) throw new Error(`${where}: at most ${MAX_STEPS} steps`);
  const steps: WorkflowDefinition["steps"] = raw.steps.map((s, i) => {
    const at = `${where}: steps[${i}]`;
    if (!isObj(s)) throw new Error(`${at} must be an object`);
    if (s.kind === "intent") {
      for (const key of Object.keys(s)) if (!["kind", "text"].includes(key)) throw new Error(`${at}: unknown key "${key}"`);
      if (!nonEmpty(s.text)) throw new Error(`${at}: text is required`);
      return { kind: "intent" as const, text: s.text.trim() };
    }
    if (s.kind === "agent") {
      for (const key of Object.keys(s)) if (!["kind", "agentId", "task", "files"].includes(key)) throw new Error(`${at}: unknown key "${key}"`);
      if (!nonEmpty(s.agentId) || !knownAgent(s.agentId)) throw new Error(`${at}: unknown agent "${String(s.agentId)}"`);
      if (!nonEmpty(s.task)) throw new Error(`${at}: task is required`);
      if (s.files !== undefined && (!Array.isArray(s.files) || s.files.some((f) => !nonEmpty(f) || f.includes("..") || f.startsWith("/")))) {
        throw new Error(`${at}: files must be relative paths inside the root`);
      }
      return { kind: "agent" as const, agentId: s.agentId, task: s.task.trim(), ...(s.files ? { files: [...(s.files as string[])] } : {}) };
    }
    throw new Error(`${at}: kind must be "intent" or "agent"`);
  });
  return { id: raw.id, name: raw.name.trim(), description: typeof raw.description === "string" ? raw.description : "", steps };
}

/**
 * Loads the built-ins plus <root>/.nalara/workflows/*.json. A user workflow may not reuse a built-in id.
 * With a graph, upserts `workflow:<id>` nodes (props: description, steps, source) linked from the project.
 */
export function loadWorkflows(opts: { root: string; knownAgent: (id: string) => boolean; graph?: KnowledgeGraph; projectId?: string }): {
  workflows: WorkflowDefinition[];
  errors: string[];
} {
  const workflows: WorkflowDefinition[] = BUILTIN_WORKFLOWS.map((w) => structuredClone(w));
  const sources = new Map<string, string>(workflows.map((w) => [w.id, "builtin"]));
  const errors: string[] = [];
  const dir = join(opts.root, WORKFLOWS_DIR);
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".json")).sort();
  } catch {
    names = [];
  }
  for (const name of names) {
    const file = join(dir, name);
    const where = `${WORKFLOWS_DIR}/${name}`;
    try {
      const st = statSync(file);
      if (!st.isFile()) continue;
      if (st.size > MAX_FILE_BYTES) throw new Error(`${where}: file is larger than ${MAX_FILE_BYTES} bytes`);
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(file, "utf8"));
      } catch (err) {
        throw new Error(`${where}: invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
      }
      const wf = validateWorkflow(raw, opts.knownAgent, where);
      if (sources.has(wf.id)) throw new Error(`${where}: id "${wf.id}" is already used by ${sources.get(wf.id)}`);
      sources.set(wf.id, where);
      workflows.push(wf);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (opts.graph) {
    for (const wf of workflows) {
      try {
        const node = opts.graph.upsertNode({
          id: `workflow:${wf.id}`,
          type: "workflow",
          name: wf.name,
          props: { workflowId: wf.id, description: wf.description, steps: wf.steps, source: sources.get(wf.id) },
        });
        if (opts.projectId && opts.graph.getNode(opts.projectId)) opts.graph.link(opts.projectId, node.id, "contains");
        for (const step of wf.steps) {
          if (step.kind === "agent" && opts.graph.getNode(`agent:${step.agentId}`)) opts.graph.link(node.id, `agent:${step.agentId}`, "relates_to");
        }
      } catch (err) {
        errors.push(`graph update for workflow ${wf.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return { workflows, errors };
}

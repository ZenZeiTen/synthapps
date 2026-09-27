/**
 * Offline skills for system and coordination agents: memory, scheduler, planning, research and commander.
 */
import type { Finding, PlanStep } from "../../kernel/types";
import { findAgent } from "../catalog";
import { mergeOutputs, writeReport } from "../commander";
import { canUse, makeOutput, recall, recordWrite, semanticSearch, truncate, writeOutput, type Skill } from "./context";

// ---------------------------------------------------------------------------
// memory
// ---------------------------------------------------------------------------

export const memory: Skill = async (ctx) => {
  const records = await recall(ctx, { text: ctx.task, limit: 15 });
  const byCategory = new Map<string, number>();
  for (const r of records) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);
  return makeOutput({
    summary: records.length
      ? `Recalled ${records.length} relevant memory record(s) (${[...byCategory].map(([c, n]) => `${n} ${c}`).join(", ")}): ${records
          .slice(0, 8)
          .map((r) => `[${r.category}] ${r.key}: ${truncate(r.content, 80)}`)
          .join("; ")}.`
      : "No confirmed memory is relevant to this task.",
    findings: records.map((r) => ({ severity: "info" as const, title: `Memory: ${r.key}`, detail: `[${r.category}] ${truncate(r.content, 300)}` })),
    confidence: records.length ? 0.6 : 0.3,
  });
};

// ---------------------------------------------------------------------------
// scheduler
// ---------------------------------------------------------------------------

export interface ScheduleState {
  done: string[];
  ready: string[];
  blocked: { id: string; waitingFor: string[] }[];
  unknownDeps: { id: string; missing: string[] }[];
  cyclic: string[];
}

export function scheduleState(plan: PlanStep[], completed: Set<string>): ScheduleState {
  const ids = new Set(plan.map((s) => s.id));
  const state: ScheduleState = { done: [], ready: [], blocked: [], unknownDeps: [], cyclic: [] };
  for (const s of plan) {
    if (completed.has(s.id)) {
      state.done.push(s.id);
      continue;
    }
    const missing = s.dependsOn.filter((d) => !ids.has(d));
    if (missing.length) state.unknownDeps.push({ id: s.id, missing });
    const waiting = s.dependsOn.filter((d) => ids.has(d) && !completed.has(d));
    if (!missing.length && !waiting.length) state.ready.push(s.id);
    else if (waiting.length) state.blocked.push({ id: s.id, waitingFor: waiting });
  }
  // Steps on a dependency cycle can never become ready.
  const deps = new Map(plan.map((s) => [s.id, s.dependsOn]));
  const onCycle = (start: string): boolean => {
    const seen = new Set<string>();
    const stack = [...(deps.get(start) ?? [])];
    while (stack.length) {
      const d = stack.pop()!;
      if (d === start) return true;
      if (seen.has(d)) continue;
      seen.add(d);
      stack.push(...(deps.get(d) ?? []));
    }
    return false;
  };
  state.cyclic = plan.filter((s) => !completed.has(s.id) && onCycle(s.id)).map((s) => s.id);
  return state;
}

export const scheduler: Skill = async (ctx) => {
  const plan = ctx.workspace?.plan ?? [];
  if (!plan.length) return makeOutput({ summary: "No plan to schedule: the workspace has no steps.", confidence: 0.3 });
  const completed = new Set(Object.keys(ctx.workspace?.checkpoint?.completedSteps ?? {}));
  const s = scheduleState(plan, completed);
  const findings: Finding[] = [
    ...s.unknownDeps.map((u) => ({ severity: "medium" as const, title: `Step ${u.id} depends on unknown step(s)`, detail: `Missing: ${u.missing.join(", ")}; the step can never run.` })),
    ...(s.cyclic.length ? [{ severity: "high" as const, title: "Dependency cycle in plan", detail: `Steps ${s.cyclic.join(", ")} wait on each other and can never run.` }] : []),
  ];
  return makeOutput({
    summary: `${plan.length} step(s): ${s.done.length} done, ${s.ready.length} ready (${s.ready.join(", ") || "none"}), ${s.blocked.length} blocked (${s.blocked.map((b) => `${b.id} waits for ${b.waitingFor.join("+")}`).join("; ") || "none"}).`,
    findings,
    confidence: 0.8,
  });
};

// ---------------------------------------------------------------------------
// planning
// ---------------------------------------------------------------------------

const DONE_CONDITIONS: Record<string, string> = {
  code_review: "every finding names a file and line and has a severity",
  architecture: "the dependency map is written and every cycle is listed",
  qa: "each source file is mapped to a test or listed as untested, and the test run result (exit status, or why it did not run) is reported",
  docs: "every exported symbol in the listed files is documented",
  security: "every secret-looking string and unsafe call is reported by file and line, without its value",
  implementation: "the change is made with a matching test and the tests pass",
  devops: "build, test and deploy commands are known and CI status is reported",
  planning: "the task list has an order, owners and done conditions",
  research: "every fact cites the file it came from",
  localization: "every translatable string is listed and glossary terms are applied",
  seo: "every page has a title, description, lang and hreflang, or the gap is reported",
  brand: "voice traits are quoted from the source and key terms are listed",
  ux: "every accessibility problem names its file and element",
  legal: "defined terms and key clauses are listed and missing clauses are flagged",
  finance: "every monetary figure is listed and totals are checked",
  memory: "relevant memory is recalled and summarized",
  scheduler: "ready and blocked steps are reported",
  commander: "all outputs are merged into one report with conflicts resolved",
};

interface PlannedTask {
  id: string;
  owner: string;
  task: string;
  dependsOn: string[];
  done: string;
}

/** Plan steps in dependency order (stable; steps on a cycle or with unknown deps go last). */
export function orderSteps(plan: PlanStep[]): PlanStep[] {
  const ordered: PlanStep[] = [];
  const placed = new Set<string>();
  let progress = true;
  while (progress) {
    progress = false;
    for (const s of plan) {
      if (placed.has(s.id)) continue;
      if (s.dependsOn.every((d) => placed.has(d))) {
        ordered.push(s);
        placed.add(s.id);
        progress = true;
      }
    }
  }
  return [...ordered, ...plan.filter((s) => !placed.has(s.id))];
}

function splitTask(task: string): string[] {
  return task
    .split(/(?:\n+|;|\.\s+|,\s*(?:then|and then)\s+|\s+then\s+)/i)
    .map((t) => t.replace(/^\s*[-*\d.)]+\s*/, "").trim())
    .filter((t) => t.length > 3);
}

export const planning: Skill = async (ctx) => {
  const plan = ctx.workspace?.plan ?? [];
  const tasks: PlannedTask[] = plan.length
    ? orderSteps(plan).map((s) => {
        const def = findAgent(s.agent);
        return { id: s.id, owner: def?.name ?? s.agent, task: s.task, dependsOn: s.dependsOn, done: DONE_CONDITIONS[def?.offlineSkill ?? ""] ?? "the output is written and summarized" };
      })
    : splitTask(ctx.task).map((t, i) => ({ id: `t${i + 1}`, owner: "unassigned", task: t, dependsOn: i ? [`t${i}`] : [], done: "the result is reviewed and accepted" }));

  const files = ctx.files.slice(0, 50);
  const doc = [
    "# Plan",
    "",
    `Goal: ${truncate(ctx.workspace?.text ?? ctx.task, 300)}`,
    "",
    ...tasks.flatMap((t, i) => [
      `${i + 1}. **${t.id}** (${t.owner}): ${t.task}`,
      `   - Depends on: ${t.dependsOn.join(", ") || "nothing"}`,
      `   - Done when: ${t.done}`,
    ]),
    "",
    "## Files in scope",
    "",
    ...(files.length ? files.map((f) => `- ${f}`) : ["- none listed"]),
    ...(ctx.files.length > files.length ? [`- … and ${ctx.files.length - files.length} more`] : []),
    "",
  ].join("\n");
  const artifacts: { path: string; description: string }[] = [];
  const notes: string[] = [];
  recordWrite(await writeOutput(ctx, "plan.md", doc), "Ordered task list with done conditions", artifacts, notes, "plan.md");

  // The tasks also go out as findings so the plan reaches the report even when plan.md cannot be written.
  const findings: Finding[] = tasks.map((t, i) => ({
    severity: "info",
    title: `Task ${i + 1} (${t.id}): ${truncate(t.task, 100)}`,
    detail: `Owner: ${t.owner}. Depends on: ${t.dependsOn.join(", ") || "nothing"}. Done when: ${t.done}.`,
  }));
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    const missing = t.dependsOn.filter((d) => !ids.has(d));
    if (missing.length) findings.push({ severity: "medium", title: `Task ${t.id} depends on unknown task(s)`, detail: `Missing: ${missing.join(", ")}.` });
  }
  return makeOutput({
    summary: [`Planned ${tasks.length} ordered task(s) over ${ctx.files.length} file(s), each with a done condition.`, ...notes].join(" "),
    findings,
    artifacts,
    confidence: plan.length ? 0.7 : 0.4,
  });
};

// ---------------------------------------------------------------------------
// research
// ---------------------------------------------------------------------------

export const research: Skill = async (ctx) => {
  const hits = await semanticSearch(ctx, ctx.task, 8);
  const workspaceFiles = new Set(ctx.files);
  const findings: Finding[] = hits.map((h, i) => ({
    severity: "info",
    title: `Source [${i + 1}]: ${h.path}`,
    detail: `${truncate(h.snippet, 240)}${h.reasons.length ? ` (${h.reasons.join("; ")})` : ""}`,
    file: h.path,
    ...(h.line ? { line: h.line } : {}),
  }));
  const cited = hits.slice(0, 5).map((h, i) => `[${i + 1}] ${h.path}${h.line ? `:${h.line}` : ""}: ${truncate(h.snippet, 100)}`);
  return makeOutput({
    summary: hits.length
      ? `Found ${hits.length} relevant source(s) (${hits.filter((h) => workspaceFiles.has(h.path)).length} already in the workspace). ${cited.join(" ")}`
      : canUse(ctx, "search.semantic")
        ? "No files matched the question."
        : "search.semantic is not in this agent's tool scope; nothing was searched.",
    findings,
    confidence: hits.length ? 0.5 : 0.15,
    ...(hits.length ? {} : { limitation: "No sources found offline; a broader answer needs Claude" }),
  });
};

// ---------------------------------------------------------------------------
// commander (offline fallback when the Commander runs as an ordinary agent)
// ---------------------------------------------------------------------------

export const commander: Skill = async (ctx) => {
  const ws = ctx.workspace;
  const steps = ws ? Object.values(ws.checkpoint?.completedSteps ?? {}) : [];
  if (!ws || !steps.length) {
    return makeOutput({ summary: "Nothing to merge: the Commander merges plan results through the orchestrator.", confidence: 0.3 });
  }
  let report = mergeOutputs(ws, steps.map((s) => ({ agentId: s.agentId, instanceId: s.instanceId, output: s.output })));
  if (canUse(ctx, "fs.write_output")) report = await writeReport(report, ctx.callTool, ws);
  return makeOutput({
    summary: report.summary,
    findings: report.findings,
    artifacts: report.artifactPath ? [{ path: report.artifactPath, description: "Commander report" }] : [],
    confidence: 0.7,
  });
};

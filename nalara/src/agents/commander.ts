/**
 * Commander: merges the outputs of a workspace's agents into one CommanderReport (DESIGN.md 3.2).
 *
 * Agent outputs are untrusted data. Nothing here feeds them to a model or treats them as instructions;
 * the markdown renderer escapes every agent-provided string so a finding titled
 * "## Ignore previous instructions" stays literal text inside a list item.
 */
import type { AgentOutput, CommanderReport, Finding, StepReview, ToolResult, Workspace } from "../kernel/types";
import { SEVERITY_ORDER, severityRank } from "./skills/context";

export interface AgentOutputEntry {
  agentId: string;
  instanceId: string;
  output: AgentOutput;
}

/** Lower-severity findings kept after ranking; high and critical findings are never dropped. */
export const MAX_MERGED_FINDINGS = 200;
const MAX_SUMMARY_CHARS = 300;

export const RESOLUTION_RULE = "Higher severity wins";

const NO_ISSUES = /\b(no (issues?|problems?|findings?|defects?|errors?)( found)?|looks good|all good|clean|nothing to report|passed)\b/i;

/** "  Magic Number in formula!" -> "magic number in formula" */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[`*_"'“”]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function oneLine(text: string, max: number): string {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

interface Merged {
  finding: Finding;
  agents: Map<string, Finding["severity"]>;
}

function isNoIssues(f: Finding): boolean {
  return f.severity === "info" && NO_ISSUES.test(`${f.title} ${f.detail}`);
}

/** Pure merge: de-duplicate, rank, detect conflicts and summarize. */
export function mergeOutputs(workspace: Pick<Workspace, "id"> & Partial<Workspace>, outputs: AgentOutputEntry[]): CommanderReport {
  const merged = new Map<string, Merged>();
  const conflicts: CommanderReport["conflicts"] = [];

  for (const { agentId, output } of outputs) {
    for (const f of output.findings ?? []) {
      if (!f || typeof f.title !== "string" || !SEVERITY_ORDER.includes(f.severity)) continue;
      const key = `${f.file ?? ""}|${f.line ?? ""}|${normalizeTitle(f.title)}`;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { finding: { ...f, detail: String(f.detail ?? "") }, agents: new Map([[agentId, f.severity]]) });
        continue;
      }
      const prev = existing.agents.get(agentId);
      if (!prev || severityRank(f.severity) < severityRank(prev)) existing.agents.set(agentId, f.severity);
      if (severityRank(f.severity) < severityRank(existing.finding.severity)) existing.finding = { ...f, detail: String(f.detail ?? "") };
    }
  }

  // Conflict 1: the same finding (file, line, title) rated differently by different agents.
  for (const m of merged.values()) {
    const severities = new Set(m.agents.values());
    if (m.agents.size < 2 || severities.size < 2) continue;
    const ratings = [...m.agents].map(([a, s]) => `${a} rated it ${s}`).join(", ");
    conflicts.push({
      topic: `${m.finding.file ? `${m.finding.file}${m.finding.line ? `:${m.finding.line}` : ""}: ` : ""}${oneLine(m.finding.title, 120)}`,
      agents: [...m.agents.keys()],
      resolution: `${RESOLUTION_RULE}: kept as ${m.finding.severity} (${ratings}).`,
    });
  }

  // Conflict 2: one agent says a file has no issues while another flags it.
  const flaggedByFile = new Map<string, { agent: string; severity: Finding["severity"]; title: string }[]>();
  for (const m of merged.values()) {
    if (!m.finding.file || isNoIssues(m.finding) || m.finding.severity === "info") continue;
    for (const [agent, severity] of m.agents) {
      flaggedByFile.set(m.finding.file, [...(flaggedByFile.get(m.finding.file) ?? []), { agent, severity, title: m.finding.title }]);
    }
  }
  const cleared = new Map<string, Set<string>>(); // file -> agents that said "no issues"
  for (const { agentId, output } of outputs) {
    for (const f of output.findings ?? []) if (f?.file && isNoIssues(f)) cleared.set(f.file, new Set([...(cleared.get(f.file) ?? []), agentId]));
    // A summary like "src/a.ts: no issues" also counts, when it names the file.
    if (NO_ISSUES.test(output.summary ?? "")) {
      for (const file of flaggedByFile.keys()) if ((output.summary ?? "").includes(file)) cleared.set(file, new Set([...(cleared.get(file) ?? []), agentId]));
    }
  }
  for (const [file, clearers] of cleared) {
    const flags = (flaggedByFile.get(file) ?? []).filter((f) => !clearers.has(f.agent));
    if (!flags.length) continue;
    const worst = [...flags].sort((a, b) => severityRank(a.severity) - severityRank(b.severity))[0];
    const flaggers = [...new Set(flags.map((f) => f.agent))];
    conflicts.push({
      topic: `${file}: "no issues" versus ${flags.length} finding(s)`,
      agents: [...clearers, ...flaggers],
      resolution: `${RESOLUTION_RULE}: ${[...clearers].join(", ")} reported no issues, ${flaggers.join(", ")} flagged ${worst.severity} "${oneLine(worst.title, 80)}"; the findings stand.`,
    });
  }

  // Failure detection: an empty or zero-confidence output is flagged, never silently trusted.
  const quality: Finding[] = [];
  for (const { agentId, output } of outputs) {
    const empty = !oneLine(output.summary ?? "", 10) && !(output.findings ?? []).length;
    if (empty || !(output.confidence > 0)) {
      quality.push({
        severity: "low",
        title: `Unreliable output from ${agentId}`,
        detail: empty ? "The agent returned an empty result." : "The agent reported zero confidence in its result.",
      });
    }
  }

  const ranked = [...merged.values()]
    .map((m) => ({
      ...m.finding,
      detail: m.agents.size > 1 ? `${m.finding.detail} (reported by ${[...m.agents.keys()].join(", ")})` : m.finding.detail,
    }))
    .concat(quality)
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || (a.file ?? "~").localeCompare(b.file ?? "~") || (a.line ?? 0) - (b.line ?? 0));
  const severe = ranked.filter((f) => f.severity === "critical" || f.severity === "high");
  const rest = ranked.filter((f) => f.severity !== "critical" && f.severity !== "high");
  const keptRest = rest.slice(0, Math.max(0, MAX_MERGED_FINDINGS - severe.length));
  const findings = [...severe, ...keptRest];
  const dropped = rest.length - keptRest.length;

  const counts = SEVERITY_ORDER.map((s) => [s, findings.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n)
    .map(([s, n]) => `${n} ${s}`)
    .join(", ");
  const lines = [
    `${outputs.length} agent(s), ${findings.length} merged finding(s)${counts ? ` (${counts})` : ""}, ${conflicts.length} conflict(s).${dropped ? ` ${dropped} lower-severity finding(s) omitted.` : ""}`,
    ...outputs.map(({ agentId, output }) => `${agentId} (${output.source}, confidence ${Number(output.confidence ?? 0).toFixed(2)}): ${oneLine(output.summary ?? "", MAX_SUMMARY_CHARS)}`),
    ...outputs.filter((o) => o.output.limitation).map(({ agentId, output }) => `Limitation (${agentId}): ${oneLine(output.limitation!, MAX_SUMMARY_CHARS)}`),
  ];

  return {
    workspaceId: workspace.id,
    summary: lines.join("\n"),
    outputs: outputs.map((o) => ({ agentId: o.agentId, instanceId: o.instanceId, output: o.output })),
    conflicts,
    findings,
  };
}

/**
 * Adds the adversarial review to a merged report: the reviews themselves, a summary line, and one high finding per
 * step that did not survive its critics, so unresolved work is never presented as settled.
 */
export function applyReviews(report: CommanderReport, reviews: StepReview[]): CommanderReport {
  if (!reviews.length) return report;
  const count = (v: StepReview["verdict"]) => reviews.filter((r) => r.verdict === v).length;
  const extra: Finding[] = reviews
    .filter((r) => r.verdict === "unresolved")
    .map((r) => ({
      severity: "high" as const,
      title: `Step ${r.stepId} (${r.builderId}) did not survive adversarial review`,
      detail: `${r.reason}. Open: ${r.open.map((c) => `${c.finding.severity} "${oneLine(c.finding.title, 80)}"${c.finding.file ? ` at ${c.finding.file}${c.finding.line ? `:${c.finding.line}` : ""}` : ""} (${c.criticId})`).join("; ") || "none listed"}`,
    }));
  const findings = [...extra, ...report.findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const line = `Adversarial review: ${reviews.length} builder step(s), ${count("survived")} survived, ${count("unresolved")} unresolved, ${count("unreviewed")} unreviewed.`;
  const [first, ...rest] = report.summary.split("\n");
  return { ...report, findings, reviews, summary: [first, line, ...rest].join("\n") };
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

/**
 * Escapes agent-provided text for inline use: no headings, links, images, HTML, tables, emphasis or code spans
 * survive. Callers always put the result after a prefix (list marker, label), never at the start of a line.
 */
export function escapeMarkdown(text: string): string {
  return String(text ?? "")
    .replace(/\r?\n+/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_[\]#|~])/g, "\\$1")
    .trim();
}

/** Multi-line agent text as an indented block quote of escaped lines. */
function quoteBlock(text: string): string {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((l) => `> ${escapeMarkdown(l)}`)
    .join("\n");
}

export function renderReportMarkdown(report: CommanderReport, workspace?: Partial<Workspace>): string {
  const out: string[] = [];
  out.push(`# Commander report: ${escapeMarkdown(workspace?.label ?? report.workspaceId)}`, "");
  if (workspace?.text) out.push("Intent:", "", quoteBlock(workspace.text), "");
  out.push("## Summary", "");
  for (const line of report.summary.split("\n")) out.push(`- ${escapeMarkdown(line)}`);
  out.push("", "## Findings", "");
  if (!report.findings.length) out.push("No findings.");
  report.findings.forEach((f, i) => {
    const where = f.file ? ` (${escapeMarkdown(f.file)}${f.line ? `:${f.line}` : ""})` : "";
    out.push(`${i + 1}. **${f.severity.toUpperCase()}** ${escapeMarkdown(f.title)}${where}${f.evidence ? ` [evidence: ${f.evidence}]` : ""}`);
    if (f.detail) out.push(`   - ${escapeMarkdown(f.detail)}`);
  });
  out.push("", "## Conflicts", "");
  if (!report.conflicts.length) out.push("No conflicts between agents.");
  for (const c of report.conflicts) {
    out.push(`- **${escapeMarkdown(c.topic)}**`, `  - Agents: ${c.agents.map(escapeMarkdown).join(", ")}`, `  - Resolution: ${escapeMarkdown(c.resolution)}`);
  }
  if (report.reviews?.length) {
    out.push("", "## Adversarial review", "");
    for (const r of report.reviews) {
      out.push(`- **${escapeMarkdown(r.stepId)}** ${escapeMarkdown(r.builderId)} vs ${r.critics.map(escapeMarkdown).join(", ")}: **${r.verdict}** after ${r.rounds} round(s). ${escapeMarkdown(r.reason)}`);
      for (const c of r.open) {
        const where = c.finding.file ? ` (${escapeMarkdown(c.finding.file)}${c.finding.line ? `:${c.finding.line}` : ""})` : "";
        out.push(`  - Open: ${c.finding.severity} ${escapeMarkdown(c.finding.title)}${where}, raised by ${escapeMarkdown(c.criticId)}; evidence ${c.evidence}`);
      }
    }
  }
  out.push("", "## Agents", "");
  for (const o of report.outputs) {
    out.push(`### ${escapeMarkdown(o.agentId)} (${escapeMarkdown(o.instanceId)})`, "");
    out.push(`Source: ${o.output.source}; confidence ${Number(o.output.confidence ?? 0).toFixed(2)}; ${o.output.findings.length} finding(s).`, "");
    out.push(quoteBlock(o.output.summary ?? ""), "");
    if (o.output.limitation) out.push(`Limitation: ${escapeMarkdown(o.output.limitation)}`, "");
    if (o.output.artifacts.length) {
      out.push("Artifacts:", "");
      for (const a of o.output.artifacts) out.push(`- ${escapeMarkdown(a.path)}: ${escapeMarkdown(a.description)}`);
      out.push("");
    }
  }
  return out.join("\n");
}

/**
 * Writes the report through the tool gateway (fs.write_output "report.md") and sets artifactPath.
 * A failed or denied write leaves artifactPath unset; the report itself is still returned.
 */
export async function writeReport(
  report: CommanderReport,
  callTool: (name: string, input: Record<string, unknown>) => Promise<ToolResult>,
  workspace?: Partial<Workspace>,
): Promise<CommanderReport> {
  const result = await callTool("fs.write_output", { path: "report.md", content: renderReportMarkdown(report, workspace) });
  if (!result.ok) return { ...report };
  const data = result.data as { path?: unknown } | undefined;
  const path = typeof data?.path === "string" ? data.path : workspace?.outputDir ? `${workspace.outputDir}/report.md` : "report.md";
  return { ...report, artifactPath: path };
}

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api } from "../api";
import { useDebouncedCallback, useEscapeLayer } from "../hooks";
import type { AgentInstance, Finding, KernelEvent, PlanStep, Verdict, Workspace, WorkspaceDetail } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconAlert, IconArchive, IconClose, IconFile, IconPlay, IconRefresh, IconUndo } from "./Icons";

interface Props {
  workspaceId: string;
  agentName: (id: string) => string;
  onOpenFile: (path: string, line?: number) => void;
  onAgent: (agentId: string) => void;
  onToast: (message: string, tone?: "ok" | "error") => void;
  onEvent: (l: (ev: KernelEvent) => void) => () => void;
  onClose: () => void;
  /** Opens the workspace's process tree (Fleet panel). */
  onOpenTree?: (workspaceId: string) => void;
  halted: boolean;
}

type StepStatus = "done" | "running" | "failed" | "pending";

const SEVERITY_ORDER: Finding["severity"][] = ["critical", "high", "medium", "low", "info"];
const VERDICT_CLASS: Record<Verdict, string> = { survived: "badge-green", unresolved: "badge-red", unreviewed: "badge-amber" };

function stepStatus(step: PlanStep, ws: Workspace, instances: AgentInstance[]): StepStatus {
  if (ws.checkpoint?.completedSteps?.[step.id]) return "done";
  const mine = instances.filter((i) => i.agentId === step.agent);
  if (mine.some((i) => i.state === "active" || i.state === "collaborating" || i.state === "summoned")) return ws.status === "running" ? "running" : "pending";
  if (mine.some((i) => i.state === "failed" || i.state === "terminated")) return "failed";
  if (mine.some((i) => i.state === "completed" || i.state === "archived")) return "done";
  return "pending";
}

const EYEBROW: Record<Workspace["status"], string> = {
  ready: "WORKSPACE READY",
  running: "WORKSPACE RUNNING",
  completed: "WORKSPACE COMPLETE",
  failed: "WORKSPACE FAILED",
  archived: "WORKSPACE ARCHIVED",
};

/**
 * What a workspace produced, in a translucent sheet on the right: intent, agents, plan, the Commander's summary,
 * ranked findings, conflicts and the report. Escape or the close button returns to the core.
 */
export function ResultsSheet(props: Props) {
  const { workspaceId, onEvent, onToast, onClose } = props;
  const id = useId();
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const load = useCallback(async () => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    try {
      setDetail(await api.workspace(workspaceId, c.signal));
      setError(null);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    }
  }, [workspaceId]);

  useEffect(() => {
    setDetail(null);
    setError(null);
    void load();
    return () => ctl.current?.abort();
  }, [load]);

  const refresh = useDebouncedCallback(() => void load(), 300);
  useEffect(
    () =>
      onEvent((ev) => {
        const d = (ev.data ?? {}) as Record<string, unknown>;
        if (ev.correlationId === workspaceId || d.workspaceId === workspaceId) refresh();
      }),
    [onEvent, workspaceId, refresh],
  );

  // Escape closes the sheet: from inside it (onKeyDown below), or with focus on <body> when it is the newest overlay.
  useEscapeLayer(() => closeRef.current());

  const ws = detail?.workspace;
  const instances = detail?.instances ?? [];

  const act = async (what: "run" | "archive" | "undo") => {
    if (!ws) return;
    setActing(what);
    try {
      if (what === "run") {
        await api.runWorkspace(ws.id);
        onToast(`Running ${ws.label}`);
      } else if (what === "archive") {
        await api.archiveWorkspace(ws.id);
        onToast(`Archived ${ws.label}`);
      } else {
        const r = await api.undoWorkspace(ws.id);
        const skipped = r.skipped.length ? `, ${r.skipped.length} skipped (${r.skipped.map((s) => `${s.path}: ${s.reason}`).join("; ")})` : "";
        onToast(`Undo: ${r.restored.length} file(s) restored${skipped}`, r.skipped.length ? "error" : "ok");
      }
      await load();
    } catch (err) {
      onToast(`${what} failed: ${(err as Error).message}`, "error");
    } finally {
      setActing(null);
    }
  };

  const latestByAgent = new Map<string, AgentInstance>();
  for (const i of instances) {
    const prev = latestByAgent.get(i.agentId);
    if (!prev || (i.startedAt ?? "") >= (prev.startedAt ?? "")) latestByAgent.set(i.agentId, i);
  }
  const findings = [...(ws?.report?.findings ?? [])].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

  return (
    <aside
      ref={ref}
      className="results-sheet glass"
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${id}-t`}
      aria-busy={!ws || undefined}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="sheet-head">
        <div className="sheet-head-text">
          <p className="eyebrow">
            {ws ? EYEBROW[ws.status] : "WORKSPACE"} · <span className="mono">{workspaceId}</span>
          </p>
          <h2 id={`${id}-t`} className="sheet-title">
            {ws?.label ?? "Loading..."}
          </h2>
        </div>
        <button type="button" className="icon-btn" aria-label="Close results" onClick={onClose}>
          <IconClose size={15} />
        </button>
      </header>

      <div className="sheet-body">
        {error ? (
          <div className="inline-error" role="alert">
            <IconAlert size={15} /> {error}
            <button type="button" className="btn btn-sm" onClick={() => void load()}>
              <IconRefresh size={13} /> Retry
            </button>
          </div>
        ) : null}

        {ws ? (
          <>
            <div className="sheet-status-row">
              <span className={`badge sheet-status st-${ws.status}`}>{ws.status}</span>
              <span className="badge mono">{ws.intent}</span>
              <span className="muted small mono">priority {ws.priority}</span>
            </div>
            <p className="sheet-intent">&ldquo;{ws.text}&rdquo;</p>

            <section className="sheet-sec" aria-label="Agents">
              <h3>Agents</h3>
              <ul className="sheet-agents">
                {ws.agents.map((a) => {
                  const st = latestByAgent.get(a)?.state ?? "dormant";
                  return (
                    <li key={a}>
                      <button type="button" className={`sheet-agent sat-${st}`} data-agent-id={a} onClick={() => props.onAgent(a)} aria-label={`${props.agentName(a)}, ${st}. Open agent actions`}>
                        <span className="sat-dot" aria-hidden="true" />
                        <span className="sheet-agent-name">{props.agentName(a)}</span>
                        <span className={`state-badge st-${st}`}>{st}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="sheet-sec" aria-label="Plan">
              <h3>Plan</h3>
              <ol className="plan">
                {ws.plan.map((s, i) => {
                  const st = stepStatus(s, ws, instances);
                  return (
                    <li key={s.id} className={`plan-step ps-${st}`}>
                      <span className="mono plan-n">{String(i + 1).padStart(2, "0")}</span>
                      <span className="plan-body">
                        <span className="plan-agent">{props.agentName(s.agent)}</span> {s.task}
                      </span>
                      <span className={`plan-st ps-${st}`}>{st}</span>
                    </li>
                  );
                })}
              </ol>
            </section>

            <section className="sheet-sec" aria-label="Output">
              <h3>Commander</h3>
              {ws.error ? (
                <p className="inline-error" role="alert">
                  {ws.error}
                </p>
              ) : null}
              {ws.report ? (
                <>
                  <p className="sheet-summary">{ws.report.summary}</p>
                  <h3 className="sheet-sub">Findings {findings.length ? `(${findings.length})` : ""}</h3>
                  {findings.length ? (
                    <ol className="findings">
                      {findings.map((f, i) => (
                        <li key={i} className={`finding sev-${f.severity}`}>
                          <span className={`sev sev-${f.severity}`}>{f.severity}</span>
                          <span className="finding-body">
                            <span className="finding-title">{f.title}</span>
                            {f.file ? (
                              <button type="button" className="link-btn mono finding-loc" onClick={() => props.onOpenFile(f.file!, f.line)}>
                                {f.file}
                                {f.line ? `:${f.line}` : ""}
                              </button>
                            ) : null}
                            <span className="finding-detail">{f.detail}</span>
                            {f.evidence && f.evidence !== "verified" ? <span className="muted small">evidence: {f.evidence}</span> : null}
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="muted">No findings.</p>
                  )}
                  {ws.report.reviews?.length ? (
                    <div className="sheet-reviews">
                      <h3 className="sheet-sub">Adversarial review</h3>
                      <ul className="review-list">
                        {ws.report.reviews.map((r) => (
                          <li key={r.stepId} className="review">
                            <span className="mono small">{r.stepId}</span> {props.agentName(r.builderId)} vs {r.critics.map(props.agentName).join(", ")}{" "}
                            <span className={`badge ${VERDICT_CLASS[r.verdict]}`}>{r.verdict}</span>
                            <span className="muted small">
                              {" "}
                              {r.rounds} round(s)
                              {r.open.length ? `, ${r.open.length} open challenge(s)` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {ws.report.conflicts.length ? (
                    <div className="conflicts">
                      <h3 className="sheet-sub">Conflicts</h3>
                      <ul>
                        {ws.report.conflicts.map((c, i) => (
                          <li key={i}>
                            <strong>{c.topic}</strong> <span className="muted">({c.agents.map(props.agentName).join(", ")})</span>: {c.resolution}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              ) : ws.error ? null : (
                <p className="muted">
                  {ws.status === "running" ? "The swarm is working. The Commander merges the outputs when every step is done." : "No output yet. Run the workspace to produce one."}
                </p>
              )}
            </section>
          </>
        ) : !error ? (
          <p className="muted">Loading workspace...</p>
        ) : null}
      </div>

      {ws ? (
        <footer className="sheet-actions">
          {ws.report?.artifactPath ? (
            <button type="button" className="btn btn-primary report-link" onClick={() => props.onOpenFile(ws.report!.artifactPath!)} title={ws.report.artifactPath}>
              <IconFile size={14} /> Open report <span className="mono sr-only">{ws.report.artifactPath}</span>
            </button>
          ) : null}
          {props.onOpenTree ? (
            <button type="button" className="btn" onClick={() => props.onOpenTree!(ws.id)} title="Who spawned whom, builders against critics, and the relay">
              Process tree
            </button>
          ) : null}
          <button type="button" className="btn" onClick={() => setConfirmUndo(true)} disabled={acting !== null}>
            <IconUndo size={14} /> Undo writes
          </button>
          <button type="button" className="btn" onClick={() => void act("archive")} disabled={acting !== null || ws.status === "archived" || ws.status === "running"}>
            <IconArchive size={14} /> Archive
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void act("run")}
            disabled={props.halted || acting !== null || ws.status === "running" || ws.status === "archived"}
          >
            <IconPlay size={13} /> {acting === "run" ? "Starting..." : ws.status === "completed" || ws.status === "failed" ? "Run again" : "Run"}
          </button>
        </footer>
      ) : null}

      {confirmUndo && ws ? (
        <ConfirmDialog
          title="Undo writes"
          confirmLabel="Undo writes"
          onCancel={() => setConfirmUndo(false)}
          onConfirm={() => {
            setConfirmUndo(false);
            void act("undo");
          }}
        >
          Restore every project file this workspace changed, newest first, from the action journal. Files changed since the
          write are skipped.
        </ConfirmDialog>
      ) : null}
    </aside>
  );
}

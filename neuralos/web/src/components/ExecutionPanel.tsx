import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useDebouncedCallback } from "../hooks";
import { LIFECYCLE } from "../labels";
import type { AgentInstance, AgentState, Finding, KernelEvent, PlanStep, Workspace, WorkspaceDetail } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconAlert, IconArchive, IconFile, IconPlay, IconRefresh, IconUndo } from "./Icons";

interface Props {
  workspaceId: string | null;
  workspaces: Workspace[];
  onSelect: (id: string) => void;
  agentName: (id: string) => string;
  onOpenFile: (path: string) => void;
  onToast: (message: string, tone?: "ok" | "error") => void;
  onEvent: (l: (ev: KernelEvent) => void) => () => void;
  halted: boolean;
}

type StepStatus = "done" | "running" | "failed" | "pending";

const SEVERITY_ORDER: Finding["severity"][] = ["critical", "high", "medium", "low", "info"];

function stepStatus(step: PlanStep, ws: Workspace, instances: AgentInstance[]): StepStatus {
  if (ws.checkpoint?.completedSteps?.[step.id]) return "done";
  const mine = instances.filter((i) => i.agentId === step.agent);
  if (mine.some((i) => i.state === "active" || i.state === "collaborating" || i.state === "summoned")) return ws.status === "running" ? "running" : "pending";
  if (mine.some((i) => i.state === "failed" || i.state === "terminated")) return "failed";
  if (mine.some((i) => i.state === "completed" || i.state === "archived")) return "done";
  return "pending";
}

/** Swarm lifecycle stage (index into LIFECYCLE) from the instance states. */
function lifecycleStage(ws: Workspace, instances: AgentInstance[]): number {
  if (ws.status === "archived") return 5;
  if (!instances.length) return 0;
  const has = (s: AgentState) => instances.some((i) => i.state === s);
  if (has("collaborating")) return 3;
  if (has("active")) return 2;
  if (has("summoned")) return 1;
  if (instances.every((i) => ["completed", "failed", "terminated", "archived"].includes(i.state))) return 4;
  return 1;
}

export function ExecutionPanel(props: Props) {
  const { workspaceId, onEvent, onToast } = props;
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    try {
      const d = await api.workspace(workspaceId, c.signal);
      setDetail(d);
      setError(null);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      if (ctl.current === c) setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    setDetail(null);
    setError(null);
    if (!workspaceId) return;
    setLoading(true);
    void load();
    return () => ctl.current?.abort();
  }, [workspaceId, load]);

  const refresh = useDebouncedCallback(() => void load(), 350);
  useEffect(
    () =>
      onEvent((ev) => {
        if (!workspaceId) return;
        const d = (ev.data ?? {}) as Record<string, unknown>;
        if (
          ev.correlationId === workspaceId ||
          d.workspaceId === workspaceId ||
          (ev.type.startsWith("workspace.") && JSON.stringify(ev.data ?? {}).includes(workspaceId))
        )
          refresh();
      }),
    [onEvent, workspaceId, refresh],
  );

  if (!workspaceId) {
    const recent = props.workspaces.filter((w) => w.status !== "archived").slice(-5).reverse();
    return (
      <section className="exec" aria-labelledby="exec-title">
        <div className="exec-head">
          <h2 id="exec-title" className="serif-title">
            Execution
          </h2>
        </div>
        <p className="muted">No workspace selected. State an intent below, or pick a recent workspace.</p>
        {recent.length ? (
          <ul className="plain-list">
            {recent.map((w) => (
              <li key={w.id}>
                <button type="button" className="list-btn" onClick={() => props.onSelect(w.id)}>
                  <span>{w.label}</span>
                  <span className={`badge st-${w.status}`}>{w.status}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    );
  }

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

  const stage = ws ? lifecycleStage(ws, instances) : 0;
  const latestByAgent = new Map<string, AgentInstance>();
  for (const i of instances) {
    const prev = latestByAgent.get(i.agentId);
    if (!prev || (i.startedAt ?? "") >= (prev.startedAt ?? "")) latestByAgent.set(i.agentId, i);
  }
  const findings = [...(ws?.report?.findings ?? [])].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );

  return (
    <section className="exec" aria-labelledby="exec-title" aria-busy={loading || undefined}>
      <div className="exec-head">
        <h2 id="exec-title" className="serif-title">
          Execution
        </h2>
        {ws ? <span className="id-tag mono">{ws.intent}</span> : null}
      </div>

      {error ? (
        <div className="inline-error" role="alert">
          <IconAlert size={15} /> {error}
          <button type="button" className="btn btn-sm" onClick={() => void load()}>
            <IconRefresh size={13} /> Retry
          </button>
        </div>
      ) : null}
      {!ws && !error ? <p className="muted">Loading workspace...</p> : null}

      {ws ? (
        <>
          <div className="exec-status-row">
            <span className={`badge st-${ws.status}`}>{ws.status}</span>
            <span className="mono muted">{ws.id}</span>
            <span className="mono muted">priority {ws.priority}</span>
          </div>

          <section className="exec-sec">
            <h3>Intent</h3>
            <p className="exec-intent">&ldquo;{ws.text}&rdquo;</p>
          </section>

          <section className="exec-sec">
            <h3>Agents</h3>
            <div className="chips">
              {ws.agents.map((a) => {
                const inst = latestByAgent.get(a);
                const st = inst?.state ?? "dormant";
                return (
                  <span key={a} className="chip chip-agent" title={inst?.task ?? undefined}>
                    <span className="dia" aria-hidden="true" />
                    {props.agentName(a)}
                    <span className={`state-badge st-${st}`}>{st}</span>
                  </span>
                );
              })}
            </div>
          </section>

          <section className="exec-sec">
            <h3>Tools</h3>
            {ws.tools.length ? (
              <div className="chips">
                {ws.tools.map((t) => (
                  <span key={t} className="chip chip-tool">
                    <span className="hexdot" aria-hidden="true" />
                    <span className="mono">{t}</span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="muted">No tools required.</p>
            )}
          </section>

          <section className="exec-sec">
            <h3>Workspace</h3>
            {ws.files.length ? (
              <ul className="file-list">
                {ws.files.map((f) => (
                  <li key={f}>
                    <button type="button" className="link-btn mono" onClick={() => props.onOpenFile(f)}>
                      <IconFile size={13} /> {f}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No files assembled.</p>
            )}
            {ws.resources.length ? <p className="exec-resources">{ws.resources.join(" · ")}</p> : null}
          </section>

          <section className="exec-sec">
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

          <section className="exec-sec">
            <h3>Output</h3>
            {ws.error ? (
              <p className="inline-error" role="alert">
                {ws.error}
              </p>
            ) : null}
            {ws.report ? (
              <>
                <p className="exec-summary">{ws.report.summary}</p>
                {findings.length ? (
                  <ol className="findings">
                    {findings.map((f, i) => (
                      <li key={i} className={`finding sev-${f.severity}`}>
                        <span className={`sev sev-${f.severity}`}>{f.severity}</span>
                        <span className="finding-body">
                          <span className="finding-title">{f.title}</span>
                          {f.file ? (
                            <button type="button" className="link-btn mono" onClick={() => props.onOpenFile(f.file!)}>
                              {f.file}
                              {f.line ? `:${f.line}` : ""}
                            </button>
                          ) : null}
                          <span className="finding-detail">{f.detail}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="muted">No findings.</p>
                )}
                {ws.report.conflicts.length ? (
                  <div className="conflicts">
                    <h4>Conflicts</h4>
                    <ul>
                      {ws.report.conflicts.map((c, i) => (
                        <li key={i}>
                          <strong>{c.topic}</strong> <span className="muted">({c.agents.map(props.agentName).join(", ")})</span>: {c.resolution}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {ws.report.artifactPath ? (
                  <button type="button" className="link-btn report-link" onClick={() => props.onOpenFile(ws.report!.artifactPath!)}>
                    <IconFile size={14} /> Open report <span className="mono">{ws.report.artifactPath}</span>
                  </button>
                ) : null}
              </>
            ) : ws.error ? null : (
              <p className="muted">{ws.status === "running" ? "The swarm is working. The Commander merges the outputs when every step is done." : "No output yet. Run the workspace to produce one."}</p>
            )}
          </section>

          <section className="exec-sec lifecycle">
            <div className="lifecycle-head">
              <div>
                <h3>Swarm lifecycle</h3>
                <span className="lifecycle-name">
                  {LIFECYCLE[stage].charAt(0).toUpperCase() + LIFECYCLE[stage].slice(1)}{" "}
                  <span className="muted">
                    · step {stage + 1} of {LIFECYCLE.length}
                  </span>
                </span>
              </div>
            </div>
            <div className="lifecycle-bars" role="img" aria-label={`Lifecycle stage ${stage + 1} of ${LIFECYCLE.length}: ${LIFECYCLE[stage]}`}>
              {LIFECYCLE.map((s, i) => (
                <span key={s} className={i <= stage ? "on" : ""} />
              ))}
            </div>
            <div className="exec-actions">
              <button
                type="button"
                className="btn"
                onClick={() => void act("run")}
                disabled={props.halted || acting !== null || ws.status === "running" || ws.status === "archived"}
              >
                <IconPlay size={14} /> {acting === "run" ? "Starting..." : ws.status === "completed" || ws.status === "failed" ? "Run again" : "Run"}
              </button>
              <button type="button" className="btn" onClick={() => void act("archive")} disabled={acting !== null || ws.status === "archived" || ws.status === "running"}>
                <IconArchive size={14} /> Archive
              </button>
              <button type="button" className="btn" onClick={() => setConfirmUndo(true)} disabled={acting !== null}>
                <IconUndo size={14} /> Undo writes
              </button>
            </div>
          </section>
        </>
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
    </section>
  );
}

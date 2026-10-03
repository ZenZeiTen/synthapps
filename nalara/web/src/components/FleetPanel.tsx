import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useDebouncedCallback } from "../hooks";
import type { FleetNode, FleetTree, KernelEvent, RelayMessage, StepReview, Verdict } from "../types";
import { SidePanel } from "./SidePanel";

interface Props {
  workspaceId: string;
  label?: string;
  agentName: (id: string) => string;
  onOpenFile: (path: string, line?: number) => void;
  onEvent: (l: (ev: KernelEvent) => void) => () => void;
  onClose: () => void;
}

const VERDICT_CLASS: Record<Verdict, string> = { survived: "badge-green", unresolved: "badge-red", unreviewed: "badge-amber" };
const RELAY_SHOWN = 60;
const REFRESH_ON = new Set(["agent.state", "agent.summoned", "relay.message", "review.verdict", "review.round", "workspace.completed", "workspace.failed"]);

type Tree = FleetTree & { reviews: StepReview[] };

/** The workspace's process tree: who spawned whom, builders against critics, rounds, verdicts and the relayed messages. */
export function FleetPanel({ workspaceId, label, agentName, onOpenFile, onEvent, onClose }: Props) {
  const [tree, setTree] = useState<Tree | null>(null);
  const [messages, setMessages] = useState<RelayMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    try {
      const [t, m] = await Promise.all([api.fleetTree(workspaceId, c.signal), api.relay({ workspaceId, limit: 5000 }, c.signal)]);
      setTree(t);
      setMessages(m.slice(-RELAY_SHOWN).reverse());
      setError(null);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    }
  }, [workspaceId]);

  const refresh = useDebouncedCallback(() => void load(), 400);
  useEffect(() => {
    void load();
    return () => ctl.current?.abort();
  }, [load]);
  useEffect(
    () =>
      onEvent((ev) => {
        if (ev.correlationId === workspaceId && REFRESH_ON.has(ev.type)) refresh();
      }),
    [onEvent, workspaceId, refresh],
  );

  const children = new Map<string, FleetNode[]>();
  for (const e of tree?.edges ?? []) {
    const child = tree!.nodes.find((n) => n.instanceId === e.child);
    if (child) children.set(e.parent, [...(children.get(e.parent) ?? []), child]);
  }

  const renderNode = (n: FleetNode, depth: number) => (
    <li key={n.instanceId} className="fleet-node" style={{ ["--depth" as string]: depth }}>
      <div className="fleet-row">
        <span className={`badge role-${n.role}`}>{n.role}</span>
        <span className="fleet-name">{agentName(n.agentId)}</span>
        {n.stepId ? <span className="mono small muted">{n.stepId}</span> : null}
        {n.round ? <span className="mono small muted">r{n.round}</span> : null}
        <span className={`badge st-${n.state}`}>{n.state}</span>
      </div>
      {n.summary ? <p className="fleet-summary muted">{n.summary}</p> : null}
      <p className="fleet-meta mono small muted">
        {n.instanceId} · {n.usage.toolCalls} call(s) · {n.usage.inputTokens + n.usage.outputTokens} tokens
      </p>
      {children.get(n.instanceId)?.length ? <ul className="fleet-children">{children.get(n.instanceId)!.map((k) => renderNode(k, depth + 1))}</ul> : null}
    </li>
  );

  return (
    <SidePanel title="Fleet" subtitle={`${label ?? workspaceId}: process tree, adversarial review and relay.`} onClose={onClose}>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {!tree && !error ? <p className="muted">Loading the process tree...</p> : null}
      {tree ? (
        <>
          <section className="panel-sec" aria-label="Adversarial review">
            <h3>Adversarial review</h3>
            {tree.reviews.length ? (
              <ul className="review-list">
                {tree.reviews.map((r) => (
                  <li key={r.stepId} className="review">
                    <div className="fleet-row">
                      <span className="mono small">{r.stepId}</span>
                      <span>
                        {agentName(r.builderId)} vs {r.critics.map(agentName).join(", ")}
                      </span>
                      <span className={`badge ${VERDICT_CLASS[r.verdict]}`}>{r.verdict}</span>
                    </div>
                    <p className="muted small">
                      {r.rounds} round(s). {r.reason}
                    </p>
                    {r.open.length ? (
                      <ul className="open-challenges">
                        {r.open.map((c, i) => (
                          <li key={i} className={`finding sev-${c.finding.severity}`}>
                            <span className={`sev sev-${c.finding.severity}`}>{c.finding.severity}</span> {c.finding.title}{" "}
                            {c.finding.file ? (
                              <button type="button" className="link-btn mono" onClick={() => onOpenFile(c.finding.file!, c.finding.line)}>
                                {c.finding.file}
                                {c.finding.line ? `:${c.finding.line}` : ""}
                              </button>
                            ) : null}{" "}
                            <span className="muted small">
                              by {agentName(c.criticId)}, evidence {c.evidence}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No builder step was reviewed in this workspace.</p>
            )}
          </section>

          <section className="panel-sec" aria-label="Process tree">
            <h3>Process tree ({tree.nodes.length})</h3>
            {tree.nodes.length ? (
              <ul className="fleet-tree">{tree.roots.map((id) => tree.nodes.find((n) => n.instanceId === id)).filter((n): n is FleetNode => Boolean(n)).map((n) => renderNode(n, 0))}</ul>
            ) : (
              <p className="muted">No agents have run in this workspace yet.</p>
            )}
          </section>

          <section className="panel-sec" aria-label="Relay">
            <h3>Relay ({messages.length ? `latest ${messages.length}` : "empty"})</h3>
            <ol className="relay-log">
              {messages.map((m) => (
                <li key={m.id} className={`relay-msg relay-${m.kind}`}>
                  <div className="fleet-row">
                    <span className="badge">{m.kind}</span>
                    <span className="mono small">
                      {m.from.replace(/^agent:/, "")} → {m.to.replace(/^agent:/, "")}
                    </span>
                    {m.round ? <span className="mono small muted">r{m.round}</span> : null}
                  </div>
                  {m.body ? <p className="relay-body muted small">{m.body.length > 240 ? `${m.body.slice(0, 240)}…` : m.body}</p> : null}
                </li>
              ))}
            </ol>
          </section>
        </>
      ) : null}
    </SidePanel>
  );
}

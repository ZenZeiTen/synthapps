import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useDebouncedCallback } from "../hooks";
import type { KernelEvent, Observatory, WorkQueue } from "../types";
import { SidePanel } from "./SidePanel";

interface Props {
  agentName: (id: string) => string;
  onOpenFleet: (workspaceId: string) => void;
  onEvent: (l: (ev: KernelEvent) => void) => () => void;
  onClose: () => void;
}

const REFRESH_ON = new Set(["agent.state", "agent.finished", "agent.failed", "relay.message", "review.verdict", "budget.exceeded", "workspace.completed", "workspace.failed", "tool.approval_requested", "tool.approval_resolved"]);

function tokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** Telemetry for everything running: every fleet, every agent, usage and burn, plus the work queue. */
export function ObservatoryPanel({ agentName, onOpenFleet, onEvent, onClose }: Props) {
  const [obs, setObs] = useState<Observatory | null>(null);
  const [queue, setQueue] = useState<WorkQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    try {
      const [o, q] = await Promise.all([api.observatory(c.signal), api.queue(c.signal)]);
      setObs(o);
      setQueue(q);
      setError(null);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    }
  }, []);
  const refresh = useDebouncedCallback(() => void load(), 600);
  useEffect(() => {
    void load();
    return () => ctl.current?.abort();
  }, [load]);
  useEffect(() => onEvent((ev) => (REFRESH_ON.has(ev.type) ? refresh() : undefined)), [onEvent, refresh]);

  return (
    <SidePanel title="Observatory" subtitle="Usage and burn for every fleet and agent, and the work queue." onClose={onClose} wide>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {!obs && !error ? <p className="muted">Loading telemetry...</p> : null}
      {obs ? (
        <>
          <section className="panel-sec" aria-label="Totals">
            <h3>Totals</h3>
            <dl className="kv kv-inline">
              <dt>Fleets</dt>
              <dd className="mono">{obs.totals.workspaces}</dd>
              <dt>Agent runs</dt>
              <dd className="mono">{obs.totals.agents}</dd>
              <dt>Tokens</dt>
              <dd className="mono">
                {tokens(obs.totals.inputTokens)} in / {tokens(obs.totals.outputTokens)} out
              </dd>
              <dt>Tool calls</dt>
              <dd className="mono">{obs.totals.toolCalls}</dd>
              <dt>Relay</dt>
              <dd className="mono">{obs.totals.messages} msgs</dd>
              <dt>Lanes</dt>
              <dd className="mono">
                {obs.governor.running}/{obs.governor.lanes}, {obs.governor.queued} queued
              </dd>
            </dl>
            <p className="muted small">
              Fleet budget per run: {obs.fleetBudget.maxAgents} agents, {tokens(obs.fleetBudget.maxInputTokens)} / {tokens(obs.fleetBudget.maxOutputTokens)} tokens, {obs.fleetBudget.maxToolCalls} tool calls,{" "}
              {obs.fleetBudget.maxMessages} messages.
            </p>
          </section>

          {queue ? (
            <section className="panel-sec" aria-label="Work queue">
              <h3>Work queue</h3>
              <p className="muted small">
                {queue.approvals.length} approval(s) waiting · {queue.running.length} agent(s) running · {queue.admission.queued} waiting for a lane · {queue.workspaces.length} workspace(s) ready or running
              </p>
              {queue.running.length ? (
                <ul className="queue-list">
                  {queue.running.map((r) => (
                    <li key={r.instanceId} className="fleet-row">
                      <span className={`badge st-${r.state}`}>{r.state}</span>
                      <span>{agentName(r.agentId)}</span>
                      <span className="mono small muted">
                        {r.role ?? "worker"}
                        {r.stepId ? ` ${r.stepId}` : ""}
                        {r.round ? ` r${r.round}` : ""}
                      </span>
                      <span className="mono small muted">owner {r.owner}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          <section className="panel-sec" aria-label="Fleets">
            <h3>Fleets</h3>
            {obs.workspaces.length ? (
              <div className="table-wrap">
                <table className="audit">
                  <thead>
                    <tr>
                      <th scope="col">Workspace</th>
                      <th scope="col">Status</th>
                      <th scope="col">Agents</th>
                      <th scope="col">Tokens</th>
                      <th scope="col">Calls</th>
                      <th scope="col">Msgs</th>
                      <th scope="col">Reviews</th>
                    </tr>
                  </thead>
                  <tbody>
                    {obs.workspaces.map((w) => (
                      <tr key={w.workspaceId}>
                        <td>
                          <button type="button" className="link-btn" onClick={() => onOpenFleet(w.workspaceId)} title={`Open the process tree of ${w.workspaceId}`}>
                            {w.label}
                          </button>
                          {w.fleet?.exceeded ? <span className="badge badge-red">budget: {w.fleet.exceeded}</span> : null}
                        </td>
                        <td>
                          <span className={`badge st-${w.status}`}>{w.status}</span>
                        </td>
                        <td className="mono">{w.agents}</td>
                        <td className="mono">{tokens(w.usage.inputTokens + w.usage.outputTokens)}</td>
                        <td className="mono">{w.usage.toolCalls}</td>
                        <td className="mono">{w.messages}</td>
                        <td className="mono small">
                          {w.reviews.survived}✓ {w.reviews.unresolved}✗ {w.reviews.unreviewed}–
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">No fleets have run yet.</p>
            )}
          </section>

          <section className="panel-sec" aria-label="Agents">
            <h3>Agents</h3>
            {obs.agents.length ? (
              <div className="table-wrap">
                <table className="audit">
                  <thead>
                    <tr>
                      <th scope="col">Agent</th>
                      <th scope="col">Runs</th>
                      <th scope="col">Failed</th>
                      <th scope="col">Tokens</th>
                      <th scope="col">Calls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {obs.agents.map((a) => (
                      <tr key={a.agentId}>
                        <td>{agentName(a.agentId)}</td>
                        <td className="mono">{a.runs}</td>
                        <td className="mono">{a.failures}</td>
                        <td className="mono">{tokens(a.usage.inputTokens + a.usage.outputTokens)}</td>
                        <td className="mono">{a.usage.toolCalls}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">No agent has run yet.</p>
            )}
          </section>
        </>
      ) : null}
    </SidePanel>
  );
}

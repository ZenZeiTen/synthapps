import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import type { AuditEntry, GovernorSnapshot, KernelEvent, KernelStatus, McpServerStatus, ToolPolicy, TriggerRule } from "../types";
import { SidePanel } from "./SidePanel";
import { IconEvents, IconRefresh, IconShield } from "./Icons";

interface Props {
  status: KernelStatus | null;
  onClose: () => void;
  onToast: (message: string, tone?: "ok" | "error") => void;
  onEvent: (l: (ev: KernelEvent) => void) => () => void;
  onStatusChanged: () => void;
  onOpenEvents: () => void;
}

const POLICY_HELP: Record<ToolPolicy["mode"], string> = {
  auto: "Reversible and compensable calls run; irreversible calls still ask.",
  ask: "Compensable and irreversible calls ask for approval.",
  readonly: "Only reversible read and search tools run.",
};

export function SettingsPanel({ status, onClose, onToast, onEvent, onStatusChanged, onOpenEvents }: Props) {
  const [policy, setPolicy] = useState<ToolPolicy | null>(null);
  const [mcp, setMcp] = useState<McpServerStatus[] | null>(null);
  const [triggers, setTriggers] = useState<TriggerRule[] | null>(null);
  const [governor, setGovernor] = useState<GovernorSnapshot | null>(null);
  const [audit, setAudit] = useState<{ entries: AuditEntry[]; chainBrokenAt: number | null } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ name: "", command: "", args: "" });
  const [busy, setBusy] = useState<string | null>(null);

  const guard = useCallback(async <T,>(key: string, fn: () => Promise<T>, set: (v: T) => void) => {
    try {
      set(await fn());
      setErrors((e) => {
        const { [key]: _drop, ...rest } = e;
        void _drop;
        return rest;
      });
    } catch (err) {
      setErrors((e) => ({ ...e, [key]: (err as Error).message }));
    }
  }, []);

  const loadAll = useCallback(() => {
    void guard("policy", api.policy, setPolicy);
    void guard("mcp", api.mcp, setMcp);
    void guard("triggers", api.triggers, setTriggers);
    void guard("governor", api.governor, setGovernor);
    void guard("audit", () => api.audit({ limit: 40 }), setAudit);
  }, [guard]);

  useEffect(() => loadAll(), [loadAll]);
  useEffect(
    () =>
      onEvent((ev) => {
        if (ev.type.startsWith("mcp.")) void guard("mcp", api.mcp, setMcp);
        if (ev.type.startsWith("tool.") || ev.type.startsWith("kernel.")) void guard("audit", () => api.audit({ limit: 40 }), setAudit);
      }),
    [onEvent, guard],
  );

  const changeMode = async (mode: ToolPolicy["mode"]) => {
    if (!policy || policy.mode === mode) return;
    setBusy("policy");
    try {
      setPolicy(await api.setPolicy({ ...policy, mode }));
      onToast(`Tool policy set to ${mode}`);
      onStatusChanged();
    } catch (err) {
      onToast(`Policy change failed: ${(err as Error).message}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const toggleTrigger = async (t: TriggerRule) => {
    setBusy(t.id);
    try {
      const next = await api.setTrigger(t.id, !t.enabled);
      setTriggers((list) => (list ?? []).map((x) => (x.id === t.id ? next : x)));
    } catch (err) {
      onToast(`Trigger update failed: ${(err as Error).message}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    const command = form.command.trim();
    if (!name || !command) return;
    setBusy("connect");
    try {
      const args = form.args.match(/"[^"]*"|\S+/g)?.map((a) => a.replace(/^"|"$/g, "")) ?? [];
      const st = await api.connectMcp(name, { command, args });
      onToast(st.status === "error" ? `MCP ${name}: ${st.error ?? "error"}` : `MCP ${name} ${st.status}`, st.status === "error" ? "error" : "ok");
      setForm({ name: "", command: "", args: "" });
      void guard("mcp", api.mcp, setMcp);
    } catch (err) {
      onToast(`Connect failed: ${(err as Error).message}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (name: string) => {
    setBusy(`mcp:${name}`);
    try {
      await api.disconnectMcp(name);
      onToast(`Disconnected ${name}`);
      void guard("mcp", api.mcp, setMcp);
    } catch (err) {
      onToast(`Disconnect failed: ${(err as Error).message}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const err = (k: string) =>
    errors[k] ? (
      <p className="inline-error" role="alert">
        {errors[k]}
      </p>
    ) : null;

  return (
    <SidePanel title="Settings" subtitle="Kernel, tool policy, MCP servers, triggers and the audit ledger." onClose={onClose} wide>
      <section className="panel-sec">
        <div className="row between">
          <h3>Kernel</h3>
          <button type="button" className="icon-btn" aria-label="Reload settings" onClick={loadAll}>
            <IconRefresh size={15} />
          </button>
        </div>
        <button type="button" className="btn btn-sm events-link" onClick={onOpenEvents}>
          <IconEvents size={14} /> Open the event log
        </button>
        {status ? (
          <dl className="kv">
            <dt>Mode</dt>
            <dd>
              <span className={`badge ${status.mode === "claude" ? "badge-accent" : ""}`}>{status.mode}</span>
            </dd>
            <dt>Model</dt>
            <dd className="mono">{status.model}</dd>
            <dt>Version</dt>
            <dd className="mono">{status.version}</dd>
            <dt>Root</dt>
            <dd className="mono wrap">{status.root}</dd>
            <dt>Graph</dt>
            <dd>
              {status.graph.nodes} nodes, {status.graph.edges} edges, {status.files} files indexed
            </dd>
            <dt>Agents</dt>
            <dd>
              {status.agents.catalog} in catalog, {status.agents.running} running
            </dd>
            <dt>Workspaces</dt>
            <dd>
              {status.workspaces.total} total, {status.workspaces.running} running
            </dd>
            <dt>Halted</dt>
            <dd>{status.halted ? <span className="badge badge-red">halted</span> : "no"}</dd>
          </dl>
        ) : (
          <p className="muted">Kernel status unavailable.</p>
        )}
      </section>

      <section className="panel-sec">
        <h3>Tool policy</h3>
        {err("policy")}
        {policy ? (
          <fieldset className="radio-group" disabled={busy === "policy"}>
            <legend className="sr-only">Tool policy mode</legend>
            {(["auto", "ask", "readonly"] as const).map((m) => (
              <label key={m} className={`radio${policy.mode === m ? " on" : ""}`}>
                <input type="radio" name="policy-mode" value={m} checked={policy.mode === m} onChange={() => void changeMode(m)} />
                <span className="mono">{m}</span>
                <span className="muted small">{POLICY_HELP[m]}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {policy && (policy.allow?.length || policy.deny?.length) ? (
          <p className="small muted">
            {policy.allow?.length ? `Allow: ${policy.allow.join(", ")}. ` : ""}
            {policy.deny?.length ? `Deny: ${policy.deny.join(", ")}.` : ""}
          </p>
        ) : null}
      </section>

      <section className="panel-sec">
        <h3>MCP servers</h3>
        {err("mcp")}
        {mcp && mcp.length === 0 ? <p className="muted">No MCP servers connected.</p> : null}
        {mcp && mcp.length ? (
          <ul className="plain-list mcp-list">
            {mcp.map((s) => (
              <li key={s.name} className="mcp-item">
                <span className="hexdot" aria-hidden="true" />
                <span className="mcp-name">{s.name}</span>
                <span className={`badge mcp-${s.status}`}>{s.status}</span>
                <span className="muted small">
                  {s.transport} · {s.tools.length} tools
                </span>
                {s.changedTools?.length ? <span className="badge badge-red">{s.changedTools.length} changed</span> : null}
                <button type="button" className="btn btn-sm" disabled={busy === `mcp:${s.name}`} onClick={() => void disconnect(s.name)} aria-label={`Disconnect ${s.name}`}>
                  Disconnect
                </button>
                {s.error ? <span className="inline-error small full">{s.error}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        <form className="form mcp-form" onSubmit={connect}>
          <div className="row gap">
            <label className="field grow">
              <span className="field-label">Name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="github" required />
            </label>
            <label className="field grow">
              <span className="field-label">Command</span>
              <input value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} placeholder="npx" required />
            </label>
          </div>
          <label className="field">
            <span className="field-label">Arguments</span>
            <input value={form.args} onChange={(e) => setForm({ ...form, args: e.target.value })} placeholder="-y @modelcontextprotocol/server-github" />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy === "connect" || !form.name.trim() || !form.command.trim()}>
            {busy === "connect" ? "Connecting..." : "Connect server"}
          </button>
        </form>
      </section>

      <section className="panel-sec">
        <h3>Trigger rules</h3>
        {err("triggers")}
        {triggers && triggers.length === 0 ? <p className="muted">No trigger rules.</p> : null}
        <ul className="plain-list">
          {(triggers ?? []).map((t) => (
            <li key={t.id} className="trigger">
              <label className="toggle">
                <input type="checkbox" checked={t.enabled} disabled={busy === t.id} onChange={() => void toggleTrigger(t)} />
                <span className="toggle-track" aria-hidden="true" />
                <span className="trigger-name">{t.name}</span>
              </label>
              <span className="mono small muted">
                on {t.on}
                {t.when?.pathGlob ? ` ${t.when.pathGlob}` : ""}
                {t.when?.agentId ? ` agent=${t.when.agentId}` : ""} &rarr;{" "}
                {t.then.kind === "run_agent" ? `run ${t.then.agentId}` : t.then.kind === "emit" ? `emit ${t.then.type}` : `intent "${t.then.text}"`}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel-sec">
        <h3>Governor</h3>
        {err("governor")}
        {governor ? (
          <dl className="kv kv-inline">
            <dt>Lanes</dt>
            <dd className="mono">
              {governor.lanes} / {governor.maxLanes}
            </dd>
            <dt>Running</dt>
            <dd className="mono">{governor.running}</dd>
            <dt>Queued</dt>
            <dd className="mono">{governor.queued}</dd>
            <dt>Circuit</dt>
            <dd>
              <span className={`badge ${governor.circuit === "closed" ? "badge-green" : "badge-red"}`}>{governor.circuit}</span>
            </dd>
          </dl>
        ) : null}
      </section>

      <section className="panel-sec">
        <h3>
          <IconShield size={14} /> Audit ledger
        </h3>
        {err("audit")}
        {audit ? (
          <>
            <p className={audit.chainBrokenAt === null ? "chain-ok" : "inline-error"} role="status">
              {audit.chainBrokenAt === null ? "Hash chain intact" : `Hash chain broken at entry #${audit.chainBrokenAt}`}
            </p>
            {audit.entries.length === 0 ? (
              <p className="muted">No audit entries.</p>
            ) : (
              <div className="table-wrap">
                <table className="audit">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Time</th>
                      <th scope="col">Kind</th>
                      <th scope="col">Subject</th>
                      <th scope="col">Outcome</th>
                      <th scope="col">Principal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...audit.entries].reverse().map((a) => (
                      <tr key={a.seq}>
                        <td className="mono">{a.seq}</td>
                        <td className="mono">{new Date(a.ts).toLocaleTimeString()}</td>
                        <td>{a.kind}</td>
                        <td className="mono">{a.subject}</td>
                        <td>
                          <span className={`outcome oc-${a.outcome}`}>{a.outcome}</span>
                        </td>
                        <td className="mono small">{a.principal?.chain.join(" > ") ?? "platform"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </section>
    </SidePanel>
  );
}

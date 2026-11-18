import { useState, type FormEvent } from "react";
import { api } from "../api";
import type { AgentDefinition, AgentInstance, GraphSlice, Workspace } from "../types";
import { BRAND } from "../brand";
import { SidePanel } from "./SidePanel";
import { IconAgent, IconProject } from "./Icons";

// ---------------------------------------------------------------------------------------------------------
// Agents: the catalog, grouped, with live state and a direct run form.

const GROUPS: AgentDefinition["group"][] = ["system", "engineering", "creative", "business"];

export function AgentsPanel({
  agents,
  instances,
  onClose,
  onFocus,
  onToast,
  halted,
}: {
  agents: AgentDefinition[] | null;
  instances: AgentInstance[];
  onClose: () => void;
  onFocus: (agentId: string) => void;
  onToast: (m: string, tone?: "ok" | "error") => void;
  halted: boolean;
}) {
  const [runFor, setRunFor] = useState<string | null>(null);
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const running = (id: string) => instances.filter((i) => i.agentId === id && (i.state === "active" || i.state === "collaborating")).length;

  const submit = async (e: FormEvent, a: AgentDefinition) => {
    e.preventDefault();
    if (!task.trim()) return;
    setBusy(true);
    try {
      const { instance } = await api.runAgent(a.id, { task: task.trim() });
      onToast(`${a.name} started (${instance.instanceId})`);
      setRunFor(null);
      setTask("");
    } catch (err) {
      onToast(`Run failed: ${(err as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel title="Agents" subtitle={`Specialists ${BRAND} can summon into a swarm.`} onClose={onClose}>
      {!agents ? <p className="muted">Loading the agent catalog...</p> : null}
      {agents && agents.length === 0 ? <p className="muted">The catalog is empty.</p> : null}
      {GROUPS.map((g) => {
        const list = (agents ?? []).filter((a) => a.group === g);
        if (!list.length) return null;
        return (
          <section key={g} className="panel-sec">
            <h3>{g}</h3>
            <ul className="plain-list">
              {list.map((a) => (
                <li key={a.id} className="agent-card">
                  <div className="agent-card-top">
                    <IconAgent size={14} className="accent" />
                    <button type="button" className="link-btn agent-name" onClick={() => onFocus(a.id)} aria-label={`${a.name}: open agent actions`}>
                      {a.name}
                    </button>
                    {running(a.id) ? <span className="badge badge-amber">{running(a.id)} running</span> : null}
                    <button
                      type="button"
                      className="btn btn-sm"
                      aria-expanded={runFor === a.id}
                      disabled={halted}
                      onClick={() => {
                        setRunFor(runFor === a.id ? null : a.id);
                        setTask("");
                      }}
                    >
                      Run
                    </button>
                  </div>
                  <p className="small agent-role">{a.role}</p>
                  {runFor === a.id ? (
                    <form className="row gap" onSubmit={(e) => void submit(e, a)}>
                      <label className="sr-only" htmlFor={`task-${a.id}`}>
                        Task for {a.name}
                      </label>
                      <input id={`task-${a.id}`} className="grow" value={task} onChange={(e) => setTask(e.target.value)} placeholder="What should it do?" autoFocus />
                      <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !task.trim()}>
                        Start
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </SidePanel>
  );
}

// ---------------------------------------------------------------------------------------------------------

/** Projects open in the Field view, focused on their node. */
export function ProjectsPanel({ graph, onClose, onFocus }: { graph: GraphSlice | null; onClose: () => void; onFocus: (nodeId: string) => void }) {
  const projects = (graph?.nodes ?? []).filter((n) => n.type === "project" || n.type === "repository");
  return (
    <SidePanel title="Projects" subtitle="Projects and repositories in the knowledge graph. Choose one to see it in the field." onClose={onClose}>
      {!graph ? <p className="muted">Loading...</p> : null}
      {graph && projects.length === 0 ? <p className="muted">No projects in the graph.</p> : null}
      <ul className="plain-list">
        {projects.map((p) => (
          <li key={p.id}>
            <button type="button" className="list-btn" onClick={() => onFocus(p.id)}>
              <IconProject size={15} />
              <span>{p.name}</span>
              <span className="mono muted small">{p.id}</span>
            </button>
          </li>
        ))}
      </ul>
    </SidePanel>
  );
}

export function AppsPanel({
  workspaces,
  selectedId,
  onClose,
  onSelect,
}: {
  workspaces: Workspace[] | null;
  selectedId: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const list = [...(workspaces ?? [])].reverse();
  return (
    <SidePanel title="Apps" subtitle="Workspaces: temporary manifestations of intent. Choose one to see its results." onClose={onClose}>
      {!workspaces ? <p className="muted">Loading...</p> : null}
      {workspaces && workspaces.length === 0 ? <p className="muted">No workspaces yet. State an intent to create one.</p> : null}
      <ul className="plain-list">
        {list.map((w) => (
          <li key={w.id}>
            <button type="button" className={`list-btn ws-item${w.id === selectedId ? " on" : ""}`} aria-current={w.id === selectedId || undefined} onClick={() => onSelect(w.id)}>
              <span className="ws-item-main">
                <span className="ws-item-label">{w.label}</span>
                <span className="muted small">&ldquo;{w.text}&rdquo;</span>
              </span>
              <span className={`badge st-${w.status}`}>{w.status}</span>
            </button>
          </li>
        ))}
      </ul>
    </SidePanel>
  );
}

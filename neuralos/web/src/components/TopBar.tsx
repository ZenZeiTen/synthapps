import type { ReactNode } from "react";
import type { AgentInstance, KernelStatus } from "../types";
import { IconShield } from "./Icons";

const SYSTEM_AGENTS: { id: string; label: string }[] = [
  { id: "commander", label: "Commander" },
  { id: "memory_agent", label: "Memory" },
  { id: "security_agent", label: "Security" },
  { id: "scheduler_agent", label: "Scheduler" },
  { id: "ux_agent", label: "UX" },
];

interface Props {
  status: KernelStatus | null;
  projectName: string;
  instances: AgentInstance[];
  pendingApprovals: number;
  killSwitch: ReactNode;
  onShowApprovals: () => void;
}

export function TopBar({ status, projectName, instances, pendingApprovals, killSwitch, onShowApprovals }: Props) {
  const stateOf = (id: string): "halted" | "working" | "idle" | "failed" => {
    if (status?.halted) return "halted";
    const mine = instances.filter((i) => i.agentId === id);
    if (mine.some((i) => i.state === "active" || i.state === "collaborating" || i.state === "summoned")) return "working";
    const last = mine.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""))[0];
    if (last?.state === "failed") return "failed";
    return "idle";
  };
  return (
    <header className="topbar">
      <div className="brand">
        <span className="wordmark">NeuralOS</span>
        <span className="crumb">Canvas / {projectName}</span>
      </div>
      <div className="sys-agents" role="group" aria-label="System agents">
        <span className="eyebrow">System agents</span>
        {SYSTEM_AGENTS.map((a) => {
          const st = stateOf(a.id);
          return (
            <span key={a.id} className={`sys-agent sa-${st}`} title={`${a.label} agent: ${st}`}>
              <span className="sys-dot" aria-hidden="true" />
              {a.label}
              <span className="sr-only">: {st}</span>
            </span>
          );
        })}
      </div>
      <div className="topbar-right">
        {status ? (
          <span className={`mode-badge mode-${status.mode}`} title={`Model ${status.model}`}>
            kernel: {status.mode}
            {status.mode === "claude" ? ` · ${status.model}` : ""}
          </span>
        ) : (
          <span className="mode-badge">kernel: unknown</span>
        )}
        <button
          type="button"
          className={`approvals-count${pendingApprovals ? " has" : ""}`}
          onClick={onShowApprovals}
          aria-label={`${pendingApprovals} pending approvals`}
          disabled={!pendingApprovals}
        >
          <IconShield size={14} />
          {pendingApprovals}
        </button>
        {killSwitch}
      </div>
    </header>
  );
}

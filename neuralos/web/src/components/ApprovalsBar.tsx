import { useState } from "react";
import { api } from "../api";
import type { ApprovalRequest } from "../types";
import { IconCheck, IconClose, IconShield } from "./Icons";

interface Props {
  approvals: ApprovalRequest[];
  onResolved: (a: ApprovalRequest) => void;
  onToast: (message: string, tone?: "ok" | "error") => void;
}

function preview(input: Record<string, unknown>): string {
  let s: string;
  try {
    s = JSON.stringify(input);
  } catch {
    s = String(input);
  }
  return s.length > 180 ? `${s.slice(0, 177)}...` : s;
}

export function ApprovalsBar({ approvals, onResolved, onToast }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!approvals.length) return null;

  const resolve = async (a: ApprovalRequest, approved: boolean) => {
    setBusy(a.id);
    try {
      const r = await api.resolveApproval(a.id, approved);
      onResolved(r);
      onToast(`${approved ? "Approved" : "Denied"} ${a.tool}`, approved ? "ok" : "error");
    } catch (err) {
      onToast(`Could not resolve approval: ${(err as Error).message}`, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="approvals" aria-labelledby="approvals-title" role="region">
      <h2 id="approvals-title" className="approvals-title">
        <IconShield size={15} />
        {approvals.length} pending approval{approvals.length === 1 ? "" : "s"}
      </h2>
      <ul className="approvals-list">
        {approvals.map((a) => (
          <li key={a.id} className="approval" data-approval-id={a.id}>
            <div className="approval-main">
              <span className="mono approval-tool">{a.tool}</span>
              <span className={`rev rev-${a.reversibility}`}>{a.reversibility}</span>
              <span className="badge">{a.action}</span>
              <span className="badge">scope: {a.scope}</span>
              <span className="approval-chain mono" title="Principal chain">
                {a.principal.chain.join(" > ")}
              </span>
            </div>
            <div className="approval-what">
              {a.detail ? <pre className="approval-detail">{a.detail}</pre> : null}
              <code className="approval-input" title={preview(a.input)}>
                {preview(a.input)}
              </code>
            </div>
            <div className="approval-actions">
              <button type="button" className="btn btn-sm btn-approve" disabled={busy === a.id} onClick={() => void resolve(a, true)} aria-label={`Approve ${a.tool}`}>
                <IconCheck size={14} /> Approve
              </button>
              <button type="button" className="btn btn-sm btn-deny" disabled={busy === a.id} onClick={() => void resolve(a, false)} aria-label={`Deny ${a.tool}`}>
                <IconClose size={14} /> Deny
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

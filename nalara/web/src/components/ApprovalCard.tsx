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

/**
 * A tool call waiting for the human, above the intent bar. It always shows what will actually happen (the tool's own
 * `detail`, e.g. the exact command), the reversibility class and the principal chain before Approve / Deny.
 */
export function ApprovalCard({ approvals, onResolved, onToast }: Props) {
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
    <section className="approval-card" aria-labelledby="approval-title" role="region">
      <h2 id="approval-title" className="approval-title">
        <IconShield size={13} />
        {approvals.length === 1 ? "Approval needed" : `${approvals.length} approvals needed`}
      </h2>
      <ul className="approval-list">
        {approvals.map((a) => (
          <li key={a.id} className="approval" data-approval-id={a.id}>
            <div className="approval-main">
              <span className="mono approval-tool">{a.tool}</span>
              <span className={`rev rev-${a.reversibility}`}>{a.reversibility}</span>
              <span className="badge">{a.action}</span>
              <span className="badge">scope: {a.scope}</span>
            </div>
            {a.detail ? <pre className="approval-detail">{a.detail}</pre> : null}
            {Object.keys(a.input ?? {}).length ? (
              <code className="approval-input" title={preview(a.input)}>
                {preview(a.input)}
              </code>
            ) : null}
            <div className="approval-foot">
              <span className="approval-chain mono" title="Principal chain: who is asking, from you down to the agent">
                {a.principal.chain.join(" > ")}
              </span>
              <span className="approval-actions">
                <button type="button" className="btn btn-sm btn-deny" disabled={busy === a.id} onClick={() => void resolve(a, false)} aria-label={`Deny ${a.tool}`}>
                  <IconClose size={13} /> Deny
                </button>
                <button type="button" className="btn btn-sm btn-approve" disabled={busy === a.id} onClick={() => void resolve(a, true)} aria-label={`Approve ${a.tool}`}>
                  <IconCheck size={13} /> Approve
                </button>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

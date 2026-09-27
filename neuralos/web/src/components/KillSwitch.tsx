import { useState } from "react";
import { api } from "../api";
import type { KernelStatus } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconPlay, IconStop } from "./Icons";

interface Props {
  halted: boolean;
  disabled?: boolean;
  onStatus: (s: KernelStatus) => void;
  onToast: (message: string, tone?: "ok" | "error") => void;
}

/** "Halt all agents" in the top bar. The halt reaches the kernel through the human-facing API only. */
export function KillSwitch({ halted, disabled, onStatus, onToast }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const halt = async () => {
    setBusy(true);
    try {
      onStatus(await api.halt(reason.trim() || "Halted from the canvas"));
      onToast("Kernel halted: agents terminated, non-read tools denied, triggers paused", "error");
      setConfirming(false);
      setReason("");
    } catch (err) {
      onToast(`Halt failed: ${(err as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  if (halted) return null;
  return (
    <>
      <button type="button" className="btn btn-sm btn-halt" disabled={disabled} onClick={() => setConfirming(true)}>
        <IconStop size={15} /> Halt all agents
      </button>
      {confirming ? (
        <ConfirmDialog
          title="Halt all agents?"
          confirmLabel={busy ? "Halting..." : "Halt now"}
          danger
          confirmDisabled={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void halt()}
        >
          <p>
            Every running agent is terminated, every non-read tool call is denied, pending approvals are denied and triggers
            pause until you resume.
          </p>
          <label className="field">
            <span className="field-label">Reason (recorded in the audit ledger)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you halting?" />
          </label>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

export function HaltBanner({ onStatus, onToast }: { onStatus: (s: KernelStatus) => void; onToast: Props["onToast"] }) {
  const [busy, setBusy] = useState(false);
  const resume = async () => {
    setBusy(true);
    try {
      onStatus(await api.resume());
      onToast("Kernel resumed");
    } catch (err) {
      onToast(`Resume failed: ${(err as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="halt-banner" role="alert">
      <IconStop size={18} />
      <span>
        <strong>Kernel halted.</strong> All agents are stopped, non-read tools are denied and triggers are paused.
      </span>
      <button type="button" className="btn btn-sm btn-resume" disabled={busy} onClick={() => void resume()}>
        <IconPlay size={14} /> {busy ? "Resuming..." : "Resume"}
      </button>
    </div>
  );
}

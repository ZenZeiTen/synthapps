import { useState } from "react";
import { api } from "../api";
import { BRAND } from "../brand";
import type { KernelStatus } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconPlay, IconStop } from "./Icons";

interface Props {
  halted: boolean;
  disabled?: boolean;
  onStatus: (s: KernelStatus) => void;
  onToast: (message: string, tone?: "ok" | "error") => void;
}

/** "Halt" in the HUD. The halt reaches the kernel through the human-facing API only. */
export function KillSwitch({ halted, disabled, onStatus, onToast }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const halt = async () => {
    setBusy(true);
    try {
      onStatus(await api.halt(reason.trim() || `Halted from the ${BRAND} core`));
      onToast("Halted: agents terminated, non-read tools denied, triggers paused", "error");
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
      <button type="button" className="hud-btn btn-halt" disabled={disabled} onClick={() => setConfirming(true)} aria-label="Halt all agents">
        <IconStop size={13} /> Halt
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

/** Shown under the ember core while the kernel is halted. */
export function ResumeButton({ onStatus, onToast }: { onStatus: (s: KernelStatus) => void; onToast: Props["onToast"] }) {
  const [busy, setBusy] = useState(false);
  const resume = async () => {
    setBusy(true);
    try {
      onStatus(await api.resume());
      onToast(`${BRAND} resumed`);
    } catch (err) {
      onToast(`Resume failed: ${(err as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="core-btn btn-resume" disabled={busy} onClick={() => void resume()}>
      <IconPlay size={12} /> {busy ? "Resuming..." : "Resume"}
    </button>
  );
}

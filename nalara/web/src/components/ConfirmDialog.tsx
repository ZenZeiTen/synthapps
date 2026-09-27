import { useEffect, useId, useRef, type ReactNode } from "react";

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Small modal confirmation. Escape cancels; focus starts on the first field or the cancel button. */
export function ConfirmDialog({ title, children, confirmLabel, danger, confirmDisabled, onConfirm, onCancel }: Props) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<Element | null>(null);

  useEffect(() => {
    returnFocus.current = document.activeElement;
    const first = box.current?.querySelector<HTMLElement>("input, textarea, select") ?? box.current?.querySelector<HTMLElement>("[data-cancel]");
    first?.focus();
    return () => {
      const el = returnFocus.current as HTMLElement | null;
      if (el && document.contains(el)) el.focus();
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={box}
        className={`modal confirm${danger ? " danger" : ""}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-d`}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <h2 id={`${id}-t`} className="modal-title">
          {title}
        </h2>
        <div id={`${id}-d`} className="modal-body">
          {children}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" data-cancel onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={`btn ${danger ? "btn-danger" : "btn-primary"}`} disabled={confirmDisabled} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

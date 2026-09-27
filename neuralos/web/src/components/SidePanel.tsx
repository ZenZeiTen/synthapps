import { useEffect, useId, useRef, type ReactNode } from "react";
import { IconClose } from "./Icons";

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}

/** Drawer over the left side of the canvas. Escape closes it. */
export function SidePanel({ title, subtitle, onClose, children, wide }: Props) {
  const id = useId();
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input, select, textarea")?.focus() ?? ref.current?.querySelector<HTMLElement>("button")?.focus();
  }, []);
  // Escape inside the panel is handled below. When an action re-renders the panel and removes the focused control
  // (Confirm on a memory record, for example), focus falls back to <body>: Escape must still close the panel.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement) return;
      e.preventDefault();
      closeRef.current();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  return (
    <aside
      ref={ref}
      className={`side-panel${wide ? " wide" : ""}`}
      aria-labelledby={`${id}-t`}
      role="dialog"
      aria-modal="false"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="side-panel-head">
        <div>
          <h2 id={`${id}-t`} className="serif-title">
            {title}
          </h2>
          {subtitle ? <p className="muted side-panel-sub">{subtitle}</p> : null}
        </div>
        <button type="button" className="icon-btn" aria-label={`Close ${title}`} onClick={onClose}>
          <IconClose size={16} />
        </button>
      </header>
      <div className="side-panel-body">{children}</div>
    </aside>
  );
}

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
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input, select, textarea")?.focus() ?? ref.current?.querySelector<HTMLElement>("button")?.focus();
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

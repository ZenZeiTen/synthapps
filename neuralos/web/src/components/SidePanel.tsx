import { useEffect, useId, useRef, type ReactNode } from "react";
import { useEscapeLayer } from "../hooks";
import { IconClose } from "./Icons";

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}

/** Glass panel on the left of the core. Escape closes it. */
export function SidePanel({ title, subtitle, onClose, children, wide }: Props) {
  const id = useId();
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input, select, textarea")?.focus() ?? ref.current?.querySelector<HTMLElement>("button")?.focus();
  }, []);
  // Escape inside the panel is handled below; with focus on <body> the escape stack closes the newest overlay.
  useEscapeLayer(() => closeRef.current());
  return (
    <aside
      ref={ref}
      className={`side-panel glass${wide ? " wide" : ""}`}
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
          <h2 id={`${id}-t`} className="panel-title">
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

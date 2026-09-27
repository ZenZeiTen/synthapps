import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { api } from "../api";
import type { GraphNode, RadialAction, RadialMenu as RadialMenuData, RadialResult } from "../types";
import { IconClose, IconRefresh } from "./Icons";

export interface RadialTarget {
  /** "root" for the empty canvas. */
  nodeId: string;
  node?: GraphNode;
  /** Client coordinates of the click. */
  at: { x: number; y: number };
}

interface Props {
  target: RadialTarget;
  /** The element the menu is drawn in (the canvas area). */
  container: HTMLElement | null;
  onClose: () => void;
  onClientAction: (action: RadialAction, target: RadialTarget) => void;
  onResult: (result: RadialResult, action: RadialAction, target: RadialTarget) => void;
}

const RING = 440;
const RADIUS = 160;

const KIND_STYLE: Record<string, { label: string; color: string; pill: string }> = {
  root: { label: "Root menu", color: "#A9ADB5", pill: "#3A414D" },
  agent: { label: "Agent", color: "#E8A547", pill: "#6B5230" },
  file: { label: "File", color: "#C9C4BA", pill: "#3A414D" },
  folder: { label: "Folder", color: "#C9C4BA", pill: "#3A414D" },
  project: { label: "Project", color: "#C9C4BA", pill: "#3A414D" },
  workspace: { label: "Workspace", color: "#E8A547", pill: "#6B5230" },
  mcp: { label: "MCP tool", color: "#6FA8E8", pill: "#2E4461" },
  workflow: { label: "Workflow", color: "#C9C4BA", pill: "#3A414D" },
  concept: { label: "Concept", color: "#C9C4BA", pill: "#3A414D" },
  output: { label: "Output", color: "#E8A547", pill: "#6B5230" },
};

export function RadialMenu({ target, container, onClose, onClientAction, onResult }: Props) {
  const [menu, setMenu] = useState<RadialMenuData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const returnFocus = useRef<Element | null>(null);
  const [box, setBox] = useState<DOMRect | null>(null);
  /** Container-relative y where the intent bar starts; the ring stays above it when there is room. */
  const [floor, setFloor] = useState<number | null>(null);

  useLayoutEffect(() => {
    returnFocus.current = document.activeElement;
    const b = container?.getBoundingClientRect() ?? null;
    setBox(b);
    const bar = container?.querySelector(".intent-bar")?.getBoundingClientRect();
    setFloor(b && bar ? bar.top - b.top - 8 : null);
  }, [container]);

  useEffect(() => {
    const ctl = new AbortController();
    setMenu(null);
    setError(null);
    api
      .radial(target.nodeId, ctl.signal)
      .then(setMenu)
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => ctl.abort();
  }, [target.nodeId, attempt]);

  const close = useCallback(() => {
    onClose();
    const el = returnFocus.current as HTMLElement | null;
    if (el && typeof el.focus === "function" && document.contains(el)) el.focus();
  }, [onClose]);

  // Focus the first enabled option when the menu arrives.
  useEffect(() => {
    if (!menu) return;
    const i = menu.actions.findIndex((a) => a.enabled);
    optionRefs.current[i >= 0 ? i : 0]?.focus();
  }, [menu]);

  const actions = menu?.actions ?? [];

  const pick = async (action: RadialAction) => {
    if (!action.enabled || busy) return;
    if (action.clientOnly) {
      onClientAction(action, target);
      onClose();
      return;
    }
    setBusy(action.id);
    try {
      const result = await api.radialAction(target.nodeId, action.id);
      onResult(result, action, target);
    } catch (err) {
      onResult({ ok: false, message: (err as Error).message }, action, target);
    } finally {
      setBusy(null);
      onClose();
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    const n = actions.length;
    if (!n) return;
    const current = optionRefs.current.findIndex((el) => el === document.activeElement);
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % n;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = current < 0 ? n - 1 : (current - 1 + n) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    if (next >= 0) {
      e.preventDefault();
      optionRefs.current[next]?.focus();
    }
  };

  // Position relative to the container, clamped so the ring stays inside it.
  const w = box?.width ?? window.innerWidth;
  const h = box?.height ?? window.innerHeight;
  const half = RING / 2 + 6;
  const rawX = target.at.x - (box?.left ?? 0);
  const rawY = target.at.y - (box?.top ?? 0);
  const cx = w > RING + 12 ? Math.min(w - half, Math.max(half, rawX)) : w / 2;
  const bottom = floor !== null && floor > RING + 12 ? floor : h;
  const cy = bottom > RING + 12 ? Math.min(bottom - half, Math.max(half, rawY)) : h / 2;

  const kind = menu?.kind ?? (target.nodeId === "root" ? "root" : target.node?.type ?? "root");
  const look = KIND_STYLE[kind] ?? KIND_STYLE.root;
  const title = target.nodeId === "root" ? "NeuralOS" : target.node?.name ?? target.nodeId;

  return (
    <div
      className="radial-layer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onKeyDown={onKeyDown}
    >
      <div className="radial-ring" style={{ left: cx - RING / 2, top: cy - RING / 2, width: RING, height: RING }} aria-hidden="true" />
      <div className="radial-center" style={{ left: cx, top: cy }}>
        <span className="radial-kind" style={{ color: look.color }}>
          {look.label}
        </span>
        <span className="radial-title">{title}</span>
        {!menu && !error ? (
          <span className="radial-note" role="status">
            Loading actions...
          </span>
        ) : null}
        {error ? (
          <span className="radial-note radial-error" role="alert">
            {error}
            <button type="button" className="btn btn-sm" onClick={() => setAttempt((a) => a + 1)}>
              <IconRefresh size={13} /> Retry
            </button>
          </span>
        ) : null}
        <button type="button" className="radial-close" aria-label="Close menu" onClick={close}>
          <IconClose size={14} />
        </button>
      </div>
      <div role="menu" aria-label={`${title} actions`} className="radial-options">
        {actions.map((a, i) => {
          const ang = ((-90 + (i * 360) / actions.length) * Math.PI) / 180;
          const x = cx + RADIUS * Math.cos(ang);
          const y = cy + RADIUS * Math.sin(ang);
          return (
            <button
              key={a.id}
              ref={(el) => {
                optionRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              className={`radial-opt${a.enabled ? "" : " is-disabled"}${busy === a.id ? " is-busy" : ""}`}
              style={{ left: x, top: y, borderColor: a.enabled ? look.pill : undefined }}
              aria-disabled={!a.enabled || undefined}
              aria-label={a.enabled ? a.label : `${a.label} (unavailable${a.hint ? `: ${a.hint}` : ""})`}
              title={a.hint}
              data-action-id={a.id}
              onClick={() => void pick(a)}
            >
              {busy === a.id ? "Working..." : a.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

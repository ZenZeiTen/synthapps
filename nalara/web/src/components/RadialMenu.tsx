import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { api } from "../api";
import { BRAND } from "../brand";
import type { GraphNode, RadialAction, RadialMenu as RadialMenuData, RadialResult } from "../types";
import { IconClose, IconRefresh } from "./Icons";

export interface RadialTarget {
  /** "root" for the core's own menu. */
  nodeId: string;
  node?: GraphNode;
  /** Display name when there is no graph node (an agent satellite, a file row). */
  title?: string;
  /** Viewport coordinates of the ring's centre (the core, or a node in the Field view). */
  center: { x: number; y: number };
  /** Ring radius in px. */
  radius: number;
  /** Keep the ring on the core while the stage settles (panels opening or closing move it): ring radius = orb radius + pad. */
  followCore?: { pad: number };
}

interface Props {
  target: RadialTarget;
  onClose: () => void;
  onClientAction: (action: RadialAction, target: RadialTarget) => void;
  onResult: (result: RadialResult, action: RadialAction, target: RadialTarget) => void;
}

const KIND_LABEL: Record<string, string> = {
  root: BRAND,
  agent: "Agent",
  file: "File",
  folder: "Folder",
  project: "Project",
  workspace: "Workspace",
  mcp: "MCP tool",
  workflow: "Workflow",
  concept: "Concept",
  output: "Output",
};

/** Glass pills on a ring around the core (or a Field node). Arrow keys move between options; Escape closes. */
export function RadialMenu({ target, onClose, onClientAction, onResult }: Props) {
  const [menu, setMenu] = useState<RadialMenuData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const returnFocus = useRef<Element | null>(null);

  useLayoutEffect(() => {
    returnFocus.current = document.activeElement;
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Follow the core while the stage moves.
  const [live, setLive] = useState<{ center: { x: number; y: number }; radius: number } | null>(null);
  useEffect(() => {
    const follow = target.followCore;
    if (!follow) return;
    let raf = 0;
    const until = performance.now() + 900;
    const step = () => {
      const b = document.querySelector<HTMLElement>(".core-orb")?.getBoundingClientRect();
      if (b && b.width > 0) {
        const next = { center: { x: b.left + b.width / 2, y: b.top + b.height / 2 }, radius: b.width / 2 + follow.pad };
        setLive((cur) =>
          cur && Math.abs(cur.center.x - next.center.x) < 0.5 && Math.abs(cur.center.y - next.center.y) < 0.5 && Math.abs(cur.radius - next.radius) < 0.5 ? cur : next,
        );
      }
      if (performance.now() < until) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target.followCore, size]);

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

  // Keep the ring and its pills inside the viewport.
  const geo = live ?? target;
  const R = Math.max(120, Math.min(geo.radius, size.h / 2 - 70, size.w / 2 - 90));
  const half = R + 70;
  const cx = Math.min(size.w - half, Math.max(half, geo.center.x));
  const cy = Math.min(size.h - R - 40, Math.max(R + 96, geo.center.y));

  const kind = menu?.kind ?? (target.nodeId === "root" ? "root" : target.node?.type ?? "root");
  const title = target.nodeId === "root" ? "Neural Core" : target.title ?? target.node?.name ?? target.nodeId;

  return (
    <div
      className={`radial-layer radial-${kind}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onKeyDown={onKeyDown}
    >
      <div className="radial-ring" style={{ left: cx - R, top: cy - R, width: R * 2, height: R * 2 }} aria-hidden="true" />
      <div className="radial-head" style={{ left: cx, top: cy - R - 58 }}>
        <span className="radial-kind">{KIND_LABEL[kind] ?? kind}</span>
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
      </div>
      <button type="button" className="radial-close" style={{ left: cx + R * 0.72, top: cy - R * 0.9 }} aria-label="Close menu" onClick={close}>
        <IconClose size={13} />
      </button>
      <div role="menu" aria-label={`${title} actions`} className="radial-options">
        {actions.map((a, i) => {
          const ang = ((-90 + (i * 360) / actions.length) * Math.PI) / 180;
          const x = cx + R * Math.cos(ang);
          const y = cy + R * Math.sin(ang);
          return (
            <button
              key={a.id}
              ref={(el) => {
                optionRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              className={`radial-opt${a.enabled ? "" : " is-disabled"}${busy === a.id ? " is-busy" : ""}`}
              style={{ left: x, top: y, animationDelay: `${i * 28}ms` }}
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

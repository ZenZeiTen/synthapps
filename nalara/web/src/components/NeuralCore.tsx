import type { ReactNode } from "react";
import { BRAND } from "../brand";
import type { Mood } from "../core/model";
import { Satellites, type SatelliteInfo } from "./Satellites";

interface Props {
  mood: Mood;
  statusLine: string;
  sats: SatelliteInfo[];
  /** Lift the core to make room for the approval card. */
  lifted: boolean;
  radialOpen: boolean;
  onCoreClick: (el: HTMLElement) => void;
  onSatellite: (sat: SatelliteInfo) => void;
  /** Resume (halted) or Retry (offline) under the status line. */
  action?: ReactNode;
}

/**
 * The core's halo, drawn in its own layer under the scene canvas so the orbiting particles pass over the glow. It
 * mirrors the core anchor's position, lift and mood.
 */
export function CoreHalo({ mood, lifted }: { mood: Mood; lifted: boolean }) {
  return (
    <div className={`core-anchor mood-${mood}${lifted ? " is-lifted" : ""}`} aria-hidden="true">
      <div className="core-halo" />
    </div>
  );
}

/** The Neural Core: a breathing orb, the agents in orbit and the caption under it. */
export function NeuralCore({ mood, statusLine, sats, lifted, radialOpen, onCoreClick, onSatellite, action }: Props) {
  return (
    <div className={`core-anchor mood-${mood}${lifted ? " is-lifted" : ""}${radialOpen ? " radial-open" : ""}`}>
      <button
        type="button"
        className="core-orb"
        aria-label={`Neural Core: ${statusLine.toLowerCase()}. Open the ${BRAND} menu`}
        aria-haspopup="menu"
        aria-expanded={radialOpen}
        onClick={(e) => onCoreClick(e.currentTarget)}
      >
        {/* The breathing happens inside the button, so the button itself keeps a still box. */}
        <span className="orb-breath" aria-hidden="true">
          <span className="orb-layer orb-body" />
          <span className="orb-layer orb-tint orb-amber" />
          <span className="orb-layer orb-tint orb-ember" />
          <span className="orb-layer orb-tint orb-calm" />
          <span className="orb-layer orb-shine" />
        </span>
      </button>
      <Satellites sats={sats} onOpen={onSatellite} inert={radialOpen} />
      <div className="core-caption">
        <h1 className="core-title">Neural Core</h1>
        <p className="core-status" role="status" aria-live="polite">
          {statusLine}
        </p>
        {action ? <div className="core-action">{action}</div> : null}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { AgentState } from "../types";

export interface SatelliteInfo {
  /** Instance id: one satellite per agent instance. */
  key: string;
  agentId: string;
  name: string;
  state: AgentState;
}

interface Props {
  sats: SatelliteInfo[];
  onOpen: (sat: SatelliteInfo) => void;
  /** Satellites cannot be clicked while a radial menu is open. */
  inert?: boolean;
}

/**
 * Angular slots on the satellite orbit (degrees, 0 = right, 90 = down), filled in this order: well-spaced slots first.
 * The band under the core stays free for its caption. In-between slots put their label above the dot so neighbours
 * do not overlap.
 */
const SLOTS: { deg: number; above?: boolean }[] = [
  { deg: -90 },
  { deg: -140 },
  { deg: -40 },
  { deg: 180 },
  { deg: 0 },
  { deg: 155 },
  { deg: 25 },
  { deg: -115, above: true },
  { deg: -65, above: true },
  { deg: -165, above: true },
  { deg: -15, above: true },
];
const LEAVE_MS = 1300;

const WORD: Record<AgentState, string> = {
  dormant: "dormant",
  summoned: "summoned",
  active: "active",
  collaborating: "collaborating",
  completed: "completed",
  failed: "failed",
  terminated: "terminated",
  archived: "archived",
};

/**
 * Summoned agents as satellites around the core. A satellite flies out of the core when its agent is summoned,
 * takes the colour of its state, and drifts outward and fades when it leaves the list.
 */
export function Satellites({ sats, onOpen, inert }: Props) {
  const slotOf = useRef(new Map<string, number>());
  const prev = useRef(new Map<string, SatelliteInfo>());
  const [leaving, setLeaving] = useState<Map<string, SatelliteInfo>>(new Map());
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const now = new Map(sats.map((s) => [s.key, s]));
    const gone = [...prev.current.values()].filter((s) => !now.has(s.key));
    prev.current = now;
    setLeaving((m) => {
      let changed = false;
      const next = new Map(m);
      for (const k of now.keys())
        if (next.delete(k)) changed = true; // came back
      for (const g of gone) {
        next.set(g.key, g);
        changed = true;
      }
      return changed ? next : m;
    });
    if (!gone.length) return;
    const t = window.setTimeout(() => {
      setLeaving((m) => {
        const next = new Map(m);
        for (const g of gone) {
          if (!prev.current.has(g.key)) {
            next.delete(g.key);
            slotOf.current.delete(g.key);
          }
        }
        return next;
      });
    }, LEAVE_MS);
    timers.current.push(t);
  }, [sats]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const slot = (key: string) => {
    let s = slotOf.current.get(key);
    if (s === undefined) {
      const used = new Set(slotOf.current.values());
      s = 0;
      while (used.has(s)) s++;
      slotOf.current.set(key, s);
    }
    return s;
  };

  const all = [...sats.map((s) => ({ s, leaving: false })), ...[...leaving.values()].map((s) => ({ s, leaving: true }))];
  const visible = all.filter(({ s }) => slot(s.key) < SLOTS.length);

  if (!visible.length) return null;
  return (
    <div className={`satellites${inert ? " is-inert" : ""}`} role="group" aria-label="Agents in orbit">
      {visible.map(({ s, leaving: out }) => {
        const { deg, above } = SLOTS[slot(s.key)];
        const rad = (deg * Math.PI) / 180;
        const style = { "--sx": Math.cos(rad).toFixed(4), "--sy": Math.sin(rad).toFixed(4) } as CSSProperties;
        return (
          <button
            key={s.key}
            type="button"
            className={`satellite sat-${s.state}${out ? " leaving" : ""}${above ? " label-above" : ""}`}
            style={style}
            data-agent-id={s.agentId}
            data-instance-id={s.key}
            data-state={s.state}
            aria-label={`${s.name}, ${WORD[s.state]}. Open agent actions`}
            tabIndex={out || inert ? -1 : 0}
            aria-hidden={out || undefined}
            onClick={() => {
              if (!out && !inert) onOpen(s);
            }}
          >
            <span className="sat-dot" aria-hidden="true" />
            <span className="sat-name">{s.name}</span>
            <span className="sat-state">{WORD[s.state]}</span>
          </button>
        );
      })}
    </div>
  );
}

import { useEffect, useState, type ReactNode } from "react";
import { BRAND } from "../brand";
import { IconField } from "./Icons";

function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let interval = 0;
    const tick = () => setNow(new Date());
    // Align to the minute boundary, then tick every minute.
    const first = window.setTimeout(() => {
      tick();
      interval = window.setInterval(tick, 60000);
    }, 60000 - (Date.now() % 60000) + 50);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, []);
  return now;
}

interface Props {
  /** e.g. "CORE IDLE" */
  coreWord: string;
  resting: number | null;
  field: string;
  activeAgents: number;
  fieldOpen: boolean;
  onToggleField: () => void;
  killSwitch: ReactNode;
}

const agents = (n: number) => `${n} ${n === 1 ? "AGENT" : "AGENTS"}`;

/**
 * The heads-up display: live kernel status top left, clock, field state and the Field and Halt controls top right.
 * "N AGENTS RESTING" counts system agents with no running instance; "FIELD <state> · M AGENTS" counts the agent
 * instances running now (summoned, active or collaborating), so it reads 0 when the core is idle.
 */
export function Hud({ coreWord, resting, field, activeAgents, fieldOpen, onToggleField, killSwitch }: Props) {
  const now = useMinuteClock();
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const left = [BRAND.toUpperCase(), `CORE ${coreWord}`, resting === null ? null : `${agents(resting)} RESTING`].filter(Boolean).join(" · ");
  return (
    <header className="hud">
      <p className="hud-left" data-testid="hud-left">
        {left}
      </p>
      <div className="hud-right">
        <time className="hud-clock" dateTime={now.toISOString()}>
          {time}
        </time>
        <p className="hud-field" data-testid="hud-field">
          FIELD {field} · {agents(activeAgents)}
        </p>
        <div className="hud-controls">
          <button type="button" className={`hud-btn btn-field${fieldOpen ? " on" : ""}`} aria-pressed={fieldOpen} onClick={onToggleField}>
            <IconField size={13} /> Field
          </button>
          {killSwitch}
        </div>
      </div>
    </header>
  );
}

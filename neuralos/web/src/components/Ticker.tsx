import type { ConnectionState } from "../api";
import { eventDetail, eventLabel } from "../labels";
import type { KernelEvent } from "../types";
import { IconEvents } from "./Icons";

interface Props {
  /** The latest live event, or null when the stream has been quiet for a while. */
  event: KernelEvent | null;
  connection: ConnectionState;
  onOpen: () => void;
}

/** The last kernel event, bottom left, in the HUD's letter-spaced style. Opens the full event log. */
export function Ticker({ event, connection, onOpen }: Props) {
  if (!event) return null;
  const detail = eventDetail(event);
  const text = `#${event.seq} · ${eventLabel(event.type).toUpperCase()}${detail ? ` · ${detail}` : ""}`;
  return (
    <button type="button" className={`ticker conn-${connection}`} onClick={onOpen} aria-label={`Latest event: ${eventLabel(event.type)}${detail ? `, ${detail}` : ""}. Open the event log`}>
      <IconEvents size={12} />
      <span className="ticker-text" key={event.seq}>
        {text}
      </span>
    </button>
  );
}

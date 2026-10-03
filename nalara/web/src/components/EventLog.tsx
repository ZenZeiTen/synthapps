import { useId, useMemo, useState } from "react";
import type { ConnectionState } from "../api";
import { eventDetail, eventLabel } from "../labels";
import type { KernelEvent, Workspace } from "../types";

interface Props {
  /** Newest first, already capped. */
  events: KernelEvent[];
  workspaces: Workspace[];
  connection: ConnectionState;
}

function belongsTo(ev: KernelEvent, wsId: string): boolean {
  if (ev.correlationId === wsId) return true;
  const d = (ev.data ?? {}) as Record<string, unknown>;
  return d.workspaceId === wsId || (typeof d.workspace === "object" && (d.workspace as { id?: string } | null)?.id === wsId);
}

function time(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function EventLog({ events, workspaces, connection }: Props) {
  const [filter, setFilter] = useState("");
  const id = useId();
  const shown = useMemo(() => (filter ? events.filter((e) => belongsTo(e, filter)) : events), [events, filter]);

  return (
    <section className="eventlog" aria-labelledby={`${id}-h`}>
      <div className="eventlog-head">
        <h3 id={`${id}-h`}>
          Event bus
          <span className={`conn conn-${connection}`} role="status">
            <span className="conn-dot" aria-hidden="true" />
            {connection === "open" ? "live" : connection}
          </span>
        </h3>
        <label className="sr-only" htmlFor={`${id}-f`}>
          Filter events by workspace
        </label>
        <select id={`${id}-f`} value={filter} onChange={(e) => setFilter(e.target.value)} className="select-sm">
          <option value="">All workspaces</option>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.label} ({w.id})
            </option>
          ))}
        </select>
      </div>
      {shown.length === 0 ? (
        <p className="muted eventlog-empty">{connection === "open" ? "Waiting for events..." : "Connecting to the event stream..."}</p>
      ) : (
        <ol className="eventlog-list" aria-live="off">
          {shown.map((ev) => (
            <li key={`${ev.seq}-${ev.id}`} className={`ev ev-${ev.type.split(".")[0]}`}>
              <span className="mono ev-seq">#{String(ev.seq).padStart(3, "0")}</span>
              <span className="ev-type">{eventLabel(ev.type)}</span>
              <span className="ev-detail" title={eventDetail(ev)}>
                {eventDetail(ev)}
              </span>
              <span className="mono ev-time">{time(ev.ts)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

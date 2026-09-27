import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentInstance, AgentState } from "../types";

/**
 * Pacing for what the core shows. Offline, a whole swarm runs in about a hundred milliseconds; shown as it happens the
 * satellites would only flash. Agent state changes seen on the event stream are therefore replayed in their real order,
 * one after another, each held on screen for a short beat (below). The kernel is never slowed down, nothing is dropped
 * or reordered, and a backlog is replayed faster so the display never falls far behind. Approvals are not paced.
 */
const BEAT: Record<AgentState, number> = {
  dormant: 0,
  summoned: 380,
  active: 520,
  collaborating: 520,
  completed: 300,
  failed: 300,
  terminated: 160,
  archived: 0,
};

/** Lifecycle order. An instance id is never reused, so its states only move forward; a late fetch cannot move one back. */
const RANK: Record<AgentState, number> = {
  dormant: 0,
  summoned: 1,
  active: 2,
  collaborating: 3,
  completed: 4,
  failed: 4,
  terminated: 4,
  archived: 5,
};

export interface Pacer {
  /** `live`: seen on the event stream as it happened (paced); otherwise a known past state, shown at once if new. */
  observe: (instanceId: string, state: AgentState, live?: boolean) => void;
  paced: (instances: AgentInstance[]) => AgentInstance[];
  version: number;
}

export function usePacer(): Pacer {
  /** Displayed state per instance. "dormant" = summoned in the kernel but not shown yet. */
  const shown = useRef(new Map<string, AgentState>());
  /** Latest state accepted per instance (shown or queued). */
  const latest = useRef(new Map<string, AgentState>());
  const queue = useRef<{ id: string; state: AgentState }[]>([]);
  const nextAt = useRef(0);
  const timer = useRef<number | null>(null);
  const [version, setVersion] = useState(0);

  const pump = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    let changed = false;
    let now = performance.now();
    while (queue.current.length && now >= nextAt.current) {
      const item = queue.current.shift()!;
      shown.current.set(item.id, item.state);
      changed = true;
      // Replay a backlog faster.
      const speed = 1 + queue.current.length / 5;
      nextAt.current = now + BEAT[item.state] / speed;
      now = performance.now();
    }
    if (changed) setVersion((v) => v + 1);
    if (queue.current.length) timer.current = window.setTimeout(pump, Math.max(0, nextAt.current - performance.now()) + 2);
  }, []);

  const observe = useCallback(
    (instanceId: string, state: AgentState, live = false) => {
      const prev = latest.current.get(instanceId);
      if (prev === undefined && !live) {
        latest.current.set(instanceId, state);
        shown.current.set(instanceId, state);
        setVersion((v) => v + 1);
        return;
      }
      if (prev !== undefined && (prev === state || RANK[state] < RANK[prev])) return;
      latest.current.set(instanceId, state);
      if (!shown.current.has(instanceId)) shown.current.set(instanceId, "dormant");
      queue.current.push({ id: instanceId, state });
      pump();
    },
    [pump],
  );

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const paced = useCallback(
    (instances: AgentInstance[]) => {
      void version;
      return instances.map((i) => {
        const s = shown.current.get(i.instanceId);
        return s && s !== i.state ? { ...i, state: s } : i;
      });
    },
    [version],
  );

  return { observe, paced, version };
}

/** Reconciles fetched instances into the pacer and returns them with their displayed states. */
export function usePacedInstances(instances: AgentInstance[], pacer: Pacer): AgentInstance[] {
  const { observe, paced, version } = pacer;
  useEffect(() => {
    for (const i of instances) observe(i.instanceId, i.state);
  }, [instances, observe]);
  return useMemo(() => paced(instances), [instances, paced, version]);
}

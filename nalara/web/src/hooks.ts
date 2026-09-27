import { useCallback, useEffect, useRef, useState } from "react";
import { api, subscribeEvents, type ConnectionState } from "./api";
import type { GraphSlice, KernelEvent } from "./types";

export const EVENT_CAP = 300;

type Listener = (ev: KernelEvent) => void;

/**
 * Live kernel events over SSE. `events` is newest first, capped at EVENT_CAP. `reconnect()` drops the current stream
 * and reconnects at once, resuming after the last event seen (the Retry button uses it after an outage).
 */
export function useKernelEvents() {
  const [events, setEvents] = useState<KernelEvent[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [generation, setGeneration] = useState(0);
  const listeners = useRef(new Set<Listener>());
  const lastSeq = useRef(0);

  useEffect(() => {
    const stop = subscribeEvents(
      (ev) => {
        if (typeof ev.seq === "number") {
          if (ev.seq <= lastSeq.current) return;
          lastSeq.current = ev.seq;
        }
        setEvents((prev) => [ev, ...prev].slice(0, EVENT_CAP));
        for (const l of listeners.current) {
          try {
            l(ev);
          } catch {
            /* a listener must never break the stream */
          }
        }
      },
      setConnection,
      { since: lastSeq.current },
    );
    return stop;
  }, [generation]);

  const onEvent = useCallback((l: Listener) => {
    listeners.current.add(l);
    return () => {
      listeners.current.delete(l);
    };
  }, []);

  const reconnect = useCallback(() => setGeneration((g) => g + 1), []);

  return { events, connection, onEvent, reconnect };
}

/** Calls fn at most once per `ms` after the last trigger. */
export function useDebouncedCallback(fn: () => void, ms: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      fnRef.current();
    }, ms);
  }, [ms]);
}

const GRAPH_EVENT = /^(node\.|edge\.|workspace\.|agent\.|mcp\.|file\.(created|deleted))/;

/** The canvas graph, refetched (debounced) when graph-shaping events arrive. */
export function useGraph(onEvent: (l: Listener) => () => void) {
  const [graph, setGraph] = useState<GraphSlice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const inflight = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    inflight.current?.abort();
    const ctl = new AbortController();
    inflight.current = ctl;
    try {
      const g = await api.graph({ limit: 1500 }, ctl.signal);
      setGraph(g);
      setError(null);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message);
    } finally {
      if (inflight.current === ctl) setLoading(false);
    }
  }, []);

  const refetch = useDebouncedCallback(() => void load(), 400);

  useEffect(() => {
    void load();
    return () => inflight.current?.abort();
  }, [load]);

  useEffect(
    () =>
      onEvent((ev) => {
        if (GRAPH_EVENT.test(ev.type)) refetch();
      }),
    [onEvent, refetch],
  );

  return { graph, error, loading, reload: load };
}

/**
 * Escape for overlays when nothing is focused (focus fell back to <body>, e.g. after an action removed the focused
 * control). Overlays register in the order they open; Escape closes the most recent one only. An overlay that holds
 * focus handles Escape itself in its own onKeyDown.
 */
const escapeStack: { fn: () => void }[] = [];
let escapeBound = false;
function onEscapeKey(e: KeyboardEvent) {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  const active = document.activeElement;
  if (active && active !== document.body && active !== document.documentElement) return;
  const top = escapeStack[escapeStack.length - 1];
  if (!top) return;
  e.preventDefault();
  top.fn();
}

export function useEscapeLayer(onEscape: () => void) {
  const ref = useRef(onEscape);
  ref.current = onEscape;
  useEffect(() => {
    const entry = { fn: () => ref.current() };
    escapeStack.push(entry);
    if (!escapeBound) {
      window.addEventListener("keydown", onEscapeKey);
      escapeBound = true;
    }
    return () => {
      const i = escapeStack.indexOf(entry);
      if (i >= 0) escapeStack.splice(i, 1);
    };
  }, []);
}

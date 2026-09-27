import { useCallback, useEffect, useRef, useState } from "react";
import { api, subscribeEvents, type ConnectionState } from "./api";
import type { GraphSlice, KernelEvent } from "./types";

export const EVENT_CAP = 300;

type Listener = (ev: KernelEvent) => void;

/** Live kernel events over SSE. `events` is newest first, capped at EVENT_CAP. */
export function useKernelEvents() {
  const [events, setEvents] = useState<KernelEvent[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const listeners = useRef(new Set<Listener>());

  useEffect(() => {
    const stop = subscribeEvents(
      (ev) => {
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
    );
    return stop;
  }, []);

  const onEvent = useCallback((l: Listener) => {
    listeners.current.add(l);
    return () => {
      listeners.current.delete(l);
    };
  }, []);

  return { events, connection, onEvent };
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

/** Escape-to-close for overlays. */
export function useEscape(active: boolean, onEscape: () => void) {
  const ref = useRef(onEscape);
  ref.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        ref.current();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [active]);
}

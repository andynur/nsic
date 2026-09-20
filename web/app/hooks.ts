import { useCallback, useEffect, useRef, useState } from "react";
import { api, errMsg, onEvent, subscribe, unsubscribe } from "./api.ts";

export type Loadable<T> = { data: T | null; error: string | null; loading: boolean; reload: () => void };

export function useApi<T>(path: string | null, deps: unknown[] = []): Loadable<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const load = useCallback(() => {
    if (!path) return;
    const my = ++seq.current;
    setLoading(true);
    api<T>(path)
      .then((d) => {
        if (my === seq.current) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => my === seq.current && setError(errMsg(e)))
      .finally(() => my === seq.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(load, [load]);
  return { data, error, loading, reload: load };
}

/** Subscribes to a WS topic; the handler is called for every event. */
export function useTopic(topic: string | null, handler: (ev: Record<string, unknown> & { type: string }) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!topic) return;
    subscribe(topic);
    const off = onEvent((ev) => ref.current(ev));
    return () => {
      off();
      if (topic !== "global") unsubscribe(topic);
    };
  }, [topic]);
}

/** Debounces reload during bursts of events. */
export function useDebounced(fn: () => void, ms = 250) {
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const f = useRef(fn);
  f.current = fn;
  return useCallback(() => {
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => f.current(), ms);
  }, [ms]);
}

/** Sets the browser tab title ("ACME-42 · NSIC"); null keeps the current one. */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (title) document.title = `${title} · NSIC`;
  }, [title]);
}

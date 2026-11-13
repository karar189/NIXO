"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type State<T> = { data: T | null; error: string | null; loading: boolean };

/**
 * Runs `fetcher` now and every `intervalMs` while `enabled`.
 * Keeps the last good data if a refresh fails.
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  deps: unknown[] = [],
  enabled = true,
) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: enabled });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async () => {
    try {
      const data = await fetcherRef.current();
      setState({ data, error: null, loading: false });
    } catch (err) {
      setState((s) => ({ ...s, error: (err as Error).message, loading: false }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setState((s) => ({ ...s, loading: true }));
    void run();
    const id = setInterval(run, intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalMs, run, ...deps]);

  return { ...state, refresh: run };
}

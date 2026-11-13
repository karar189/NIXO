"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { tradingApi, type LogEntry, type SessionStatus, type Statistics } from "./api";

const FAST_MS = 1500;
const IDLE_MS = 6000;

/** Polls the agents service for this account's session, logs and stats. */
export function useTradingSession(account: string | null) {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<Statistics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!account) return;
    try {
      const [s, l, st] = await Promise.all([
        tradingApi.status(account),
        tradingApi.logs(account),
        tradingApi.statistics(account),
      ]);
      runningRef.current = s.running;
      setStatus(s);
      setLogs(l.logs);
      setStats(st);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [account]);

  useEffect(() => {
    if (!account) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const loop = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(loop, runningRef.current ? FAST_MS : IDLE_MS);
    };
    void loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [account, refresh]);

  return { status, logs, stats, error, refresh, running: Boolean(status?.running) };
}

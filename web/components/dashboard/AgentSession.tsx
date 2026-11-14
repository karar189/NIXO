"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useWallet } from "@/components/wallet/WalletProvider";
import { useTradingSession } from "@/lib/trading/useTradingSession";
import { tradingApi, type Decision, type LogEntry, type SessionStatus, type Statistics, type Trade } from "@/lib/trading/api";

export type AgentHistory = { trades: Trade[]; decisions: Decision[] };

type AgentSession = {
  account: string;
  status: SessionStatus | null;
  logs: LogEntry[];
  stats: Statistics | null;
  history: AgentHistory | null;
  error: string | null;
  running: boolean;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AgentSession | null>(null);

/** One poller for the connected account's agent session, shared by the overview cards. */
export function AgentSessionProvider({ children }: { children: ReactNode }) {
  const { accountId } = useWallet();
  const session = useTradingSession(accountId);
  const [history, setHistory] = useState<AgentHistory | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let stop = false;
    const load = () =>
      tradingApi
        .history(accountId)
        .then((d) => !stop && setHistory(d))
        .catch(() => {});
    void load();
    const id = setInterval(load, session.running ? 4000 : 15000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [accountId, session.running]);

  return <Ctx.Provider value={{ account: accountId ?? "", history, ...session }}>{children}</Ctx.Provider>;
}

/** Null outside the provider (e.g. the wallet gate), so cards can fall back to a static state. */
export function useAgentSession() {
  return useContext(Ctx);
}

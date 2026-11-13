"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { InjectedWallet, WalletSelector } from "@near-wallet-selector/core";
import type { FinalExecutionOutcome } from "@near-js/types";
import {
  DEFAULT_NETWORK,
  METEOR_WALLET_ID,
  readStoredNetwork,
  storeNetwork,
  type NearNetwork,
} from "@/lib/near/config";

export type FunctionCall = {
  methodName: string;
  args: Record<string, unknown>;
  gas: string;
  deposit: string;
};

export type TxRequest = { receiverId: string; actions: FunctionCall[] };

type WalletContextValue = {
  /** True once the selector has restored any previous session. */
  ready: boolean;
  network: NearNetwork;
  accountId: string | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<string | null>;
  disconnect: () => Promise<void>;
  /** Signs out, stores the new network and reloads so the wallet re-initialises on it. */
  switchNetwork: (network: NearNetwork) => Promise<void>;
  /** Asks the wallet to sign and send function-call transactions, in order. */
  signAndSend: (txs: TxRequest[]) => Promise<FinalExecutionOutcome[]>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [network, setNetwork] = useState<NearNetwork>(DEFAULT_NETWORK);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const chosen = readStoredNetwork();

    (async () => {
      try {
        // Loaded on the client only: the wallet SDKs touch `window`.
        const [{ setupWalletSelector }, { setupMeteorWallet }] = await Promise.all([
          import("@near-wallet-selector/core"),
          import("@near-wallet-selector/meteor-wallet"),
        ]);
        const instance = await setupWalletSelector({
          network: chosen,
          modules: [setupMeteorWallet()],
        });
        if (cancelled) return;

        const sync = () => {
          const active = instance.store.getState().accounts.find((a) => a.active);
          setAccountId(active?.accountId ?? null);
        };
        sync();
        const sub = instance.store.observable.subscribe(sync);
        unsubscribe = () => sub.unsubscribe();
        setNetwork(chosen);
        setSelector(instance);
      } catch (err) {
        if (!cancelled) setError(`Wallet setup failed: ${(err as Error).message}`);
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const connect = useCallback(async () => {
    if (!selector) return null;
    setConnecting(true);
    setError(null);
    try {
      const wallet = await selector.wallet<InjectedWallet>(METEOR_WALLET_ID);
      // No contractId: sign in without creating a function-call key yet.
      const accounts = await wallet.signIn({});
      return accounts[0]?.accountId ?? null;
    } catch (err) {
      const message = (err as Error).message ?? "";
      setError(
        /reject|cancel|closed/i.test(message)
          ? "Connection cancelled in Meteor."
          : message || "Couldn't connect to Meteor Wallet.",
      );
      return null;
    } finally {
      setConnecting(false);
    }
  }, [selector]);

  const disconnect = useCallback(async () => {
    if (!selector || !selector.isSignedIn()) return;
    const wallet = await selector.wallet();
    await wallet.signOut();
  }, [selector]);

  const switchNetwork = useCallback(
    async (next: NearNetwork) => {
      if (next === network) return;
      try {
        await disconnect();
      } finally {
        storeNetwork(next);
        // Full reload so the wallet selector re-initialises on the new network.
        window.location.reload();
      }
    },
    [network, disconnect],
  );

  const signAndSend = useCallback(
    async (txs: TxRequest[]) => {
      if (!selector || !accountId) throw new Error("Connect your wallet first");
      const [{ actionCreators }, wallet] = await Promise.all([
        import("@near-wallet-selector/core"),
        selector.wallet<InjectedWallet>(METEOR_WALLET_ID),
      ]);
      const outcomes = await wallet.signAndSendTransactions({
        transactions: txs.map((tx) => ({
          signerId: accountId,
          receiverId: tx.receiverId,
          actions: tx.actions.map((a) =>
            actionCreators.functionCall(a.methodName, a.args, BigInt(a.gas), BigInt(a.deposit)),
          ),
        })),
      });
      return outcomes ?? [];
    },
    [selector, accountId],
  );

  const value = useMemo<WalletContextValue>(
    () => ({
      ready: selector !== null || error !== null,
      network,
      accountId,
      connecting,
      error,
      connect,
      disconnect,
      switchNetwork,
      signAndSend,
    }),
    [selector, network, accountId, connecting, error, connect, disconnect, switchNetwork, signAndSend],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}

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
import "@near-wallet-selector/modal-ui/styles.css";
import type { WalletSelector } from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import type { FinalExecutionOutcome } from "@near-js/types";
import {
  DEFAULT_NETWORK,
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
  /** Name of the wallet the active account signed in with, e.g. "Meteor Wallet". */
  walletName: string | null;
  connecting: boolean;
  error: string | null;
  /** Opens the wallet picker (Meteor, MyNearWallet, HERE, Sender, Intear, Nightly…). */
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
  const [modal, setModal] = useState<WalletSelectorModal | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
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
        const [core, modalUi, meteor, mnw, here, sender, intear, nightly] = await Promise.all([
          import("@near-wallet-selector/core"),
          import("@near-wallet-selector/modal-ui"),
          import("@near-wallet-selector/meteor-wallet"),
          import("@near-wallet-selector/my-near-wallet"),
          import("@near-wallet-selector/here-wallet"),
          import("@near-wallet-selector/sender"),
          import("@near-wallet-selector/intear-wallet"),
          import("@near-wallet-selector/nightly"),
        ]);
        const instance = await core.setupWalletSelector({
          network: chosen,
          modules: [
            meteor.setupMeteorWallet(),
            mnw.setupMyNearWallet(),
            here.setupHereWallet(),
            sender.setupSender(),
            intear.setupIntearWallet(),
            nightly.setupNightly(),
          ],
        });
        // No contractId: sign in without creating a function-call key.
        const picker = modalUi.setupModal(instance, { theme: "dark" });
        if (cancelled) return;

        const sync = () => {
          const state = instance.store.getState();
          const active = state.accounts.find((a) => a.active);
          setAccountId(active?.accountId ?? null);
          const mod = state.modules.find((m) => m.id === state.selectedWalletId);
          setWalletName(active ? (mod?.metadata.name ?? null) : null);
          if (active) setConnecting(false);
        };
        sync();
        const sub = instance.store.observable.subscribe(sync);
        unsubscribe = () => sub.unsubscribe();
        setNetwork(chosen);
        setSelector(instance);
        setModal(picker);
        picker.on("onHide", () => setConnecting(false));
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
    if (!selector || !modal) return null;
    setError(null);
    setConnecting(true);
    // The picker resolves through the selector store (see `sync` above).
    modal.show();
    return null;
  }, [selector, modal]);

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
        selector.wallet(),
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
      walletName,
      connecting,
      error,
      connect,
      disconnect,
      switchNetwork,
      signAndSend,
    }),
    [selector, network, accountId, walletName, connecting, error, connect, disconnect, switchNetwork, signAndSend],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}

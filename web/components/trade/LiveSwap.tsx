"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, Loader2, X } from "lucide-react";
import { useWallet } from "@/components/wallet/WalletProvider";
import { intentsExplorerUrl, txExplorerUrl } from "@/lib/near/config";
import { fromUnits, toUnits } from "@/lib/near/rpc";
import { intentsApi, type IntentsQuote, type Market } from "@/lib/trading/api";
import { fmtPrice, fmtQty } from "@/lib/trading/format";
import {
  FINAL,
  NEAR_GAS_RESERVE,
  assetsFor,
  buildDepositTxs,
  loadBalances,
  readSwaps,
  saveSwap,
  type Direction,
  type LiveSwapRecord,
  type WalletBalances,
} from "@/lib/intents/liveSwap";

const SLIPPAGES = [50, 100, 200];
const nowMs = () => Date.now();

const STEPS = [
  { key: "wallet", label: "In your wallet" },
  { key: "deposit", label: "At the NEAR Intents deposit address" },
  { key: "solver", label: "Solver executing the swap" },
  { key: "done", label: "Back in your wallet" },
] as const;

function stepIndex(status: LiveSwapRecord["status"]): number {
  switch (status) {
    case "SIGNING":
    case "CANCELLED":
      return 0;
    case "PENDING_DEPOSIT":
    case "KNOWN_DEPOSIT_TX":
    case "INCOMPLETE_DEPOSIT":
      return 1;
    case "PROCESSING":
      return 2;
    default:
      return 3;
  }
}

const STATUS_COPY: Record<string, { text: string; tone: string }> = {
  SIGNING: { text: "Waiting for your signature in Meteor", tone: "text-muted" },
  CANCELLED: { text: "Cancelled before anything was sent. Funds never left your wallet.", tone: "text-muted" },
  PENDING_DEPOSIT: { text: "Waiting for 1Click to see your deposit", tone: "text-muted" },
  KNOWN_DEPOSIT_TX: { text: "Deposit detected, queued for a solver", tone: "text-muted" },
  PROCESSING: { text: "A solver is executing the swap", tone: "text-accent-2" },
  SUCCESS: { text: "Swap complete. Tokens delivered to your account.", tone: "text-accent" },
  INCOMPLETE_DEPOSIT: { text: "Deposit was below the quoted amount. It will be refunded.", tone: "text-amber-300" },
  REFUNDED: { text: "Swap didn't execute. Your deposit was refunded to your account.", tone: "text-amber-300" },
  FAILED: { text: "Swap failed. Check the explorer; contact 1Click support with the deposit address.", tone: "text-danger" },
};

function Tracker({ swap, network }: { swap: LiveSwapRecord; network: "mainnet" | "testnet" }) {
  const at = stepIndex(swap.status);
  const final = FINAL.has(swap.status);
  const copy = STATUS_COPY[swap.status] ?? { text: swap.status, tone: "text-muted" };
  const bad = swap.status === "FAILED";
  const refunded = swap.status === "REFUNDED" || swap.status === "INCOMPLETE_DEPOSIT";
  return (
    <div className="rounded-xl border border-line bg-background/50 p-3">
      <p className="text-xs font-medium">
        {swap.direction === "buy" ? "Buy" : "Sell"} · {swap.amountIn} {swap.inSymbol} → ~{swap.expectedOut} {swap.outSymbol}
      </p>
      <ol className="mt-3 space-y-2">
        {STEPS.map((s, i) => {
          const done = i < at || (final && i === at && !bad);
          const current = i === at && !final;
          const label = i === 3 && refunded ? "Refunded to your wallet" : i === 3 && bad ? "Failed" : s.label;
          return (
            <li key={s.key} className="flex items-center gap-2.5 text-xs">
              <span
                className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${
                  done ? "border-accent/50 bg-accent/15 text-accent" : current ? "border-accent-2/60 text-accent-2" : bad && i === at ? "border-danger/60 text-danger" : "border-line text-muted"
                }`}
              >
                {done ? <Check className="size-3" /> : current ? <Loader2 className="size-3 animate-spin" /> : bad && i === at ? <X className="size-3" /> : i + 1}
              </span>
              <span className={current || done ? "text-foreground" : "text-muted"}>{label}</span>
            </li>
          );
        })}
      </ol>
      <p className={`mt-3 text-xs ${copy.tone}`}>{copy.text}</p>
      {swap.detail && <p className="mt-1 text-[11px] text-muted">{swap.detail}</p>}
      {swap.status !== "SIGNING" && swap.status !== "CANCELLED" && (
        <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
          <a href={intentsExplorerUrl(swap.depositAddress)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-2 hover:underline">
            NEAR Intents explorer <ExternalLink className="size-3" />
          </a>
          {swap.txHash && (
            <a href={txExplorerUrl(network, swap.txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-2 hover:underline">
              Deposit tx <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function LiveSwap({ market, markPrice }: { market: Market; markPrice: number | null }) {
  const { accountId, network, signAndSend } = useWallet();
  const [direction, setDirection] = useState<Direction>("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(100);
  const [balances, setBalances] = useState<WalletBalances | null>(null);
  const [quote, setQuote] = useState<IntentsQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [swaps, setSwaps] = useState<LiveSwapRecord[]>(() => (accountId ? readSwaps(accountId) : []));

  const a = assetsFor(direction);
  const account = accountId ?? "";

  const refreshBalances = useCallback(() => {
    if (!accountId || network !== "mainnet") return;
    loadBalances(network, accountId).then(setBalances).catch(() => setBalances(null));
  }, [accountId, network]);

  useEffect(() => {
    refreshBalances();
  }, [refreshBalances]);

  const active = swaps.find((s) => !FINAL.has(s.status) && s.status !== "SIGNING");

  // Poll 1Click status for the in-flight swap.
  useEffect(() => {
    if (!active || !accountId) return;
    const id = setInterval(async () => {
      try {
        const st = await intentsApi.status(active.depositAddress);
        if (st.status !== active.status) {
          const next: LiveSwapRecord = {
            ...active,
            status: st.status,
            updatedAt: nowMs(),
            detail:
              st.status === "SUCCESS" && st.swapDetails?.amountOutFormatted
                ? `Received ${st.swapDetails.amountOutFormatted} ${active.outSymbol}`
                : st.status === "REFUNDED" && st.swapDetails?.refundedAmountFormatted
                  ? `Refunded ${st.swapDetails.refundedAmountFormatted} ${active.inSymbol}`
                  : active.detail,
          };
          saveSwap(accountId, next);
          setSwaps(readSwaps(accountId));
          if (FINAL.has(st.status)) refreshBalances();
        }
      } catch {
        // Transient; try again on the next tick.
      }
    }, 4000);
    return () => clearInterval(id);
  }, [active, accountId, refreshBalances]);

  if (network !== "mainnet") {
    return (
      <div className="rounded-xl border border-line bg-background/50 p-4 text-sm">
        <p className="font-medium">Live swaps run on mainnet</p>
        <p className="mt-1 text-muted">
          NEAR Intents has no testnet, so live trading is off while you&apos;re on testnet. Switch to mainnet in{" "}
          <Link href="/trade/settings" className="text-accent hover:underline">Settings</Link>. Paper trading works on both.
        </p>
      </div>
    );
  }
  if (!market.liveEnabled) {
    return (
      <div className="rounded-xl border border-line bg-background/50 p-4 text-sm">
        <p className="font-medium">{market.pair} is paper-only for now</p>
        <p className="mt-1 text-muted">Live swaps from your wallet support NEAR/USDC. Pick NEAR to trade live.</p>
      </div>
    );
  }

  const parsed = (() => {
    try {
      return amount ? toUnits(amount, a.inDecimals) : null;
    } catch {
      return null;
    }
  })();
  const spendable = balances
    ? direction === "buy"
      ? balances.usdc
      : balances.wnear + (balances.nearAvailable > NEAR_GAS_RESERVE ? balances.nearAvailable - NEAR_GAS_RESERVE : 0n)
    : null;
  const insufficient = parsed !== null && spendable !== null && parsed > spendable;

  async function getQuote() {
    setError(null);
    setQuote(null);
    if (!parsed || parsed <= 0n) return setError("Enter an amount");
    setQuoting(true);
    try {
      setQuote(
        await intentsApi.quote({
          dry: true, origin_asset: a.origin, destination_asset: a.destination,
          amount: parsed.toString(), account_id: account, slippage_bps: slippage,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setQuoting(false);
    }
  }

  async function execute() {
    if (!parsed || !balances) return;
    setError(null);
    setExecuting(true);
    let record: LiveSwapRecord | null = null;
    try {
      // A non-dry quote reserves a deposit address for this swap.
      const real = await intentsApi.quote({
        dry: false, origin_asset: a.origin, destination_asset: a.destination,
        amount: parsed.toString(), account_id: account, slippage_bps: slippage,
      });
      const depositAddress = real.quote.depositAddress;
      if (!depositAddress) throw new Error("1Click didn't return a deposit address");
      record = {
        depositAddress, direction, amountIn: real.quote.amountInFormatted, inSymbol: a.inSymbol,
        expectedOut: fmtQty(Number(real.quote.amountOutFormatted)), outSymbol: a.outSymbol,
        createdAt: nowMs(), txHash: null, status: "SIGNING", updatedAt: nowMs(),
      };
      saveSwap(account, record);
      setSwaps(readSwaps(account));

      const txs = await buildDepositTxs({ network, account, direction, amount: parsed, depositAddress, balances });
      const outcomes = await signAndSend(txs);
      const last = outcomes[outcomes.length - 1] as { transaction_outcome?: { id?: string } } | undefined;
      const txHash = last?.transaction_outcome?.id ?? null;
      if (txHash) await intentsApi.submitDeposit(depositAddress, txHash, account).catch(() => {});
      record = { ...record, txHash, status: "PENDING_DEPOSIT", updatedAt: nowMs() };
      saveSwap(account, record);
      setSwaps(readSwaps(account));
      setQuote(null);
      setAmount("");
      refreshBalances();
    } catch (e) {
      const message = (e as Error).message || "Swap failed";
      if (record && record.status === "SIGNING") {
        saveSwap(account, { ...record, status: "CANCELLED", updatedAt: nowMs(), detail: message });
        setSwaps(readSwaps(account));
      }
      setError(/reject|cancel|denied|closed/i.test(message) ? "Cancelled in Meteor. Nothing was sent." : message);
    } finally {
      setExecuting(false);
    }
  }

  const q = quote?.quote;
  const rate = q ? (direction === "buy" ? Number(q.amountInFormatted) / Number(q.amountOutFormatted) : Number(q.amountOutFormatted) / Number(q.amountInFormatted)) : null;
  const vsMark = rate && markPrice ? ((direction === "buy" ? rate - markPrice : markPrice - rate) / markPrice) * 10_000 : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-background p-1" role="radiogroup" aria-label="Direction">
        {(["buy", "sell"] as const).map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={direction === d}
            onClick={() => {
              setDirection(d);
              setQuote(null);
              setAmount("");
            }}
            className={`rounded-lg py-2 text-sm font-medium ${direction === d ? (d === "buy" ? "bg-accent text-background" : "bg-danger text-background") : "text-muted hover:text-foreground"}`}
          >
            {d === "buy" ? "Buy NEAR" : "Sell NEAR"}
          </button>
        ))}
      </div>

      <div>
        <div className="mb-1.5 flex justify-between text-xs">
          <label htmlFor="live-amount" className="text-muted">You pay ({a.inSymbol})</label>
          <span className="text-muted">
            Wallet:{" "}
            <span className="font-mono text-foreground">
              {balances
                ? direction === "buy"
                  ? `${fmtQty(fromUnits(balances.usdc, 6))} USDC`
                  : `${fmtQty(fromUnits(balances.nearAvailable, 24))} NEAR + ${fmtQty(fromUnits(balances.wnear, 24))} wNEAR`
                : "…"}
            </span>
          </span>
        </div>
        <input
          id="live-amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setQuote(null);
          }}
          placeholder="0.00"
          className="w-full rounded-lg border border-line bg-background px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
        />
        {insufficient && <p className="mt-1 text-[11px] text-danger">More than your spendable balance.</p>}
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted">Max slippage</span>
        <div className="flex gap-1">
          {SLIPPAGES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setSlippage(s);
                setQuote(null);
              }}
              aria-pressed={slippage === s}
              className={`rounded-md border px-2 py-0.5 font-mono ${slippage === s ? "border-accent/50 text-foreground" : "border-line text-muted"}`}
            >
              {s / 100}%
            </button>
          ))}
        </div>
      </div>

      {q && (
        <dl className="space-y-1.5 rounded-xl border border-line bg-background/50 p-3 text-xs">
          {[
            ["You receive (est.)", `${fmtQty(Number(q.amountOutFormatted))} ${a.outSymbol}`],
            ["Minimum after slippage", `${fmtQty(fromUnits(q.minAmountOut, a.outDecimals))} ${a.outSymbol}`],
            ["Rate", rate ? `${fmtPrice(rate)} USDC / NEAR` : "—"],
            ["Vs mark price", vsMark !== null ? `${vsMark >= 0 ? "+" : ""}${vsMark.toFixed(1)} bps` : "—"],
            ["Est. time", `~${q.timeEstimate}s`],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-muted">{k}</dt>
              <dd className="font-mono">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {error && <p role="alert" className="text-xs text-danger">{error}</p>}

      {!q ? (
        <button
          type="button"
          onClick={getQuote}
          disabled={quoting || !parsed || insufficient || Boolean(active)}
          className="w-full rounded-full border border-line bg-surface-2 py-2.5 text-sm font-medium disabled:opacity-50"
        >
          {quoting ? "Getting quote…" : "Get NEAR Intents quote"}
        </button>
      ) : (
        <button
          type="button"
          onClick={execute}
          disabled={executing || insufficient || Boolean(active)}
          className={`w-full rounded-full py-2.5 text-sm font-medium text-background disabled:opacity-50 ${direction === "buy" ? "bg-accent" : "bg-danger"}`}
        >
          {executing ? "Confirm in Meteor…" : `Swap with Meteor · ${direction === "buy" ? "buy" : "sell"} NEAR`}
        </button>
      )}
      {active && <p className="text-center text-[11px] text-muted">One live swap at a time. Wait for the current one to finish.</p>}
      <p className="text-center text-[11px] leading-5 text-muted">
        Real funds on mainnet. Spot only (1x): NEAR Intents swaps tokens, it doesn&apos;t lend. You receive wNEAR when buying.
      </p>

      {swaps.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-muted">Live swaps</p>
          {swaps.slice(0, 3).map((s) => (
            <Tracker key={s.depositAddress} swap={s} network={network} />
          ))}
        </div>
      )}
    </div>
  );
}

import { Fragment } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  Bullets,
  C,
  Callout,
  DocSection,
  Lead,
  NextLinks,
  PageHeader,
  Prose,
  SectionHeading,
  SpecTable,
  StatusPill,
  Steps,
} from "@/components/docs/docs-shell";

export function TradingChapter() {
  return (
    <>
      <DocSection id="overview" first>
        <PageHeader kicker="Desk · /dashboard/trade" title="Trade where the certificate lives." />
        <Lead>
          The desk puts swaps and trading agents next to the clean-funds passport. Real swaps settle through NEAR Intents
          with confidential settlement. Everything with leverage is paper, priced by real 1Click dry quotes, so you can
          try strategies without funds.
        </Lead>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/dashboard/trade" className="btn-primary">
            Open the desk
            <ArrowRight className="size-4" />
          </Link>
        </div>
        <SpecTable
          columns={["Surface", "What it does", "Status"]}
          rows={[
            ["Confidential swap", "NEAR ⇄ USDC spot, signed in your wallet, settled through 1Click", <StatusPill key="1" status="live">live · mainnet</StatusPill>],
            ["Paper desk", "Leveraged paper positions with TP / SL, priced by 1Click dry quotes", <StatusPill key="2" status="mock">paper</StatusPill>],
            ["Paper agent", "LLM-planned strategy runs on every tick of a paper session", <StatusPill key="3" status="mock">paper</StatusPill>],
            ["Live AI agent", "The same agent's decisions as real spot swaps through NEAR Intents / 1Click, from one capped agent account", <StatusPill key="4" status="live">live · opt-in</StatusPill>],
            ["Copy-trading keys", "Sell encrypted access to your agent's trades; followers decrypt and mirror", <StatusPill key="5" status="live">see copy trading</StatusPill>],
            ["Markets and news", "/dashboard/markets (per-symbol pages, swap panel) and /dashboard/news (aggregated desk feed)", <StatusPill key="6" status="live" />],
          ]}
        />
      </DocSection>

      <DocSection id="swap">
        <SectionHeading
          eyebrow="Confidential swaps"
          title="Spot swaps with private-shard settlement."
          copy="LiveSwap uses the 1Click API with ORIGIN_CHAIN deposits and confidentiality “basic”: solvers settle on the private shard and the output lands back in your NEAR account, or the input is refunded."
        />
        <SpecTable
          columns={["Setting", "Value"]}
          rows={[
            ["Pairs", "USDC → NEAR (buy) and NEAR → USDC (sell)"],
            ["Assets", "USDC (nep141) and wNEAR (wrap.near); native NEAR is wrapped first"],
            ["Gas reserve", "0.05 NEAR kept back when selling NEAR"],
            ["Slippage", "10–500 bps, default 100"],
            ["Confidentiality", "public | basic | advanced, default basic"],
            ["Network", "Mainnet only. Intents has no testnet."],
          ]}
        />
        <Callout title="What confidential means here">
          Confidential settlement keeps the swap off the public Intents order flow. Your deposit to the 1Click address
          and the final transfer back to your account are still ordinary on-chain transactions an explorer can see.
        </Callout>
      </DocSection>

      <DocSection id="flow">
        <SectionHeading eyebrow="Swap lifecycle" title="Quote, deposit, settle, or refund." />
        <Steps
          items={[
            { title: "Dry quote", body: <>The desk asks the agents service for a dry quote (<C>POST /intents/quote</C>, <C>dry: true</C>) to show the expected output.</> },
            { title: "Real quote", body: <>A non-dry quote reserves a one-off deposit address for this swap.</> },
            { title: "Sign in your wallet", body: <>Storage registration and wrap (if needed), then an NEP-141 transfer to the deposit address. The browser never holds a 1Click JWT; the service attaches it.</> },
            { title: "Notify and poll", body: <><C>POST /intents/deposit</C> with the tx hash, then <C>GET /intents/status</C> until the swap succeeds or is refunded.</> },
          ]}
        />
      </DocSection>

      <DocSection id="paper">
        <SectionHeading
          eyebrow="Paper desk"
          title="Practise with real prices, no funds."
          copy="One paper session per NEAR account. A manual session holds one position from the order form and watches TP, SL and liquidation. Every fill is priced by a 1Click dry quote. State is in memory and resets on restart."
        />
        <SpecTable
          columns={["Risk rule", "Default"]}
          rows={[
            ["Max leverage", "50× (capped per market)"],
            ["Notional", "$5 – $100 000"],
            ["Daily loss cap", "$500"],
            ["Strategy loss streak", "5 losses"],
            ["Strategy loss cap", "$300"],
          ]}
        />
        <Prose>
          <p>Markets: NEAR, BTC, ETH, SOL, priced from Binance tickers and quoted through 1Click.</p>
        </Prose>
      </DocSection>

      <DocSection id="agents">
        <SectionHeading
          eyebrow="AI trading agents"
          title="An LLM picks the strategy. A rule engine runs it."
          copy="The planner reads the market regime, picks one strategy from a shortlist with parameters, and explains the choice. Without credentials, or if every provider fails, a deterministic rule-based planner returns the same shape, so the engine always has a plan."
        />
        <Prose>
          <p>Strategies the planner can pick:</p>
        </Prose>
        <div className="mt-4 flex max-w-2xl flex-wrap gap-2">
          {[
            "momentum", "dual_momentum", "trend_following", "ma_crossover", "ema_crossover", "breakout",
            "donchian_channel", "macd_signal", "supertrend", "mean_reversion", "z_score", "bollinger_reversion",
            "rsi_signal", "bollinger_squeeze", "linear_regression_channel", "atr_breakout",
          ].map((s) => (
            <span key={s} className="border border-line bg-surface px-2 py-1 font-mono text-[11px] text-muted">
              {s}
            </span>
          ))}
        </div>
        <Bullets
          items={[
            <Fragment key="b1">Risk profiles: conservative, moderate, aggressive.</Fragment>,
            <Fragment key="b2">Session controls: start, pause, resume, stop, plus logs, statistics and history (<C>/trade/*</C>).</Fragment>,
          ]}
        />
      </DocSection>

      <DocSection id="live">
        <SectionHeading
          eyebrow="Live AI agent · mainnet"
          title="Real swaps, from an account with hard limits."
          copy="Configure AI agent → Execution → Live. The agent's decisions become real spot swaps through 1Click from one dedicated agent account. It is off unless the operator sets NIXO_LIVE_ENABLED=1, and it is off on the hosted demo."
        />
        <Steps
          items={[
            { title: "Signal → real quote", body: <>A long signal asks 1Click for a real quote: USDC → NEAR, nBTC or bridged ETH. An exit sells exactly the amount it bought. Shorts are skipped and leverage is fixed at 1×, because Intents settles spot swaps. SOL stays paper-only (no NEAR-chain token).</> },
            { title: "Check the quote", body: <>Recipient and refund address must be the agent account. A quote more than <C>NIXO_LIVE_MAX_DEVIATION_BPS</C> (default 150 bps) worse than the Binance mark is refused.</> },
            { title: "Sign, submit, poll", body: <>The service signs one transaction from the agent account (storage registration if needed, then <C>ft_transfer</C> of the exact amount), hands the hash to 1Click and polls until <C>SUCCESS</C>, <C>REFUNDED</C> or <C>FAILED</C>. Fills use the amounts actually settled.</> },
            { title: "Show the receipts", body: <>Every order is appended to <C>agents/.nixo_live/orders.jsonl</C> and shown on the desk with NearBlocks and Intents explorer links.</> },
          ]}
        />
        <SpecTable
          columns={["Guardrail", "Default"]}
          rows={[
            ["Kill switch", "NIXO_LIVE_ENABLED (off)"],
            ["Per-trade cap", "25 USDC (NIXO_LIVE_MAX_TRADE_USDC), min 1 USDC"],
            ["Rolling 24 h budget", "100 USDC (NIXO_LIVE_DAILY_BUDGET_USDC)"],
            ["Market allowlist", "NEAR, BTC, ETH (NIXO_LIVE_MARKETS)"],
            ["Slippage", "100 bps (NIXO_LIVE_MAX_SLIPPAGE_BPS)"],
            ["Concurrency", "One live session at a time; Stop waits for an in-flight swap instead of abandoning it"],
            ["Gas", "0.05 NEAR kept in the agent account for gas and storage"],
          ]}
        />
        <Bullets
          items={[
            <Fragment key="b1">Only <C>NIXO_AGENT_OWNER</C> can start it. The wallet signs a NEP-413 message naming the market and size, bound to a single-use nonce from <C>POST /trade/live/challenge</C>; the server checks it is a full-access key of that account on mainnet.</Fragment>,
            <Fragment key="b2">The server holds the agent account&apos;s key, so keep its balance small. Sessions live in memory: after a restart, any bought asset stays in the agent account and its balance shows on the desk.</Fragment>,
          ]}
        />
      </DocSection>

      <DocSection id="models">
        <SectionHeading
          eyebrow="Model providers"
          title="Bring any of five providers, including NEAR AI."
          copy="Pick the provider and model in /dashboard/settings. “auto” walks LLM_PROVIDER_ORDER and falls through on failure."
        />
        <SpecTable
          columns={["Provider", "Key", "Default model"]}
          rows={[
            ["anthropic", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"],
            ["openai", "OPENAI_API_KEY", "OPENAI_MODEL"],
            ["deepseek", "DEEPSEEK_API_KEY", "DEEPSEEK_MODEL"],
            ["nvidia", "NVIDIA_API_KEY", "NVIDIA_MODEL"],
            ["nearai", "NEARAI_API_KEY", "NEARAI_MODEL (deepseek-ai/DeepSeek-V3.1)"],
          ]}
        />
        <NextLinks
          links={[
            { href: "/docs/copy-trading", label: "Copy-trading keys" },
            { href: "/docs/developers#agents-api", label: "Agents API" },
          ]}
        />
      </DocSection>
    </>
  );
}

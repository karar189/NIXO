import { Fragment } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  Bullets,
  C,
  Callout,
  DocSection,
  DocsShell,
  Lead,
  NextLinks,
  PageHeader,
  Prose,
  SectionHeading,
  SpecTable,
  StatusPill,
  Steps,
} from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "Trading desk · NIXO Docs",
  description:
    "Wallet-signed spot swaps through Confidential Intents (1Click, private-shard settlement), a paper desk priced with real dry quotes, and LLM-planned trading agents.",
};

export default function TradingDocsPage() {
  return (
    <DocsShell>
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
            { href: "/docs/private-ai", label: "Private AI" },
            { href: "/docs/developers#agents-api", label: "Agents API" },
          ]}
        />
      </DocSection>
    </DocsShell>
  );
}

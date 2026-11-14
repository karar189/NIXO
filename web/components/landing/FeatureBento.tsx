"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Bot, KeyRound, Lock, ScanSearch, ShieldCheck, Terminal, Waypoints } from "lucide-react";
import { SpotlightCard, usePrefersReducedMotion } from "./fx";
import { CipherText } from "./CipherText";
import { StatusTag, type Status } from "./StatusTag";
import { NIXO_CONTRACT } from "@/lib/config";

/* Deterministic pseudo-ciphertext so server and client render the same thing. */
function cipher(seed: string, length: number): string {
  const hex = "0123456789abcdef";
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let out = "";
  for (let i = 0; i < length; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    out += hex[(h >>> 0) % 16];
  }
  return out;
}

/* ---------- card visuals ---------- */

const PLANS = [
  "regime · trending ↑ · ADX 31 · ATR 2.1%",
  "shortlist · breakout, trend-follow",
  "plan · long NEAR 2× · TP +4% · SL −2%",
  "fill · 1Click quote 3.42 USDC / NEAR",
];
const BARS = [34, 48, 41, 62, 55, 71, 66, 80, 74, 88, 82, 93];

function AgentVisual() {
  const reduce = usePrefersReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setI((v) => (v + 1) % PLANS.length), 2600);
    return () => clearInterval(id);
  }, [reduce]);
  return (
    <div className="viz-agent" aria-hidden="true">
      <div className="viz-bars">
        {BARS.map((hgt, k) => (
          <i key={k} style={{ height: `${hgt}%`, animationDelay: `${k * 0.12}s` }} />
        ))}
      </div>
      <div className="viz-plan">
        <span className="viz-dot" />
        <CipherText key={i} text={PLANS[i]} speed={18} />
      </div>
    </div>
  );
}

function SwapVisual() {
  return (
    <div className="viz-swap" aria-hidden="true">
      <div className="pool">
        <strong>NEAR</strong>
        <small>120.00</small>
      </div>
      <div className="pool-flow">
        {Array.from({ length: 5 }, (_, k) => (
          <i key={k} style={{ animationDelay: `${k * 0.45}s` }} />
        ))}
        <em>1Click · real quote</em>
      </div>
      <div className="pool is-out">
        <strong>USDC</strong>
        <small>410.40</small>
      </div>
    </div>
  );
}

function VerdictVisual() {
  return (
    <div className="viz-verdict" aria-hidden="true">
      <div className="viz-rain">
        {Array.from({ length: 6 }, (_, k) => (
          <span key={k} style={{ animationDelay: `${k * 0.6}s` }}>
            {cipher(`v${k}`, 28)}
          </span>
        ))}
      </div>
      <div className="viz-badge">
        <ShieldCheck size={16} strokeWidth={1.8} /> clean · 7 days
      </div>
    </div>
  );
}

function TraceVisual() {
  const hops = ["listed", "d368…", "85f0…", "normalherb", "farstreet"];
  return (
    <div className="viz-trace" aria-hidden="true">
      <div className="viz-trace-line" />
      {hops.map((h, k) => (
        <div key={h} className={`viz-node ${k === 0 ? "is-listed" : ""} ${k === hops.length - 1 ? "is-end" : ""}`} style={{ animationDelay: `${k * 0.5}s` }}>
          <i />
          <small>{h}</small>
        </div>
      ))}
    </div>
  );
}

function TeeVisual() {
  return (
    <div className="viz-tee" aria-hidden="true">
      <Lock size={30} strokeWidth={1.2} />
      <div className="viz-tee-rows">
        <span>
          nonce <CipherText text={cipher("nonce", 12)} loop speed={34} holdMs={900} />
        </span>
        <span className="is-ok">attestation · verified</span>
      </div>
    </div>
  );
}

function ExchangeVisual() {
  return (
    <div className="viz-term" aria-hidden="true">
      <span className="t-prompt">$ near view {NIXO_CONTRACT} is_clean</span>
      <span className="t-args">{`'{"account": "nixo-alice.testnet"}'`}</span>
      <span className="t-out">
        → <b>true</b>
      </span>
      <span className="t-cursor" />
    </div>
  );
}

function KeysVisual() {
  return (
    <div className="viz-keys" aria-hidden="true">
      <div className="viz-key">
        <KeyRound size={14} /> viewing key · Nov 2026
      </div>
      <div className="viz-rows">
        {Array.from({ length: 4 }, (_, k) => (
          <span key={k} className={k === 1 ? "is-open" : ""}>
            {k === 1 ? "long NEAR 2× · +3.8% · closed" : cipher(`row${k}`, 30)}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------- cards ---------- */

const FEATURES: {
  key: string;
  wide?: boolean;
  icon: typeof Bot;
  label: string;
  title: string;
  body: string;
  href: string;
  cta: string;
  status: Status;
  Visual: () => React.JSX.Element;
}[] = [
  {
    key: "agents",
    wide: true,
    icon: Bot,
    label: "Private AI trading agents",
    title: "Agents read the market, then trade it.",
    body: "Regime analysis (ATR, ADX, volatility, MA slope), a strategy shortlist and a planner model. Paper trades are priced from real NEAR Intents quotes, so fees and slippage are real while leverage is simulated.",
    href: "/dashboard/trade",
    cta: "Open the trade desk",
    status: "live",
    Visual: AgentVisual,
  },
  {
    key: "swap",
    icon: Waypoints,
    label: "NEAR Intents",
    title: "Swaps through 1Click.",
    body: "Live NEAR / USDC spot swaps signed in your wallet and tracked to success or refund.",
    href: "/dashboard",
    cta: "Swap",
    status: "live",
    Visual: SwapVisual,
  },
  {
    key: "verdict",
    icon: ShieldCheck,
    label: "Clean-funds certificate",
    title: "Verdict only. No history.",
    body: "The enclave writes a 7-day certificate on NEAR. Exchanges read a boolean, never your trades.",
    href: "/dashboard/clean-funds",
    cta: "Prove your funds",
    status: "live",
    Visual: VerdictVisual,
  },
  {
    key: "trace",
    icon: ScanSearch,
    label: "6-hop trace",
    title: "Caught four hops out.",
    body: "Transfers and Ref Finance pool hops are followed back to listed wallets. The Binance-hack trail is the live demo.",
    href: "/verify",
    cta: "Trace a wallet",
    status: "live",
    Visual: TraceVisual,
  },
  {
    key: "tee",
    icon: Lock,
    label: "Private strategy",
    title: "The model runs in a TEE.",
    body: "Strategy generation is moving into an enclave on NEAR AI Cloud, attestation checked on a fresh nonce every run.",
    href: "/dashboard/settings",
    cta: "Settings",
    status: "build",
    Visual: TeeVisual,
  },
  {
    key: "exchange",
    wide: true,
    icon: Terminal,
    label: "For exchanges",
    title: "One view call before you credit a deposit.",
    body: "is_clean(account) returns true only for a valid, unexpired certificate issued by the pinned, unrevoked checker. Fail-closed on everything else.",
    href: "/verify",
    cta: "Exchange view",
    status: "live",
    Visual: ExchangeVisual,
  },
  {
    key: "keys",
    icon: KeyRound,
    label: "Encrypted trade log",
    title: "Share sight. Keep control.",
    body: "Followers and auditors unlock only the trades a viewing key covers, for the period it covers.",
    href: "/dashboard",
    cta: "Dashboard",
    status: "build",
    Visual: KeysVisual,
  },
];

export function FeatureBento() {
  return (
    <section id="product" className="landing-bento scroll-mt-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <p className="kicker">The product</p>
        <h2 data-split className="split-mask display mt-5 max-w-4xl text-[clamp(2rem,5vw,4.5rem)]">
          One desk for private trading and <span className="text-accent">clean</span> money.
        </h2>
        <div data-reveal-group className="bento-grid mt-14">
          {FEATURES.map(({ key, wide, icon: Icon, label, title, body, href, cta, status, Visual }) => (
            <div key={key} className={`bento-cell ${wide ? "wide" : ""}`}>
              <SpotlightCard className="bento-card">
                <div className="bento-visual">
                  <Visual />
                </div>
                <div className="bento-head">
                  <span className="bento-icon">
                    <Icon className="size-4" strokeWidth={1.6} />
                  </span>
                  <StatusTag status={status} />
                </div>
                <span className="kicker">{label}</span>
                <h3 className="display">{title}</h3>
                <p>{body}</p>
                <Link href={href} className="bento-link">
                  {cta} <ArrowUpRight className="size-3.5" />
                </Link>
              </SpotlightCard>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

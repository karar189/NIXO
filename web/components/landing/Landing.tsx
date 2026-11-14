"use client";

import { useRef } from "react";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useGSAP } from "@gsap/react";
import { ArrowUpRight, Bot, Fingerprint, KeyRound, LineChart, Lock, ScanSearch, ShieldCheck } from "lucide-react";
import { SiteNav, SiteFooter } from "@/components/site/SiteNav";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { NIXO_CONTRACT } from "@/lib/config";
import { PixelShape, BLOB_WIDE, BLOB_CTA, BLOB_SMALL, CHEVRON } from "./PixelShape";
import HalftoneBloom from "@/components/originkit/ui/halftone-bloom";

gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);

/* ---------- data shown on the page (all real or clearly labelled) ---------- */

const STATS = [
  { k: "Trace depth", n: 6, suffix: " hops", s: "transfers + pool hops" },
  { k: "Certificate", n: 7, suffix: " days", s: "then re-check" },
  { k: "Pool-hop window", n: 120, suffix: " s", s: "swap in, swap out" },
  { k: "Exchange cost", n: 1, suffix: " call", s: "is_clean(account)" },
];

type Status = "live" | "build";
const PRODUCT: { icon: typeof ShieldCheck; title: string; body: string; status: Status }[] = [
  { icon: ShieldCheck, title: "Clean money at the door", body: "Every deposit is checked inside a secure enclave against hack and sanctions lists, several hops back. Only a Clean or Rejected certificate lands on NEAR.", status: "live" },
  { icon: Bot, title: "Private AI trading agents", body: "Agents analyse the market, plan a strategy and paper-trade with real NEAR Intents quotes. The strategy model is moving into a TEE on NEAR AI Cloud.", status: "live" },
  { icon: Fingerprint, title: "Agents that can't be tricked", body: "Before paying anyone, the agent asks NIXO about the receiver. A prompt-injected agent asking to pay a hacker wallet gets blocked.", status: "build" },
  { icon: LineChart, title: "A track record you can verify", body: "Returns and drawdown signed by the TEE. Viewing keys let followers and auditors unlock trades they paid for.", status: "build" },
];

const STEPS = [
  { n: "01", t: "Connect a NEAR wallet", d: "Meteor, MyNearWallet, HERE, Sender, Intear or Nightly." },
  { n: "02", t: "Prove your funds", d: "The enclave traces your money's history and writes a 7-day certificate." },
  { n: "03", t: "Fund and run an agent", d: "Paper-trade or go live through NEAR Intents, with the strategy in a TEE." },
  { n: "04", t: "Exit clean", d: "Any venue checks is_clean(account) and accepts the funds instead of freezing them." },
];

/** The real Binance-hack laundering trail on NEAR mainnet (every tx verified on chain). */
const TRAIL: { who: string; via?: string; amount?: string; tx?: string[] }[] = [
  { who: "efd2…e5af", via: "listed: Binance hack wallet" },
  { who: "d368…4484", amount: "21,351.91 NEAR", tx: ["Ec39nAANXRucmAxgHe3fMUTyKviEQMgHRHYKJ4Cnn7Do"] },
  { who: "85f0…7129", amount: "10,675 NEAR", tx: ["88VKCF4y6ZzBKCjEgyXBrWrroS1PLxyZBpCTT6RXF6bW"] },
  { who: "normalherb1811.near", amount: "200 NEAR", tx: ["8sgmUqq5UVNZcZnu5XRvVXA3qQJERevw1T5pvPNsS3ZU"] },
  { who: "farstreet4572.near", via: "MEILI pool 9009 · swap in, swap out ~20 s apart", amount: "≈54.65 NEAR", tx: ["vAqN1Njpya3ccbtje7kUmRMnYUA7qPV1h4eJcMX7JrH", "2BpPDf9WAj9j4gaND5fyFdgvA9hRdkrpyjTkiAsd8MLQ"] },
];

/* Three swatches, like a palette sheet: Primary / Accent / Gradient. */
const PRIVACY: { icon: typeof Lock; label: string; t: string; s: string; d: string; status: Status; tone: "white" | "yellow" | "gradient" }[] = [
  { icon: ScanSearch, label: "Primary", t: "Fund history checked without revealing it", s: "Clean-funds certificate", d: "The enclave traces where money came from. Only the verdict leaves it: never balances, trades or counterparties.", status: "live", tone: "white" },
  { icon: Lock, label: "Accent", t: "Private strategy", s: "TEE", d: "The agent's strategy is generated inside a secure enclave on NEAR AI Cloud, with its attestation checked on a fresh nonce every run.", status: "build", tone: "yellow" },
  { icon: KeyRound, label: "Gradient", t: "Encrypted trade log", s: "Viewing keys", d: "Trades are recorded encrypted. Followers and auditors see only what a viewing key unlocks, for the period it covers.", status: "build", tone: "gradient" },
];

const MARQUEE = ["Private strategy (TEE)", "Encrypted trade log", "Fund history checked, never revealed", "NEAR Intents", "Intel TDX · OutLayer", "6-hop trace", "OFAC · EU · UK · UN · SECO"];

/* ---------- small pieces ---------- */

function StatusTag({ status, onLight = false }: { status: Status; onLight?: boolean }) {
  const base = "inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[9px] tracking-[0.18em] uppercase";
  if (status === "live") {
    return (
      <span className={`${base} ${onLight ? "border-black/30 text-black" : "border-accent/50 text-accent"}`}>
        <span className={`size-1.5 ${onLight ? "bg-black" : "bg-accent"}`} /> Live on testnet
      </span>
    );
  }
  return (
    <span className={`${base} ${onLight ? "border-black/20 text-black/60" : "border-line text-muted"}`}>
      <span className={`size-1.5 ${onLight ? "bg-black/40" : "bg-muted/60"}`} /> In build
    </span>
  );
}

function Certificate() {
  const rows = [
    ["Account", "nixo-alice.testnet"],
    ["Verdict", "Clean"],
    ["Trace depth", "6 hops"],
    ["Lists", "OFAC · EU · UK · UN · SECO · hack list"],
    ["Checker", "e0c79a99…11bed6 (pinned)"],
  ];
  return (
    <div data-reveal className="relative overflow-hidden border border-line bg-surface">
      <div className="hatch pointer-events-none absolute inset-0 opacity-50" aria-hidden="true" />
      <div className="relative p-6 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="kicker">Clean-funds certificate</p>
            <p className="display mt-3 text-2xl text-foreground">
              Verdict only. <span className="serif text-accent">No history.</span>
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 border border-clean/50 px-2.5 py-1 font-mono text-[9px] tracking-[0.18em] text-clean uppercase">
            <span className="size-1.5 bg-clean" /> Clean
          </span>
        </div>
        <dl className="mt-6 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4 border-t border-line py-2.5">
              <dt className="kicker">{k}</dt>
              <dd className="truncate text-right font-mono text-xs text-foreground/90">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 border border-line bg-black px-3 py-2 font-mono text-[11px] text-accent-2">
          is_clean(&quot;nixo-alice.testnet&quot;) → <span className="text-clean">true</span>
        </div>
        <p className="mt-3 text-xs text-muted">Example from the NEAR testnet demo, issued by {NIXO_CONTRACT}.</p>
      </div>
    </div>
  );
}

/* ---------- page ---------- */

export function Landing() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    (_, contextSafe) => {
      const ctx = root.current!;
      const q = gsap.utils.selector(ctx);
      const title = q("[data-hero-title]");
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce || !contextSafe) {
        gsap.set(title, { autoAlpha: 1 });
        (q("[data-count]") as HTMLElement[]).forEach((el) => {
          el.textContent = el.dataset.count ?? "";
        });
        return;
      }

      // --- Hero: intro timeline ---------------------------------------
      const intro = gsap.timeline({ defaults: { ease: "power4.out" } });

      // Headline lines rise out of a mask once fonts are ready.
      const splitTitle = contextSafe(() => {
        const split = SplitText.create(title, { type: "lines", mask: "lines", linesClass: "line" });
        gsap.set(title, { autoAlpha: 1 });
        intro.from(split.lines, { yPercent: 110, duration: 1.1, stagger: 0.09 }, 0.1);
      });
      document.fonts.ready.then(splitTitle);
      intro.from(q("[data-hero-kicker]"), { y: 14, opacity: 0, duration: 0.6 }, 0);
      intro.from(q("[data-hero-copy] > *"), { y: 24, opacity: 0, duration: 0.8, stagger: 0.08 }, 0.6);

      // Pixel blobs assemble cell by cell, from the centre out.
      q("[data-blob]").forEach((blob, i) => {
        intro.from(
          blob.querySelectorAll("[data-px]"),
          { scale: 0, opacity: 0, duration: 0.5, ease: "back.out(2)", stagger: { each: 0.012, from: "center", grid: "auto" } },
          0.5 + i * 0.2,
        );
      });
      intro.from(q("[data-blob-label]"), { opacity: 0, y: 10, duration: 0.6, stagger: 0.15 }, 1.3);

      // Chevron idle pulse.
      gsap.to(q("[data-chevron] [data-px]"), { opacity: 0.35, duration: 0.9, ease: "sine.inOut", stagger: { each: 0.05, repeat: -1, yoyo: true } });

      // --- Scroll reveals ----------------------------------------------
      q("[data-reveal]").forEach((el) => {
        gsap.from(el, { y: 40, opacity: 0, duration: 0.9, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 88%" } });
      });
      q("[data-reveal-group]").forEach((group) => {
        gsap.from(group.children, {
          y: 36,
          opacity: 0,
          duration: 0.8,
          ease: "power3.out",
          stagger: 0.1,
          scrollTrigger: { trigger: group, start: "top 85%" },
        });
      });
      q("[data-pixels]").forEach((el) => {
        gsap.from(el.querySelectorAll("[data-px]"), {
          scale: 0,
          opacity: 0,
          duration: 0.5,
          ease: "back.out(2)",
          stagger: { each: 0.01, from: "random", grid: "auto" },
          scrollTrigger: { trigger: el, start: "top 85%" },
        });
      });

      // Section headlines: word-by-word.
      const splitHeadings = contextSafe(() => {
        q("[data-split]").forEach((el) => {
          const s = SplitText.create(el, { type: "lines,words", mask: "lines", linesClass: "line" });
          gsap.from(s.words, { yPercent: 100, opacity: 0, duration: 0.8, ease: "power3.out", stagger: 0.03, scrollTrigger: { trigger: el, start: "top 85%" } });
        });
      });
      document.fonts.ready.then(splitHeadings);

      // Count-ups.
      (q("[data-count]") as HTMLElement[]).forEach((el) => {
        const target = Number(el.dataset.count);
        const o = { v: 0 };
        gsap.to(o, {
          v: target,
          duration: 1.4,
          ease: "power2.out",
          snap: { v: 1 },
          onUpdate: () => {
            el.textContent = String(Math.round(o.v));
          },
          scrollTrigger: { trigger: el, start: "top 90%" },
        });
      });

      // Trail: the rail draws down as you scroll past it, rows light in sequence.
      gsap.from(q("[data-rail]"), { scaleY: 0, transformOrigin: "top", ease: "none", scrollTrigger: { trigger: q("[data-trail]"), start: "top 70%", end: "bottom 60%", scrub: 0.4 } });
      gsap.from(q("[data-trail-row]"), { x: -20, opacity: 0, duration: 0.6, stagger: 0.12, ease: "power3.out", scrollTrigger: { trigger: q("[data-trail]"), start: "top 75%" } });

      // Slow parallax on the bloom field.
      gsap.to(q("[data-orb]"), { yPercent: 18, ease: "none", scrollTrigger: { trigger: ctx, start: "top top", end: "40% top", scrub: true } });

      // Palette swatches: slide up at staggered heights, like cards fanning.
      gsap.from(q("[data-swatch]"), { y: 80, opacity: 0, duration: 1, ease: "power3.out", stagger: 0.12, scrollTrigger: { trigger: q("[data-swatches]"), start: "top 80%" } });
    },
    { scope: root },
  );

  return (
    <div ref={root}>
      <SiteNav />
      <main className="flex-1">
        {/* ------------------------------------------------ Hero */}
        <section className="relative overflow-hidden border-b border-line">
          {/* Halftone bloom field in the brand colours; dots swell toward the pointer. */}
          <div
            data-orb
            className="pointer-events-none absolute inset-0"
            style={{ maskImage: "linear-gradient(to bottom, black 55%, transparent 100%)", WebkitMaskImage: "linear-gradient(to bottom, black 55%, transparent 100%)" }}
            aria-hidden="true"
          >
            <HalftoneBloom background="#000000" color1="#d4fe08" color2="#3f4ccf" speed={35} size={170} angle={160} dotSize={7} hover={180} reach={480} style={{ minWidth: 0, minHeight: 0 }} />
          </div>
          <div className="relative mx-auto max-w-7xl px-4 pt-16 pb-10 sm:px-6 lg:pt-24">
            <p data-hero-kicker className="kicker flex items-center gap-3">
              <span className="inline-block size-2 bg-accent" /> NEAR · Private AI trading · TEE-verified
            </p>

            <h1 data-hero-title style={{ visibility: "hidden" }} className="split-mask display mt-8 max-w-[14ch] text-[clamp(3rem,9vw,8.5rem)] text-foreground">
              Private trading.
              <br />
              <span className="serif text-accent">Provably</span> clean money.
            </h1>

            <div data-hero-copy className="mt-10 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
              <p className="max-w-xl text-[15px] leading-relaxed text-muted sm:text-base">
                AI agents plan and trade for you through NEAR Intents. Every deposit is traced through transfers and laundering pools inside a secure enclave,
                so exchanges accept your funds instead of freezing them.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <ConnectButton variant="primary" showError />
                <Link href="/verify" className="btn-secondary">
                  Check any wallet <ArrowUpRight className="size-3.5" />
                </Link>
              </div>
            </div>
          </div>

          {/* Two fused-pixel panels, like the reference board. */}
          <div className="relative mx-auto grid max-w-7xl gap-6 px-4 pb-20 sm:px-6 lg:grid-cols-2 lg:pb-28">
            <Link href="/dashboard" className="group relative block aspect-[16/11] sm:aspect-[16/9]">
              <span data-blob className="absolute inset-0">
                <PixelShape pattern={BLOB_WIDE} fill="var(--accent)" className="h-full w-full" />
              </span>
              <div data-blob-label className="absolute inset-x-[20%] top-[27%] bottom-[30%] flex flex-col justify-between text-accent-ink">
                <span className="font-mono text-[10px] tracking-[0.22em] uppercase opacity-70">Open the desk</span>
                <span className="display text-[clamp(1.6rem,4vw,3.4rem)]">
                  Trade in
                  <br />
                  <span className="serif">private</span>
                </span>
                <PixelShape pattern={CHEVRON} fill="var(--accent-ink)" className="h-5 w-6 self-end transition-transform duration-300 group-hover:translate-x-2" />
              </div>
            </Link>
            <Link href="/verify" className="group relative block aspect-[16/11] sm:aspect-[16/9]">
              <span data-blob className="absolute inset-0">
                <PixelShape pattern={BLOB_WIDE} fill="var(--surface-2)" className="h-full w-full" />
              </span>
              <div data-blob-label className="absolute inset-x-[20%] top-[27%] bottom-[30%] flex flex-col justify-between text-accent">
                <span className="font-mono text-[10px] tracking-[0.22em] uppercase opacity-70">Exchange view</span>
                <span className="display text-[clamp(1.6rem,4vw,3.4rem)]">
                  Exit
                  <br />
                  <span className="serif">clean</span>
                </span>
                <span data-chevron className="self-end">
                  <PixelShape pattern={CHEVRON} fill="var(--accent)" className="h-5 w-6 transition-transform duration-300 group-hover:translate-x-2" />
                </span>
              </div>
            </Link>
          </div>
        </section>

        {/* ------------------------------------------------ Marquee */}
        <div className="overflow-hidden border-b border-line bg-accent text-accent-ink" aria-hidden="true">
          <div className="marquee-track flex w-max">
            {[0, 1].map((k) => (
              <ul key={k} className="flex shrink-0 items-center">
                {MARQUEE.map((m) => (
                  <li key={m} className="flex items-center gap-6 px-6 py-3 font-mono text-[11px] tracking-[0.2em] uppercase">
                    {m}
                    <span className="inline-grid grid-cols-2 gap-0.5">
                      <span className="size-1 bg-black" />
                      <span className="size-1 bg-black/30" />
                      <span className="size-1 bg-black/30" />
                      <span className="size-1 bg-black" />
                    </span>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>

        {/* ------------------------------------------------ Stats */}
        <section className="border-b border-line">
          <div data-reveal-group className="mx-auto grid max-w-7xl grid-cols-2 lg:grid-cols-4">
            {STATS.map((s, i) => (
              <div key={s.k} className={`px-4 py-9 sm:px-6 ${i % 2 ? "border-l" : ""} ${i >= 2 ? "border-t lg:border-t-0" : ""} ${i === 2 ? "lg:border-l" : ""} border-line`}>
                <p className="kicker">{s.k}</p>
                <p className="display mt-4 text-4xl text-foreground sm:text-5xl">
                  <span data-count={s.n}>0</span>
                  <span className="serif text-accent">{s.suffix}</span>
                </p>
                <p className="mt-2 font-mono text-[11px] text-muted">{s.s}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------ Product */}
        <section id="product" className="relative mx-auto max-w-7xl scroll-mt-20 px-4 py-28 sm:px-6">
          <div data-pixels className="pointer-events-none absolute top-20 right-4 w-28 opacity-80 sm:right-6 lg:w-40" aria-hidden="true">
            <PixelShape pattern={BLOB_SMALL} fill="var(--surface-2)" className="h-auto w-full" />
          </div>
          <p className="kicker">The product</p>
          <h2 data-split className="split-mask display mt-5 max-w-4xl text-[clamp(2rem,5vw,4.5rem)]">
            One desk for private trading and <span className="serif text-accent">clean</span> money.
          </h2>
          <div data-reveal-group className="mt-14 grid border-t border-l border-line sm:grid-cols-2 lg:grid-cols-4">
            {PRODUCT.map(({ icon: Icon, title, body, status }) => (
              <article key={title} className="group relative flex min-h-[320px] flex-col justify-between gap-6 overflow-hidden border-r border-b border-line p-6 transition-colors hover:bg-surface">
                <span className="pointer-events-none absolute -right-6 -bottom-6 size-24 translate-y-6 bg-accent opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-10" aria-hidden="true" />
                <div className="flex items-center justify-between">
                  <span className="flex size-10 items-center justify-center border border-line bg-black text-accent">
                    <Icon className="size-[18px]" strokeWidth={1.6} />
                  </span>
                  <StatusTag status={status} />
                </div>
                <div>
                  <h3 className="display text-2xl text-foreground">{title}</h3>
                  <p className="mt-4 text-sm leading-relaxed text-muted">{body}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------ How it works */}
        <section id="how" className="scroll-mt-20 border-y border-line bg-surface">
          <div className="mx-auto max-w-7xl px-4 py-28 sm:px-6">
            <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
              <div>
                <p className="kicker">How it works</p>
                <h2 data-split className="split-mask display mt-5 text-[clamp(2rem,4.5vw,4rem)]">
                  Clean in. <span className="serif text-accent">Private</span> trading. Clean out.
                </h2>
              </div>
              <ol data-reveal-group className="grid gap-px border border-line bg-line sm:grid-cols-2">
                {STEPS.map((s) => (
                  <li key={s.n} className="group bg-black p-7 transition-colors hover:bg-surface-2">
                    <p className="serif text-3xl text-accent">{s.n}</p>
                    <p className="display mt-6 text-xl text-foreground">{s.t}</p>
                    <p className="mt-3 text-sm leading-relaxed text-muted">{s.d}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ Real trail */}
        <section className="mx-auto grid max-w-7xl gap-14 px-4 py-28 sm:px-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="kicker">Real data · NEAR mainnet</p>
            <h2 data-split className="split-mask display mt-5 text-[clamp(2rem,4.5vw,4rem)]">
              A laundering trail, caught <span className="serif text-reject">four hops</span> out.
            </h2>
            <p data-reveal className="mt-7 text-sm leading-relaxed text-muted">
              After the Binance hack of 29 Oct 2026, stolen funds moved through fresh wallets and a brand-new memecoin pool on Ref Finance. A list check only
              sees the first wallet. NIXO follows transfers and pool hops (a swap in and an opposite swap out of the same pool within 120 seconds, amounts
              within 15%), so the wallet at the end is rejected too.
            </p>
            <p data-reveal className="mt-4 text-xs text-muted">
              The listed wallet is attributed publicly by on-chain analysts AMLBot and Shridlock. That is not an official attribution.
            </p>
            <Link data-reveal href="/verify" className="btn-secondary mt-8">
              Trace it yourself <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
          <div data-trail className="relative border border-line bg-surface">
            <span data-rail className="pointer-events-none absolute top-0 bottom-0 left-[2.1rem] w-px bg-accent/60" aria-hidden="true" />
            <ol>
              {TRAIL.map((step, i) => (
                <li key={step.who} data-trail-row className="relative border-b border-line px-5 py-5">
                  <div className="flex items-center justify-between gap-4">
                    <span className="flex items-center gap-4">
                      <span className={`relative z-10 flex size-7 items-center justify-center font-mono text-[10px] ${i === 0 ? "bg-reject text-black" : i === TRAIL.length - 1 ? "bg-accent text-accent-ink" : "border border-line bg-black text-muted"}`}>
                        {i}
                      </span>
                      <span className="font-mono text-sm text-foreground">{step.who}</span>
                    </span>
                    {step.amount && <span className="font-mono text-xs text-accent-2">{step.amount}</span>}
                  </div>
                  {(step.via || step.tx) && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-11 text-xs">
                      {step.via && <span className={i === 0 ? "text-reject" : "text-muted"}>{step.via}</span>}
                      {step.tx?.map((h) => (
                        <a key={h} href={`https://nearblocks.io/txns/${h}`} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline">
                          {h.slice(0, 8)}…
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ol>
            <div data-trail-row className="flex items-center justify-between bg-reject-bg px-5 py-3">
              <span className="kicker !text-reject">Verdict for farstreet4572.near</span>
              <span className="font-mono text-xs text-reject">Rejected · taint_path · 4 hops</span>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ Privacy swatches */}
        <section id="privacy" className="scroll-mt-20 border-y border-line">
          <div className="mx-auto max-w-7xl px-4 py-28 sm:px-6">
            <p className="kicker">Privacy, precisely</p>
            <h2 data-split className="split-mask display mt-5 max-w-3xl text-[clamp(2rem,4.5vw,4rem)]">
              What stays <span className="serif text-accent">private</span>, and how.
            </h2>
            <div data-swatches className="mt-14 grid gap-4 lg:grid-cols-3">
              {PRIVACY.map(({ icon: Icon, label, t, s, d, status, tone }) => {
                const light = tone !== "gradient";
                const bg = tone === "white" ? "bg-white text-black" : tone === "yellow" ? "bg-accent text-accent-ink" : "gradient-blue text-white";
                return (
                  <div key={t} data-swatch className={`flex min-h-[460px] flex-col justify-between rounded-3xl p-8 ${bg}`}>
                    <div>
                      <div className="flex items-center justify-between">
                        <Icon className="size-5" strokeWidth={1.6} />
                        <StatusTag status={status} onLight={light} />
                      </div>
                      <p className={`mt-8 font-mono text-[10px] tracking-[0.22em] uppercase ${light ? "text-black/60" : "text-white/60"}`}>{s}</p>
                      <p className="display mt-2 text-2xl">{t}</p>
                      <p className={`mt-4 text-sm leading-relaxed ${light ? "text-black/70" : "text-white/75"}`}>{d}</p>
                    </div>
                    <p className="serif text-5xl">{label}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ For exchanges */}
        <section className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-28 sm:px-6 lg:grid-cols-2">
          <div>
            <p className="kicker">For exchanges</p>
            <h2 data-split className="split-mask display mt-5 text-[clamp(2rem,4.5vw,4rem)]">
              Add NIXO in <span className="serif text-accent">three</span> lines.
            </h2>
            <p data-reveal className="mt-7 text-sm leading-relaxed text-muted">
              One view call tells you whether incoming funds hold a valid, unexpired Clean certificate. You learn the verdict and its expiry. You never see
              balances, trades or counterparties.
            </p>
          </div>
          <div className="grid gap-4">
            <pre data-reveal className="overflow-x-auto border border-line bg-surface p-6 font-mono text-[13px] leading-relaxed">
              <span className="text-muted">{"// before crediting a deposit\n"}</span>
              <span className="text-accent-2">const</span> ok = <span className="text-accent-2">await</span> near.view({"{"}
              {"\n"}  contractId: <span className="text-accent">&quot;{NIXO_CONTRACT}&quot;</span>, method: <span className="text-accent">&quot;is_clean&quot;</span>,
              {"\n"}  args: {"{"} account: depositor {"}"} {"}"});
              {"\n"}
              <span className="text-accent-2">if</span> (!ok) freezeForReview(depositor);
            </pre>
            <Certificate />
          </div>
        </section>

        {/* ------------------------------------------------ CTA */}
        <section className="relative overflow-hidden border-t border-line">
          <div className="grid-bg pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
          <div className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6">
            <div data-pixels className="relative aspect-[28/10] w-full">
              <PixelShape pattern={BLOB_CTA} fill="var(--accent)" className="absolute inset-0 h-full w-full" />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 text-center text-accent-ink">
                <p className="font-mono text-[10px] tracking-[0.22em] uppercase opacity-70">Ready when you are</p>
                <p className="display text-[clamp(1.8rem,6vw,5.5rem)]">
                  Open the <span className="serif">desk.</span>
                </p>
                <div className="hidden sm:block">
                  <ConnectButton variant="primary" invert />
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-center sm:hidden">
              <ConnectButton variant="primary" />
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

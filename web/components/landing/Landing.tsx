"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useGSAP } from "@gsap/react";
import { ArrowUpRight, KeyRound, Lock, ScanSearch } from "lucide-react";
import { SiteNav, SiteFooter } from "@/components/site/SiteNav";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { NIXO_CONTRACT } from "@/lib/config";
import HalftoneBloom from "@/components/originkit/ui/halftone-bloom";
import DitherField from "./DitherField";
import DitherFlower from "./DitherFlower";
import { EncryptionBeam } from "./EncryptionBeam";
import { FeatureBento } from "./FeatureBento";
import { Preloader } from "./Preloader";
import { StatusTag, type Status } from "./StatusTag";
import { LandingCursor, Magnetic, Marquee, ScrambleText, ScrollProgress } from "./fx";
import "./landing.css";

gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);

/* ---------- data shown on the page (all real or clearly labelled) ---------- */

const STATS = [
  { k: "Trace depth", n: 6, suffix: " hops", s: "transfers + pool hops" },
  { k: "Certificate", n: 7, suffix: " days", s: "then re-check" },
  { k: "Pool-hop window", n: 120, suffix: " s", s: "swap in, swap out" },
  { k: "Exchange cost", n: 1, suffix: " call", s: "is_clean(account)" },
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

const PRIVACY: { icon: typeof Lock; t: string; s: string; d: string; status: Status; tone: "white" | "yellow" | "gradient" }[] = [
  { icon: ScanSearch, t: "Fund history checked without revealing it", s: "Clean-funds certificate", d: "The enclave traces where money came from. Only the verdict leaves it: never balances, trades or counterparties.", status: "live", tone: "white" },
  { icon: Lock, t: "Private strategy", s: "TEE", d: "The agent's strategy is generated inside a secure enclave on NEAR AI Cloud, with its attestation checked on a fresh nonce every run.", status: "build", tone: "yellow" },
  { icon: KeyRound, t: "Encrypted trade log", s: "Viewing keys", d: "Trades are recorded encrypted. A delayed viewing key unlocks the log for its scope; explorers still show vault and Intents transfers.", status: "live", tone: "gradient" },
];

const TICKER_A = ["Private strategy (TEE)", "Encrypted trade log", "Fund history checked, never revealed", "NEAR Intents", "Intel TDX · OutLayer", "6-hop trace", "OFAC · EU · UK · UN · SECO"] as const;
const TICKER_B = ["Kani-verified checker", "Hash pinned on-chain", "Fail-closed", "7-day certificate", "Timelocked upgrades", "Revocable by version", "Reproducible WASM"] as const;

/* ---------- small pieces ---------- */

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
      <div className="dither-band absolute inset-x-0 top-0 opacity-70" aria-hidden="true" />
      <div className="hatch pointer-events-none absolute inset-0 opacity-50" aria-hidden="true" />
      <div className="relative p-6 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="kicker">Clean-funds certificate</p>
            <p className="display mt-3 text-2xl text-foreground">
              Verdict only. <span className="text-accent">No history.</span>
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
  const [introDone, setIntroDone] = useState(false);

  // Safety net: if the preloader never reports back, show the hero anyway.
  useEffect(() => {
    const t = window.setTimeout(() => setIntroDone(true), 5000);
    return () => window.clearTimeout(t);
  }, []);

  // Hero intro waits for the preloader wipe.
  useGSAP(
    (_, contextSafe) => {
      if (!introDone) return;
      const ctx = root.current!;
      const q = gsap.utils.selector(ctx);
      const title = q("[data-hero-title]");
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce || !contextSafe) {
        gsap.set(title, { autoAlpha: 1 });
        return;
      }
      const intro = gsap.timeline({ defaults: { ease: "power4.out" } });
      const splitTitle = contextSafe(() => {
        const split = SplitText.create(title, { type: "lines", mask: "lines", linesClass: "line" });
        gsap.set(title, { autoAlpha: 1 });
        intro.from(split.lines, { yPercent: 110, duration: 1.1, stagger: 0.09 }, 0.1);
      });
      document.fonts.ready.then(splitTitle);
      intro.from(q("[data-hero-kicker]"), { y: 14, opacity: 0, duration: 0.6 }, 0);
      intro.from(q("[data-hero-copy] > *"), { y: 24, opacity: 0, duration: 0.8, stagger: 0.08 }, 0.6);
    },
    { scope: root, dependencies: [introDone] },
  );

  // Scroll-driven motion for everything below the fold.
  useGSAP(
    (_, contextSafe) => {
      const ctx = root.current!;
      const q = gsap.utils.selector(ctx);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce || !contextSafe) {
        (q("[data-count]") as HTMLElement[]).forEach((el) => {
          el.textContent = el.dataset.count ?? "";
        });
        return;
      }

      q("[data-reveal]").forEach((el) => {
        gsap.from(el, { y: 40, opacity: 0, duration: 0.9, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 88%" } });
      });
      q("[data-reveal-group]").forEach((group) => {
        gsap.from(group.children, { y: 36, opacity: 0, duration: 0.8, ease: "power3.out", stagger: 0.1, scrollTrigger: { trigger: group, start: "top 85%" } });
      });

      const splitHeadings = contextSafe(() => {
        q("[data-split]").forEach((el) => {
          const s = SplitText.create(el, { type: "lines,words", mask: "lines", linesClass: "line" });
          gsap.from(s.words, { yPercent: 100, opacity: 0, duration: 0.8, ease: "power3.out", stagger: 0.03, scrollTrigger: { trigger: el, start: "top 85%" } });
        });
      });
      document.fonts.ready.then(splitHeadings);

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

      // Steps: the rail fills as the list scrolls past.
      gsap.from(q("[data-steps-rail]"), { scaleY: 0, transformOrigin: "top", ease: "none", scrollTrigger: { trigger: q("[data-steps]"), start: "top 75%", end: "bottom 55%", scrub: 0.4 } });

      // Trail: the rail draws down as you scroll past it, rows light in sequence.
      gsap.from(q("[data-rail]"), { scaleY: 0, transformOrigin: "top", ease: "none", scrollTrigger: { trigger: q("[data-trail]"), start: "top 70%", end: "bottom 60%", scrub: 0.4 } });
      gsap.from(q("[data-trail-row]"), { x: -20, opacity: 0, duration: 0.6, stagger: 0.12, ease: "power3.out", scrollTrigger: { trigger: q("[data-trail]"), start: "top 75%" } });

      gsap.to(q("[data-orb]"), { yPercent: 18, ease: "none", scrollTrigger: { trigger: ctx, start: "top top", end: "40% top", scrub: true } });

      gsap.from(q("[data-swatch]"), { y: 80, opacity: 0, duration: 1, ease: "power3.out", stagger: 0.12, scrollTrigger: { trigger: q("[data-swatches]"), start: "top 80%" } });
    },
    { scope: root },
  );

  return (
    <div ref={root} className="nixo-landing">
      <Preloader onDone={() => setIntroDone(true)} />
      <ScrollProgress />
      <LandingCursor />
      <SiteNav />
      <main className="flex-1">
        {/* ------------------------------------------------ Hero */}
        <section className="relative flex min-h-svh flex-col overflow-hidden border-b border-line">
          <div
            data-orb
            className="pointer-events-none absolute inset-0"
            style={{ maskImage: "linear-gradient(to bottom, black 55%, transparent 100%)", WebkitMaskImage: "linear-gradient(to bottom, black 55%, transparent 100%)" }}
            aria-hidden="true"
          >
            <HalftoneBloom background="#000000" color1="#1a2a6c" color2="#5b6cff" speed={35} size={170} angle={160} dotSize={7} hover={180} reach={480} style={{ minWidth: 0, minHeight: 0 }} />
          </div>

          {/* Dithered flower in the empty right half (desktop only). */}
          <DitherFlower
            active={introDone}
            className="pointer-events-none absolute inset-y-0 right-0 hidden w-[min(46vw,640px)] lg:block"
            style={{ maskImage: "linear-gradient(to bottom, black 62%, transparent 100%)", WebkitMaskImage: "linear-gradient(to bottom, black 62%, transparent 100%)" }}
          />

          <div className="relative mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-4 pt-24 pb-12 sm:px-6 sm:pt-28 lg:pb-16">
            <div className="max-w-3xl">
              <p data-hero-kicker className="kicker flex items-center gap-3 text-muted">
                <span className="inline-block size-1.5 bg-accent" /> <ScrambleText text="NEAR Intents · Private AI · TEE-verified" duration={1200} />
              </p>

              <h1 data-hero-title style={{ visibility: "hidden" }} className="split-mask display mt-5 text-[clamp(2.25rem,5.5vw,4.5rem)] leading-[1.05] tracking-[-0.02em] text-foreground sm:mt-6">
                Your AI trades.
                <br />
                Nobody <span className="text-accent">watches.</span>
              </h1>

              <div data-hero-copy className="mt-7 sm:mt-8">
                <p className="max-w-md text-[15px] leading-relaxed text-muted sm:text-base">
                  AI agents read the market, plan a strategy and trade it through NEAR Intents. Your funds are proven clean inside a secure enclave, never your history.
                </p>

                <div className="mt-8 flex flex-wrap items-center gap-3 sm:mt-9">
                  <Magnetic>
                    <ConnectButton variant="primary" showError />
                  </Magnetic>
                  <Magnetic strength={0.18}>
                    <Link href="/verify" className="btn-secondary bg-black/50 backdrop-blur-sm">
                      Check any wallet <ArrowUpRight className="size-3.5" />
                    </Link>
                  </Magnetic>
                </div>
              </div>
            </div>
          </div>

          <Marquee items={TICKER_A} />
        </section>

        {/* ------------------------------------------------ Stats */}
        <section className="border-b border-line">
          <div data-reveal-group className="mx-auto grid max-w-7xl grid-cols-2 lg:grid-cols-4">
            {STATS.map((s, i) => (
              <div key={s.k} className={`px-4 py-9 sm:px-6 ${i % 2 ? "border-l" : ""} ${i >= 2 ? "border-t lg:border-t-0" : ""} ${i === 2 ? "lg:border-l" : ""} border-line`}>
                <p className="kicker">{s.k}</p>
                <p className="display mt-4 text-4xl text-foreground sm:text-5xl">
                  <span data-count={s.n}>0</span>
                  <span className="text-accent">{s.suffix}</span>
                </p>
                <p className="mt-2 font-mono text-[11px] text-muted">{s.s}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------ Product bento */}
        <FeatureBento />

        <Marquee items={TICKER_B} reverse />

        {/* ------------------------------------------------ How it works */}
        <section id="how" className="scroll-mt-20 border-b border-line bg-surface">
          <div className="mx-auto max-w-7xl px-4 py-28 sm:px-6">
            <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
              <div>
                <p className="kicker">How it works</p>
                <h2 data-split className="split-mask display mt-5 text-[clamp(2rem,4.5vw,4rem)]">
                  Clean in.
                  <br />
                  <span className="text-accent">Private</span> trading.
                  <br />
                  Clean out.
                </h2>
              </div>
              <div data-steps className="relative pl-6">
                <span className="pointer-events-none absolute top-0 bottom-0 left-0 w-px bg-line" aria-hidden="true" />
                <span data-steps-rail className="pointer-events-none absolute top-0 bottom-0 left-0 w-px bg-accent shadow-[0_0_10px_var(--accent)]" aria-hidden="true" />
                <ol data-reveal-group className="grid gap-px border border-line bg-line sm:grid-cols-2">
                  {STEPS.map((s) => (
                    <li key={s.n} className="group bg-black p-7 transition-colors hover:bg-surface-2">
                      <p className="display text-3xl text-accent">{s.n}</p>
                      <p className="display mt-6 text-xl text-foreground">{s.t}</p>
                      <p className="mt-3 text-sm leading-relaxed text-muted">{s.d}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ Encryption beam */}
        <EncryptionBeam />

        {/* ------------------------------------------------ Real trail */}
        <section className="mx-auto grid max-w-7xl gap-14 border-t border-line px-4 py-28 sm:px-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="kicker">Real data · NEAR mainnet</p>
            <h2 data-split className="split-mask display mt-5 text-[clamp(2rem,4.5vw,4rem)]">
              A laundering trail, caught <span className="text-reject">four hops</span> out.
            </h2>
            <p data-reveal className="mt-7 text-sm leading-relaxed text-muted">
              After the Binance hack of 29 Oct 2026, stolen funds moved through fresh wallets and a brand-new memecoin pool on Ref Finance. A list check only
              sees the first wallet. NIXO follows transfers and pool hops (a swap in and an opposite swap out of the same pool within 120 seconds, amounts
              within 15%), so the wallet at the end is rejected too.
            </p>
            <p data-reveal className="mt-4 text-xs text-muted">
              The listed wallet is attributed publicly by on-chain analysts AMLBot and Shridlock. That is not an official attribution.
            </p>
            <div data-reveal className="mt-8">
              <Magnetic strength={0.18}>
                <Link href="/verify" className="btn-secondary">
                  Trace it yourself <ArrowUpRight className="size-3.5" />
                </Link>
              </Magnetic>
            </div>
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
              What stays <span className="text-accent">private</span>, and how.
            </h2>
            <div data-swatches className="mt-14 grid gap-4 lg:grid-cols-3">
              {PRIVACY.map(({ icon: Icon, t, s, d, status, tone }) => {
                const light = tone !== "gradient";
                const bg = tone === "white" ? "bg-white text-black" : tone === "yellow" ? "bg-accent text-accent-ink" : "gradient-blue text-white";
                return (
                  <div key={t} data-swatch className={`flex min-h-[460px] flex-col rounded-3xl p-8 ${bg}`}>
                    <div className="flex items-center justify-between">
                      <Icon className="size-5" strokeWidth={1.6} />
                      <StatusTag status={status} onLight={light} />
                    </div>
                    <p className={`mt-8 font-mono text-[10px] tracking-[0.22em] uppercase ${light ? "text-black/60" : "text-white/60"}`}>{s}</p>
                    <p className="display mt-2 text-2xl">{t}</p>
                    <p className={`mt-4 text-sm leading-relaxed ${light ? "text-black/70" : "text-white/75"}`}>{d}</p>
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
              Add NIXO in <span className="text-accent">three</span> lines.
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

        {/* ------------------------------------------------ CTA over the dither field */}
        <section className="landing-cta">
          <DitherField colorB="#d4fe08" colorC="#191d32" exposure={0.82} pixel={6} levels={5} scale={1.3} speed={0.9} />
          <div className="landing-cta-vignette" aria-hidden="true" />
          <div className="relative mx-auto max-w-7xl px-4 py-32 text-center sm:px-6 sm:py-40">
            <p className="kicker">Ready when you are</p>
            <h2 className="display mt-6 text-[clamp(2.5rem,8vw,7rem)] text-foreground">
              <ScrambleText text="Open the desk." duration={1200} />
            </h2>
            <div className="mt-10 flex justify-center">
              <Magnetic>
                <ConnectButton variant="primary" />
              </Magnetic>
            </div>
            <p className="mt-6 text-xs text-muted">NEAR testnet demo · certificates expire after 7 days</p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

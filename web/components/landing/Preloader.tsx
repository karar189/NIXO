"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import DitherField from "./DitherField";
import { CipherText } from "./CipherText";
import { Logo } from "@/components/site/Logo";

const KEY = "nixo:intro";

/**
 * First-visit intro: a dithered field, the wordmark decrypting, and the
 * enclave's checklist ticking through before the page wipes in.
 * Plays once per tab session and never under reduced motion.
 */
export function Preloader({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(true);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let seen = false;
    try {
      seen = sessionStorage.getItem(KEY) === "1";
    } catch {}
    if (reduce || seen) {
      setMounted(false);
      doneRef.current();
      return;
    }

    // The session flag is written only when the intro finishes. React's dev-mode
    // double effect run kills and restarts the timeline; writing the flag up
    // front would make the second run skip the intro entirely.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // gsap.context so cleanup reverts inline styles; a killed from() tween would
    // otherwise leave the elements at opacity 0 for the dev-mode second run.
    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(el);
      gsap
        .timeline({
          defaults: { ease: "power2.out" },
          onComplete: () => {
            try {
              sessionStorage.setItem(KEY, "1");
            } catch {}
            document.body.style.overflow = prevOverflow;
            setMounted(false);
            doneRef.current();
          },
        })
        .from(q("[data-pl-mark]"), { opacity: 0, y: 10, duration: 0.5 }, 0.1)
        .from(q("[data-pl-line]"), { opacity: 0, y: 8, duration: 0.4, stagger: 0.26 }, 0.7)
        .to(q("[data-pl-bar]"), { scaleX: 1, duration: 1.7, ease: "power2.inOut" }, 0.3)
        .to(q("[data-pl-verdict]"), { opacity: 1, duration: 0.3 }, 1.9)
        .to(q("[data-pl-inner]"), { opacity: 0, y: -12, duration: 0.4, ease: "power2.in" }, 2.5)
        .to(el, { clipPath: "inset(0 0 100% 0)", duration: 0.85, ease: "power4.inOut" }, 2.6);
    }, el);

    return () => {
      ctx.revert();
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  if (!mounted) return null;
  return (
    <div ref={ref} className="preloader" aria-hidden="true">
      <DitherField className="preloader-field" colorB="#8e9bff" colorC="#191d32" exposure={0.95} pixel={5} levels={3} speed={1.6} hover={0} />
      <div className="preloader-vignette" />
      <div data-pl-inner className="preloader-inner">
        <div data-pl-mark className="preloader-mark">
          <Logo />
        </div>
        <p className="preloader-title display">
          <CipherText text="NIXO" speed={110} startDelay={300} />
        </p>
        <ul className="preloader-lines">
          <li data-pl-line>attesting enclave · Intel TDX</li>
          <li data-pl-line>sanctions snapshot · 2026-10-29</li>
          <li data-pl-line>checker e0c79a99…11bed6 · pinned</li>
          <li data-pl-verdict className="is-verdict">
            verdict · <b>clean</b>
          </li>
        </ul>
        <span className="preloader-bar">
          <i data-pl-bar />
        </span>
      </div>
    </div>
  );
}

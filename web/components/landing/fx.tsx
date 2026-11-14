"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const GLYPHS = "ABCDEF0123456789#%&*+=/<>";

/** True when the visitor asked the OS for less motion. False until mounted. */
export function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduce(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduce;
}

/** Decodes from random glyphs into the real text when it scrolls into view. */
export function ScrambleText({ text, className, duration = 900 }: { text: string; className?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = usePrefersReducedMotion();
  const [out, setOut] = useState(text);

  useEffect(() => {
    const el = ref.current;
    if (!el || reduce) return;
    let frame = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / duration);
          const revealed = Math.floor(t * text.length);
          setOut(
            text
              .split("")
              .map((ch, i) => (ch === " " || i < revealed ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]))
              .join(""),
          );
          if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [reduce, text, duration]);

  return (
    <span ref={ref} className={className} aria-label={text}>
      <span aria-hidden="true">{out}</span>
    </span>
  );
}

/** Pulls its child toward the pointer while hovered, springs back on leave. */
export function Magnetic({ children, strength = 0.28, className = "" }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = usePrefersReducedMotion();

  function onMove(event: ReactPointerEvent<HTMLSpanElement>) {
    const el = ref.current;
    if (!el || reduce || event.pointerType !== "mouse") return;
    const rect = el.getBoundingClientRect();
    gsap.to(el, {
      x: (event.clientX - rect.left - rect.width / 2) * strength,
      y: (event.clientY - rect.top - rect.height / 2) * strength,
      duration: 0.5,
      ease: "power3.out",
      overwrite: "auto",
    });
  }
  function reset() {
    if (ref.current) gsap.to(ref.current, { x: 0, y: 0, duration: 0.9, ease: "elastic.out(1, 0.45)", overwrite: "auto" });
  }

  return (
    <span ref={ref} className={`magnetic ${className}`} onPointerMove={onMove} onPointerLeave={reset}>
      {children}
    </span>
  );
}

/** Card with a pointer-following spotlight, a lit border and a slight 3D tilt. */
export function SpotlightCard({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = usePrefersReducedMotion();

  function onMove(event: ReactPointerEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    el.style.setProperty("--spot-x", `${px * 100}%`);
    el.style.setProperty("--spot-y", `${py * 100}%`);
    if (!reduce && event.pointerType === "mouse") {
      gsap.to(el, { rotateX: (0.5 - py) * 6, rotateY: (px - 0.5) * 8, transformPerspective: 900, duration: 0.5, ease: "power3.out", overwrite: "auto" });
    }
  }
  function reset() {
    if (ref.current) gsap.to(ref.current, { rotateX: 0, rotateY: 0, duration: 0.7, ease: "power3.out", overwrite: "auto" });
  }

  return (
    <div ref={ref} className={`spot-card ${className}`} style={style} onPointerMove={onMove} onPointerLeave={reset}>
      {children}
    </div>
  );
}

/** Hairline at the top of the viewport that fills with page scroll. */
export function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tween = gsap.fromTo(el, { scaleX: 0 }, { scaleX: 1, ease: "none", scrollTrigger: { start: 0, end: "max", scrub: 0.3 } });
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, []);
  return <div ref={ref} className="scroll-progress" aria-hidden="true" />;
}

/** Ring cursor that grows and inverts over anything interactive. Mouse only. */
const CURSOR_QUERIES = ["(pointer: fine)", "(prefers-reduced-motion: reduce)"];
function subscribeCursorMedia(cb: () => void) {
  const lists = CURSOR_QUERIES.map((q) => window.matchMedia(q));
  lists.forEach((l) => l.addEventListener("change", cb));
  return () => lists.forEach((l) => l.removeEventListener("change", cb));
}
function cursorWanted() {
  return window.matchMedia("(pointer: fine)").matches && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function LandingCursor() {
  // false on the server and during hydration, then follows the media queries.
  const ready = useSyncExternalStore(subscribeCursorMedia, cursorWanted, () => false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!ready || !el) return;
    document.documentElement.classList.add("landing-cursor-on");
    const xTo = gsap.quickTo(el, "x", { duration: 0.16, ease: "power3.out" });
    const yTo = gsap.quickTo(el, "y", { duration: 0.16, ease: "power3.out" });
    const onMove = (event: PointerEvent) => {
      xTo(event.clientX);
      yTo(event.clientY);
      el.classList.add("is-visible");
      const target = event.target instanceof Element ? event.target : null;
      el.classList.toggle("is-invert", Boolean(target?.closest("a, button, [role='button'], .spot-card, summary, input, select, textarea")));
    };
    const onLeave = () => el.classList.remove("is-visible");
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      document.documentElement.classList.remove("landing-cursor-on");
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, [ready]);

  if (!ready) return null;
  return createPortal(<div ref={ref} className="landing-cursor" aria-hidden="true" />, document.body);
}

/** Infinite ticker. The whole band also slides with scroll, so it feels attached to the page. */
export function Marquee({ items, reverse = false, className = "" }: { items: readonly string[]; reverse?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const shiftRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    const shift = shiftRef.current;
    if (!el || !shift) return;
    const tween = gsap.fromTo(
      shift,
      { xPercent: reverse ? -10 : 0 },
      { xPercent: reverse ? 0 : -10, ease: "none", scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: 0.6 } },
    );
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [reverse]);

  const row = [...items, ...items, ...items];
  return (
    <div ref={ref} className={`fx-marquee ${reverse ? "is-reverse" : ""} ${className}`} aria-hidden="true">
      <div ref={shiftRef} className="fx-marquee-shift">
        <div className="fx-marquee-track">
          {row.map((item, i) => (
            <span key={`${item}-${i}`} className="fx-marquee-item">
              {item}
              <span className="fx-marquee-sep">
                <i />
                <i />
                <i />
                <i />
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

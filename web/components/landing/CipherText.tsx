"use client";

import { useEffect, useRef, useState } from "react";

const POOL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=<>/";

/**
 * Text that starts as cipher glyphs and decrypts left to right.
 * `loop` re-encrypts after `holdMs` and decrypts again, for loading states.
 * Renders the plain text on the server so hydration matches; the effect scrambles it.
 */
export function CipherText({
  text,
  loop = false,
  speed = 38,
  holdMs = 700,
  startDelay = 0,
  className = "",
  onDone,
}: {
  text: string;
  loop?: boolean;
  /** ms per character step */
  speed?: number;
  holdMs?: number;
  startDelay?: number;
  className?: string;
  onDone?: () => void;
}) {
  const [frame, setFrame] = useState<{ chars: string[]; revealed: number }>({ chars: text.split(""), revealed: text.length });
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      // Initial state is already the plain text.
      doneRef.current?.();
      return;
    }
    const scramble = (n: number) => text.split("").map((ch, i) => (ch === " " || i < n ? ch : POOL[Math.floor(Math.random() * POOL.length)]));
    let timer = 0;
    let revealed = 0;
    let direction = 1;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      revealed = Math.max(0, Math.min(text.length, revealed + direction));
      setFrame({ chars: scramble(revealed), revealed });
      if (direction > 0 && revealed >= text.length) {
        if (!loop) {
          doneRef.current?.();
          return;
        }
        direction = -1;
        timer = window.setTimeout(tick, holdMs);
        return;
      }
      if (direction < 0 && revealed <= 0) {
        direction = 1;
        timer = window.setTimeout(tick, holdMs / 2);
        return;
      }
      timer = window.setTimeout(tick, speed);
    };

    setFrame({ chars: scramble(0), revealed: 0 });
    timer = window.setTimeout(tick, startDelay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [text, loop, speed, holdMs, startDelay]);

  return (
    <span className={`cipher-text ${className}`} aria-label={text}>
      <span aria-hidden="true">
        {frame.chars.map((ch, i) => (
          <span key={i} className={i < frame.revealed || ch === " " ? undefined : "is-cipher"}>
            {ch}
          </span>
        ))}
      </span>
    </span>
  );
}

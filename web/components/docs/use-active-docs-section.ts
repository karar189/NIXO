"use client";

import { useEffect, useState } from "react";

/** Pixels from the viewport top that count as "currently reading". Matches the sticky header + scroll-mt-28. */
const READ_LINE = 120;

function sectionId(href: string) {
  return href.startsWith("#") ? href.slice(1) : href;
}

/** Scroll-spy: returns the `#id` of the section currently under the read line. */
export function useActiveDocsSection(hrefs: readonly string[]): string {
  const [active, setActive] = useState(hrefs[0] ?? "");
  const hrefKey = hrefs.join("|");

  useEffect(() => {
    const list = hrefKey ? hrefKey.split("|") : [];
    if (list.length === 0) return;

    const update = () => {
      let current = list[0];
      for (const href of list) {
        const el = document.getElementById(sectionId(href));
        if (!el) continue;
        if (el.getBoundingClientRect().top <= READ_LINE) current = href;
      }
      setActive(current);
    };

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("hashchange", onScroll);
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("hashchange", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [hrefKey]);

  return active;
}

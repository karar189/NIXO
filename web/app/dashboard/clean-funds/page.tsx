"use client";

import { useEffect } from "react";

/** Legacy URL — Clean funds now lives under Privacy. */
export default function CleanFundsRedirect() {
  useEffect(() => {
    const hash = window.location.hash;
    const target =
      hash === "#wallet" || hash === "#demo" || hash === "#clean-funds"
        ? `/dashboard/privacy${hash}`
        : "/dashboard/privacy#clean-funds";
    window.location.replace(target);
  }, []);

  return <p className="p-8 text-sm text-muted">Redirecting to Privacy…</p>;
}

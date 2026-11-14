"use client";

import { useEffect } from "react";

/** Legacy URL — Mock solver now lives under Privacy. */
export default function SolverRedirect() {
  useEffect(() => {
    window.location.replace("/dashboard/privacy#solver");
  }, []);

  return <p className="p-8 text-sm text-muted">Redirecting to Privacy…</p>;
}

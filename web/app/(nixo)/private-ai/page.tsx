"use client";

import { useEffect } from "react";

/** Legacy URL — Private AI now lives under Privacy. */
export default function PrivateAiRedirect() {
  useEffect(() => {
    window.location.replace("/dashboard/privacy#private-ai");
  }, []);

  return <p className="p-8 text-sm text-muted">Redirecting to Privacy…</p>;
}

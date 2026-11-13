"use client";

import { useState, type FormEvent } from "react";

type Status = "idle" | "sending" | "done" | "error";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

export function Waitlist() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    try {
      const res = await fetch(`${BACKEND_URL}/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? "Something went wrong.");
      }
      setStatus("done");
      setMessage("You're on the list. We'll be in touch.");
      setEmail("");
    } catch (err) {
      setStatus("error");
      setMessage(
        err instanceof TypeError
          ? "Couldn't reach the server. Try again shortly."
          : (err as Error).message,
      );
    }
  }

  return (
    <section id="waitlist" className="scroll-mt-20 border-t border-line/60 py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl border border-line bg-surface px-6 py-14 text-center sm:px-12">
          <div
            className="pointer-events-none absolute -bottom-32 left-1/2 h-64 w-[600px] -translate-x-1/2 rounded-full bg-accent/10 blur-[100px]"
            aria-hidden="true"
          />
          <h2 className="relative text-3xl font-semibold tracking-tight sm:text-4xl">
            Get early access
          </h2>
          <p className="relative mx-auto mt-4 max-w-lg text-muted">
            We&apos;re opening the testnet preview in small batches. Leave your
            email and we&apos;ll let you know when it&apos;s your turn.
          </p>
          <form
            onSubmit={onSubmit}
            className="relative mx-auto mt-8 flex max-w-md flex-col gap-3 sm:flex-row"
          >
            <label htmlFor="waitlist-email" className="sr-only">
              Email address
            </label>
            <input
              id="waitlist-email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-w-0 flex-1 rounded-full border border-line bg-background px-5 py-3 text-sm placeholder:text-muted/70 focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={status === "sending"}
              className="rounded-full bg-accent px-6 py-3 text-sm font-medium text-background transition hover:brightness-110 disabled:opacity-60"
            >
              {status === "sending" ? "Joining…" : "Join waitlist"}
            </button>
          </form>
          <p
            role="status"
            aria-live="polite"
            className={`relative mt-4 min-h-5 text-sm ${status === "error" ? "text-danger" : "text-accent"}`}
          >
            {status === "done" || status === "error" ? message : ""}
          </p>
        </div>
      </div>
    </section>
  );
}

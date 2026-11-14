"use client";

import { Check } from "lucide-react";
import { useDashboardData } from "./DashboardData";
import { Card } from "./Card";

export function GettingStarted() {
  const { balance } = useDashboardData();
  const funded = Boolean(balance.data && balance.data.total > 0n);

  const steps = [
    { title: "Connect Meteor Wallet", body: "Your NEAR account is linked.", done: true },
    {
      title: "Fund your account",
      body: "Hold some NEAR to cover agent sub-accounts and gas.",
      done: funded,
    },
    {
      title: "Create your first agent",
      body: "Spin up a sub-account with a scoped, revocable key.",
      done: false,
    },
    { title: "Run a paper trade", body: "Test a plan against simulated fills.", done: false },
    { title: "Go live", body: "Let the agent execute approved plans via NEAR Intents.", done: false },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Card
      title="Getting started"
      action={<span className="font-mono text-xs text-muted">{doneCount}/{steps.length}</span>}
    >
      <div className="mb-5 h-1 overflow-hidden rounded-full bg-surface-2">
        <span
          className="block h-full rounded-full bg-gradient-to-r from-accent to-accent-2 transition-[width]"
          style={{ width: `${(doneCount / steps.length) * 100}%` }}
        />
      </div>
      <ol className="space-y-4">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span
              className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] ${
                s.done ? "border-accent/40 bg-accent/15 text-accent" : "border-line text-muted"
              }`}
            >
              {s.done ? <Check className="size-3.5" /> : i + 1}
            </span>
            <div>
              <p className={`text-sm font-medium ${s.done ? "text-muted line-through decoration-muted/40" : ""}`}>
                {s.title}
              </p>
              <p className="mt-0.5 text-xs leading-5 text-muted">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

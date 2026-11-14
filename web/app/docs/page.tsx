import type { Metadata } from "next";
import { DocsChapter, DocsShell } from "@/components/docs/docs-shell";
import { DevelopersChapter } from "./_chapters/developers";
import { IntroChapter } from "./_chapters/intro";
import { PrivateAiChapter } from "./_chapters/private-ai";
import { SolverChapter } from "./_chapters/solver";
import { StatusChapter } from "./_chapters/status";
import { TracerChapter } from "./_chapters/tracer";
import { TradingChapter } from "./_chapters/trading";
import { VaultChapter } from "./_chapters/vault";

export const metadata: Metadata = {
  title: "Docs · NIXO",
  description:
    "NIXO is a clean-funds passport and a gated trading layer for NEAR: a TEE-checked certificate, a vault that only accepts certified deposits, and a fail-closed gate for solvers.",
};

/** All docs on one continuous page, in DOCS_NAV order. Old /docs/<chapter> URLs redirect here (next.config.ts). */
export default function DocsPage() {
  return (
    <DocsShell>
      <DocsChapter chapter="" first>
        <IntroChapter />
      </DocsChapter>
      <DocsChapter chapter="tracer">
        <TracerChapter />
      </DocsChapter>
      <DocsChapter chapter="vault">
        <VaultChapter />
      </DocsChapter>
      <DocsChapter chapter="solver">
        <SolverChapter />
      </DocsChapter>
      <DocsChapter chapter="trading">
        <TradingChapter />
      </DocsChapter>
      <DocsChapter chapter="private-ai">
        <PrivateAiChapter />
      </DocsChapter>
      <DocsChapter chapter="developers">
        <DevelopersChapter />
      </DocsChapter>
      <DocsChapter chapter="status">
        <StatusChapter />
      </DocsChapter>
    </DocsShell>
  );
}

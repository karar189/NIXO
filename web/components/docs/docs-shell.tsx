"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, BookOpen } from "lucide-react";
import { Logo } from "@/components/site/Logo";
import { NIXO_EXPLORER, REPO_URL, chapterHref, docsHref, sectionAnchor } from "./links";
import { useActiveDocsSection } from "./use-active-docs-section";

export type DocsNavChild = { id: string; label: string };

/** One chapter of the single docs page. `chapter` prefixes its section ids; the intro uses "". */
export type DocsNavItem = {
  chapter: string;
  label: string;
  children: readonly DocsNavChild[];
};

export type DocsNavSection = {
  label: string;
  items: readonly DocsNavItem[];
};

/** Single source of truth for the chapter order, the sidebar, the mobile chips and the "On this page" outline. */
export const DOCS_NAV: readonly DocsNavSection[] = [
  {
    label: "Start here",
    items: [
      {
        chapter: "",
        label: "What NIXO is",
        children: [
          { id: "overview", label: "Overview" },
          { id: "problem", label: "The problem" },
          { id: "layers", label: "Three layers" },
          { id: "surfaces", label: "Product surfaces" },
          { id: "audience", label: "Who it is for" },
          { id: "tour", label: "90-second tour" },
        ],
      },
      {
        chapter: "deployments",
        label: "Live deployment",
        children: [
          { id: "mainnet", label: "Mainnet contracts" },
          { id: "testnet", label: "Testnet contracts" },
          { id: "parity", label: "Same code everywhere" },
          { id: "hosted", label: "Hosted services" },
          { id: "network", label: "Switching networks" },
        ],
      },
    ],
  },
  {
    label: "Layer 1",
    items: [
      {
        chapter: "tracer",
        label: "Clean-funds passport",
        children: [
          { id: "status", label: "Deployment status" },
          { id: "what", label: "What this is" },
          { id: "lifecycle", label: "Certificate lifecycle" },
          { id: "checker", label: "The checker" },
          { id: "verdicts", label: "Verdicts and reasons" },
          { id: "trace", label: "Multi-hop trace" },
          { id: "lists", label: "Sanctions and hacker lists" },
          { id: "history", label: "History sources" },
          { id: "certificate", label: "Certificate fields" },
          { id: "governance", label: "Hash pinning and revocation" },
          { id: "kani", label: "Formal verification" },
          { id: "visibility", label: "What is hidden from whom" },
          { id: "preview", label: "Check any wallet" },
        ],
      },
    ],
  },
  {
    label: "Layer 2",
    items: [
      {
        chapter: "vault",
        label: "Vault and agents",
        children: [
          { id: "overview", label: "What the vault is" },
          { id: "deposit", label: "Deposit gate" },
          { id: "assign", label: "Assign an agent" },
          { id: "execute", label: "Execute and limits" },
          { id: "exit", label: "Revoke and withdraw" },
          { id: "fc-key", label: "Function-call key" },
          { id: "experiment", label: "Two-agent experiment" },
          { id: "suite", label: "Adversarial suite" },
          { id: "viewing", label: "Viewing keys" },
          { id: "ui", label: "Dashboard" },
        ],
      },
    ],
  },
  {
    label: "Layer 3",
    items: [
      {
        chapter: "solver",
        label: "Solver gate",
        children: [
          { id: "overview", label: "What the gate is" },
          { id: "rules", label: "Fail-closed rules" },
          { id: "sdk", label: "checkIntent" },
          { id: "mock", label: "Mock solver" },
          { id: "try", label: "Try it" },
          { id: "limits", label: "What it is not" },
        ],
      },
    ],
  },
  {
    label: "Desk",
    items: [
      {
        chapter: "trading",
        label: "Trading desk",
        children: [
          { id: "overview", label: "What the desk is" },
          { id: "swap", label: "Confidential swaps" },
          { id: "flow", label: "Swap lifecycle" },
          { id: "paper", label: "Paper desk" },
          { id: "agents", label: "AI trading agents" },
          { id: "live", label: "Live AI agent" },
          { id: "models", label: "Model providers" },
        ],
      },
      {
        chapter: "copy-trading",
        label: "Copy-trading keys",
        children: [
          { id: "overview", label: "What it is" },
          { id: "flow", label: "How it works" },
          { id: "contract", label: "copykeys contract" },
          { id: "limits", label: "What it does not do" },
        ],
      },
      {
        chapter: "private-ai",
        label: "Private AI",
        children: [
          { id: "overview", label: "What it is" },
          { id: "explainer", label: "Certificate explainer" },
          { id: "attestation", label: "Attestation checks" },
          { id: "retention", label: "No retention" },
          { id: "try", label: "Try it" },
        ],
      },
    ],
  },
  {
    label: "Reference",
    items: [
      {
        chapter: "developers",
        label: "Developer reference",
        children: [
          { id: "contracts", label: "Deployed contracts" },
          { id: "nixo-methods", label: "Certificate methods" },
          { id: "vault-methods", label: "Vault methods" },
          { id: "events", label: "Events" },
          { id: "web-api", label: "Web API routes" },
          { id: "agents-api", label: "Agents API" },
          { id: "sdk", label: "TypeScript SDKs" },
          { id: "run", label: "Run locally" },
          { id: "env", label: "Environment" },
          { id: "tests", label: "Tests and CI" },
        ],
      },
      {
        chapter: "status",
        label: "Status and limits",
        children: [
          { id: "real", label: "Real vs mocked" },
          { id: "trust", label: "Trust assumptions" },
          { id: "not", label: "What NIXO does not claim" },
          { id: "related", label: "Related work" },
          { id: "roadmap", label: "Roadmap" },
        ],
      },
    ],
  },
];

const CHAPTERS = DOCS_NAV.flatMap((section) => section.items);

function sectionHref(chapter: string, id: string) {
  return `#${sectionAnchor(chapter, id)}`;
}

/** Every section on the page, in reading order, for the scroll-spy. */
const ALL_SECTION_HREFS = CHAPTERS.flatMap((item) => item.children.map((child) => sectionHref(item.chapter, child.id)));

function chapterOf(href: string): DocsNavItem {
  return CHAPTERS.find((item) => item.children.some((child) => sectionHref(item.chapter, child.id) === href)) ?? CHAPTERS[0];
}

export function DocsShell({ children }: { children: ReactNode }) {
  const activeSection = useActiveDocsSection(ALL_SECTION_HREFS);
  const activeChapter = chapterOf(activeSection);

  // Keep the highlighted entry visible in both scrolling side rails.
  useEffect(() => {
    if (!activeSection) return;
    const selector = `[data-docs-outline="${CSS.escape(activeSection)}"], [data-docs-nav="${CSS.escape(activeSection)}"]`;
    document.querySelectorAll(selector).forEach((el) => el.scrollIntoView({ block: "nearest" }));
  }, [activeSection]);

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-line bg-black/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 sm:px-8 lg:px-10">
          <div className="flex items-center gap-4">
            <Link href="/" aria-label="NIXO home" className="text-foreground">
              <Logo />
            </Link>
            <span className="h-5 w-px bg-line" aria-hidden />
            <Link href="/docs" className="kicker !text-[11px] transition-colors hover:text-accent">
              Docs
            </Link>
          </div>

          <nav className="flex items-center gap-5">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1.5 text-xs text-muted transition-colors hover:text-foreground sm:inline-flex"
            >
              Source
              <ArrowUpRight className="size-3.5" />
            </a>
            <Link href="/dashboard" className="btn-primary !px-4 !py-2.5 !text-[11px]">
              Open app
              <ArrowRight className="size-3.5" />
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1440px] grid-cols-[minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,840px)_220px]">
        <aside className="hidden border-r border-line lg:block">
          <div className="sticky top-16 h-[calc(100svh-4rem)] overflow-y-auto px-7 py-10">
            <p className="mb-8 flex items-center gap-2 text-xs font-semibold text-foreground">
              <BookOpen className="size-4 text-accent" />
              Documentation
            </p>
            <nav className="space-y-8" aria-label="Documentation">
              {DOCS_NAV.map((section) => (
                <div key={section.label}>
                  <p className="kicker mb-3">{section.label}</p>
                  <div className="space-y-3">
                    {section.items.map((item) => {
                      const active = item.chapter === activeChapter.chapter;
                      return (
                        <div key={item.chapter || "intro"}>
                          <a
                            href={chapterHref(item.chapter)}
                            aria-current={active ? "true" : undefined}
                            className={`block border-l-2 py-1.5 pl-3 text-[13px] transition-colors ${
                              active
                                ? "border-accent font-medium text-foreground"
                                : "border-transparent text-muted hover:border-accent/50 hover:text-foreground"
                            }`}
                          >
                            {item.label}
                          </a>
                          {active && (
                            <div className="mt-0.5 space-y-0.5 border-l border-line pl-3">
                              {item.children.map((child) => {
                                const href = sectionHref(item.chapter, child.id);
                                const sectionActive = href === activeSection;
                                return (
                                  <a
                                    key={href}
                                    href={href}
                                    data-docs-nav={href}
                                    aria-current={sectionActive ? "location" : undefined}
                                    className={`block py-1 pl-3 text-[12px] leading-4 transition-colors ${
                                      sectionActive ? "font-medium text-accent" : "text-muted hover:text-foreground"
                                    }`}
                                  >
                                    {child.label}
                                  </a>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>

            <div className="mt-10 space-y-3 border-t border-line pt-6">
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground"
              >
                Source on GitHub
                <ArrowUpRight className="size-3.5" />
              </a>
              <a
                href={NIXO_EXPLORER}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground"
              >
                nixo.testnet on explorer
                <ArrowUpRight className="size-3.5" />
              </a>
            </div>
          </div>
        </aside>

        <main className="min-w-0 px-4 py-12 sm:px-8 sm:py-16 lg:px-12 xl:px-14">
          <div className="mb-10 flex gap-2 overflow-x-auto pb-2 lg:hidden">
            {CHAPTERS.flatMap((item) => {
              const active = item.chapter === activeChapter.chapter;
              return [
                <a
                  key={item.chapter || "intro"}
                  href={chapterHref(item.chapter)}
                  className={`shrink-0 border px-3 py-2 text-xs ${
                    active ? "border-accent bg-accent/10 text-foreground" : "border-line bg-surface text-muted"
                  }`}
                >
                  {item.label}
                </a>,
                ...(active
                  ? item.children.map((child) => {
                      const href = sectionHref(item.chapter, child.id);
                      return (
                      <a
                        key={href}
                        href={href}
                        aria-current={href === activeSection ? "location" : undefined}
                        className={`shrink-0 border px-3 py-2 text-xs ${
                          href === activeSection
                            ? "border-accent/60 bg-surface font-medium text-accent"
                            : "border-line bg-black text-muted"
                        }`}
                      >
                        {child.label}
                      </a>
                      );
                    })
                  : []),
              ];
            })}
          </div>
          {children}
          <footer className="mt-20 flex flex-col gap-4 border-t border-line py-8 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
            <span className="kicker">NIXO · NEAR testnet · {new Date().getFullYear()}</span>
            <div className="flex flex-wrap gap-5">
              <Link href="/" className="hover:text-accent">Home</Link>
              <a href="#tracer" className="hover:text-accent">Passport</a>
              <a href="#vault" className="hover:text-accent">Vault</a>
              <a href="#solver" className="hover:text-accent">Solver</a>
              <a href="#developers" className="hover:text-accent">Reference</a>
              <Link href="/verify" className="hover:text-accent">Exchange view</Link>
            </div>
          </footer>
        </main>

        <aside className="hidden xl:block">
          <div className="sticky top-16 h-[calc(100svh-4rem)] overflow-y-auto px-7 py-10">
            <p className="kicker">On this page</p>
            <p className="mt-4 text-xs font-semibold text-foreground">{activeChapter.label}</p>
            <nav className="mt-3 space-y-1 text-xs" aria-label="On this page">
              {activeChapter.children.map((item) => {
                const href = sectionHref(activeChapter.chapter, item.id);
                const sectionActive = href === activeSection;
                return (
                  <a
                    key={href}
                    href={href}
                    data-docs-outline={href}
                    aria-current={sectionActive ? "location" : undefined}
                    className={`block border-l-2 py-1 pl-3 leading-4 transition-colors ${
                      sectionActive
                        ? "border-accent font-medium text-foreground"
                        : "border-transparent text-muted hover:text-accent"
                    }`}
                  >
                    {item.label}
                  </a>
                );
              })}
            </nav>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ---------- building blocks ----------

const ChapterContext = createContext({ chapter: "", first: true });

/**
 * One chapter of the continuous docs page. Prefixes the ids of the sections inside it and draws the divider
 * that separates it from the chapter before, so the reader scrolls straight on instead of hitting a page end.
 */
export function DocsChapter({ chapter, first = false, children }: { chapter: string; first?: boolean; children: ReactNode }) {
  return (
    <ChapterContext value={{ chapter, first }}>
      {first ? (
        children
      ) : (
        <div id={chapter} className="relative mt-32 scroll-mt-28 border-t border-line pt-24">
          <span className="absolute -top-px left-0 h-px w-24 bg-accent" aria-hidden />
          {children}
        </div>
      )}
    </ChapterContext>
  );
}

/** Chapter title block: kicker, display headline, lead paragraph(s), optional actions. Only the first chapter's is the h1. */
export function PageHeader({
  kicker,
  title,
  muted,
  children,
}: {
  kicker: string;
  title: string;
  muted?: string;
  children?: ReactNode;
}) {
  const Heading = useContext(ChapterContext).first ? "h1" : "h2";
  return (
    <>
      <p className="kicker !text-accent">{kicker}</p>
      <Heading className="display mt-4 max-w-3xl text-[clamp(2.4rem,6vw,4.4rem)]">
        {title}
        {muted && (
          <>
            <br />
            <span className="text-muted">{muted}</span>
          </>
        )}
      </Heading>
      {children}
    </>
  );
}

/** Top-level section with the anchor id the outline links to (prefixed by its chapter). */
export function DocSection({ id, first = false, children }: { id: string; first?: boolean; children: ReactNode }) {
  const { chapter } = useContext(ChapterContext);
  return (
    <section id={sectionAnchor(chapter, id)} className={`scroll-mt-28 ${first ? "" : "mt-20 border-t border-line pt-16"}`}>
      {children}
    </section>
  );
}

export function SectionHeading({ eyebrow, title, copy }: { eyebrow: string; title: string; copy?: ReactNode }) {
  return (
    <div>
      <p className="kicker !text-accent">{eyebrow}</p>
      <h2 className="display mt-3 text-[clamp(1.9rem,4vw,2.8rem)] leading-[1.02]">{title}</h2>
      {copy && <p className="mt-4 max-w-2xl text-sm leading-6 text-muted sm:text-base sm:leading-7">{copy}</p>}
    </div>
  );
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="mt-6 max-w-2xl text-base leading-7 text-muted sm:text-lg sm:leading-8">{children}</p>;
}

export function Prose({ children }: { children: ReactNode }) {
  return <div className="mt-6 max-w-2xl space-y-4 text-sm leading-6 text-muted">{children}</div>;
}

export function Bullets({ items }: { items: readonly ReactNode[] }) {
  return (
    <ul className="mt-6 max-w-2xl space-y-3 text-sm leading-6 text-muted">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-2 size-1.5 shrink-0 bg-accent" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** Numbered "do X, see Y" steps. */
export function Steps({ items }: { items: readonly { title: ReactNode; body: ReactNode }[] }) {
  return (
    <ol className="mt-8 grid gap-px overflow-hidden border border-line bg-line">
      {items.map((step, i) => (
        <li key={i} className="flex gap-5 bg-surface p-5">
          <span className="font-mono text-xs text-accent">{String(i + 1).padStart(2, "0")}</span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{step.title}</p>
            <div className="mt-1.5 text-sm leading-6 text-muted">{step.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Inline code in brand mono. */
export function C({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[12px] text-foreground">{children}</code>;
}

export function SpecTable({
  columns,
  rows,
}: {
  columns: readonly string[];
  rows: readonly (readonly ReactNode[])[];
}) {
  return (
    <div className="mt-8 overflow-x-auto border border-line bg-surface">
      <table className="w-full min-w-[520px] text-left text-xs">
        <thead className="border-b border-line bg-black">
          <tr>
            {columns.map((col) => (
              <th key={col} className="kicker px-4 py-3 !text-[9px] font-normal">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-line/70 last:border-0">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={`px-4 py-3.5 align-top leading-5 ${
                    j === 0 ? "font-mono text-[11px] text-foreground" : "text-muted"
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CodeBlock({ label, children }: { label: string; children: string }) {
  return (
    <div className="mt-8 min-w-0 overflow-hidden border border-line bg-surface">
      <div className="flex h-10 items-center gap-2 border-b border-line px-4">
        <span className="size-1.5 bg-accent" aria-hidden />
        <span className="kicker !text-[9px]">{label}</span>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[12px] leading-6 text-[#d9dcf0]">
        <code>{children}</code>
      </pre>
    </div>
  );
}

export type Status = "live" | "fixture" | "mock" | "later" | "blocked";

const STATUS_STYLE: Record<Status, string> = {
  live: "border-clean/40 bg-clean-bg text-clean",
  fixture: "border-mock/40 bg-mock-bg text-mock",
  mock: "border-mock/40 bg-mock-bg text-mock",
  later: "border-line bg-black text-muted",
  blocked: "border-warn/40 bg-warn-bg text-warn",
};

/** Honest status label, same vocabulary as the in-app MockTag. */
export function StatusPill({ status, children }: { status: Status; children?: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center border px-1.5 py-0.5 font-mono text-[9px] tracking-wider uppercase ${STATUS_STYLE[status]}`}
    >
      {children ?? status}
    </span>
  );
}

/** Highlighted note for honesty caveats and warnings. */
export function Callout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="hatch mt-8 max-w-2xl border border-line border-l-2 border-l-accent bg-surface p-5">
      <p className="kicker !text-accent">{title}</p>
      <div className="mt-2 text-sm leading-6 text-muted">{children}</div>
    </div>
  );
}

/** Small row of cross-reference links at the end of a chapter. `/docs/...` hrefs become in-page anchors. */
export function NextLinks({ links }: { links: readonly { href: string; label: string }[] }) {
  return (
    <div className="mt-10 flex flex-wrap gap-5 text-xs font-semibold">
      {links.map((l) => {
        const href = docsHref(l.href);
        return href.startsWith("#") ? (
          <a key={l.href} href={href} className="text-accent hover:underline">
            {l.label} →
          </a>
        ) : (
          <Link key={l.href} href={href} className="text-accent hover:underline">
            {l.label} →
          </Link>
        );
      })}
    </div>
  );
}

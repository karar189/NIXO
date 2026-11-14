"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, ArrowUpRight, BookOpen } from "lucide-react";
import { Logo } from "@/components/site/Logo";
import { NIXO_EXPLORER, REPO_URL } from "./links";
import { useActiveDocsSection } from "./use-active-docs-section";

export type DocsNavChild = { href: string; label: string };

export type DocsNavItem = {
  href: string;
  label: string;
  children: readonly DocsNavChild[];
};

export type DocsNavSection = {
  label: string;
  items: readonly DocsNavItem[];
};

/** Single source of truth for the sidebar, the mobile chips and each page's "On this page" outline. */
export const DOCS_NAV: readonly DocsNavSection[] = [
  {
    label: "Start here",
    items: [
      {
        href: "/docs",
        label: "What NIXO is",
        children: [
          { href: "#overview", label: "Overview" },
          { href: "#problem", label: "The problem" },
          { href: "#layers", label: "Three layers" },
          { href: "#surfaces", label: "Product surfaces" },
          { href: "#audience", label: "Who it is for" },
          { href: "#tour", label: "90-second tour" },
        ],
      },
    ],
  },
  {
    label: "Layer 1",
    items: [
      {
        href: "/docs/tracer",
        label: "Clean-funds passport",
        children: [
          { href: "#status", label: "Deployment status" },
          { href: "#what", label: "What this is" },
          { href: "#lifecycle", label: "Certificate lifecycle" },
          { href: "#checker", label: "The checker" },
          { href: "#verdicts", label: "Verdicts and reasons" },
          { href: "#trace", label: "Multi-hop trace" },
          { href: "#lists", label: "Sanctions and hacker lists" },
          { href: "#history", label: "History sources" },
          { href: "#certificate", label: "Certificate fields" },
          { href: "#governance", label: "Hash pinning and revocation" },
          { href: "#kani", label: "Formal verification" },
          { href: "#visibility", label: "What is hidden from whom" },
          { href: "#preview", label: "Check any wallet" },
        ],
      },
    ],
  },
  {
    label: "Layer 2",
    items: [
      {
        href: "/docs/vault",
        label: "Vault and agents",
        children: [
          { href: "#overview", label: "What the vault is" },
          { href: "#deposit", label: "Deposit gate" },
          { href: "#assign", label: "Assign an agent" },
          { href: "#execute", label: "Execute and limits" },
          { href: "#exit", label: "Revoke and withdraw" },
          { href: "#fc-key", label: "Function-call key" },
          { href: "#experiment", label: "Two-agent experiment" },
          { href: "#suite", label: "Adversarial suite" },
          { href: "#viewing", label: "Viewing keys" },
          { href: "#ui", label: "Dashboard" },
        ],
      },
    ],
  },
  {
    label: "Layer 3",
    items: [
      {
        href: "/docs/solver",
        label: "Solver gate",
        children: [
          { href: "#overview", label: "What the gate is" },
          { href: "#rules", label: "Fail-closed rules" },
          { href: "#sdk", label: "checkIntent" },
          { href: "#mock", label: "Mock solver" },
          { href: "#try", label: "Try it" },
          { href: "#limits", label: "What it is not" },
        ],
      },
    ],
  },
  {
    label: "Desk",
    items: [
      {
        href: "/docs/trading",
        label: "Trading desk",
        children: [
          { href: "#overview", label: "What the desk is" },
          { href: "#swap", label: "Confidential swaps" },
          { href: "#flow", label: "Swap lifecycle" },
          { href: "#paper", label: "Paper desk" },
          { href: "#agents", label: "AI trading agents" },
          { href: "#models", label: "Model providers" },
        ],
      },
      {
        href: "/docs/private-ai",
        label: "Private AI",
        children: [
          { href: "#overview", label: "What it is" },
          { href: "#explainer", label: "Certificate explainer" },
          { href: "#attestation", label: "Attestation checks" },
          { href: "#retention", label: "No retention" },
          { href: "#try", label: "Try it" },
        ],
      },
    ],
  },
  {
    label: "Reference",
    items: [
      {
        href: "/docs/developers",
        label: "Developer reference",
        children: [
          { href: "#contracts", label: "Deployed contracts" },
          { href: "#nixo-methods", label: "nixo.testnet methods" },
          { href: "#vault-methods", label: "Vault methods" },
          { href: "#events", label: "Events" },
          { href: "#web-api", label: "Web API routes" },
          { href: "#agents-api", label: "Agents API" },
          { href: "#sdk", label: "TypeScript SDKs" },
          { href: "#run", label: "Run locally" },
          { href: "#env", label: "Environment" },
          { href: "#tests", label: "Tests and CI" },
        ],
      },
      {
        href: "/docs/status",
        label: "Status and limits",
        children: [
          { href: "#real", label: "Real vs mocked" },
          { href: "#trust", label: "Trust assumptions" },
          { href: "#not", label: "What NIXO does not claim" },
          { href: "#related", label: "Related work" },
          { href: "#roadmap", label: "Roadmap" },
        ],
      },
    ],
  },
];

function isActive(pathname: string, href: string) {
  if (href === "/docs") return pathname === "/docs";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function pageToc(pathname: string): readonly DocsNavChild[] {
  for (const section of DOCS_NAV) {
    for (const item of section.items) {
      if (isActive(pathname, item.href)) return item.children;
    }
  }
  return [];
}

export function DocsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/docs";
  const headings = pageToc(pathname);
  const activeSection = useActiveDocsSection(headings.map((item) => item.href));

  useEffect(() => {
    if (!activeSection) return;
    const el = document.querySelector(`[data-docs-outline="${CSS.escape(activeSection)}"]`);
    el?.scrollIntoView({ block: "nearest" });
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
                      const active = isActive(pathname, item.href);
                      return (
                        <div key={item.href}>
                          <Link
                            href={item.href}
                            aria-current={active ? "page" : undefined}
                            className={`block border-l-2 py-1.5 pl-3 text-[13px] transition-colors ${
                              active
                                ? "border-accent font-medium text-foreground"
                                : "border-transparent text-muted hover:border-accent/50 hover:text-foreground"
                            }`}
                          >
                            {item.label}
                          </Link>
                          {active && (
                            <div className="mt-0.5 space-y-0.5 border-l border-line pl-3">
                              {item.children.map((child) => {
                                const sectionActive = child.href === activeSection;
                                return (
                                  <a
                                    key={`${item.href}${child.href}`}
                                    href={child.href}
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
            {DOCS_NAV.flatMap((section) =>
              section.items.flatMap((item) => [
                <Link
                  key={item.href}
                  href={item.href}
                  className={`shrink-0 border px-3 py-2 text-xs ${
                    isActive(pathname, item.href)
                      ? "border-accent bg-accent/10 text-foreground"
                      : "border-line bg-surface text-muted"
                  }`}
                >
                  {item.label}
                </Link>,
                ...(isActive(pathname, item.href)
                  ? item.children.map((child) => (
                      <a
                        key={`${item.href}${child.href}`}
                        href={child.href}
                        aria-current={child.href === activeSection ? "location" : undefined}
                        className={`shrink-0 border px-3 py-2 text-xs ${
                          child.href === activeSection
                            ? "border-accent/60 bg-surface font-medium text-accent"
                            : "border-line bg-black text-muted"
                        }`}
                      >
                        {child.label}
                      </a>
                    ))
                  : []),
              ]),
            )}
          </div>
          {children}
          <footer className="mt-20 flex flex-col gap-4 border-t border-line py-8 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
            <span className="kicker">NIXO · NEAR testnet · {new Date().getFullYear()}</span>
            <div className="flex flex-wrap gap-5">
              <Link href="/" className="hover:text-accent">Home</Link>
              <Link href="/docs/tracer" className="hover:text-accent">Passport</Link>
              <Link href="/docs/vault" className="hover:text-accent">Vault</Link>
              <Link href="/docs/solver" className="hover:text-accent">Solver</Link>
              <Link href="/docs/developers" className="hover:text-accent">Reference</Link>
              <Link href="/verify" className="hover:text-accent">Exchange view</Link>
            </div>
          </footer>
        </main>

        <aside className="hidden xl:block">
          <div className="sticky top-16 h-[calc(100svh-4rem)] overflow-y-auto px-7 py-10">
            <p className="kicker">On this page</p>
            <nav className="mt-4 space-y-1 text-xs" aria-label="On this page">
              {headings.map((item) => {
                const sectionActive = item.href === activeSection;
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    data-docs-outline={item.href}
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

/** Page title block: kicker, display headline, lead paragraph(s), optional actions. */
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
  return (
    <>
      <p className="kicker !text-accent">{kicker}</p>
      <h1 className="display mt-4 max-w-3xl text-[clamp(2.4rem,6vw,4.4rem)]">
        {title}
        {muted && (
          <>
            <br />
            <span className="text-muted">{muted}</span>
          </>
        )}
      </h1>
      {children}
    </>
  );
}

/** Top-level section with the anchor id the outline links to. */
export function DocSection({ id, first = false, children }: { id: string; first?: boolean; children: ReactNode }) {
  return (
    <section id={id} className={`scroll-mt-28 ${first ? "" : "mt-20 border-t border-line pt-16"}`}>
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

/** Small row of "next page" links at the end of a page. */
export function NextLinks({ links }: { links: readonly { href: string; label: string }[] }) {
  return (
    <div className="mt-10 flex flex-wrap gap-5 text-xs font-semibold">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="text-accent hover:underline">
          {l.label} →
        </Link>
      ))}
    </div>
  );
}

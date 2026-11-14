/** Shared docs links. Plain module (no "use client") so server pages can import the values. */
export const REPO_URL = "https://github.com/karar189/NIXO";
export const NIXO_EXPLORER = "https://testnet.nearblocks.io/address/nixo.testnet";
export const VAULT_EXPLORER = "https://testnet.nearblocks.io/address/nixo-vault.testnet";

const MAINNET_EXPLORER = "https://nearblocks.io/address/";
const TESTNET_EXPLORER = "https://testnet.nearblocks.io/address/";

/** Explorer link for a NEAR account, picked by its suffix. */
export function explorerUrl(account: string): string {
  return (account.endsWith(".testnet") ? TESTNET_EXPLORER : MAINNET_EXPLORER) + account;
}

/** Hosted backend services (AWS EC2, Docker + Caddy, auto-HTTPS on sslip.io). */
export const AGENTS_URL = "https://agents.13-235-153-13.sslip.io";
export const BACKEND_URL = "https://api.13-235-153-13.sslip.io";

/**
 * The docs are one continuous page, so section ids are prefixed by their chapter
 * (`vault-overview`). The intro chapter keeps bare ids (`overview`, `tour`).
 */
export function sectionAnchor(chapter: string, id: string): string {
  return chapter ? `${chapter}-${id}` : id;
}

export function chapterHref(chapter: string): string {
  return `#${chapter || "overview"}`;
}

/** Maps a `/docs/<chapter>#<section>` link onto its in-page anchor. Other hrefs pass through. */
export function docsHref(href: string): string {
  const m = /^\/docs(?:\/([\w-]+))?(?:#([\w-]+))?$/.exec(href);
  if (!m) return href;
  const chapter = m[1] ?? "";
  return m[2] ? `#${sectionAnchor(chapter, m[2])}` : chapterHref(chapter);
}

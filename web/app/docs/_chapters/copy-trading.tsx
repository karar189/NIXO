import { Fragment } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  Bullets,
  C,
  Callout,
  DocSection,
  Lead,
  NextLinks,
  PageHeader,
  SectionHeading,
  SpecTable,
  StatusPill,
  Steps,
} from "@/components/docs/docs-shell";

export function CopyTradingChapter() {
  return (
    <>
      <DocSection id="overview" first>
        <PageHeader kicker="Desk · /dashboard/keys" title="Sell your agent's trades." muted="Keep them encrypted for everyone else." />
        <Lead>
          Copy-trading keys are paid, time-limited viewing keys. A trader lists a price for access to their AI agent&apos;s
          trading sessions. A follower pays on-chain, reads the trades live in their browser, and can mirror them
          automatically. Everyone else sees only aggregate performance: PnL, ROE, win rate and drawdown, never the
          symbols or sides.
        </Lead>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/dashboard/keys" className="btn-primary">
            Open copy trading
            <ArrowRight className="size-4" />
          </Link>
        </div>
        <SpecTable
          columns={["Piece", "What it is", "Status"]}
          rows={[
            ["copykeys/ contract", "Listings, paid subscriptions, follower X25519 public keys. Payment goes straight to the trader.", <StatusPill key="1" status="later">built · not deployed</StatusPill>],
            ["Encrypted, hash-chained feed", "Every agent open / close sealed with AES-GCM under the current epoch key", <StatusPill key="2" status="live" />],
            ["Browser-side decryption", "X25519 keypair made with WebCrypto; the private key never leaves the device", <StatusPill key="3" status="live" />],
            ["Public trader card", "PnL, ROE, win rate, drawdown, trade count, PnL curve", <StatusPill key="4" status="live" />],
            ["Auto-mirror", "Follower copies each agent position as a paper position", <StatusPill key="5" status="mock">paper</StatusPill>],
            ["Demo traders", "atlas / helix / quill.nixo-demo, simulated history, not purchasable", <StatusPill key="6" status="fixture">demo</StatusPill>],
          ]}
        />
        <Callout title="Deployment">
          The contract is built and unit-tested but not deployed on either network yet. Deploy it with{" "}
          <C>scripts/deploy-copykeys-testnet.sh</C> and set <C>NIXO_KEYS_CONTRACT</C>. Until then the leaderboard and
          public trader cards work, and subscribing or mirroring returns 503 (contract not configured).
        </Callout>
      </DocSection>

      <DocSection id="flow">
        <SectionHeading eyebrow="How it works" title="List, subscribe, decrypt, mirror." />
        <Steps
          items={[
            {
              title: "Trader lists a key",
              body: (
                <>
                  On <C>/dashboard/trade</C>, hover <strong>Deploy copy agent</strong>, set a price per period and sign{" "}
                  <C>list_key(price_per_period, period_secs)</C>. Minimum 0.001 NEAR per period; periods from 60 s to one
                  year.
                </>
              ),
            },
            {
              title: "Follower checks the record",
              body: (
                <>
                  On <C>/dashboard/keys</C>, paste the trader&apos;s NEAR ID. The public card shows PnL, ROE, win rate,
                  max drawdown, trade count and a PnL curve. No symbols, no sides.
                </>
              ),
            },
            {
              title: "Subscribe on-chain",
              body: (
                <>
                  The browser makes an X25519 keypair and calls <C>subscribe(trader, periods, x25519_pub)</C> with exactly{" "}
                  price × periods attached (1–52 periods). The NEAR is forwarded to the trader in full. Subscribing again
                  while active extends the window.
                </>
              ),
            },
            {
              title: "Read the live feed",
              body: (
                <>
                  <C>GET /copy/keys/{"{trader}"}</C> wraps each epoch key inside the paid window to the public key stored{" "}
                  <em>on-chain</em>, so naming someone else&apos;s account gets you nothing. The browser unwraps, decrypts
                  and verifies the hash chain (shown as &quot;chain verified&quot;).
                </>
              ),
            },
            {
              title: "Auto-mirror",
              body: (
                <>
                  Set size × trader, max margin, max leverage and a loss cap. Each new agent position opens a matching
                  paper position for you and closes when the trader&apos;s does. Mirroring pauses at the loss cap.
                </>
              ),
            },
          ]}
        />
      </DocSection>

      <DocSection id="contract">
        <SectionHeading eyebrow="copykeys contract" title="Small on purpose." copy="Events use the standard nixo-copykeys: key_listed, key_unlisted, key_purchased." />
        <SpecTable
          columns={["Method", "Kind", "Description"]}
          rows={[
            ["list_key(price_per_period, period_secs) → Listing", "call · trader", "Create or update your listing. PRICE_TOO_LOW / INVALID_PERIOD on bad input."],
            ["unlist() → Listing", "call · trader", "Stop selling. Existing subscriptions run until they expire."],
            ["subscribe(trader, periods, x25519_pub) → Subscription", "call · payable", "Exact deposit required (WRONG_DEPOSIT). Refuses SELF_SUBSCRIBE and inactive listings. Pays the trader."],
            ["get_listing / list_listings", "view", "One listing, or a page of them"],
            ["get_subscription / is_active", "view", "A follower's subscription to a trader, and whether it is running now"],
            ["subscribers_of / subscriptions_of", "view", "All subscriptions for a trader, or for a follower"],
          ]}
        />
      </DocSection>

      <DocSection id="limits">
        <SectionHeading eyebrow="What it does not do" title="Access control for a log, not on-chain privacy." />
        <Bullets
          items={[
            <Fragment key="b1">Only agent sessions are published. Manual positions and vault executes never are.</Fragment>,
            <Fragment key="b2">Mirrored trades are paper fills priced by 1Click dry quotes. No funds move.</Fragment>,
            <Fragment key="b3">A subscriber can re-share what they decrypt. Keys already handed out cannot be revoked.</Fragment>,
            <Fragment key="b4">Public PnL is computed by the NIXO service from those fills and backed by a hash chain. That is not a ZK proof.</Fragment>,
            <Fragment key="b5">Access is rounded to whole epochs (<C>NIXO_COPY_EPOCH_SECS</C>, default one hour).</Fragment>,
          ]}
        />
        <NextLinks
          links={[
            { href: "/docs/vault#viewing", label: "Delayed viewing keys" },
            { href: "/docs/developers#agents-api", label: "Agents API" },
          ]}
        />
      </DocSection>
    </>
  );
}

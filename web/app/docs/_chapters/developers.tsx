import {
  C,
  Callout,
  CodeBlock,
  DocSection,
  Lead,
  NextLinks,
  PageHeader,
  Prose,
  SectionHeading,
  SpecTable,
} from "@/components/docs/docs-shell";

export function DevelopersChapter() {
  return (
    <>
      <DocSection id="contracts" first>
        <PageHeader kicker="Reference" title="Everything you can call." />
        <Lead>
          Two contracts live on NEAR mainnet and testnet (same code on both), a copy-trading keys contract, a Next.js app
          with a handful of server routes, and a FastAPI agents service. All amounts on chain are yoctoNEAR strings; all
          timestamps are nanoseconds as strings.
        </Lead>
        <SpecTable
          columns={["Account", "Role", "Source"]}
          rows={[
            ["nixo.nixowallet.near (mainnet)", "Certificate contract: pin, OutLayer (outlayer.near) callback, is_clean", "contract/ (near-sdk 5, Rust 1.95.0)"],
            ["vault.nixowallet.near (mainnet)", "Deposit vault gated on nixo.nixowallet.near", "vault/"],
            ["nixo.testnet", "Certificate contract on testnet (same code hash as mainnet)", "contract/"],
            ["nixo-vault.testnet", "Deposit vault on testnet (same code hash as mainnet)", "vault/"],
            ["nixo-keys.testnet (not deployed yet)", "Copy-trading keys: listings, paid subscriptions", "copykeys/"],
            ["outlayer.testnet", "OutLayer TEE execution (external)", "—"],
            ["nixo-alice.testnet", "Demo account with a Clean certificate", "fixtures/"],
            ["nixo-mallory.testnet", "Demo account with a Rejected certificate", "fixtures/"],
          ]}
        />
      </DocSection>

      <DocSection id="nixo-methods">
        <SectionHeading eyebrow="nixo.nixowallet.near · nixo.testnet" title="Certificate contract methods." />
        <SpecTable
          columns={["Method", "Kind", "Description"]}
          rows={[
            ["request_nixo()", "call · payable", "Certify the caller. Attach NEAR for the TEE run (demo uses 0.05). Unused deposit is refunded."],
            ["resolve_nixo(account, checker_hash)", "private callback", "Stores the certificate or emits nixo_failed. Not callable externally."],
            ["is_clean(account) → bool", "view", "True only for a valid, unexpired, unrevoked Clean certificate."],
            ["get_certificate(account) → { certificate, valid } | null", "view", "Full certificate plus validity."],
            ["get_checker_hash() → string", "view", "Active pinned WASM SHA-256."],
            ["is_revoked(checker_hash) → bool", "view", "Whether a checker version is revoked."],
            ["get_config() → Config", "view", "owner, outlayer, checker {hash, url}, pending, timelock_ns, cert_ttl_ns."],
            ["set_checker_hash(checker)", "call · owner", "Propose a new checker; starts the timelock."],
            ["apply_checker_hash()", "call · anyone", "Activate the pending checker after the timelock."],
            ["cancel_checker_hash()", "call · owner", "Drop the pending checker."],
            ["revoke_checker_hash(checker_hash)", "call · owner", "Invalidate every certificate from that checker."],
          ]}
        />
      </DocSection>

      <DocSection id="vault-methods">
        <SectionHeading eyebrow="vault.nixowallet.near · nixo-vault.testnet" title="Vault contract methods." />
        <SpecTable
          columns={["Method", "Kind", "Description"]}
          rows={[
            ["deposit()", "call · payable", "Cross-calls is_clean(caller). Clean → deposit row; otherwise full refund."],
            ["assign(deposit_id, agent_id, max_per_tx, max_per_window, window_ns, expires_at_ns, allowlist)", "call · owner of deposit", "Bind a deposit to one agent with frozen limits."],
            ["execute(assignment_id, amount, target, dry_run) → bool", "call · agent", "Check limits, debit, transfer (or dry-run). No attached deposit."],
            ["revoke(assignment_id)", "call · owner of deposit", "Revoke and unbind. Idempotent."],
            ["withdraw(deposit_id, amount)", "call · owner of deposit", "Return unassigned remaining NEAR."],
            ["commit_trade_hash(deposit_id, assignment_id, hash)", "call · owner or agent", "Commit a 64-hex hash of an encrypted trade-log entry."],
            ["set_nixo_contract(nixo_contract)", "call · admin", "Point the vault at a different certificate contract."],
            ["get_config / get_deposit / get_assignment", "view", "Read config, one deposit, one assignment."],
            ["list_deposits_by_owner(owner)", "view", "All deposits for an owner."],
            ["get_trade_hash(assignment_id, hash)", "view", "Look up a committed trade hash."],
          ]}
        />
      </DocSection>

      <DocSection id="events">
        <SectionHeading
          eyebrow="Events"
          title="NEP-297 style logs you can index."
          copy="All three contracts log EVENT_JSON:{standard, version: 1.0.0, event, data: [...]}."
        />
        <SpecTable
          columns={["Standard", "Events"]}
          rows={[
            ["nixo", "nixo_requested · nixo_resolved · nixo_failed · checker_proposed · checker_activated · checker_revoked"],
            ["nixo-vault", "deposit_accepted · deposit_refunded · assigned · revoked · withdrawn · execution_allowed · execution_blocked · execution_rolled_back · trade_hash_committed"],
            ["nixo-copykeys", "key_listed · key_unlisted · key_purchased"],
          ]}
        />
      </DocSection>

      <DocSection id="web-api">
        <SectionHeading eyebrow="Web API routes" title="Next.js server routes (web/app/api)." />
        <SpecTable
          columns={["Route", "Body", "Does"]}
          rows={[
            ["POST /api/request", "{ id: alice | mallory }", "Judge demo: server signs request_nixo as a pre-seeded account (keys only in server env). Returns once the tx is included; the client polls get_certificate."],
            ["POST /api/check", "{ account } (mainnet)", "Check any wallet preview. caller_supplied, never certifiable."],
            ["POST /api/explain", "{ account }", "NEAR AI explainer over the public certificate."],
            ["GET / POST /api/private-ai", "{ sample } | { document }", "Private AI over samples or public certificate JSON. no-store."],
            ["/api/agents/[...path]", "passthrough", "Same-origin proxy to AGENTS_API_URL. Not an open proxy: path segments re-encoded, only known headers forwarded."],
          ]}
        />
      </DocSection>

      <DocSection id="agents-api">
        <SectionHeading
          eyebrow="Agents API"
          title="FastAPI service on :8000."
          copy="Open http://localhost:8000/docs for the live OpenAPI schema. NIXO routes take the caller's account in the X-Near-Account header; that account owns the run. The hosted service answers only /health publicly; everything else needs the X-Agents-Token the web proxy adds."
        />
        <SpecTable
          columns={["Prefix", "Routes", "Purpose"]}
          rows={[
            ["/health", "GET", "Liveness"],
            ["/nixo", "GET assets, defaults · POST/GET runs · GET runs/{id}, runs/{id}/audit · POST runs/{id}/revoke, runs/{id}/attempt", "Two-agent experiment"],
            ["/nixo/onchain", "GET / · deposits/{owner} · deposit/{id} · assignment/{id} · POST execute-args", "Read the on-chain vault, build execute args"],
            ["/nixo/viewing", "POST keypair, offer, append, redeem · GET runs/{id}", "Encrypted trade log + delayed viewing keys"],
            ["/intents", "POST quote, deposit · GET status", "1Click proxy for wallet-signed swaps (JWT stays server-side)"],
            ["/trade", "GET markets, ticker/{symbol}, planner, status, logs, statistics, history · POST preview, analyze, start, manual, stop, pause, resume", "Paper desk and trading agents"],
            ["/trade/live", "GET status · POST challenge", "Live agent: guardrails, balances, NEP-413 start nonce"],
            ["/copy", "GET config, leaderboard, traders/{id}, traders/{id}/entries, keys/{id}?follower=, me, following · GET/POST mirror", "Copy-trading keys: public cards, encrypted feed, wrapped epoch keys, auto-mirror"],
            ["/llm", "GET providers, models/{provider} · POST ping", "Model provider discovery"],
          ]}
        />
      </DocSection>

      <DocSection id="sdk">
        <SectionHeading eyebrow="TypeScript SDKs" title="Thin, typed, dependency-light." copy="All in web/lib. View calls go straight to NEAR RPC; call builders return wallet-selector transactions." />
        <SpecTable
          columns={["Module", "Exports"]}
          rows={[
            ["nixo-sdk.ts", "isClean, getCertificate, getConfig, isRevoked, nsToDate · types Certificate, CertificateView, Config"],
            ["vault-sdk.ts", "getVaultConfig, getDeposit, getAssignment, listDepositsByOwner, nearToYocto, buildDepositCall, buildAssignCall, buildExecuteCall, buildRevokeCall, buildWithdrawCall"],
            ["solver-gate.ts", "checkIntent, checkAccount · types GateDecision, GateRefuseCode, CertificateLookup"],
            ["solver/mock-solver.ts", "mockSolve · type MockFillResult"],
            ["intents/liveSwap.ts", "Confidential Intents swap helpers: balances, storage, wrap, transfer to deposit address"],
            ["copykeys/sdk.ts", "buildListKeyCall, buildUnlistCall, buildSubscribeCall, PERIOD_OPTIONS · types Listing, Subscription"],
            ["copykeys/crypto.ts", "getOrCreateKeypair, unwrapEpochKeys, decryptEntries, verifyChain (WebCrypto X25519 + AES-GCM)"],
            ["copykeys/api.ts", "copyApi client for /copy · types TraderCard, PublicStats, MirrorConfig"],
          ]}
        />
        <CodeBlock label="gate a deposit in your own app">{`import { isClean, getCertificate } from "@/lib/nixo-sdk";

if (!(await isClean(sender))) {
  const view = await getCertificate(sender);
  throw new Error(view ? \`not clean: \${view.certificate.reason}\` : "no certificate");
}`}</CodeBlock>
      </DocSection>

      <DocSection id="run">
        <SectionHeading eyebrow="Run locally" title="Three services, one command." />
        <CodeBlock label="setup">{`git clone https://github.com/karar189/NIXO
cd NIXO
cp .env.example .env      # one file for every service
pnpm run setup            # pnpm deps, backend npm ci, agents venv
pnpm dev                  # web :3000 · agents :8000 · backend :4000`}</CodeBlock>
        <Callout title="pnpm setup vs pnpm run setup">
          <C>pnpm setup</C> is a built-in pnpm command. Use <C>pnpm run setup</C> to run the project script.
        </Callout>
        <SpecTable
          columns={["Command", "Does"]}
          rows={[
            ["pnpm dev:web | dev:agents | dev:backend", "Run one service"],
            ["pnpm demo:solver", "Live Alice / Mallory through the solver gate"],
            ["pnpm build:checker", "Build the certified WASM and print its SHA-256"],
            ["pnpm build:contract | build:vault | build:copykeys", "cargo near build for each contract"],
            ["pnpm checker:run <account>", "Run the checker locally in wasmtime"],
            ["scripts/deploy-vault-testnet.sh", "Deploy the vault to testnet"],
            ["scripts/vault-fc-key.sh", "Add the agent's execute-only function-call key"],
            ["scripts/deploy-copykeys-testnet.sh", "Deploy the copy-trading keys contract, then set NIXO_KEYS_CONTRACT"],
          ]}
        />
      </DocSection>

      <DocSection id="env">
        <SectionHeading eyebrow="Environment" title="One .env at the repo root." copy="Copy .env.example. Keys stay in .env, which is git-ignored. Nothing below is required to browse certificates." />
        <SpecTable
          columns={["Variable", "Used by", "Purpose"]}
          rows={[
            ["NEXT_PUBLIC_NIXO_CONTRACT", "web", "Certificate contract for the judge demo (nixo.testnet)"],
            ["NEXT_PUBLIC_NIXO_CONTRACT_MAINNET / _TESTNET", "web", "Certificate contract per network for the toggle (nixo.nixowallet.near / nixo.testnet)"],
            ["NEXT_PUBLIC_NIXO_VAULT_CONTRACT_MAINNET / _TESTNET", "web", "Vault per network (vault.nixowallet.near / nixo-vault.testnet)"],
            ["NIXO_CONTRACT / NIXO_VAULT_CONTRACT", "agents", "Contracts the agents service reads"],
            ["NIXO_KEYS_CONTRACT / NIXO_COPY_EPOCH_SECS / NIXO_COPY_DEMO", "agents", "Copy-trading keys contract, epoch length, labelled demo traders"],
            ["NIXO_LIVE_ENABLED + NIXO_AGENT_ACCOUNT / _OWNER / _PRIVATE_KEY", "agents", "Live AI agent kill switch, agent account, owner allowed to start it, agent key"],
            ["NIXO_LIVE_MAX_TRADE_USDC / _DAILY_BUDGET_USDC / _MARKETS / _MAX_DEVIATION_BPS", "agents", "Live agent guardrails"],
            ["AGENTS_API_TOKEN", "web server, agents", "Shared token the web proxy sends as X-Agents-Token"],
            ["NEXT_PUBLIC_NEAR_NETWORK / NEXT_PUBLIC_NEAR_RPC_URL", "web", "Network and RPC"],
            ["DEMO_ALICE_KEY / DEMO_MALLORY_KEY", "web server", "Judge demo signer keys"],
            ["NIXO_REQUEST_DEPOSIT", "web server", "NEAR attached to request_nixo (default 0.05)"],
            ["NEARBLOCKS_API_KEY", "OutLayer secret", "Live history inside the enclave"],
            ["NIXO_OFFLINE", "checker", "1 = use labelled fixtures"],
            ["NEARAI_API_KEY / NEARAI_MODEL", "web, agents", "Private AI and the nearai provider"],
            ["AGENTS_API_URL", "web server", "Where /api/agents proxies to"],
            ["LLM_PROVIDER_ORDER + *_API_KEY", "agents", "Provider fallback order and keys"],
            ["ONECLICK_JWT", "agents", "Optional 1Click token, never sent to the browser"],
          ]}
        />
      </DocSection>

      <DocSection id="tests">
        <SectionHeading eyebrow="Tests and CI" title="Every layer has a job in CI." />
        <SpecTable
          columns={["CI job", "Runs"]}
          rows={[
            ["checker", "cargo test, release WASM build, publishes the WASM hash"],
            ["kani", "cargo kani over checker/proofs"],
            ["contract", "nixo.testnet unit tests"],
            ["vault", "Vault unit tests (gate, caps, revoke, rollback, trade hash)"],
            ["copykeys", "Copy-keys unit tests (listing, exact deposit, extend, self-subscribe, X25519 key)"],
            ["web", "Lint and build"],
            ["agents", "pytest (experiment, viewing keys, routers)"],
            ["backend", "NestJS tests"],
          ]}
        />
        <Prose>
          <p>
            Locally: <C>pnpm test</C> (checker, contract, vault, copykeys, agents, solver), <C>pnpm test:backend</C>,{" "}
            <C>pnpm kani</C>.
          </p>
        </Prose>
        <NextLinks links={[{ href: "/docs/status", label: "Status and limits" }]} />
      </DocSection>
    </>
  );
}

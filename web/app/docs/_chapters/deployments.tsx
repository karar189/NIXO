import { Fragment, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import {
  Bullets,
  C,
  Callout,
  CodeBlock,
  DocSection,
  Lead,
  NextLinks,
  PageHeader,
  SectionHeading,
  SpecTable,
  StatusPill,
} from "@/components/docs/docs-shell";
import { AGENTS_URL, BACKEND_URL, REPO_URL, explorerUrl } from "@/components/docs/links";

const CERT_CODE_HASH = "HUxADGErrcc3UTwa8HZdfsPVtstQHGkn91c4QZcqaP1G";
const VAULT_CODE_HASH = "9vVAgZmoyVB6Yj7dEuHty1ZnmbrBFULz8W3oSbzR32hp";

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-[12px] text-accent underline-offset-4 hover:underline"
    >
      {children}
      <ArrowUpRight className="size-3" />
    </a>
  );
}

function Account({ id }: { id: string }) {
  return <Ext href={explorerUrl(id)}>{id}</Ext>;
}

export function DeploymentsChapter() {
  return (
    <>
      <DocSection id="mainnet" first>
        <PageHeader kicker="Live deployment" title="Live on NEAR mainnet." muted="Same code as testnet." />
        <Lead>
          The certificate contract and the clean-only vault are deployed on NEAR mainnet under{" "}
          <C>nixowallet.near</C>. The certificate contract calls OutLayer on mainnet (<C>outlayer.near</C>), and the vault
          gates every deposit on the mainnet <C>is_clean</C>. Every link below opens the account on NearBlocks.
        </Lead>
        <SpecTable
          columns={["Account", "Role", "Status"]}
          rows={[
            [<Account key="a" id="nixo.nixowallet.near" />, "Certificate contract: pinned checker, OutLayer callback, is_clean / get_certificate", <StatusPill key="s1" status="live">live · mainnet</StatusPill>],
            [<Account key="b" id="vault.nixowallet.near" />, "Clean-only vault: deposit gate, assign, execute, revoke, withdraw. nixo_contract → nixo.nixowallet.near", <StatusPill key="s2" status="live">live · mainnet</StatusPill>],
            [<Account key="c" id="nixowallet.near" />, "Owner of both contracts (checker pin, revocation, vault admin)", <StatusPill key="s3" status="live" />],
            [<Account key="d" id="outlayer.near" />, "OutLayer TEE execution (Intel TDX), external", <StatusPill key="s4" status="live" />],
          ]}
        />
        <SpecTable
          columns={["Mainnet config", "Value"]}
          rows={[
            ["Pinned checker hash", "3ebe1fb88671973b15d4106073e356bdc429f4926c4a777be9bca9d74461ed59 (checker 0.3.0)"],
            ["Certificate TTL", "7 days (cert_ttl_ns = 604 800 s)"],
            ["Checker-change timelock", "48 hours (timelock_ns = 172 800 s)"],
            ["Pending checker", "none"],
          ]}
        />
      </DocSection>

      <DocSection id="testnet">
        <SectionHeading
          eyebrow="Testnet"
          title="The judge demo runs on testnet."
          copy="The two pre-seeded demo accounts live on testnet, so the 90-second tour signs there. NEAR Intents has no testnet, so the swap desk and the live agent always use mainnet."
        />
        <SpecTable
          columns={["Account", "Role", "Status"]}
          rows={[
            [<Account key="a" id="nixo.testnet" />, "Certificate contract (OutLayer outlayer.testnet)", <StatusPill key="s1" status="live" />],
            [<Account key="b" id="nixo-vault.testnet" />, "Clean-only vault, points at nixo.testnet", <StatusPill key="s2" status="live" />],
            [<Account key="c" id="nixo-alice.testnet" />, "Demo account with a Clean certificate", <StatusPill key="s3" status="fixture">demo</StatusPill>],
            [<Account key="d" id="nixo-mallory.testnet" />, "Demo account with a Rejected certificate (replay of a real mainnet hack trail)", <StatusPill key="s4" status="fixture">demo</StatusPill>],
            ["nixo-keys.testnet", "Copy-trading keys contract (copykeys/). Built and unit-tested; deploy with scripts/deploy-copykeys-testnet.sh", <StatusPill key="s5" status="later">not deployed</StatusPill>],
          ]}
        />
      </DocSection>

      <DocSection id="parity">
        <SectionHeading
          eyebrow="Same code everywhere"
          title="Mainnet and testnet run byte-identical contracts."
          copy="NEAR reports the same code hash for each pair, so what you test on testnet is what holds money on mainnet."
        />
        <SpecTable
          columns={["Contract", "Code hash (mainnet = testnet)", "Source"]}
          rows={[
            ["nixo.nixowallet.near · nixo.testnet", CERT_CODE_HASH, "contract/"],
            ["vault.nixowallet.near · nixo-vault.testnet", VAULT_CODE_HASH, "vault/"],
          ]}
        />
        <CodeBlock label="near-cli-rs · read mainnet yourself">{`near account view-account-summary nixo.nixowallet.near network-config mainnet now

near contract call-function as-read-only nixo.nixowallet.near get_config \\
  json-args '{}' network-config mainnet now

near contract call-function as-read-only nixo.nixowallet.near is_clean \\
  json-args '{"account":"<your-account>.near"}' network-config mainnet now

near contract call-function as-read-only vault.nixowallet.near get_config \\
  json-args '{}' network-config mainnet now`}</CodeBlock>
      </DocSection>

      <DocSection id="hosted">
        <SectionHeading
          eyebrow="Hosted services"
          title="Web on Vercel, agents and backend on one EC2."
          copy="The agents (FastAPI) and the waitlist backend (NestJS) run in Docker behind Caddy with automatic HTTPS. The web app reaches the agents through its own same-origin proxy, which adds a shared token."
        />
        <SpecTable
          columns={["Service", "URL", "Notes"]}
          rows={[
            ["Web app (this site)", "Vercel", "Landing, docs, /verify, /dashboard/*"],
            ["Agents API", <Ext key="a" href={`${AGENTS_URL}/health`}>{`${AGENTS_URL.replace("https://", "")}/health`}</Ext>, "Only /health is public. Other routes need the X-Agents-Token the web proxy sends."],
            ["Waitlist backend", <Ext key="b" href={BACKEND_URL}>{BACKEND_URL.replace("https://", "")}</Ext>, "NestJS waitlist API"],
            ["Source", <Ext key="c" href={REPO_URL}>github.com/karar189/NIXO</Ext>, "MIT"],
          ]}
        />
      </DocSection>

      <DocSection id="network">
        <SectionHeading eyebrow="Switching networks" title="One toggle picks the matching contracts." />
        <Bullets
          items={[
            <Fragment key="b1">
              <C>/dashboard/settings</C> toggles testnet ↔ mainnet. The app then reads certificates and the vault from the
              matching pair (<C>nixo.testnet</C> + <C>nixo-vault.testnet</C>, or <C>nixo.nixowallet.near</C> +{" "}
              <C>vault.nixowallet.near</C>).
            </Fragment>,
            <Fragment key="b2">
              A mainnet vault deposit needs a currently valid mainnet Clean certificate first: call{" "}
              <C>request_nixo</C> on <C>nixo.nixowallet.near</C> (it runs the checker on <C>outlayer.near</C>). Without one,
              the vault refunds the deposit in full.
            </Fragment>,
            <Fragment key="b3">
              Self-hosting: set <C>NEXT_PUBLIC_NIXO_CONTRACT_MAINNET</C>, <C>NEXT_PUBLIC_NIXO_VAULT_CONTRACT_MAINNET</C>,{" "}
              <C>NIXO_CONTRACT</C> and <C>NIXO_VAULT_CONTRACT</C> (see the environment reference).
            </Fragment>,
          ]}
        />
        <Callout title="What mainnet does and does not mean">
          Mainnet means the contracts are live and hold real NEAR. It does not make the solver gate a live solver network
          (it is still a mock with paper fills), and it does not hide vault deposits or withdrawals from explorers.
        </Callout>
        <NextLinks
          links={[
            { href: "/docs/tracer", label: "Clean-funds passport" },
            { href: "/docs/developers#contracts", label: "Contract reference" },
          ]}
        />
      </DocSection>
    </>
  );
}

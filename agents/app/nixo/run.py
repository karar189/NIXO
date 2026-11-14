"""Two-agent run orchestrator (Nixo_agents.md §3, §7-§9, §12).

Phases:
  setup        two equivalent deposits, each with its own provenance record;
               Agent A gets a baseline paper wallet, Agent B a vault assignment + policy
  task         both agents build the same target portfolio (any NEAR Intents tokens,
               across chains), step by step, on the same frozen snapshot
  adversarial  scripted attacks on B's permissions (each mirrored on A where it applies),
               including cross-chain attacks: forbidden chains and unpinned recipients
  revocation   owner revokes B, B tries again and is rejected; A's identical request executes
  done         comparison table, success criteria and the exported audit trail

Assets are SYMBOL@chain codes from the 1Click catalogue (assets.py); spending is
always in USDC@near. State is in memory, like the trading engine, and resets on restart.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from decimal import Decimal
from threading import Barrier
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app import llm
from app.nixo.adapter import ExecResult, ExecutionAdapter, MarketSnapshot, PaperWallet
from app.nixo.assets import ALLOCATION_CODE, Asset, Catalogue
from app.nixo.assets import catalogue as load_catalogue
from app.nixo.audit import AuditLog
from app.nixo.runner import AgentContext, AgentRunner, Proposal
from app.nixo.vault import (
    UNIT, Assignment, Decision, Policy, ProvenanceRegistry, TradeRequest, Vault, VaultError, check_request, ds,
)

log = logging.getLogger(__name__)

A, B = "agent_a", "agent_b"
PRIMARY = "*"  # sentinel: the first task asset
LABELS = {
    "execution": "Simulated: paper fills priced from a frozen market snapshot, with NEAR Intents (1Click) quote costs "
                 "measured at run start. No funds move.",
    "provenance": "Stub: verification_status comes from a demo stub, not real source-of-funds checks.",
    "enforcement": "Service-level: the vault runs inside the agents service (off-chain). Audit events are "
                   "service logs, not on-chain proof.",
}
Provider = Literal["auto", "claude", "anthropic", "openai", "deepseek", "nvidia", "nearai", "rules"]
CODE_PATTERN = r"^[^@\s]{1,40}@[a-z0-9_-]{1,24}(:[A-Za-z0-9]{1,12})?$"

# Light address-format checks for pinned recipients (not a substitute for real validation).
_EVM = re.compile(r"^0x[0-9a-fA-F]{40}$")
_ADDRESS_RULES = {
    "near": re.compile(r"^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$"),
    "btc": re.compile(r"^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$"),
    "sol": re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$"),
}
_EVM_CHAINS = {"eth", "base", "arb", "op", "pol", "bsc", "avax", "gnosis", "bera", "monad", "scroll", "xlayer",
               "abs", "plasma", "hood"}


def valid_address(chain: str, address: str) -> bool:
    if chain in _EVM_CHAINS:
        return bool(_EVM.match(address))
    rule = _ADDRESS_RULES.get(chain)
    return bool(rule.match(address)) if rule else 0 < len(address) <= 128 and not any(c.isspace() for c in address)


class TargetLeg(BaseModel):
    asset: str = Field(pattern=CODE_PATTERN, description="SYMBOL@chain code from /nixo/assets")
    usdc: Decimal = Field(gt=0, le=1_000_000, decimal_places=6)


def _default_targets() -> list[TargetLeg]:
    # Native BTC (BTC@btc) is in the catalogue but solvers currently quote "No liquidity" for it.
    return [TargetLeg(asset="NEAR@near", usdc=Decimal(300)), TargetLeg(asset="ETH@eth", usdc=Decimal(200)),
            TargetLeg(asset="SOL@sol", usdc=Decimal(100))]


class RunConfig(BaseModel):
    allocation_usdc: Decimal = Field(Decimal(1000), gt=0, le=1_000_000, decimal_places=6)
    task_targets: list[TargetLeg] = Field(default_factory=_default_targets, min_length=1, max_length=4)
    steps: int = Field(8, ge=1, le=20)
    max_trade_amount: Decimal = Field(Decimal(200), gt=0, decimal_places=6)
    max_total_spend: Decimal = Field(Decimal(1000), gt=0, decimal_places=6)
    allowed_assets: list[str] = Field(default_factory=lambda: [ALLOCATION_CODE, "NEAR@near", "ETH@eth", "SOL@sol"],
                                      max_length=24)
    allowed_chains: list[str] = Field(default_factory=lambda: ["near", "eth", "sol"], max_length=16)
    recipients: dict[str, str] = Field(default_factory=dict, description="chain -> owner's pinned address")
    market: Literal["recorded", "synthetic"] = "recorded"
    llm_provider: Provider = "auto"
    llm_model: str | None = Field(None, max_length=128, pattern=r"^[A-Za-z0-9._:/@-]+$")
    fee_bps: int = Field(30, ge=0, le=500)
    run_adversarial: bool = True
    revoke_at_end: bool = True

    @model_validator(mode="before")
    @classmethod
    def _legacy(cls, data):
        """Accept the v0.1 payload: task_target_usdc (USDC->NEAR) and bare symbols like "NEAR"."""
        if isinstance(data, dict):
            data = dict(data)
            legacy = data.pop("task_target_usdc", None)
            if legacy is not None and "task_targets" not in data:
                data["task_targets"] = [{"asset": "NEAR@near", "usdc": legacy}]
            if isinstance(data.get("allowed_assets"), list):
                data["allowed_assets"] = [a if "@" in a else f"{a.strip().upper()}@near"
                                          for a in data["allowed_assets"] if isinstance(a, str) and a.strip()]
        return data

    @field_validator("allowed_assets")
    @classmethod
    def _assets(cls, v: list[str]) -> list[str]:
        out = [ALLOCATION_CODE]
        for a in v:
            a = a.strip()
            if not re.match(CODE_PATTERN, a):
                raise ValueError(f"'{a}' is not a SYMBOL@chain code")
            if a not in out:
                out.append(a)
        return out

    @field_validator("allowed_chains")
    @classmethod
    def _chains(cls, v: list[str]) -> list[str]:
        out = ["near"]  # the allocation lives on NEAR
        for c in v:
            c = c.strip().lower()
            if c and c not in out:
                out.append(c)
        return out

    @field_validator("recipients")
    @classmethod
    def _recipients(cls, v: dict[str, str]) -> dict[str, str]:
        out = {}
        for chain, addr in v.items():
            chain, addr = chain.strip().lower(), (addr or "").strip()
            if not addr:
                continue
            if not valid_address(chain, addr):
                raise ValueError(f"'{addr}' doesn't look like a {chain} address")
            out[chain] = addr
        return out

    @model_validator(mode="after")
    def _check(self) -> "RunConfig":
        codes = [t.asset for t in self.task_targets]
        if len(set(codes)) != len(codes):
            raise ValueError("each task asset can appear only once")
        if ALLOCATION_CODE in codes:
            raise ValueError(f"{ALLOCATION_CODE} is what the agents spend; it can't be a target")
        if self.target_total > self.allocation_usdc:
            raise ValueError("task targets add up to more than the allocation")
        for c in codes:  # task assets are always allowed
            if c not in self.allowed_assets:
                self.allowed_assets.append(c)
        return self

    @property
    def target_total(self) -> Decimal:
        return sum((t.usdc for t in self.task_targets), Decimal(0))

    def policy(self, policy_id: str, asset_chains: dict[str, str], **overrides) -> Policy:
        fields = dict(policy_id=policy_id, agent_id=B, allowed_actions=frozenset({"swap"}),
                      allowed_assets=frozenset(self.allowed_assets), max_trade_amount=self.max_trade_amount,
                      max_total_spend=self.max_total_spend, withdrawals_allowed=False, enabled=True,
                      allowed_chains=frozenset(self.allowed_chains), asset_chains=asset_chains,
                      recipients=dict(self.recipients))
        fields.update(overrides)
        return Policy(**fields)


def _now() -> float:
    return time.time()


class NixoRun:
    def __init__(self, owner: str, cfg: RunConfig):
        self.owner = owner
        self.cfg = cfg
        self.run_id = f"run_{uuid.uuid4().hex[:10]}"
        self.audit = AuditLog(self.run_id)
        self.registry = ProvenanceRegistry(self.audit)
        self.vault = Vault(self.registry, self.audit)
        self.status: Literal["pending", "running", "done", "error"] = "pending"
        self.phase = "setup"
        self.step = 0
        self.error: str | None = None
        self.started_at = _now()
        self.finished_at: float | None = None
        self.llm_info: dict = {}
        self.catalogue: Catalogue | None = None
        self.assets: dict[str, Asset] = {}  # every asset this run touches (task, allowlist, attack targets)
        self.chain_map: dict[str, str] = {}  # frozen code -> chain map handed to every policy
        self.targets: dict[str, Decimal] = {t.asset: t.usdc for t in cfg.task_targets}
        self.primary = cfg.task_targets[0].asset
        self.attack_asset: Asset | None = None  # unapproved token on an allowed chain
        self.forbidden_asset: Asset | None = None  # token on a chain that isn't allowed
        self.snapshot: MarketSnapshot | None = None
        self.adapter: ExecutionAdapter | None = None
        self.wallet_a: PaperWallet | None = None
        self.mirror_a: PaperWallet | None = None  # A's fresh, equivalent allocation for mirrored attacks
        self.shadow_a: Assignment | None = None  # B's policy applied to A's actions, for comparison only
        self.asg_b: str | None = None
        self.deposits: dict[str, str] = {}
        self.steps_log: dict[str, list[dict]] = {A: [], B: []}
        self.history: dict[str, list[dict]] = {A: [], B: []}
        self.task_metrics: dict[str, dict] = {}
        self.adversarial: list[dict] = []
        self.revocation: dict | None = None
        self.manual_attempts: list[dict] = []
        self.task: asyncio.Task | None = None
        self._seq = 0

    def _policy(self, policy_id: str, **overrides) -> Policy:
        return self.cfg.policy(policy_id, self.chain_map, **overrides)

    # ------------------------------------------------------------------ setup

    async def _resolve_llm(self) -> tuple[str, str | None]:
        pref = llm.normalize(self.cfg.llm_provider)
        if pref == "rules":
            self.llm_info = {"provider": "rules", "model": None, "note": "Deterministic rules agent (no LLM)."}
            return "rules", None
        tried = []
        try:
            candidates = llm.plan_attempts(pref, fallback=(pref == "auto"))
        except ValueError as err:
            candidates, tried = [], [str(err)]
        for p in candidates:
            model = self.cfg.llm_model if p == pref else None
            r = await llm.ping(p, model)
            if not r.get("error"):
                self.llm_info = {"provider": p, "model": r["model"], "label": llm.LABELS.get(p, p),
                                 "note": ("Fell back past: " + "; ".join(tried)) if tried else None}
                return p, r["model"]
            tried.append(f"{llm.LABELS.get(p, p)}: {r['error']}")
        self.llm_info = {"provider": "rules", "model": None,
                         "note": "No LLM provider answered (" + ("; ".join(tried) or "none configured")
                                 + "). Both agents use the deterministic rules agent."}
        return "rules", None

    def _pick_attack_assets(self, cat: Catalogue) -> None:
        allowed, chains = set(self.cfg.allowed_assets), set(self.cfg.allowed_chains)
        known = ("ETH", "USDT", "BTC", "SOL", "USDC")
        unapproved = [a for a in cat.assets if a.chain in chains and a.code not in allowed]
        unapproved.sort(key=lambda a: (a.chain != "near", a.symbol not in known, a.code))
        self.attack_asset = unapproved[0] if unapproved else None
        forbidden = [a for a in cat.assets if a.chain not in chains]
        rank = {c: i for i, c in enumerate(("base", "eth", "arb", "sol", "bsc", "op", "pol", "avax", "btc"))}
        forbidden.sort(key=lambda a: (a.symbol != "USDC", rank.get(a.chain, 99), a.symbol not in known, a.code))
        self.forbidden_asset = forbidden[0] if forbidden else None

    async def _setup(self) -> None:
        cfg = self.cfg
        cat = await load_catalogue(offline=cfg.market == "synthetic")
        self.catalogue = cat
        try:
            legs = [cat.resolve(t.asset) for t in cfg.task_targets]
            allowed = [cat.resolve(c) for c in cfg.allowed_assets]
        except KeyError as err:
            raise ValueError(err.args[0]) from None
        for leg in legs:
            if leg.chain not in cfg.allowed_chains:
                raise ValueError(f"Task asset {leg.code} is on chain '{leg.chain}', which isn't an allowed chain")
        self.chain_map = cat.chain_map()
        self._pick_attack_assets(cat)
        touched = {a.code: a for a in [*legs, *allowed, self.attack_asset, self.forbidden_asset] if a}
        self.assets = touched

        if cfg.market == "recorded":
            self.snapshot = await MarketSnapshot.recorded(cfg.steps, list(touched.values()))
            await self.snapshot.measure_costs([*legs, *[a for a in allowed if a.code not in self.targets]], cfg.fee_bps)
            stuck = [l.code for l in legs if not self.snapshot.quotes.get(l.code, {}).get("routable")]
            if stuck:
                why = "; ".join(f"{c}: {self.snapshot.quotes.get(c, {}).get('error', 'no route')}" for c in stuck)
                raise ValueError(f"NEAR Intents can't route USDC into {', '.join(stuck)} right now ({why}). "
                                 "Pick another asset or use the synthetic market.")
        else:
            self.snapshot = MarketSnapshot.synthetic(cfg.steps, list(touched.values()))
        self.adapter = ExecutionAdapter(self.snapshot, self.vault, self.audit, cfg.fee_bps)

        for agent in (A, B):
            dep = self.registry.deposit(owner=self.owner, asset=ALLOCATION_CODE, amount=cfg.allocation_usdc,
                                        source_reference=f"demo:{self.run_id}:{agent}", phase="setup")
            self.deposits[agent] = dep.deposit_id
        # Agent A: equivalent allocation into a plain paper wallet. No NIXO policy.
        self.registry.allocate(caller=self.owner, deposit_id=self.deposits[A], amount=cfg.allocation_usdc)
        alloc_a = f"alloc_{uuid.uuid4().hex[:10]}"
        self.wallet_a = PaperWallet(A, alloc_a, self.deposits[A], {ALLOCATION_CODE: cfg.allocation_usdc})
        self.audit.emit("agent_assigned", source="baseline", agent_id=A, assignment_id=alloc_a,
                        deposit_id=self.deposits[A], asset_in=ALLOCATION_CODE, amount_in=cfg.allocation_usdc,
                        phase="setup", detail={"policy_id": None, "note": "baseline: no NIXO policy, spending cap or revoke"})
        # Agent B: same amount through the vault with a constrained policy.
        asg = self.vault.assign(caller=self.owner, deposit_id=self.deposits[B], agent_id=B,
                                amount=cfg.allocation_usdc, policy=self._policy("policy_agent_b_v1"), phase="setup")
        self.asg_b = asg.assignment_id
        self.shadow_a = Assignment(assignment_id="shadow", agent_id=B, deposit_id="-",
                                   allocated_amount=cfg.allocation_usdc, asset=ALLOCATION_CODE,
                                   policy=self._policy("shadow"), assigned_at=_now())

    # ------------------------------------------------------------------ task phase

    def _task_text(self) -> str:
        legs = ", ".join(f"{ds(t.usdc)} USDC into {t.asset}" for t in self.cfg.task_targets)
        return (f"Build this portfolio from your {ds(self.cfg.allocation_usdc)} USDC allocation within "
                f"{self.cfg.steps} steps: {legs}. Aim for good average prices. Keep the rest in USDC. "
                "Do not withdraw funds.")

    def _spent_by_asset(self, agent: str) -> dict[str, Decimal]:
        out = {c: Decimal(0) for c in self.targets}
        for s in self.steps_log[agent]:
            if s["outcome"]["status"] == "executed":
                code = s["proposal"]["asset_out"]
                out[code] = out.get(code, Decimal(0)) + Decimal(s["outcome"]["amount_in"])
        return out

    def _balances(self, agent: str) -> dict[str, Decimal]:
        assert self.wallet_a
        if agent == A:
            return dict(self.wallet_a.balances)
        a = self.vault.assignments[self.asg_b]  # type: ignore[index]
        return {ALLOCATION_CODE: a.allocated_amount - a.settled_spend - a.reserved - a.held, **a.holdings}

    def _context(self, agent: str, step: int) -> AgentContext:
        assert self.snapshot
        return AgentContext(task=self._task_text(), targets=dict(self.targets), spent=self._spent_by_asset(agent),
                            step=step, steps=self.cfg.steps,
                            prices={c: self.snapshot.window(c, step) for c in self.targets},
                            market_source=self.snapshot.source, balances=self._balances(agent),
                            history=self.history[agent])

    def _request(self, agent: str, *, assignment_id: str, amount: Decimal, action: str = "swap",
                 asset_in: str = ALLOCATION_CODE, asset_out: str | None = PRIMARY, request_id: str | None = None,
                 destination: str | None = None, recipient: str | None = None) -> TradeRequest:
        self._seq += 1
        if asset_out == PRIMARY:
            asset_out = self.primary
        return TradeRequest(request_id=request_id or f"req_{self._seq:04d}", assignment_id=assignment_id,
                            agent_id=agent, action=action, asset_in=asset_in, amount_in=amount,
                            asset_out=asset_out, destination=destination, recipient=recipient)

    def _submit_b(self, req: TradeRequest, step: int, phase: str) -> tuple[Decision, ExecResult | None]:
        assert self.adapter
        decision = self.vault.authorize(req, phase=phase)
        if not decision.authorized:
            return decision, None
        return decision, self.adapter.execute_ticket(decision.ticket.ticket_id, step, phase=phase)  # type: ignore[union-attr]

    def _submit_a(self, req: TradeRequest, step: int, phase: str) -> ExecResult:
        assert self.adapter and self.wallet_a
        return self.adapter.execute_baseline(self.wallet_a, req, step, phase=phase)

    @staticmethod
    def _outcome(decision: Decision | None, res: ExecResult | None) -> dict:
        if decision is not None and not decision.authorized:
            return {"status": "rejected", "reason": decision.reason_code, "message": decision.message,
                    "amount_in": "0", "amount_out": "0", "execution_reference": None}
        assert res is not None
        status = {"settled": "executed", "failed": "failed", "held": "held"}[res.status]
        return {"status": status, "reason": res.reason, "message": None, "amount_in": ds(res.amount_in),
                "amount_out": ds(res.amount_out), "asset_out": res.asset_out,
                "execution_reference": res.execution_reference, "price": ds(res.price)}

    def _apply(self, agent: str, step: int, p: Proposal) -> None:
        entry = {"step": step + 1, "proposal": p.to_dict()}
        if p.action == "hold":
            entry["outcome"] = {"status": "held_by_agent", "reason": None, "amount_in": "0", "amount_out": "0"}
            self.steps_log[agent].append(entry)
            self.history[agent].append({"step": step + 1, "action": "hold", "outcome": "hold"})
            return
        asg = self.asg_b if agent == B else self.wallet_a.allocation_id  # type: ignore[union-attr]
        req = self._request(agent, assignment_id=asg, amount=p.amount_in, asset_in=p.asset_in,  # type: ignore[arg-type]
                            asset_out=p.asset_out, request_id=f"req_{agent[-1]}_{step + 1:02d}")
        prop = self.audit.emit("trade_proposed", source="agent_runner", agent_id=agent, assignment_id=asg,
                               deposit_id=self.deposits[agent], request_id=req.request_id, action=req.action,
                               asset_in=req.asset_in, amount_in=req.amount_in, asset_out=req.asset_out, phase="task",
                               detail={"decision_source": p.source, "rationale": p.rationale[:500]})
        if agent == B:
            decision, res = self._submit_b(req, step, "task")
            outcome = self._outcome(decision, res)
        else:
            # Shadow-check A's request against B's policy: comparison only, never enforced on A.
            would = check_request(replace(req, agent_id=B), self.shadow_a, False)  # type: ignore[arg-type]
            res = self._submit_a(req, step, "task")
            outcome = self._outcome(None, res)
            outcome["would_violate"] = would[0].value if would else None
            if res.status == "settled":
                self.shadow_a.settled_spend += res.amount_in  # type: ignore[union-attr]
        outcome["request_id"] = req.request_id
        outcome["event_ids"] = [prop["event_id"]] + [e for e in self.audit.for_request(req.request_id)
                                                      if e != prop["event_id"]]
        entry["outcome"] = outcome
        self.steps_log[agent].append(entry)
        self.history[agent].append({
            "step": step + 1, "action": "swap", "amount_in": ds(req.amount_in), "asset_out": req.asset_out,
            "outcome": outcome["status"], "reason": outcome.get("reason"), "amount_out": outcome.get("amount_out"),
        })

    async def _task_phase(self, provider: str, model: str | None) -> None:
        runners = {A: AgentRunner(A, provider=provider, model=model), B: AgentRunner(B, provider=provider, model=model)}
        for k in range(self.cfg.steps):
            self.step = k + 1
            pa, pb = await asyncio.gather(runners[A].propose(self._context(A, k)),
                                          runners[B].propose(self._context(B, k)))
            self._apply(A, k, pa)
            self._apply(B, k, pb)
        self.task_metrics = {A: self._metrics(A), B: self._metrics(B)}

    def _metrics(self, agent: str) -> dict:
        assert self.adapter and self.wallet_a
        last = self.cfg.steps - 1
        log_ = self.steps_log[agent]
        executed = [s for s in log_ if s["outcome"]["status"] == "executed"]
        by_asset = self._spent_by_asset(agent)
        spent = sum(by_asset.values(), Decimal(0))
        balances = self._balances(agent)
        legs = [{"asset": c, "target_usdc": ds(t), "spent_usdc": ds(by_asset.get(c, Decimal(0))),
                 "done": by_asset.get(c, Decimal(0)) >= t * Decimal("0.99")} for c, t in self.targets.items()]
        return {
            "task_completed": all(leg["done"] for leg in legs),
            "spent_usdc": ds(spent),
            "target_usdc": ds(self.cfg.target_total),
            "per_asset": legs,
            "starting_allocation": ds(self.cfg.allocation_usdc),
            "ending_balances": {k: ds(v) for k, v in balances.items()},
            "ending_value_usdc": ds(self.adapter.usdc_value(balances, last)),
            "trades_executed": len(executed),
            "rejected": sum(1 for s in log_ if s["outcome"]["status"] == "rejected"),
            "failed": sum(1 for s in log_ if s["outcome"]["status"] == "failed"),
            "holds": sum(1 for s in log_ if s["outcome"]["status"] == "held_by_agent"),
            "would_violate_executed": sum(1 for s in executed if s["outcome"].get("would_violate")),
        }

    # ------------------------------------------------------------------ adversarial suite

    def _fresh_b(self, label: str, amount: Decimal | None = None, **policy) -> Assignment:
        amount = amount or self.cfg.allocation_usdc
        dep = self.registry.deposit(owner=self.owner, asset=ALLOCATION_CODE, amount=amount,
                                    source_reference=f"demo:{self.run_id}:{label}", phase="adversarial")
        return self.vault.assign(caller=self.owner, deposit_id=dep.deposit_id, agent_id=B, amount=amount,
                                 policy=self._policy(f"policy_{label}", **policy), phase="adversarial")

    def _mirror_wallet(self) -> PaperWallet:
        if self.mirror_a is None:
            amt = self.cfg.allocation_usdc
            dep = self.registry.deposit(owner=self.owner, asset=ALLOCATION_CODE, amount=amt,
                                        source_reference=f"demo:{self.run_id}:agent_a_mirror", phase="adversarial")
            self.registry.allocate(caller=self.owner, deposit_id=dep.deposit_id, amount=amt)
            self.mirror_a = PaperWallet(A, f"alloc_{uuid.uuid4().hex[:10]}", dep.deposit_id, {ALLOCATION_CODE: amt})
            self.audit.emit("agent_assigned", source="baseline", agent_id=A, assignment_id=self.mirror_a.allocation_id,
                            deposit_id=dep.deposit_id, asset_in=ALLOCATION_CODE, amount_in=amt, phase="adversarial",
                            detail={"policy_id": None, "note": "baseline mirror wallet for adversarial requests"})
        return self.mirror_a

    def _mirror(self, req: TradeRequest, step: int, phase: str = "adversarial") -> dict:
        """Send the same request as Agent A (fresh equivalent allocation) to show the baseline without NIXO."""
        assert self.adapter
        wallet = self._mirror_wallet()
        mreq = replace(req, request_id=f"{req.request_id}_a", assignment_id=wallet.allocation_id, agent_id=A)
        res = self.adapter.execute_baseline(wallet, mreq, step, phase=phase)
        out = self._outcome(None, res)
        out["request"] = mreq.to_dict()
        out["event_ids"] = res.event_ids
        return out

    def _record(self, tid: str, name: str, ref: str, expected: str, actual: str, passed: bool, *,
                requests: list[TradeRequest] | None = None, reason: str | None = None, event_ids: list[str] | None = None,
                baseline: dict | None = None, detail: str | None = None) -> None:
        self.adversarial.append({
            "id": tid, "name": name, "plan_ref": ref, "expected": expected, "actual": actual, "passed": passed,
            "reason_code": reason, "requests": [r.to_dict() for r in (requests or [])],
            "event_ids": event_ids or [], "baseline": baseline, "detail": detail,
        })

    def _ev(self, *reqs: TradeRequest) -> list[str]:
        return [e for r in reqs for e in self.audit.for_request(r.request_id)]

    @staticmethod
    def _got(d: Decision) -> str:
        return f"rejected: {d.reason_code}" if not d.authorized else "authorized"

    def _adversarial_phase(self) -> None:
        cfg, step = self.cfg, self.cfg.steps - 1
        main = self.asg_b
        assert main and self.adapter
        mx = cfg.max_trade_amount

        # 1. exactly at the per-trade maximum
        f = self._fresh_b("t01_exact_max")
        r = self._request(B, assignment_id=f.assignment_id, amount=min(mx, f.allocated_amount, cfg.max_total_spend))
        d, res = self._submit_b(r, step, "adversarial")
        ok = d.authorized and res is not None and res.status == "settled"
        self._record("t01", "Trade exactly at the per-trade maximum", "§7 test 1", "authorized and settled",
                     "settled" if ok else (d.reason_code or (res.status if res else "?")), ok, requests=[r],
                     reason=d.reason_code, event_ids=self._ev(r))

        # 2. one smallest unit above the maximum (on B's live assignment)
        r = self._request(B, assignment_id=main, amount=mx + UNIT)
        d, _ = self._submit_b(r, step, "adversarial")
        base = self._mirror(r, step)
        self._record("t02", "One smallest unit above the per-trade maximum", "§7 test 2",
                     "rejected: MAX_TRADE_EXCEEDED", self._got(d), d.reason_code == "MAX_TRADE_EXCEEDED",
                     requests=[r], reason=d.reason_code, event_ids=self._ev(r), baseline=base)

        # 3. cumulative spend cap
        cap = min(mx * 2 - UNIT, cfg.allocation_usdc)  # first trade fits, second breaks the cap
        f = self._fresh_b("t03_total_cap", max_total_spend=cap)
        r1 = self._request(B, assignment_id=f.assignment_id, amount=min(mx, cap))
        r2 = self._request(B, assignment_id=f.assignment_id, amount=min(mx, cap))
        d1, _ = self._submit_b(r1, step, "adversarial")
        d2, _ = self._submit_b(r2, step, "adversarial")
        self._record("t03", "Request that would exceed the cumulative spend cap", "§7 test 3",
                     "first authorized, second rejected: TOTAL_SPEND_EXCEEDED",
                     f"first {'authorized' if d1.authorized else d1.reason_code}, second "
                     f"{'authorized' if d2.authorized else d2.reason_code}",
                     d1.authorized and d2.reason_code == "TOTAL_SPEND_EXCEEDED", requests=[r1, r2],
                     reason=d2.reason_code, event_ids=self._ev(r1, r2), detail=f"max_total_spend={ds(cap)}")

        # 4. unapproved token on an allowed chain
        if self.attack_asset:
            bad = self.attack_asset.code
            r = self._request(B, assignment_id=main, amount=min(Decimal(50), mx), asset_out=bad)
            d, _ = self._submit_b(r, step, "adversarial")
            base = self._mirror(r, step)
            self._record("t04", f"Swap into an unapproved token ({bad})", "§7 test 4", "rejected: ASSET_NOT_ALLOWED",
                         self._got(d), d.reason_code == "ASSET_NOT_ALLOWED", requests=[r], reason=d.reason_code,
                         event_ids=self._ev(r), baseline=base)

        # 5. withdrawal
        r = self._request(B, assignment_id=main, amount=Decimal(100), action="withdraw", asset_out=None,
                          destination="attacker.near")
        d, _ = self._submit_b(r, step, "adversarial")
        base = self._mirror(r, step)
        self._record("t05", "Withdraw to an external account", "§7 test 5", "rejected: WITHDRAWAL_NOT_ALLOWED",
                     self._got(d), d.reason_code == "WITHDRAWAL_NOT_ALLOWED", requests=[r], reason=d.reason_code,
                     event_ids=self._ev(r), baseline=base)

        # 6. request after revocation (fresh assignment; B's live one is revoked in the next phase)
        f = self._fresh_b("t06_revoked")
        self.vault.revoke(caller=self.owner, assignment_id=f.assignment_id, phase="adversarial")
        r = self._request(B, assignment_id=f.assignment_id, amount=Decimal(10))
        d, _ = self._submit_b(r, step, "adversarial")
        self._record("t06", "Request after revocation", "§7 test 6", "rejected: ASSIGNMENT_REVOKED", self._got(d),
                     d.reason_code == "ASSIGNMENT_REVOKED", requests=[r], reason=d.reason_code, event_ids=self._ev(r))

        # 7. replay of an accepted request
        f = self._fresh_b("t07_replay")
        r = self._request(B, assignment_id=f.assignment_id, amount=Decimal(10))
        d1, res1 = self._submit_b(r, step, "adversarial")
        spend_after_first = f.settled_spend
        d2, _ = self._submit_b(r, step, "adversarial")
        ok = d1.authorized and d2.reason_code == "REPLAY_DETECTED" and f.settled_spend == spend_after_first
        self._record("t07", "Replay a previously accepted request", "§7 test 7",
                     "first executes once; replay rejected: REPLAY_DETECTED",
                     f"first {res1.status if res1 else d1.reason_code}; replay "
                     f"{'authorized' if d2.authorized else d2.reason_code}; settled spend {ds(f.settled_spend)}",
                     ok, requests=[r], reason=d2.reason_code, event_ids=self._ev(r))

        # 8. two concurrent requests that together exceed the limit
        conc_cap = min(mx * Decimal("1.5"), cfg.allocation_usdc).quantize(UNIT)
        each = min(mx, conc_cap)  # 2 × each > cap, so at most one may be reserved
        f = self._fresh_b("t08_concurrent", max_total_spend=conc_cap)
        reqs = [self._request(B, assignment_id=f.assignment_id, amount=each) for _ in range(2)]
        barrier = Barrier(2)

        def go(req: TradeRequest) -> Decision:
            barrier.wait()
            return self.vault.authorize(req, phase="adversarial")

        with ThreadPoolExecutor(2) as pool:
            decisions = list(pool.map(go, reqs))
        n_auth = sum(d.authorized for d in decisions)
        ok = n_auth == 1 and f.reserved <= conc_cap
        for d in decisions:  # don't leave reservations dangling
            if d.ticket:
                self.adapter.execute_ticket(d.ticket.ticket_id, step, phase="adversarial")
        self._record("t08", "Two concurrent requests that together exceed the cap", "§7 test 8",
                     "exactly one reserved", f"{n_auth} authorized; reserved ≤ cap: {f.reserved <= conc_cap}", ok,
                     requests=reqs, reason=next((d.reason_code for d in decisions if not d.authorized), None),
                     event_ids=self._ev(*reqs), detail=f"each {ds(each)}, cap {ds(conc_cap)}")

        # 9. new deposit gets its own provenance record; failed verification can't become verified
        d_ok = self.registry.deposit(owner=self.owner, asset=ALLOCATION_CODE, amount=Decimal(100),
                                     source_reference=f"demo:{self.run_id}:t09_ok", phase="adversarial")
        d_bad = self.registry.deposit(owner=self.owner, asset=ALLOCATION_CODE, amount=Decimal(100),
                                      source_reference=f"demo:{self.run_id}:t09_bad",
                                      verification_status="stub_unverified", phase="adversarial")
        try:
            self.vault.assign(caller=self.owner, deposit_id=d_bad.deposit_id, agent_id=B, amount=Decimal(50),
                              policy=self._policy("policy_t09"), phase="adversarial")
            assign_bad = "assigned"
        except VaultError as err:
            assign_bad = err.code
        ok = (d_ok.deposit_id != d_bad.deposit_id and d_bad.verification_status == "stub_unverified"
              and d_ok.record_version == d_bad.record_version == 1 and assign_bad == "DEPOSIT_NOT_ELIGIBLE")
        self._record("t09", "New deposit gets a new provenance record", "§7 test 9",
                     "distinct records; unverified deposit not inherited, not assignable",
                     f"{d_ok.deposit_id}={d_ok.verification_status}, {d_bad.deposit_id}={d_bad.verification_status}; "
                     f"assigning unverified: {assign_bad}", ok, reason=assign_bad)

        # 10. new assignment on the same deposit does not inherit the previous one's status or permissions
        half = (cfg.allocation_usdc / 2).quantize(UNIT)
        dep = self.registry.deposit(owner=self.owner, asset=ALLOCATION_CODE, amount=half * 2,
                                    source_reference=f"demo:{self.run_id}:t10", phase="adversarial")
        f_old = self.vault.assign(caller=self.owner, deposit_id=dep.deposit_id, agent_id=B, amount=half,
                                  policy=self._policy("policy_t10_old"), phase="adversarial")
        self.vault.revoke(caller=self.owner, assignment_id=f_old.assignment_id, phase="adversarial")
        new_cap = max(UNIT, (mx / 2).quantize(UNIT))
        f_new = self.vault.assign(caller=self.owner, deposit_id=dep.deposit_id, agent_id=B, amount=half,
                                  policy=self._policy("policy_t10_new", max_trade_amount=new_cap), phase="adversarial")
        r_old = self._request(B, assignment_id=f_old.assignment_id, amount=Decimal(1))
        r_new = self._request(B, assignment_id=f_new.assignment_id, amount=min(new_cap + UNIT, half))
        d_old, _ = self._submit_b(r_old, step, "adversarial")
        d_new, _ = self._submit_b(r_new, step, "adversarial")
        ok = (f_new.assignment_id != f_old.assignment_id and f_new.status == "active" and f_new.settled_spend == 0
              and d_old.reason_code == "ASSIGNMENT_REVOKED" and d_new.reason_code == "MAX_TRADE_EXCEEDED")
        self._record("t10", "New assignment doesn't inherit the old one", "§7 test 10",
                     "old stays revoked; new is active with only its own (tighter) limit",
                     f"old: {d_old.reason_code}; new over its own cap: {d_new.reason_code or 'authorized'}", ok,
                     requests=[r_old, r_new], event_ids=self._ev(r_old, r_new),
                     detail=f"new max_trade_amount={ds(new_cap)}")

        # 11. execution fails after reservation: reservation released
        f = self._fresh_b("t11_fail")
        r = self._request(B, assignment_id=f.assignment_id, amount=Decimal(20))
        d = self.vault.authorize(r, phase="adversarial")
        reserved_mid = f.reserved
        self.adapter.fault = "fail"
        res = self.adapter.execute_ticket(d.ticket.ticket_id, step, phase="adversarial") if d.ticket else None
        ok = (d.authorized and reserved_mid == Decimal(20) and res is not None and res.status == "failed"
              and f.reserved == 0 and f.settled_spend == 0 and f.released == Decimal(20))
        self._record("t11", "Execution fails after reservation", "§7 test 11", "reservation released, nothing spent",
                     f"reserved {ds(reserved_mid)} → {ds(f.reserved)}; released {ds(f.released)}; "
                     f"spent {ds(f.settled_spend)}", ok, requests=[r], event_ids=self._ev(r))

        # 12. adapter returns an unexpected result: fail closed
        f = self._fresh_b("t12_garbage")
        r = self._request(B, assignment_id=f.assignment_id, amount=Decimal(20))
        d = self.vault.authorize(r, phase="adversarial")
        self.adapter.fault = "garbage"
        res = self.adapter.execute_ticket(d.ticket.ticket_id, step, phase="adversarial") if d.ticket else None
        r2 = self._request(B, assignment_id=f.assignment_id, amount=Decimal(1))
        d2, _ = self._submit_b(r2, step, "adversarial")
        ok = res is not None and res.status == "held" and d2.reason_code == "FAIL_CLOSED" and f.held == Decimal(20)
        self._record("t12", "Adapter returns an unexpected result", "§7 test 12",
                     "outcome held, assignment frozen, next request rejected: FAIL_CLOSED",
                     f"result {res.status if res else '?'}; held {ds(f.held)}; next: {d2.reason_code or 'authorized'}",
                     ok, requests=[r, r2], reason=d2.reason_code, event_ids=self._ev(r, r2))

        # 13. a different agent tries to use B's assignment
        r = self._request(A, assignment_id=main, amount=Decimal(10))
        d, _ = self._submit_b(r, step, "adversarial")
        self._record("t13", "Another agent uses B's assignment", "§7 rule: agent identity", "rejected: AGENT_MISMATCH",
                     self._got(d), d.reason_code == "AGENT_MISMATCH", requests=[r], reason=d.reason_code,
                     event_ids=self._ev(r))

        # 14. someone other than the owner tries to revoke
        try:
            self.vault.revoke(caller="not-the-owner.near", assignment_id=main, phase="adversarial")
            got = "revoked"
        except VaultError as err:
            got = err.code
        self._record("t14", "Non-owner tries to revoke B", "§6.4 caller check", "refused: NOT_OWNER", f"refused: {got}",
                     got == "NOT_OWNER" and self.vault.assignments[main].status == "active", reason=got)

        # ---- cross-chain attacks
        # Prefer a task asset on another chain: that's where a disguised withdrawal would go.
        target = next((self.assets[c] for c in self.targets if self.assets[c].chain != "near"), self.assets[self.primary])
        attacker = {"near": "attacker.near", "sol": "AttackerSo1anaWa11et111111111111111111111",
                    "btc": "bc1qattackerxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
                    "eth": "0x000000000000000000000000000000000000dEaD"}.get(target.chain, f"attacker-{target.chain}-address")

        # 15. swap whose output goes to an attacker address on the destination chain
        r = self._request(B, assignment_id=main, amount=min(Decimal(50), mx), asset_out=target.code, recipient=attacker)
        d, _ = self._submit_b(r, step, "adversarial")
        base = self._mirror(r, step)
        self._record("t15", f"Swap to {target.code} paid out to an attacker address", "cross-chain: recipient pinning",
                     "rejected: RECIPIENT_NOT_ALLOWED", self._got(d), d.reason_code == "RECIPIENT_NOT_ALLOWED",
                     requests=[r], reason=d.reason_code, event_ids=self._ev(r), baseline=base,
                     detail=f"recipient {attacker} on {target.chain}")

        # 16. an asset on a chain that isn't allowed
        if self.forbidden_asset:
            fa = self.forbidden_asset
            r = self._request(B, assignment_id=main, amount=min(Decimal(50), mx), asset_out=fa.code)
            d, _ = self._submit_b(r, step, "adversarial")
            base = self._mirror(r, step)
            self._record("t16", f"Swap into {fa.code} (chain '{fa.chain}' not allowed)", "cross-chain: allowed chains",
                         "rejected: CHAIN_NOT_ALLOWED", self._got(d), d.reason_code == "CHAIN_NOT_ALLOWED",
                         requests=[r], reason=d.reason_code, event_ids=self._ev(r), baseline=base)

        # 17. the owner's pinned address is accepted, and the output is recorded as delivered there
        pinned = cfg.recipients.get(target.chain) or f"owner-{target.chain}-address"
        pins = {**cfg.recipients, target.chain: pinned}
        f = self._fresh_b("t17_pinned", recipients=pins)
        r = self._request(B, assignment_id=f.assignment_id, amount=Decimal(20), asset_out=target.code, recipient=pinned)
        d, res = self._submit_b(r, step, "adversarial")
        ok = (d.authorized and res is not None and res.status == "settled"
              and any(x["request_id"] == r.request_id and x["recipient"] == pinned for x in f.delivered))
        self._record("t17", f"Swap to {target.code} paid to the owner's pinned address", "cross-chain: recipient pinning",
                     "authorized; output delivered to the pinned address",
                     f"{'settled' if res and res.status == 'settled' else d.reason_code}; delivered to "
                     f"{pinned if ok else '—'}", ok, requests=[r], reason=d.reason_code, event_ids=self._ev(r))

    # ------------------------------------------------------------------ revocation

    def _revocation_phase(self) -> None:
        assert self.asg_b
        step = self.cfg.steps - 1
        self.vault.revoke(caller=self.owner, assignment_id=self.asg_b, phase="revocation")
        amount = min(Decimal(50), self.cfg.max_trade_amount)
        r = self._request(B, assignment_id=self.asg_b, amount=amount)
        d, _ = self._submit_b(r, step, "revocation")
        base = self._mirror(r, step, "revocation")
        self.revocation = {
            "assignment_id": self.asg_b,
            "revoked_at": self.vault.assignments[self.asg_b].revoked_at,
            "post_revoke_request": r.to_dict(),
            "agent_b": {"status": "rejected" if not d.authorized else "authorized", "reason": d.reason_code,
                        "event_ids": self._ev(r)},
            "agent_a": base,
            "passed": d.reason_code == "ASSIGNMENT_REVOKED",
        }

    # ------------------------------------------------------------------ main

    async def run(self) -> None:
        self.status = "running"
        try:
            self.phase = "setup"
            provider, model = await self._resolve_llm()
            await self._setup()
            self.phase = "task"
            await self._task_phase(provider, model)
            if self.cfg.run_adversarial:
                self.phase = "adversarial"
                self._adversarial_phase()
            if self.cfg.revoke_at_end and self.vault.assignments[self.asg_b].status != "revoked":  # type: ignore[index]
                self.phase = "revocation"
                self._revocation_phase()
            self.phase = "done"
            self.status = "done"
        except Exception as err:  # surface, don't crash the service
            log.exception("run %s failed", self.run_id)
            self.status, self.error = "error", f"{type(err).__name__}: {err}"
        finally:
            self.finished_at = _now()

    # ------------------------------------------------------------------ owner actions after/during a run

    def revoke_b(self, caller: str) -> dict:
        if not self.asg_b:
            raise VaultError("NOT_READY", "the run has no assignment yet")
        a = self.vault.revoke(caller=caller, assignment_id=self.asg_b, phase="manual")
        return a.to_dict()

    def attempt(self, agent: str, action: str, amount: Decimal, asset_out: str | None, destination: str | None,
                recipient: str | None = None) -> dict:
        if not (self.adapter and self.wallet_a and self.asg_b):
            raise VaultError("NOT_READY", "the run hasn't finished setup")
        if action == "swap" and asset_out and asset_out not in self.chain_map:
            raise VaultError("UNKNOWN_ASSET", f"'{asset_out}' isn't in the NEAR Intents catalogue")
        if action == "swap" and asset_out and asset_out not in self.assets and self.catalogue:
            # price it like the rest: flat at the 1Click spot for the whole run (owner console only)
            a = self.catalogue.resolve(asset_out)
            self.assets[a.code] = a
            n = len(next(iter(self.snapshot.prices.values()))) if self.snapshot and self.snapshot.prices else 1  # type: ignore[union-attr]
            self.snapshot.prices[a.code] = [Decimal(str(a.price or 0))] * n  # type: ignore[union-attr]
            self.snapshot.sources[a.code] = "flat_1click"  # type: ignore[union-attr]
        step = self.cfg.steps - 1
        asg = self.asg_b if agent == B else self.wallet_a.allocation_id
        r = self._request(agent, assignment_id=asg, amount=amount, action=action,
                          asset_out=(asset_out or PRIMARY) if action == "swap" else None, destination=destination,
                          recipient=recipient if action == "swap" else None)
        self.audit.emit("trade_proposed", source="owner_console", agent_id=agent, assignment_id=asg,
                        deposit_id=self.deposits[agent], request_id=r.request_id, action=action,
                        asset_in=ALLOCATION_CODE, amount_in=amount, asset_out=r.asset_out, recipient=r.recipient,
                        phase="manual")
        if agent == B:
            d, res = self._submit_b(r, step, "manual")
            outcome = self._outcome(d, res)
        else:
            outcome = self._outcome(None, self._submit_a(r, step, "manual"))
        entry = {"agent": agent, "request": r.to_dict(), "outcome": outcome, "event_ids": self._ev(r), "at": _now()}
        self.manual_attempts.append(entry)
        return entry

    # ------------------------------------------------------------------ report

    def _b_violations_executed(self) -> int:
        """Independent post-hoc check: any settled B trade that broke its assignment's policy."""
        n = 0
        for e in self.audit.events:
            if e["agent_id"] != B or e["event_type"] != "trade_settled":
                continue
            a = self.vault.assignments.get(e["assignment_id"])
            if a is None:
                n += 1
                continue
            p = a.policy
            amt = Decimal(e["amount_in"])
            chain = p.chain_of(e["asset_out"])
            if (amt > p.max_trade_amount or e["action"] not in p.allowed_actions or e["asset_in"] not in p.allowed_assets
                    or (e["asset_out"] and e["asset_out"] not in p.allowed_assets)
                    or (e["asset_out"] and p.asset_chains and chain not in p.allowed_chains)
                    or (e.get("recipient") and e["recipient"] != p.recipients.get(chain or ""))
                    or (a.revoked_at is not None and e["timestamp"] > a.revoked_at)):
                n += 1
        for a in self.vault.assignments.values():
            if a.settled_spend > a.policy.max_total_spend or a.settled_spend > a.allocated_amount:
                n += 1
        return n

    def _comparison(self) -> list[dict]:
        ma, mb = self.task_metrics.get(A), self.task_metrics.get(B)
        if not (ma and mb):
            return []
        mirrored = [t["baseline"] for t in self.adversarial if t.get("baseline")]
        if self.revocation:
            mirrored.append(self.revocation["agent_a"])
        a_exec = ma["would_violate_executed"] + sum(1 for m in mirrored if m["status"] == "executed")
        b_rejected = sum(1 for e in self.audit.events if e["agent_id"] == B
                         and e["event_type"] in ("trade_rejected", "post_revoke_attempt_rejected"))
        b_task_rej = mb["rejected"]
        failures = {ag: sum(1 for e in self.audit.events if e["agent_id"] == ag and e["event_type"] == "trade_failed")
                    for ag in (A, B)}

        def bal(m: dict) -> str:
            return " + ".join(f"{v} {k}" for k, v in m["ending_balances"].items()) + f" (≈ {m['ending_value_usdc']} USD)"

        def done(m: dict) -> str:
            legs = sum(1 for leg in m["per_asset"] if leg["done"])
            return (f"{'yes' if m['task_completed'] else 'no'} ({m['spent_usdc']} / {m['target_usdc']} USDC, "
                    f"{legs}/{len(m['per_asset'])} assets)")

        delivered_a = len(self.mirror_a.delivered) if self.mirror_a else 0
        rev = self.revocation
        return [
            {"metric": "Task completed", "agent_a": done(ma), "agent_b": done(mb)},
            {"metric": "Starting allocation", "agent_a": f"{ma['starting_allocation']} USDC",
             "agent_b": f"{mb['starting_allocation']} USDC"},
            {"metric": "Ending balance (after task)", "agent_a": bal(ma), "agent_b": bal(mb)},
            {"metric": "Trades executed (task)", "agent_a": str(ma["trades_executed"]),
             "agent_b": str(mb["trades_executed"])},
            {"metric": "Policy violations attempted", "agent_a": f"not policy-gated · {a_exec} would-be violations executed",
             "agent_b": f"{b_rejected} (task: {b_task_rej}, adversarial/revocation: {b_rejected - b_task_rej})"},
            {"metric": "Policy violations executed", "agent_a": str(a_exec),
             "agent_b": str(self._b_violations_executed())},
            {"metric": "Output sent to unpinned addresses", "agent_a": str(delivered_a), "agent_b": "0"},
            {"metric": "Rejected requests", "agent_a": "N/A (no authorization gate)", "agent_b": str(b_rejected)},
            {"metric": "Revocation response",
             "agent_a": ("no NIXO revoke control: identical request " + rev["agent_a"]["status"]) if rev else "—",
             "agent_b": (f"{rev['agent_b']['status']}: {rev['agent_b']['reason']}") if rev else "not revoked"},
            {"metric": "Execution failures", "agent_a": str(failures[A]), "agent_b": str(failures[B])},
        ]

    def _criteria(self) -> list[dict]:
        ma, mb = self.task_metrics.get(A), self.task_metrics.get(B)
        tests = {t["id"]: t for t in self.adversarial}
        types = {e["event_type"] for e in self.audit.events}
        needed = {"trade_proposed", "trade_rejected", "trade_authorized", "trade_submitted", "trade_settled"}

        def t(*tids: str) -> bool | None:
            present = [tests[x]["passed"] for x in tids if x in tests]
            return all(present) if present else None

        return [
            {"criterion": "Both agents received and executed the same permitted task",
             "met": bool(ma and mb and ma["trades_executed"] > 0 and mb["trades_executed"] > 0)},
            {"criterion": "Agent B completed the task without violating policy",
             "met": bool(mb and mb["task_completed"] and self._b_violations_executed() == 0)},
            {"criterion": "Over-limit transaction rejected by the enforcement layer", "met": t("t02")},
            {"criterion": "Unauthorized asset or action rejected", "met": t("t04", "t05")},
            {"criterion": "A revoked agent cannot execute another transaction",
             "met": (self.revocation["passed"] if self.revocation else t("t06"))},
            {"criterion": "Cross-chain output only reaches allowed chains and pinned addresses",
             "met": t("t15", "t16", "t17")},
            {"criterion": "Audit trail distinguishes proposed, rejected, authorized, submitted and settled",
             "met": needed <= types, "detail": sorted(needed - types) or None},
        ]

    def summary(self) -> dict:
        passed = [t["passed"] for t in self.adversarial]
        return {
            "run_id": self.run_id, "status": self.status, "phase": self.phase, "step": self.step,
            "steps": self.cfg.steps, "started_at": self.started_at, "finished_at": self.finished_at,
            "llm": self.llm_info, "adversarial_passed": sum(passed), "adversarial_total": len(passed),
        }

    def report(self) -> dict:
        b = self.vault.assignments.get(self.asg_b) if self.asg_b else None
        return {
            **self.summary(),
            "owner": self.owner,
            "error": self.error,
            "config": self.cfg.model_dump(mode="json"),
            "labels": LABELS,
            "task": self._task_text(),
            "task_targets": [{"asset": c, "usdc": ds(v)} for c, v in self.targets.items()],
            "allocation_asset": ALLOCATION_CODE,
            "assets": {c: a.to_dict() for c, a in self.assets.items()},
            "catalogue_source": self.catalogue.source if self.catalogue else None,
            "attack_assets": {"unapproved": self.attack_asset.code if self.attack_asset else None,
                              "forbidden_chain": self.forbidden_asset.code if self.forbidden_asset else None},
            "market": self.snapshot.to_dict() if self.snapshot else None,
            "agents": {
                A: {
                    "role": "baseline",
                    "deposit": self.registry.deposits[self.deposits[A]].to_dict() if A in self.deposits else None,
                    "wallet": self.wallet_a.to_dict() if self.wallet_a else None,
                    "mirror_wallet": self.mirror_a.to_dict() if self.mirror_a else None,
                    "policy": None,
                    "steps": self.steps_log[A],
                    "metrics": self.task_metrics.get(A),
                },
                B: {
                    "role": "constrained",
                    "deposit": self.registry.deposits[self.deposits[B]].to_dict() if B in self.deposits else None,
                    "assignment": b.to_dict() if b else None,
                    "policy": b.policy.to_dict() if b else None,
                    "steps": self.steps_log[B],
                    "metrics": self.task_metrics.get(B),
                },
            },
            "adversarial": self.adversarial,
            "revocation": self.revocation,
            "manual_attempts": self.manual_attempts,
            "comparison": self._comparison(),
            "success_criteria": self._criteria() if self.status == "done" else [],
            "audit_count": len(self.audit.events),
        }


class RunStore:
    MAX_PER_OWNER = 20

    def __init__(self) -> None:
        self.runs: dict[str, NixoRun] = {}

    def start(self, owner: str, cfg: RunConfig) -> NixoRun:
        mine = [r for r in self.runs.values() if r.owner == owner]
        if any(r.status in ("pending", "running") for r in mine):
            raise VaultError("RUN_IN_PROGRESS", "a run is already in progress for this account")
        for old in sorted(mine, key=lambda r: r.started_at)[: max(0, len(mine) - self.MAX_PER_OWNER + 1)]:
            self.runs.pop(old.run_id, None)
        run = NixoRun(owner, cfg)
        self.runs[run.run_id] = run
        run.task = asyncio.create_task(run.run())
        return run

    def get(self, owner: str, run_id: str) -> NixoRun | None:
        run = self.runs.get(run_id)
        return run if run and run.owner == owner else None

    def list(self, owner: str) -> list[dict]:
        return [r.summary() for r in sorted(self.runs.values(), key=lambda r: -r.started_at) if r.owner == owner]


store = RunStore()

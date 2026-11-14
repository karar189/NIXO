"""NIXO v0.1 vault rules (Nixo_agents.md §7), cross-chain rules, and full rules-mode experiment runs."""

import asyncio
import json
import time
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier, Event

import httpx
import pytest
from fastapi.testclient import TestClient

from app import llm
from app.config import settings
from app.main import app
from app.nixo import assets
from app.nixo.adapter import ExecutionAdapter, MarketSnapshot
from app.nixo.assets import ALLOCATION_CODE, FALLBACK
from app.nixo.audit import AuditLog
from app.nixo.experiment import ExperimentConfig, ExperimentRun
from app.nixo.runner import AgentRunner, _amount
from app.nixo.vault import UNIT, Policy, ProvenanceRegistry, TradeRequest, Vault, VaultError
from app.trading import oneclick

OWNER = "owner.testnet"
D = Decimal
USDC = ALLOCATION_CODE
CHAINS = {a.code: a.chain for a in FALLBACK}


@pytest.fixture
def env():
    audit = AuditLog("run_test")
    reg = ProvenanceRegistry(audit)
    vault = Vault(reg, audit)
    adapter = ExecutionAdapter(MarketSnapshot.synthetic(4, list(FALLBACK)), vault, audit)
    return audit, reg, vault, adapter


def policy(**kw) -> Policy:
    base = dict(policy_id="p", agent_id="agent_b", allowed_actions=frozenset({"swap"}),
                allowed_assets=frozenset({USDC, "NEAR@near", "BTC@btc", "SOL@sol"}), max_trade_amount=D(200),
                max_total_spend=D(1000), allowed_chains=frozenset({"near", "btc", "sol"}), asset_chains=CHAINS)
    base.update(kw)
    return Policy(**base)


_n = 0


def req(asg, amount, *, action="swap", asset_out="NEAR@near", agent="agent_b", rid=None, recipient=None) -> TradeRequest:
    global _n
    _n += 1
    return TradeRequest(rid or f"r{_n}", asg.assignment_id, agent, action, USDC, D(amount), asset_out,
                        recipient=recipient)


def assign(reg, vault, amount=1000, **kw):
    dep = reg.deposit(owner=OWNER, asset=USDC, amount=D(amount), source_reference="demo")
    return vault.assign(caller=OWNER, deposit_id=dep.deposit_id, agent_id="agent_b", amount=D(amount), policy=policy(**kw))


# ---------------------------------------------------------------- §7 hard rules


def test_exact_max_passes_and_one_unit_above_fails(env):
    _, reg, vault, adapter = env
    a = assign(reg, vault)
    d = vault.authorize(req(a, 200))
    assert d.authorized
    assert adapter.execute_ticket(d.ticket.ticket_id, 0).status == "settled"
    assert a.settled_spend == 200 and a.reserved == 0 and a.holdings["NEAR@near"] > 0
    assert vault.authorize(req(a, D(200) + UNIT)).reason_code == "MAX_TRADE_EXCEEDED"


def test_cumulative_cap(env):
    _, reg, vault, _ = env
    a = assign(reg, vault, max_total_spend=D(300))
    assert vault.authorize(req(a, 200)).authorized
    assert vault.authorize(req(a, 200)).reason_code == "TOTAL_SPEND_EXCEEDED"
    assert vault.authorize(req(a, 100)).authorized  # exactly fills the cap


def test_asset_action_withdraw_identity(env):
    _, reg, vault, _ = env
    a = assign(reg, vault)
    assert vault.authorize(req(a, 10, asset_out="ETH@near")).reason_code == "ASSET_NOT_ALLOWED"
    assert vault.authorize(req(a, 10, action="withdraw", asset_out=None)).reason_code == "WITHDRAWAL_NOT_ALLOWED"
    assert vault.authorize(req(a, 10, action="lend")).reason_code == "ACTION_NOT_ALLOWED"
    assert vault.authorize(req(a, 10, agent="agent_a")).reason_code == "AGENT_MISMATCH"
    assert vault.authorize(req(a, "0.0000001")).reason_code == "INVALID_AMOUNT"
    assert vault.authorize(req(a, 0)).reason_code == "INVALID_AMOUNT"


def test_revocation_is_owner_only_and_blocks_new_requests(env):
    audit, reg, vault, _ = env
    a = assign(reg, vault)
    with pytest.raises(VaultError) as e:
        vault.revoke(caller="mallory.testnet", assignment_id=a.assignment_id)
    assert e.value.code == "NOT_OWNER" and a.status == "active"
    vault.revoke(caller=OWNER, assignment_id=a.assignment_id)
    d = vault.authorize(req(a, 10))
    assert d.reason_code == "ASSIGNMENT_REVOKED"
    assert audit.events[-1]["event_type"] == "post_revoke_attempt_rejected"


def test_replay_executes_once(env):
    _, reg, vault, adapter = env
    a = assign(reg, vault)
    r = req(a, 10)
    d = vault.authorize(r)
    adapter.execute_ticket(d.ticket.ticket_id, 0)
    assert vault.authorize(r).reason_code == "REPLAY_DETECTED"
    assert a.settled_spend == 10
    # the adapter won't redeem a ticket twice either
    assert adapter.execute_ticket(d.ticket.ticket_id, 0).reason == "TICKET_USED"
    assert adapter.execute_ticket("tkt_forged", 0).reason == "UNKNOWN_TICKET"


def test_concurrent_requests_reserve_atomically(env):
    _, reg, vault, _ = env
    a = assign(reg, vault, max_total_spend=D(300))
    barrier = Barrier(8)

    def go(_):
        barrier.wait()
        return vault.authorize(req(a, 150))

    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(go, range(8)))
    assert sum(r.authorized for r in results) == 2
    assert a.reserved == 300


def test_provenance_isolation(env):
    _, reg, vault, _ = env
    good = reg.deposit(owner=OWNER, asset=USDC, amount=D(100), source_reference="a")
    bad = reg.deposit(owner=OWNER, asset=USDC, amount=D(100), source_reference="b", verification_status="stub_unverified")
    assert good.deposit_id != bad.deposit_id and bad.verification_status == "stub_unverified"
    with pytest.raises(VaultError) as e:
        vault.assign(caller=OWNER, deposit_id=bad.deposit_id, agent_id="agent_b", amount=D(10), policy=policy())
    assert e.value.code == "DEPOSIT_NOT_ELIGIBLE"
    with pytest.raises(VaultError) as e:
        vault.assign(caller=OWNER, deposit_id=good.deposit_id, agent_id="agent_b", amount=D(101), policy=policy())
    assert e.value.code == "OVER_ALLOCATION"
    with pytest.raises(VaultError):
        vault.assign(caller="mallory.testnet", deposit_id=good.deposit_id, agent_id="agent_b", amount=D(10), policy=policy())


def test_new_assignment_does_not_inherit(env):
    _, reg, vault, _ = env
    dep = reg.deposit(owner=OWNER, asset=USDC, amount=D(1000), source_reference="x")
    old = vault.assign(caller=OWNER, deposit_id=dep.deposit_id, agent_id="agent_b", amount=D(500), policy=policy())
    vault.revoke(caller=OWNER, assignment_id=old.assignment_id)
    new = vault.assign(caller=OWNER, deposit_id=dep.deposit_id, agent_id="agent_b", amount=D(500),
                       policy=policy(max_trade_amount=D(50)))
    assert new.status == "active" and new.assignment_id != old.assignment_id
    assert vault.authorize(req(old, 1)).reason_code == "ASSIGNMENT_REVOKED"
    assert vault.authorize(req(new, 51)).reason_code == "MAX_TRADE_EXCEEDED"
    assert vault.authorize(req(new, 50)).authorized


def test_failed_execution_releases_and_garbage_fails_closed(env):
    _, reg, vault, adapter = env
    a = assign(reg, vault)
    d = vault.authorize(req(a, 20))
    adapter.fault = "fail"
    assert adapter.execute_ticket(d.ticket.ticket_id, 0).status == "failed"
    assert a.reserved == 0 and a.released == 20 and a.settled_spend == 0

    d = vault.authorize(req(a, 20))
    adapter.fault = "garbage"
    assert adapter.execute_ticket(d.ticket.ticket_id, 0).status == "held"
    assert a.held == 20 and a.frozen_reason
    assert vault.authorize(req(a, 1)).reason_code == "FAIL_CLOSED"


# ---------------------------------------------------------------- cross-chain rules


def test_chain_not_allowed(env):
    _, reg, vault, _ = env
    a = assign(reg, vault, allowed_assets=frozenset({USDC, "NEAR@near", "USDC@base"}))
    # USDC@base is even on the token allowlist: the chain rule still stops it
    assert vault.authorize(req(a, 10, asset_out="USDC@base")).reason_code == "CHAIN_NOT_ALLOWED"


def test_unknown_asset_rejected(env):
    _, reg, vault, _ = env
    a = assign(reg, vault, allowed_assets=frozenset({USDC, "NEAR@near", "FAKE@near"}))
    assert vault.authorize(req(a, 10, asset_out="FAKE@near")).reason_code == "ASSET_NOT_ALLOWED"


def test_chain_comes_from_policy_not_request(env):
    _, reg, vault, _ = env
    # A policy whose frozen map says BTC@btc lives on 'btc'; 'btc' is not allowed, so nothing the
    # request says can make it pass.
    a = assign(reg, vault, allowed_chains=frozenset({"near"}))
    assert vault.authorize(req(a, 10, asset_out="BTC@btc")).reason_code == "CHAIN_NOT_ALLOWED"
    # and the policy map is read-only after assignment
    with pytest.raises(TypeError):
        a.policy.asset_chains["BTC@btc"] = "near"  # type: ignore[index]


def test_recipient_must_be_pinned(env):
    _, reg, vault, adapter = env
    a = assign(reg, vault, recipients={"sol": "OwnerSo1anaAddress1111111111111111111111"})
    assert vault.authorize(req(a, 10, asset_out="SOL@sol", recipient="Attacker111111111111111111111111111")) \
        .reason_code == "RECIPIENT_NOT_ALLOWED"
    # no pin for btc: any external recipient is refused
    assert vault.authorize(req(a, 10, asset_out="BTC@btc", recipient="bc1qowner")).reason_code == "RECIPIENT_NOT_ALLOWED"
    # pinned address passes and the output is recorded as delivered, not held
    r = req(a, 10, asset_out="SOL@sol", recipient="OwnerSo1anaAddress1111111111111111111111")
    d = vault.authorize(r)
    assert d.authorized
    assert adapter.execute_ticket(d.ticket.ticket_id, 0).status == "settled"
    assert a.delivered and a.delivered[0]["recipient"] == r.recipient and "SOL@sol" not in a.holdings
    # recipient None keeps output in vault custody
    d = vault.authorize(req(a, 10, asset_out="SOL@sol"))
    adapter.execute_ticket(d.ticket.ticket_id, 0)
    assert a.holdings["SOL@sol"] > 0


def test_config_validation():
    with pytest.raises(ValueError):
        ExperimentConfig(recipients={"sol": "not a solana address!"})
    with pytest.raises(ValueError):
        ExperimentConfig(allocation_usdc=D(100), task_targets=[{"asset": "NEAR@near", "usdc": 200}])
    with pytest.raises(ValueError):
        ExperimentConfig(task_targets=[{"asset": USDC, "usdc": 10}])
    cfg = ExperimentConfig(recipients={"ETH": "0x" + "ab" * 20, "btc": ""})
    assert cfg.recipients == {"eth": "0x" + "ab" * 20}
    assert {"NEAR@near", "ETH@eth", "SOL@sol", USDC} <= set(cfg.allowed_assets)


# ---------------------------------------------------------------- full runs


def _run(**cfg) -> ExperimentRun:
    async def go():
        run = ExperimentRun(OWNER, ExperimentConfig(market="synthetic", llm_provider="rules", **cfg))
        await run.run()
        return run

    return asyncio.run(go())


def test_full_experiment_rules_mode():
    run = _run(steps=8)
    rep = run.report()
    assert rep["status"] == "done", rep["error"]
    assert rep["catalogue_source"] == "fallback"
    # Same 3-asset task completed by both; A did it with over-limit trades, B within its limit.
    ma, mb = rep["agents"]["agent_a"]["metrics"], rep["agents"]["agent_b"]["metrics"]
    assert ma["task_completed"] and mb["task_completed"], (ma["per_asset"], mb["per_asset"])
    assert {leg["asset"] for leg in mb["per_asset"]} == {"NEAR@near", "ETH@eth", "SOL@sol"}
    assert ma["would_violate_executed"] > 0
    assert mb["rejected"] >= 1
    assert all(D(s["outcome"]["amount_in"]) <= 200 for s in rep["agents"]["agent_b"]["steps"])
    # Every adversarial test passes (14 + 3 cross-chain) and B never executed a violation.
    failed = [t for t in rep["adversarial"] if not t["passed"]]
    assert not failed, failed
    assert [t["id"] for t in rep["adversarial"]][-3:] == ["t15", "t16", "t17"]
    assert len(rep["adversarial"]) == 17
    t15 = next(t for t in rep["adversarial"] if t["id"] == "t15")
    assert t15["baseline"]["status"] == "executed"  # A pays the attacker
    assert rep["agents"]["agent_a"]["mirror_wallet"]["delivered"]
    assert rep["revocation"]["passed"] and rep["revocation"]["agent_a"]["status"] == "executed"
    assert all(c["met"] for c in rep["success_criteria"]), rep["success_criteria"]
    row = next(r for r in rep["comparison"] if r["metric"] == "Policy violations executed")
    assert row["agent_b"] == "0" and int(row["agent_a"]) > 0
    # Distinct provenance per deposit
    assert rep["agents"]["agent_a"]["deposit"]["deposit_id"] != rep["agents"]["agent_b"]["deposit"]["deposit_id"]
    # Manual attempt after revoke is rejected for B, executes for A
    b = run.attempt("agent_b", "swap", D(10), "SOL@sol", None)
    a = run.attempt("agent_a", "swap", D(10), "SOL@sol", None)
    assert b["outcome"]["reason"] == "ASSIGNMENT_REVOKED" and a["outcome"]["status"] == "executed"


def test_legacy_payload_still_runs():
    run = _run(steps=4, task_target_usdc=D(400), allowed_assets=["USDC", "NEAR"], allowed_chains=["near"])
    rep = run.report()
    assert rep["status"] == "done", rep["error"]
    assert rep["task_targets"] == [{"asset": "NEAR@near", "usdc": "400"}]
    assert rep["agents"]["agent_b"]["metrics"]["task_completed"]
    assert all(t["passed"] for t in rep["adversarial"]), [t for t in rep["adversarial"] if not t["passed"]]


def test_task_asset_on_disallowed_chain_fails_setup():
    run = _run(steps=2, task_targets=[{"asset": "ETH@eth", "usdc": 100}], allowed_chains=["near"],
               allowed_assets=[USDC])
    assert run.status == "error" and "isn't an allowed chain" in (run.error or "")


# ---------------------------------------------------------------- owner revocation during and after a run

TASK_CRITERIA = {"Both agents received and executed the same permitted task",
                 "Agent B completed the task without violating policy"}


def _poll(client, headers, run_id, cond, timeout=20.0) -> dict:
    end = time.monotonic() + timeout
    while True:
        rep = client.get(f"/nixo/runs/{run_id}", headers=headers).json()
        if cond(rep):
            return rep
        assert time.monotonic() < end, (rep["status"], rep["phase"], rep["step"], rep["error"])
        time.sleep(0.005)


def test_owner_revokes_b_mid_run_through_the_api(monkeypatch):
    """B is rejected from the revoke on, every attack still tests its own rule, and nothing reads as a vault failure."""
    gate, propose = Event(), AgentRunner.propose

    async def slow_step_3(self, ctx):  # step 3 waits, like a slow LLM call, until the owner has pressed revoke
        while ctx.step == 2 and not gate.is_set():
            await asyncio.sleep(0.005)
        return await propose(self, ctx)

    monkeypatch.setattr(AgentRunner, "propose", slow_step_3)
    h = {"X-Near-Account": "midrun-revoke.testnet"}
    with TestClient(app) as client:
        run_id = client.post("/nixo/runs", headers=h, json={"market": "synthetic", "llm_provider": "rules"}).json()["run_id"]
        try:
            _poll(client, h, run_id, lambda r: r["phase"] == "task" and r["step"] == 3)
            assert client.post(f"/nixo/runs/{run_id}/attempt", headers=h, json={"amount_in": "1"}).status_code == 409
            res = client.post(f"/nixo/runs/{run_id}/revoke", headers=h)
            assert res.status_code == 200 and res.json()["status"] == "running"
            revoked_at = res.json()["agents"]["agent_b"]["assignment"]["revoked_at"]
        finally:
            gate.set()
        rep = _poll(client, h, run_id, lambda r: r["status"] in ("done", "error"))
        events = client.get(f"/nixo/runs/{run_id}/audit", headers=h).json()["events"]
    assert rep["status"] == "done", rep["error"]
    live = rep["agents"]["agent_b"]["assignment"]
    assert live["status"] == "revoked" and live["revoked_at"] == revoked_at
    # B: rejected from the revoke on, and nothing of B's settles on its live assignment after it
    steps_b = rep["agents"]["agent_b"]["steps"]
    assert [s["outcome"]["reason"] for s in steps_b[2:]] == ["ASSIGNMENT_REVOKED"] * 6
    assert not [e for e in events if e["event_type"] == "trade_settled" and e["assignment_id"] == live["assignment_id"]
                and e["timestamp"] > revoked_at]
    assert [e["phase"] for e in events
            if e["event_type"] == "agent_revoked" and e["assignment_id"] == live["assignment_id"]] == ["manual"]
    # every attack still gets the reason code of the rule it targets, on an equivalent live assignment
    assert rep["adversarial_passed"] == rep["adversarial_total"] == 17, [t for t in rep["adversarial"] if not t["passed"]]
    tests = {t["id"]: t for t in rep["adversarial"]}
    for tid, code in {"t02": "MAX_TRADE_EXCEEDED", "t04": "ASSET_NOT_ALLOWED", "t05": "WITHDRAWAL_NOT_ALLOWED",
                      "t13": "AGENT_MISMATCH", "t15": "RECIPIENT_NOT_ALLOWED", "t16": "CHAIN_NOT_ALLOWED"}.items():
        assert tests[tid]["reason_code"] == code
        assert tests[tid]["requests"][0]["assignment_id"] != live["assignment_id"]
    # the revocation check ran on the owner's revocation, keeping its time
    rev = rep["revocation"]
    assert rev["passed"] and rev["agent_b"]["reason"] == "ASSIGNMENT_REVOKED" and rev["revoked_at"] == revoked_at
    assert rev["trigger"] == "owner_console" and rev["revoked_during"] == {"phase": "task", "step": 3}
    # criteria: none unmet; B's unfinished task is explained, not counted as a failure
    crit = {c["criterion"]: c for c in rep["success_criteria"]}
    assert [c for c in crit.values() if c["met"] is not True] == [crit["Agent B completed the task without violating policy"]]
    assert crit["Agent B completed the task without violating policy"]["met"] is None
    assert "owner revoked Agent B" in crit["Agent B completed the task without violating policy"]["note"]
    rows = {r["metric"]: r for r in rep["comparison"]}
    assert rows["Task completed"]["agent_b"].endswith("owner revoked B (requests rejected from step 3)")
    assert rows["Revocation response"]["agent_b"] == "rejected: ASSIGNMENT_REVOKED"
    assert rows["Policy violations executed"]["agent_b"] == "0"


def test_revoke_before_b_trades_is_not_reported_as_a_vault_failure(monkeypatch):
    holder: dict[str, ExperimentRun] = {}
    propose = AgentRunner.propose

    async def revoke_on_first_step(self, ctx):  # the owner revokes while the first proposals are in flight
        if self.agent_id == "agent_b" and ctx.step == 0:
            holder["run"].revoke_b(OWNER)
        return await propose(self, ctx)

    monkeypatch.setattr(AgentRunner, "propose", revoke_on_first_step)

    async def go() -> ExperimentRun:
        holder["run"] = ExperimentRun(OWNER, ExperimentConfig(market="synthetic", llm_provider="rules",
                                                              run_adversarial=False, revoke_at_end=False))
        await holder["run"].run()
        return holder["run"]

    rep = asyncio.run(go()).report()
    assert rep["status"] == "done", rep["error"]
    assert {s["outcome"]["reason"] for s in rep["agents"]["agent_b"]["steps"]} == {"ASSIGNMENT_REVOKED"}
    crit = {c["criterion"]: c for c in rep["success_criteria"]}
    assert not [c for c in crit.values() if c["met"] is False], crit
    for name in (*TASK_CRITERIA, "Audit trail distinguishes proposed, rejected, authorized, submitted and settled"):
        assert crit[name]["met"] is None and "from step 1 of 8" in crit[name]["note"], crit[name]
    assert crit["A revoked agent cannot execute another transaction"]["met"] is True
    assert rep["revocation"]["revoked_during"] == {"phase": "task", "step": 1}


def test_owner_revoke_after_the_run_is_reported():
    run = _run(revoke_at_end=False)
    rep = run.report()
    assert rep["revocation"] is None
    assert next(r for r in rep["comparison"] if r["metric"] == "Revocation response")["agent_b"] == "not revoked"
    run.revoke_b(OWNER)  # what POST /nixo/runs/{id}/revoke does
    rep = run.report()
    live, rev = rep["agents"]["agent_b"]["assignment"], rep["revocation"]
    assert live["status"] == "revoked" and rev["assignment_id"] == live["assignment_id"]
    assert rev["revoked_at"] == live["revoked_at"] and rev["trigger"] == "owner_console"
    assert rev["revoked_during"] == {"phase": "done", "step": 8}
    assert rev["passed"] and rev["agent_b"]["reason"] == "ASSIGNMENT_REVOKED" and rev["agent_a"]["status"] == "executed"
    row = next(r for r in rep["comparison"] if r["metric"] == "Revocation response")
    assert row["agent_b"] == "rejected: ASSIGNMENT_REVOKED" and row["agent_a"].endswith("identical request executed")
    assert all(c["met"] for c in rep["success_criteria"]), rep["success_criteria"]
    # a second revoke is a no-op, and the owner's own requests are rejected too
    run.revoke_b(OWNER)
    assert run.report()["revocation"] == rev
    assert run.attempt("agent_b", "swap", D(10), None, None)["outcome"]["reason"] == "ASSIGNMENT_REVOKED"


# ---------------------------------------------------------------- catalogue, amounts and attack sizing

LIVE_TOKENS = [{"assetId": a.asset_id, "decimals": a.decimals, "blockchain": a.chain, "symbol": a.symbol,
                "price": a.price} for a in FALLBACK] + [
    {"assetId": "nep141:arb.omft.near", "decimals": 18, "blockchain": "arb", "symbol": "ETH", "price": 1850.0}]


def test_synthetic_market_accepts_codes_from_the_live_catalogue(monkeypatch):
    calls = []

    async def tokens():
        calls.append(1)
        return LIVE_TOKENS

    monkeypatch.setattr(oneclick, "tokens", tokens)
    assets.clear_cache()
    try:
        assert _run(steps=1).report()["catalogue_source"] == "fallback" and not calls  # offline unless needed
        run = _run(task_targets=[{"asset": "NEAR@near", "usdc": 300}, {"asset": "ETH@arb", "usdc": 100}],
                   allowed_assets=[USDC, "NEAR@near"], allowed_chains=["near", "arb"])
    finally:
        assets.clear_cache()
    rep = run.report()
    assert rep["status"] == "done", rep["error"]
    assert calls and rep["catalogue_source"] == "1click" and rep["market"]["source"] == "synthetic"
    assert rep["agents"]["agent_b"]["metrics"]["task_completed"]
    assert rep["adversarial_passed"] == rep["adversarial_total"] == 17
    assert all(c["met"] for c in rep["success_criteria"]), rep["success_criteria"]


def test_unknown_code_with_1click_down_fails_setup_cleanly(monkeypatch):
    async def down():
        raise oneclick.OneClickError("1Click unreachable: test")

    monkeypatch.setattr(oneclick, "tokens", down)
    assets.clear_cache()
    try:
        run = _run(task_targets=[{"asset": "ETH@arb", "usdc": 100}], allowed_chains=["near", "arb"])
    finally:
        assets.clear_cache()
    assert run.status == "error" and run.phase == "setup"
    assert "ETH@arb" in run.error and "unreachable" in run.error and "NEAR@near" in run.error, run.error


def test_oversized_amounts_are_rejected_cleanly(env):
    _, reg, vault, _ = env
    a = assign(reg, vault)
    for amount in (D("1e22"), D(10) ** 30):
        assert vault.authorize(req(a, amount)).reason_code == "MAX_TRADE_EXCEEDED"
    assert _amount(1e22) is None and _amount("1e400") is None and _amount(5e21) == D("5e21")
    for field in ("max_trade_amount", "max_total_spend"):
        with pytest.raises(ValueError):
            ExperimentConfig(**{field: D("1e23")})


def test_absurd_llm_amount_is_an_invalid_proposal(monkeypatch):
    async def ping(provider, model=None):
        return {"provider": provider, "model": "stub-model", "ok": True, "latency_ms": 1}

    async def structured(prompt, schema, **kw):  # step 1: unrepresentable amount, step 2: huge but representable
        amount = 1e22 if "Step 1 of" in prompt else 5e21
        data = llm.validate({"action": "swap", "asset_in": "USDC", "amount_in": amount, "asset_out": "NEAR@near",
                             "rationale": "all in"}, schema)
        return llm.LLMResult(data=data, provider=kw["preferred"], model=kw["model"], latency_ms=1)

    monkeypatch.setattr(llm, "ping", ping)
    monkeypatch.setattr(llm, "structured", structured)
    run = ExperimentRun(OWNER, ExperimentConfig(market="synthetic", llm_provider="openai", steps=2))
    asyncio.run(run.run())
    assert run.status == "done", run.error
    for agent in ("agent_a", "agent_b"):
        held = run.steps_log[agent][0]["proposal"]
        assert held["action"] == "hold" and held["note"] == "invalid amount 1e+22 treated as hold"
    assert run.steps_log["agent_b"][1]["outcome"]["reason"] == "MAX_TRADE_EXCEEDED"
    assert run.steps_log["agent_a"][1]["outcome"]["reason"] == "INSUFFICIENT_BALANCE"
    assert len(run.adversarial) == 17


@pytest.mark.parametrize("cfg", [
    dict(max_trade_amount=D(10)), dict(max_trade_amount=D("19.99")), dict(max_trade_amount=D(1)),
    dict(max_trade_amount=D("0.5")), dict(max_trade_amount=UNIT), dict(max_trade_amount=D(1000)),
    dict(max_total_spend=D(15)),
    dict(allocation_usdc=D(15), max_trade_amount=D(15), max_total_spend=D(15),
         task_targets=[{"asset": "NEAR@near", "usdc": 10}]),
    dict(allocation_usdc=UNIT, task_targets=[{"asset": "NEAR@near", "usdc": UNIT}]),
], ids=["trade10", "trade19.99", "trade1", "trade0.5", "trade1unit", "trade=alloc", "total15", "alloc15", "alloc1unit"])
def test_attack_probes_fit_any_valid_policy(cfg):
    run = _run(steps=4, revoke_at_end=False, **cfg)
    rep = run.report()
    assert rep["status"] == "done", rep["error"]
    assert [t for t in rep["adversarial"] if not t["passed"]] == [] and rep["adversarial_total"] == 17
    assert all(c["met"] for c in rep["success_criteria"] if c["criterion"] not in TASK_CRITERIA), rep["success_criteria"]
    assert run.adapter.fault is None  # no test fault left armed


def test_no_test_fault_leaks_into_the_owner_console():
    run = _run(steps=4, max_trade_amount=D("0.5"), revoke_at_end=False)
    e = run.attempt("agent_b", "swap", D("0.4"), None, None)
    assert e["outcome"]["status"] == "executed" and run.vault.assignments[run.asg_b].frozen_reason is None


# ---------------------------------------------------------------- LLM provider resolution (HTTP mocked)


@pytest.fixture
def mock_providers(monkeypatch):
    """OpenAI and DeepSeek with fake keys behind httpx.MockTransport; every other provider off. No real calls."""
    monkeypatch.setattr(settings, "anthropic_api_key", None)
    monkeypatch.setattr(llm, "_anthropic_configured", lambda: False)
    for name, key in (("openai", "sk-test"), ("deepseek", "ds-test"), ("nvidia", None), ("nearai", None)):
        monkeypatch.setattr(settings, f"{name}_api_key", key)
    monkeypatch.setattr(settings, "llm_provider_order", "anthropic,openai,deepseek,nvidia,nearai")
    llm.reset_cooldowns()
    llm._http_clients.clear()
    calls: list[tuple[str, str]] = []

    def install(failing: set[str]):
        def handler(provider: str, request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content)
            calls.append((provider, body["model"]))
            if provider in failing:
                return httpx.Response(401, json={"error": {"message": "invalid api key"}})
            content = ('{"ok": true, "answer": 4}' if "Health check" in body["messages"][-1]["content"] else
                       '{"action": "swap", "asset_in": "USDC", "amount_in": 50, "asset_out": "NEAR@near", '
                       '"rationale": "steady buys"}')
            return httpx.Response(200, json={"choices": [{"message": {"content": content}, "finish_reason": "stop"}]})

        for name in ("openai", "deepseek"):
            llm._http_clients[name] = httpx.AsyncClient(
                base_url=f"https://{name}.test", transport=httpx.MockTransport(lambda r, n=name: handler(n, r)))

    yield install, calls
    llm._http_clients.clear()
    llm.reset_cooldowns()


def _llm_run(**cfg) -> ExperimentRun:
    run = ExperimentRun(OWNER, ExperimentConfig(market="synthetic", steps=2, run_adversarial=False, **cfg))
    asyncio.run(run.run())
    assert run.status == "done", run.error
    return run


def test_named_provider_falls_back_and_both_agents_share_it(mock_providers):
    install, calls = mock_providers
    install(failing={"openai"})
    run = _llm_run(llm_provider="openai", llm_model="gpt-test")
    model = settings.deepseek_model
    assert (run.llm_info["provider"], run.llm_info["model"]) == ("deepseek", model)
    assert run.llm_info["note"] == f"OpenAI failed (HTTP 401: invalid api key); both agents use DeepSeek ({model})."
    # one provider and model for both agents on every step; the model override only went to OpenAI
    assert {s["proposal"]["source"] for a in ("agent_a", "agent_b") for s in run.steps_log[a]} == {f"deepseek:{model}"}
    assert {m for p, m in calls if p == "openai"} == {"gpt-test"} and {m for p, m in calls if p == "deepseek"} == {model}


def test_named_provider_keeps_its_model_and_rules_calls_nothing(mock_providers):
    install, calls = mock_providers
    install(failing=set())
    run = _llm_run(llm_provider="deepseek", llm_model="deepseek-test")
    assert run.llm_info == {"provider": "deepseek", "model": "deepseek-test", "label": "DeepSeek", "note": None}
    assert set(calls) == {("deepseek", "deepseek-test")}
    calls.clear()
    assert _llm_run(llm_provider="rules").llm_info["provider"] == "rules" and not calls


def test_rules_when_every_provider_fails(mock_providers):
    install, _ = mock_providers
    install(failing={"openai", "deepseek"})
    run = _llm_run(llm_provider="deepseek")
    assert run.llm_info["provider"] == "rules"
    assert run.llm_info["note"] == ("DeepSeek failed (HTTP 401: invalid api key); OpenAI failed (HTTP 401: invalid "
                                    "api key). Both agents use the deterministic rules agent.")
    assert {s["proposal"]["source"] for s in run.steps_log["agent_b"]} == {"rules"}

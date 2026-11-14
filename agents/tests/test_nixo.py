"""NIXO v0.1 vault rules (Nixo_agents.md §7), cross-chain rules, and full rules-mode experiment runs."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier

import pytest

from app.nixo.adapter import ExecutionAdapter, MarketSnapshot
from app.nixo.assets import ALLOCATION_CODE, FALLBACK
from app.nixo.audit import AuditLog
from app.nixo.experiment import ExperimentConfig, ExperimentRun
from app.nixo.vault import UNIT, Policy, ProvenanceRegistry, TradeRequest, Vault, VaultError

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

"""NIXO v0.1 two-agent experiment API (Nixo_agents.md).

The caller's NEAR account (X-Near-Account) is the owner of the experiment's
deposits and the only account that can revoke its assignments.

Also exposes on-chain vault status helpers and the delayed viewing-key path.
"""

from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.config import settings
from app.nixo import assets, onchain, viewing_keys
from app.nixo.experiment import CODE_PATTERN, LABELS, ExperimentConfig, store
from app.nixo.vault import VaultError
from app.nixo.viewing_keys import KeyType
from app.routers.trading import account_id

router = APIRouter(prefix="/nixo", tags=["nixo"])


class AttemptBody(BaseModel):
    agent: Literal["agent_a", "agent_b"] = "agent_b"
    action: Literal["swap", "withdraw"] = "swap"
    amount_in: Decimal = Field(gt=0, le=1_000_000, decimal_places=6)
    asset_out: str | None = Field(None, pattern=CODE_PATTERN, description="SYMBOL@chain; default: first task asset")
    destination: str | None = Field(None, max_length=64)
    recipient: str | None = Field(None, max_length=128, description="Where swap output goes; empty = vault custody")


def _run(owner: str, run_id: str):
    run = store.get(owner, run_id)
    if run is None:
        raise HTTPException(404, "No such experiment run for this account")
    return run


def _vault_err(err: VaultError) -> HTTPException:
    code = {"NOT_OWNER": 403, "RUN_IN_PROGRESS": 409, "NOT_READY": 409}.get(err.code, 400)
    return HTTPException(code, f"{err.code}: {err}")


@router.get("/assets")
async def list_assets() -> dict:
    """Tokens NEAR Intents (1Click) can route, grouped by chain, as SYMBOL@chain codes."""
    return (await assets.catalogue()).to_dict()


@router.get("/defaults")
def defaults() -> dict:
    labels = {**LABELS, **onchain.enforcement_label()}
    return {
        "config": ExperimentConfig().model_dump(mode="json"),
        "labels": labels,
        "vault_contract": settings.nixo_vault_contract,
        "nixo_contract": settings.nixo_contract,
    }


@router.get("/onchain")
async def onchain_status() -> dict:
    return await onchain.status()


@router.get("/onchain/deposits/{owner}")
async def onchain_deposits(owner: str) -> dict:
    if not settings.nixo_vault_contract:
        raise HTTPException(503, "NIXO_VAULT_CONTRACT is not set")
    rows = await onchain.view("list_deposits_by_owner", {"owner": owner})
    return {"owner": owner, "deposits": rows}


@router.get("/onchain/deposit/{deposit_id}")
async def onchain_deposit(deposit_id: int) -> dict:
    if not settings.nixo_vault_contract:
        raise HTTPException(503, "NIXO_VAULT_CONTRACT is not set")
    row = await onchain.view("get_deposit", {"deposit_id": str(deposit_id)})
    return {"deposit": row}


@router.get("/onchain/assignment/{assignment_id}")
async def onchain_assignment(assignment_id: int) -> dict:
    if not settings.nixo_vault_contract:
        raise HTTPException(503, "NIXO_VAULT_CONTRACT is not set")
    row = await onchain.view("get_assignment", {"assignment_id": str(assignment_id)})
    return {"assignment": row}


class ExecuteArgsBody(BaseModel):
    assignment_id: int
    amount_near: str = Field(min_length=1, max_length=64)
    target: str = Field(min_length=2, max_length=64)
    dry_run: bool = True


@router.post("/onchain/execute-args")
def onchain_execute_args(body: ExecuteArgsBody) -> dict:
    """Build `execute` args for wallet / FC-key signing (service does not sign)."""
    if not settings.nixo_vault_contract:
        raise HTTPException(503, "NIXO_VAULT_CONTRACT is not set")
    return {
        "contract": settings.nixo_vault_contract,
        "method": "execute",
        "args": onchain.execute_args(
            assignment_id=body.assignment_id,
            amount_near=body.amount_near,
            target=body.target,
            dry_run=body.dry_run,
        ),
        "deposit": "0",
        "gas": str(50 * 10**12),
    }


class ViewingOfferBody(BaseModel):
    run_id: str = Field(min_length=3, max_length=64)
    delay_seconds: float | None = Field(None, ge=0, le=86400)
    key_type: Literal["delayed", "live", "time_limited", "auditor"] = "delayed"


class ViewingRedeemBody(BaseModel):
    key_id: str = Field(min_length=3, max_length=64)
    buyer_x25519_pub_b64: str = Field(min_length=40, max_length=128)


class ViewingAppendBody(BaseModel):
    run_id: str
    payload: dict
    deposit_id: str | None = None
    assignment_id: str | None = None


@router.post("/viewing/append")
def viewing_append(body: ViewingAppendBody, x_near_account: str | None = Header(None)) -> dict:
    owner = account_id(x_near_account)
    entry = viewing_keys.store.append_trade(
        run_id=body.run_id,
        owner=owner,
        payload=body.payload,
        deposit_id=body.deposit_id,
        assignment_id=body.assignment_id,
    )
    return {"entry": entry.to_dict()}


@router.post("/viewing/offer")
def viewing_offer(body: ViewingOfferBody, x_near_account: str | None = Header(None)) -> dict:
    owner = account_id(x_near_account)
    if body.key_type != "delayed":
        offer = viewing_keys.store.stub_offer(run_id=body.run_id, owner=owner, key_type=KeyType(body.key_type))
    else:
        delay = body.delay_seconds if body.delay_seconds is not None else settings.viewing_key_delay_seconds
        offer = viewing_keys.store.create_delayed_offer(run_id=body.run_id, owner=owner, delay_seconds=delay)
    return {"offer": offer.to_dict()}


@router.post("/viewing/redeem")
def viewing_redeem(body: ViewingRedeemBody, x_near_account: str | None = Header(None)) -> dict:
    buyer = account_id(x_near_account)
    try:
        return viewing_keys.store.redeem(
            key_id=body.key_id, buyer=buyer, buyer_x25519_pub_b64=body.buyer_x25519_pub_b64
        )
    except PermissionError as err:
        raise HTTPException(403, str(err)) from err
    except KeyError as err:
        raise HTTPException(404, str(err)) from err


@router.get("/viewing/runs/{run_id}")
def viewing_run(run_id: str) -> dict:
    return {
        "run_id": run_id,
        "offers": viewing_keys.store.list_offers(run_id),
        "entries": viewing_keys.store.list_entries(run_id),
    }


@router.post("/viewing/keypair")
def viewing_keypair() -> dict:
    return viewing_keys.generate_buyer_keypair()


@router.post("/runs")
async def start_run(cfg: ExperimentConfig, x_near_account: str | None = Header(None)) -> dict:
    owner = account_id(x_near_account)
    try:
        run = store.start(owner, cfg)
    except VaultError as err:
        raise _vault_err(err) from err
    return run.report()


@router.get("/runs")
def list_runs(x_near_account: str | None = Header(None)) -> dict:
    return {"runs": store.list(account_id(x_near_account))}


@router.get("/runs/{run_id}")
def get_run(run_id: str, x_near_account: str | None = Header(None)) -> dict:
    return _run(account_id(x_near_account), run_id).report()


@router.get("/runs/{run_id}/audit")
def get_audit(run_id: str, x_near_account: str | None = Header(None)) -> dict:
    run = _run(account_id(x_near_account), run_id)
    return {"run_id": run.run_id, "labels": LABELS, "events": run.audit.events}


# The owner actions are async so they run on the event loop with the experiment: a revoke during a run lands
# between its steps, and never between a vault authorization and the execution of that ticket.
@router.post("/runs/{run_id}/revoke")
async def revoke(run_id: str, x_near_account: str | None = Header(None)) -> dict:
    owner = account_id(x_near_account)
    run = _run(owner, run_id)
    try:
        run.revoke_b(owner)
    except VaultError as err:
        raise _vault_err(err) from err
    return run.report()


@router.post("/runs/{run_id}/attempt")
async def attempt(run_id: str, body: AttemptBody, x_near_account: str | None = Header(None)) -> dict:
    run = _run(account_id(x_near_account), run_id)
    if run.status in ("pending", "running"):
        raise HTTPException(409, "Wait for the run to finish before sending manual requests")
    try:
        entry = run.attempt(body.agent, body.action, body.amount_in, body.asset_out, body.destination,
                            (body.recipient or "").strip() or None)
    except VaultError as err:
        raise _vault_err(err) from err
    return {"attempt": entry, "report": run.report()}

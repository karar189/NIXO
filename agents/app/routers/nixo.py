"""NIXO v0.1 two-agent experiment API (Nixo_agents.md).

The caller's NEAR account (X-Near-Account) is the owner of the experiment's
deposits and the only account that can revoke its assignments.
"""

from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.nixo import assets
from app.nixo.experiment import CODE_PATTERN, LABELS, ExperimentConfig, store
from app.nixo.vault import VaultError
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
    return {"config": ExperimentConfig().model_dump(mode="json"), "labels": LABELS}


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

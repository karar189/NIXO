"""On-chain vault helpers: view calls + execute argument builders.

The agents service does not hold hot keys by default. Wallet / FC-key signing
happens in the web app or via `scripts/vault-fc-key.sh`. This module builds the
method args and reads vault state when `NIXO_VAULT_CONTRACT` is set.
"""

from __future__ import annotations

import base64
import json
from typing import Any

import httpx

from app.config import settings

YOCTO = 10**24


def enforcement_label() -> dict[str, str]:
    if settings.nixo_vault_contract:
        return {
            "execution": "On-chain mode available: agent calls nixo-vault.execute (dry_run default). "
                         "Off-chain experiment still runs for the adversarial suite.",
            "provenance": "On-chain provenance rows require a Clean certificate via nixo.is_clean at deposit.",
            "enforcement": f"Contract-level: {settings.nixo_vault_contract} enforces caps, allowlist, revoke.",
        }
    return {
        "execution": "Simulated: paper fills; no funds move.",
        "provenance": "Stub: verification_status comes from a demo stub, not real source-of-funds checks.",
        "enforcement": "Service-level: the vault runs inside the agents service (off-chain).",
    }


async def view(method: str, args: dict | None = None, *, contract: str | None = None) -> Any:
    account = contract or settings.nixo_vault_contract
    if not account:
        raise RuntimeError("NIXO_VAULT_CONTRACT is not set")
    payload = {
        "jsonrpc": "2.0",
        "id": "nixo-vault",
        "method": "query",
        "params": {
            "request_type": "call_function",
            "finality": "final",
            "account_id": account,
            "method_name": method,
            "args_base64": base64.b64encode(json.dumps(args or {}).encode()).decode(),
        },
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.post(settings.near_rpc, json=payload)
        res.raise_for_status()
        body = res.json()
    if body.get("error") or body.get("result", {}).get("error"):
        raise RuntimeError(json.dumps(body.get("error") or body["result"]["error"]))
    raw = bytes(body["result"]["result"])
    return json.loads(raw.decode()) if raw else None


def near_to_yocto(amount_near: str | float) -> str:
    # Support up to 24 decimal places as a decimal string.
    s = str(amount_near)
    if "." not in s:
        return str(int(s) * YOCTO)
    whole, frac = s.split(".", 1)
    frac = (frac + "0" * 24)[:24]
    return str(int(whole or "0") * YOCTO + int(frac or "0"))


def execute_args(*, assignment_id: int, amount_near: str, target: str, dry_run: bool = True) -> dict:
    return {
        "assignment_id": str(assignment_id),
        "amount": near_to_yocto(amount_near),
        "target": target,
        "dry_run": dry_run,
    }


def assign_args(
    *,
    deposit_id: int,
    agent_id: str,
    max_per_tx_near: str,
    max_per_window_near: str,
    window_ns: int,
    expires_at_ns: int,
    allowlist: list[str],
) -> dict:
    return {
        "deposit_id": str(deposit_id),
        "agent_id": agent_id,
        "max_per_tx": near_to_yocto(max_per_tx_near),
        "max_per_window": near_to_yocto(max_per_window_near),
        "window_ns": str(window_ns),
        "expires_at_ns": str(expires_at_ns),
        "allowlist": allowlist,
    }


async def status() -> dict:
    if not settings.nixo_vault_contract:
        return {
            "mode": "off-chain",
            "vault_contract": None,
            "nixo_contract": settings.nixo_contract,
            "labels": enforcement_label(),
        }
    try:
        cfg = await view("get_config")
        return {
            "mode": "on-chain",
            "vault_contract": settings.nixo_vault_contract,
            "nixo_contract": settings.nixo_contract,
            "config": cfg,
            "labels": enforcement_label(),
        }
    except Exception as err:  # noqa: BLE001 — surface RPC issues to the desk
        return {
            "mode": "on-chain-unreachable",
            "vault_contract": settings.nixo_vault_contract,
            "nixo_contract": settings.nixo_contract,
            "error": str(err),
            "labels": enforcement_label(),
        }

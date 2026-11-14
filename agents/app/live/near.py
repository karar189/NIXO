"""Minimal NEAR transaction signing for the live agent account.

Only what the agent needs: ed25519 keys, borsh-encoded FunctionCall
transactions, and JSON-RPC (view calls, access-key nonce, block hash, send_tx).
The encoding is cross-checked byte for byte against near-api-js in
tests/test_live.py (vectors) so a mistake can't silently sign something else.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import struct
from dataclasses import dataclass
from typing import Any

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
TGAS = 10**12


# ---------------------------------------------------------------- base58


def b58encode(data: bytes) -> str:
    n = int.from_bytes(data, "big")
    out = ""
    while n:
        n, r = divmod(n, 58)
        out = B58[r] + out
    pad = len(data) - len(data.lstrip(b"\0"))
    return "1" * pad + out


def b58decode(s: str) -> bytes:
    n = 0
    for c in s:
        n = n * 58 + B58.index(c)
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b""
    pad = len(s) - len(s.lstrip("1"))
    return b"\0" * pad + raw


# ---------------------------------------------------------------- borsh


def u8(v: int) -> bytes:
    return struct.pack("<B", v)


def u32(v: int) -> bytes:
    return struct.pack("<I", v)


def u64(v: int) -> bytes:
    return struct.pack("<Q", v)


def u128(v: int) -> bytes:
    return v.to_bytes(16, "little")


def bstr(s: str) -> bytes:
    raw = s.encode()
    return u32(len(raw)) + raw


def bbytes(b: bytes) -> bytes:
    return u32(len(b)) + b


# ---------------------------------------------------------------- keys


@dataclass(frozen=True)
class KeyPair:
    private: Ed25519PrivateKey

    @classmethod
    def from_string(cls, secret: str) -> "KeyPair":
        """`ed25519:<base58>` as written by near-cli / wallets (64-byte seed+pub, or 32-byte seed)."""
        if not secret.startswith("ed25519:"):
            raise ValueError("only ed25519 keys are supported")
        raw = b58decode(secret.split(":", 1)[1])
        if len(raw) not in (32, 64):
            raise ValueError("ed25519 secret key must be 32 or 64 bytes")
        kp = cls(Ed25519PrivateKey.from_private_bytes(raw[:32]))
        if len(raw) == 64 and raw[32:] != kp.public_bytes:
            raise ValueError("secret key does not match its embedded public key")
        return kp

    @property
    def public_bytes(self) -> bytes:
        return self.private.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)

    @property
    def public_key(self) -> str:
        return "ed25519:" + b58encode(self.public_bytes)

    def sign(self, msg: bytes) -> bytes:
        return self.private.sign(msg)

    def __repr__(self) -> str:  # never print the secret
        return f"KeyPair({self.public_key})"


def verify_ed25519(public_key: str, signature: bytes, message: bytes) -> bool:
    if not public_key.startswith("ed25519:"):
        return False
    try:
        Ed25519PublicKey.from_public_bytes(b58decode(public_key.split(":", 1)[1])).verify(signature, message)
        return True
    except Exception:
        return False


# ---------------------------------------------------------------- transactions


@dataclass(frozen=True)
class FunctionCall:
    method_name: str
    args: dict
    gas: int = 30 * TGAS
    deposit: int = 0  # yoctoNEAR

    def encode(self) -> bytes:
        args = json.dumps(self.args, separators=(",", ":")).encode()
        return u8(2) + bstr(self.method_name) + bbytes(args) + u64(self.gas) + u128(self.deposit)


def encode_transaction(*, signer_id: str, public_key: bytes, nonce: int, receiver_id: str,
                       block_hash: bytes, actions: list[FunctionCall]) -> bytes:
    if len(public_key) != 32 or len(block_hash) != 32:
        raise ValueError("bad key or block hash length")
    out = bstr(signer_id) + u8(0) + public_key + u64(nonce) + bstr(receiver_id) + block_hash
    out += u32(len(actions)) + b"".join(a.encode() for a in actions)
    return out


def sign_transaction(kp: KeyPair, tx: bytes) -> tuple[bytes, str]:
    """Returns (borsh SignedTransaction, base58 tx hash)."""
    digest = hashlib.sha256(tx).digest()
    return tx + u8(0) + kp.sign(digest), b58encode(digest)


# ---------------------------------------------------------------- RPC


class RpcError(RuntimeError):
    pass


class NearRpc:
    def __init__(self, url: str, timeout: float = 30.0):
        self.url = url
        self.timeout = timeout

    async def call(self, method: str, params: Any) -> Any:
        payload = {"jsonrpc": "2.0", "id": "nixo-live", "method": method, "params": params}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                res = await client.post(self.url, json=payload)
        except httpx.HTTPError as err:
            raise RpcError(f"NEAR RPC unreachable: {err}") from err
        try:
            body = res.json()
        except ValueError as err:
            raise RpcError(f"NEAR RPC returned non-JSON ({res.status_code})") from err
        if body.get("error"):
            raise RpcError(json.dumps(body["error"])[:500])
        result = body.get("result")
        if isinstance(result, dict) and result.get("error"):
            raise RpcError(str(result["error"])[:500])
        return result

    async def view(self, contract: str, method: str, args: dict | None = None) -> Any:
        r = await self.call("query", {
            "request_type": "call_function", "finality": "final", "account_id": contract, "method_name": method,
            "args_base64": base64.b64encode(json.dumps(args or {}).encode()).decode(),
        })
        raw = bytes(r["result"])
        return json.loads(raw) if raw else None

    async def account(self, account_id: str) -> dict:
        return await self.call("query", {"request_type": "view_account", "finality": "final", "account_id": account_id})

    async def access_key(self, account_id: str, public_key: str) -> dict:
        return await self.call("query", {"request_type": "view_access_key", "finality": "final",
                                         "account_id": account_id, "public_key": public_key})

    async def block_hash(self) -> bytes:
        r = await self.call("block", {"finality": "final"})
        return b58decode(r["header"]["hash"])

    async def send_tx(self, signed: bytes) -> dict:
        return await self.call("send_tx", {"signed_tx_base64": base64.b64encode(signed).decode(),
                                           "wait_until": "EXECUTED_OPTIMISTIC"})


def outcome_failure(result: dict) -> str | None:
    """First failure in a send_tx result (transaction or any receipt), else None."""
    status = result.get("status", {})
    if isinstance(status, dict) and "Failure" in status:
        return json.dumps(status["Failure"])[:400]
    for r in result.get("receipts_outcome", []):
        st = r.get("outcome", {}).get("status", {})
        if isinstance(st, dict) and "Failure" in st:
            return json.dumps(st["Failure"])[:400]
    return None


class Signer:
    """Signs and sends transactions for one account, serialising nonces."""

    def __init__(self, account_id: str, keypair: KeyPair, rpc: NearRpc):
        self.account_id = account_id
        self.keypair = keypair
        self.rpc = rpc
        self._lock = asyncio.Lock()
        self._nonce: int | None = None

    async def check_full_access(self) -> None:
        key = await self.rpc.access_key(self.account_id, self.keypair.public_key)
        if key.get("permission") != "FullAccess":
            raise RpcError("NIXO_AGENT_PRIVATE_KEY is not a full-access key of NIXO_AGENT_ACCOUNT "
                           "(ft_transfer needs 1 yoctoNEAR attached, which function-call keys can't do)")

    async def send(self, receiver_id: str, actions: list[FunctionCall]) -> tuple[str, dict]:
        async with self._lock:
            key = await self.rpc.access_key(self.account_id, self.keypair.public_key)
            nonce = max(int(key["nonce"]), self._nonce or 0) + 1
            tx = encode_transaction(signer_id=self.account_id, public_key=self.keypair.public_bytes, nonce=nonce,
                                    receiver_id=receiver_id, block_hash=await self.rpc.block_hash(), actions=actions)
            signed, tx_hash = sign_transaction(self.keypair, tx)
            self._nonce = nonce
            result = await self.rpc.send_tx(signed)
            return tx_hash, result

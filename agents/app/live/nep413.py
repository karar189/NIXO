"""NEP-413 signed messages: prove a wallet owner approved an action.

Starting the live agent spends real money, so the X-Near-Account header isn't
enough. The owner's wallet signs a message that names the exact session
(market + size), bound to a single-use server nonce. We verify the ed25519
signature over the NEP-413 payload and that the signing key is a full-access
key of the owner account on mainnet.
"""

from __future__ import annotations

import base64
import hashlib
import os
import time

from app.live.near import NearRpc, bstr, u8, u32, verify_ed25519

NEP413_TAG = 2**31 + 413
RECIPIENT = "nixo-agents"
CHALLENGE_TTL = 300.0


def payload_hash(message: str, nonce: bytes, recipient: str, callback_url: str | None = None) -> bytes:
    if len(nonce) != 32:
        raise ValueError("nonce must be 32 bytes")
    body = bstr(message) + nonce + bstr(recipient)
    body += u8(1) + bstr(callback_url) if callback_url is not None else u8(0)
    return hashlib.sha256(u32(NEP413_TAG) + body).digest()


class AuthError(PermissionError):
    pass


class Challenges:
    """Single-use nonces with a short lifetime."""

    def __init__(self, clock=time.time):
        self.clock = clock
        self._open: dict[str, float] = {}

    def issue(self) -> str:
        now = self.clock()
        self._open = {n: t for n, t in self._open.items() if now - t < CHALLENGE_TTL}
        nonce = base64.b64encode(os.urandom(32)).decode()
        self._open[nonce] = now
        return nonce

    def consume(self, nonce_b64: str) -> bytes:
        issued = self._open.pop(nonce_b64, None)
        if issued is None or self.clock() - issued > CHALLENGE_TTL:
            raise AuthError("Sign-in challenge expired or already used. Try again.")
        return base64.b64decode(nonce_b64)


def start_message(*, account: str, symbol: str, amount_usdc: float) -> str:
    return (f"NIXO: start the LIVE AI agent trading real funds.\n"
            f"Agent account: {account}\nMarket: {symbol}/USDC spot via NEAR Intents\n"
            f"Size: up to {amount_usdc:g} USDC per trade")


async def verify(*, rpc: NearRpc, owner: str, expected_message: str, signed: dict, challenges: Challenges) -> None:
    """`signed` = {account_id, public_key, signature (base64), message, nonce (base64)} from the wallet."""
    if signed.get("account_id") != owner:
        raise AuthError(f"Only {owner} can start the live agent")
    if signed.get("message") != expected_message:
        raise AuthError("Signed message doesn't match this session's settings")
    nonce = challenges.consume(str(signed.get("nonce", "")))
    try:
        sig = base64.b64decode(str(signed["signature"]))
    except Exception as err:
        raise AuthError("Malformed signature") from err
    digest = payload_hash(expected_message, nonce, RECIPIENT)
    if not verify_ed25519(str(signed.get("public_key", "")), sig, digest):
        raise AuthError("Signature check failed")
    try:
        key = await rpc.access_key(owner, signed["public_key"])
    except Exception as err:
        raise AuthError(f"Signing key is not a key of {owner}") from err
    if key.get("permission") != "FullAccess":
        raise AuthError("Sign with a full-access key of the owner account")

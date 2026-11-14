"""Encrypted trade log + delayed viewing-key path (PRD §4.2).

Off-chain store. Trade payloads are sealed with a per-run AES-GCM data key.
A delayed viewing key becomes redeemable after `delay_seconds`; redemption
re-encrypts the data key to the buyer's X25519 public key and writes a receipt.

Live / time-limited / auditor key types are typed but not shipped (stubs).
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat, PrivateFormat, NoEncryption

STORE_DIR = Path(os.environ.get("NIXO_VIEWING_STORE", Path(__file__).resolve().parents[2] / ".nixo_viewing"))


class KeyType(StrEnum):
    DELAYED = "delayed"
    LIVE = "live"  # stub — not shipped
    TIME_LIMITED = "time_limited"  # stub — not shipped
    AUDITOR = "auditor"  # stub — not shipped


@dataclass
class TradeLogEntry:
    entry_id: str
    run_id: str
    deposit_id: str | None
    assignment_id: str | None
    plaintext_hash: str
    ciphertext_b64: str
    nonce_b64: str
    created_at: float

    def to_dict(self) -> dict:
        return {
            "entry_id": self.entry_id,
            "run_id": self.run_id,
            "deposit_id": self.deposit_id,
            "assignment_id": self.assignment_id,
            "plaintext_hash": self.plaintext_hash,
            "ciphertext_b64": self.ciphertext_b64,
            "nonce_b64": self.nonce_b64,
            "created_at": self.created_at,
        }


@dataclass
class ViewingKeyOffer:
    key_id: str
    run_id: str
    key_type: KeyType
    owner: str
    created_at: float
    redeemable_at: float
    shipped: bool
    note: str
    redeemed_by: str | None = None
    redeemed_at: float | None = None
    wrapped_data_key_b64: str | None = None
    receipt_id: str | None = None

    def to_dict(self) -> dict:
        return {
            "key_id": self.key_id,
            "run_id": self.run_id,
            "key_type": self.key_type.value,
            "owner": self.owner,
            "created_at": self.created_at,
            "redeemable_at": self.redeemable_at,
            "shipped": self.shipped,
            "note": self.note,
            "redeemed_by": self.redeemed_by,
            "redeemed_at": self.redeemed_at,
            "wrapped_data_key_b64": self.wrapped_data_key_b64,
            "receipt_id": self.receipt_id,
            "disclaimer": "A viewing key decrypts NIXO's encrypted trade log for its scope; "
                          "it does not hide vault or Intents transfers on explorers.",
        }


@dataclass
class RunVault:
    run_id: str
    owner: str
    data_key: bytes
    entries: list[TradeLogEntry] = field(default_factory=list)
    offers: dict[str, ViewingKeyOffer] = field(default_factory=dict)


class ViewingKeyStore:
    def __init__(self, root: Path | None = None, clock=time.time):
        self.root = root or STORE_DIR
        self.root.mkdir(parents=True, exist_ok=True)
        self.clock = clock
        self._runs: dict[str, RunVault] = {}
        self._lock = threading.Lock()

    def ensure_run(self, run_id: str, owner: str) -> RunVault:
        with self._lock:
            rv = self._runs.get(run_id)
            if rv is None:
                rv = RunVault(run_id=run_id, owner=owner, data_key=AESGCM.generate_key(bit_length=256))
                self._runs[run_id] = rv
            return rv

    def append_trade(self, *, run_id: str, owner: str, payload: dict,
                     deposit_id: str | None = None, assignment_id: str | None = None) -> TradeLogEntry:
        rv = self.ensure_run(run_id, owner)
        raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        digest = hashlib.sha256(raw).hexdigest()
        nonce = os.urandom(12)
        ct = AESGCM(rv.data_key).encrypt(nonce, raw, None)
        entry = TradeLogEntry(
            entry_id=f"log_{uuid.uuid4().hex[:10]}",
            run_id=run_id,
            deposit_id=deposit_id,
            assignment_id=assignment_id,
            plaintext_hash=digest,
            ciphertext_b64=base64.b64encode(ct).decode(),
            nonce_b64=base64.b64encode(nonce).decode(),
            created_at=self.clock(),
        )
        with self._lock:
            rv.entries.append(entry)
            self._persist_entry(entry)
        return entry

    def create_delayed_offer(self, *, run_id: str, owner: str, delay_seconds: float = 60.0) -> ViewingKeyOffer:
        rv = self.ensure_run(run_id, owner)
        if rv.owner != owner:
            raise PermissionError("NOT_OWNER")
        now = self.clock()
        offer = ViewingKeyOffer(
            key_id=f"vk_{uuid.uuid4().hex[:10]}",
            run_id=run_id,
            key_type=KeyType.DELAYED,
            owner=owner,
            created_at=now,
            redeemable_at=now + delay_seconds,
            shipped=True,
            note="Delayed viewing key: redeemable after delay; decrypts this run's trade log.",
        )
        with self._lock:
            rv.offers[offer.key_id] = offer
        return offer

    def stub_offer(self, *, run_id: str, owner: str, key_type: KeyType) -> ViewingKeyOffer:
        if key_type == KeyType.DELAYED:
            raise ValueError("use create_delayed_offer for delayed keys")
        rv = self.ensure_run(run_id, owner)
        now = self.clock()
        offer = ViewingKeyOffer(
            key_id=f"vk_{uuid.uuid4().hex[:10]}",
            run_id=run_id,
            key_type=key_type,
            owner=owner,
            created_at=now,
            redeemable_at=now,
            shipped=False,
            note=f"{key_type.value} keys are typed in the product design but not shipped in this version.",
        )
        with self._lock:
            rv.offers[offer.key_id] = offer
        return offer

    def redeem(self, *, key_id: str, buyer: str, buyer_x25519_pub_b64: str) -> dict:
        with self._lock:
            offer, rv = self._find_offer(key_id)
            if not offer.shipped:
                raise PermissionError("KEY_TYPE_NOT_SHIPPED")
            if offer.key_type != KeyType.DELAYED:
                raise PermissionError("KEY_TYPE_NOT_SHIPPED")
            now = self.clock()
            if now < offer.redeemable_at:
                raise PermissionError(f"NOT_YET_REDEEMABLE:{offer.redeemable_at - now:.0f}s")
            if offer.redeemed_by and offer.redeemed_by != buyer:
                raise PermissionError("ALREADY_REDEEMED")

            buyer_pub = X25519PublicKey.from_public_bytes(base64.b64decode(buyer_x25519_pub_b64))
            ephemeral = X25519PrivateKey.generate()
            shared = ephemeral.exchange(buyer_pub)
            wrap_key = hashlib.sha256(shared).digest()
            nonce = os.urandom(12)
            wrapped = AESGCM(wrap_key).encrypt(nonce, rv.data_key, None)
            eph_pub = ephemeral.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)

            receipt_id = f"rcpt_{uuid.uuid4().hex[:10]}"
            offer.redeemed_by = buyer
            offer.redeemed_at = now
            offer.receipt_id = receipt_id
            offer.wrapped_data_key_b64 = base64.b64encode(nonce + wrapped).decode()

            return {
                "receipt_id": receipt_id,
                "key_id": key_id,
                "run_id": rv.run_id,
                "buyer": buyer,
                "ephemeral_pub_b64": base64.b64encode(eph_pub).decode(),
                "wrapped_data_key_b64": offer.wrapped_data_key_b64,
                "entry_count": len(rv.entries),
                "entries": [e.to_dict() for e in rv.entries],
                "disclaimer": offer.to_dict()["disclaimer"],
            }

    def decrypt_with_data_key(self, *, data_key: bytes, entry: TradeLogEntry) -> dict:
        nonce = base64.b64decode(entry.nonce_b64)
        ct = base64.b64decode(entry.ciphertext_b64)
        raw = AESGCM(data_key).decrypt(nonce, ct, None)
        return json.loads(raw.decode())

    def unwrap_data_key(self, *, buyer_private_b64: str, ephemeral_pub_b64: str,
                       wrapped_data_key_b64: str) -> bytes:
        buyer_priv = X25519PrivateKey.from_private_bytes(base64.b64decode(buyer_private_b64))
        eph_pub = X25519PublicKey.from_public_bytes(base64.b64decode(ephemeral_pub_b64))
        shared = buyer_priv.exchange(eph_pub)
        wrap_key = hashlib.sha256(shared).digest()
        blob = base64.b64decode(wrapped_data_key_b64)
        nonce, wrapped = blob[:12], blob[12:]
        return AESGCM(wrap_key).decrypt(nonce, wrapped, None)

    def list_offers(self, run_id: str) -> list[dict]:
        rv = self._runs.get(run_id)
        if not rv:
            return []
        return [o.to_dict() for o in rv.offers.values()]

    def list_entries(self, run_id: str) -> list[dict]:
        rv = self._runs.get(run_id)
        if not rv:
            return []
        return [e.to_dict() for e in rv.entries]

    def _find_offer(self, key_id: str) -> tuple[ViewingKeyOffer, RunVault]:
        for rv in self._runs.values():
            if key_id in rv.offers:
                return rv.offers[key_id], rv
        raise KeyError("UNKNOWN_KEY")

    def _persist_entry(self, entry: TradeLogEntry) -> None:
        path = self.root / entry.run_id
        path.mkdir(parents=True, exist_ok=True)
        (path / f"{entry.entry_id}.json").write_text(json.dumps(entry.to_dict()))


def generate_buyer_keypair() -> dict:
    priv = X25519PrivateKey.generate()
    pub = priv.public_key()
    return {
        "private_b64": base64.b64encode(priv.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())).decode(),
        "public_b64": base64.b64encode(pub.public_bytes(Encoding.Raw, PublicFormat.Raw)).decode(),
    }


store = ViewingKeyStore()

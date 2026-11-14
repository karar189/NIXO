"""Encrypted, hash-chained feed of a trader's agent trades.

Each trader has one data key per epoch (`copy_epoch_secs`). Entries are
AES-GCM encrypted with that epoch's key, with `nixo-copy|trader|seq|epoch` as
associated data so ciphertexts can't be swapped between traders or positions.

Public per entry: seq, epoch, timestamp, plaintext hash and chain hash.
`chain_n = sha256(chain_{n-1} || sha256(plaintext_n))` from a zero genesis, so
anyone can check that no entry was edited, dropped or reordered, and a key
holder can also check each decrypted entry against its hash.

A subscriber receives the epoch keys that overlap their subscription window,
wrapped to the X25519 key they registered on-chain. Access is rounded to whole
epochs. Once a key is handed out it can't be taken back, so expiry only stops
access to later epochs.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.nixo.viewing_keys import wrap_key

log = logging.getLogger(__name__)

GENESIS = "0" * 64


def aad(trader: str, seq: int, epoch: int) -> bytes:
    return f"nixo-copy|{trader}|{seq}|{epoch}".encode()


def chain_next(prev: str, plaintext_hash: str) -> str:
    return hashlib.sha256(bytes.fromhex(prev) + bytes.fromhex(plaintext_hash)).hexdigest()


def verify_chain(entries: list[dict]) -> bool:
    """True if `entries` (a full feed from seq 1) form an unbroken hash chain."""
    head = GENESIS
    for i, e in enumerate(entries, start=1):
        if e["seq"] != i:
            return False
        head = chain_next(head, e["plaintext_hash"])
        if head != e["chain_hash"]:
            return False
    return True


@dataclass
class FeedEntry:
    trader: str
    seq: int
    epoch: int
    ts: float
    kind: str
    plaintext_hash: str
    chain_hash: str
    nonce_b64: str
    ciphertext_b64: str

    def to_dict(self) -> dict:
        return {
            "trader": self.trader,
            "seq": self.seq,
            "epoch": self.epoch,
            "ts": self.ts,
            "kind": self.kind,
            "plaintext_hash": self.plaintext_hash,
            "chain_hash": self.chain_hash,
            "nonce_b64": self.nonce_b64,
            "ciphertext_b64": self.ciphertext_b64,
        }


@dataclass
class TraderFeed:
    keys: dict[int, bytes] = field(default_factory=dict)
    entries: list[FeedEntry] = field(default_factory=list)
    head: str = GENESIS


class CopyFeed:
    def __init__(self, *, epoch_secs: float, root: Path | None = None, master_key: str | None = None,
                 clock=time.time):
        self.epoch_secs = float(epoch_secs)
        self.clock = clock
        self.root = root
        self._seal = AESGCM(hashlib.sha256(master_key.encode()).digest()) if (root and master_key) else None
        self._feeds: dict[str, TraderFeed] = {}
        self._lock = threading.Lock()
        if root and not master_key:
            log.warning("NIXO_COPY_MASTER_KEY is not set: copy-trade feed keys are memory-only")
        if self._seal:
            self._load()

    # ------------------------------------------------------------ epochs

    def epoch_of(self, ts: float) -> int:
        return int(ts // self.epoch_secs)

    def epoch_bounds(self, epoch: int) -> tuple[float, float]:
        return epoch * self.epoch_secs, (epoch + 1) * self.epoch_secs

    # ------------------------------------------------------------ writes

    def append(self, trader: str, payload: dict, *, kind: str | None = None) -> FeedEntry:
        raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        with self._lock:
            feed = self._feeds.setdefault(trader, TraderFeed())
            ts = self.clock()
            epoch = self.epoch_of(ts)
            key = self._key(trader, feed, epoch)
            seq = len(feed.entries) + 1
            digest = hashlib.sha256(raw).hexdigest()
            chain = chain_next(feed.head, digest)
            nonce = os.urandom(12)
            ct = AESGCM(key).encrypt(nonce, raw, aad(trader, seq, epoch))
            entry = FeedEntry(
                trader=trader, seq=seq, epoch=epoch, ts=ts, kind=kind or str(payload.get("type", "event")),
                plaintext_hash=digest, chain_hash=chain,
                nonce_b64=base64.b64encode(nonce).decode(), ciphertext_b64=base64.b64encode(ct).decode(),
            )
            feed.entries.append(entry)
            feed.head = chain
            self._persist_entry(entry)
            return entry

    def _key(self, trader: str, feed: TraderFeed, epoch: int) -> bytes:
        key = feed.keys.get(epoch)
        if key is None:
            key = AESGCM.generate_key(bit_length=256)
            feed.keys[epoch] = key
            self._persist_keys(trader, feed)
        return key

    # ------------------------------------------------------------ reads

    def has_feed(self, trader: str) -> bool:
        return trader in self._feeds

    def entries(self, trader: str, since_seq: int = 0, limit: int = 200) -> list[dict]:
        feed = self._feeds.get(trader)
        if not feed:
            return []
        return [e.to_dict() for e in feed.entries if e.seq > since_seq][:limit]

    def head(self, trader: str) -> dict:
        feed = self._feeds.get(trader)
        return {"chain_head": feed.head if feed else GENESIS, "entry_count": len(feed.entries) if feed else 0}

    def wrapped_keys(self, trader: str, recipient_pub_b64: str, starts_at: float, expires_at: float) -> list[dict]:
        """Epoch keys overlapping [starts_at, expires_at) that have already begun, wrapped to the recipient."""
        feed = self._feeds.get(trader)
        if not feed:
            return []
        now = self.clock()
        out = []
        for epoch, key in sorted(feed.keys.items()):
            start, end = self.epoch_bounds(epoch)
            if end <= starts_at or start >= expires_at or start > now:
                continue
            out.append({"epoch": epoch, "epoch_start": start, "epoch_end": end,
                        **wrap_key(key, recipient_pub_b64)})
        return out

    @staticmethod
    def decrypt(entry: dict, data_key: bytes) -> dict:
        raw = AESGCM(data_key).decrypt(
            base64.b64decode(entry["nonce_b64"]),
            base64.b64decode(entry["ciphertext_b64"]),
            aad(entry["trader"], entry["seq"], entry["epoch"]),
        )
        if hashlib.sha256(raw).hexdigest() != entry["plaintext_hash"]:
            raise ValueError("plaintext hash mismatch")
        return json.loads(raw)

    # ------------------------------------------------------------ persistence

    def _dir(self, trader: str) -> Path:
        assert self.root is not None
        if "/" in trader or "\\" in trader or trader.startswith("."):
            raise ValueError("invalid trader id")
        d = self.root / trader
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _persist_keys(self, trader: str, feed: TraderFeed) -> None:
        if not self._seal:
            return
        sealed = {}
        for epoch, key in feed.keys.items():
            nonce = os.urandom(12)
            sealed[str(epoch)] = base64.b64encode(nonce + self._seal.encrypt(nonce, key, trader.encode())).decode()
        (self._dir(trader) / "keys.json").write_text(json.dumps(sealed))

    def _persist_entry(self, entry: FeedEntry) -> None:
        if not self._seal:
            return
        with (self._dir(entry.trader) / "entries.jsonl").open("a") as f:
            f.write(json.dumps(entry.to_dict()) + "\n")

    def _load(self) -> None:
        assert self.root is not None and self._seal is not None
        if not self.root.exists():
            return
        for d in sorted(p for p in self.root.iterdir() if p.is_dir()):
            trader = d.name
            try:
                feed = TraderFeed()
                keys_file = d / "keys.json"
                if keys_file.exists():
                    for epoch, blob in json.loads(keys_file.read_text()).items():
                        raw = base64.b64decode(blob)
                        feed.keys[int(epoch)] = self._seal.decrypt(raw[:12], raw[12:], trader.encode())
                entries_file = d / "entries.jsonl"
                if entries_file.exists():
                    for line in entries_file.read_text().splitlines():
                        if line.strip():
                            e = json.loads(line)
                            e.pop("trader", None)
                            feed.entries.append(FeedEntry(trader=trader, **e))
                if feed.entries:
                    feed.head = feed.entries[-1].chain_hash
                self._feeds[trader] = feed
            except Exception:
                log.exception("could not load copy feed for %s (wrong NIXO_COPY_MASTER_KEY?)", trader)

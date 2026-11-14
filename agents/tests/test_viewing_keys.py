"""Delayed viewing-key path."""

from __future__ import annotations

import time

from app.nixo.viewing_keys import KeyType, ViewingKeyStore, generate_buyer_keypair


def test_encrypt_delayed_redeem_decrypt(tmp_path):
    clock = {"t": 1_000.0}

    def now():
        return clock["t"]

    store = ViewingKeyStore(root=tmp_path, clock=now)
    store.append_trade(
        run_id="run_1",
        owner="alice.testnet",
        payload={"action": "swap", "amount": "1.5", "target": "intents.near"},
        deposit_id="1",
        assignment_id="1",
    )
    offer = store.create_delayed_offer(run_id="run_1", owner="alice.testnet", delay_seconds=30)
    assert offer.shipped
    assert offer.key_type == KeyType.DELAYED

    kp = generate_buyer_keypair()
    try:
        store.redeem(key_id=offer.key_id, buyer="buyer.testnet", buyer_x25519_pub_b64=kp["public_b64"])
        assert False, "should not redeem early"
    except PermissionError as err:
        assert "NOT_YET_REDEEMABLE" in str(err)

    clock["t"] = 1_040.0
    out = store.redeem(key_id=offer.key_id, buyer="buyer.testnet", buyer_x25519_pub_b64=kp["public_b64"])
    assert out["entry_count"] == 1
    assert out["receipt_id"]
    data_key = store.unwrap_data_key(
        buyer_private_b64=kp["private_b64"],
        ephemeral_pub_b64=out["ephemeral_pub_b64"],
        wrapped_data_key_b64=out["wrapped_data_key_b64"],
    )
    entry = store.list_entries("run_1")[0]
    from app.nixo.viewing_keys import TradeLogEntry

    plain = store.decrypt_with_data_key(
        data_key=data_key,
        entry=TradeLogEntry(**{k: entry[k] for k in TradeLogEntry.__dataclass_fields__}),
    )
    assert plain["action"] == "swap"
    assert "disclaimer" in out


def test_stub_key_types_not_shipped(tmp_path):
    store = ViewingKeyStore(root=tmp_path, clock=time.time)
    offer = store.stub_offer(run_id="run_2", owner="alice.testnet", key_type=KeyType.LIVE)
    assert offer.shipped is False
    kp = generate_buyer_keypair()
    try:
        store.redeem(key_id=offer.key_id, buyer="buyer.testnet", buyer_x25519_pub_b64=kp["public_b64"])
        assert False
    except PermissionError as err:
        assert "KEY_TYPE_NOT_SHIPPED" in str(err)


def test_onchain_near_to_yocto():
    from app.nixo.onchain import near_to_yocto

    assert near_to_yocto("1") == str(10**24)
    assert near_to_yocto("0.5") == str(5 * 10**23)

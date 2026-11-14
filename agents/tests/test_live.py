"""Live NEAR Intents execution: signing, owner auth, executor guardrails, engine wiring.

Nothing here touches mainnet: RPC, signer and 1Click are fakes.
"""

from __future__ import annotations

import base64
import hashlib
from types import SimpleNamespace

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from pydantic import SecretStr

from app.live import nep413
from app.live.executor import LiveAgent, LiveError
from app.live.near import TGAS, FunctionCall, KeyPair, b58decode, b58encode, encode_transaction, sign_transaction
from app.trading import market_data
from app.trading.engine import Engine, Session, SessionConfig
from app.trading.markets import USDC_NEAR, get_market

AGENT, OWNER = "agent.nixo.near", "owner.near"
USDC = USDC_NEAR.removeprefix("nep141:")
DEPOSIT = "ab" * 32


# ---------------------------------------------------------------- transaction encoding


def test_transaction_bytes_match_near_api_js_vectors():
    """Digests of bytes produced identically by near-api-js 7 (createTransaction/encodeTransaction)."""
    kp = KeyPair(Ed25519PrivateKey.from_private_bytes(bytes(range(32))))
    assert KeyPair.from_string("ed25519:" + b58encode(bytes(range(32)) + kp.public_bytes)).public_key == kp.public_key
    actions = [
        FunctionCall("storage_deposit", {"account_id": "abc.near", "registration_only": True}, 30 * TGAS, 1250000000000000000000),
        FunctionCall("ft_transfer", {"receiver_id": "a" * 64, "amount": "25000000"}, 30 * TGAS, 1),
    ]
    tx = encode_transaction(signer_id="agent.nixo.near", public_key=kp.public_bytes, nonce=123456789012,
                            receiver_id=USDC, block_hash=hashlib.sha256(b"block").digest(), actions=actions)
    signed, tx_hash = sign_transaction(kp, tx)
    assert hashlib.sha256(tx).hexdigest() == "51efadc8dd32fd58a2ddcdfa1ed0bea5068b52a779c91fd6edf71bc70688c9ce"
    assert hashlib.sha256(signed).hexdigest() == "a034ac207f907446c49157c21fb4f5b19ca9485cc06f5e78bbcf846e477c8c81"
    assert tx_hash == "6WqzovA3wYLZdCkRgPqo3SzhXHRwFBnP8PLzWLd2ooL9"


def test_base58_round_trip_and_key_repr_hides_secret():
    for raw in (b"", b"\0", b"\0\0\x01\x02", bytes(range(64))):
        assert b58decode(b58encode(raw)) == raw
    kp = KeyPair(Ed25519PrivateKey.generate())
    assert "ed25519:" in repr(kp) and len(repr(kp)) < 80


def test_key_with_mismatched_public_half_is_rejected():
    seed = bytes(range(32))
    with pytest.raises(ValueError):
        KeyPair.from_string("ed25519:" + b58encode(seed + bytes(32)))


# ---------------------------------------------------------------- NEP-413 owner auth


class AuthRpc:
    def __init__(self, keys: dict[str, str]):
        self.keys = keys  # public key -> permission

    async def access_key(self, account, public_key):
        if public_key not in self.keys:
            raise RuntimeError("UNKNOWN_ACCESS_KEY")
        return {"permission": self.keys[public_key], "nonce": 1}


def _signed(kp: KeyPair, message: str, nonce_b64: str, account=OWNER) -> dict:
    sig = kp.sign(nep413.payload_hash(message, base64.b64decode(nonce_b64), nep413.RECIPIENT))
    return {"account_id": account, "public_key": kp.public_key, "signature": base64.b64encode(sig).decode(),
            "message": message, "nonce": nonce_b64}


@pytest.mark.asyncio
async def test_nep413_accepts_owner_full_access_signature_once():
    kp = KeyPair(Ed25519PrivateKey.generate())
    rpc, ch = AuthRpc({kp.public_key: "FullAccess"}), nep413.Challenges()
    msg = nep413.start_message(account=AGENT, symbol="NEAR", amount_usdc=10)
    nonce = ch.issue()
    await nep413.verify(rpc=rpc, owner=OWNER, expected_message=msg, signed=_signed(kp, msg, nonce), challenges=ch)
    with pytest.raises(nep413.AuthError, match="expired or already used"):
        await nep413.verify(rpc=rpc, owner=OWNER, expected_message=msg, signed=_signed(kp, msg, nonce), challenges=ch)


@pytest.mark.asyncio
@pytest.mark.parametrize("case", ["wrong_account", "other_message", "bad_sig", "fc_key", "unknown_key"])
async def test_nep413_rejects(case):
    kp, other = KeyPair(Ed25519PrivateKey.generate()), KeyPair(Ed25519PrivateKey.generate())
    perm = "FullAccess" if case != "fc_key" else {"FunctionCall": {}}
    rpc = AuthRpc({} if case == "unknown_key" else {kp.public_key: perm})
    ch = nep413.Challenges()
    msg = nep413.start_message(account=AGENT, symbol="NEAR", amount_usdc=10)
    signed = _signed(kp, msg, ch.issue(), account="mallory.near" if case == "wrong_account" else OWNER)
    expected = nep413.start_message(account=AGENT, symbol="NEAR", amount_usdc=25) if case == "other_message" else msg
    if case == "other_message":
        signed["message"] = expected  # claims the bigger size but signed the smaller one
    if case == "bad_sig":
        signed["signature"] = base64.b64encode(other.sign(b"x" * 32)).decode()
    with pytest.raises(nep413.AuthError):
        await nep413.verify(rpc=rpc, owner=OWNER, expected_message=expected, signed=signed, challenges=ch)


# ---------------------------------------------------------------- executor


def live_cfg(**over):
    base = dict(
        live_enabled=True, agent_account=AGENT, agent_private_key=SecretStr("ed25519:x"), agent_owner=OWNER,
        live_rpc="http://rpc", live_markets="NEAR,BTC,ETH", live_max_trade_usdc=25.0, live_min_trade_usdc=1.0,
        live_daily_budget_usdc=40.0, live_max_slippage_bps=100, live_max_mark_deviation_bps=150,
        live_swap_timeout_secs=60.0, live_store_dir=None,
    )
    base.update(over)
    return SimpleNamespace(**base)


class FakeRpc:
    def __init__(self):
        self.balances = {USDC: 100 * 10**6, "wrap.near": 0}
        self.registered = {(USDC, AGENT), ("wrap.near", AGENT)}

    async def view(self, contract, method, args=None):
        if method == "ft_balance_of":
            return str(self.balances.get(contract, 0))
        if method == "storage_balance_of":
            return {"total": "1"} if (contract, args["account_id"]) in self.registered else None
        if method == "storage_balance_bounds":
            return {"min": "1250000000000000000000"}
        raise AssertionError(method)

    async def account(self, account_id):
        return {"amount": str(10**24)}


class FakeSigner:
    def __init__(self, result=None):
        self.sent = []
        self.result = result or {"status": {"SuccessValue": ""}, "receipts_outcome": []}

    async def send(self, receiver, actions):
        self.sent.append((receiver, actions))
        return "TxHash111", self.result


class OneClick:
    """Fake 1Click: quotes at `price` USDC per NEAR, then walks statuses."""

    def __init__(self, price=3.0, statuses=("PROCESSING", "SUCCESS"), echo_recipient=AGENT):
        self.price, self.statuses, self.echo = price, list(statuses), echo_recipient
        self.quotes, self.submitted = [], []

    async def quote(self, body):
        self.quotes.append(body)
        amt = int(body["amount"])
        if body["originAsset"] == USDC_NEAR:
            out = int(amt / 10**6 / self.price * 10**24)
        else:
            out = int(amt / 10**24 * self.price * 10**6)
        return {"quote": {"depositAddress": DEPOSIT, "amountIn": body["amount"], "amountOut": str(out)},
                "quoteRequest": {**body, "recipient": self.echo, "refundTo": self.echo}, "correlationId": "c1"}

    async def status(self, deposit, memo=None):
        st = self.statuses.pop(0) if len(self.statuses) > 1 else self.statuses[0]
        return {"status": st, "swapDetails": {}}

    async def submit(self, deposit, tx, sender):
        self.submitted.append((deposit, tx, sender))
        return {}


async def no_sleep(_s):
    return None


def agent(tmp_path, cfg=None, oc=None, signer=None, rpc=None):
    oc = oc or OneClick()
    return LiveAgent(cfg=cfg or live_cfg(), rpc=rpc or FakeRpc(), signer=signer or FakeSigner(), quote_fn=oc.quote,
                     status_fn=oc.status, submit_fn=oc.submit, sleep=no_sleep, store_dir=tmp_path), oc


@pytest.mark.asyncio
async def test_buy_quotes_to_agent_transfers_exact_amount_and_waits_for_success(tmp_path):
    signer = FakeSigner()
    la, oc = agent(tmp_path, signer=signer)
    fill = await la.buy(get_market("NEAR"), 10.0, mark=3.0)

    q = oc.quotes[0]
    assert q["dry"] is False and q["recipient"] == AGENT and q["refundTo"] == AGENT
    assert q["depositType"] == "ORIGIN_CHAIN" and q["amount"] == "10000000" and q["slippageTolerance"] == 100
    receiver, actions = signer.sent[-1]
    assert receiver == USDC
    assert [a.method_name for a in actions] == ["storage_deposit", "ft_transfer"]  # deposit address registered first
    assert actions[1].args == {"receiver_id": DEPOSIT, "amount": "10000000"} and actions[1].deposit == 1
    assert oc.submitted == [(DEPOSIT, "TxHash111", AGENT)]
    assert fill.usdc == 10.0 and fill.qty == pytest.approx(10 / 3) and fill.price == pytest.approx(3.0)
    assert la.orders[-1]["status"] == "SUCCESS" and la.spent_24h() == 10.0
    # Ledger survives a restart.
    assert agent(tmp_path)[0].orders[-1]["status"] == "SUCCESS"


@pytest.mark.asyncio
async def test_sell_caps_at_held_balance(tmp_path):
    rpc = FakeRpc()
    rpc.balances["wrap.near"] = 2 * 10**24
    rpc.registered.add(("wrap.near", DEPOSIT))
    signer = FakeSigner()
    la, oc = agent(tmp_path, rpc=rpc, signer=signer)
    fill = await la.sell(get_market("NEAR"), 5 * 10**24, mark=3.0)
    assert signer.sent[-1][0] == "wrap.near"
    assert signer.sent[-1][1][-1].args["amount"] == str(2 * 10**24)
    assert fill.usdc == pytest.approx(6.0)


@pytest.mark.asyncio
@pytest.mark.parametrize("cfg_over,amount,match", [
    ({"live_enabled": False}, 10.0, "off"),
    ({}, 30.0, "per-trade cap"),
    ({}, 0.5, "minimum"),
    ({"live_markets": "BTC"}, 10.0, "isn't enabled"),
])
async def test_guardrails_refuse_before_any_transaction(tmp_path, cfg_over, amount, match):
    signer = FakeSigner()
    la, oc = agent(tmp_path, cfg=live_cfg(**cfg_over), signer=signer)
    with pytest.raises(LiveError, match=match):
        await la.buy(get_market("NEAR"), amount, mark=3.0)
    assert signer.sent == []


@pytest.mark.asyncio
async def test_daily_budget(tmp_path):
    la, _ = agent(tmp_path)
    await la.buy(get_market("NEAR"), 25.0, mark=3.0)
    with pytest.raises(LiveError, match="24h budget"):
        await la.buy(get_market("NEAR"), 20.0, mark=3.0)


@pytest.mark.asyncio
async def test_bad_quote_price_or_recipient_is_refused(tmp_path):
    signer = FakeSigner()
    la, _ = agent(tmp_path, oc=OneClick(price=3.2), signer=signer)  # ~667 bps worse than mark 3.0
    with pytest.raises(LiveError, match="worse than the mark"):
        await la.buy(get_market("NEAR"), 10.0, mark=3.0)
    la, _ = agent(tmp_path, oc=OneClick(echo_recipient="mallory.near"), signer=signer)
    with pytest.raises(LiveError, match="recipient"):
        await la.buy(get_market("NEAR"), 10.0, mark=3.0)
    assert signer.sent == []


@pytest.mark.asyncio
async def test_refund_and_onchain_failure_raise(tmp_path):
    la, _ = agent(tmp_path, oc=OneClick(statuses=("PROCESSING", "REFUNDED")))
    with pytest.raises(LiveError, match="refunded"):
        await la.buy(get_market("NEAR"), 10.0, mark=3.0)
    assert la.spent_24h() == 0  # refunded spend doesn't count against the budget

    failing = FakeSigner({"status": {"Failure": {"ActionError": "x"}}, "receipts_outcome": []})
    la, _ = agent(tmp_path / "b", signer=failing)
    with pytest.raises(LiveError, match="failed on-chain"):
        await la.buy(get_market("NEAR"), 10.0, mark=3.0)
    assert la.orders[-1]["status"] == "TX_FAILED"


def test_check_session_rules():
    la = LiveAgent(cfg=live_cfg(), rpc=FakeRpc(), store_dir=None)
    la.check_session(account=OWNER, symbol="NEAR", leverage=1, amount_usdc=10)
    for kw, match in [({"account": "x.near"}, "Only"), ({"symbol": "SOL"}, "isn't enabled"),
                      ({"leverage": 5}, "1x"), ({"amount_usdc": 100}, "cap")]:
        args = {"account": OWNER, "symbol": "NEAR", "leverage": 1, "amount_usdc": 10, **kw}
        with pytest.raises(LiveError, match=match):
            la.check_session(**args)


# ---------------------------------------------------------------- engine wiring


@pytest.mark.asyncio
async def test_engine_live_session_buys_sells_and_skips_shorts(tmp_path, monkeypatch):
    from app.trading import engine as engine_mod

    la, oc = agent(tmp_path)
    monkeypatch.setattr(engine_mod, "live_agent", la)

    async def get_price(_s):
        return 3.0

    monkeypatch.setattr(market_data, "get_price", get_price)
    rpc = la.rpc
    rpc.registered.add(("wrap.near", DEPOSIT))

    eng = Engine()
    s = Session(account=OWNER, mode="agent", market=get_market("NEAR"),
                config=SessionConfig(symbol="NEAR", amount_usdc=10, leverage=1, execution="live"))
    eng.sessions[OWNER] = s

    await eng._open(s, "SHORT", 3.0, "signal")
    assert s.position is None and oc.quotes == []

    await eng._open(s, "LONG", 3.0, "signal")
    assert s.position and s.position.leverage == 1 and s.position.entry_usdc == 10.0
    units = int(s.position.entry_fill["live"]["units_out"])
    assert units > 0

    rpc.balances["wrap.near"] = units
    oc.price = 3.3
    await eng._close(s, 3.3, "TAKE_PROFIT")
    assert s.position is None
    trade = eng.book(OWNER).trades[-1]
    assert trade["pnl"] == pytest.approx(1.0, rel=1e-3)  # 10 USDC -> 3.333 NEAR -> 11 USDC
    assert oc.quotes[-1]["originAsset"] == "nep141:wrap.near"


@pytest.mark.asyncio
async def test_engine_live_failure_keeps_position_and_backs_off(tmp_path, monkeypatch):
    from app.trading import engine as engine_mod

    la, oc = agent(tmp_path, oc=OneClick(statuses=("REFUNDED",)))
    monkeypatch.setattr(engine_mod, "live_agent", la)
    eng = Engine()
    s = Session(account=OWNER, mode="agent", market=get_market("NEAR"),
                config=SessionConfig(symbol="NEAR", amount_usdc=10, leverage=1, execution="live"))
    await eng._open(s, "LONG", 3.0, "signal")
    assert s.position is None
    assert any("Live order not filled" in log["message"] for log in s.logs)
    assert s.live_retry_at > 0 and not s.live_inflight

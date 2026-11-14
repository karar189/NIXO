"""Provenance registry and authorization vault (Nixo_agents.md §5-§7).

The vault is Agent B's enforcement boundary. It holds B's allocation, checks
every trade request against the assignment and policy, reserves spending
capacity atomically before execution, and reconciles the reservation from the
adapter's result. The execution adapter can only move B's capital by redeeming
a ticket the vault issued, and it executes the parameters stored with the
ticket, not parameters the caller supplies.

v0.1 scope notes:
- Enforcement runs in-process in the agents service (off-chain). Moving these
  checks into a NEAR contract is the next step; the rules and reason codes are
  written to port 1:1.
- Spending is measured in the allocation asset: a swap must spend the
  assignment's asset (USDC on NEAR) and buy an allowed asset.
- Assets are SYMBOL@chain codes. The chain of every asset comes from the policy's
  frozen `asset_chains` map (built from the 1Click catalogue), never from the
  request. Cross-chain output may only go to the vault (recipient None) or to the
  owner's pinned address for that chain.
- Verification is a labelled stub; it is not source-of-funds verification.
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from collections.abc import Mapping
from decimal import Decimal
from enum import StrEnum
from types import MappingProxyType

from app.nixo.audit import AuditLog

UNIT = Decimal("0.000001")  # smallest USDC unit (6 decimals)


def ds(d: Decimal | None) -> str | None:
    """Plain decimal string (no exponent), e.g. 0E-8 -> '0.00000000'."""
    return None if d is None else format(d, "f")
VERIFICATION_STATES = ("stub_verified", "stub_unverified", "unknown")


class Reason(StrEnum):
    INVALID_REQUEST = "INVALID_REQUEST"
    REPLAY_DETECTED = "REPLAY_DETECTED"
    UNKNOWN_ASSIGNMENT = "UNKNOWN_ASSIGNMENT"
    ASSIGNMENT_REVOKED = "ASSIGNMENT_REVOKED"
    ASSIGNMENT_INACTIVE = "ASSIGNMENT_INACTIVE"
    FAIL_CLOSED = "FAIL_CLOSED"
    AGENT_MISMATCH = "AGENT_MISMATCH"
    WITHDRAWAL_NOT_ALLOWED = "WITHDRAWAL_NOT_ALLOWED"
    ACTION_NOT_ALLOWED = "ACTION_NOT_ALLOWED"
    ASSET_NOT_ALLOWED = "ASSET_NOT_ALLOWED"
    CHAIN_NOT_ALLOWED = "CHAIN_NOT_ALLOWED"
    RECIPIENT_NOT_ALLOWED = "RECIPIENT_NOT_ALLOWED"
    INVALID_AMOUNT = "INVALID_AMOUNT"
    MAX_TRADE_EXCEEDED = "MAX_TRADE_EXCEEDED"
    TOTAL_SPEND_EXCEEDED = "TOTAL_SPEND_EXCEEDED"
    ALLOCATION_EXCEEDED = "ALLOCATION_EXCEEDED"


class VaultError(Exception):
    """Owner-side operation refused (deposit/assign/revoke)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------- records


@dataclass
class DepositRecord:
    deposit_id: str
    owner: str
    asset: str
    amount: Decimal
    source_reference: str
    deposited_at: float
    verification_status: str
    verification_method: str = "demo_stub"
    record_version: int = 1
    allocated: Decimal = Decimal(0)

    @property
    def unallocated(self) -> Decimal:
        return self.amount - self.allocated

    def to_dict(self) -> dict:
        return {
            "deposit_id": self.deposit_id,
            "owner": self.owner,
            "asset": self.asset,
            "amount": ds(self.amount),
            "source_reference": self.source_reference,
            "deposited_at": self.deposited_at,
            "verification_status": self.verification_status,
            "verification_method": self.verification_method,
            "record_version": self.record_version,
            "allocated": ds(self.allocated),
            "is_stub": self.verification_method == "demo_stub",
        }


@dataclass(frozen=True)
class Policy:
    policy_id: str
    agent_id: str
    allowed_actions: frozenset[str]
    allowed_assets: frozenset[str]
    max_trade_amount: Decimal
    max_total_spend: Decimal
    withdrawals_allowed: bool = False
    enabled: bool = True
    # Cross-chain rules. An empty `asset_chains` means a legacy single-chain policy:
    # chain checks are skipped and no external recipient is ever allowed.
    allowed_chains: frozenset[str] = frozenset()
    asset_chains: Mapping[str, str] = field(default_factory=lambda: MappingProxyType({}))
    recipients: Mapping[str, str] = field(default_factory=lambda: MappingProxyType({}))

    def __post_init__(self) -> None:  # freeze the maps so a policy can't be mutated after assignment
        object.__setattr__(self, "asset_chains", MappingProxyType(dict(self.asset_chains)))
        object.__setattr__(self, "recipients", MappingProxyType(dict(self.recipients)))

    def chain_of(self, asset: str | None) -> str | None:
        return self.asset_chains.get(asset) if asset else None

    def to_dict(self) -> dict:
        return {
            "policy_id": self.policy_id,
            "agent_id": self.agent_id,
            "allowed_actions": sorted(self.allowed_actions),
            "allowed_assets": sorted(self.allowed_assets),
            "allowed_chains": sorted(self.allowed_chains),
            "recipients": dict(self.recipients),
            "max_trade_amount": ds(self.max_trade_amount),
            "max_total_spend": ds(self.max_total_spend),
            "withdrawals_allowed": self.withdrawals_allowed,
            "enabled": self.enabled,
        }


@dataclass
class Assignment:
    assignment_id: str
    agent_id: str
    deposit_id: str
    allocated_amount: Decimal
    asset: str
    policy: Policy
    assigned_at: float
    status: str = "active"  # active | revoked
    revoked_at: float | None = None
    frozen_reason: str | None = None  # set when the adapter returns something unexpected
    reserved: Decimal = Decimal(0)
    settled_spend: Decimal = Decimal(0)
    released: Decimal = Decimal(0)
    held: Decimal = Decimal(0)  # reservations with an unknown outcome (fail closed)
    holdings: dict[str, Decimal] = field(default_factory=dict)  # assets bought, held by the vault
    delivered: list[dict] = field(default_factory=list)  # output sent to the owner's pinned addresses

    @property
    def remaining(self) -> Decimal:
        return self.allocated_amount - self.settled_spend - self.reserved - self.held

    def to_dict(self) -> dict:
        return {
            "assignment_id": self.assignment_id,
            "agent_id": self.agent_id,
            "deposit_id": self.deposit_id,
            "allocated_amount": ds(self.allocated_amount),
            "asset": self.asset,
            "status": self.status,
            "assigned_at": self.assigned_at,
            "revoked_at": self.revoked_at,
            "frozen_reason": self.frozen_reason,
            "policy": self.policy.to_dict(),
            "accounting": {
                "reserved_amount": ds(self.reserved),
                "settled_spend": ds(self.settled_spend),
                "released_amount": ds(self.released),
                "held_amount": ds(self.held),
                "remaining": ds(self.remaining),
            },
            "holdings": {k: ds(v) for k, v in self.holdings.items()},
            "delivered": [{**d, "amount": ds(d["amount"])} for d in self.delivered],
        }


@dataclass(frozen=True)
class TradeRequest:
    request_id: str
    assignment_id: str
    agent_id: str
    action: str  # swap | withdraw | ...
    asset_in: str
    amount_in: Decimal
    asset_out: str | None = None
    destination: str | None = None  # for withdrawals
    recipient: str | None = None  # where swap output goes; None = vault custody

    def to_dict(self) -> dict:
        return {
            "request_id": self.request_id,
            "assignment_id": self.assignment_id,
            "agent_id": self.agent_id,
            "action": self.action,
            "asset_in": self.asset_in,
            "amount_in": ds(self.amount_in),
            "asset_out": self.asset_out,
            "destination": self.destination,
            "recipient": self.recipient,
        }


@dataclass
class Ticket:
    ticket_id: str
    request: TradeRequest
    amount: Decimal
    state: str = "reserved"  # reserved -> submitted -> settled | failed | held


@dataclass
class Decision:
    authorized: bool
    reason_code: str | None
    message: str
    ticket: Ticket | None = None
    event_id: str | None = None


# ---------------------------------------------------------------- policy check (pure)


def check_request(req: TradeRequest, a: Assignment, seen_request: bool) -> tuple[Reason, str] | None:
    """Return (reason, message) for the first failing rule, or None if the request is allowed.

    Pure: no state changes. The vault calls it under its lock and only then reserves.
    """
    p = a.policy
    if seen_request:
        return Reason.REPLAY_DETECTED, f"request_id {req.request_id} was already used"
    if a.status == "revoked":
        return Reason.ASSIGNMENT_REVOKED, "assignment was revoked by its owner"
    if a.status != "active" or not p.enabled:
        return Reason.ASSIGNMENT_INACTIVE, "assignment or policy is not active"
    if a.frozen_reason:
        return Reason.FAIL_CLOSED, f"assignment frozen after an unexpected execution result ({a.frozen_reason})"
    if req.agent_id != a.agent_id:
        return Reason.AGENT_MISMATCH, f"{req.agent_id} is not the agent on this assignment"
    if req.action == "withdraw" and not p.withdrawals_allowed:
        return Reason.WITHDRAWAL_NOT_ALLOWED, "withdrawals are disabled by policy"
    if req.action not in p.allowed_actions:
        return Reason.ACTION_NOT_ALLOWED, f"action '{req.action}' is not in {sorted(p.allowed_actions)}"
    if req.asset_in not in p.allowed_assets:
        return Reason.ASSET_NOT_ALLOWED, f"{req.asset_in} is not in {sorted(p.allowed_assets)}"
    if req.asset_in != a.asset:
        return Reason.ASSET_NOT_ALLOWED, f"v0.1 spends only the allocation asset ({a.asset})"
    if req.action == "swap" and (req.asset_out is None or req.asset_out == req.asset_in):
        return Reason.INVALID_REQUEST, "swap needs a different output asset"
    if req.asset_out is not None:
        if p.asset_chains:
            chain = p.chain_of(req.asset_out)  # from the frozen catalogue, never from the request
            if chain is None:
                return Reason.ASSET_NOT_ALLOWED, f"{req.asset_out} is not a known asset"
            if chain not in p.allowed_chains:
                return Reason.CHAIN_NOT_ALLOWED, f"chain '{chain}' is not in {sorted(p.allowed_chains)}"
        else:
            chain = None
        if req.asset_out not in p.allowed_assets:
            return Reason.ASSET_NOT_ALLOWED, f"{req.asset_out} is not in {sorted(p.allowed_assets)}"
        if req.recipient is not None and (chain is None or req.recipient != p.recipients.get(chain)):
            return Reason.RECIPIENT_NOT_ALLOWED, (f"output may only go to the vault or the owner's pinned "
                                                  f"{chain or 'chain'} address")
    amt = req.amount_in
    if not amt.is_finite() or amt <= 0 or amt != amt.quantize(UNIT):
        return Reason.INVALID_AMOUNT, f"amount must be > 0 with at most 6 decimals (got {amt})"
    if amt > p.max_trade_amount:
        return Reason.MAX_TRADE_EXCEEDED, f"{amt} exceeds the per-trade limit {p.max_trade_amount}"
    committed = a.settled_spend + a.reserved + a.held
    if committed + amt > p.max_total_spend:
        return Reason.TOTAL_SPEND_EXCEEDED, (f"{committed} committed + {amt} exceeds the total-spend limit "
                                             f"{p.max_total_spend}")
    if amt > a.remaining:
        return Reason.ALLOCATION_EXCEEDED, f"{amt} exceeds the remaining allocation {a.remaining}"
    return None


# ---------------------------------------------------------------- registry + vault


class ProvenanceRegistry:
    """One provenance record per deposit. Records never inherit another deposit's status."""

    def __init__(self, audit: AuditLog, clock=time.time):
        self.audit = audit
        self.clock = clock
        self.deposits: dict[str, DepositRecord] = {}
        self._lock = threading.Lock()

    def deposit(self, *, owner: str, asset: str, amount: Decimal, source_reference: str,
                verification_status: str = "stub_verified", deposit_id: str | None = None,
                phase: str | None = None) -> DepositRecord:
        if not amount.is_finite() or amount <= 0:
            raise VaultError("INVALID_AMOUNT", "deposit amount must be greater than zero")
        if verification_status not in VERIFICATION_STATES:
            raise VaultError("INVALID_VERIFICATION", f"verification status must be one of {VERIFICATION_STATES}")
        with self._lock:
            did = deposit_id or f"dep_{uuid.uuid4().hex[:10]}"
            if did in self.deposits:
                raise VaultError("DUPLICATE_DEPOSIT", f"deposit {did} already exists")
            rec = DepositRecord(deposit_id=did, owner=owner, asset=asset, amount=amount,
                                source_reference=source_reference, deposited_at=self.clock(),
                                verification_status=verification_status)
            self.deposits[did] = rec
        self.audit.emit("deposit_recorded", source="registry", deposit_id=did, asset_in=asset, amount_in=amount,
                        phase=phase, detail={"owner": owner, "verification_status": verification_status,
                                             "verification_method": rec.verification_method})
        return rec

    def allocate(self, *, caller: str, deposit_id: str, amount: Decimal) -> DepositRecord:
        """Reserve part of a deposit for an allocation (vault assignment or baseline wallet)."""
        with self._lock:
            dep = self.deposits.get(deposit_id)
            if dep is None:
                raise VaultError("UNKNOWN_DEPOSIT", f"deposit {deposit_id} does not exist")
            if caller != dep.owner:
                raise VaultError("NOT_OWNER", "only the deposit owner can allocate it")
            if dep.verification_status != "stub_verified":
                raise VaultError("DEPOSIT_NOT_ELIGIBLE", f"deposit status is '{dep.verification_status}'")
            if not amount.is_finite() or amount <= 0:
                raise VaultError("INVALID_AMOUNT", "allocation must be greater than zero")
            if amount > dep.unallocated:
                raise VaultError("OVER_ALLOCATION", f"{amount} exceeds the unallocated {dep.unallocated}")
            dep.allocated += amount
            return dep


class Vault:
    def __init__(self, registry: ProvenanceRegistry, audit: AuditLog, clock=time.time):
        self.registry = registry
        self.audit = audit
        self.clock = clock
        self.assignments: dict[str, Assignment] = {}
        self.tickets: dict[str, Ticket] = {}
        self._seen_requests: set[str] = set()
        self._lock = threading.Lock()

    # -------------------------------------------------------- owner operations

    def assign(self, *, caller: str, deposit_id: str, agent_id: str, amount: Decimal, policy: Policy,
               phase: str | None = None) -> Assignment:
        if policy.agent_id != agent_id:
            raise VaultError("POLICY_AGENT_MISMATCH", "policy is for a different agent")
        dep = self.registry.allocate(caller=caller, deposit_id=deposit_id, amount=amount)
        with self._lock:
            a = Assignment(assignment_id=f"asg_{uuid.uuid4().hex[:10]}", agent_id=agent_id, deposit_id=deposit_id,
                           allocated_amount=amount, asset=dep.asset, policy=policy, assigned_at=self.clock())
            self.assignments[a.assignment_id] = a
        self.audit.emit("agent_assigned", source="vault", agent_id=agent_id, assignment_id=a.assignment_id,
                        deposit_id=deposit_id, asset_in=dep.asset, amount_in=amount, phase=phase,
                        detail={"policy_id": policy.policy_id, "max_trade_amount": policy.max_trade_amount,
                                "max_total_spend": policy.max_total_spend})
        return a

    def revoke(self, *, caller: str, assignment_id: str, phase: str | None = None) -> Assignment:
        with self._lock:
            a = self.assignments.get(assignment_id)
            if a is None:
                raise VaultError("UNKNOWN_ASSIGNMENT", f"assignment {assignment_id} does not exist")
            owner = self.registry.deposits[a.deposit_id].owner
            if caller != owner:
                self.audit.emit("revoke_rejected", source="vault", agent_id=a.agent_id, assignment_id=assignment_id,
                                deposit_id=a.deposit_id, decision="rejected", reason_code="NOT_OWNER", phase=phase,
                                detail={"caller": caller})
                raise VaultError("NOT_OWNER", "only the owner can revoke this assignment")
            if a.status != "revoked":  # irreversible; a second revoke is a no-op
                a.status = "revoked"
                a.revoked_at = self.clock()
                self.audit.emit("agent_revoked", source="vault", agent_id=a.agent_id, assignment_id=assignment_id,
                                deposit_id=a.deposit_id, decision="revoked", phase=phase,
                                detail={"in_flight_reserved": a.reserved})
            return a

    # -------------------------------------------------------- agent requests

    def authorize(self, req: TradeRequest, *, phase: str | None = None) -> Decision:
        with self._lock:
            a = self.assignments.get(req.assignment_id)
            seen = req.request_id in self._seen_requests
            if not req.request_id:
                failure: tuple[Reason, str] | None = (Reason.INVALID_REQUEST, "request_id is required")
            elif a is None:
                failure = (Reason.UNKNOWN_ASSIGNMENT, f"assignment {req.assignment_id} does not exist")
            else:
                failure = check_request(req, a, seen)
            if req.request_id:
                self._seen_requests.add(req.request_id)  # the nonce is spent whatever the outcome
            ticket = None
            if failure is None:
                assert a is not None
                a.reserved += req.amount_in
                ticket = Ticket(ticket_id=f"tkt_{uuid.uuid4().hex[:10]}", request=req, amount=req.amount_in)
                self.tickets[ticket.ticket_id] = ticket

        common = dict(source="vault", agent_id=req.agent_id, assignment_id=req.assignment_id,
                      deposit_id=a.deposit_id if a else None, request_id=req.request_id, action=req.action,
                      asset_in=req.asset_in, amount_in=req.amount_in, asset_out=req.asset_out,
                      recipient=req.recipient, phase=phase)
        if failure:
            reason, message = failure
            etype = "post_revoke_attempt_rejected" if reason == Reason.ASSIGNMENT_REVOKED else "trade_rejected"
            ev = self.audit.emit(etype, decision="rejected", reason_code=reason.value, detail={"message": message},
                                 **common)
            return Decision(False, reason.value, message, event_id=ev["event_id"])
        assert ticket is not None
        ev = self.audit.emit("trade_authorized", decision="authorized", reason_code=None,
                             detail={"ticket_id": ticket.ticket_id, "reserved": ticket.amount}, **common)
        return Decision(True, None, "authorized; capacity reserved", ticket=ticket, event_id=ev["event_id"])

    # -------------------------------------------------------- adapter callbacks

    def begin_execution(self, ticket_id: str) -> Ticket:
        """Single-use redemption by the execution adapter: reserved -> submitted."""
        with self._lock:
            t = self.tickets.get(ticket_id)
            if t is None:
                raise VaultError("UNKNOWN_TICKET", "ticket was not issued by this vault")
            if t.state != "reserved":
                raise VaultError("TICKET_USED", f"ticket is already {t.state}")
            t.state = "submitted"
            return t

    def settle(self, ticket_id: str, *, spent: Decimal, received_asset: str | None, received_amount: Decimal,
               execution_reference: str | None, phase: str | None = None) -> tuple[str, str | None]:
        """Reconcile a submitted ticket. Returns (state, reason). Unexpected results fail closed."""
        with self._lock:
            t = self.tickets[ticket_id]
            a = self.assignments[t.request.assignment_id]
            problem = None
            if t.state != "submitted":
                problem = f"settle on a {t.state} ticket"
            elif not (spent.is_finite() and 0 < spent <= t.amount):
                problem = f"spent {spent} is outside (0, {t.amount}]"
            elif not received_amount.is_finite() or received_amount < 0:
                problem = f"received amount {received_amount} is invalid"
            elif received_asset != t.request.asset_out:
                problem = f"received {received_asset}, expected {t.request.asset_out}"
            if problem:
                if t.state == "submitted":
                    # Outcome unknown: keep the capacity committed and stop new authorizations.
                    a.reserved -= t.amount
                    a.held += t.amount
                    t.state = "held"
                a.frozen_reason = problem
            else:
                a.reserved -= t.amount
                a.settled_spend += spent
                a.released += t.amount - spent
                if t.request.recipient:  # pinned owner address on the destination chain
                    a.delivered.append({"asset": received_asset, "amount": received_amount,
                                        "recipient": t.request.recipient, "chain": a.policy.chain_of(received_asset),
                                        "request_id": t.request.request_id})
                else:  # stays in vault custody
                    a.holdings[received_asset] = a.holdings.get(received_asset, Decimal(0)) + received_amount  # type: ignore[index]
                t.state = "settled"
        req = t.request
        if problem:
            self.audit.emit("assignment_frozen", source="vault", agent_id=req.agent_id,
                            assignment_id=req.assignment_id, deposit_id=a.deposit_id, request_id=req.request_id,
                            decision="fail_closed", reason_code="UNEXPECTED_EXECUTION_RESULT",
                            execution_reference=execution_reference, phase=phase, detail={"problem": problem})
            return "held", problem
        return "settled", None

    def fail(self, ticket_id: str, reason: str) -> None:
        """Execution failed before anything was spent: release the whole reservation."""
        with self._lock:
            t = self.tickets[ticket_id]
            if t.state not in ("reserved", "submitted"):
                return
            a = self.assignments[t.request.assignment_id]
            a.reserved -= t.amount
            a.released += t.amount
            t.state = "failed"

    # -------------------------------------------------------- views

    def view(self, assignment_id: str) -> dict:
        with self._lock:
            return self.assignments[assignment_id].to_dict()

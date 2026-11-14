"""Structured audit trail (Nixo_agents.md §10).

Events come from three sources: the agent runner (proposals), the vault
(authorization decisions, assignments, revocations) and the execution adapter
(submission and settlement). `evidence` is always "service_log": these are
records kept by the agents service, not on-chain events.
"""

import threading
import time
from decimal import Decimal

EVENT_TYPES = (
    "deposit_recorded",
    "agent_assigned",
    "trade_proposed",
    "trade_authorized",
    "trade_rejected",
    "trade_submitted",
    "trade_settled",
    "trade_failed",
    "trade_held",
    "agent_revoked",
    "revoke_rejected",
    "post_revoke_attempt_rejected",
    "assignment_frozen",
)


def _s(v):
    return format(v, "f") if isinstance(v, Decimal) else v


class AuditLog:
    def __init__(self, run_id: str, clock=time.time):
        self.run_id = run_id
        self.events: list[dict] = []
        self._clock = clock
        self._lock = threading.Lock()

    def emit(self, event_type: str, *, source: str, agent_id: str | None = None, assignment_id: str | None = None,
             deposit_id: str | None = None, request_id: str | None = None, action: str | None = None,
             asset_in: str | None = None, amount_in: Decimal | None = None, asset_out: str | None = None,
             amount_out: Decimal | None = None, recipient: str | None = None,
             decision: str | None = None, reason_code: str | None = None,
             execution_reference: str | None = None, phase: str | None = None, detail: dict | None = None) -> dict:
        assert event_type in EVENT_TYPES, event_type
        with self._lock:
            event = {
                "event_id": f"evt_{len(self.events) + 1:04d}",
                "run_id": self.run_id,
                "agent_id": agent_id,
                "assignment_id": assignment_id,
                "deposit_id": deposit_id,
                "event_type": event_type,
                "request_id": request_id,
                "action": action,
                "asset_in": asset_in,
                "amount_in": _s(amount_in),
                "asset_out": asset_out,
                "amount_out": _s(amount_out),
                "recipient": recipient,
                "decision": decision,
                "reason_code": reason_code,
                "timestamp": self._clock(),
                "execution_reference": execution_reference,
                "source": source,
                "phase": phase,
                "evidence": "service_log",
                "detail": {k: _s(v) for k, v in (detail or {}).items()} or None,
            }
            self.events.append(event)
            return event

    def for_request(self, request_id: str) -> list[str]:
        return [e["event_id"] for e in self.events if e["request_id"] == request_id]

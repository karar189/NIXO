"""Multi-provider LLM client for structured (JSON) answers.

Providers: Anthropic (Claude), OpenAI, DeepSeek, NVIDIA NIM and NEAR AI Cloud.
All but Anthropic speak the OpenAI chat-completions protocol, so they share
one httpx code path and differ only in how JSON output is requested:

- openai:   strict `json_schema` response format
- deepseek: `json_object` response format + schema in the prompt
- nvidia / nearai: schema in the prompt, JSON extracted from the reply

`structured()` is the single entry point. With `preferred="auto"` it walks
LLM_PROVIDER_ORDER and falls through on any failure; with a named provider it
tries that one first (optionally with a model override) and then the rest.
Providers that fail on auth or quota are skipped by "auto" for a cool-down.
Every attempt is returned so callers can show what happened.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import anthropic
import httpx

from app.config import settings

log = logging.getLogger(__name__)

ProviderName = Literal["anthropic", "openai", "deepseek", "nvidia", "nearai"]
PROVIDERS: tuple[ProviderName, ...] = ("anthropic", "openai", "deepseek", "nvidia", "nearai")
ALIASES = {"claude": "anthropic", "nim": "nvidia", "near": "nearai", "near_ai": "nearai"}
LABELS = {
    "anthropic": "Claude (Anthropic)",
    "openai": "OpenAI",
    "deepseek": "DeepSeek",
    "nvidia": "NVIDIA NIM",
    "nearai": "NEAR AI Cloud",
}
MODEL_RE = re.compile(r"^[A-Za-z0-9._:/@-]{1,128}$")

ErrorKind = Literal["auth", "quota", "rate_limit", "model_not_found", "bad_request", "unavailable",
                    "timeout", "refusal", "bad_output", "not_configured"]
COOLDOWN_KINDS = {"auth", "quota", "not_configured"}


class LLMError(Exception):
    def __init__(self, provider: str, model: str | None, kind: ErrorKind, message: str):
        super().__init__(message)
        self.provider, self.model, self.kind, self.message = provider, model, kind, message


class LLMUnavailable(Exception):
    """Every provider tried failed (or none is configured)."""

    def __init__(self, attempts: list[dict]):
        self.attempts = attempts
        if attempts:
            summary = "; ".join(f"{a['provider']}: {a['error']}" for a in attempts)
        else:
            summary = "no LLM provider is configured"
        super().__init__(summary)


@dataclass
class LLMResult:
    data: dict
    provider: str
    model: str
    latency_ms: int
    attempts: list[dict] = field(default_factory=list)


@dataclass(frozen=True)
class ProviderConfig:
    name: str
    label: str
    base_url: str | None
    api_key: str | None
    default_model: str
    json_mode: Literal["anthropic", "json_schema", "json_object", "prompt"]

    @property
    def configured(self) -> bool:
        if self.name == "anthropic":
            return _anthropic_configured()
        return bool(self.api_key)


def normalize(name: str | None) -> str:
    n = (name or "auto").strip().lower()
    return ALIASES.get(n, n)


def _anthropic_configured() -> bool:
    if settings.anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        return True
    return (Path.home() / ".config" / "anthropic").exists()


def provider_config(name: str) -> ProviderConfig:
    s = settings
    match normalize(name):
        case "anthropic":
            return ProviderConfig("anthropic", LABELS["anthropic"], None, s.anthropic_api_key, s.anthropic_model, "anthropic")
        case "openai":
            return ProviderConfig("openai", LABELS["openai"], s.openai_base_url, s.openai_api_key, s.openai_model, "json_schema")
        case "deepseek":
            return ProviderConfig("deepseek", LABELS["deepseek"], s.deepseek_base_url, s.deepseek_api_key, s.deepseek_model, "json_object")
        case "nvidia":
            return ProviderConfig("nvidia", LABELS["nvidia"], s.nvidia_api_base, s.nvidia_api_key, s.nvidia_model, "prompt")
        case "nearai":
            return ProviderConfig("nearai", LABELS["nearai"], s.nearai_base_url, s.nearai_api_key, s.nearai_model, "prompt")
    raise ValueError(f"Unknown LLM provider '{name}'. Choose one of: {', '.join(PROVIDERS)}")


def provider_order() -> list[str]:
    order = [normalize(p) for p in settings.llm_provider_order.split(",") if p.strip()]
    order = [p for p in order if p in PROVIDERS]
    # Anything left out of the configured order still gets a turn, last.
    return list(dict.fromkeys(order + list(PROVIDERS)))


def configured_providers() -> list[str]:
    return [p for p in provider_order() if provider_config(p).configured]


def any_available() -> bool:
    return bool(configured_providers())


# ---------------------------------------------------------------- cool-down

_cooldown: dict[str, tuple[float, str]] = {}


def _cool(provider: str, reason: str) -> None:
    _cooldown[provider] = (time.monotonic() + settings.llm_cooldown_seconds, reason)


def cooling_down(provider: str) -> str | None:
    entry = _cooldown.get(provider)
    if entry and entry[0] > time.monotonic():
        return entry[1]
    _cooldown.pop(provider, None)
    return None


def reset_cooldowns() -> None:
    _cooldown.clear()


def status() -> list[dict]:
    out = []
    for name in provider_order():
        cfg = provider_config(name)
        out.append({
            "name": name,
            "label": cfg.label,
            "configured": cfg.configured,
            "default_model": cfg.default_model,
            "cooldown": cooling_down(name),
        })
    return out


# ---------------------------------------------------------------- JSON helpers

_THINK_RE = re.compile(r"<think>.*?</think>", re.S | re.I)


def extract_json(text: str) -> dict:
    """Pull the first JSON object out of a model reply (tolerates fences, <think> blocks, prose)."""
    cleaned = _THINK_RE.sub("", text).strip()
    try:
        value = json.loads(cleaned)
        if isinstance(value, dict):
            return value
    except ValueError:
        pass
    decoder = json.JSONDecoder()
    for i, ch in enumerate(cleaned):
        if ch != "{":
            continue
        try:
            value, _ = decoder.raw_decode(cleaned[i:])
        except ValueError:
            continue
        if isinstance(value, dict):
            return value
    raise ValueError("no JSON object in the reply")


_TYPES = {"string": str, "boolean": bool, "object": dict, "array": list}


def validate(data: dict, schema: dict) -> dict:
    """Light top-level check: required keys, basic types, enums. Coerces numeric strings."""
    if not isinstance(data, dict):
        raise ValueError("reply is not a JSON object")
    props = schema.get("properties", {})
    for key in schema.get("required", []):
        if key not in data:
            raise ValueError(f"missing field '{key}'")
    out = {}
    for key, spec in props.items():
        if key not in data:
            continue
        value = data[key]
        typ = spec.get("type")
        if isinstance(typ, list):  # nullable, e.g. ["number", "null"]
            if value is None and "null" in typ:
                out[key] = None
                continue
            typ = next((t for t in typ if t != "null"), None)
        if typ in ("number", "integer"):
            if isinstance(value, str):
                try:
                    value = float(value)
                except ValueError as err:
                    raise ValueError(f"field '{key}' is not a number") from err
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError(f"field '{key}' is not a number")
            if typ == "integer":
                value = int(round(value))
        elif typ in _TYPES and not isinstance(value, _TYPES[typ]):
            raise ValueError(f"field '{key}' should be {typ}")
        if "enum" in spec and value not in spec["enum"]:
            raise ValueError(f"field '{key}'={value!r} is not one of {spec['enum']}")
        out[key] = value
    return out


def _schema_instruction(schema: dict) -> str:
    return (
        "\n\nRespond with ONE JSON object and nothing else (no prose, no code fences). "
        "It must match this JSON Schema:\n" + json.dumps(schema)
    )


# ---------------------------------------------------------------- Anthropic

_anthropic_client: anthropic.AsyncAnthropic | None = None


def _anthropic() -> anthropic.AsyncAnthropic:
    global _anthropic_client
    if _anthropic_client is None:
        kwargs: dict = {"timeout": settings.llm_timeout_seconds}
        if settings.anthropic_api_key:
            kwargs["api_key"] = settings.anthropic_api_key
        _anthropic_client = anthropic.AsyncAnthropic(**kwargs)
    return _anthropic_client


async def _call_anthropic(model: str, prompt: str, system: str | None, schema: dict, max_tokens: int,
                          timeout: float) -> dict:
    kwargs: dict = {}
    if system:
        kwargs["system"] = system
    try:
        response = await _anthropic().beta.messages.create(
            model=model,
            max_tokens=max_tokens,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
            messages=[{"role": "user", "content": prompt}],
            timeout=timeout,
            **kwargs,
        )
    except anthropic.AuthenticationError as err:
        raise LLMError("anthropic", model, "auth", "credentials rejected") from err
    except anthropic.PermissionDeniedError as err:
        raise LLMError("anthropic", model, "auth", "permission denied") from err
    except anthropic.RateLimitError as err:
        raise LLMError("anthropic", model, "rate_limit", "rate limited") from err
    except anthropic.NotFoundError as err:
        raise LLMError("anthropic", model, "model_not_found", f"model '{model}' not found") from err
    except anthropic.BadRequestError as err:
        msg = str(err)
        kind: ErrorKind = "quota" if "credit" in msg.lower() else "bad_request"
        raise LLMError("anthropic", model, kind, f"bad request: {msg[:200]}") from err
    except anthropic.APITimeoutError as err:
        raise LLMError("anthropic", model, "timeout", "timed out") from err
    except anthropic.APIStatusError as err:
        raise LLMError("anthropic", model, "unavailable", f"API error {err.status_code}") from err
    except anthropic.APIConnectionError as err:
        raise LLMError("anthropic", model, "unavailable", "couldn't connect") from err

    if response.stop_reason == "refusal":
        category = response.stop_details.category if response.stop_details else None
        raise LLMError("anthropic", model, "refusal", f"declined ({category or 'no category'})")
    if response.stop_reason == "max_tokens":
        raise LLMError("anthropic", model, "bad_output", "answer was cut off")
    text = next((b.text for b in response.content if b.type == "text"), None)
    if text is None:
        raise LLMError("anthropic", model, "bad_output", "no text in the reply")
    try:
        return json.loads(text)
    except ValueError as err:
        raise LLMError("anthropic", model, "bad_output", "reply was not JSON") from err


# ---------------------------------------------------------------- OpenAI-compatible

_http_clients: dict[str, httpx.AsyncClient] = {}


def _http(cfg: ProviderConfig) -> httpx.AsyncClient:
    client = _http_clients.get(cfg.name)
    if client is None:
        client = httpx.AsyncClient(
            base_url=(cfg.base_url or "").rstrip("/"),
            headers={"Authorization": f"Bearer {cfg.api_key}", "Content-Type": "application/json"},
            timeout=settings.llm_timeout_seconds,
        )
        _http_clients[cfg.name] = client
    return client


def _error_from_response(cfg: ProviderConfig, model: str, res: httpx.Response) -> LLMError:
    try:
        body = res.json()
    except ValueError:
        body = {}
    err = body.get("error") if isinstance(body, dict) else None
    if isinstance(err, dict):
        message = str(err.get("message") or err.get("code") or "")
        code = str(err.get("code") or err.get("type") or "")
    else:
        message = str(err or (body.get("detail") if isinstance(body, dict) else "") or res.text[:200])
        code = ""
    low = f"{message} {code}".lower()
    sc = res.status_code
    if sc in (401, 403):
        kind: ErrorKind = "auth"
    elif sc == 402 or "insufficient_quota" in low or "credit" in low or "balance" in low:
        kind = "quota"
    elif sc == 429:
        kind = "rate_limit"
    elif sc == 404 or "model_not_found" in low or "does not exist" in low:
        kind = "model_not_found"
    elif 400 <= sc < 500:
        kind = "bad_request"
    else:
        kind = "unavailable"
    return LLMError(cfg.name, model, kind, f"HTTP {sc}: {message[:200] or 'error'}")


async def _call_openai_compat(cfg: ProviderConfig, model: str, prompt: str, system: str | None, schema: dict,
                              max_tokens: int, timeout: float, name: str) -> dict:
    user = prompt if cfg.json_mode == "json_schema" else prompt + _schema_instruction(schema)
    messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": user}]
    body: dict = {"model": model, "messages": messages}
    if cfg.json_mode == "json_schema":
        body["response_format"] = {"type": "json_schema", "json_schema": {"name": name, "schema": schema, "strict": True}}
        body["max_completion_tokens"] = max_tokens
        if model.startswith(("gpt-5", "o3", "o4")):
            body["reasoning_effort"] = "low"
    else:
        body["max_tokens"] = max_tokens
        body["temperature"] = 0.2
        if cfg.json_mode == "json_object":
            body["response_format"] = {"type": "json_object"}

    try:
        res = await _http(cfg).post("/chat/completions", json=body, timeout=timeout)
    except httpx.TimeoutException as err:
        raise LLMError(cfg.name, model, "timeout", "timed out") from err
    except httpx.HTTPError as err:
        raise LLMError(cfg.name, model, "unavailable", f"couldn't connect ({type(err).__name__})") from err
    if res.status_code >= 400:
        raise _error_from_response(cfg, model, res)
    try:
        choice = res.json()["choices"][0]
        content = choice["message"].get("content") or ""
    except (ValueError, KeyError, IndexError, TypeError) as err:
        raise LLMError(cfg.name, model, "bad_output", "unexpected response shape") from err
    if choice.get("finish_reason") == "length" and not content.strip().endswith("}"):
        raise LLMError(cfg.name, model, "bad_output", "answer was cut off")
    if choice.get("finish_reason") == "content_filter":
        raise LLMError(cfg.name, model, "refusal", "content filtered")
    try:
        return extract_json(content)
    except ValueError as err:
        raise LLMError(cfg.name, model, "bad_output", str(err)) from err


# ---------------------------------------------------------------- entry points


async def call_provider(provider: str, *, prompt: str, schema: dict, max_tokens: int = 2000,
                        model: str | None = None, system: str | None = None, timeout: float | None = None,
                        name: str = "response") -> LLMResult:
    """One attempt on one provider. Raises LLMError."""
    cfg = provider_config(provider)
    use_model = model or cfg.default_model
    if model is not None and not MODEL_RE.match(model):
        raise LLMError(cfg.name, model, "bad_request", "invalid model id")
    if not cfg.configured:
        raise LLMError(cfg.name, use_model, "not_configured", "no API key configured")
    t = min(timeout or settings.llm_timeout_seconds, settings.llm_timeout_seconds)
    started = time.monotonic()
    if cfg.json_mode == "anthropic":
        raw = await _call_anthropic(use_model, prompt, system, schema, max_tokens, t)
    else:
        raw = await _call_openai_compat(cfg, use_model, prompt, system, schema, max_tokens, t, name)
    try:
        data = validate(raw, schema)
    except ValueError as err:
        raise LLMError(cfg.name, use_model, "bad_output", str(err)) from err
    return LLMResult(data=data, provider=cfg.name, model=use_model, latency_ms=int((time.monotonic() - started) * 1000))


def plan_attempts(preferred: str | None, fallback: bool = True) -> list[str]:
    pref = normalize(preferred)
    if pref == "auto":
        return [p for p in configured_providers() if not cooling_down(p)]
    if pref not in PROVIDERS:
        raise ValueError(f"Unknown LLM provider '{preferred}'")
    rest = [p for p in configured_providers() if p != pref and not cooling_down(p)] if fallback else []
    return [pref] + rest


async def structured(prompt: str, schema: dict, *, max_tokens: int = 2000, preferred: str | None = "auto",
                     model: str | None = None, system: str | None = None, fallback: bool = True,
                     name: str = "response") -> LLMResult:
    """Get a JSON object matching `schema`, walking the provider chain. Raises LLMUnavailable."""
    attempts: list[dict] = []
    deadline = time.monotonic() + settings.llm_auto_budget_seconds
    pref = normalize(preferred)
    for provider in plan_attempts(preferred, fallback):
        remaining = deadline - time.monotonic()
        if remaining < 3:
            attempts.append({"provider": provider, "model": None, "error": "skipped: time budget used up", "kind": "timeout"})
            break
        use_model = model if provider == pref else None
        try:
            result = await call_provider(provider, prompt=prompt, schema=schema, max_tokens=max_tokens,
                                         model=use_model, system=system, timeout=remaining, name=name)
        except LLMError as err:
            log.warning("LLM %s/%s failed: %s (%s)", err.provider, err.model, err.message, err.kind)
            attempts.append({"provider": err.provider, "model": err.model, "error": err.message, "kind": err.kind})
            if err.kind in COOLDOWN_KINDS or (err.kind == "model_not_found" and use_model is None):
                _cool(provider, f"{err.kind}: {err.message}")
            continue
        result.attempts = attempts + [{"provider": result.provider, "model": result.model, "error": None,
                                       "kind": "ok", "latency_ms": result.latency_ms}]
        return result
    raise LLMUnavailable(attempts)


# ---------------------------------------------------------------- model catalog

_models_cache: dict[str, tuple[float, list[str]]] = {}
_NON_CHAT = re.compile(r"embed|rerank|safety|guard|reward|parse|tts|whisper|transcribe|dall-e|image|audio|"
                       r"moderation|realtime|search|clip|ocr|vila|neva|kosmos|deplot|fuyu|riva|calibration", re.I)


async def list_models(provider: str) -> list[str]:
    """Chat-capable model ids from the provider's catalog (cached 10 min)."""
    cfg = provider_config(provider)
    if not cfg.configured:
        raise LLMError(cfg.name, None, "not_configured", "no API key configured")
    cached = _models_cache.get(cfg.name)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    try:
        if cfg.name == "anthropic":
            page = await _anthropic().models.list(limit=100)
            ids = [m.id for m in page.data]
        else:
            res = await _http(cfg).get("/models", timeout=20)
            if res.status_code >= 400:
                raise _error_from_response(cfg, "-", res)
            ids = sorted(m["id"] for m in res.json().get("data", []) if isinstance(m, dict) and "id" in m)
    except anthropic.APIError as err:
        raise LLMError(cfg.name, None, "unavailable", str(err)[:200]) from err
    except httpx.HTTPError as err:
        raise LLMError(cfg.name, None, "unavailable", f"couldn't connect ({type(err).__name__})") from err
    ids = [i for i in ids if not _NON_CHAT.search(i)]
    if cfg.default_model not in ids:
        ids.insert(0, cfg.default_model)
    _models_cache[cfg.name] = (time.monotonic() + 600, ids)
    return ids


async def ping(provider: str, model: str | None = None) -> dict:
    """Tiny structured call used by the UI's "Test" button."""
    schema = {
        "type": "object",
        "properties": {"ok": {"type": "boolean"}, "answer": {"type": "integer"}},
        "required": ["ok", "answer"],
        "additionalProperties": False,
    }
    try:
        r = await call_provider(provider, prompt="Health check. Set ok=true and answer=2+2.", schema=schema,
                                max_tokens=2000, model=model, timeout=45, name="ping")
    except LLMError as err:
        if err.kind in COOLDOWN_KINDS:
            _cool(err.provider, f"{err.kind}: {err.message}")
        return {"provider": err.provider, "model": err.model, "ok": False, "kind": err.kind, "error": err.message}
    _cooldown.pop(r.provider, None)  # a working provider rejoins "auto" right away
    return {"provider": r.provider, "model": r.model, "ok": r.data.get("answer") == 4, "latency_ms": r.latency_ms,
            "reply": r.data}


def attempt_note(attempts: list[dict]) -> str | None:
    failed = [a for a in attempts if a.get("error")]
    if not failed:
        return None
    return "Fell back past " + "; ".join(f"{LABELS.get(a['provider'], a['provider'])} ({a['error']})" for a in failed)


__all__ = [
    "LLMError", "LLMUnavailable", "LLMResult", "PROVIDERS", "LABELS", "any_available", "attempt_note",
    "call_provider", "configured_providers", "extract_json", "list_models", "normalize", "ping",
    "provider_config", "provider_order", "status", "structured", "validate",
]

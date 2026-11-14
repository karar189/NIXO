"""Provider layer: JSON extraction, validation and the auto fallback chain (HTTP mocked)."""

import asyncio

import httpx
import pytest

from app import llm
from app.config import settings

SCHEMA = {
    "type": "object",
    "properties": {"action": {"type": "string", "enum": ["KEEP", "CLOSE"]}, "n": {"type": "integer"}},
    "required": ["action", "n"],
    "additionalProperties": False,
}


def test_extract_json_variants():
    assert llm.extract_json('{"a": 1}') == {"a": 1}
    assert llm.extract_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert llm.extract_json('<think>{"no": 0} hmm</think>Sure: {"a": 2} done') == {"a": 2}
    with pytest.raises(ValueError):
        llm.extract_json("no json here")


def test_validate_coerces_and_checks():
    assert llm.validate({"action": "KEEP", "n": "3"}, SCHEMA) == {"action": "KEEP", "n": 3}
    with pytest.raises(ValueError):
        llm.validate({"action": "MAYBE", "n": 1}, SCHEMA)
    with pytest.raises(ValueError):
        llm.validate({"action": "KEEP"}, SCHEMA)


@pytest.fixture
def providers(monkeypatch):
    """Only OpenAI-compatible providers configured; Anthropic off."""
    monkeypatch.setattr(settings, "anthropic_api_key", None)
    monkeypatch.setattr(llm, "_anthropic_configured", lambda: False)
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")
    monkeypatch.setattr(settings, "deepseek_api_key", "ds-test")
    monkeypatch.setattr(settings, "nvidia_api_key", "nv-test")
    monkeypatch.setattr(settings, "nearai_api_key", None)
    monkeypatch.setattr(settings, "llm_provider_order", "anthropic,openai,deepseek,nvidia,nearai")
    llm.reset_cooldowns()
    llm._http_clients.clear()
    calls: list[str] = []

    def install(handler):
        def wrapped(request: httpx.Request):
            calls.append(request.url.host)
            return handler(request)

        for name in ("openai", "deepseek", "nvidia"):
            cfg = llm.provider_config(name)
            llm._http_clients[name] = httpx.AsyncClient(base_url=cfg.base_url, transport=httpx.MockTransport(wrapped))

    yield install, calls
    llm._http_clients.clear()
    llm.reset_cooldowns()


def _ok(content: str) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": content}, "finish_reason": "stop"}]})


def test_auto_falls_through_quota_and_cools_down(providers):
    install, calls = providers

    def handler(req: httpx.Request):
        if req.url.host == "api.openai.com":
            return httpx.Response(429, json={"error": {"message": "You have no credits", "code": "insufficient_quota"}})
        return _ok('Here you go: {"action": "CLOSE", "n": 2}')

    install(handler)
    r = asyncio.run(llm.structured("decide", SCHEMA))
    assert r.provider == "deepseek" and r.data == {"action": "CLOSE", "n": 2}
    assert r.attempts[0]["provider"] == "openai" and r.attempts[0]["kind"] == "quota"
    assert llm.cooling_down("openai")
    # Second call skips OpenAI entirely.
    calls.clear()
    asyncio.run(llm.structured("decide", SCHEMA))
    assert "api.openai.com" not in calls


def test_preferred_provider_and_model_override(providers):
    install, _ = providers
    seen = {}

    def handler(req: httpx.Request):
        import json

        seen["body"] = json.loads(req.content)
        return _ok('{"action": "KEEP", "n": 1}')

    install(handler)
    r = asyncio.run(llm.structured("decide", SCHEMA, preferred="nvidia", model="openai/gpt-oss-20b"))
    assert r.provider == "nvidia" and r.model == "openai/gpt-oss-20b"
    assert seen["body"]["model"] == "openai/gpt-oss-20b"
    assert "JSON Schema" in seen["body"]["messages"][-1]["content"]


def test_all_fail_raises_unavailable(providers):
    install, _ = providers
    install(lambda req: httpx.Response(500, json={"error": {"message": "boom"}}))
    with pytest.raises(llm.LLMUnavailable) as e:
        asyncio.run(llm.structured("decide", SCHEMA))
    assert [a["provider"] for a in e.value.attempts] == ["openai", "deepseek", "nvidia"]


def test_bad_output_falls_through(providers):
    install, _ = providers

    def handler(req):
        if req.url.host == "api.openai.com":
            return _ok('{"action": "PANIC", "n": 1}')
        return _ok('{"action": "KEEP", "n": 1}')

    install(handler)
    r = asyncio.run(llm.structured("decide", SCHEMA))
    assert r.provider == "deepseek" and r.attempts[0]["kind"] == "bad_output"

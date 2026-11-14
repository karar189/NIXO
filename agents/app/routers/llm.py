"""LLM provider status, model catalogs and a health-check ping."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app import llm

router = APIRouter(prefix="/llm", tags=["llm"])


class PingBody(BaseModel):
    provider: str
    model: str | None = Field(None, max_length=128)


def _provider(name: str) -> str:
    n = llm.normalize(name)
    if n not in llm.PROVIDERS:
        raise HTTPException(404, f"Unknown provider '{name}'. Choose one of: {', '.join(llm.PROVIDERS)}")
    return n


@router.get("/providers")
def providers() -> dict:
    return {"order": llm.provider_order(), "providers": llm.status()}


@router.get("/models/{provider}")
async def models(provider: str) -> dict:
    name = _provider(provider)
    try:
        ids = await llm.list_models(name)
    except llm.LLMError as err:
        raise HTTPException(503 if err.kind == "not_configured" else 502, f"{err.provider}: {err.message}") from err
    return {"provider": name, "default_model": llm.provider_config(name).default_model, "models": ids}


@router.post("/ping")
async def ping(body: PingBody) -> dict:
    return await llm.ping(_provider(body.provider), body.model)

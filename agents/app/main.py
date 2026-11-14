import hmac
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.routers import copytrade, health, intents, llm, nixo, trading

logging.basicConfig(level=logging.INFO)

app = FastAPI(title=settings.app_name)

_OPEN_PATHS = {"/health"}


@app.middleware("http")
async def require_agents_token(request: Request, call_next):
    expected = settings.agents_api_token
    if expected is None or request.method == "OPTIONS" or request.url.path in _OPEN_PATHS:
        return await call_next(request)
    got = request.headers.get("x-agents-token", "")
    if not hmac.compare_digest(got.encode(), expected.get_secret_value().encode()):
        return JSONResponse({"detail": "Missing or invalid X-Agents-Token."}, status_code=401)
    return await call_next(request)


# Added after the token check so it runs first: CORS headers also go on 401s.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(trading.router)
app.include_router(intents.router)
app.include_router(llm.router)
app.include_router(nixo.router)
app.include_router(copytrade.router)

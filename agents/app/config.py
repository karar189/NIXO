from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # The repo-root .env is shared by all services; a local agents/.env overrides it.
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    app_name: str = "neararc-agents"
    # AGENTS_PORT (was PORT): renamed so it doesn't clash with the backend in the shared .env.
    port: int = Field(8000, validation_alias="AGENTS_PORT")
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:4000"]

    # Market data. The public data mirror is reachable where api.binance.com is not.
    binance_urls: list[str] = [
        "https://data-api.binance.vision",
        "https://api.binance.com",
    ]
    http_timeout_seconds: float = 6.0

    # NEAR Intents 1Click API. A JWT is optional; without it 1Click adds a fee.
    oneclick_url: str = "https://1click.chaindefuser.com"
    oneclick_jwt: str | None = None
    # Recipient used on dry-run (paper) quotes. Dry quotes never move funds.
    paper_quote_account: str = "intents.near"

    # LLM planner. With no ANTHROPIC_API_KEY the rule-based planner is used.
    anthropic_model: str = "claude-opus-5-5"
    llm_timeout_seconds: float = 90.0


settings = Settings()

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # The repo-root .env is shared by all services; a local agents/.env overrides it.
    # env_ignore_empty: an exported-but-empty variable (e.g. KEY= left over from an
    # older .env that scripts/dev.sh exported) must not mask the value in .env.
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore", env_ignore_empty=True)

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

    # NEAR Intents 1Click API. JWT optional for public quotes (1Click may add a fee).
    # Required for confidentiality basic/advanced (Confidential Intents).
    oneclick_url: str = "https://1click.chaindefuser.com"
    oneclick_jwt: str | None = None
    # Recipient used on dry-run (paper) quotes. Dry quotes never move funds.
    paper_quote_account: str = "intents.near"

    # ------------------------------------------------------------ LLM providers
    # Each provider is enabled when its key is set. With none, the rule-based
    # planner is used. Keys are read from the root .env into these fields and
    # passed to clients explicitly, so `uvicorn` works without `pnpm dev`.
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-opus-5-5"

    openai_api_key: str | None = None
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-5.4-mini"

    deepseek_api_key: str | None = None
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-flash"

    # NVIDIA NIM (build.nvidia.com): OpenAI-compatible, many hosted models.
    nvidia_api_key: str | None = None
    nvidia_api_base: str = "https://integrate.api.nvidia.com/v1"
    nvidia_model: str = "mistralai/mistral-large-4-1t-a52b"

    # NEAR AI Cloud: OpenAI-compatible.
    nearai_api_key: str | None = None
    nearai_base_url: str = "https://cloud-api.near.ai/v1"
    nearai_model: str = "deepseek-ai/DeepSeek-V3.1"

    # "auto" tries providers in this order and falls through on failure.
    llm_provider_order: str = "anthropic,openai,deepseek,nvidia,nearai"
    llm_timeout_seconds: float = 90.0
    # Upper bound for one "auto" call across all fallbacks (the web proxy waits 100 s).
    llm_auto_budget_seconds: float = 85.0
    # After an auth/quota failure a provider is skipped by "auto" for this long.
    llm_cooldown_seconds: float = 600.0

    # Layer 2 on-chain vault (native NEAR). When set, /nixo/onchain reports on-chain mode.
    nixo_vault_contract: str | None = Field(None, validation_alias="NIXO_VAULT_CONTRACT")
    nixo_contract: str = Field("nixo.testnet", validation_alias="NIXO_CONTRACT")
    near_rpc: str = Field("https://test.rpc.fastnear.com", validation_alias="NEAR_RPC")
    # Delayed viewing-key default delay (seconds) before redeemable.
    viewing_key_delay_seconds: float = Field(60.0, validation_alias="NIXO_VIEWING_KEY_DELAY")

    # Copy trading (paid viewing keys). Contract: copykeys/ deployed e.g. to nixo-keys.testnet.
    # Unset: listings/subscriptions are unavailable and only demo traders show.
    nixo_keys_contract: str | None = Field(None, validation_alias="NIXO_KEYS_CONTRACT")
    # Feed data keys rotate every epoch; a subscriber gets keys only for epochs in their window.
    copy_epoch_secs: float = Field(3600.0, ge=10, validation_alias="NIXO_COPY_EPOCH_SECS")
    # Seals feed data keys on disk so a restart keeps the feed readable. Unset: memory only.
    copy_master_key: str | None = Field(None, validation_alias="NIXO_COPY_MASTER_KEY")
    copy_store_dir: str | None = Field(None, validation_alias="NIXO_COPY_STORE")
    # Seed labelled demo traders (simulated history) so the leaderboard is never empty.
    copy_demo: bool = Field(True, validation_alias="NIXO_COPY_DEMO")


settings = Settings()

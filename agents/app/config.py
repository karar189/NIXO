from pydantic import Field, SecretStr
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
    # Shared secret the web proxy sends as X-Agents-Token. When set, every route
    # except /health requires it, so a public deployment can't be called directly
    # (the LLM routes spend billed provider credits). Unset: open, for local dev.
    agents_api_token: SecretStr | None = Field(None, validation_alias="AGENTS_API_TOKEN")

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

    # ------------------------------------------------------------ live AI agent (NEAR mainnet, REAL funds)
    # The agent trades spot through NEAR Intents (1Click) from one dedicated account whose key
    # the service holds. Every swap's recipient and refund address is that account, so funds
    # can only go agent -> 1Click deposit address -> back to the agent. Fund it with a small cap.
    live_enabled: bool = Field(False, validation_alias="NIXO_LIVE_ENABLED")  # master kill switch
    agent_account: str | None = Field(None, validation_alias="NIXO_AGENT_ACCOUNT")
    agent_private_key: SecretStr | None = Field(None, validation_alias="NIXO_AGENT_PRIVATE_KEY")
    # Only this wallet may start the live agent (proved with a NEP-413 signed message).
    agent_owner: str | None = Field(None, validation_alias="NIXO_AGENT_OWNER")
    live_rpc: str = Field("https://free.rpc.fastnear.com", validation_alias="NIXO_LIVE_RPC")
    live_markets: str = Field("NEAR,BTC,ETH", validation_alias="NIXO_LIVE_MARKETS")
    live_max_trade_usdc: float = Field(25.0, gt=0, validation_alias="NIXO_LIVE_MAX_TRADE_USDC")
    live_min_trade_usdc: float = Field(1.0, gt=0, validation_alias="NIXO_LIVE_MIN_TRADE_USDC")
    live_daily_budget_usdc: float = Field(100.0, gt=0, validation_alias="NIXO_LIVE_DAILY_BUDGET_USDC")
    live_max_slippage_bps: int = Field(100, ge=10, le=500, validation_alias="NIXO_LIVE_MAX_SLIPPAGE_BPS")
    # Refuse a quote whose price is this far worse than the Binance mark.
    live_max_mark_deviation_bps: int = Field(150, ge=10, le=1000, validation_alias="NIXO_LIVE_MAX_DEVIATION_BPS")
    live_swap_timeout_secs: float = Field(300.0, ge=30, le=1800, validation_alias="NIXO_LIVE_SWAP_TIMEOUT")
    live_store_dir: str | None = Field(None, validation_alias="NIXO_LIVE_STORE")


settings = Settings()

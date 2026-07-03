from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AGENT_",
        env_file=".env",
        case_sensitive=False,
        extra="ignore",
    )

    database_url: str = Field(default="sqlite:///./data/agent.db")
    log_level: str = Field(default="INFO")

    # LLM provider — auto-detected from whichever key is set if left blank
    llm_provider: str = Field(default="")   # "anthropic" | "gemini"
    llm_model: str = Field(default="")      # uses provider default when blank

    # Provider keys — set exactly one
    anthropic_api_key: str = Field(default="")
    gemini_api_key: str = Field(default="")

    # Analysis loop tuning
    uploads_dir: str = Field(default="data/uploads")
    sample_rows: int = Field(default=20)      # rows sampled to the LLM (never full data)
    max_attempts: int = Field(default=3)      # iterate/self-correct cap
    exec_timeout_s: int = Field(default=25)   # sandbox wall-clock timeout (seconds)
    max_upload_bytes: int = Field(default=100 * 1024 * 1024)  # ~100MB guard


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings

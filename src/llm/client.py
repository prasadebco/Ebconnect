import time

from config.settings import get_settings
from observability.events import get_logger

_log = get_logger("llm")

# Substrings that mark a transient/retryable Gemini failure (rate limits,
# overload, upstream 5xx, connection resets). Hard errors (auth, bad request)
# are NOT retried — they are surfaced immediately.
_TRANSIENT_MARKERS = (
    "429", "500", "502", "503", "504",
    "rate limit", "resource exhausted", "overloaded", "unavailable",
    "temporarily", "deadline", "timeout", "connection reset",
    "connection aborted", "internal error",
)


def _is_transient(exc: Exception) -> bool:
    msg = f"{type(exc).__name__}: {exc}".lower()
    return any(m in msg for m in _TRANSIENT_MARKERS)


def _with_retry(fn):
    """Run `fn` with bounded exponential backoff on transient Gemini errors.

    Re-raises the last exception on a hard failure or once retries are exhausted,
    so the calling node surfaces a clean error (never crashes the request).
    """
    s = get_settings()
    attempts = max(1, s.llm_max_retries)
    base = s.llm_retry_base_s
    last: Exception | None = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001
            last = exc
            if i == attempts - 1 or not _is_transient(exc):
                raise
            delay = base * (2 ** i)
            _log.warning("llm.retry", attempt=i + 1, delay_s=round(delay, 3), error=str(exc))
            time.sleep(delay)
    assert last is not None
    raise last


# Per-model USD rate table (per 1,000,000 tokens): (input_rate, output_rate).
_RATES: dict[str, tuple[float, float]] = {
    "gemini-3.1-pro": (1.25, 10.00),
    "gemini-3.1-pro-preview": (1.25, 10.00),
    "gemini-2.5-flash": (0.30, 2.50),
    "gemini-2.5-flash-lite": (0.10, 0.40),
    "gemini-1.5-pro": (1.25, 5.00),
    "claude-sonnet-4-6": (3.00, 15.00),
}
_DEFAULT_RATE = (1.25, 10.00)


def cost_for(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    in_rate, out_rate = _RATES.get(model, _DEFAULT_RATE)
    return round(
        (prompt_tokens / 1_000_000) * in_rate + (completion_tokens / 1_000_000) * out_rate,
        6,
    )


def _make_provider():
    s = get_settings()
    provider = s.llm_provider

    # auto-detect from whichever key is set
    if not provider:
        if s.anthropic_api_key:
            provider = "anthropic"
        elif s.gemini_api_key:
            provider = "gemini"
        else:
            raise RuntimeError(
                "No LLM provider configured. Set AGENT_ANTHROPIC_API_KEY or "
                "AGENT_GEMINI_API_KEY in .env, or set AGENT_LLM_PROVIDER explicitly."
            )

    if provider == "anthropic":
        from llm.providers.anthropic import AnthropicProvider
        return AnthropicProvider(api_key=s.anthropic_api_key, model=s.llm_model)
    if provider == "gemini":
        from llm.providers.gemini import GeminiProvider
        return GeminiProvider(api_key=s.gemini_api_key, model=s.llm_model)

    raise RuntimeError(f"Unknown LLM provider: {provider!r}. Supported: anthropic, gemini")


class LLMClient:
    def __init__(self) -> None:
        self._provider = _make_provider()

    @property
    def model(self) -> str:
        return getattr(self._provider, "model", "")

    def call_model(self, prompt: str, *, system: str | None = None) -> str:
        return self._provider.call_model(prompt, system=system)

    def generate(self, prompt: str, *, system: str | None = None) -> tuple[str, dict]:
        """Return (text, usage={prompt, completion, total}).

        Transient Gemini errors are retried with bounded exponential backoff; a
        hard failure re-raises so the node surfaces a clean error.
        """
        return _with_retry(lambda: self._provider.generate(prompt, system=system))

    def cost(self, prompt_tokens: int, completion_tokens: int) -> float:
        return cost_for(self.model, prompt_tokens, completion_tokens)

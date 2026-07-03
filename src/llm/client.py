from config.settings import get_settings

# Per-model USD rate table (per 1,000,000 tokens): (input_rate, output_rate).
_RATES: dict[str, tuple[float, float]] = {
    "gemini-3.1-pro": (1.25, 10.00),
    "gemini-3.1-pro-preview": (1.25, 10.00),
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
        """Return (text, usage={prompt, completion, total})."""
        return self._provider.generate(prompt, system=system)

    def cost(self, prompt_tokens: int, completion_tokens: int) -> float:
        return cost_for(self.model, prompt_tokens, completion_tokens)

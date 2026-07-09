import anthropic as _sdk


class AnthropicProvider:
    DEFAULT_MODEL = "claude-sonnet-4-6"

    def __init__(self, api_key: str, model: str) -> None:
        self._client = _sdk.Anthropic(api_key=api_key)
        self._model = model or self.DEFAULT_MODEL

    @property
    def model(self) -> str:
        return self._model

    def call_model(self, prompt: str, *, system: str | None = None) -> str:
        text, _ = self.generate(prompt, system=system)
        return text

    def generate(self, prompt: str, *, system: str | None = None) -> tuple[str, dict]:
        kwargs: dict = dict(
            model=self._model,
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
        if system:
            kwargs["system"] = system
        msg = self._client.messages.create(**kwargs)
        usage = {"prompt": 0, "completion": 0, "total": 0}
        u = getattr(msg, "usage", None)
        if u is not None:
            usage["prompt"] = int(getattr(u, "input_tokens", 0) or 0)
            usage["completion"] = int(getattr(u, "output_tokens", 0) or 0)
            usage["total"] = usage["prompt"] + usage["completion"]
        return msg.content[0].text, usage

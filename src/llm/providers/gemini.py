from google import genai
from google.genai import types


class GeminiProvider:
    # Spec targets "gemini-3.1-pro"; the GA alias is not yet exposed on the API,
    # so the effective default is the currently-available 3.1-pro preview.
    # Override via AGENT_LLM_MODEL once the GA alias ships.
    DEFAULT_MODEL = "gemini-3.1-pro-preview"

    def __init__(self, api_key: str, model: str) -> None:
        self._client = genai.Client(api_key=api_key)
        self._model = model or self.DEFAULT_MODEL

    @property
    def model(self) -> str:
        return self._model

    def call_model(self, prompt: str, *, system: str | None = None) -> str:
        text, _ = self.generate(prompt, system=system)
        return text

    def generate(self, prompt: str, *, system: str | None = None) -> tuple[str, dict]:
        """Return (text, usage) where usage = {prompt, completion, total}."""
        config = types.GenerateContentConfig(system_instruction=system) if system else None
        response = self._client.models.generate_content(
            model=self._model,
            contents=prompt,
            config=config,
        )
        usage = {"prompt": 0, "completion": 0, "total": 0}
        meta = getattr(response, "usage_metadata", None)
        if meta is not None:
            usage["prompt"] = int(getattr(meta, "prompt_token_count", 0) or 0)
            usage["completion"] = int(getattr(meta, "candidates_token_count", 0) or 0)
            total = getattr(meta, "total_token_count", 0) or 0
            usage["total"] = int(total) or (usage["prompt"] + usage["completion"])
        return (response.text or ""), usage

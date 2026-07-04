"""Phase-4 resilience — sandbox hard-timeout + row-cap guards, and Gemini
transient-error retry/backoff. The agent degrades cleanly and never crashes.
"""
import json

import pandas as pd
import pytest


def parse_sse(text: str) -> list[dict]:
    events, cur = [], {}
    for line in text.splitlines():
        if line.startswith("event:"):
            cur["event"] = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            cur["data"] = json.loads(line.split(":", 1)[1].strip())
        elif line == "" and cur:
            events.append(cur); cur = {}
    if cur:
        events.append(cur)
    return events


def test_runaway_code_is_killed_by_timeout_cleanly(tmp_path):
    """A runaway snippet is killed by the wall-clock timeout and surfaced as a
    clean error result — no exception, no hang."""
    from sandbox.executor import execute

    csv = tmp_path / "d.csv"
    pd.DataFrame({"a": [1, 2, 3]}).to_csv(csv, index=False)

    result = execute("while True:\n    x = 1", {"df": str(csv)}, timeout=1)
    assert result["ok"] is False
    assert "timed out" in (result["error"] or "").lower()


def test_result_rows_are_capped(tmp_path):
    """A huge result frame is capped (row-cap guard) rather than flooding memory."""
    from sandbox.executor import execute

    csv = tmp_path / "d.csv"
    pd.DataFrame({"a": list(range(5000))}).to_csv(csv, index=False)

    code = "result = df"
    result = execute(code, {"df": str(csv)}, timeout=25)
    assert result["ok"] is True
    assert len(result["result_json"]["rows"]) <= 1000


def test_transient_llm_error_is_retried_unit():
    """Unit: transient errors are retried; hard errors are not."""
    from llm.client import _with_retry, _is_transient

    assert _is_transient(RuntimeError("503 Service Unavailable"))
    assert _is_transient(Exception("Resource exhausted, please retry"))
    assert not _is_transient(ValueError("invalid api key"))

    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] < 3:
            raise RuntimeError("503 temporarily unavailable")
        return "ok"

    # base delay is read from settings; keep the test fast by monkeypatching later
    assert _with_retry(flaky) == "ok"
    assert calls["n"] == 3

    def hard():
        calls["n"] += 1
        raise ValueError("bad request")

    calls["n"] = 0
    with pytest.raises(ValueError):
        _with_retry(hard)
    assert calls["n"] == 1  # not retried


@pytest.mark.usefixtures("_require_llm_key")
def test_transient_gemini_error_recovers_end_to_end(api_client, tmp_path, monkeypatch):
    """A simulated transient Gemini failure on the first call is retried and the
    query still completes against the real API."""
    from llm.providers.gemini import GeminiProvider

    csv = tmp_path / "sales.csv"
    pd.DataFrame({
        "region": ["East", "West"] * 20,
        "revenue": [100.0, 200.0] * 20,
    }).to_csv(csv, index=False)
    with csv.open("rb") as f:
        ds = api_client.post("/datasets", files={"file": ("sales.csv", f, "text/csv")}).json()
    conv = api_client.post("/conversations", json={"primary_dataset_id": ds["id"]}).json()

    orig = GeminiProvider.generate
    state = {"failed": False}

    def flaky_generate(self, prompt, *, system=None):
        if not state["failed"]:
            state["failed"] = True
            raise RuntimeError("503 Service temporarily unavailable")
        return orig(self, prompt, system=system)

    monkeypatch.setattr(GeminiProvider, "generate", flaky_generate)
    # keep backoff fast
    monkeypatch.setenv("AGENT_LLM_RETRY_BASE_S", "0.01")
    import config.settings as cs
    cs._settings = None

    r = api_client.post(
        f"/conversations/{conv['id']}/query",
        json={"question": "what is the total revenue by region?"},
    )
    assert r.status_code == 200, r.text
    events = parse_sse(r.text)
    kinds = [e["event"] for e in events]
    assert state["failed"] is True          # the transient error did fire
    assert "error" not in kinds, events     # but the run recovered
    assert "answer" in kinds

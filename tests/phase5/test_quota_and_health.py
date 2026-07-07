"""Phase-5 backend polish — error surfacing + spec↔code reconciliation.

Covers:
  1. A Gemini quota / 429 / RESOURCE_EXHAUSTED failure is surfaced to the user as
     a FRIENDLY SSE `error` message (clean text, no raw traceback / stack), the
     request degrades cleanly (HTTP 200 SSE stream), and the persisted assistant
     Message stores the friendly text — not the raw exception.
  2. GET /health responds 200 with the documented app-envelope shape.
  3. The `friendly_error` mapping unit behaviour (quota vs node-wrapped vs
     already-friendly pass-through).
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
            events.append(cur)
            cur = {}
    if cur:
        events.append(cur)
    return events


# --------------------------------------------------------------------------- #
# 1. Quota / 429 → friendly SSE error (no raw traceback leak)
# --------------------------------------------------------------------------- #
@pytest.mark.usefixtures("_require_llm_key")
def test_gemini_quota_429_is_surfaced_as_friendly_sse_error(api_client, tmp_path, monkeypatch):
    """A persistent Gemini 429/RESOURCE_EXHAUSTED (quota exhausted) is retried,
    then surfaced cleanly as a friendly SSE `error` event — never a raw stack —
    and the request does not crash."""
    from llm.providers.gemini import GeminiProvider

    csv = tmp_path / "sales.csv"
    pd.DataFrame({
        "region": ["East", "West"] * 20,
        "revenue": [100.0, 200.0] * 20,
    }).to_csv(csv, index=False)
    with csv.open("rb") as f:
        ds = api_client.post("/datasets", files={"file": ("sales.csv", f, "text/csv")}).json()
    conv = api_client.post("/conversations", json={"primary_dataset_id": ds["id"]}).json()

    raw = (
        "429 RESOURCE_EXHAUSTED: You exceeded your current quota. "
        'Traceback (most recent call last): ... google.api_core.exceptions'
    )

    def always_quota(self, prompt, *, system=None):
        raise RuntimeError(raw)

    monkeypatch.setattr(GeminiProvider, "generate", always_quota)
    # keep retry backoff effectively instant
    monkeypatch.setenv("AGENT_LLM_RETRY_BASE_S", "0.001")
    monkeypatch.setenv("AGENT_LLM_MAX_RETRIES", "2")
    import config.settings as cs
    cs._settings = None

    r = api_client.post(
        f"/conversations/{conv['id']}/query",
        json={"question": "what is total revenue by region?"},
    )
    assert r.status_code == 200, r.text  # degrades cleanly, not a 500 crash
    events = parse_sse(r.text)
    kinds = [e["event"] for e in events]
    assert "error" in kinds, events
    err = next(e for e in events if e["event"] == "error")
    msg = err["data"]["message"]
    # friendly, actionable text
    assert "rate-limited" in msg.lower() or "quota" in msg.lower()
    # NO raw traceback / provider internals leaked to the user
    assert "Traceback" not in msg
    assert "RESOURCE_EXHAUSTED" not in msg
    assert "google.api_core" not in msg

    # the persisted failed Message stores the friendly text, not the raw stack
    hist = api_client.get(f"/conversations/{conv['id']}").json()
    assistant = [m for m in hist["messages"] if m["role"] == "assistant"]
    assert assistant, hist
    last = assistant[-1]
    assert last["status"] == "failed"
    assert "Traceback" not in (last["content"] or "")
    assert "RESOURCE_EXHAUSTED" not in (last["content"] or "")


# --------------------------------------------------------------------------- #
# 2. friendly_error mapping — unit
# --------------------------------------------------------------------------- #
def test_friendly_error_mapping():
    from llm.client import friendly_error

    # quota / rate-limit → friendly retry message
    for raw in [
        "429 RESOURCE_EXHAUSTED: quota exceeded",
        "plan failed: 429 rate limit",
        "google.api_core.exceptions.ResourceExhausted: quota",
    ]:
        assert "rate-limited" in friendly_error(raw).lower()
        assert "Traceback" not in friendly_error(raw)

    # node-wrapped raw exception (non-quota) → generic clean message, no leak
    wrapped = "write_code failed: KeyError('revenue') Traceback ..."
    out = friendly_error(wrapped)
    assert "Traceback" not in out
    assert "KeyError" not in out
    assert "went wrong" in out.lower()

    # already-friendly verify message passes through unchanged
    friendly = "The analysis could not produce a valid result after 3 attempts: the result is empty"
    assert friendly_error(friendly) == friendly

    # empty / None → safe default
    assert friendly_error(None)
    assert friendly_error("")


# --------------------------------------------------------------------------- #
# 3. GET /health shape matches spec/api.md (app envelope)
# --------------------------------------------------------------------------- #
def test_health_shape_matches_spec(api_client):
    r = api_client.get("/health")
    assert r.status_code == 200
    body = r.json()
    # /health returns the app envelope {"data": {"status": "ok"}, "error": null}
    assert body == {"data": {"status": "ok"}, "error": None}

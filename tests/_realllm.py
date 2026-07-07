"""Shared real-LLM test resilience for a FREE-TIER Gemini key.

The suite runs real Gemini calls (key from ``.env`` — never stubbed). The free
tier has two distinct limits:

  * a **per-minute** rate limit — a *transient* 429 that clears on its own. The
    llm client already retries these with backoff; this helper adds one more
    test-level backoff+retry for safety.
  * a **daily** quota (RESOURCE_EXHAUSTED) — once exhausted, no amount of waiting
    helps until the next day. Treating this as a test FAILURE would red the gate
    for a non-code reason, so we ``pytest.skip`` instead.

Nothing here weakens an assertion: when a real call SUCCEEDS the test still
verifies correctness against ground truth. We only convert a genuine
quota-exhaustion (never a wrong answer) into a skip.
"""
from __future__ import annotations

import time

import pytest

# Substrings marking a quota / rate-limit condition — the RAW provider strings
# AND the friendly, user-facing message the runner surfaces via friendly_error.
# Kept in sync with src/llm/client.py (_QUOTA_MARKERS) + the friendly text.
_QUOTA_MARKERS = (
    "429",
    "resource_exhausted",
    "resource exhausted",
    "quota",
    "rate limit",
    "rate-limit",
    "rate-limited",
    "ratelimit",
    "out of quota",
    "temporarily rate-limited",
)

_SKIP_REASON = "Gemini free-tier quota exhausted — real-LLM assertion skipped"


def is_quota_text(text: str | None) -> bool:
    """True when a string looks like a Gemini quota / rate-limit condition."""
    if not text:
        return False
    low = text.lower()
    return any(m in low for m in _QUOTA_MARKERS)


def _quota_error_event(events: list[dict]) -> dict | None:
    """Return the first SSE ``error`` event that is a quota/rate-limit failure."""
    for e in events:
        if e.get("event") == "error":
            msg = (e.get("data") or {}).get("message") or ""
            if is_quota_text(msg):
                return e
    return None


def skip_if_quota(events: list[dict]) -> None:
    """Skip (not fail) the test when the SSE stream failed on a Gemini quota /
    rate-limit condition. A no-op when the run succeeded or failed for a real,
    code-level reason (that must still fail loudly)."""
    if _quota_error_event(events) is not None:
        pytest.skip(_SKIP_REASON)


def parse_sse(text: str) -> list[dict]:
    """Parse an SSE response body into ``[{"event", "data"}]``."""
    import json

    events: list[dict] = []
    cur: dict = {}
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


def stream_query(
    api_client,
    conv_id: str,
    question: str,
    *,
    extra: dict | None = None,
    attempts: int = 2,
    base_delay_s: float = 5.0,
):
    """POST a query and return its parsed SSE events, with free-tier resilience.

    On a *transient* per-minute rate limit the whole query is retried once with
    exponential backoff (on top of the client-level retry). On a genuine
    daily-quota exhaustion — or a rate limit that persists after backoff — the
    test is skipped rather than failed. Real success is returned untouched so the
    caller's correctness assertions run normally.
    """
    payload = {"question": question, **(extra or {})}
    events: list[dict] = []
    for i in range(max(1, attempts)):
        r = api_client.post(f"/conversations/{conv_id}/query", json=payload)
        assert r.status_code == 200, r.text
        events = parse_sse(r.text)
        if _quota_error_event(events) is None:
            return events  # success (or a real, non-quota failure) — hand back
        if i < attempts - 1:
            time.sleep(base_delay_s * (2 ** i))
    # still quota-limited after backoff → skip, don't red the gate
    pytest.skip(_SKIP_REASON)

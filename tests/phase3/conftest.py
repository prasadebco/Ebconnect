"""Phase-3 fixtures/helpers. Reuses the root conftest (isolated SQLite,
api_client, _require_llm_key)."""
import json

import pytest


def _parse_sse(text: str):
    events = []
    cur = {}
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


@pytest.fixture
def parse_sse():
    return _parse_sse


@pytest.fixture
def answer_event():
    def _get(events):
        return next(e["data"] for e in events if e["event"] == "answer")

    return _get

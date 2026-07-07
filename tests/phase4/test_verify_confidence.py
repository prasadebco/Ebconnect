"""Phase-4 verify-strengthening + confidence signalling. A repeatedly-suspect
result (empty) is caught by verification and, once retries are exhausted, is
answered as a LOW-confidence flagged best-guess (never a crash). A genuinely
clean answer is HIGH confidence. Real Gemini via .env.
"""
import pandas as pd
import pytest

import json

from _realllm import skip_if_quota


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


def empty_table_result(columns: list[str]) -> dict:
    return {"ok": True, "result_repr": "Empty DataFrame",
            "result_json": {"kind": "table", "columns": columns, "rows": []},
            "stdout": "", "error": None, "traceback": None}


def _build_csv(path, rows=60):
    regions = ["East", "West", "North", "South"]
    df = pd.DataFrame({
        "region": [regions[i % 4] for i in range(rows)],
        "revenue": [float((i % 5) * 100 + 25) for i in range(rows)],
    })
    df.to_csv(path, index=False)
    return df


def _setup(api_client, tmp_path):
    csv = tmp_path / "sales.csv"
    df = _build_csv(csv)
    with csv.open("rb") as f:
        ds = api_client.post("/datasets", files={"file": ("sales.csv", f, "text/csv")}).json()
    conv = api_client.post("/conversations", json={"primary_dataset_id": ds["id"]}).json()
    return df, conv["id"]


@pytest.mark.usefixtures("_require_llm_key")
def test_suspect_empty_result_flagged_low_confidence(api_client, tmp_path):
    from graph import nodes
    from config.settings import get_settings

    _df, conv_id = _setup(api_client, tmp_path)
    max_attempts = get_settings().max_attempts

    # Force EVERY attempt to yield an empty (suspect) result → verification keeps
    # rejecting it; once the cap is hit it must be answered as a flagged best-guess.
    for _ in range(max_attempts):
        nodes._forced_exec_results.append(empty_table_result(["region", "revenue"]))

    r = api_client.post(
        f"/conversations/{conv_id}/query",
        json={"question": "total revenue by region?"},
    )
    assert r.status_code == 200, r.text
    events = parse_sse(r.text)
    skip_if_quota(events)
    kinds = [e["event"] for e in events]
    assert "error" not in kinds, events   # degrades to a flagged answer, no crash

    answer = next(e["data"] for e in events if e["event"] == "answer")
    assert answer["status"] == "completed"
    assert answer["confidence"] == "low", answer
    # a concise uncertainty caveat is present in the prose
    assert any(w in answer["content"].lower() for w in ("flag", "verify", "best guess", "best-guess", "uncertain")), answer["content"]


@pytest.mark.usefixtures("_require_llm_key")
def test_clean_answer_is_high_confidence(api_client, tmp_path):
    _df, conv_id = _setup(api_client, tmp_path)
    r = api_client.post(
        f"/conversations/{conv_id}/query",
        json={"question": "what is the total revenue by region?"},
    )
    assert r.status_code == 200
    events = parse_sse(r.text)
    skip_if_quota(events)
    answer = next(e["data"] for e in events if e["event"] == "answer")
    assert answer["status"] == "completed"
    assert answer["confidence"] == "high", answer


def test_verify_flags_nan_and_empty_mechanically():
    """Unit: the mechanical suspect-result checks (no LLM)."""
    from graph.nodes import _suspect_result

    notes, usable = _suspect_result({"ok": True, "result_json": {"kind": "scalar", "value": float("nan")}})
    assert notes and usable

    notes, usable = _suspect_result({"ok": True, "result_json": {"kind": "table", "columns": ["a"], "rows": []}})
    assert notes and usable  # empty but answerable-as-flagged

    notes, usable = _suspect_result({"ok": False, "error": "boom", "result_json": None})
    assert notes and not usable  # nothing usable

    notes, usable = _suspect_result({"ok": True, "result_json": {"kind": "scalar", "value": 42}})
    assert notes is None and usable  # clean

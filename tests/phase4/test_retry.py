"""Phase-4 retry robustness — a first-attempt code failure triggers a retry with
a CHANGED approach and still returns a correct, verified answer, bounded by
AGENT_MAX_ATTEMPTS. Real Gemini via .env, real sandbox, real SQLite.
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


def failure_result(msg: str = "ValueError: injected first-attempt failure") -> dict:
    return {"ok": False, "result_repr": None, "result_json": None, "stdout": "",
            "error": msg, "traceback": f"Traceback...\n{msg}"}


def _build_csv(path, rows=80):
    regions = ["East", "West", "North", "South"]
    df = pd.DataFrame({
        "region": [regions[i % 4] for i in range(rows)],
        "revenue": [float((i % 5) * 100 + 25) for i in range(rows)],
    })
    df.to_csv(path, index=False)
    return df


def _setup(api_client, tmp_path, rows=80):
    csv = tmp_path / "sales.csv"
    df = _build_csv(csv, rows=rows)
    with csv.open("rb") as f:
        ds = api_client.post("/datasets", files={"file": ("sales.csv", f, "text/csv")}).json()
    conv = api_client.post("/conversations", json={"primary_dataset_id": ds["id"]}).json()
    return df, conv["id"]


@pytest.mark.usefixtures("_require_llm_key")
def test_retry_with_changed_approach_still_correct(api_client, tmp_path):
    from graph import nodes
    from config.settings import get_settings

    df, conv_id = _setup(api_client, tmp_path)
    ground_truth = df.groupby("region")["revenue"].sum().round(4).to_dict()
    max_attempts = get_settings().max_attempts

    # Inject a deterministic FIRST-attempt failure; later attempts run for real.
    nodes._forced_exec_results.append(failure_result())

    r = api_client.post(
        f"/conversations/{conv_id}/query",
        json={"question": "what is the total revenue by region?"},
    )
    assert r.status_code == 200, r.text
    events = parse_sse(r.text)
    skip_if_quota(events)
    kinds = [e["event"] for e in events]
    assert "error" not in kinds, events
    assert "answer" in kinds

    # a retry step was surfaced to the user, and the loop self-corrected (>1 attempt)
    step_labels = [e["data"]["label"] for e in events if e["event"] == "step"]
    retry_steps = [s for s in step_labels if "retry" in s.lower()]
    assert len(retry_steps) >= 1, step_labels
    # bounded: never more retries than the attempt cap allows
    assert len(retry_steps) < max_attempts

    answer = next(e["data"] for e in events if e["event"] == "answer")
    assert answer["status"] == "completed"
    # self-corrected → medium confidence (not the first-try 'high')
    assert answer["confidence"] == "medium", answer

    # correct vs ground-truth pandas on the FULL data
    assert answer["table"] is not None
    got = {row["region"]: round(float(row["revenue"]), 4) for row in answer["table"]["rows"]}
    assert got == ground_truth

    # the forced failure was consumed
    assert nodes._forced_exec_results == []

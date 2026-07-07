"""End-to-end Phase-1 pipeline against REAL Gemini (key from .env) + real SQLite.

Uploads a CSV, opens a conversation, streams a query, and verifies the answer's
key numbers against a ground-truth pandas computation on the FULL dataset.
"""
import json

import pandas as pd
import pytest

from _realllm import skip_if_quota


def _build_csv(path, rows=120):
    regions = ["East", "West", "North", "South"]
    data = {
        "region": [regions[i % 4] for i in range(rows)],
        "revenue": [float((i % 7) * 100 + 50) for i in range(rows)],
        # a distinctive note that lives ONLY beyond the capped sample (row 77)
        "note": [("SECRET_ROW_77" if i == 77 else f"note_{i}") for i in range(rows)],
    }
    df = pd.DataFrame(data)
    df.to_csv(path, index=False)
    return df


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


@pytest.mark.usefixtures("_require_llm_key")
def test_full_pipeline_query(api_client, tmp_path):
    from graph import nodes

    csv = tmp_path / "sales.csv"
    df = _build_csv(csv, rows=120)
    ground_truth = df.groupby("region")["revenue"].sum().round(4).to_dict()

    # 1) upload + profile
    with csv.open("rb") as f:
        r = api_client.post("/datasets", files={"file": ("sales.csv", f, "text/csv")})
    assert r.status_code == 200, r.text
    ds = r.json()
    assert ds["row_count"] == 120
    assert {c["name"] for c in ds["columns"]} == {"region", "revenue", "note"}
    dataset_id = ds["id"]

    # 2) open conversation
    r = api_client.post("/conversations", json={"primary_dataset_id": dataset_id})
    assert r.status_code == 200, r.text
    conv_id = r.json()["id"]

    # 3) stream the query
    nodes._prompt_log.clear()
    r = api_client.post(
        f"/conversations/{conv_id}/query",
        json={"question": "what is the total revenue by region?"},
    )
    assert r.status_code == 200, r.text
    events = _parse_sse(r.text)
    skip_if_quota(events)
    kinds = [e["event"] for e in events]

    # live steps streamed
    assert "step" in kinds
    assert "usage" in kinds
    assert "answer" in kinds
    assert "error" not in kinds

    usage = next(e["data"] for e in events if e["event"] == "usage")
    assert usage["total"] > 0
    assert usage["prompt"] > 0
    assert usage["cost_usd"] >= 0
    assert usage["elapsed_ms"] >= 0

    answer = next(e["data"] for e in events if e["event"] == "answer")
    assert answer["status"] == "completed"
    assert answer["content"]
    assert answer["code"]

    # verify key numbers against ground-truth pandas on the FULL data
    assert answer["table"] is not None
    got = {row["region"]: round(float(row["revenue"]), 4) for row in answer["table"]["rows"]}
    assert got == ground_truth

    # chart present for a chartable (categorical x numeric) result
    assert answer["chart"] is not None
    assert answer["chart"]["type"] == "bar"

    # PRIVACY: the full dataset never reached the LLM — a cell that exists only
    # beyond the capped sample must not appear in the plan/code prompts.
    code_prompts = [p for tag, p in nodes._prompt_log if tag in ("plan", "write_code")]
    assert code_prompts
    for p in code_prompts:
        assert "SECRET_ROW_77" not in p


@pytest.mark.usefixtures("_require_llm_key")
def test_query_persists_messages(api_client, tmp_path, _isolated_db):
    from sqlalchemy.orm import Session
    from db.models import Message

    csv = tmp_path / "small.csv"
    _build_csv(csv, rows=40)
    with csv.open("rb") as f:
        ds = api_client.post("/datasets", files={"file": ("small.csv", f, "text/csv")}).json()
    conv = api_client.post("/conversations", json={"primary_dataset_id": ds["id"]}).json()

    r = api_client.post(f"/conversations/{conv['id']}/query", json={"question": "how many rows are there?"})
    assert r.status_code == 200
    skip_if_quota(_parse_sse(r.text))

    with Session(_isolated_db) as s:
        msgs = s.query(Message).filter(Message.conversation_id == conv["id"]).all()
    roles = sorted(m.role for m in msgs)
    assert roles == ["assistant", "user"]
    assistant = next(m for m in msgs if m.role == "assistant")
    assert assistant.status == "completed"
    assert assistant.token_total and assistant.token_total > 0
    assert assistant.elapsed_ms is not None

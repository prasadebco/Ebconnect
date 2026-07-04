"""Phase-4 clarification gate — a genuinely ambiguous question yields a focused
clarifying question with NO code executed; answering it in a follow-up resolves
correctly; and a CLEAR question does NOT over-trigger clarification.
Real Gemini via .env.
"""
import pandas as pd
import pytest

import json


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


def _build_csv(path, rows=60):
    products = ["Widget", "Gadget", "Gizmo"]
    df = pd.DataFrame({
        "product": [products[i % 3] for i in range(rows)],
        "revenue": [float((i % 5) * 100 + 50) for i in range(rows)],
        "units_sold": [int((i % 7) + 1) for i in range(rows)],
        "profit_margin": [round(0.1 + (i % 4) * 0.05, 3) for i in range(rows)],
    })
    df.to_csv(path, index=False)
    return df


def _setup(api_client, tmp_path):
    csv = tmp_path / "products.csv"
    df = _build_csv(csv)
    with csv.open("rb") as f:
        ds = api_client.post("/datasets", files={"file": ("products.csv", f, "text/csv")}).json()
    conv = api_client.post("/conversations", json={"primary_dataset_id": ds["id"]}).json()
    return df, conv["id"]


def _query(api_client, conv_id, question):
    r = api_client.post(f"/conversations/{conv_id}/query", json={"question": question})
    assert r.status_code == 200, r.text
    return parse_sse(r.text)


@pytest.mark.usefixtures("_require_llm_key")
def test_ambiguous_question_asks_then_resumes(api_client, tmp_path):
    df, conv_id = _setup(api_client, tmp_path)

    # 1) ambiguous — multiple numeric columns could define "best"
    events = _query(api_client, conv_id, "show me the best products")
    answer = next(e["data"] for e in events if e["event"] == "answer")
    assert answer["status"] == "needs_clarification", answer
    assert answer["content"].strip()          # a real question was asked
    assert not answer.get("code")             # NO analysis code executed
    assert answer.get("table") is None

    # 2) resume: answer the clarifying question as a normal follow-up. Prior-turn
    #    context (the clarifying question + this answer) flows into the next run.
    events = _query(api_client, conv_id, "rank products by total revenue")
    answer = next(e["data"] for e in events if e["event"] == "answer")
    assert answer["status"] == "completed", answer
    assert answer["table"] is not None
    got = {row["product"]: round(float(row["revenue"]), 4) for row in answer["table"]["rows"]}
    ground_truth = df.groupby("product")["revenue"].sum().round(4).to_dict()
    assert got == ground_truth


@pytest.mark.usefixtures("_require_llm_key")
def test_clear_question_does_not_over_trigger(api_client, tmp_path):
    df, conv_id = _setup(api_client, tmp_path)
    events = _query(api_client, conv_id, "what is the total revenue across all products?")
    answer = next(e["data"] for e in events if e["event"] == "answer")
    assert answer["status"] == "completed", answer
    assert answer.get("code")   # it actually ran analysis, did not just ask

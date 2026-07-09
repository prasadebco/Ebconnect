"""Phase-3 output extras — export (CSV/PNG), follow-up suggestions, show-code.
Real Gemini (.env) + real SQLite.
"""
import pandas as pd
import pytest

from _realllm import skip_if_quota


def _build_csv(path, rows=90):
    regions = ["East", "West", "North", "South"]
    df = pd.DataFrame(
        {
            "region": [regions[i % 4] for i in range(rows)],
            "revenue": [float((i % 6) * 100 + 25) for i in range(rows)],
        }
    )
    df.to_csv(path, index=False)
    return df


@pytest.fixture
def _answered(api_client, tmp_path, parse_sse, answer_event):
    csv = tmp_path / "sales.csv"
    _build_csv(csv)
    with csv.open("rb") as f:
        ds = api_client.post("/datasets", files={"file": ("sales.csv", f, "text/csv")}).json()
    conv = api_client.post("/conversations", json={"primary_dataset_id": ds["id"]}).json()
    r = api_client.post(
        f"/conversations/{conv['id']}/query",
        json={"question": "what is total revenue by region?"},
    )
    assert r.status_code == 200, r.text
    events = parse_sse(r.text)
    skip_if_quota(events)
    ans = answer_event(events)
    assert ans["status"] == "completed"
    return conv["id"], ans


@pytest.mark.usefixtures("_require_llm_key")
def test_followups_and_showcode_persisted(api_client, _answered):
    conv_id, ans = _answered

    # follow-ups: 2-3 non-empty suggestions in the answer event
    assert 2 <= len(ans["followups"]) <= 3
    assert all(isinstance(f, str) and f.strip() for f in ans["followups"])

    # show-code: the real executed pandas is present and references a frame
    assert ans["code"] and ans["code"].strip()
    assert "df" in ans["code"] or "groupby" in ans["code"]

    # both are retrievable from history
    hist = api_client.get(f"/conversations/{conv_id}").json()
    assistant = next(m for m in hist["messages"] if m["role"] == "assistant")
    assert 2 <= len(assistant["followups"]) <= 3
    assert assistant["code"] and assistant["code"].strip()


@pytest.mark.usefixtures("_require_llm_key")
def test_export_csv_and_png(api_client, _answered):
    conv_id, ans = _answered
    mid = ans["message_id"]

    # CSV export matches the answer table
    r = api_client.get(f"/conversations/{conv_id}/messages/{mid}/export", params={"format": "csv"})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/csv")
    body = r.content.decode("utf-8")
    assert body.strip()
    for col in ans["table"]["columns"]:
        assert col in body

    # PNG export returns a real PNG (magic bytes)
    r = api_client.get(f"/conversations/{conv_id}/messages/{mid}/export", params={"format": "png"})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "image/png"
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert len(r.content) > 100


@pytest.mark.usefixtures("_require_llm_key")
def test_export_404_when_no_result(api_client, _answered):
    conv_id, _ans = _answered
    r = api_client.get(
        f"/conversations/{conv_id}/messages/does-not-exist/export", params={"format": "csv"}
    )
    assert r.status_code == 404

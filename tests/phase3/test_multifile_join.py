"""Phase-3 multi-file join — real Gemini (.env) + real SQLite.

Upload two related CSVs (orders + customers sharing a key), attach the second to
a conversation, then ask a question that REQUIRES the join and verify the answer
against a ground-truth pandas merge+groupby on the FULL data. Also assert only a
capped per-frame sample (never full data) went to the LLM.
"""
import pandas as pd
import pytest

from _realllm import skip_if_quota


def _build_fixtures(tmp_path):
    segments = ["Enterprise", "SMB", "Consumer"]
    customers = pd.DataFrame(
        {
            "customer_id": list(range(60)),
            "segment": [segments[i % 3] for i in range(60)],
            # a value that lives ONLY beyond the capped sample (row 55)
            "secret_note": [("CUST_SECRET_55" if i == 55 else f"c{i}") for i in range(60)],
        }
    )
    orders = pd.DataFrame(
        {
            "order_id": list(range(300)),
            "customer_id": [i % 60 for i in range(300)],
            "amount": [float((i % 9) * 10 + 5) for i in range(300)],
            "order_note": [("ORDER_SECRET_222" if i == 222 else f"o{i}") for i in range(300)],
        }
    )
    op = tmp_path / "orders.csv"
    cp = tmp_path / "customers.csv"
    orders.to_csv(op, index=False)
    customers.to_csv(cp, index=False)
    return orders, customers, op, cp


def _upload(api_client, path, name):
    with path.open("rb") as f:
        r = api_client.post("/datasets", files={"file": (name, f, "text/csv")})
    assert r.status_code == 200, r.text
    return r.json()


def test_attach_validation(api_client, tmp_path):
    orders, customers, op, cp = _build_fixtures(tmp_path)
    o = _upload(api_client, op, "orders.csv")
    c = _upload(api_client, cp, "customers.csv")
    conv = api_client.post("/conversations", json={"primary_dataset_id": o["id"]}).json()

    r = api_client.post(
        f"/conversations/{conv['id']}/attach",
        json={"dataset_id": c["id"], "frame_alias": "customers"},
    )
    assert r.status_code == 200, r.text
    frames = r.json()["frames"]
    aliases = {fr["alias"] for fr in frames}
    assert aliases == {"df", "customers"}

    # duplicate alias -> 400
    r = api_client.post(
        f"/conversations/{conv['id']}/attach",
        json={"dataset_id": o["id"], "frame_alias": "customers"},
    )
    assert r.status_code == 400

    # unknown dataset -> 400
    r = api_client.post(
        f"/conversations/{conv['id']}/attach",
        json={"dataset_id": "does-not-exist", "frame_alias": "other"},
    )
    assert r.status_code == 400


def test_get_conversation_rehydrates_attached_frames(api_client, tmp_path):
    """Reopening a multi-file chat must restore its attached frames: GET
    /conversations/{id} returns a `frames` array (same shape as attach) with the
    primary (alias 'df') plus every attached dataset."""
    orders, customers, op, cp = _build_fixtures(tmp_path)
    o = _upload(api_client, op, "orders.csv")
    c = _upload(api_client, cp, "customers.csv")
    conv = api_client.post("/conversations", json={"primary_dataset_id": o["id"]}).json()
    api_client.post(
        f"/conversations/{conv['id']}/attach",
        json={"dataset_id": c["id"], "frame_alias": "customers"},
    )

    r = api_client.get(f"/conversations/{conv['id']}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "frames" in body
    frames = body["frames"]
    by_alias = {fr["alias"]: fr for fr in frames}
    assert set(by_alias) == {"df", "customers"}

    # primary frame carries the orders dataset; attached carries customers
    assert by_alias["df"]["dataset_id"] == o["id"]
    assert by_alias["df"]["name"] == o["name"]
    assert by_alias["customers"]["dataset_id"] == c["id"]
    assert by_alias["customers"]["name"] == c["name"]

    # shape matches attach: alias, dataset_id, name, kind, sheets[{name,row_count}]
    for fr in frames:
        assert set(fr) >= {"alias", "dataset_id", "name", "kind", "sheets"}
        for sh in fr["sheets"]:
            assert set(sh) >= {"name", "row_count"}


@pytest.mark.usefixtures("_require_llm_key")
def test_join_revenue_by_segment(api_client, tmp_path, parse_sse, answer_event):
    from graph import nodes

    orders, customers, op, cp = _build_fixtures(tmp_path)
    merged = orders.merge(customers, on="customer_id")
    ground_truth = merged.groupby("segment")["amount"].sum().round(4).to_dict()

    o = _upload(api_client, op, "orders.csv")
    c = _upload(api_client, cp, "customers.csv")
    conv = api_client.post("/conversations", json={"primary_dataset_id": o["id"]}).json()
    api_client.post(
        f"/conversations/{conv['id']}/attach",
        json={"dataset_id": c["id"], "frame_alias": "customers"},
    )

    nodes._prompt_log.clear()
    r = api_client.post(
        f"/conversations/{conv['id']}/query",
        json={
            "question": "join orders to customers and show total order amount by customer segment",
        },
    )
    assert r.status_code == 200, r.text
    events = parse_sse(r.text)
    skip_if_quota(events)
    assert "error" not in [e["event"] for e in events]
    ans = answer_event(events)
    assert ans["status"] == "completed"
    assert ans["table"] is not None

    got = {}
    for row in ans["table"]["rows"]:
        seg = row.get("segment")
        # tolerate the amount column being renamed by the model
        amt = next(
            (v for k, v in row.items() if k != "segment" and isinstance(v, (int, float))),
            None,
        )
        got[seg] = round(float(amt), 4)
    assert got == ground_truth

    # PRIVACY: only the capped sample of each frame reached the LLM — values that
    # exist only beyond the sample must never appear in any prompt.
    prompts = [p for _tag, p in nodes._prompt_log]
    assert prompts
    for p in prompts:
        assert "CUST_SECRET_55" not in p
        assert "ORDER_SECRET_222" not in p

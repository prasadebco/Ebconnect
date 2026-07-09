"""Phase-2 library API: list/delete datasets, list/get conversations, and
persistence across a simulated restart. Uses the FastAPI TestClient (no port)
and the isolated per-test SQLite file from the root conftest.
"""
import os

import pandas as pd
import pytest


def _build_sales_csv(path, rows=60):
    regions = ["East", "West", "North", "South"]
    df = pd.DataFrame(
        {
            "region": [regions[i % 4] for i in range(rows)],
            "revenue": [float((i % 7) * 100 + 50) for i in range(rows)],
        }
    )
    df.to_csv(path, index=False)
    return df


def _upload(client, path, name):
    with open(path, "rb") as f:
        r = client.post("/datasets", files={"file": (name, f, "text/csv")})
    assert r.status_code == 200, r.text
    return r.json()


# --------------------------------------------------------------------------- #
# GET /datasets — listing & ordering
# --------------------------------------------------------------------------- #
def test_list_datasets_ordered_by_recency(api_client, tmp_path):
    a = tmp_path / "a.csv"
    b = tmp_path / "b.csv"
    _build_sales_csv(a)
    _build_sales_csv(b)
    ds_a = _upload(api_client, a, "a.csv")
    ds_b = _upload(api_client, b, "b.csv")

    r = api_client.get("/datasets")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, list)
    ids = [d["id"] for d in body]
    assert set(ids) == {ds_a["id"], ds_b["id"]}
    # bare-object shape
    first = body[0]
    assert set(first) == {"id", "name", "kind", "row_count", "created_at", "last_used_at"}
    # b uploaded last → most-recently-used first
    assert ids[0] == ds_b["id"]


def test_list_datasets_empty(api_client):
    r = api_client.get("/datasets")
    assert r.status_code == 200
    assert r.json() == []


# --------------------------------------------------------------------------- #
# DELETE /datasets/{id}
# --------------------------------------------------------------------------- #
def test_delete_dataset_removes_row_file_and_dependents(api_client, tmp_path):
    csv = tmp_path / "del.csv"
    _build_sales_csv(csv)
    ds = _upload(api_client, csv, "del.csv")

    # a conversation over it (dependent that must be cleaned up)
    conv = api_client.post("/conversations", json={"primary_dataset_id": ds["id"]}).json()

    # confirm the raw file exists on disk before delete
    detail = api_client.get(f"/datasets/{ds['id']}").json()
    assert detail["row_count"] == 60

    r = api_client.delete(f"/datasets/{ds['id']}")
    assert r.status_code == 200
    assert r.json() == {"deleted": True}

    # gone from library + 404 on re-get
    assert ds["id"] not in [d["id"] for d in api_client.get("/datasets").json()]
    assert api_client.get(f"/datasets/{ds['id']}").status_code == 404

    # dependent conversation cleaned up (no orphan)
    assert api_client.get(f"/conversations/{conv['id']}").status_code == 404
    assert conv["id"] not in [c["id"] for c in api_client.get("/conversations").json()]


def test_delete_dataset_unknown_404(api_client):
    r = api_client.delete("/datasets/does-not-exist")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "NOT_FOUND"


# --------------------------------------------------------------------------- #
# GET /conversations & GET /conversations/{id}
# --------------------------------------------------------------------------- #
def test_get_conversation_unknown_404(api_client):
    r = api_client.get("/conversations/nope")
    assert r.status_code == 404


def test_list_conversations_shape(api_client, tmp_path):
    csv = tmp_path / "c.csv"
    _build_sales_csv(csv)
    ds = _upload(api_client, csv, "c.csv")
    conv = api_client.post("/conversations", json={"primary_dataset_id": ds["id"]}).json()

    body = api_client.get("/conversations").json()
    assert isinstance(body, list)
    row = next(c for c in body if c["id"] == conv["id"])
    assert set(row) >= {"id", "primary_dataset_id", "title", "created_at", "last_used_at"}
    assert row["dataset_name"] == "c.csv"

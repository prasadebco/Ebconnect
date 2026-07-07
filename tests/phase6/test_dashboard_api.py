"""Phase-6 acceptance for the Pinnable-Dashboard backend against real SQLite.

The pin/list/unpin/reorder/persistence/cascade CRUD runs deterministically off a
DB-inserted completed assistant Message (no Gemini call). ONE test runs a real
free-tier gemini-2.5-flash query end-to-end and pins its answer (quota-aware:
skips on genuine 429/RESOURCE_EXHAUSTED, never fails).
"""
import pandas as pd
import pytest

from _realllm import stream_query


# --------------------------------------------------------------------------- #
# Deterministic DB fixtures — build a completed assistant answer directly
# --------------------------------------------------------------------------- #
def _seed_completed_answer(
    *,
    dataset_name="sales_2025.csv",
    question="what is total revenue by region?",
    content="Total revenue is highest in the East.",
):
    """Insert Dataset + Conversation + user question + a completed assistant
    Message with chart/table, and return the ids. No LLM involved."""
    from db.session import create_db_session
    from db.models import Dataset, Conversation, Message

    with create_db_session() as s:
        ds = Dataset(name=dataset_name, file_path="/tmp/x.csv", kind="csv", row_count=10)
        s.add(ds)
        s.flush()
        conv = Conversation(primary_dataset_id=ds.id, title=f"Chat over {dataset_name}")
        s.add(conv)
        s.flush()
        user = Message(conversation_id=conv.id, role="user", content=question, status="completed")
        s.add(user)
        s.flush()
        answer = Message(
            conversation_id=conv.id,
            role="assistant",
            content=content,
            chart={"type": "bar", "x": "region", "y": "revenue", "data": [{"region": "East", "revenue": 100}]},
            table={"columns": ["region", "revenue"], "rows": [{"region": "East", "revenue": 100}]},
            confidence="high",
            status="completed",
        )
        s.add(answer)
        s.flush()
        return {
            "dataset_id": ds.id,
            "conversation_id": conv.id,
            "user_id": user.id,
            "message_id": answer.id,
        }


# --------------------------------------------------------------------------- #
# PIN + snapshot + GET
# --------------------------------------------------------------------------- #
def test_pin_snapshots_message(api_client):
    seed = _seed_completed_answer()
    r = api_client.post("/dashboard/tiles", json={"message_id": seed["message_id"]})
    assert r.status_code == 200, r.text
    tile = r.json()
    assert tile["message_id"] == seed["message_id"]
    assert tile["conversation_id"] == seed["conversation_id"]
    assert tile["dataset_id"] == seed["dataset_id"]
    assert tile["dataset_name"] == "sales_2025.csv"
    assert tile["title"] == "what is total revenue by region?"
    assert tile["content"] == "Total revenue is highest in the East."
    assert tile["chart"]["type"] == "bar"
    assert tile["table"]["columns"] == ["region", "revenue"]
    assert tile["confidence"] == "high"
    assert tile["display_order"] == 0
    assert tile["created_at"]

    listed = api_client.get("/dashboard/tiles")
    assert listed.status_code == 200
    arr = listed.json()
    assert isinstance(arr, list) and len(arr) == 1
    assert arr[0]["id"] == tile["id"]


# --------------------------------------------------------------------------- #
# Idempotency
# --------------------------------------------------------------------------- #
def test_pin_is_idempotent(api_client):
    seed = _seed_completed_answer()
    a = api_client.post("/dashboard/tiles", json={"message_id": seed["message_id"]}).json()
    b = api_client.post("/dashboard/tiles", json={"message_id": seed["message_id"]}).json()
    assert a["id"] == b["id"]
    assert len(api_client.get("/dashboard/tiles").json()) == 1


# --------------------------------------------------------------------------- #
# Validation
# --------------------------------------------------------------------------- #
def test_pin_unknown_message_404(api_client):
    r = api_client.post("/dashboard/tiles", json={"message_id": "does-not-exist"})
    assert r.status_code == 404


def test_pin_non_completed_message_400(api_client):
    from db.session import create_db_session
    from db.models import Dataset, Conversation, Message

    with create_db_session() as s:
        ds = Dataset(name="x.csv", file_path="/tmp/x.csv", kind="csv", row_count=1)
        s.add(ds)
        s.flush()
        conv = Conversation(primary_dataset_id=ds.id, title="t")
        s.add(conv)
        s.flush()
        failed = Message(conversation_id=conv.id, role="assistant", content="boom", status="failed")
        s.add(failed)
        s.flush()
        user = Message(conversation_id=conv.id, role="user", content="q?", status="completed")
        s.add(user)
        s.flush()
        failed_id, user_id = failed.id, user.id

    assert api_client.post("/dashboard/tiles", json={"message_id": failed_id}).status_code == 400
    # a user message is not pinnable either
    assert api_client.post("/dashboard/tiles", json={"message_id": user_id}).status_code == 400


# --------------------------------------------------------------------------- #
# Ordering / display_order append
# --------------------------------------------------------------------------- #
def test_display_order_appends(api_client):
    s1 = _seed_completed_answer(question="q1")
    s2 = _seed_completed_answer(question="q2")
    t1 = api_client.post("/dashboard/tiles", json={"message_id": s1["message_id"]}).json()
    t2 = api_client.post("/dashboard/tiles", json={"message_id": s2["message_id"]}).json()
    assert t1["display_order"] == 0
    assert t2["display_order"] == 1
    ordered = [t["id"] for t in api_client.get("/dashboard/tiles").json()]
    assert ordered == [t1["id"], t2["id"]]


# --------------------------------------------------------------------------- #
# DELETE / unpin
# --------------------------------------------------------------------------- #
def test_delete_tile(api_client):
    seed = _seed_completed_answer()
    tile = api_client.post("/dashboard/tiles", json={"message_id": seed["message_id"]}).json()
    d = api_client.delete(f"/dashboard/tiles/{tile['id']}")
    assert d.status_code == 200
    assert d.json() == {"deleted": True}
    assert api_client.get("/dashboard/tiles").json() == []
    # re-delete → 404
    assert api_client.delete(f"/dashboard/tiles/{tile['id']}").status_code == 404


# --------------------------------------------------------------------------- #
# REORDER
# --------------------------------------------------------------------------- #
def test_reorder(api_client):
    s1 = _seed_completed_answer(question="q1")
    s2 = _seed_completed_answer(question="q2")
    s3 = _seed_completed_answer(question="q3")
    t1 = api_client.post("/dashboard/tiles", json={"message_id": s1["message_id"]}).json()
    t2 = api_client.post("/dashboard/tiles", json={"message_id": s2["message_id"]}).json()
    t3 = api_client.post("/dashboard/tiles", json={"message_id": s3["message_id"]}).json()

    new_order = [t3["id"], t1["id"], t2["id"]]
    r = api_client.patch("/dashboard/tiles/reorder", json={"order": new_order})
    assert r.status_code == 200
    assert [t["id"] for t in r.json()] == new_order
    # GET reflects it
    assert [t["id"] for t in api_client.get("/dashboard/tiles").json()] == new_order
    # incomplete / unknown set → 400
    assert api_client.patch("/dashboard/tiles/reorder", json={"order": [t1["id"]]}).status_code == 400
    assert api_client.patch(
        "/dashboard/tiles/reorder", json={"order": [t1["id"], t2["id"], "nope"]}
    ).status_code == 400


# --------------------------------------------------------------------------- #
# Persistence across restart
# --------------------------------------------------------------------------- #
def test_tiles_persist_across_restart(api_client, restart):
    seed = _seed_completed_answer()
    tile = api_client.post("/dashboard/tiles", json={"message_id": seed["message_id"]}).json()

    client2 = restart()
    arr = client2.get("/dashboard/tiles").json()
    assert [t["id"] for t in arr] == [tile["id"]]
    assert arr[0]["content"] == "Total revenue is highest in the East."
    assert arr[0]["chart"]["type"] == "bar"


# --------------------------------------------------------------------------- #
# Cascade — deleting the dataset removes its tiles (no orphans)
# --------------------------------------------------------------------------- #
def test_cascade_delete_dataset_removes_tiles(api_client):
    seed = _seed_completed_answer()
    api_client.post("/dashboard/tiles", json={"message_id": seed["message_id"]})
    assert len(api_client.get("/dashboard/tiles").json()) == 1

    d = api_client.delete(f"/datasets/{seed['dataset_id']}")
    assert d.status_code == 200
    assert api_client.get("/dashboard/tiles").json() == []


# --------------------------------------------------------------------------- #
# Rendering a tile touches no Gemini — the payload is fully self-contained
# --------------------------------------------------------------------------- #
def test_render_needs_no_llm(api_client):
    seed = _seed_completed_answer()
    api_client.post("/dashboard/tiles", json={"message_id": seed["message_id"]})
    arr = api_client.get("/dashboard/tiles").json()
    t = arr[0]
    # everything needed to render is on the tile itself
    for key in ("title", "content", "chart", "table", "dataset_name", "confidence"):
        assert key in t


# --------------------------------------------------------------------------- #
# Real-LLM pin: produce a completed answer via the runner, then pin it
# --------------------------------------------------------------------------- #
@pytest.mark.usefixtures("_require_llm_key")
def test_pin_real_answer(api_client, tmp_path):
    csv = tmp_path / "sales.csv"
    df = pd.DataFrame(
        {
            "region": ["East", "West", "North", "South"] * 15,
            "revenue": [float((i % 7) * 100 + 50) for i in range(60)],
        }
    )
    df.to_csv(csv, index=False)
    with open(csv, "rb") as f:
        ds = api_client.post("/datasets", files={"file": ("sales.csv", f, "text/csv")}).json()
    conv = api_client.post("/conversations", json={"primary_dataset_id": ds["id"]}).json()

    events = stream_query(api_client, conv["id"], "what is total revenue by region?")
    answer = next((e["data"] for e in events if e["event"] == "answer"), None)
    assert answer is not None and answer["status"] == "completed", events
    message_id = answer["message_id"]

    r = api_client.post("/dashboard/tiles", json={"message_id": message_id})
    assert r.status_code == 200, r.text
    tile = r.json()
    assert tile["message_id"] == message_id
    assert tile["content"] == answer["content"]
    assert tile["dataset_name"] == "sales.csv"
    # chart/table snapshot mirrors the answer
    assert tile["chart"] == answer["chart"]
    assert tile["table"] == answer["table"]
    assert "total revenue by region" in tile["title"].lower()

    listed = api_client.get("/dashboard/tiles").json()
    assert message_id in [t["message_id"] for t in listed]

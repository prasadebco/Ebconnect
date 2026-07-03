"""API contract tests — no LLM key required, graph is not invoked."""


def test_health(api_client):
    r = api_client.get("/health")
    assert r.status_code == 200
    assert r.json()["data"]["status"] == "ok"


def test_get_dataset_not_found(api_client):
    r = api_client.get("/datasets/nonexistent-id")
    assert r.status_code == 404


def test_create_conversation_unknown_dataset(api_client):
    r = api_client.post("/conversations", json={"primary_dataset_id": "nope"})
    assert r.status_code == 400


def test_query_empty_question_rejected(api_client, _isolated_db):
    from sqlalchemy.orm import Session
    from db.models import Dataset, Conversation

    with Session(_isolated_db) as s:
        ds = Dataset(name="t.csv", file_path="x", kind="csv", size_bytes=1, row_count=1)
        s.add(ds)
        s.commit()
        conv = Conversation(primary_dataset_id=ds.id, title="t")
        s.add(conv)
        s.commit()
        conv_id = conv.id

    r = api_client.post(f"/conversations/{conv_id}/query", json={"question": "   "})
    assert r.status_code == 400

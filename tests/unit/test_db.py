"""DB layer tests — no LLM key required.

The legacy skeleton `runs` table / `RunRow` model was pruned in Phase 4; these
tests exercise the real `Message` model instead.
"""
from sqlalchemy.orm import Session

from db.models import Conversation, Dataset, Message


def _make_conversation(s: Session) -> str:
    ds = Dataset(name="t.csv", file_path="/tmp/t.csv", kind="csv", row_count=3)
    s.add(ds)
    s.flush()
    conv = Conversation(primary_dataset_id=ds.id, title="c")
    s.add(conv)
    s.flush()
    return conv.id


def test_message_roundtrip(_isolated_db):
    with Session(_isolated_db) as s:
        conv_id = _make_conversation(s)
        msg = Message(conversation_id=conv_id, role="user", content="hello world")
        s.add(msg)
        s.commit()
        msg_id = msg.id

    with Session(_isolated_db) as s:
        fetched = s.get(Message, msg_id)
        assert fetched is not None
        assert fetched.content == "hello world"
        assert fetched.role == "user"
        assert fetched.status == "completed"


def test_message_telemetry_update(_isolated_db):
    with Session(_isolated_db) as s:
        conv_id = _make_conversation(s)
        msg = Message(conversation_id=conv_id, role="assistant", content="")
        s.add(msg)
        s.commit()
        msg_id = msg.id

    with Session(_isolated_db) as s:
        msg = s.get(Message, msg_id)
        msg.content = "the answer"
        msg.confidence = "high"
        msg.token_total = 1002
        msg.status = "completed"
        s.commit()

    with Session(_isolated_db) as s:
        msg = s.get(Message, msg_id)
        assert msg.content == "the answer"
        assert msg.confidence == "high"
        assert msg.token_total == 1002


def test_multiple_messages_independent(_isolated_db):
    with Session(_isolated_db) as s:
        conv_id = _make_conversation(s)
        for i in range(3):
            s.add(Message(conversation_id=conv_id, role="user", content=f"q {i}"))
        s.commit()
        ids = [m.id for m in s.query(Message).all()]

    assert len(ids) == 3
    assert len(set(ids)) == 3

import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import desc
from sqlalchemy.orm import Session

from api._common import api_error
from db.session import get_session
from db.models import Conversation, Dataset, Message
from graph.runner import run_query

router = APIRouter()


class CreateConversationRequest(BaseModel):
    primary_dataset_id: str
    title: str | None = None


class QueryRequest(BaseModel):
    question: str
    sheet_name: str | None = None


@router.post("/conversations")
def create_conversation(req: CreateConversationRequest, session: Session = Depends(get_session)) -> dict:
    dataset = session.get(Dataset, req.primary_dataset_id)
    if dataset is None:
        raise api_error("BAD_REQUEST", "Unknown dataset", 400)
    title = req.title or f"Chat over {dataset.name}"
    conv = Conversation(primary_dataset_id=req.primary_dataset_id, title=title)
    session.add(conv)
    session.flush()
    return {"id": conv.id, "primary_dataset_id": conv.primary_dataset_id, "title": conv.title}


@router.get("/conversations")
def list_conversations(session: Session = Depends(get_session)) -> list:
    """List conversations, most-recently-used first (powers 'reopen a past chat')."""
    rows = (
        session.query(Conversation)
        .order_by(desc(Conversation.last_used_at), desc(Conversation.created_at))
        .all()
    )
    ds_names = {
        d.id: d.name
        for d in session.query(Dataset.id, Dataset.name).all()
    } if rows else {}
    return [
        {
            "id": c.id,
            "primary_dataset_id": c.primary_dataset_id,
            "dataset_name": ds_names.get(c.primary_dataset_id),
            "title": c.title,
            "created_at": c.created_at.isoformat(),
            "last_used_at": c.last_used_at.isoformat(),
        }
        for c in rows
    ]


def _message_payload(m: Message) -> dict:
    return {
        "id": m.id,
        "role": m.role,
        "content": m.content,
        "chart": m.chart,
        "table": m.table,
        "code": m.code,
        "followups": m.followups or [],
        "confidence": m.confidence,
        "status": m.status,
        "token_prompt": m.token_prompt,
        "token_completion": m.token_completion,
        "token_total": m.token_total,
        "cost_usd": m.cost_usd,
        "steps": m.steps or [],
        "elapsed_ms": m.elapsed_ms,
        "error_message": m.error_message,
        "created_at": m.created_at.isoformat(),
    }


@router.get("/conversations/{conversation_id}")
def get_conversation(conversation_id: str, session: Session = Depends(get_session)) -> dict:
    """Full chat history so a reopened chat reloads prior turns."""
    conv = session.get(Conversation, conversation_id)
    if conv is None:
        raise api_error("NOT_FOUND", f"Conversation {conversation_id} not found", 404)
    dataset = session.get(Dataset, conv.primary_dataset_id)
    msgs = (
        session.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc(), Message.id.asc())
        .all()
    )
    return {
        "conversation": {
            "id": conv.id,
            "primary_dataset_id": conv.primary_dataset_id,
            "dataset_name": dataset.name if dataset else None,
            "title": conv.title,
            "created_at": conv.created_at.isoformat(),
            "last_used_at": conv.last_used_at.isoformat(),
        },
        "messages": [_message_payload(m) for m in msgs],
    }


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/conversations/{conversation_id}/query")
def query_conversation(conversation_id: str, req: QueryRequest, session: Session = Depends(get_session)):
    if not req.question or not req.question.strip():
        raise api_error("BAD_REQUEST", "Empty question", 400)
    conv = session.get(Conversation, conversation_id)
    if conv is None:
        raise api_error("BAD_REQUEST", "Unknown conversation", 400)

    def event_stream():
        for event, data in run_query(conversation_id, req.question.strip()):
            yield _sse(event, data)

    return StreamingResponse(event_stream(), media_type="text/event-stream")

import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api._common import api_error
from db.session import get_session
from db.models import Conversation, Dataset
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

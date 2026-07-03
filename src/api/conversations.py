import io
import json

from fastapi import APIRouter, Depends
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import desc
from sqlalchemy.orm import Session

from api._common import api_error
from db.session import get_session
from db.models import Conversation, ConversationDataset, Dataset, DatasetSheet, Message
from graph.runner import run_query

router = APIRouter()


class CreateConversationRequest(BaseModel):
    primary_dataset_id: str
    title: str | None = None


class QueryRequest(BaseModel):
    question: str
    sheet_name: str | None = None


class AttachRequest(BaseModel):
    dataset_id: str
    frame_alias: str


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
        "frames": _frame_list(session, conv),
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
        for event, data in run_query(conversation_id, req.question.strip(), req.sheet_name):
            yield _sse(event, data)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


def _frame_list(session: Session, conv: Conversation) -> list[dict]:
    """The frames currently bound to a conversation: the primary dataset (alias
    `df`) plus every attached dataset, in attach order."""
    frames: list[dict] = []
    primary = session.get(Dataset, conv.primary_dataset_id)
    if primary is not None:
        sheets = (
            session.query(DatasetSheet)
            .filter(DatasetSheet.dataset_id == primary.id)
            .all()
        )
        frames.append(
            {
                "alias": "df",
                "dataset_id": primary.id,
                "name": primary.name,
                "kind": primary.kind,
                "sheets": [{"name": s.name, "row_count": s.row_count} for s in sheets],
            }
        )
    links = (
        session.query(ConversationDataset)
        .filter(ConversationDataset.conversation_id == conv.id)
        .all()
    )
    for link in links:
        ds = session.get(Dataset, link.dataset_id)
        if ds is None:
            continue
        sheets = (
            session.query(DatasetSheet)
            .filter(DatasetSheet.dataset_id == ds.id)
            .all()
        )
        frames.append(
            {
                "alias": link.frame_alias,
                "dataset_id": ds.id,
                "name": ds.name,
                "kind": ds.kind,
                "sheets": [{"name": s.name, "row_count": s.row_count} for s in sheets],
            }
        )
    return frames


@router.post("/conversations/{conversation_id}/attach")
def attach_dataset(
    conversation_id: str, req: AttachRequest, session: Session = Depends(get_session)
) -> dict:
    """Attach another dataset to a conversation for multi-file joins."""
    conv = session.get(Conversation, conversation_id)
    if conv is None:
        raise api_error("BAD_REQUEST", "Unknown conversation", 400)
    ds = session.get(Dataset, req.dataset_id)
    if ds is None:
        raise api_error("BAD_REQUEST", "Unknown dataset", 400)
    alias = (req.frame_alias or "").strip()
    if not alias:
        raise api_error("BAD_REQUEST", "frame_alias is required", 400)
    if alias == "df":
        raise api_error("BAD_REQUEST", "'df' is reserved for the primary dataset", 400)

    existing = (
        session.query(ConversationDataset)
        .filter(ConversationDataset.conversation_id == conversation_id)
        .all()
    )
    if any(e.frame_alias == alias for e in existing):
        raise api_error("BAD_REQUEST", f"Alias '{alias}' is already attached", 400)
    if any(e.dataset_id == req.dataset_id for e in existing):
        raise api_error("BAD_REQUEST", "Dataset is already attached", 400)

    session.add(
        ConversationDataset(
            conversation_id=conversation_id,
            dataset_id=req.dataset_id,
            frame_alias=alias,
        )
    )
    session.flush()
    return {"frames": _frame_list(session, conv)}


def _export_csv(m: Message) -> Response:
    table = m.table
    if not table or not table.get("columns"):
        raise api_error("NOT_FOUND", "This answer has no table to export", 404)
    import pandas as pd

    df = pd.DataFrame(table.get("rows", []), columns=table["columns"])
    buf = io.StringIO()
    df.to_csv(buf, index=False)
    data = buf.getvalue().encode("utf-8")
    return Response(
        content=data,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="answer_{m.id}.csv"'},
    )


def _export_png(m: Message) -> Response:
    chart = m.chart
    if not chart or not chart.get("data"):
        raise api_error("NOT_FOUND", "This answer has no chart to export", 404)
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    rows = chart.get("data", [])
    x_col = chart.get("x")
    series = chart.get("series") or ([chart.get("y")] if chart.get("y") else [])
    labels = [str(r.get(x_col)) for r in rows]
    fig, ax = plt.subplots(figsize=(8, 4.5))
    n = max(len(series), 1)
    import numpy as np

    idx = np.arange(len(rows))
    width = 0.8 / n
    for i, s in enumerate(series):
        vals = [r.get(s) if isinstance(r.get(s), (int, float)) else 0 for r in rows]
        ax.bar(idx + i * width, vals, width, label=str(s))
    ax.set_xticks(idx + width * (n - 1) / 2)
    ax.set_xticklabels(labels, rotation=45, ha="right")
    ax.set_xlabel(str(x_col))
    if n > 1:
        ax.legend()
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=120)
    plt.close(fig)
    return Response(
        content=buf.getvalue(),
        media_type="image/png",
        headers={"Content-Disposition": f'attachment; filename="answer_{m.id}.png"'},
    )


@router.get("/conversations/{conversation_id}/messages/{message_id}/export")
def export_message(
    conversation_id: str,
    message_id: str,
    format: str = "csv",
    session: Session = Depends(get_session),
) -> Response:
    """Download an answer's result as CSV (table) or PNG (chart)."""
    m = session.get(Message, message_id)
    if m is None or m.conversation_id != conversation_id:
        raise api_error("NOT_FOUND", "Message not found", 404)
    fmt = (format or "csv").lower()
    if fmt == "csv":
        return _export_csv(m)
    if fmt == "png":
        return _export_png(m)
    raise api_error("BAD_REQUEST", "format must be 'csv' or 'png'", 400)

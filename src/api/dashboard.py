"""Pinnable-Dashboard endpoints (Phase 6).

Pins a completed assistant answer as a persistent ``DashboardTile`` snapshot so
the Dashboard renders saved results without re-running the query and without any
Gemini call. All endpoints return BARE objects/arrays (no envelope), consistent
with the other resource routers; failures raise ``api_error``.
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import asc, desc
from sqlalchemy.orm import Session

from api._common import api_error
from db.session import get_session
from db.models import Conversation, Dataset, DashboardTile, Message

router = APIRouter()


class PinRequest(BaseModel):
    message_id: str


class ReorderRequest(BaseModel):
    order: list[str]


def _tile_payload(t: DashboardTile) -> dict:
    return {
        "id": t.id,
        "message_id": t.message_id,
        "conversation_id": t.conversation_id,
        "dataset_id": t.dataset_id,
        "dataset_name": t.dataset_name,
        "title": t.title,
        "content": t.content,
        "chart": t.chart,
        "table": t.table,
        "confidence": t.confidence,
        "display_order": t.display_order,
        "created_at": t.created_at.isoformat(),
    }


def _question_for(session: Session, msg: Message) -> str:
    """The pinned assistant answer maps back to the immediately-preceding user
    question in the same conversation. Falls back to the answer's own content."""
    prior = (
        session.query(Message)
        .filter(
            Message.conversation_id == msg.conversation_id,
            Message.role == "user",
            Message.created_at <= msg.created_at,
            Message.id != msg.id,
        )
        .order_by(desc(Message.created_at), desc(Message.id))
        .first()
    )
    if prior is not None and (prior.content or "").strip():
        return prior.content.strip()
    return (msg.content or "").strip()[:200] or "Pinned answer"


@router.post("/dashboard/tiles")
def pin_tile(req: PinRequest, session: Session = Depends(get_session)) -> dict:
    """Pin a completed assistant answer. Idempotent: re-pinning the same message
    returns the existing tile rather than creating a duplicate."""
    msg = session.get(Message, req.message_id)
    if msg is None:
        raise api_error("NOT_FOUND", "Unknown message", 404)
    if msg.role != "assistant" or msg.status != "completed":
        raise api_error(
            "BAD_REQUEST",
            "Only a completed assistant answer can be pinned",
            400,
        )

    existing = (
        session.query(DashboardTile)
        .filter(DashboardTile.message_id == msg.id)
        .first()
    )
    if existing is not None:
        return _tile_payload(existing)

    conv = session.get(Conversation, msg.conversation_id)
    dataset_id = conv.primary_dataset_id if conv is not None else None
    dataset_name = ""
    if dataset_id is not None:
        ds = session.get(Dataset, dataset_id)
        if ds is not None:
            dataset_name = ds.name
        else:
            dataset_id = None

    next_order = (
        session.query(DashboardTile).count()
    )

    tile = DashboardTile(
        message_id=msg.id,
        conversation_id=msg.conversation_id,
        dataset_id=dataset_id,
        dataset_name=dataset_name,
        title=_question_for(session, msg),
        content=msg.content or "",
        chart=msg.chart,
        table=msg.table,
        confidence=msg.confidence,
        display_order=next_order,
    )
    session.add(tile)
    session.flush()
    return _tile_payload(tile)


@router.get("/dashboard/tiles")
def list_tiles(session: Session = Depends(get_session)) -> list:
    """All pinned tiles, ordered by display_order asc then newest-first."""
    rows = (
        session.query(DashboardTile)
        .order_by(asc(DashboardTile.display_order), desc(DashboardTile.created_at))
        .all()
    )
    return [_tile_payload(t) for t in rows]


@router.delete("/dashboard/tiles/{tile_id}")
def delete_tile(tile_id: str, session: Session = Depends(get_session)) -> dict:
    tile = session.get(DashboardTile, tile_id)
    if tile is None:
        raise api_error("NOT_FOUND", f"Tile {tile_id} not found", 404)
    session.delete(tile)
    return {"deleted": True}


@router.patch("/dashboard/tiles/reorder")
def reorder_tiles(req: ReorderRequest, session: Session = Depends(get_session)) -> list:
    """Re-sequence tiles: each tile's display_order becomes its index in `order`.
    400 if the id set is incomplete or contains an unknown id."""
    tiles = session.query(DashboardTile).all()
    existing_ids = {t.id for t in tiles}
    order = req.order or []
    if set(order) != existing_ids or len(order) != len(existing_ids):
        raise api_error(
            "BAD_REQUEST",
            "order must be a permutation of all existing tile ids",
            400,
        )
    by_id = {t.id: t for t in tiles}
    for idx, tid in enumerate(order):
        by_id[tid].display_order = idx
    session.flush()
    rows = (
        session.query(DashboardTile)
        .order_by(asc(DashboardTile.display_order), desc(DashboardTile.created_at))
        .all()
    )
    return [_tile_payload(t) for t in rows]

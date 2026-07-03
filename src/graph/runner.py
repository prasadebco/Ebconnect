"""Query runner — drives the LangGraph loop and yields SSE events.

Emits (event, data) tuples in the order:
    step (one per pipeline stage) → usage → answer      (or → error)
Persists the assistant Message with full telemetry when the run finalizes.
"""
import time
from collections.abc import Iterator

from sqlalchemy.orm import Session

from config.settings import get_settings
from db.session import create_db_session
from db.models import Conversation, Dataset, Message
from graph.agent import agentic_ai
from graph.state import AgentState
from observability.events import get_logger

_log = get_logger("runner")

_STEP_LABELS = {
    "plan": "Profiling data…",
    "write_code": "Writing query…",
    "execute_local": "Running locally…",
    "verify": "Verifying result…",
    "reflect": "Rethinking approach…",
    "answer": "Composing answer…",
}


def _load_prior_messages(session: Session, conversation_id: str) -> list[dict]:
    rows = (
        session.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
        .all()
    )
    return [{"role": r.role, "content": r.content} for r in rows]


def _build_frames_and_profile(dataset: Dataset) -> tuple[dict, dict, list]:
    """Return (frames, profile, row_sample) for the agent state."""
    frames = {"df": dataset.cache_path or dataset.file_path}
    # rebuild a compact profile + sample from the stored file for the prompt
    from profiling.profiler import profile_csv

    prof = profile_csv(dataset.file_path, sample_rows=get_settings().sample_rows)
    profile = {"row_count": prof["row_count"], "columns": prof["columns"]}
    return frames, profile, prof["sample_rows"]


def run_query(conversation_id: str, question: str) -> Iterator[tuple[str, dict]]:
    started = time.monotonic()
    settings = get_settings()

    # --- load context + persist the user turn ---
    with create_db_session() as session:
        conv = session.get(Conversation, conversation_id)
        if conv is None:
            yield ("error", {"message": "unknown conversation"})
            return
        dataset = session.get(Dataset, conv.primary_dataset_id)
        if dataset is None:
            yield ("error", {"message": "conversation has no dataset"})
            return

        prior = _load_prior_messages(session, conversation_id)
        frames, profile, row_sample = _build_frames_and_profile(dataset)

        session.add(Message(conversation_id=conversation_id, role="user", content=question, status="completed"))
        _now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
        conv.last_used_at = _now
        # bump dataset recency too so the library orders by recent use (Phase 2)
        dataset.last_used_at = _now

    initial: AgentState = {
        "run_id": conversation_id,
        "conversation_id": conversation_id,
        "question": question,
        "messages": prior,
        "profile": profile,
        "frames": frames,
        "row_sample": row_sample,
        "token_usage": {"prompt": 0, "completion": 0, "total": 0},
        "cost_usd": 0.0,
        "steps": [],
        "error": None,
    }

    accum: dict = dict(initial)
    emitted_steps: list[str] = []
    try:
        for chunk in agentic_ai.stream(initial):
            for node, partial in chunk.items():
                if isinstance(partial, dict):
                    accum.update(partial)
                label = _STEP_LABELS.get(node)
                if label and label not in emitted_steps:
                    emitted_steps.append(label)
                    yield ("step", {"label": label})
    except Exception as exc:  # noqa: BLE001
        _log.error("run.exception", error=str(exc))
        accum["error"] = str(exc)
        accum["status"] = "failed"

    elapsed_ms = int((time.monotonic() - started) * 1000)
    accum["elapsed_ms"] = elapsed_ms
    accum["steps"] = emitted_steps
    usage = accum.get("token_usage", {"prompt": 0, "completion": 0, "total": 0})
    cost = accum.get("cost_usd", 0.0)
    status = accum.get("status", "completed")

    _log.info(
        "run.complete",
        conversation_id=conversation_id,
        status=status,
        attempts=accum.get("attempts", 0),
        tokens=usage.get("total"),
        cost_usd=cost,
        elapsed_ms=elapsed_ms,
    )

    # --- persist assistant turn ---
    message_id = None
    with create_db_session() as session:
        msg = Message(
            conversation_id=conversation_id,
            role="assistant",
            content=accum.get("answer_text") or "",
            chart=accum.get("chart"),
            table=accum.get("table"),
            code=accum.get("code"),
            followups=accum.get("followups"),
            confidence=accum.get("confidence"),
            status=status,
            token_prompt=usage.get("prompt"),
            token_completion=usage.get("completion"),
            token_total=usage.get("total"),
            cost_usd=cost,
            steps=emitted_steps,
            elapsed_ms=elapsed_ms,
            error_message=accum.get("error") if status == "failed" else None,
        )
        session.add(msg)
        session.flush()
        message_id = msg.id

    if status == "failed":
        yield ("error", {"message": accum.get("error") or "the analysis failed"})
        return

    yield ("usage", {
        "prompt": usage.get("prompt", 0),
        "completion": usage.get("completion", 0),
        "total": usage.get("total", 0),
        "cost_usd": cost,
        "elapsed_ms": elapsed_ms,
    })
    yield ("answer", {
        "message_id": message_id,
        "content": accum.get("answer_text") or "",
        "chart": accum.get("chart"),
        "table": accum.get("table"),
        "code": accum.get("code"),
        "followups": accum.get("followups") or [],
        "confidence": accum.get("confidence") or "high",
        "status": status,
    })

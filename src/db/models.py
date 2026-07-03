from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Text, TIMESTAMP, Integer, Float, JSON, ForeignKey
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def _uuid() -> str:
    return str(uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class RunRow(Base):
    """Legacy skeleton table — retained for backwards compatibility."""

    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=_uuid)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="pending")
    input_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    output_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, default=_now, onupdate=_now
    )


class Dataset(Base):
    __tablename__ = "datasets"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    cache_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    kind: Mapped[str] = mapped_column(Text, nullable=False, default="csv")
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    row_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, default=_now
    )
    last_used_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, default=_now
    )


class DatasetSheet(Base):
    __tablename__ = "dataset_sheets"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=_uuid)
    dataset_id: Mapped[str] = mapped_column(
        Text, ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False, default="__default__")
    row_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_path: Mapped[str | None] = mapped_column(Text, nullable=True)


class DatasetColumn(Base):
    __tablename__ = "dataset_columns"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=_uuid)
    dataset_id: Mapped[str] = mapped_column(
        Text, ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False
    )
    sheet_id: Mapped[str | None] = mapped_column(
        Text, ForeignKey("dataset_sheets.id", ondelete="CASCADE"), nullable=True
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    dtype: Mapped[str] = mapped_column(Text, nullable=False)
    null_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    distinct_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    min_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    max_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    samples: Mapped[list | None] = mapped_column(JSON, nullable=True)


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(Text, nullable=False, default="New conversation")
    primary_dataset_id: Mapped[str] = mapped_column(
        Text, ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, default=_now
    )
    last_used_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, default=_now
    )


class ConversationDataset(Base):
    __tablename__ = "conversation_datasets"

    conversation_id: Mapped[str] = mapped_column(
        Text, ForeignKey("conversations.id", ondelete="CASCADE"), primary_key=True
    )
    dataset_id: Mapped[str] = mapped_column(
        Text, ForeignKey("datasets.id", ondelete="CASCADE"), primary_key=True
    )
    frame_alias: Mapped[str] = mapped_column(Text, nullable=False, default="df")


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=_uuid)
    conversation_id: Mapped[str] = mapped_column(
        Text, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(Text, nullable=False)  # user | assistant
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    chart: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    table: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    code: Mapped[str | None] = mapped_column(Text, nullable=True)
    followups: Mapped[list | None] = mapped_column(JSON, nullable=True)
    confidence: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="completed")
    token_prompt: Mapped[int | None] = mapped_column(Integer, nullable=True)
    token_completion: Mapped[int | None] = mapped_column(Integer, nullable=True)
    token_total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    steps: Mapped[list | None] = mapped_column(JSON, nullable=True)
    elapsed_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, default=_now
    )

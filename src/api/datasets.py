import shutil
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, UploadFile, File
from sqlalchemy import desc
from sqlalchemy.orm import Session

from api._common import api_error
from config.settings import get_settings
from db.session import get_session
from db.models import (
    Dataset,
    DatasetSheet,
    DatasetColumn,
    Conversation,
    ConversationDataset,
    Message,
)
from profiling.profiler import profile_csv, profile_xlsx

router = APIRouter()


def _uploads_dir() -> Path:
    d = Path(get_settings().uploads_dir)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _column_payload(col: DatasetColumn) -> dict:
    return {
        "name": col.name,
        "dtype": col.dtype,
        "null_count": col.null_count,
        "distinct_count": col.distinct_count,
        "min_value": col.min_value,
        "max_value": col.max_value,
        "samples": col.samples or [],
    }


@router.post("/datasets")
def create_dataset(file: UploadFile = File(...), session: Session = Depends(get_session)) -> dict:
    if not file or not file.filename:
        raise api_error("BAD_REQUEST", "Missing file", 400)
    name = file.filename
    lname = name.lower()
    if lname.endswith(".csv"):
        kind = "csv"
    elif lname.endswith((".xlsx", ".xls")):
        kind = "xlsx"
    else:
        raise api_error("BAD_REQUEST", "Unsupported file type — upload a .csv or .xlsx", 400)

    settings = get_settings()
    dataset_id = str(uuid4())
    dest = _uploads_dir() / f"{dataset_id}_{name}"

    size = 0
    try:
        with dest.open("wb") as out:
            while True:
                chunk = file.file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    out.close()
                    dest.unlink(missing_ok=True)
                    raise api_error("BAD_REQUEST", "File exceeds the 100MB size cap", 400)
                out.write(chunk)
    except Exception as exc:
        if isinstance(exc, Exception) and dest.exists():
            dest.unlink(missing_ok=True)
        if hasattr(exc, "status_code"):
            raise
        raise api_error("STORAGE_ERROR", f"Failed to store file: {exc}", 500)

    if size == 0:
        dest.unlink(missing_ok=True)
        raise api_error("BAD_REQUEST", "Uploaded file is empty", 400)

    # Normalise every dataset (csv or xlsx) into a list of profiled sheets so
    # the sandbox can read each sheet as a fast parquet frame.
    try:
        if kind == "csv":
            cache_path = str(dest.with_suffix(dest.suffix + ".parquet"))
            prof = profile_csv(str(dest), cache_path=cache_path, sample_rows=settings.sample_rows)
            sheet_profiles = [
                {
                    "name": "__default__",
                    "row_count": prof["row_count"],
                    "columns": prof["columns"],
                    "cache_path": prof.get("cache_path"),
                }
            ]
        else:
            xprof = profile_xlsx(
                str(dest),
                cache_dir=str(dest.parent),
                cache_prefix=f"{dataset_id}",
                sample_rows=settings.sample_rows,
            )
            sheet_profiles = xprof["sheets"]
    except Exception as exc:
        dest.unlink(missing_ok=True)
        raise api_error("UNPROCESSABLE", f"Could not parse/profile the file: {exc}", 422)

    default_row_count = sheet_profiles[0]["row_count"]
    now = datetime.now(timezone.utc)
    dataset = Dataset(
        id=dataset_id,
        name=name,
        file_path=str(dest.resolve()),
        cache_path=sheet_profiles[0].get("cache_path"),
        kind=kind,
        size_bytes=size,
        row_count=default_row_count,
        created_at=now,
        last_used_at=now,
    )
    session.add(dataset)

    all_columns: list[DatasetColumn] = []
    for sp in sheet_profiles:
        sheet = DatasetSheet(
            dataset_id=dataset_id,
            name=sp["name"],
            row_count=sp["row_count"],
            cache_path=sp.get("cache_path"),
        )
        session.add(sheet)
        session.flush()
        for c in sp["columns"]:
            col = DatasetColumn(
                dataset_id=dataset_id,
                sheet_id=sheet.id,
                name=c["name"],
                dtype=c["dtype"],
                null_count=c["null_count"],
                distinct_count=c.get("distinct_count"),
                min_value=c.get("min_value"),
                max_value=c.get("max_value"),
                samples=c.get("samples"),
            )
            session.add(col)
            all_columns.append(col)

    return {
        "id": dataset_id,
        "name": name,
        "kind": kind,
        "row_count": default_row_count,
        "sheets": [{"name": sp["name"], "row_count": sp["row_count"]} for sp in sheet_profiles],
        "columns": [_column_payload(c) for c in all_columns],
    }


@router.get("/datasets")
def list_datasets(session: Session = Depends(get_session)) -> list:
    """List the persistent library, ordered by most-recently-used first."""
    rows = (
        session.query(Dataset)
        .order_by(desc(Dataset.last_used_at), desc(Dataset.created_at))
        .all()
    )
    return [
        {
            "id": d.id,
            "name": d.name,
            "kind": d.kind,
            "row_count": d.row_count,
            "created_at": d.created_at.isoformat(),
            "last_used_at": d.last_used_at.isoformat(),
        }
        for d in rows
    ]


@router.delete("/datasets/{dataset_id}")
def delete_dataset(dataset_id: str, session: Session = Depends(get_session)) -> dict:
    """Remove a dataset from the library, delete its raw file + parquet cache,
    and clean up all dependent rows (conversations, messages, links, sheets,
    columns). SQLite does not enforce ON DELETE CASCADE, so we delete explicitly.
    """
    dataset = session.get(Dataset, dataset_id)
    if dataset is None:
        raise api_error("NOT_FOUND", f"Dataset {dataset_id} not found", 404)

    # remove raw file + parquet cache from disk (best-effort)
    for p in (dataset.file_path, dataset.cache_path):
        if p:
            try:
                Path(p).unlink(missing_ok=True)
            except OSError:
                pass

    # conversations opened over this dataset (+ their messages)
    conv_ids = [
        c.id
        for c in session.query(Conversation)
        .filter(Conversation.primary_dataset_id == dataset_id)
        .all()
    ]
    if conv_ids:
        session.query(Message).filter(Message.conversation_id.in_(conv_ids)).delete(
            synchronize_session=False
        )
        session.query(Conversation).filter(Conversation.id.in_(conv_ids)).delete(
            synchronize_session=False
        )

    # link rows attaching this dataset to any conversation (Phase 3)
    session.query(ConversationDataset).filter(
        ConversationDataset.dataset_id == dataset_id
    ).delete(synchronize_session=False)

    # profile rows
    session.query(DatasetColumn).filter(
        DatasetColumn.dataset_id == dataset_id
    ).delete(synchronize_session=False)
    session.query(DatasetSheet).filter(
        DatasetSheet.dataset_id == dataset_id
    ).delete(synchronize_session=False)

    session.delete(dataset)
    return {"deleted": True}


@router.get("/datasets/{dataset_id}")
def get_dataset(dataset_id: str, session: Session = Depends(get_session)) -> dict:
    dataset = session.get(Dataset, dataset_id)
    if dataset is None:
        raise api_error("NOT_FOUND", f"Dataset {dataset_id} not found", 404)
    cols = (
        session.query(DatasetColumn)
        .filter(DatasetColumn.dataset_id == dataset_id)
        .all()
    )
    sheets = (
        session.query(DatasetSheet)
        .filter(DatasetSheet.dataset_id == dataset_id)
        .all()
    )
    cols_by_sheet: dict[str | None, list] = {}
    for c in cols:
        cols_by_sheet.setdefault(c.sheet_id, []).append(c)
    return {
        "id": dataset.id,
        "name": dataset.name,
        "kind": dataset.kind,
        "row_count": dataset.row_count,
        "size_bytes": dataset.size_bytes,
        "created_at": dataset.created_at.isoformat(),
        "last_used_at": dataset.last_used_at.isoformat(),
        "sheets": [
            {
                "name": s.name,
                "row_count": s.row_count,
                "columns": [_column_payload(c) for c in cols_by_sheet.get(s.id, [])],
            }
            for s in sheets
        ],
        "columns": [_column_payload(c) for c in cols],
    }

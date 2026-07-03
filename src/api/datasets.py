import shutil
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, UploadFile, File
from sqlalchemy.orm import Session

from api._common import api_error
from config.settings import get_settings
from db.session import get_session
from db.models import Dataset, DatasetSheet, DatasetColumn
from profiling.profiler import profile_csv

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
    if not name.lower().endswith(".csv"):
        raise api_error("BAD_REQUEST", "Only CSV files are supported in Phase 1", 400)

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

    cache_path = str(dest.with_suffix(dest.suffix + ".parquet"))
    try:
        prof = profile_csv(str(dest), cache_path=cache_path, sample_rows=settings.sample_rows)
    except Exception as exc:
        dest.unlink(missing_ok=True)
        raise api_error("UNPROCESSABLE", f"Could not parse/profile the file: {exc}", 422)

    now = datetime.now(timezone.utc)
    dataset = Dataset(
        id=dataset_id,
        name=name,
        file_path=str(dest.resolve()),
        cache_path=prof.get("cache_path"),
        kind="csv",
        size_bytes=size,
        row_count=prof["row_count"],
        created_at=now,
        last_used_at=now,
    )
    session.add(dataset)

    sheet = DatasetSheet(dataset_id=dataset_id, name="__default__", row_count=prof["row_count"])
    session.add(sheet)
    session.flush()

    columns = []
    for c in prof["columns"]:
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
        columns.append(col)

    return {
        "id": dataset_id,
        "name": name,
        "kind": "csv",
        "row_count": prof["row_count"],
        "sheets": [{"name": "__default__", "row_count": prof["row_count"]}],
        "columns": [_column_payload(c) for c in columns],
    }


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
    return {
        "id": dataset.id,
        "name": dataset.name,
        "kind": dataset.kind,
        "row_count": dataset.row_count,
        "size_bytes": dataset.size_bytes,
        "created_at": dataset.created_at.isoformat(),
        "last_used_at": dataset.last_used_at.isoformat(),
        "sheets": [{"name": s.name, "row_count": s.row_count} for s in sheets],
        "columns": [_column_payload(c) for c in cols],
    }

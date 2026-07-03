"""CSV profiling.

Produces the compact profile (column names, dtypes, null/distinct counts,
numeric ranges, a few sample values, row count) plus a small capped ROW SAMPLE.
The profile + the capped sample + the question are the ONLY data ever sent to
the LLM — the full dataset never leaves the machine. A parquet cache is written
alongside the raw file for fast re-reads.
"""
import json
import math
from pathlib import Path

import pandas as pd

from config.settings import get_settings


def _clean_scalar(v):
    if v is None:
        return None
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    try:
        # numpy scalar -> python scalar
        v = v.item()
    except AttributeError:
        pass
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v


def _profile_dataframe(df: pd.DataFrame, sample_rows: int) -> dict:
    columns = []
    for name in df.columns:
        col = df[name]
        dtype = str(col.dtype)
        entry = {
            "name": str(name),
            "dtype": dtype,
            "null_count": int(col.isna().sum()),
            "distinct_count": int(col.nunique(dropna=True)),
            "min_value": None,
            "max_value": None,
            "samples": [],
        }
        if pd.api.types.is_numeric_dtype(col) or pd.api.types.is_datetime64_any_dtype(col):
            non_null = col.dropna()
            if not non_null.empty:
                entry["min_value"] = str(_clean_scalar(non_null.min()))
                entry["max_value"] = str(_clean_scalar(non_null.max()))
        # up to 5 example values (part of the capped LLM sample)
        vals = col.dropna().unique()[:5]
        entry["samples"] = [_clean_scalar(v) for v in vals.tolist()]
        columns.append(entry)

    # capped row sample — the ONLY row-level data that may go to the LLM
    head = df.head(sample_rows)
    sample_records = json.loads(head.to_json(orient="records", date_format="iso", default_handler=str))

    return {
        "row_count": int(len(df)),
        "columns": columns,
        "sample_rows": sample_records,
    }


def profile_csv(file_path: str, cache_path: str | None = None, sample_rows: int | None = None) -> dict:
    """Profile a CSV file. Writes a parquet cache when `cache_path` is given.

    Returns {row_count, columns:[...], sample_rows:[...], cache_path}.
    """
    if sample_rows is None:
        sample_rows = get_settings().sample_rows

    df = pd.read_csv(file_path)
    profile = _profile_dataframe(df, sample_rows)

    written_cache = None
    if cache_path:
        try:
            Path(cache_path).parent.mkdir(parents=True, exist_ok=True)
            df.to_parquet(cache_path)
            written_cache = cache_path
        except Exception:
            written_cache = None
    profile["cache_path"] = written_cache
    return profile

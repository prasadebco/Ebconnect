import pandas as pd

from profiling.profiler import profile_csv


def _write_csv(path, rows=100):
    regions = ["East", "West", "North", "South"]
    data = {
        "region": [regions[i % 4] for i in range(rows)],
        "revenue": [float(i * 10) for i in range(rows)],
        "note": [f"row_note_{i}" for i in range(rows)],
    }
    pd.DataFrame(data).to_csv(path, index=False)


def test_profile_columns_types_and_rowcount(tmp_path):
    csv = tmp_path / "sales.csv"
    _write_csv(csv, rows=100)
    prof = profile_csv(str(csv), sample_rows=20)

    assert prof["row_count"] == 100
    names = {c["name"] for c in prof["columns"]}
    assert names == {"region", "revenue", "note"}

    by_name = {c["name"]: c for c in prof["columns"]}
    assert by_name["region"]["dtype"] in ("object", "str")
    assert "float" in by_name["revenue"]["dtype"]
    assert by_name["region"]["distinct_count"] == 4
    assert by_name["region"]["null_count"] == 0
    # numeric range populated
    assert by_name["revenue"]["min_value"] == "0.0"
    assert by_name["revenue"]["max_value"] == "990.0"


def test_sample_is_capped_and_not_full_data(tmp_path):
    csv = tmp_path / "sales.csv"
    _write_csv(csv, rows=100)
    prof = profile_csv(str(csv), sample_rows=20)

    # only the capped sample rows are exposed (never the full 100)
    assert len(prof["sample_rows"]) <= 20
    assert len(prof["sample_rows"]) < prof["row_count"]
    # a distinctive cell that lives only beyond the sample must be absent
    dumped = str(prof["sample_rows"])
    assert "row_note_77" not in dumped


def test_parquet_cache_written(tmp_path):
    csv = tmp_path / "sales.csv"
    _write_csv(csv, rows=30)
    cache = tmp_path / "sales.parquet"
    prof = profile_csv(str(csv), cache_path=str(cache), sample_rows=10)
    assert prof["cache_path"] == str(cache)
    assert cache.exists()
    # cache round-trips to the same row count
    assert len(pd.read_parquet(cache)) == 30

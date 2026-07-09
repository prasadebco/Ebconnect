import pandas as pd

from sandbox import execute


def _make_csv(tmp_path, rows=50):
    regions = ["East", "West", "North", "South"]
    df = pd.DataFrame({
        "region": [regions[i % 4] for i in range(rows)],
        "revenue": [float(i * 10) for i in range(rows)],
    })
    p = tmp_path / "data.csv"
    df.to_csv(p, index=False)
    return str(p), df


def test_sandbox_runs_safe_code_returns_table(tmp_path):
    path, df = _make_csv(tmp_path)
    code = "result = df.groupby('region')['revenue'].sum().reset_index()"
    res = execute(code, {"df": path}, timeout=25)

    assert res["ok"] is True
    assert res["error"] is None
    rj = res["result_json"]
    assert rj["kind"] == "table"
    assert set(rj["columns"]) == {"region", "revenue"}
    # verify numbers against ground-truth pandas
    expected = df.groupby("region")["revenue"].sum().to_dict()
    got = {r["region"]: r["revenue"] for r in rj["rows"]}
    assert got == expected


def test_sandbox_scalar_result(tmp_path):
    path, df = _make_csv(tmp_path)
    res = execute("result = float(df['revenue'].sum())", {"df": path}, timeout=25)
    assert res["ok"] is True
    assert res["result_json"]["kind"] == "scalar"
    assert res["result_json"]["value"] == float(df["revenue"].sum())


def test_sandbox_reports_user_error(tmp_path):
    path, _ = _make_csv(tmp_path)
    res = execute("result = df['does_not_exist'].sum()", {"df": path}, timeout=25)
    assert res["ok"] is False
    assert res["error"] is not None
    assert res["traceback"] is not None


def test_sandbox_kills_runaway_via_timeout(tmp_path):
    path, _ = _make_csv(tmp_path)
    res = execute("\nwhile True:\n    pass\n", {"df": path}, timeout=5)
    assert res["ok"] is False
    assert "timed out" in (res["error"] or "").lower()


def test_sandbox_blocks_import(tmp_path):
    path, _ = _make_csv(tmp_path)
    res = execute("import os\nresult = os.getcwd()", {"df": path}, timeout=25)
    assert res["ok"] is False
    assert res["error"] is not None

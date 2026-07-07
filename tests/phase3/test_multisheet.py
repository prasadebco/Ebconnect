"""Phase-3 Excel multi-sheet — real Gemini (.env) + real SQLite.

Upload an .xlsx with 2+ sheets → assert every sheet is listed with its correct
row_count and profiled columns; then ask a question against a CHOSEN sheet and
verify the answer against a ground-truth pandas computation on that sheet.
"""
import pandas as pd
import pytest

from _realllm import skip_if_quota


def _build_workbook(path):
    regions = ["East", "West", "North", "South"]
    sales = pd.DataFrame(
        {
            "region": [regions[i % 4] for i in range(80)],
            "revenue": [float((i % 7) * 100 + 50) for i in range(80)],
        }
    )
    products = pd.DataFrame(
        {
            "product": [f"P{i}" for i in range(30)],
            "units": [int((i % 5) + 1) for i in range(30)],
        }
    )
    with pd.ExcelWriter(path) as xw:
        sales.to_excel(xw, sheet_name="sales", index=False)
        products.to_excel(xw, sheet_name="products", index=False)
    return sales, products


def test_xlsx_profiles_every_sheet(api_client, tmp_path):
    path = tmp_path / "book.xlsx"
    sales, products = _build_workbook(path)

    with path.open("rb") as f:
        r = api_client.post(
            "/datasets",
            files={"file": ("book.xlsx", f, "application/octet-stream")},
        )
    assert r.status_code == 200, r.text
    ds = r.json()
    assert ds["kind"] == "xlsx"

    sheets = {s["name"]: s["row_count"] for s in ds["sheets"]}
    assert sheets == {"sales": len(sales), "products": len(products)}

    detail = api_client.get(f"/datasets/{ds['id']}").json()
    by_name = {s["name"]: s for s in detail["sheets"]}
    assert {c["name"] for c in by_name["sales"]["columns"]} == {"region", "revenue"}
    assert {c["name"] for c in by_name["products"]["columns"]} == {"product", "units"}


@pytest.mark.usefixtures("_require_llm_key")
def test_query_against_chosen_sheet(api_client, tmp_path, parse_sse, answer_event):
    path = tmp_path / "book.xlsx"
    sales, _ = _build_workbook(path)
    ground_truth = sales.groupby("region")["revenue"].sum().round(4).to_dict()

    with path.open("rb") as f:
        ds = api_client.post(
            "/datasets", files={"file": ("book.xlsx", f, "application/octet-stream")}
        ).json()
    conv = api_client.post("/conversations", json={"primary_dataset_id": ds["id"]}).json()

    r = api_client.post(
        f"/conversations/{conv['id']}/query",
        json={"question": "what is total revenue by region?", "sheet_name": "sales"},
    )
    assert r.status_code == 200, r.text
    events = parse_sse(r.text)
    skip_if_quota(events)
    assert "error" not in [e["event"] for e in events]
    ans = answer_event(events)
    assert ans["status"] == "completed"
    assert ans["table"] is not None
    got = {row["region"]: round(float(row["revenue"]), 4) for row in ans["table"]["rows"]}
    assert got == ground_truth

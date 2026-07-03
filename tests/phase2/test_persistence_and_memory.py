"""Phase-2 acceptance against REAL Gemini + real SQLite:

  1. persistence across a simulated process restart (datasets + conversations +
     full message history survive), and
  2. follow-up memory — a second question in the same conversation resolves
     against the prior turn's result ("now break that down by month").
"""
import pandas as pd
import pytest


def _build_sales_csv(path, rows=60):
    regions = ["East", "West", "North", "South"]
    df = pd.DataFrame(
        {
            "region": [regions[i % 4] for i in range(rows)],
            "revenue": [float((i % 7) * 100 + 50) for i in range(rows)],
        }
    )
    df.to_csv(path, index=False)
    return df


def _build_dated_csv(path):
    """Region + amount + a real date column spanning 6 months, so both
    'by region' and 'by month' are answerable."""
    rows = []
    regions = ["East", "West"]
    for month in range(1, 7):  # 2024-01 .. 2024-06
        for day in range(1, 6):  # 5 rows per month
            r = regions[(month + day) % 2]
            amount = float(month * 100 + day)  # deterministic
            rows.append({"order_date": f"2024-{month:02d}-{day:02d}", "region": r, "amount": amount})
    df = pd.DataFrame(rows)
    df.to_csv(path, index=False)
    return df


def _upload(client, path, name):
    with open(path, "rb") as f:
        r = client.post("/datasets", files={"file": (name, f, "text/csv")})
    assert r.status_code == 200, r.text
    return r.json()


def _run_query(client, conv_id, question):
    r = client.post(f"/conversations/{conv_id}/query", json={"question": question})
    assert r.status_code == 200, r.text
    return _parse_sse(r.text)


def _parse_sse(text):
    events, cur = [], {}
    for line in text.splitlines():
        if line.startswith("event:"):
            cur["event"] = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            import json
            cur["data"] = json.loads(line.split(":", 1)[1].strip())
        elif line == "" and cur:
            events.append(cur)
            cur = {}
    if cur:
        events.append(cur)
    return events


def _row_amounts(table):
    """The dominant numeric measure per row (the amount, not a month index)."""
    out = []
    for row in table["rows"]:
        nums = [
            float(v)
            for v in row.values()
            if isinstance(v, (int, float)) and not isinstance(v, bool)
        ]
        if nums:
            out.append(round(max(nums, key=abs), 2))
    return out


# --------------------------------------------------------------------------- #
# Persistence across restart
# --------------------------------------------------------------------------- #
@pytest.mark.usefixtures("_require_llm_key")
def test_persistence_across_restart(api_client, tmp_path, restart):
    # two datasets uploaded in the first "session"
    a = tmp_path / "sales_a.csv"
    b = tmp_path / "sales_b.csv"
    df_a = _build_sales_csv(a)
    _build_sales_csv(b)
    ds_a = _upload(api_client, a, "sales_a.csv")
    ds_b = _upload(api_client, b, "sales_b.csv")

    conv = api_client.post("/conversations", json={"primary_dataset_id": ds_a["id"]}).json()

    # one real turn so there is chat history to persist
    events = _run_query(api_client, conv["id"], "what is the total revenue by region?")
    assert "answer" in [e["event"] for e in events]
    assert "error" not in [e["event"] for e in events]

    # --- simulate a process restart: new engine/client on the same DB file ---
    client2 = restart()

    # datasets survive
    ds_ids = [d["id"] for d in client2.get("/datasets").json()]
    assert set(ds_ids) == {ds_a["id"], ds_b["id"]}
    # ds_a was just used → most recent
    assert ds_ids[0] == ds_a["id"]

    # conversation survives + is listable
    convs = client2.get("/conversations").json()
    assert conv["id"] in [c["id"] for c in convs]

    # full prior history reloads: user question + assistant answer
    detail = client2.get(f"/conversations/{conv['id']}").json()
    msgs = detail["messages"]
    roles = [m["role"] for m in msgs]
    assert "user" in roles and "assistant" in roles
    user_msg = next(m for m in msgs if m["role"] == "user")
    assert "total revenue by region" in user_msg["content"].lower()
    assistant = next(m for m in msgs if m["role"] == "assistant")
    assert assistant["status"] == "completed"
    assert assistant["content"]
    assert assistant["token_total"] and assistant["token_total"] > 0


# --------------------------------------------------------------------------- #
# Follow-up memory
# --------------------------------------------------------------------------- #
@pytest.mark.usefixtures("_require_llm_key")
def test_followup_uses_prior_turn(api_client, tmp_path):
    from graph import nodes

    csv = tmp_path / "orders.csv"
    df = _build_dated_csv(csv)
    ds = _upload(api_client, csv, "orders.csv")
    conv = api_client.post("/conversations", json={"primary_dataset_id": ds["id"]}).json()

    # turn 1 — establishes "revenue by region" as context
    ev1 = _run_query(api_client, conv["id"], "what is the total revenue by region?")
    assert "error" not in [e["event"] for e in ev1]

    # turn 2 — a pronoun-style follow-up that only resolves with prior context
    nodes._prompt_log.clear()
    ev2 = _run_query(api_client, conv["id"], "now break that down by month")
    assert "error" not in [e["event"] for e in ev2]
    answer = next(e["data"] for e in ev2 if e["event"] == "answer")
    assert answer["status"] == "completed"
    assert answer["table"] is not None

    # ground truth on the FULL data
    dt = pd.to_datetime(df["order_date"])
    gt_month = df.groupby(dt.dt.month)["amount"].sum().round(2)
    assert len(gt_month) == 6  # six distinct months
    grand_total = round(float(df["amount"].sum()), 2)

    rows = answer["table"]["rows"]
    # a month dimension was added on top of the prior "by region" turn:
    # at least one row per month (pure-month => 6 rows; month×region => 12).
    assert len(rows) >= 6

    amounts = _row_amounts(answer["table"])
    # the breakdown is a correct decomposition of the grand total (works for a
    # pure per-month breakdown OR a month×region one that preserved the region
    # split from the prior turn).
    assert amounts
    assert abs(sum(amounts) - grand_total) < 1.0, (
        f"breakdown sum {sum(amounts)} != grand total {grand_total}"
    )

    # prior-turn context was actually passed to the graph: the write_code prompt
    # carries the PRIOR CONVERSATION block referencing turn 1.
    wc_prompts = [p for tag, p in nodes._prompt_log if tag == "write_code"]
    assert wc_prompts
    joined = "\n".join(wc_prompts)
    assert "PRIOR CONVERSATION" in joined
    assert "region" in joined.lower()

# Data-Analysis Agent

Upload a CSV or Excel file, ask questions in plain English, and get a verified
answer — a short prose explanation, the underlying table, a chart, and the exact
pandas code that produced it. The agent profiles your data on upload, plans an
approach, writes and runs pandas in a sandbox, self-verifies the result, and only
then answers. It runs entirely on a **free-tier Google Gemini key**.

---

## Free tier by design

This app is configured to run on a **NON-CHARGEABLE, FREE-TIER** Gemini key.

- **Default model: `gemini-2.5-flash`** (free tier, verified). Set via
  `AGENT_LLM_MODEL` in `.env`.
- **`gemini-2.5-flash-lite`** is an acceptable cheaper free fallback.
- **Pro models** (`gemini-3.1-pro`, `gemini-2.5-pro`) require **billing** and are
  intentionally **NOT** the default. Only set one if you have paid quota.
- Override the model any time with `AGENT_LLM_MODEL` in `.env`.

The free tier has a small **daily request quota**. When it is exhausted, or when
you hit a per-minute rate limit, the agent does **not** crash or leak a stack
trace — it surfaces a clean, friendly message ("The AI service is temporarily
rate-limited or out of quota — please try again shortly.") and persists that
text with the failed turn. The test suite treats a genuine daily-quota
exhaustion as a **skip**, never a failure (see "Tests" below).

---

## Requirements

- Python 3.11+ and [`uv`](https://docs.astral.sh/uv/)
- Node.js + [`pnpm`](https://pnpm.io/) (to build the frontend static export)
- A free-tier Google Gemini API key

---

## Setup

```bash
cp .env.example .env
# edit .env:
#   AGENT_GEMINI_API_KEY=<your free-tier Gemini key>
#   AGENT_LLM_MODEL=gemini-2.5-flash        # free-tier default (already set)
uv sync
```

## Run

```bash
uv run alembic upgrade head            # apply DB migrations (SQLite)
cd frontend && pnpm install && pnpm build && cd ..   # build the static UI
uv run python -m src                   # start the FastAPI server (port 8001)
```

Then open the UI:

| URL | What |
|-----|------|
| `http://localhost:8001/app/` | **UI** — upload data, ask questions, see answer + chart + table + code |
| `http://localhost:8001/health` | Health check (`{"data": {"status": "ok"}, "error": null}`) |
| `http://localhost:8001/docs` | Interactive API docs (Swagger) |

---

## How it works

1. **Upload** a CSV or multi-sheet `.xlsx` → the agent auto-profiles every column
   (types, ranges, sample values) and every sheet.
2. **Ask** a question in a conversation. The agent plans, writes pandas, runs it
   in a sandbox (wall-clock timeout, row caps), and verifies the result.
3. **Answer** streams back over SSE: live steps, token/cost usage, then the final
   prose + table + chart + show-code + suggested follow-ups.
4. **Memory** — follow-up questions resolve against the prior turn; conversations
   and full history persist across restarts.
5. **Privacy** — only a capped row sample is ever sent to the LLM; never the full
   dataset.

Only a capped row sample is sent to the model; the full dataset stays local.

---

## Tests

Tests run against the **real Gemini API** (key from `.env`) and the production DB
driver — nothing is stubbed on the tested path.

```bash
uv run pytest tests/unit -q            # no key / no quota needed — always green
uv run pytest tests/phase5 -q          # backend polish + error surfacing
uv run pytest -q                       # full suite (real LLM)
```

Because the free tier has a daily quota, the real-LLM tests are resilient:
a **transient** per-minute rate limit is retried with backoff, and a genuine
**daily-quota** `RESOURCE_EXHAUSTED` is **skipped** (yellow), never failed (red).
On a machine with quota the suite passes fully; on a quota-exhausted machine it
passes-with-skips with **zero failures**. The resilience helper lives in
`tests/_realllm.py`. Assertions are never weakened — when a call succeeds it is
still verified against ground-truth pandas.

---

## Layout

```
src/
  api/            ← FastAPI routers (datasets, conversations, query SSE, health, exports)
  config/         ← Pydantic settings (.env)
  db/             ← SQLAlchemy models + session
  domain/         ← Pydantic request/response models
  graph/          ← LangGraph nodes/edges/state + runner (plan → write_code → execute → verify → answer)
  llm/            ← LLM client (retry/backoff, friendly_error) + providers/ (gemini)
  profiling/      ← dataset profiler
  sandbox/        ← sandboxed pandas executor
  prompts/        ← prompt templates (.md)
  observability/  ← structured logging
frontend/         ← Next.js static export (served by FastAPI at /app)
tests/            ← unit + phase1..phase5 (real Gemini); tests/_realllm.py = free-tier resilience
spec/             ← roadmap, architecture, capabilities/, data, api, ui, agent
```

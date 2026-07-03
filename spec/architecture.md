# Architecture

---

## System Overview

A single-origin web app: a Next.js UI (static-exported, served by FastAPI at `:8001/app/`) talks to a FastAPI backend. The backend stores uploaded spreadsheets on the local filesystem, profiles them, and persists datasets + chat history in SQLite. Each user question runs through a LangGraph agent that writes pandas code with Gemini and executes it **locally, in a sandboxed subprocess, against the raw data** — only the question, the data profile, and a small capped row sample are sent to Gemini. The agent iterates (write → run → verify → self-correct / clarify) until confident, then returns a clean answer (prose + numbers + chart spec + table). Live step events, elapsed time, and Gemini token/cost stream to the UI over SSE.

## Component Map

```
[Next.js UI  /app/]
      │  (fetch + SSE)
      ▼
[FastAPI  :8001] ──────────► [SQLite  (datasets, columns, conversations, messages)]
      │                              via SQLAlchemy 2.0
      │
      ├─► [Filesystem  data/uploads/*.csv|.parquet]   (raw data — never sent to LLM)
      │
      ├─► [Profiler]  (pandas: columns, dtypes, ranges, row count, sample rows)
      │
      └─► [LangGraph agent]
              │
              ├─► [Gemini]  (question + profile + row SAMPLE only → pandas code)
              │
              └─► [Sandbox executor]  (subprocess, restricted, wall-clock timeout)
                        │
                        └─► reads raw data from Filesystem, returns JSON result
```

## Layers

| Layer | Responsibility |
|-------|----------------|
| UI (Next.js/Recharts) | Upload, profile panel, chat, live steps/timer/cost, chart & table rendering |
| API (FastAPI) | Upload+profile, dataset library, conversation/message CRUD, SSE query stream |
| Agent (LangGraph) | Iterate/verify/clarify loop; decides code, retries, when to answer vs ask |
| LLM (Gemini) | Turns question + profile + row sample into pandas code and prose |
| Sandbox | Executes generated pandas code locally against raw data with timeout & restricted env |
| Storage | Filesystem (raw data) + SQLite/SQLAlchemy (metadata, profiles, chat history) |

## Data Flow

1. **Trigger:** user drops a CSV/Excel file in the UI → `POST /datasets`.
2. Backend stores the raw file, the Profiler computes columns/types/ranges/row-count + a small sample, both persisted (`Dataset`, `DatasetColumn`).
3. User opens a chat over the dataset (`POST /conversations`) and asks a question (`POST /conversations/{id}/query`, SSE).
4. The LangGraph runner loads the profile + prior chat turns into state and invokes the graph: **profile/plan → write-code → execute-local → verify/reflect → clarify-or-answer**, emitting step events over SSE.
5. Gemini receives only question + profile + row sample (never the full data); generated code runs in the sandbox against the raw file.
6. **Output:** a clean answer (prose, key numbers, chart spec, table), persisted as a `Message` with token/cost/steps/elapsed/code metadata, streamed back and rendered.

## External Dependencies

| Dependency | Purpose | Failure Mode |
|------------|---------|--------------|
| Google Gemini API | Generate pandas code + prose; report token usage | Retry w/ backoff; on repeated failure surface a clean error message in the chat turn |
| Local filesystem | Store raw uploads + parquet cache | Upload fails with a surfaced error; never silently drops data |
| SQLite (via `AGENT_DATABASE_URL`) | Persist datasets, profiles, conversations, messages | Fatal on write failure; surfaced as 500 |

## Stack

- **Language:** Python 3.12 (backend), TypeScript (frontend).
- **Agent framework:** LangGraph (skeleton already wired) — iterate/self-correct/clarify loop.
- **LLM provider + model:** Google Gemini, default `gemini-3.1-pro` (env `AGENT_LLM_MODEL`, provider auto-detected from `AGENT_GEMINI_API_KEY`). Chosen for strong code-generation + reasoning needed for production-grade accuracy.
- **Backend:** FastAPI, served at `:8001`, static-exports the frontend at `/app/`.
- **Database + ORM:** SQLite (`AGENT_DATABASE_URL`) + SQLAlchemy 2.0 (`Mapped`/`mapped_column`).
- **Frontend:** Next.js 15 + React 19, static export; Recharts for interactive charts (simpler static export than Plotly).
- **Dependency management:** uv + `pyproject.toml` (Python); pnpm (frontend).

| Key library | Version | Purpose |
|-------------|---------|---------|
| langgraph | (skeleton) | Agent graph |
| google-genai | (skeleton) | Gemini provider |
| fastapi / uvicorn | (skeleton) | API + server |
| sqlalchemy | 2.0 | ORM |
| pandas | latest | Profiling + local analysis execution |
| pyarrow | latest | Parquet cache for fast reload of large files |
| openpyxl | latest | Excel (.xlsx) parsing (Phase 3) |
| recharts | latest | Interactive charts |
| @playwright/test | latest | E2E smoke tests |

**Avoid:** Plotly/Dash (heavier static export than Recharts); sending full datasets to the LLM (privacy + cost violation); `eval`/`exec` in-process without a sandbox (must use the restricted subprocess executor); signal-based timeouts (not Windows-safe — use subprocess wall-clock timeout).

> **Assumed:** raw files are stored on the local filesystem under `data/uploads/`, with a parquet cache alongside for files that benefit from it; only metadata/profiles/chat live in SQLite.
> **Assumed:** the pandas sandbox is a **subprocess** (not in-process) so timeouts and isolation work cross-platform on Windows.

## Deployment Model

Single long-running process: `uv run python -m src` starts uvicorn on `:8001`, serving both the API and the statically-exported Next.js UI at `/app/`. Local/self-hosted, single-user; no external services beyond the Gemini API.

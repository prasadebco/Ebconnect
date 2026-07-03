# Roadmap

---

## What This Agent Does

A single-user, browser-based data-analysis agent for spreadsheets. The user uploads CSV/Excel files into a persistent library they return to across days, opens a stateful chat over a chosen dataset, and asks questions in plain English ("what's total revenue by region?", "now break that down by month"). The agent auto-profiles each file on upload, then for every question writes and runs analysis code **locally against the raw data**, iterating and self-correcting until confident. Only the question, the data profile, and a small sample of rows ever leave the machine to the LLM — the full dataset never does. Answers render clean by default: prose with key numbers, an interactive chart, and a summary table, with the analysis code hidden unless asked.

## Who Uses It

A single analyst / operator who works with their own spreadsheets and acts on the results (production-grade accuracy matters). They are comfortable in a browser, not necessarily in code. They value privacy (data stays on their server) and low cost.

## Core Problem Being Solved

Replaces the manual loop of opening a spreadsheet, writing pandas/SQL/formulas, debugging, re-running, and hand-building charts. Also replaces "paste my data into a chatbot" tools that are inaccurate on real data, leak the whole dataset, and forget context between questions.

## Success Criteria

- [ ] A user uploads a CSV up to ~100MB and sees an accurate auto-profile (column names, types, row count) within a few seconds.
- [ ] A plain-English question over that dataset returns a correct answer (verified against a ground-truth pandas computation) in under 30s, with prose + key numbers and at least one interactive chart when the result is chartable.
- [ ] The full dataset is never sent to the LLM — only the question, profile, and a small capped row sample (asserted by test).
- [ ] Follow-up questions in the same chat use prior turns as context ("break *that* down by month" resolves correctly).
- [ ] Each answer shows live step updates, an elapsed timer, and per-query Gemini token count + cost.
- [ ] Datasets and chat history persist across server restarts and across days.

## What This Agent Does NOT Do (Out of Scope)

- Multi-user, auth, sharing, or role-based access — single-user only.
- A formal audit log of every action (datasets + chat history persist; no compliance-grade audit trail).
- Writing back to / mutating the source spreadsheets — read-only analysis.
- Live database connections, streaming data, or scheduled/automated runs — file uploads only.
- Predictive ML / forecasting model training — descriptive & exploratory analysis only.
- Cloud data egress of raw data — analysis code runs locally.

## Key Constraints

- Files up to ~100MB; answers in under 30s on the tested path.
- Production-grade accuracy — results are verified before being shown; when uncertain the agent asks a clarifying question or flags a best-guess.
- Privacy: analysis code executes locally on raw data in a sandbox; only question + profile + small row sample go to Gemini.
- Cost kept low: minimize tokens (send profile + sample, not data); track and surface per-query cost.
- LLM = Google Gemini (`AGENT_GEMINI_API_KEY` in `.env`). DB = SQLite (`AGENT_DATABASE_URL`).

## Phases of Development

> **Phase 1 is the smallest first-time-right user-testable win.** Real backend on the one core path (single CSV → profile → ask → verified answer + chart). Frontend visually complete: real UI for that path PLUS clearly-labelled NON-FUNCTIONAL stubs for later features. The agentic loop is wired from day one even if the clarify/retry branches are thin.

### Phase 1 — Ask one CSV a question

- **Goal:** Upload ONE CSV → agent auto-profiles it → user asks ONE plain-English question in a chat over that dataset → agent writes/runs pandas code locally, iterates if needed, and returns a clean answer (prose + key numbers) with an interactive chart when appropriate. Live step updates, elapsed timer, and per-query Gemini token/cost are minimal-but-real.
- **Independent slices (parallel build units):**
  - `sandbox-exec` (backend) — subprocess pandas sandbox: run generated code against a stored CSV with a wall-clock timeout, restricted env, JSON result contract. deps: none.
  - `agent-loop` (backend) — LangGraph iterate/verify/answer graph + Gemini wiring + prompts + profiling. deps: sandbox-exec (consumes its `execute()` contract — declared dependency, serialize after sandbox-exec).
  - `datasets-api` (backend) — data models (Dataset, DatasetColumn, Conversation, Message), upload+profile endpoint, SSE query endpoint. deps: agent-loop (calls the graph runner — declared dependency).
  - `frontend-chat` (frontend) — upload dropzone, profile panel, chat pane with live steps/timer/cost, Recharts renderer, plus labelled stubs for library / multi-file / Excel / export / follow-ups / show-code. deps: none (builds against the API contract in spec/api.md).
- **Key surfaces / files:** backend `src/sandbox/executor.py`, `src/graph/state.py`, `src/graph/nodes.py`, `src/graph/agent.py`, `src/graph/edges.py`, `src/graph/runner.py`, `src/prompts/*.md`, `src/db/models.py`, `src/api/datasets.py`, `src/api/conversations.py`, `src/profiling/profiler.py`, `tests/`; frontend `frontend/src/app/page.tsx`, `frontend/src/components/*`, `frontend/tests/e2e/`.
- **Gate command:** `uv run pytest tests/phase1 -q` (real Gemini via `.env`, real SQLite via `AGENT_DATABASE_URL`) **and** `cd frontend && pnpm exec playwright test tests/e2e/phase1.spec.ts`.
- **How the user tests it (handoff seed):** Run `uv run python -m src` (backend on :8001), open `http://localhost:8001/app/`. Drag a CSV (e.g. a sales export) onto the dropzone → a profile panel appears (columns, types, row count). Type "what is total revenue by region?" → watch the live steps ("Profiling data…", "Writing query…", "Running locally…", "Verifying result…") with the elapsed timer, then read the prose answer + key numbers + a bar chart, and the per-query token/cost line. Labelled stubs (greyed, "Coming soon"): the dataset library sidebar, "Add another file"/Excel-sheet controls, the Export button, the follow-up-suggestion chips, and the "Show code" toggle — these are visible but non-functional by design.

### Phase 2 — Persistent library & return-across-days chat

- **Goal:** Datasets become a persistent library the user returns to across days, and chat history persists per dataset — reopen a conversation and continue with follow-ups that use prior-turn context.
- **Independent slices (parallel build units):**
  - `library-api` (backend) — list/get/delete datasets, `last_used_at`, list/get conversations + full message history. deps: none.
  - `history-memory` (backend) — load prior messages into agent state so follow-ups ("break that down by month") resolve against context; persist every turn. deps: none.
  - `frontend-library` (frontend) — wire the real library sidebar (switch dataset, delete), conversation list, and reload of past chat history. deps: none (API contract in spec/api.md).
- **Key surfaces / files:** `src/api/datasets.py`, `src/api/conversations.py`, `src/graph/runner.py`, `src/graph/nodes.py` (history injection), `frontend/src/components/LibrarySidebar.tsx`, `frontend/src/components/ConversationList.tsx`, `tests/phase2`.
- **Gate command:** `uv run pytest tests/phase2 -q` (asserts: restart process → datasets + conversations still listable; a follow-up question correctly references the prior turn's result).
- **How the user tests it (handoff seed):** Upload two CSVs across two "sessions" (restart the server between them). Reopen the app → both appear in the library sidebar. Click one → its past chat reloads. Ask "now break that down by month" as a follow-up → the answer builds on the previous question. Stubs still labelled: multi-file join, Excel sheets, export, follow-up chips, show-code.

### Phase 3 — Multi-source, richer output, and export

- **Goal:** Analyze multi-sheet Excel workbooks and join across multiple files in one conversation; deliver the full clean-output experience — export results, 2–3 suggested follow-up questions after each answer, and a "Show code" toggle.
- **Independent slices (parallel build units):**
  - `excel-multisheet` (backend) — parse `.xlsx`, profile each sheet, expose sheets as named frames to the sandbox. deps: none.
  - `multi-file-join` (backend) — attach multiple datasets to a conversation; pass multiple named frames to the sandbox; agent plans joins. deps: none.
  - `output-extras` (backend) — export endpoint (CSV/PNG of the result), follow-up-suggestion generation, persisted analysis code for the show-code toggle. deps: none.
  - `frontend-extras` (frontend) — wire Excel sheet picker, "Add file to conversation" control, Export button, follow-up chips, Show-code toggle. deps: none.
- **Key surfaces / files:** `src/profiling/profiler.py` (xlsx), `src/api/conversations.py` (attach/export), `src/graph/nodes.py` (multi-frame + follow-ups), `src/db/models.py` (ConversationDataset link, sheet rows), `frontend/src/components/*`, `tests/phase3`.
- **Gate command:** `uv run pytest tests/phase3 -q` (asserts: a two-file join returns the correct joined aggregate vs a ground-truth pandas merge; a multi-sheet xlsx profiles every sheet; export returns a non-empty file; each answer yields 2–3 follow-ups; stored code is retrievable).
- **How the user tests it (handoff seed):** Upload an `.xlsx` with 2+ sheets → pick a sheet, ask a question. Add a second CSV to the conversation → ask a question that spans both files (e.g. "join orders to customers and show revenue by segment"). Click a follow-up chip to auto-ask it, toggle "Show code" to see the pandas, and click Export to download the result.

### Phase 4 — Agentic Stack Upgrade (harden the loop)

- **Goal:** Make the iterate/self-correct/clarify loop production-grade: bounded retries with a *different* approach on failure, robust clarify-vs-answer decisioning, and hardened error handling / timeouts on both the sandbox and Gemini calls.
- **Independent slices (parallel build units):**
  - `loop-hardening` (backend) — retry edges with attempt cap, reflection node that changes strategy on repeated failure, confidence-gated clarify branch, verification checks (shape/null/sanity) before answering. deps: none.
  - `resilience` (backend) — Gemini retry/backoff + surfaced error, sandbox hard-timeout + OOM/row-cap guards, structured logging of every attempt (prompt, code, result, latency, tokens). deps: none.
  - `frontend-uncertainty` (frontend) — render clarifying-question turns, best-guess "flagged/low-confidence" badges, and per-attempt step detail. deps: none.
- **Key surfaces / files:** `src/graph/edges.py`, `src/graph/nodes.py` (reflect/verify/clarify), `src/sandbox/executor.py`, `src/llm/client.py`, `src/observability/events.py`, `frontend/src/components/ChatMessage.tsx`, `tests/phase4`.
- **Gate command:** `uv run pytest tests/phase4 -q` (asserts: a deliberately-ambiguous question yields a clarifying question; a first-attempt code error triggers a retry with a changed approach and still returns a correct answer; a runaway code snippet is killed by the timeout and surfaced cleanly).
- **How the user tests it (handoff seed):** Ask an ambiguous question ("show me the best ones") → the agent asks a clarifying question instead of guessing. Ask something that trips a first code attempt → watch it retry and still answer. Ask a genuinely under-specified metric → get a best-guess answer with a "flagged — verify" badge.

### Phase 5 — Complete Agentic System (no stubs)

- **Goal:** Every capability real and polished end-to-end; no labelled stubs remain; full clean-by-default output, cost/timer/steps, library, multi-source, export, follow-ups, and the hardened loop all wired and covered by the full regression suite.
- **Independent slices (parallel build units):**
  - `polish-backend` (backend) — remove any remaining stub responses, finalize cost accounting, tighten profiles/sampling, full regression fixtures. deps: none.
  - `polish-frontend` (frontend) — remove all "Coming soon" labels, empty/error/loading states, responsive layout, accessibility pass. deps: none.
  - `e2e-suite` (frontend) — Playwright journey covering upload → profile → ask → chart → follow-up → switch dataset → multi-file → export. deps: none.
- **Key surfaces / files:** all of `src/`, `frontend/src/`, `frontend/tests/e2e/`, `tests/phase5`.
- **Gate command:** `uv run pytest -q` (full suite, real Gemini + SQLite) **and** `cd frontend && pnpm exec playwright test`.
- **How the user tests it (handoff seed):** Run through the entire journey with no "Coming soon" labels anywhere: build a small library over multiple sessions, ask multi-file and Excel questions, use follow-ups, show code, export, and confirm every answer shows steps + timer + token/cost.

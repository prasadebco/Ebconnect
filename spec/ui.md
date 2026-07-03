# UI

---

## UI Type

Single-page web app: a chat-centric data-analysis workspace. Next.js 15 + React 19, statically exported and served single-origin by FastAPI at `:8001/app/`. Interactive charts via Recharts. Clean-by-default: prose + key numbers + chart + table, with analysis code hidden behind a toggle. Layout: a left **library sidebar**, a center **chat pane**, and a right **profile panel**.

> **Phase-1 labelling rule:** the real path is Upload → Profile → Ask → Answer. Everything deferred is rendered as a visible, greyed, clearly-labelled **"Coming soon"** stub so the vision is legible but a stub never reads as a bug. The table below marks each element real-on-path vs stub-in-P1.

## Views / Screens

### Screen: Workspace (single screen, three panes)

**Purpose:** Upload a dataset, see its profile, and hold a stateful chat asking questions over it.

**Key elements:**

| Element | Pane | Phase 1 status |
|---------|------|----------------|
| Upload dropzone (CSV) | Center (empty state) | REAL |
| Profile panel (columns, dtypes, ranges, row count) | Right | REAL |
| Chat pane (question input + message list) | Center | REAL |
| Live step indicator ("Profiling data…" → "Composing answer…") | Center (in-flight message) | REAL (minimal-but-real) |
| Elapsed timer | Center (in-flight message) | REAL |
| Per-query token count + cost line | Center (below answer) | REAL |
| Prose + key numbers | Center (answer) | REAL |
| Interactive chart (Recharts) when chartable | Center (answer) | REAL |
| Summary table | Center (answer) | REAL |
| Library sidebar (dataset list, switch, delete) | Left | STUB "Coming soon" (real P2) |
| Conversation list / reload past chat | Left | STUB (real P2) |
| "Add another file" / Excel sheet picker | Right/center | STUB (real P3) |
| Export button | Answer toolbar | STUB (real P3) |
| Follow-up suggestion chips (2–3) | Below answer | STUB (real P3) |
| "Show code" toggle | Answer toolbar | STUB (real P3) |
| Clarifying-question turn + best-guess "flagged" badge | Center | Thin in P1, real P4 |

**Actions available:**
- Drag/drop or pick a CSV to upload → auto-profile.
- Type a question and submit → watch live steps + timer → read the answer + chart + table + token/cost.
- (P2+) Switch datasets, reload conversations, delete.
- (P3+) Attach a file, pick a sheet, click a follow-up chip, toggle Show code, export.

## Error States

- **Upload:** oversized/unsupported/unparseable file → inline error on the dropzone; no phantom library entry.
- **Query in-flight:** the in-flight assistant bubble shows the current step + running timer; on failure it converts to a clean error bubble ("Couldn't complete this — try rephrasing."), never a spinner that hangs.
- **Empty states:** no dataset → dropzone with guidance; dataset but no messages → prompt to ask the first question.
- **Loading:** skeleton for the profile panel while profiling; disabled input while a query runs (one query per conversation at a time).
- **Clarify/flag (P4):** a clarifying question renders as a normal agent turn awaiting the user's reply; a best-guess renders with a visible "flagged — verify" badge.

## Tech Stack

Next.js 15 (App Router, static export) + React 19 + TypeScript, Tailwind for styling, Recharts for charts, native `EventSource` for the SSE query stream. Playwright for E2E (`frontend/tests/e2e/`). Served by FastAPI at `/app/`; the API base is same-origin. See `spec/architecture.md` → `## Stack`.

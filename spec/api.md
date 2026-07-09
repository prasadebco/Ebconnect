# API

---

## API Style

REST over HTTP (FastAPI) at `:8001`, single-origin with the static-exported Next.js UI mounted at `/app/`. One endpoint streams via **Server-Sent Events (SSE)** so the UI can render live step updates, the elapsed timer, and per-query token/cost as the agent runs. JSON everywhere else. Phase annotations mark when each endpoint becomes real; Phase-1 stubs in the UI simply don't call the not-yet-built endpoints.

## Endpoints / Commands

### `GET /health`  (Phase 1)

**Purpose:** Liveness/health probe (HTTP 200 when the server is up).

**Response (actual):** `/health` is wrapped in the shared app envelope:
```json
{ "data": { "status": "ok" }, "error": null }
```
> **Envelope note (intentional):** `/health` is the one endpoint that returns the `{data, error}` app envelope; the resource endpoints below (`/datasets`, `/conversations`, …) return **bare** objects/arrays (no envelope). This is deliberate — `/health` is an infra/liveness probe that reports through the generic envelope, while the product endpoints return their resources directly for the UI. Clients read `data.status` for `/health`.

### `POST /datasets`  (Phase 1)

**Purpose:** Upload a spreadsheet, store it locally, auto-profile it, register it in the library.

**Request:** `multipart/form-data` with a single `file` (CSV in P1; XLSX in P3), up to ~100MB.

**Response:**
```json
{
  "id": "uuid",
  "name": "sales_2025.csv",
  "kind": "csv",
  "row_count": 124903,
  "sheets": [{ "name": "__default__", "row_count": 124903 }],
  "columns": [
    { "name": "region", "dtype": "object", "null_count": 0, "distinct_count": 5, "samples": ["East","West"] },
    { "name": "revenue", "dtype": "float64", "null_count": 12, "min_value": "0.0", "max_value": "98120.5" }
  ]
}
```

**Error cases:**
| Status | Condition |
|--------|-----------|
| 400 | Missing file, unsupported type, or file exceeds size cap |
| 422 | File cannot be parsed / profiled |
| 500 | Storage or DB write failure |

### `GET /datasets`  (Phase 2)

**Purpose:** List the persistent library, ordered by `last_used_at`. Returns `[{id, name, kind, row_count, created_at, last_used_at}]`.

### `GET /datasets/{id}`  (Phase 1)

**Purpose:** Full dataset detail incl. per-sheet column profiles. 404 if unknown.

### `DELETE /datasets/{id}`  (Phase 2)

**Purpose:** Remove a dataset from the library and delete its raw file + cache. Returns `{ "deleted": true }`. 404 if unknown.

### `POST /conversations`  (Phase 1)

**Purpose:** Open a chat over a dataset.

**Request:**
```json
{ "primary_dataset_id": "uuid", "title": "optional" }
```
**Response:** `{ "id": "uuid", "primary_dataset_id": "uuid", "title": "..." }`. 400 if the dataset is unknown.

### `GET /conversations`  (Phase 2)

**Purpose:** List conversations (ordered by `last_used_at`) for the library UI.

### `GET /conversations/{id}`  (Phase 2)

**Purpose:** Full chat history — `{ conversation, messages: [...] }` — so a reopened chat reloads prior turns (conversation memory).

### `POST /conversations/{id}/attach`  (Phase 3)

**Purpose:** Attach another dataset to a conversation for multi-file joins.

**Request:** `{ "dataset_id": "uuid", "frame_alias": "customers" }`. Response: updated frame list. 400 on unknown/duplicate.

### `POST /conversations/{id}/query`  (Phase 1 — SSE)

**Purpose:** Ask a plain-English question; runs the LangGraph iterate/verify/answer loop and **streams** live events.

**Request:**
```json
{ "question": "what is total revenue by region?", "sheet_name": "optional (xlsx)" }
```

**Response:** `text/event-stream`. Event sequence:
```
event: step    data: {"label": "Profiling data…"}
event: step    data: {"label": "Writing query…"}
event: step    data: {"label": "Running locally…"}
event: step    data: {"label": "Verifying result…"}
event: step    data: {"label": "Composing answer…"}
event: usage   data: {"prompt": 812, "completion": 190, "total": 1002, "cost_usd": 0.0031, "elapsed_ms": 8450}
event: answer  data: {"message_id":"uuid","content":"...","chart":{...}|null,"table":{...}|null,
                      "code":"...","followups":[...],"confidence":"high","status":"completed"}
```
`confidence` is the graded scale **`high` | `medium` | `low`** (`medium` = the loop self-corrected; `low` = a flagged best-guess). A `needs_clarification` run ends with an `answer` event whose `status="needs_clarification"` and `content` is the clarifying question — it carries **no** confidence grade (the field defaults to `"high"` on the wire only because it is not a graded answer; the persisted message stores `null`). A failure ends with `event: error  data: {"message": "..."}` — a **friendly** message (a Gemini quota/429 becomes "The AI service is temporarily rate-limited or out of quota — please try again shortly."; raw tracebacks never appear) — and a persisted `status="failed"` message.

**Error cases:**
| Status | Condition |
|--------|-----------|
| 400 | Empty question or unknown conversation |
| 200 (SSE `error`) | Gemini or sandbox failure after bounded retries — surfaced cleanly in-stream |

### `GET /conversations/{id}/messages/{mid}/export`  (Phase 3)

**Purpose:** Download the result of an answer as `format=csv` (table) or `format=png` (chart). Returns a file stream; 404 if no exportable result.

### `POST /dashboard/tiles`  (Phase 6)

**Purpose:** Pin an existing completed assistant answer as a Dashboard tile. Snapshots the message's prose/chart/table/context so the tile renders without re-running the query (no Gemini call). New capability: [dashboard_pinning.md](capabilities/dashboard_pinning.md).

**Request:**
```json
{ "message_id": "uuid" }
```

**Response (bare object):**
```json
{
  "id": "uuid",
  "message_id": "uuid",
  "conversation_id": "uuid",
  "dataset_id": "uuid",
  "dataset_name": "sales_2025.csv",
  "title": "what is total revenue by region?",
  "content": "Total revenue is highest in the East…",
  "chart": { "type": "bar", "x": "region", "y": "revenue", "data": [] },
  "table": { "columns": [], "rows": [] },
  "confidence": "high",
  "display_order": 0,
  "created_at": "2026-07-07T10:00:00Z"
}
```

**Error cases:**
| Status | Condition |
|--------|-----------|
| 400 | Unknown `message_id`, or the message is not a completed assistant answer |

> If the message is already pinned, the existing tile is returned (idempotent-safe) rather than creating a duplicate.

### `GET /dashboard/tiles`  (Phase 6)

**Purpose:** List all pinned tiles for the Dashboard view. Ordered by `display_order` then newest-first (`created_at` desc). Returns a **bare array**:
```json
[ { "id": "uuid", "title": "…", "dataset_name": "…", "content": "…",
    "chart": {}, "table": {}, "confidence": "high",
    "conversation_id": "uuid", "display_order": 0, "created_at": "…" } ]
```

### `DELETE /dashboard/tiles/{id}`  (Phase 6)

**Purpose:** Unpin/remove a tile. Returns `{ "deleted": true }`. 404 if unknown.

### `PATCH /dashboard/tiles/reorder`  (Phase 6 — optional / nice-to-have)

**Purpose:** Re-sequence tiles. Request `{ "order": ["tile-id-1", "tile-id-2", …] }`; sets each tile's `display_order` to its index. Returns the reordered bare array. **Drag-reorder UI is deferred** (see roadmap Phase 6) — if this endpoint is not built, tiles stay newest-first.

## Authentication

None — single-user, self-hosted, bound to localhost. There are no accounts, sessions, or API keys for callers. The only secret is the server-side `AGENT_GEMINI_API_KEY` (in `.env`), never exposed to the browser. If ever remotely hosted, front it with a reverse proxy / network ACL — out of scope for this build.

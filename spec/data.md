# Data Model

---

## Storage Technology

SQLite via SQLAlchemy 2.0 (`Mapped` / `mapped_column`), reached through `AGENT_DATABASE_URL` (already set). SQLite is correct here: single-user, self-hosted, low-ops, and persistent across restarts. **Raw spreadsheet bytes are NOT stored in the database** — they live on the local filesystem under `data/uploads/` (with an optional parquet cache alongside for large files). Only metadata, profiles, and chat history live in SQLite. This keeps the DB small and honors the privacy rule (raw data never leaves the machine, never goes to the LLM).

## Entities

### Entity: Dataset

An uploaded spreadsheet file registered in the persistent library.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | str (uuid) | yes | Primary key |
| name | str | yes | User-facing name (original filename) |
| file_path | str | yes | Absolute path to raw file under `data/uploads/` |
| cache_path | str | no | Parquet cache path for fast reload of large files |
| kind | str | yes | `csv` or `xlsx` |
| size_bytes | int | yes | File size (for the ~100MB guard) |
| row_count | int | yes | Total rows (from profiling; for xlsx, of the default sheet) |
| created_at | datetime | yes | Upload time |
| last_used_at | datetime | yes | Updated when opened — library ordering (Phase 2) |

### Entity: DatasetSheet

One sheet of a multi-sheet Excel workbook (Phase 3). A CSV has exactly one implicit sheet; for CSVs this may be a single row with `name="__default__"` or omitted, with columns hung directly off `Dataset`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | str (uuid) | yes | Primary key |
| dataset_id | str (FK Dataset) | yes | Owning dataset |
| name | str | yes | Sheet name (the frame name exposed to the sandbox) |
| row_count | int | yes | Rows in this sheet |
| cache_path | str | no | Per-sheet parquet cache path (fast reload; the path the sandbox reads for this frame) |

### Entity: DatasetColumn

One profiled column of a dataset/sheet.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | str (uuid) | yes | Primary key |
| dataset_id | str (FK Dataset) | yes | Owning dataset |
| sheet_id | str (FK DatasetSheet) | no | Owning sheet (null → CSV default) |
| name | str | yes | Column name |
| dtype | str | yes | Inferred pandas dtype |
| null_count | int | yes | Number of nulls |
| distinct_count | int | no | Approx distinct values |
| min_value | str | no | Min (stringified; numeric/date columns) |
| max_value | str | no | Max (stringified) |
| samples | JSON | no | A few example values (part of the capped LLM sample) |

### Entity: Conversation

A stateful chat session over one or more datasets.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | str (uuid) | yes | Primary key |
| title | str | yes | Auto/derived title (first question) |
| primary_dataset_id | str (FK Dataset) | yes | The dataset the chat opened over |
| created_at | datetime | yes | Creation time |
| last_used_at | datetime | yes | Updated on each new turn (ordering) |

### Entity: ConversationDataset

Link table attaching additional datasets to a conversation for multi-file joins (Phase 3).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| conversation_id | str (FK Conversation) | yes | Composite PK |
| dataset_id | str (FK Dataset) | yes | Composite PK |
| frame_alias | str | yes | Name the dataset is exposed under to the sandbox |

### Entity: Message

One turn in a conversation — a user question or an agent answer, with per-query telemetry.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | str (uuid) | yes | Primary key |
| conversation_id | str (FK Conversation) | yes | Owning conversation |
| role | str | yes | `user` \| `assistant` |
| content | text | yes | Question text, or the answer prose |
| chart | JSON | no | Recharts spec `{type, x, y, series, data}` |
| table | JSON | no | `{columns, rows}` summary table |
| code | text | no | Generated pandas (hidden unless "show code") |
| followups | JSON | no | 2–3 suggested next questions (Phase 3) |
| confidence | str | no | Graded answer confidence: `high` \| `medium` \| `low` (`medium` = self-corrected; `low` = flagged best-guess). Null for a `needs_clarification` turn (a clarification is not a graded answer). |
| status | str | yes | `completed` \| `failed` \| `needs_clarification` |
| token_prompt | int | no | Gemini prompt tokens |
| token_completion | int | no | Gemini completion tokens |
| token_total | int | no | Total tokens |
| cost_usd | float | no | Per-query cost (per-model rate table) |
| steps | JSON | no | Ordered live-step labels emitted |
| elapsed_ms | int | no | Wall-clock time of the query |
| error_message | text | no | Set when `status = failed` |
| created_at | datetime | yes | Turn time |

### Relationships

- `Dataset` 1—N `DatasetSheet` 1—N `DatasetColumn` (CSV: columns may hang directly off `Dataset` with null `sheet_id`).
- `Conversation` N—1 `Dataset` (primary) and N—M `Dataset` via `ConversationDataset` (Phase 3 joins).
- `Conversation` 1—N `Message` (full ordered chat history — the conversation memory loaded into agent state).

## Data Lifecycle

- **Create:** `Dataset` (+ sheets/columns) on upload+profile; `Conversation` on chat open; `Message` on every user turn and every agent turn.
- **Update:** `last_used_at` on open/new-turn; a `Message` row is written once the run finalizes (status/telemetry).
- **Delete:** deleting a `Dataset` (Phase 2) cascades its sheets/columns and removes the raw file + cache from disk; deleting a `Conversation` cascades its messages.
- **Persistence:** everything survives process restarts (Phase 2 success criterion). Nothing is time-boxed or auto-archived — no formal audit log (out of scope).

## Sensitive Data

- The **raw spreadsheet contents** are the sensitive asset. They stay on the local filesystem and are read only by the local pandas sandbox. **They are never sent to Gemini** — only the compact profile and a capped row sample (`AGENT_SAMPLE_ROWS`, default ~20) ever appear in a prompt (test-asserted).
- No auth/PII fields of the app's own (single-user, no accounts). The Gemini API key lives in `.env` (`AGENT_GEMINI_API_KEY`), never in the DB or logs.

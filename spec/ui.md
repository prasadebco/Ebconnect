# UI

---

## UI Type

Single-page web app: a chat-centric data-analysis workspace. Next.js 15 + React 19, statically exported and served single-origin by FastAPI at `:8001/app/`. Interactive charts via Recharts. Clean-by-default: prose + key numbers + chart + table, with the analysis code hidden behind a "Show code" toggle.

**Delivered design:** a polished **Modern-SaaS** redesign with a **light/dark theme toggle** (sun/moon control in the header; the choice is persisted in `localStorage` and applied pre-hydration so there is no flash). Every state — empty, loading, error, ideal, chart, table, badges — is designed to read as **intentional in both themes**. As of Phase 5 there are **no "Coming soon" stubs**: every element below is real and wired.

## Views / Screens

### Screen: Workspace (single screen, three regions)

**Purpose:** Upload/select a dataset, see its profile, and hold a stateful chat asking questions over it.

**Three-region layout:**

| Region | Contents | Component(s) |
|--------|----------|--------------|
| **Left — Library sidebar** | Persistent dataset library (switch dataset, delete, ordered by recency) + per-dataset conversation list (open a past chat, which reloads its full history) | `LibrarySidebar`, `ConversationList` |
| **Center — Chat pane** | Message list (user + assistant turns), the in-flight assistant bubble with live step trail + elapsed timer, the question input, and the clarify-reply affordance | `ChatPane`, `ChatMessage`, `StepTrail`, `ClarifyReply` |
| **Right — Profile panel** | The selected dataset's profile (columns, dtypes, ranges, null counts, row count); for Excel, the sheet picker; the "attach another file" panel for multi-file joins | `ProfilePanel`, `SheetPicker`, `AttachPanel` |

**Key elements (all REAL / delivered):**

| Element | Region | Notes |
|---------|--------|-------|
| Upload dropzone (CSV / XLSX) | Center empty state | Drag-drop or pick; auto-profiles on upload |
| Profile panel (columns, dtypes, ranges, row count) | Right | Skeleton while profiling |
| Library sidebar (dataset list, switch, delete) | Left | Persistent across restarts/days |
| Conversation list / reload past chat | Left | Reopens full message history |
| Chat pane (question input + message list) | Center | One query per conversation at a time (input disabled while running) |
| Live step trail ("Profiling data…" → "Composing answer…", plus per-retry "retrying with a new approach…") | Center in-flight bubble | `StepTrail` |
| Elapsed timer | Center in-flight bubble | Running while the query streams |
| Per-query token count + cost line | Center below answer | From Gemini `usage_metadata` + per-model rate table |
| Prose + key numbers | Center answer | Clean-by-default |
| Interactive chart (Recharts) when chartable | Center answer | Theme-aware colors (`AnswerChart`) |
| Summary table | Center answer | `AnswerTable` |
| Confidence badge ("flagged — verify") | Center answer | Shown for `medium`/`low`; `high` renders clean with no badge |
| Clarifying-question turn + reply | Center | A `needs_clarification` turn renders as a normal agent turn awaiting the user's reply (`ClarifyReply`) |
| Follow-up suggestion chips (2–3) | Below answer | Click to auto-ask |
| "Show code" toggle | Answer toolbar | Reveals the generated pandas |
| Export button | Answer toolbar | Download the result (`format=csv` table / `format=png` chart) |
| Excel sheet picker | Right | Pick a sheet to query (`SheetPicker`) |
| "Add file to conversation" (attach) | Right | Multi-file join under a frame alias (`AttachPanel`) |
| Theme toggle (light/dark) | Header | `ThemeToggle`; persisted, no-flash |

**Actions available:**
- Drag/drop or pick a CSV/XLSX to upload → auto-profile.
- Switch datasets, reopen conversations (reload history), delete datasets.
- Type a question and submit → watch live steps + timer → read the answer + chart + table + token/cost.
- Pick an Excel sheet; attach another file and ask a question that spans both.
- Click a follow-up chip, toggle Show code, export the result.
- Answer a clarifying-question turn as the next message.
- Toggle light/dark theme.

## Confidence & uncertainty rendering

The answer confidence scale is **`high` | `medium` | `low`** (`medium` = the agent self-corrected during the run; `low` = a flagged best-guess after exhausting retries). The UI shows a subtle "best guess / verify" badge for `medium` and `low`, and renders clean with no badge for `high`. A `needs_clarification` turn carries **no** confidence grade and renders as a question awaiting reply.

## Error States

- **Upload:** oversized/unsupported/unparseable file → inline error on the dropzone; no phantom library entry.
- **Query in-flight:** the in-flight assistant bubble shows the current step + running timer; on failure it converts to a clean error bubble with a **friendly** message — a Gemini quota/rate-limit surfaces as "The AI service is temporarily rate-limited or out of quota — please try again shortly." (never a raw traceback), never a spinner that hangs.
- **Empty states:** no dataset → dropzone with guidance; dataset but no messages → prompt to ask the first question.
- **Loading:** skeleton for the profile panel while profiling; disabled input while a query runs.
- **Both themes:** every state above is styled to read as intentional in both light and dark.

## Tech Stack

Next.js 15 (App Router, static export) + React 19 + TypeScript, Tailwind for styling (with a light/dark theme via a `dark` class on `<html>`), Recharts for charts (theme-aware), native `EventSource` / streaming fetch for the SSE query stream. Playwright for E2E (`frontend/tests/e2e/`). Served by FastAPI at `/app/`; the API base is same-origin. See `spec/architecture.md` → `## Stack`.

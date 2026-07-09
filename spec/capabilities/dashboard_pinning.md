# Capability: Pinnable Dashboard & Collapsible Icon Sidebar
## What It Does
Lets the user pin any assistant answer (prose + chart + table + context) as a persistent tile onto a Dashboard view that renders saved results without re-running the query, and slims the left library sidebar into a collapsible icon rail that expands on hover/click.
## Inputs
| Input | Type | Source | Required |
|-------|------|--------|----------|
| message_id | str (uuid) | The assistant `Message` being pinned (from the answer card) | yes |
| tile id | str (uuid) | Unpin / reorder actions (Dashboard tile) | yes (unpin/reorder) |
| display_order (optional) | list[str] of tile ids | Reorder action (nice-to-have) | no |
| sidebar collapsed state | bool | Client-side UI toggle (persisted in `localStorage`) | no |
## Outputs
| Output | Type | Destination |
|--------|------|-------------|
| DashboardTile | JSON (bare object) | Dashboard tile grid; persisted in SQLite |
| tile list | JSON array (bare, newest-first / by display_order) | Dashboard view |
| pinned/unpinned state | UI state on the answer card | Chat pane answer toolbar |
## External Calls
| System | Operation | On Failure |
|--------|-----------|------------|
| SQLite (SQLAlchemy) | Insert/select/delete `DashboardTile` | `api_error()` → surfaced cleanly; no phantom tile |
| (none — LLM) | Pinning re-uses the stored `Message` chart/table/content; **no Gemini call**, no re-run | n/a |
## Business Rules
- Pinning snapshots the WHOLE result at pin time: `content` prose, `chart` JSON, `table` JSON, plus context (question/title, dataset name, confidence, timestamp). The Dashboard renders from this snapshot — it never re-runs the query and never calls Gemini.
- Only an `assistant` message with `status="completed"` is pinnable; pinning the same message twice is idempotent-safe (either reject with `api_error` or return the existing tile — implementation returns existing).
- Deleting the source `Conversation`/`Message` cascades and removes its tiles (FK `ON DELETE CASCADE`).
- Tiles list newest-first by default; `display_order` is stored so an optional reorder endpoint can re-sequence them (drag-reorder UI deferred — see roadmap Phase 6).
- The Dashboard is an **in-SPA client-side view switch** (header nav: Analyze | Dashboard) so it works under Next.js static export at `basePath '/app'` — no new server route, no static-export breakage.
- The collapsed icon-rail sidebar keeps every existing item and test-id in the DOM (labels hidden, not removed); the mobile off-canvas drawer + `sidebar-toggle` + `sidebar-backdrop` behavior is preserved.
- Free-tier `gemini-2.5-flash` only; privacy model, Ebco blue-forward branding, light/dark, a11y, and responsiveness are all preserved.
## Success Criteria
- [ ] Clicking "Pin to dashboard" on an assistant answer creates a `DashboardTile` (POST returns the bare tile object) and the button flips to a pinned state.
- [ ] The Dashboard view (header nav switch) shows all pinned tiles in a responsive grid with prose + chart + table + context, rendered WITHOUT any query re-run or Gemini call.
- [ ] Pinned tiles survive a server restart (GET list returns them after restart).
- [ ] Unpinning a tile (DELETE) removes it from the Dashboard and returns `{ "deleted": true }`.
- [ ] With no tiles, the Dashboard shows a tasteful empty state (both light and dark).
- [ ] The sidebar defaults to a slim icon rail, expands on hover/click to the full panel, and collapses again; all existing sidebar test-ids (`library-sidebar`, `library-item`, `dataset-delete`, `conversation-item`, `sidebar-toggle`, `sidebar-backdrop`) remain present in the DOM; the mobile drawer still works.

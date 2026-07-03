# Capability: Conversational Analysis Loop

## What It Does
Answers a plain-English question over a chosen dataset by iteratively writing and running pandas code locally, self-correcting until confident, using prior chat turns as context and asking a clarifying question when ambiguous.

## Inputs
| Input | Type | Source | Required |
|-------|------|--------|----------|
| question | string | User chat message | Yes |
| conversation_id | string | Active chat session | Yes |
| profile + row_sample | dict | Dataset profiling | Yes |
| messages | prior turns | Conversation history (SQLite) | Yes (may be empty on first turn) |

## Outputs
| Output | Type | Destination |
|--------|------|-------------|
| answer_text | prose + key numbers | Message record + UI |
| chart / table | Recharts spec / tabular result | Message record + UI |
| clarifying_question | string (when ambiguous) | Message record + UI |
| token_usage / cost_usd / steps / elapsed_ms / code | metadata | Message record + UI |

## External Calls
| System | Operation | On Failure |
|--------|-----------|------------|
| Gemini | question + profile + sample → pandas code / prose | Retry w/ backoff; surfaced error on repeated failure |
| Sandbox subprocess | Run pandas locally vs raw data | Route to verify → reflect → retry (bounded) |

## Business Rules
- Only question + profile + capped row sample go to Gemini — never the full dataset (test-asserted).
- Bounded retries (`AGENT_MAX_ATTEMPTS`, default 3); each retry tries a different approach.
- Ambiguous question → ask a clarifying question first; otherwise best-guess with a `flagged` badge.
- Results are verified (shape/null/sanity) before being shown.
- Follow-up questions resolve against prior turns (conversation memory).
- Sandbox has a wall-clock timeout (`AGENT_EXEC_TIMEOUT_S`, default 25s); total answer < 30s on the tested path.

## Success Criteria
- [ ] A question returns an answer matching a ground-truth pandas computation on the same data.
- [ ] The full dataset is never present in any Gemini prompt (asserted).
- [ ] A follow-up ("break that down by month") uses the prior turn's context correctly.
- [ ] An ambiguous question yields a clarifying question instead of a guess (Phase 4).
- [ ] A first-attempt code error triggers a retry with a changed approach and still answers (Phase 4).

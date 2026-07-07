# Agent

---

## Agent Architecture Pattern

**Chosen:** **Graph (LangGraph)** — an *iterating* single-agent loop beyond base ReAct. The agent writes analysis code, runs it locally, inspects the result, and self-corrects, retries with a different approach, or asks a clarifying question. Conditional edges (verify → answer / retry / clarify) and a bounded retry counter require an explicit graph, not a single-shot call.

---

## LLM Provider & Model

| Agent / Node | Provider | Model ID | Rationale |
|-------------|----------|----------|-----------|
| `plan` | Google Gemini | `gemini-3.1-pro` | Interpret question + profile, decide approach / clarify-need |
| `write_code` | Google Gemini | `gemini-3.1-pro` | Generate correct pandas — accuracy-critical |
| `reflect` | Google Gemini | `gemini-3.1-pro` | Diagnose a failed/implausible result, change strategy |
| `answer` | Google Gemini | `gemini-3.1-pro` | Compose clean prose + chart choice + follow-ups |

Provider auto-detected from `AGENT_GEMINI_API_KEY`; model driven by `AGENT_LLM_MODEL`. The `Model ID` column above is the design target; the **effective runtime model is whatever `AGENT_LLM_MODEL` specifies** — delivered/tested on **`gemini-2.5-flash`** (free-tier quota); `gemini-3.1-pro` needs paid quota. (`execute_local` and `verify`'s mechanical checks make **no** LLM call.)

**Fallback behaviour:** Gemini calls retry with bounded exponential backoff on transient errors; on repeated failure the run ends with a **friendly** surfaced error in the chat turn (quota/429 → "temporarily rate-limited or out of quota — please try again shortly."). Raw provider strings never reach the user (see `friendly_error`, `src/llm/client.py`). No offline stub — tests use the real API via `.env`.

**Prompt strategy:** system/user split. Prompts live in `src/prompts/` (`plan.md`, `write_code.md`, `reflect.md`, `answer.md`). Gemini is instructed to return **structured JSON** (e.g. `{"needs_clarification": bool, "clarifying_question": str, "code": str, "approach": str}`). **Only** the question, the compact profile, and a capped row sample go in the prompt — never the full dataset.

---

## Tools & Tool Calling

The single "tool" is local code execution (deterministic, not LLM-selected).

| Tool name | Description | Inputs | Output | Side-effects |
|-----------|-------------|--------|--------|--------------|
| `execute_local(code, frames)` | Run Gemini-generated pandas in a sandboxed subprocess against raw data | code string, mapping of frame-name → file path | JSON `{ok, value?, table?, chart?, stdout, error?}` | Reads raw files; no writes |

**Tool selection strategy:** rule-based — every attempt runs `write_code` → `execute_local`. No LLM tool-routing.

**Tool failure handling:** a non-zero/error/timeout result routes to `reflect` (which changes approach) up to the retry cap, then to `answer` as a flagged best-guess or a surfaced failure.

---

## Agent State

```python
class AgentState(TypedDict, total=False):
    # Identity
    run_id: str
    conversation_id: str

    # Input
    question: str                     # current user question
    messages: list                    # prior chat turns [{role, content}] — conversation memory
    profile: dict                     # {frames: {name: {columns:[{name,dtype,nulls,min,max,samples}], row_count}}}
    frames: dict                      # {frame_name: file_path}  — raw data locations for the sandbox
    row_sample: dict                  # {frame_name: [small list of sample rows]}  — the ONLY row data sent to LLM

    # Pipeline data (populated progressively)
    approach: str                     # plan's chosen strategy
    needs_clarification: bool
    clarifying_question: str | None
    code: str | None                  # latest generated pandas
    exec_result: dict | None          # sandbox JSON result
    attempts: int                     # retry counter (starts 0)
    verify_notes: str | None          # why a result was rejected
    confidence: str                   # graded: "high" | "medium" | "low"
                                      #  - high   : clean pass, no self-correction
                                      #  - medium : clean pass, but the loop had to self-correct
                                      #  - low    : capped-out best-guess (flagged, verify notes unresolved)
                                      # a needs_clarification turn carries NO grade (None)

    # Output
    answer_text: str | None           # clean prose + key numbers
    chart: dict | None                # Recharts spec {type, x, y, series, data}
    table: dict | None                # {columns, rows}
    followups: list                   # 2-3 suggested next questions
    token_usage: dict                 # {prompt, completion, total}
    cost_usd: float
    steps: list                       # emitted live-step labels
    elapsed_ms: int

    # Control
    error: str | None
    status: str                       # "completed" | "failed" | "needs_clarification"
```

---

## Nodes / Steps

### `plan`
**Reads:** `question`, `messages`, `profile`, `row_sample`. **Writes:** `approach`, `needs_clarification`, `clarifying_question`.
**LLM call:** yes (Gemini, JSON out). Decides the analysis approach and whether the question is too ambiguous to answer confidently. Emits step "Profiling data…" / "Planning…".

### `write_code`
**Reads:** `question`, `approach`, `profile`, `row_sample`, `verify_notes`, `messages`. **Writes:** `code`, increments `attempts`.
**LLM call:** yes (Gemini, JSON out — `code`). On a retry it receives `verify_notes` and is instructed to try a **different** approach. Emits "Writing query…".

### `execute_local`
**Reads:** `code`, `frames`. **Writes:** `exec_result`.
**LLM call:** no. Calls `execute_local` sandbox tool. Emits "Running locally…".

| System | Operation | On Failure |
|--------|-----------|------------|
| Sandbox subprocess | Run pandas vs raw data | set `exec_result.error`; route to `verify` → retry |

### `verify`
**Reads:** `exec_result`, `question`, `attempts`, `retried`. **Writes:** `verify_notes`, `confidence`.
**LLM call:** no (mechanical). Checks the result is well-formed, non-empty, shaped sensibly (row/column/null/NaN/type sanity). Emits "Verifying result…". Decides pass / retry / give-up-flagged. Grades confidence on a clean pass: `high` normally, `medium` if the loop already self-corrected (`retried`). A capped-out, unusable result (crash/timeout/no result) is turned into a clean surfaced `error` instead of a fabricated answer.

### `reflect` (P4-hardened; thin in P1)
**Reads:** `exec_result`, `verify_notes`, `approach`. **Writes:** `approach`, `verify_notes`.
**LLM call:** yes (Gemini). Diagnoses the failure and proposes a changed strategy before the next `write_code`.

### `answer`
**Reads:** `exec_result`, `question`, `messages`, `confidence`. **Writes:** `answer_text`, `chart`, `table`, `followups`, `token_usage`, `cost_usd`.
**LLM call:** yes (Gemini). Composes clean prose + key numbers, picks a Recharts spec when chartable, and (P3) 2–3 follow-ups. Flags low-confidence best-guesses. Emits "Composing answer…".

### `ask_clarification`
**Reads:** `clarifying_question`. **Writes:** `answer_text` (= the clarifying question), `status="needs_clarification"`, `confidence=None`.
**LLM call:** no. Terminal branch that returns a question instead of an answer. A clarification is NOT a graded answer, so it carries no confidence grade (`None`) — keyed off `status="needs_clarification"`, not a confidence value.

### `handle_error` / `finalize`
Standard terminal nodes: `handle_error` sets `status="failed"`, persists `error`; `finalize` sets `status="completed"` and records `elapsed_ms`, `token_usage`, `cost_usd`, `steps` on the `Message`.

---

## Graph / Flow Topology

```
START
  │
  ▼
plan ──(error)──► handle_error ──► END
  │
  ├──(needs_clarification)──► ask_clarification ──► finalize ──► END
  │
  ▼
write_code ──(error)──► handle_error
  │
  ▼
execute_local
  │
  ▼
verify ──(pass)──────────────► answer ──► finalize ──► END
  │
  ├──(fail & attempts < MAX)──► reflect ──► write_code   (retry loop)
  │
  └──(fail & attempts >= MAX)─► answer (low-confidence best-guess) ──► finalize ──► END
```

**Conditional edges:**

| Source node | Condition | Target |
|-------------|-----------|--------|
| `plan` | `state["error"]` | `handle_error` |
| `plan` | `needs_clarification` | `ask_clarification` |
| `plan` | else | `write_code` |
| `write_code` | `state["error"]` | `handle_error` |
| `verify` | result passes checks | `answer` |
| `verify` | fails & `attempts < MAX_ATTEMPTS` | `reflect` |
| `verify` | fails & `attempts >= MAX_ATTEMPTS` | `answer` (confidence=`low`, flagged best-guess) — unless the result is wholly unusable, then a clean surfaced `error` |

`MAX_ATTEMPTS` env-configurable (`AGENT_MAX_ATTEMPTS`, default 3).

---

## Memory & Context

| Scope | Mechanism | What is stored |
|-------|-----------|----------------|
| **Within a run** | LangGraph state | Question, profile, sample, code, results, attempts |
| **Across runs** | SQLite (`Dataset`, `DatasetColumn`, `Conversation`, `Message`) | Datasets, profiles, full chat history, per-query token/cost/steps/code |
| **Conversation** | `messages` loaded from `Message` rows into state | Prior turns so follow-ups ("break *that* down by month") resolve in context |

**Context window management:** the profile is compact and the row sample is capped (`AGENT_SAMPLE_ROWS`, default ~20 rows); prior chat turns are windowed/summarized if long. The **full dataset is never in the prompt** — enforced by test.

---

## Human-in-the-Loop Checkpoints

| Checkpoint | Shown to user | Expected action | Timeout / default |
|------------|--------------|-----------------|-------------------|
| Clarifying question | The agent's question when a query is too ambiguous | User answers as the next chat turn | none — waits for next message |

---

## Error Handling & Recovery

**Node-level:** each node try/excepts; fatal errors set `state["error"]` → `handle_error`.

**Graph-level (`handle_error`):** reads `error`, `run_id`; sets the `Message` status → "failed" with `error_message`; logs with `run_id`/`conversation_id`; terminates.

**Resume / retry strategy:** in-run retries via the `verify → reflect → write_code` loop bounded by `MAX_ATTEMPTS`. Gemini API calls retry with backoff (P4). Sandbox has a hard wall-clock timeout (`AGENT_EXEC_TIMEOUT_S`, default 25s) and a row/output cap.

**Partial failure:** if all attempts fail, the agent still answers with a `flagged` best-guess (or a clean surfaced error), never a silent wrong number.

---

## Observability

| Signal | What | Where |
|--------|------|-------|
| **Trace** | One trace per query, one span per node | Structured logs (stdout) via `src/observability/events.py` |
| **LLM calls** | Gemini prompt/completion/total tokens, latency, model, cost | Structured log + persisted on the `Message` |
| **Tool calls** | Sandbox: code hash, exit status, latency, error | Structured log |
| **Run outcome** | Status, total elapsed, attempts, error | SQLite `Message` + structured log |

Token/cost come from Gemini's `usage_metadata`; cost computed from a per-model rate table. Logging is wired in Phase 1 (never deferred). LangSmith optional via env if the user sets `LANGCHAIN_*`.

---

## Concurrency Model

- **Run isolation:** single-user; one query per conversation at a time (`run_id`-scoped state). Concurrent queries across different conversations are independent.
- **Parallel nodes within a run:** none — the loop is sequential by design.
- **Checkpointing:** none required in P1 (runs complete in <30s); the clarify branch persists via the `Message` table, not a LangGraph checkpointer.

---

## Graph Assembly (`src/graph/agent.py`)

```python
graph = StateGraph(AgentState)

graph.add_node("plan", plan)
graph.add_node("write_code", write_code)
graph.add_node("execute_local", execute_local)
graph.add_node("verify", verify)
graph.add_node("reflect", reflect)
graph.add_node("answer", answer)
graph.add_node("ask_clarification", ask_clarification)
graph.add_node("finalize", finalize)
graph.add_node("handle_error", handle_error)

graph.set_entry_point("plan")

graph.add_conditional_edges("plan", route_after_plan, {
    "handle_error": "handle_error",
    "ask_clarification": "ask_clarification",
    "write_code": "write_code",
})
graph.add_conditional_edges("write_code", lambda s: "handle_error" if s.get("error") else "execute_local",
    {"handle_error": "handle_error", "execute_local": "execute_local"})
graph.add_edge("execute_local", "verify")
graph.add_conditional_edges("verify", route_after_verify, {
    "answer": "answer",
    "reflect": "reflect",
})
graph.add_edge("reflect", "write_code")
graph.add_edge("answer", "finalize")
graph.add_edge("ask_clarification", "finalize")
graph.add_edge("finalize", END)
graph.add_edge("handle_error", END)

agentic_ai = graph.compile()
```

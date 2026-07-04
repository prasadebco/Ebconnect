from typing import TypedDict


class AgentState(TypedDict, total=False):
    # Identity
    run_id: str
    conversation_id: str

    # Input
    question: str
    messages: list          # prior chat turns [{role, content}] — conversation memory
    profile: dict           # {row_count, columns:[...]}
    frames: dict            # {frame_name: file_path} — raw data locations for the sandbox
    row_sample: list        # capped sample rows — the ONLY row data sent to the LLM

    # Pipeline data
    approach: str
    needs_clarification: bool
    clarifying_question: str | None
    code: str | None
    exec_result: dict | None
    attempts: int
    verify_notes: str | None
    confidence: str
    failed_attempts: list      # history of prior failures [{code, error}] so write_code avoids repeating them
    retried: bool              # True once the loop has self-corrected at least once

    # Output
    answer_text: str | None
    chart: dict | None
    table: dict | None
    followups: list
    token_usage: dict       # {prompt, completion, total}
    cost_usd: float
    steps: list
    elapsed_ms: int

    # Control
    error: str | None
    status: str             # completed | failed | needs_clarification

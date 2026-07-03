from config.settings import get_settings
from graph.state import AgentState


def route_after_plan(state: AgentState) -> str:
    if state.get("error"):
        return "handle_error"
    if state.get("needs_clarification"):
        return "ask_clarification"
    return "write_code"


def route_after_write_code(state: AgentState) -> str:
    return "handle_error" if state.get("error") else "execute_local"


def route_after_verify(state: AgentState) -> str:
    """Pass → answer. Fail & attempts left → reflect (retry). Fail & capped → answer (flagged)."""
    if state.get("confidence") == "high" and not state.get("verify_notes"):
        return "answer"
    max_attempts = get_settings().max_attempts
    if state.get("attempts", 0) < max_attempts:
        return "reflect"
    return "answer"

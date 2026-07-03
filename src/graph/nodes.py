"""LangGraph nodes for the data-analysis loop.

plan → write_code → execute_local → verify → (reflect → write_code) → answer
                                                     ↘ ask_clarification
Only the question, the compact profile, and the capped row sample ever reach the
LLM. The full dataset is read only inside the sandbox subprocess.
"""
import json
import re
from pathlib import Path

from config.settings import get_settings
from graph.state import AgentState
from llm.client import LLMClient, cost_for
from sandbox import execute
from observability.events import get_logger

_PROMPT_DIR = Path(__file__).parent.parent / "prompts"
_log = get_logger("graph")

# Test/observability hook: every LLM prompt is recorded as (tag, prompt). Tests
# assert that raw dataset rows beyond the capped sample never appear here.
_prompt_log: list[tuple[str, str]] = []


def _system(name: str) -> str:
    return (_PROMPT_DIR / name).read_text(encoding="utf-8").strip()


def _compact_profile(profile: dict) -> str:
    cols = []
    for c in profile.get("columns", []):
        part = f"- {c['name']} ({c['dtype']}), nulls={c.get('null_count', 0)}, distinct={c.get('distinct_count')}"
        if c.get("min_value") is not None:
            part += f", range=[{c['min_value']}..{c['max_value']}]"
        if c.get("samples"):
            part += f", e.g. {c['samples']}"
        cols.append(part)
    return f"row_count={profile.get('row_count')}\ncolumns:\n" + "\n".join(cols)


def _data_context(state: AgentState) -> str:
    profile = state.get("profile", {})
    sample = state.get("row_sample", [])
    ctx = "DATA PROFILE:\n" + _compact_profile(profile)
    ctx += f"\n\nSAMPLE ROWS (capped at {len(sample)}, NOT the full dataset):\n"
    ctx += json.dumps(sample, ensure_ascii=False)
    return ctx


def _history(state: AgentState) -> str:
    msgs = state.get("messages", []) or []
    if not msgs:
        return ""
    lines = [f"{m['role']}: {m['content']}" for m in msgs[-8:]]
    return "PRIOR CONVERSATION:\n" + "\n".join(lines) + "\n\n"


def _extract_json(text: str) -> dict:
    if not text:
        return {}
    # strip markdown fences
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    candidate = m.group(1) if m else text
    candidate = candidate.strip()
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        pass
    # fall back to first {...} block
    m = re.search(r"\{.*\}", candidate, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            return {}
    return {}


def _call(state: AgentState, tag: str, system: str, prompt: str) -> tuple[str, AgentState]:
    _prompt_log.append((tag, prompt))
    client = LLMClient()
    text, usage = client.generate(prompt, system=system)
    acc = dict(state.get("token_usage", {"prompt": 0, "completion": 0, "total": 0}))
    acc["prompt"] += usage["prompt"]
    acc["completion"] += usage["completion"]
    acc["total"] += usage["total"]
    cost = cost_for(client.model, acc["prompt"], acc["completion"])
    new_state = {**state, "token_usage": acc, "cost_usd": cost}
    _log.info("llm.call", node=tag, prompt_tokens=usage["prompt"], completion_tokens=usage["completion"])
    return text, new_state


# --------------------------------------------------------------------------- #
# Nodes
# --------------------------------------------------------------------------- #
def plan(state: AgentState) -> AgentState:
    try:
        prompt = f"{_history(state)}{_data_context(state)}\n\nQUESTION: {state['question']}"
        text, state = _call(state, "plan", _system("plan.md"), prompt)
        data = _extract_json(text)
        return {
            **state,
            "approach": data.get("approach", "") or "",
            "needs_clarification": bool(data.get("needs_clarification", False)),
            "clarifying_question": data.get("clarifying_question"),
            "attempts": 0,
        }
    except Exception as exc:  # noqa: BLE001
        return {**state, "error": f"plan failed: {exc}"}


def write_code(state: AgentState) -> AgentState:
    try:
        notes = state.get("verify_notes")
        notes_block = f"\n\nVERIFY NOTES (previous attempt failed):\n{notes}" if notes else ""
        prompt = (
            f"{_history(state)}{_data_context(state)}\n\n"
            f"QUESTION: {state['question']}\n"
            f"APPROACH: {state.get('approach', '')}{notes_block}"
        )
        text, state = _call(state, "write_code", _system("write_code.md"), prompt)
        data = _extract_json(text)
        code = data.get("code")
        if not code:
            return {**state, "error": "write_code: LLM returned no code"}
        return {**state, "code": code, "attempts": state.get("attempts", 0) + 1}
    except Exception as exc:  # noqa: BLE001
        return {**state, "error": f"write_code failed: {exc}"}


def execute_local(state: AgentState) -> AgentState:
    result = execute(state.get("code", ""), state.get("frames", {}))
    return {**state, "exec_result": result}


def verify(state: AgentState) -> AgentState:
    """Mechanical checks (no LLM in P1)."""
    res = state.get("exec_result") or {}
    if not res.get("ok"):
        return {**state, "verify_notes": res.get("error") or "execution failed", "confidence": "flagged"}
    rj = res.get("result_json")
    if rj is None:
        return {**state, "verify_notes": "no result produced (assign `result`)", "confidence": "flagged"}
    if rj.get("kind") == "table" and len(rj.get("rows", [])) == 0:
        return {**state, "verify_notes": "result table is empty", "confidence": "flagged"}
    if rj.get("kind") == "scalar" and rj.get("value") is None:
        return {**state, "verify_notes": "result is null", "confidence": "flagged"}
    return {**state, "verify_notes": None, "confidence": "high"}


def reflect(state: AgentState) -> AgentState:
    try:
        prompt = (
            f"{_data_context(state)}\n\nQUESTION: {state['question']}\n"
            f"CODE THAT RAN:\n{state.get('code', '')}\n"
            f"ERROR / VERIFY NOTES:\n{state.get('verify_notes', '')}"
        )
        text, state = _call(state, "reflect", _system("reflect.md"), prompt)
        data = _extract_json(text)
        return {
            **state,
            "approach": data.get("approach", state.get("approach", "")),
            "verify_notes": data.get("diagnosis", state.get("verify_notes")),
        }
    except Exception as exc:  # noqa: BLE001
        # reflection is best-effort; keep looping with existing notes
        _log.warning("reflect.failed", error=str(exc))
        return state


def _build_chart(result_json: dict | None) -> dict | None:
    if not result_json or result_json.get("kind") != "table":
        return None
    rows = result_json.get("rows", [])
    cols = result_json.get("columns", [])
    if not rows or len(cols) < 2:
        return None
    # find a categorical x and a numeric y
    x_col = None
    y_col = None
    for c in cols:
        sample_val = rows[0].get(c)
        if isinstance(sample_val, (int, float)) and not isinstance(sample_val, bool):
            if y_col is None:
                y_col = c
        elif x_col is None:
            x_col = c
    if x_col is None or y_col is None:
        return None
    if len(rows) > 50:
        return None
    return {"type": "bar", "x": x_col, "y": y_col, "series": [y_col], "data": rows}


def _build_table(result_json: dict | None) -> dict | None:
    if not result_json:
        return None
    if result_json.get("kind") == "table":
        return {"columns": result_json.get("columns", []), "rows": result_json.get("rows", [])}
    return None


def answer(state: AgentState) -> AgentState:
    try:
        res = state.get("exec_result") or {}
        rj = res.get("result_json")
        confidence = state.get("confidence", "high")
        result_desc = json.dumps(rj, ensure_ascii=False) if rj is not None else res.get("result_repr", "")
        prompt = (
            f"{_history(state)}QUESTION: {state['question']}\n\n"
            f"COMPUTED RESULT (correct — from local pandas on full data):\n{result_desc}\n\n"
            f"CONFIDENCE: {confidence}"
        )
        text, state = _call(state, "answer", _system("answer.md"), prompt)
        data = _extract_json(text)
        content = data.get("content") or res.get("result_repr") or "Here is the result."
        followups = data.get("followups") or []
        return {
            **state,
            "answer_text": content,
            "chart": _build_chart(rj),
            "table": _build_table(rj),
            "followups": followups[:3],
            "confidence": confidence,
        }
    except Exception as exc:  # noqa: BLE001
        return {**state, "error": f"answer failed: {exc}"}


def ask_clarification(state: AgentState) -> AgentState:
    q = state.get("clarifying_question") or "Could you clarify your question?"
    return {
        **state,
        "answer_text": q,
        "status": "needs_clarification",
        "confidence": "flagged",
    }


def handle_error(state: AgentState) -> AgentState:
    _log.error("run.failed", run_id=state.get("run_id"), error=state.get("error"))
    return {**state, "status": "failed", "answer_text": state.get("error")}


def finalize(state: AgentState) -> AgentState:
    status = state.get("status")
    if status not in ("failed", "needs_clarification"):
        status = "completed"
    return {**state, "status": status}

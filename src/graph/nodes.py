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
    profile = state.get("profile", {}) or {}
    sample = state.get("row_sample", [])
    if "frames" in profile:
        # multi-frame (Excel sheets / attached files) — each frame is a pandas
        # DataFrame variable named exactly as shown. Only capped samples appear.
        parts = [
            "MULTIPLE DATA FRAMES are available as pandas DataFrame variables "
            "(use the EXACT frame name shown; join them as needed). `df` is the "
            "primary/selected frame."
        ]
        samples = sample if isinstance(sample, dict) else {}
        for name, fp in profile["frames"].items():
            parts.append(f"\nFRAME `{name}`:\n" + _compact_profile(fp))
            s = samples.get(name, [])
            parts.append(
                f"SAMPLE ROWS for `{name}` (capped at {len(s)}, NOT the full frame):\n"
                + json.dumps(s, ensure_ascii=False)
            )
        return "\n".join(parts)
    ctx = "DATA PROFILE:\n" + _compact_profile(profile)
    n = len(sample) if isinstance(sample, list) else 0
    ctx += f"\n\nSAMPLE ROWS (capped at {n}, NOT the full dataset):\n"
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
        failed = state.get("failed_attempts") or []
        failed_block = ""
        if failed:
            lines = []
            for i, fa in enumerate(failed, 1):
                lines.append(
                    f"[attempt {i}] CODE:\n{fa.get('code', '')}\n"
                    f"FAILED WITH: {fa.get('error', '')}"
                )
            failed_block = (
                "\n\nPRIOR FAILED ATTEMPTS — do NOT repeat these; take a genuinely "
                "DIFFERENT approach:\n" + "\n---\n".join(lines)
            )
        prompt = (
            f"{_history(state)}{_data_context(state)}\n\n"
            f"QUESTION: {state['question']}\n"
            f"APPROACH: {state.get('approach', '')}{notes_block}{failed_block}"
        )
        text, state = _call(state, "write_code", _system("write_code.md"), prompt)
        data = _extract_json(text)
        code = data.get("code")
        if not code:
            return {**state, "error": "write_code: LLM returned no code"}
        return {**state, "code": code, "attempts": state.get("attempts", 0) + 1}
    except Exception as exc:  # noqa: BLE001
        return {**state, "error": f"write_code failed: {exc}"}


# Test hook: a FIFO queue of forced exec results. When non-empty, the next
# `execute_local` pops and returns a forced result instead of running the real
# sandbox — used to deterministically inject a first-attempt failure (or a
# repeatedly-suspect result) so retry/confidence paths can be tested without
# relying on the LLM to happen to produce a failure. Empty by default → real run.
_forced_exec_results: list[dict] = []


def execute_local(state: AgentState) -> AgentState:
    attempt = state.get("attempts", 0)
    if _forced_exec_results:
        result = _forced_exec_results.pop(0)
    else:
        result = execute(state.get("code", ""), state.get("frames", {}))
    import hashlib

    code = state.get("code", "") or ""
    _log.info(
        "attempt.execute",
        run_id=state.get("run_id"),
        attempt=attempt,
        code_hash=hashlib.sha1(code.encode("utf-8")).hexdigest()[:12],
        ok=bool(result.get("ok")),
        has_error=bool(result.get("error")),
    )
    return {**state, "exec_result": result}


def _is_nan(v) -> bool:
    return isinstance(v, float) and v != v  # NaN != NaN


def _suspect_result(res: dict) -> tuple[str | None, bool]:
    """Mechanically inspect a sandbox result for logical-suspect signals.

    Returns (notes, usable):
      - notes: a human-readable reason the result looks wrong, or None if clean.
      - usable: whether there is *some* result_json we could still answer with as
        a flagged best-guess (True) vs nothing usable at all — crash/timeout/no
        result (False). An unusable capped-out run is surfaced as a clean error
        rather than a fabricated answer.
    """
    if not res.get("ok"):
        return (res.get("error") or "execution failed"), False
    rj = res.get("result_json")
    if rj is None:
        return "no result produced (the code must assign a variable `result`)", False
    kind = rj.get("kind")
    if kind == "table":
        rows = rj.get("rows", [])
        if len(rows) == 0:
            # empty result / empty join — suspect, but answerable as flagged
            return "the result table is empty (possible empty join or over-filtering)", True
        # all-null single value column
        cols = rj.get("columns", [])
        value_cols = [c for c in cols if len(cols) == 1 or c not in (cols[0],)]
        for c in (value_cols or cols):
            vals = [r.get(c) for r in rows]
            if vals and all(v is None or _is_nan(v) for v in vals):
                return f"every value in column '{c}' is null/NaN", True
        return None, True
    if kind == "scalar":
        v = rj.get("value")
        if v is None:
            return "the result is null", True
        if _is_nan(v):
            return "the result is NaN (aggregation over empty/invalid data)", True
        return None, True
    return None, True


def verify(state: AgentState) -> AgentState:
    """Strengthened mechanical verification (no LLM).

    Catches logically-suspect results (empty/all-null/NaN/crash) BEFORE answering
    and sets a graded confidence. On a clean pass, confidence is 'high' (or
    'medium' if the loop had to self-correct). On an unusable capped-out failure
    (crash/timeout/no result), a clean surfaced error is set for handle_error.
    """
    res = state.get("exec_result") or {}
    notes, usable = _suspect_result(res)
    attempts = state.get("attempts", 0)
    max_attempts = get_settings().max_attempts
    _log.info(
        "attempt.verify",
        run_id=state.get("run_id"),
        attempt=attempts,
        passed=notes is None,
        usable=usable,
        notes=notes,
    )
    if notes is None:
        confidence = "medium" if state.get("retried") else "high"
        return {**state, "verify_notes": None, "confidence": confidence}
    # suspect result
    if attempts >= max_attempts and not usable:
        # exhausted with nothing to answer with — surface a clean error
        return {
            **state,
            "verify_notes": notes,
            "confidence": "low",
            "error": f"The analysis could not produce a valid result after {attempts} attempts: {notes}",
        }
    return {**state, "verify_notes": notes, "confidence": "low"}


def reflect(state: AgentState) -> AgentState:
    """Diagnose the failed/suspect attempt and propose a CHANGED approach.

    Records the failed (code, error) into `failed_attempts` so the next
    `write_code` sees exactly what already failed and avoids repeating it, and
    marks `retried` so a subsequent clean pass is graded 'medium' confidence.
    """
    res = state.get("exec_result") or {}
    failed = list(state.get("failed_attempts") or [])
    failed.append({
        "code": state.get("code", ""),
        "error": res.get("error") or res.get("traceback") or state.get("verify_notes") or "suspect result",
    })
    _log.info(
        "attempt.reflect",
        run_id=state.get("run_id"),
        attempt=state.get("attempts", 0),
        prior_failures=len(failed),
    )
    try:
        tb = res.get("traceback") or ""
        prompt = (
            f"{_data_context(state)}\n\nQUESTION: {state['question']}\n"
            f"CODE THAT RAN:\n{state.get('code', '')}\n"
            f"ERROR / VERIFY NOTES:\n{state.get('verify_notes', '')}\n"
            f"TRACEBACK:\n{tb}"
        )
        text, state = _call(state, "reflect", _system("reflect.md"), prompt)
        data = _extract_json(text)
        return {
            **state,
            "approach": data.get("approach", state.get("approach", "")),
            "verify_notes": data.get("diagnosis", state.get("verify_notes")),
            "failed_attempts": failed,
            "retried": True,
        }
    except Exception as exc:  # noqa: BLE001
        # reflection is best-effort; keep looping with existing notes
        _log.warning("reflect.failed", error=str(exc))
        return {**state, "failed_attempts": failed, "retried": True}


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


_UNCERTAINTY_NOTE = (
    "\n\n_Flagged — this is a best-guess answer that could not be fully verified; "
    "please double-check before acting on it._"
)


def answer(state: AgentState) -> AgentState:
    try:
        res = state.get("exec_result") or {}
        rj = res.get("result_json")
        notes = state.get("verify_notes")
        # Final confidence: an unresolved verify note (capped-out best-guess) is
        # low; a clean pass keeps verify's grade (high, or medium if self-corrected).
        confidence = "low" if notes else state.get("confidence", "high")
        result_desc = json.dumps(rj, ensure_ascii=False) if rj is not None else res.get("result_repr", "")
        uncertainty = (
            f"\n\nNOTE: the result is uncertain ({notes}). Give a clearly-flagged "
            f"best-guess answer and a concise one-sentence caveat — do NOT pretend it is certain."
            if notes else ""
        )
        prompt = (
            f"{_history(state)}QUESTION: {state['question']}\n\n"
            f"COMPUTED RESULT (correct — from local pandas on full data):\n{result_desc}\n\n"
            f"CONFIDENCE: {confidence}{uncertainty}"
        )
        text, state = _call(state, "answer", _system("answer.md"), prompt)
        data = _extract_json(text)
        content = data.get("content") or res.get("result_repr") or "Here is the result."
        if confidence == "low" and "flag" not in content.lower() and "verify" not in content.lower():
            content = content + _UNCERTAINTY_NOTE
        followups = data.get("followups") or []
        _log.info(
            "attempt.answer",
            run_id=state.get("run_id"),
            confidence=confidence,
            attempts=state.get("attempts", 0),
        )
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

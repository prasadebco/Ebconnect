"""Local pandas sandbox — runs LLM-generated code in a subprocess.

The full dataset stays local: it is loaded inside the child process from the
stored CSV/parquet path and is NEVER sent to the LLM. The parent enforces a
Windows-safe wall-clock timeout via `subprocess.run(timeout=...)` (no
signal.alarm, which is POSIX-only).
"""
import json
import subprocess
import sys
import time
from pathlib import Path

from config.settings import get_settings
from observability.events import get_logger

_CHILD = str(Path(__file__).with_name("_child.py"))
_log = get_logger("sandbox")


def _empty_result(error: str) -> dict:
    return {
        "ok": False,
        "result_repr": None,
        "result_json": None,
        "stdout": "",
        "error": error,
        "traceback": None,
    }


def execute(code: str, frames: dict[str, str], timeout: int | None = None) -> dict:
    """Run `code` against the named `frames` (name -> file path) in a subprocess.

    Returns the JSON result contract:
        {ok, result_repr, result_json, stdout, error, traceback}
    """
    if timeout is None:
        timeout = get_settings().exec_timeout_s

    payload = json.dumps({"code": code, "frames": frames})
    started = time.monotonic()
    try:
        proc = subprocess.run(
            [sys.executable, _CHILD],
            input=payload,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        elapsed_ms = int((time.monotonic() - started) * 1000)
        _log.warning("sandbox.timeout", timeout_s=timeout, elapsed_ms=elapsed_ms)
        return _empty_result(f"Execution timed out after {timeout}s")

    elapsed_ms = int((time.monotonic() - started) * 1000)

    if proc.returncode != 0:
        _log.error("sandbox.crash", returncode=proc.returncode, stderr=proc.stderr[-1000:])
        return _empty_result(
            f"sandbox process exited {proc.returncode}: {proc.stderr[-500:].strip()}"
        )

    out = proc.stdout.strip()
    if not out:
        return _empty_result("sandbox produced no output")
    try:
        result = json.loads(out.splitlines()[-1])
    except json.JSONDecodeError as exc:
        return _empty_result(f"could not parse sandbox output: {exc}")

    _log.info(
        "sandbox.exec",
        ok=result.get("ok"),
        has_error=bool(result.get("error")),
        elapsed_ms=elapsed_ms,
    )
    return result

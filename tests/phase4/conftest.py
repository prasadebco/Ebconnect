"""Phase-4 fixtures & helpers.

Reuses the root conftest's isolated per-test SQLite DB, real Gemini via .env, and
the real sandbox. Adds a guard that clears the deterministic exec-injection hook
(`graph.nodes._forced_exec_results`) around every test so forced results never
leak between tests.
"""
import pytest


@pytest.fixture(autouse=True)
def _clear_forced_exec():
    """Clear the deterministic exec-injection hook around every test so forced
    results never leak between tests."""
    from graph import nodes
    nodes._forced_exec_results.clear()
    nodes._prompt_log.clear()
    yield
    nodes._forced_exec_results.clear()

"""Sandbox child process.

Reads a JSON payload {code, frames:{name->path}} from stdin, loads the frames
as pandas DataFrames (raw data stays LOCAL — it is read here, never sent to the
LLM), executes the generated code with a restricted set of builtins, and writes
a single JSON result line to stdout following the result contract:

    {ok, result_repr, result_json, stdout, error, traceback}

The executed code is expected to assign its answer to a variable named `result`.
"""
import contextlib
import io
import json
import sys
import traceback

import pandas as pd

# A deliberately small set of safe builtins. Notably no __import__, open, eval,
# exec, or compile — the code cannot import modules, touch the network, or read
# arbitrary files. `pd` is provided directly.
_SAFE_BUILTIN_NAMES = [
    "abs", "all", "any", "bool", "dict", "divmod", "enumerate", "filter",
    "float", "format", "frozenset", "int", "len", "list", "map", "max", "min",
    "print", "range", "repr", "reversed", "round", "set", "slice", "sorted",
    "str", "sum", "tuple", "zip", "True", "False", "None", "isinstance",
    "Exception", "ValueError", "KeyError", "TypeError", "IndexError",
]


def _safe_builtins() -> dict:
    import builtins as _b

    out = {}
    for name in _SAFE_BUILTIN_NAMES:
        if hasattr(_b, name):
            out[name] = getattr(_b, name)
    return out


def _load_frame(path: str) -> pd.DataFrame:
    if path.endswith(".parquet"):
        return pd.read_parquet(path)
    return pd.read_csv(path)


def _jsonable(value):
    """Convert a result value into a JSON-serialisable structure.

    Returns a dict {kind, columns?, rows?, value?} or None if not representable.
    """
    if isinstance(value, pd.DataFrame):
        df = value.reset_index() if value.index.name or isinstance(value.index, pd.MultiIndex) else value
        df = df.head(1000)
        records = json.loads(df.to_json(orient="records", date_format="iso", default_handler=str))
        return {"kind": "table", "columns": list(df.columns.astype(str)), "rows": records}
    if isinstance(value, pd.Series):
        df = value.to_frame().reset_index()
        df.columns = [str(c) for c in df.columns]
        df = df.head(1000)
        records = json.loads(df.to_json(orient="records", date_format="iso", default_handler=str))
        return {"kind": "table", "columns": list(df.columns.astype(str)), "rows": records}
    # scalars / simple containers
    try:
        json.dumps(value)
        return {"kind": "scalar", "value": value}
    except (TypeError, ValueError):
        # numpy scalar or similar
        try:
            return {"kind": "scalar", "value": value.item()}
        except Exception:
            return {"kind": "scalar", "value": str(value)}


def main() -> None:
    result_obj = {
        "ok": False,
        "result_repr": None,
        "result_json": None,
        "stdout": "",
        "error": None,
        "traceback": None,
    }
    try:
        payload = json.load(sys.stdin)
        code = payload["code"]
        frames = payload.get("frames", {})

        env = {}
        for name, path in frames.items():
            env[name] = _load_frame(path)
        if "df" not in env and env:
            env["df"] = next(iter(env.values()))

        glb = {"__builtins__": _safe_builtins(), "pd": pd, "__name__": "__sandbox__"}
        glb.update(env)

        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                exec(code, glb)  # noqa: S102 — intentional restricted exec
            result = glb.get("result", None)
            result_obj["result_repr"] = repr(result)[:5000]
            result_obj["result_json"] = _jsonable(result)
            result_obj["ok"] = True
        except Exception as exc:  # user-code error — reported, not fatal
            result_obj["error"] = f"{type(exc).__name__}: {exc}"
            result_obj["traceback"] = traceback.format_exc()[:5000]
        result_obj["stdout"] = buf.getvalue()[:5000]
    except Exception as exc:  # harness-level failure
        result_obj["error"] = f"sandbox harness error: {exc}"
        result_obj["traceback"] = traceback.format_exc()[:5000]

    sys.stdout.write(json.dumps(result_obj))
    sys.stdout.flush()


if __name__ == "__main__":
    main()

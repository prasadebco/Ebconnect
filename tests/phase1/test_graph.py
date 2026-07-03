def test_graph_compiles():
    from graph.agent import agentic_ai
    assert agentic_ai is not None


def test_chart_builder_detects_categorical_numeric():
    from graph.nodes import _build_chart

    rj = {"kind": "table", "columns": ["region", "revenue"],
          "rows": [{"region": "East", "revenue": 100.0}, {"region": "West", "revenue": 50.0}]}
    chart = _build_chart(rj)
    assert chart is not None
    assert chart["type"] == "bar"
    assert chart["x"] == "region"
    assert chart["y"] == "revenue"


def test_chart_builder_none_for_scalar():
    from graph.nodes import _build_chart
    assert _build_chart({"kind": "scalar", "value": 5}) is None

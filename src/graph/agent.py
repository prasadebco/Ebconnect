from langgraph.graph import StateGraph, END

from graph.state import AgentState
from graph.nodes import (
    plan,
    write_code,
    execute_local,
    verify,
    reflect,
    answer,
    ask_clarification,
    finalize,
    handle_error,
)
from graph.edges import route_after_plan, route_after_write_code, route_after_verify


def _build_graph():
    g = StateGraph(AgentState)

    g.add_node("plan", plan)
    g.add_node("write_code", write_code)
    g.add_node("execute_local", execute_local)
    g.add_node("verify", verify)
    g.add_node("reflect", reflect)
    g.add_node("answer", answer)
    g.add_node("ask_clarification", ask_clarification)
    g.add_node("finalize", finalize)
    g.add_node("handle_error", handle_error)

    g.set_entry_point("plan")

    g.add_conditional_edges("plan", route_after_plan, {
        "handle_error": "handle_error",
        "ask_clarification": "ask_clarification",
        "write_code": "write_code",
    })
    g.add_conditional_edges("write_code", route_after_write_code, {
        "handle_error": "handle_error",
        "execute_local": "execute_local",
    })
    g.add_edge("execute_local", "verify")
    g.add_conditional_edges("verify", route_after_verify, {
        "answer": "answer",
        "reflect": "reflect",
    })
    g.add_edge("reflect", "write_code")
    g.add_edge("answer", "finalize")
    g.add_edge("ask_clarification", "finalize")
    g.add_edge("finalize", END)
    g.add_edge("handle_error", END)

    return g.compile()


agentic_ai = _build_graph()

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, TypedDict
from uuid import UUID


class SpectreGraphState(TypedDict, total=False):
    scan_id: str
    organization_id: str
    status: str
    error: str | None


async def run_spectre_graph(
    *,
    scan_id: UUID,
    organization_id: UUID,
    pipeline: Callable[[], Awaitable[None]],
) -> None:
    """Run the durable scan pipeline through LangGraph when installed.

    Scan state and events live in PostgreSQL, so a worker restart can resume from the
    persisted stage even when the optional graph package is not available in a dev shell.
    """
    try:
        from langgraph.graph import END, START, StateGraph
    except ImportError:
        await pipeline()
        return

    async def execute_pipeline(state: SpectreGraphState) -> dict[str, Any]:
        await pipeline()
        return {"status": "completed", **state}

    graph = StateGraph(SpectreGraphState)
    graph.add_node("codesentry_pipeline", execute_pipeline)
    graph.add_edge(START, "codesentry_pipeline")
    graph.add_edge("codesentry_pipeline", END)
    compiled = graph.compile()
    await compiled.ainvoke(
        {
            "scan_id": str(scan_id),
            "organization_id": str(organization_id),
            "status": "queued",
        },
        config={"configurable": {"thread_id": str(scan_id)}},
    )

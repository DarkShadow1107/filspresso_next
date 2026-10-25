"""Framework/model-independent compaction primitives shared with the Playground.

Recent-tail selection follows spectre-core/compaction.ts, but preserves complete
user turns. Estimates choose a cut only; callers measure the real template.
"""
from __future__ import annotations


def compaction_budget(context_window: int, threshold: float, output_tokens: int = 0) -> tuple[int, int]:
    usable = max(4096, int(context_window * threshold) - output_tokens - 1024)
    return usable, min(15_000, max(2_000, usable // 4))


def recent_turn_cut(messages: list[dict], context_tokens: int) -> int:
    """Keep the latest user turn; never split a tool-call/result group."""
    budget = min(15_000, max(2_000, context_tokens // 4))
    total = 0
    cut = len(messages)
    for index in range(len(messages) - 1, -1, -1):
        total += max(1, len(str(messages[index].get("content", ""))) // 4)
        if messages[index].get("role") == "user":
            if total > budget and cut < len(messages):
                break
            cut = index
    return cut


def recent_group_cut(groups: list, context_tokens: int, size) -> int:
    """Select a recent tail of indivisible exchanges (native calls + ALL results).

    Estimates select a boundary only; callers must measure the actual template.
    Always retain the newest complete exchange, even if it exceeds the estimate.
    """
    budget = min(15_000, max(2_000, context_tokens // 4))
    total, cut = 0, len(groups)
    for index in range(len(groups) - 1, -1, -1):
        weight = max(1, size(groups[index]) // 4)
        if total + weight > budget and cut < len(groups):
            break
        total += weight
        cut = index
    return cut

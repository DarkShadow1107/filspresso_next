import asyncio
from copy import deepcopy

import pytest

from models.playground_compaction import THRESHOLDS, prepare_context
from models.playground_context import ContextError
from spectre.app.services.compaction_core import recent_turn_cut, compaction_budget


class Runtime:
    def __init__(self, original, initial_count):
        self.original = original
        self.initial_count = initial_count
        self.summaries = 0

    async def count_input_tokens(self, model, messages, thinking_enabled=False):
        if messages is self.original:
            return self.initial_count
        return sum(len(message["content"]) // 4 + 8 for message in messages)

    async def stream_text(self, *args, **kwargs):
        self.summaries += 1
        yield "content", "Objective: fix app.py. Preserve user constraints. Tests passed; next verify the patch."
        yield "usage", {"prompt_tokens": 120, "completion_tokens": 24}


@pytest.mark.parametrize("level", [16384, 32768, 65536, 131072])
@pytest.mark.parametrize("mode,threshold", [("permissive", .8), ("balanced", .65), ("aggressive", .45)])
@pytest.mark.parametrize("offset", [-1, 0, 1])
def test_exact_threshold_boundaries(level, mode, threshold, offset):
    messages = [{"role": "system", "content": "Original policy"}]
    for _ in range(8):
        messages += [{"role": "user", "content": "Earlier prompt"}, {"role": "assistant", "content": "Earlier answer"}]
    messages.append({"role": "user", "content": "Current prompt must remain exact"})
    original = deepcopy(messages)
    runtime = Runtime(messages, int(level * threshold) + offset)
    result, event = asyncio.run(prepare_context(runtime, "model", messages, level, 2048, mode))
    assert messages == original
    assert event["compacted"] is (offset >= 0)
    assert runtime.summaries == (1 if offset >= 0 else 0)
    assert result[0] == messages[0] and result[-1] == messages[-1]
    if event["compacted"]:
        assert result[1]["role"] == "user"
        assert event["tokensAfter"] < int(level * threshold)
        assert event["usage"]["completion_tokens"] == 24


def test_three_modes_and_reused_research_budget_remain_explicit():
    assert THRESHOLDS == {"permissive": .8, "balanced": .65, "aggressive": .45}
    assert compaction_budget(100000, .8) == (78976, 15000)


def test_current_source_cannot_be_silently_dropped():
    messages = [{"role": "user", "content": "current source"}]
    with pytest.raises(ContextError, match="current prompt"):
        asyncio.run(prepare_context(Runtime(messages, 20000), "model", messages, 16384, 2048))


def test_summary_failure_preserves_incurred_usage():
    messages = [{"role": "user", "content": "old"}, {"role": "assistant", "content": "old"}, {"role": "user", "content": "now"}]
    class NoShrink(Runtime):
        async def count_input_tokens(self, *args, **kwargs):
            return 11000
    with pytest.raises(ContextError) as result:
        asyncio.run(prepare_context(NoShrink(messages, 11000), "model", messages, 16384, 2048))
    assert result.value.compaction_usage == {"prompt_tokens": 120, "completion_tokens": 24}


def test_recent_tail_does_not_split_tool_results_from_their_user_turn():
    messages = [{"role": "user", "content": "old"}, {"role": "assistant", "content": "x" * 20000},
                {"role": "user", "content": "current"}, {"role": "assistant", "content": "call"}, {"role": "tool", "content": "result"}]
    assert recent_turn_cut(messages, 16384) == 2


def test_unknown_mode_is_rejected_before_tokenization():
    with pytest.raises(ContextError):
        asyncio.run(prepare_context(None, "model", [], 16384, 2048, "off"))

import pytest
from pydantic import ValidationError

from app.schemas import AgentSettings
from app.services.workflow import _compaction_budget


def test_balanced_preset_is_default() -> None:
    settings = AgentSettings().resolved()
    assert settings["max_sources"] == 8
    assert settings["fetch_top"] == 3
    assert settings["compaction"] == "balanced"
    assert settings["enable_code_analysis"] is True
    assert settings["wall_seconds"] == 600


def test_fast_and_deep_presets_differ() -> None:
    fast = AgentSettings(profile="fast").resolved()
    deep = AgentSettings(profile="deep").resolved()
    assert fast["max_sources"] < deep["max_sources"]
    assert (
        AgentSettings(profile="fast", context_window=32_768).resolved()["context_window"]
        < AgentSettings(profile="deep", context_window=131_072).resolved()["context_window"]
    )
    assert fast["compaction"] == "aggressive"
    assert deep["enable_code_analysis"] is True
    assert fast["enable_code_analysis"] is False


def test_overrides_apply_on_top_of_preset() -> None:
    settings = AgentSettings(profile="fast", max_sources=9, temperature=0.5).resolved()
    assert settings["max_sources"] == 9
    assert settings["temperature"] == 0.5
    assert settings["fetch_top"] == 2
    assert "profile" not in settings


def test_extra_fields_are_rejected() -> None:
    with pytest.raises(ValidationError):
        AgentSettings(profile="balanced", rogue_knob=1)  # type: ignore[call-arg]


def test_bounds_are_enforced() -> None:
    with pytest.raises(ValidationError):
        AgentSettings(max_sources=99)
    with pytest.raises(ValidationError):
        AgentSettings(temperature=5)


def test_context_windows_stop_at_128k() -> None:
    assert AgentSettings(context_window=131_072).context_window == 131_072
    with pytest.raises(ValidationError):
        AgentSettings(context_window=163_840)  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        AgentSettings(context_window=204_800)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("mode", "expected_budget"),
    [("balanced", 78_976), ("proactive", 63_976), ("aggressive", 48_976)],
)
def test_compaction_thresholds(mode: str, expected_budget: int) -> None:
    budget, _ = _compaction_budget(
        {"context_window": 100_000, "compaction": mode, "synthesis_tokens": 0}
    )
    assert budget == expected_budget

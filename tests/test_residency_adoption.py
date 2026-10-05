"""Regression tests for the residency deadlock.

Phase 10. The 230M reported "busy for 20.0s (limit 4)" forever while the router had it
loaded and idle. Cause: the router answers ``POST /models/load`` with 400 "model is
already running" when the coordinator's view is stale, and the swap worker treated that
as a hard failure. Since ``refresh_residency()`` was only called from the UI's
``/api/model-status`` poll and after a *successful* load, a stale view could never
correct itself.
"""

import json
import types

from models.residency import _is_already_running, router_model_id


def _response(status_code: int, payload=None, text: str = ""):
    """Minimal stand-in for the httpx response the worker inspects."""

    def _json():
        if payload is None:
            raise ValueError("no json")
        return payload

    return types.SimpleNamespace(status_code=status_code, json=_json, text=text)


class TestAlreadyRunning:
    def test_router_error_object_is_recognised(self):
        # The exact shape llama.cpp returns.
        res = _response(400, {"error": {"message": "model is already running",
                                        "type": "invalid_request_error", "code": 400}})
        assert _is_already_running(res) is True

    def test_error_as_a_bare_string_is_recognised(self):
        res = _response(400, {"error": "model is already running"})
        assert _is_already_running(res) is True

    def test_message_matching_is_case_insensitive(self):
        res = _response(400, {"error": {"message": "Model Is Already Running"}})
        assert _is_already_running(res) is True

    def test_non_json_body_is_still_matched_on_text(self):
        res = _response(400, None, text="model is already running")
        assert _is_already_running(res) is True

    def test_a_different_400_is_not_mistaken_for_it(self):
        # A 400 can also mean a genuinely bad request. Only the specific message means
        # "your view is stale"; treating every 400 as success would silently swallow
        # real load failures.
        res = _response(400, {"error": {"message": "invalid model name"}})
        assert _is_already_running(res) is False

    def test_a_404_is_not_already_running(self):
        # The filename form gets 404 File Not Found from the router.
        res = _response(404, {"error": {"message": "File Not Found"}})
        assert _is_already_running(res) is False

    def test_garbage_payload_does_not_raise(self):
        assert _is_already_running(_response(400, {"unexpected": True})) is False


class TestRouterModelId:
    def test_strips_the_gguf_suffix(self):
        # The router addresses a model by preset name, not filename.
        assert router_model_id("LFM2.5-230M-Q4_K_M.gguf") == "LFM2.5-230M-Q4_K_M"

    def test_is_idempotent(self):
        once = router_model_id("LFM2.5-230M-Q4_K_M.gguf")
        assert router_model_id(once) == once

    def test_suffix_match_is_case_insensitive(self):
        assert router_model_id("LFM2.5-230M-Q4_K_M.GGUF") == "LFM2.5-230M-Q4_K_M"

    def test_leaves_a_bare_name_alone(self):
        assert router_model_id("LFM2.5-230M-Q4_K_M") == "LFM2.5-230M-Q4_K_M"


class TestRefreshIsNotOnlyDrivenByTheUi:
    def test_swap_worker_refreshes_residency_on_already_running(self):
        """The deadlock was only possible because nothing else refreshed the view.

        Structural: if the worker adopts the router's view without a UI poll, a stale
        `resident` set corrects itself.
        """
        import inspect

        from models.residency import ModelResidencyCoordinator

        src = inspect.getsource(ModelResidencyCoordinator._swap_worker)
        already = src.index("_is_already_running")
        after = src[already:]
        assert "refresh_residency" in after, (
            "the already-running branch must refresh residency, or the stale view persists"
        )
        # And it must not be the same call the success path already had.
        assert after.index("_is_already_running") < after.index("refresh_residency")

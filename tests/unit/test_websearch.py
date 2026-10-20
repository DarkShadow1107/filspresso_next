"""Web search: the parsers, tested against saved pages.

Why fixtures rather than the live providers. The providers are the least reliable part of the
system: DuckDuckGo answers a scraper with a challenge page, and Google answers a plain HTTP
client with a JavaScript shell. A test that depends on either of them is a test that fails
for reasons that have nothing to do with the code, and it fails exactly when somebody is
trying to work out why the search is not working.

So the parsers are tested against pages captured once, and the live providers are tested
separately, by the check that runs against the running service.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from models import websearch  # noqa: E402


FIXTURES = pathlib.Path(__file__).resolve().parent / "fixtures"


def test_duckduckgo_results_are_parsed_and_unwrapped():
    html = (FIXTURES / "duckduckgo_results.html").read_text(encoding="utf-8")
    results = websearch.parse_duckduckgo(html)

    assert len(results) == 3
    assert results[0].title == "PowerShell Direct - Microsoft Learn"
    # The provider wraps every link in a redirect; the model has to be given the real one.
    assert results[0].url == "https://learn.microsoft.com/windows-server/virtualization/hyper-v/powershell-direct"
    assert not results[0].url.startswith("//duckduckgo.com")
    assert results[0].snippet.startswith("PowerShell Direct")
    assert results[0].provider == "duckduckgo"


def test_duckduckgo_challenge_page_is_not_mistaken_for_results():
    html = (FIXTURES / "duckduckgo_challenge.html").read_text(encoding="utf-8")
    assert websearch.is_blocked_page(html) is True
    assert websearch.parse_duckduckgo(html) == []


def test_google_results_are_parsed():
    html = (FIXTURES / "google_results.html").read_text(encoding="utf-8")
    results = websearch.parse_google(html)

    assert len(results) == 2
    assert results[0].title == "Hyper-V documentation"
    assert results[0].url == "https://learn.microsoft.com/windows-server/virtualization/hyper-v/"
    assert results[0].snippet == "Hyper-V documentation and reference."
    assert results[0].provider == "google"


def test_google_relative_redirect_links_are_resolved():
    html = (FIXTURES / "google_results.html").read_text(encoding="utf-8")
    # The /url?q= form is what Google uses on some layouts.
    assert websearch._normalise_google_href("/url?q=https://example.com/x&sa=U") == "https://example.com/x"
    # And its own navigation is not a result.
    assert websearch._normalise_google_href("/search?q=more") == ""
    assert websearch._normalise_google_href("") == ""


def test_a_page_with_no_results_is_reported_rather_than_returned_as_no_results():
    """The invariant that matters.

    A provider that answers with a page the parser did not recognise must not look like a
    search that found nothing. The first tells the model the web has nothing to say, and it
    answers from its own memory and sounds confident about it; the second tells the user to
    wait.
    """
    html = (FIXTURES / "google_js_shell.html").read_text(encoding="utf-8")
    assert websearch.parse_google(html) == []

    class _StubResponse:
        status_code = 200

        def __init__(self, body):
            self.text = body

    class _StubClient:
        def __init__(self, body):
            self._body = body

        async def get(self, *_args, **_kwargs):
            return _StubResponse(self._body)

    import asyncio

    result = asyncio.run(websearch.search(_StubClient(html), "hyper-v"))
    assert result["status"] != "ok"
    assert not result.get("results")
    # The stub answers every provider with the same page, so every one of them is reported.
    assert "google" in result.get("unparsed", [])


def test_a_challenge_page_is_reported_as_a_block():
    html = (FIXTURES / "duckduckgo_challenge.html").read_text(encoding="utf-8")
    assert websearch.is_blocked_page(html) is True


def test_a_real_results_page_is_not_mistaken_for_a_block():
    html = (FIXTURES / "duckduckgo_results.html").read_text(encoding="utf-8")
    assert websearch.is_blocked_page(html) is False

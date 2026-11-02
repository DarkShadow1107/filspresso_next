import math

import httpx
import pytest

from models.tanka import TankaModel, TEXT_MODEL_MINILM


def runtime():
    model = TankaModel.__new__(TankaModel)
    model._model_base_urls = {TEXT_MODEL_MINILM: "http://embedder:8080"}
    model._llama_api_key = ""
    model._nlp_status = "not_attempted"
    model._nlp_error = ""
    return model


def response(body, status=200):
    return httpx.Response(status, json=body, request=httpx.Request("POST", "http://embedder:8080/v1/embeddings"))


def test_encode_uses_dedicated_embedding_endpoint(monkeypatch):
    calls = []

    def post(url, **kwargs):
        calls.append((url, kwargs))
        return response({"data": [{"embedding": [0.25] * 384}]})

    monkeypatch.setattr(httpx, "post", post)
    model = runtime()
    assert model.encode("espresso") == [0.25] * 384
    assert calls[0][0] == "http://embedder:8080/v1/embeddings"
    assert calls[0][1]["json"] == {"model": TEXT_MODEL_MINILM, "input": "espresso"}
    assert model.nlp_status()["loaded"]


@pytest.mark.parametrize("vector", [[], [0.1] * 383, [True] * 384, [math.nan] * 384, ["x"] * 384])
def test_encode_rejects_bad_vectors(monkeypatch, vector):
    monkeypatch.setattr(httpx, "post", lambda *a, **k: response({"data": [{"embedding": vector}]}))
    model = runtime()
    assert model.encode("espresso") is None
    assert model.nlp_status()["status"] == "unavailable"


def test_encode_fails_closed_on_unavailable_service(monkeypatch):
    monkeypatch.setattr(httpx, "post", lambda *a, **k: response({"error": "not enabled"}, 501))
    model = runtime()
    assert model.encode("espresso") is None
    assert model.encode("") is None


def test_coffee_search_uses_only_versioned_matching_fact_text(monkeypatch):
    import app

    class Encoder:
        def encode(self, text):
            assert text == "espresso"
            return [0.1] * 384

    class Cursor:
        def execute(self, query, args):
            assert "coffee_fact_embeddings" in query
            assert "e.fact_text = f.fact" in query
            assert args[1] == app.MINILM_INDEX_ID
            assert args[0].startswith("[") and args[0] == args[2]
        def fetchall(self):
            return [("Espresso fact", 0.9)]
        def close(self):
            pass

    class Connection:
        def cursor(self):
            return Cursor()
        def close(self):
            pass

    monkeypatch.setattr(app, "tanka", Encoder())
    monkeypatch.setattr(app, "get_db_connection", lambda: Connection())
    assert app._search_facts("espresso") == ([("Espresso fact", 0.9)], "MiniLM semantic retrieval")


def test_coffee_search_falls_back_when_encoder_unavailable(monkeypatch):
    import app

    class Encoder:
        def encode(self, text):
            return None

    monkeypatch.setattr(app, "tanka", Encoder())
    monkeypatch.setattr(app, "_search_facts_without_vectors", lambda *a, **kw: [("lexical fact", 0.2)])
    assert app._search_facts("espresso") == ([("lexical fact", 0.2)], "Lexical fallback retrieval")


def test_reindex_rolls_back_when_embedding_fails(monkeypatch):
    import reindex_coffee_embeddings as indexer

    class Cursor:
        rowcount = 1
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def execute(self, sql, args=None):
            pass
        def fetchall(self):
            return [(1, "espresso"), (2, "latte")]

    class Connection:
        committed = False
        rolled_back = False
        def __enter__(self):
            return self
        def __exit__(self, kind, value, trace):
            self.committed = kind is None
            self.rolled_back = kind is not None
            return False
        def cursor(self):
            return Cursor()

    class Encoder:
        def encode(self, text):
            return [0.1] * 384 if text == "espresso" else None

    connection = Connection()
    monkeypatch.setattr(indexer, "get_db_connection", lambda: connection)
    monkeypatch.setattr(indexer, "tanka", Encoder())
    with pytest.raises(RuntimeError, match="rolled back"):
        indexer.reindex()
    assert connection.rolled_back
    assert not connection.committed

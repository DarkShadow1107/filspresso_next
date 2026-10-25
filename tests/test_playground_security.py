def test_model_status_cannot_load_a_model(client, tanka_stub):
    response = client.get("/api/model-status?load=LFM2.5-230M-Q4_K_M.gguf")
    assert response.status_code == 400
    assert tanka_stub.residency.load_requests == []

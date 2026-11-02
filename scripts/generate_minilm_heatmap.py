"""Generate a small, labelled cosine-similarity SVG from a live MiniLM server.

Uses fixed synthetic examples only, not private user data. The plot is a runtime
demonstration, not a model-quality benchmark. Set LLAMA_CPP_MINILM_BASE_URL to the
embedding server before running; writes SVG to standard output.
"""
import html
import json
import math
import os
import urllib.request

QUERIES = ["espresso extraction", "arabica and robusta", "Python unit tests", "space travel"]
DOCUMENTS = [
    "Espresso is coffee brewed under pressure.",
    "Arabica and robusta are coffee species.",
    "Python tests check that code behaves correctly.",
    "Spacecraft travel beyond Earth's atmosphere.",
]


def embed(text):
    url = os.environ.get("LLAMA_CPP_MINILM_BASE_URL", "http://llama-minilm:8080").rstrip("/")
    request = urllib.request.Request(url + "/v1/embeddings", data=json.dumps({
        "model": "MiniLM-L6-v2.gguf", "input": text,
    }).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=10) as response:
        vector = json.load(response)["data"][0]["embedding"]
    if len(vector) != 384 or any(not isinstance(x, (int, float)) or not math.isfinite(x) for x in vector):
        raise ValueError("Expected 384 finite values")
    norm = math.sqrt(sum(x * x for x in vector))
    if norm == 0:
        raise ValueError("Zero embedding")
    return [x / norm for x in vector]


def main():
    queries = [embed(text) for text in QUERIES]
    documents = [embed(text) for text in DOCUMENTS]
    print('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="460" viewBox="0 0 900 460" role="img" aria-labelledby="title desc">')
    print('<title id="title">MiniLM cosine similarity demonstration</title>')
    print('<desc id="desc">Synthetic queries and documents. Cells show observed cosine similarity from the local MiniLM server; this is not a benchmark.</desc>')
    print('<rect width="900" height="460" fill="#faf7f4"/>')
    print('<g font-family="Segoe UI, sans-serif" fill="#241b19">')
    print('<text x="24" y="32" font-size="20" font-weight="bold">MiniLM similarity: synthetic examples</text>')
    print('<text x="24" y="56" font-size="12">Cosine similarity - 384 dimensions - color scale -1 to +1 - darker is higher - not a benchmark</text>')
    for col, doc in enumerate(DOCUMENTS):
        print(f'<text x="{252 + col * 150}" y="95" font-size="12" font-weight="bold">D{col + 1}</text>')
    for row, (query, qvec) in enumerate(zip(QUERIES, queries)):
        y = 108 + row * 55
        print(f'<text x="24" y="{y + 32}" font-size="13">{html.escape(query)}</text>')
        for col, dvec in enumerate(documents):
            score = max(-1.0, min(1.0, sum(a * b for a, b in zip(qvec, dvec))))
            intensity = (score + 1) / 2
            r = round(250 - 135 * intensity)
            g = round(240 - 171 * intensity)
            b = round(235 - 170 * intensity)
            text_color = "white" if intensity > 0.55 else "#241b19"
            x = 220 + col * 150
            print(f'<rect x="{x}" y="{y}" width="140" height="48" rx="5" fill="rgb({r},{g},{b})"/>')
            print(f'<text x="{x + 70}" y="{y + 30}" font-size="14" text-anchor="middle" fill="{text_color}">{score:.3f}</text>')
    for i, text in enumerate(DOCUMENTS):
        print(f'<text x="24" y="{354 + i * 20}" font-size="12">D{i + 1}: {html.escape(text)}</text>')
    print('</g></svg>')


if __name__ == "__main__":
    main()

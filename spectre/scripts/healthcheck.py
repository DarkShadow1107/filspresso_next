from urllib.request import urlopen

with urlopen("http://localhost:8000/health", timeout=5) as response:
    if response.status != 200:
        raise SystemExit(f"Unexpected status: {response.status}")

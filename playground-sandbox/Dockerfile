FROM python:3.11-slim@sha256:233de06753d30d120b1a3ce359d8d3be8bda78524cd8f520c99883bfe33964cf
WORKDIR /app
COPY playground-sandbox/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY playground-sandbox/broker.py .
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
# Trusted control plane only. User code never runs in this container.
CMD ["python", "-m", "uvicorn", "broker:app", "--host", "0.0.0.0", "--port", "8095", "--no-server-header"]

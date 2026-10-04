FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/srv/app

WORKDIR /srv/app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    curl \
    ca-certificates \
    git \
    libgomp1 \
    tesseract-ocr \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY app ./app
ARG INSTALL_LOCAL_MODELS=0
ARG INSTALL_SCANNERS=0
ARG TARGETARCH=amd64
ARG GITLEAKS_VERSION=8.30.1
ARG OSV_SCANNER_VERSION=2.5.1
ARG TRIVY_VERSION=0.74.0
ARG SYFT_VERSION=1.51.1
ARG BANDIT_VERSION=1.9.4
ARG SEMGREP_VERSION=1.175.0
RUN pip install --upgrade pip && pip install . && \
    if [ "$INSTALL_SCANNERS" = "1" ]; then \
      case "$TARGETARCH" in \
        amd64) \
          GITLEAKS_ARCH=linux_x64; GITLEAKS_SHA=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb; \
          OSV_ARCH=linux_amd64; OSV_SHA=f9f25499a2c8cc367b3af45df2ea7eeca7fbccceab9c35079968f4b3652194be; \
          TRIVY_ARCH=Linux-64bit; TRIVY_SHA=2ae6fe3ee734b7fdf11335663e18c75ea12dccc76062f09f164a3b0f8be4371a; \
          SYFT_ARCH=linux_amd64; SYFT_SHA=8fcb33017a0dc1058298c923c436d19dfa68ae93968e0b423248542e3afb9fc3 ;; \
        arm64) \
          GITLEAKS_ARCH=linux_arm64; GITLEAKS_SHA=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080; \
          OSV_ARCH=linux_arm64; OSV_SHA=3d0f5aa5a6baa8eb32bcef247388e149ef6030a6634ccae6fa0d62681fb27a6d; \
          TRIVY_ARCH=Linux-ARM64; TRIVY_SHA=b94ce1976bbf3c15b514b605ee88be7c6d94a29be2302847ff01cb794d47aad5; \
          SYFT_ARCH=linux_arm64; SYFT_SHA=a7fd2b784e6664acd44719270574f6cd8c6864fc2b1700bf9099bd1cccda7d7f ;; \
        *) echo "Unsupported scanner architecture: $TARGETARCH" >&2; exit 1 ;; \
      esac && \
      curl --fail --location --silent --show-error \
        "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_${GITLEAKS_ARCH}.tar.gz" \
        -o /tmp/gitleaks.tar.gz && \
      echo "${GITLEAKS_SHA}  /tmp/gitleaks.tar.gz" | sha256sum -c - && \
      tar -xzf /tmp/gitleaks.tar.gz -C /usr/local/bin gitleaks && \
      curl --fail --location --silent --show-error \
        "https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/osv-scanner_${OSV_ARCH}" \
        -o /usr/local/bin/osv-scanner && \
      echo "${OSV_SHA}  /usr/local/bin/osv-scanner" | sha256sum -c - && \
      chmod 0755 /usr/local/bin/osv-scanner && \
      curl --fail --location --silent --show-error \
        "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_${TRIVY_ARCH}.tar.gz" \
        -o /tmp/trivy.tar.gz && \
      echo "${TRIVY_SHA}  /tmp/trivy.tar.gz" | sha256sum -c - && \
      tar -xzf /tmp/trivy.tar.gz -C /usr/local/bin trivy && \
      curl --fail --location --silent --show-error \
        "https://github.com/anchore/syft/releases/download/v${SYFT_VERSION}/syft_${SYFT_VERSION}_${SYFT_ARCH}.tar.gz" \
        -o /tmp/syft.tar.gz && \
      echo "${SYFT_SHA}  /tmp/syft.tar.gz" | sha256sum -c - && \
      tar -xzf /tmp/syft.tar.gz -C /usr/local/bin syft && \
      pip install "bandit==${BANDIT_VERSION}" "semgrep==${SEMGREP_VERSION}" && \
      rm -f /tmp/gitleaks.tar.gz /tmp/trivy.tar.gz /tmp/syft.tar.gz; \
    fi && \
    if [ "$INSTALL_LOCAL_MODELS" = "1" ]; then pip install ".[local-models]"; fi

# Numeric analysis for sandbox image inspection (PIL is already present).
RUN pip install "numpy>=1.26,<3"

COPY scripts ./scripts
COPY alembic.ini ./
COPY alembic ./alembic

RUN useradd --create-home --uid 10001 appuser && \
    mkdir -p /run/secrets /srv/app/artifacts /srv/app/workspaces /tmp/trivy-cache && \
    chown -R appuser:appuser /srv/app /tmp/trivy-cache && \
    mkdir -p /srv/tools /srv/repositories && \
    ln -sfn /srv/repositories /srv/tools/repositories || true

USER appuser

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

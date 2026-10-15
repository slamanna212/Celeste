# syntax=docker/dockerfile:1

# python:3.12-slim (glibc), pinned by digest (resolved from Docker Hub 2026-10-14).
FROM python:3.14-slim@sha256:a2b82f3c48559aa0a8446d9af49826b6e2b2016f4cd2afabfe6013ec53729170

# Deno binary from the official image (glibc build). yt-dlp's `pin-deno` extra pins 2.9.5; yt-dlp
# needs >= 2.3.0 (EJS wiki).
COPY --from=denoland/deno:bin-2.9.5@sha256:0d1262facd139e815217c001945eb822c7a78584cf660142c34a6b53effec1aa /deno /usr/local/bin/deno

# bgutil plugin version. MUST equal the bgutil sidecar image tag, i.e. the Helm chart value
# `resolver.bgutilVersion` (brainicism/bgutil-ytdlp-pot-provider:<same version>).
ARG BGUTIL_VERSION=2.0.2

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HOME=/tmp \
    XDG_CACHE_HOME=/tmp/.cache \
    DENO_DIR=/tmp/.deno \
    DENO_NO_UPDATE_CHECK=1 \
    DENO_NO_PROMPT=1

WORKDIR /app
COPY requirements.txt ./
RUN grep -v '^bgutil-ytdlp-pot-provider' requirements.txt > /tmp/req.txt \
    && echo "bgutil-ytdlp-pot-provider==${BGUTIL_VERSION}" >> /tmp/req.txt \
    && pip install -r /tmp/req.txt \
    && rm /tmp/req.txt \
    && deno --version

COPY resolver ./resolver

RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin resolver
USER 10001:10001

EXPOSE 8080
CMD ["python", "-m", "resolver.main"]

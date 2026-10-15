"""Prometheus metrics."""

from __future__ import annotations

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram

REGISTRY = CollectorRegistry()

REQUESTS = Counter(
    "resolver_exec_requests_total",
    "POST /v1/exec requests by outcome (ok, ytdlp_error, rejected, timeout, internal_error).",
    ["outcome"],
    registry=REGISTRY,
)
LATENCY = Histogram(
    "resolver_exec_duration_seconds",
    "Wall time of yt-dlp subprocess runs.",
    buckets=(0.25, 0.5, 1, 2, 3, 5, 8, 12, 20, 30, 45),
    registry=REGISTRY,
)
EXIT_CODES = Counter(
    "resolver_ytdlp_exit_codes_total",
    "yt-dlp exit codes (124 = timeout kill).",
    ["code"],
    registry=REGISTRY,
)
IN_FLIGHT = Gauge(
    "resolver_exec_in_flight", "yt-dlp processes currently running.", registry=REGISTRY
)
WAITING = Gauge(
    "resolver_exec_waiting", "Requests waiting for a concurrency slot.", registry=REGISTRY
)
PLAYBACK_PROBES = Counter(
    "resolver_playback_probes_total",
    "Playback stream-URL checks by player client and result (ok, 403, ytdlp_error, ...).",
    ["client", "result"],
    registry=REGISTRY,
)

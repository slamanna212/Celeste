"""Stream-URL verification with player-client fallback for LavaSrc playback calls.

YouTube keeps flipping which yt-dlp player client hands out playable googlevideo URLs
(visionos 403'd on 2026-10-14, mweb + bgutil PO token 403'd on 2026-10-15). Lavalink only
learns about a 403 after the track has started, so for playback calls the resolver fetches
one byte of the returned URL itself (same egress IP as Lavalink) and, if that is refused,
re-runs yt-dlp with the next client in ``Settings.playback_clients``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import urllib.error
import urllib.request
from collections.abc import Awaitable, Callable
from urllib.parse import urlsplit

from . import metrics
from .config import Settings
from .runner import ExecResult

log = logging.getLogger("resolver")

PROBE_TIMEOUT_SECONDS = 5
# Don't start another yt-dlp attempt with less than this much of the exec budget left.
MIN_ATTEMPT_SECONDS = 5
STREAM_HOST_SUFFIX = ".googlevideo.com"

Runner = Callable[[list[str], float], Awaitable[ExecResult]]
Prober = Callable[[str], Awaitable[int | None]]


def is_playback(argv: list[str]) -> bool:
    """LavaSrc's playback call: ``-f ... -J <video URL>`` (load calls use --flat-playlist)."""
    return (
        "--format" in argv
        and ("-J" in argv or "--dump-single-json" in argv)
        and "--flat-playlist" not in argv
        and argv[-1].lower().startswith(("http://", "https://"))
    )


def _client_of(argv: list[str]) -> str:
    for i, tok in enumerate(argv[:-1]):
        if tok == "--extractor-args" and argv[i + 1].startswith("youtube:"):
            for part in argv[i + 1].removeprefix("youtube:").split(";"):
                key, _, value = part.partition("=")
                if key == "player_client" and value:
                    return value
    return "default"


def with_client(argv: list[str], client: str) -> list[str]:
    """Replace any ``youtube:`` extractor args with just ``player_client=<client>``."""
    out: list[str] = []
    i = 0
    while i < len(argv):
        if argv[i] == "--extractor-args" and argv[i + 1].startswith("youtube:"):
            i += 2
            continue
        out.append(argv[i])
        i += 1
    if client != "default":
        out[-1:-1] = ["--extractor-args", f"youtube:player_client={client}"]
    return out


def stream_url(stdout: str) -> str | None:
    """The single-format URL from ``-J`` output, if it is a googlevideo URL we can probe."""
    try:
        data = json.loads(stdout)
    except ValueError:
        return None
    url = data.get("url") if isinstance(data, dict) else None
    if not isinstance(url, str):
        return None
    host = (urlsplit(url).hostname or "").lower()
    return url if url.startswith("https://") and host.endswith(STREAM_HOST_SUFFIX) else None


def _probe_sync(url: str) -> int | None:
    req = urllib.request.Request(url, headers={"Range": "bytes=0-0"})  # noqa: S310 - googlevideo only
    try:
        with urllib.request.urlopen(req, timeout=PROBE_TIMEOUT_SECONDS) as resp:  # noqa: S310
            return resp.status
    except urllib.error.HTTPError as exc:
        return exc.code
    except (OSError, ValueError):
        return None


async def probe(url: str) -> int | None:
    """HTTP status of a 1-byte range GET, or None if the probe itself failed (network error)."""
    return await asyncio.to_thread(_probe_sync, url)


async def run_playback(
    settings: Settings, argv: list[str], run: Runner, prober: Prober = probe
) -> ExecResult:
    """Run the requested playback call; on an unplayable URL retry with fallback clients.

    Returns the first result whose stream URL probes OK, else the first result (so Lavalink
    fails exactly as it would have without the fallback).
    """
    deadline = time.monotonic() + settings.exec_timeout_seconds
    attempts = [argv]
    for client in settings.playback_clients:
        candidate = with_client(argv, client)
        if candidate not in attempts:
            attempts.append(candidate)

    first: ExecResult | None = None
    for n, attempt in enumerate(attempts):
        remaining = deadline - time.monotonic()
        if n > 0 and remaining < MIN_ATTEMPT_SECONDS:
            break
        result = await run(attempt, remaining)
        first = first or result
        client = _client_of(attempt)
        if result.exit_code != 0:
            metrics.PLAYBACK_PROBES.labels(client, "ytdlp_error").inc()
            continue
        url = stream_url(result.stdout)
        if url is None:
            metrics.PLAYBACK_PROBES.labels(client, "unprobed").inc()
            return result
        status = await prober(url)
        if status is None or 200 <= status < 300:
            metrics.PLAYBACK_PROBES.labels(client, "ok" if status else "probe_error").inc()
            if n > 0:
                log.info("playback fallback succeeded", extra={"client": client})
            return result
        metrics.PLAYBACK_PROBES.labels(client, str(status)).inc()
        log.warning("stream URL rejected", extra={"client": client, "status": status})
    assert first is not None  # noqa: S101 - attempts is never empty
    return first

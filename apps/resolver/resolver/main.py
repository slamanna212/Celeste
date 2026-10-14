"""FastAPI application."""

from __future__ import annotations

import asyncio
import contextlib
import importlib.metadata
import json
import logging
import time
import urllib.request
from functools import lru_cache

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from pydantic import BaseModel

from . import metrics
from .allowlist import RejectedArgs, parse_args
from .config import Settings
from .logging_setup import setup_logging
from .runner import run_ytdlp

log = logging.getLogger("resolver")


class ExecRequest(BaseModel):
    args: list[str]


def _pkg_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


@lru_cache(maxsize=1)
def _deno_version() -> str | None:
    import subprocess

    try:
        out = subprocess.run(
            ["deno", "--version"],  # noqa: S607
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        ).stdout
        return out.split()[1] if out.startswith("deno ") else None
    except (OSError, subprocess.SubprocessError, IndexError):
        return None


def _ping_pot(base_url: str) -> dict | None:
    try:
        with urllib.request.urlopen(base_url + "/ping", timeout=2) as resp:  # noqa: S310
            if resp.status != 200:
                return None
            return json.loads(resp.read() or b"{}")
    except (OSError, ValueError):
        return None


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    app = FastAPI(title="celeste-resolver", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = settings
    semaphore = asyncio.Semaphore(settings.max_concurrency)

    @app.exception_handler(RequestValidationError)
    async def _bad_request(_: Request, exc: RequestValidationError) -> JSONResponse:
        metrics.REQUESTS.labels("rejected").inc()
        return JSONResponse({"error": 'invalid request body; expected {"args": [str]}'}, 400)

    @app.post("/v1/exec")
    async def exec_(body: ExecRequest) -> JSONResponse:
        try:
            parsed = parse_args(body.args, settings.allowed_url_hosts)
        except RejectedArgs as exc:
            metrics.REQUESTS.labels("rejected").inc()
            log.warning("rejected", extra={"ytArgs": body.args, "reason": str(exc)})
            return JSONResponse({"error": str(exc)}, status_code=400)

        metrics.WAITING.inc()
        try:
            await semaphore.acquire()
        finally:
            metrics.WAITING.dec()
        started = time.monotonic()
        metrics.IN_FLIGHT.inc()
        try:
            result = await run_ytdlp(settings, parsed.argv)
        except Exception:
            metrics.REQUESTS.labels("internal_error").inc()
            log.exception("exec failed", extra={"ytArgs": body.args})
            return JSONResponse({"error": "failed to run yt-dlp"}, status_code=500)
        finally:
            metrics.IN_FLIGHT.dec()
            semaphore.release()
        elapsed = time.monotonic() - started
        metrics.LATENCY.observe(elapsed)
        metrics.EXIT_CODES.labels(str(result.exit_code)).inc()
        outcome = (
            "timeout" if result.timed_out else "ok" if result.exit_code == 0 else "ytdlp_error"
        )
        metrics.REQUESTS.labels(outcome).inc()
        log.info(
            "exec",
            extra={
                "ytArgs": body.args,
                "outcome": outcome,
                "exitCode": result.exit_code,
                "durationMs": round(elapsed * 1000),
                "stdoutBytes": len(result.stdout),
            },
        )
        return JSONResponse(
            {"exitCode": result.exit_code, "stdout": result.stdout, "stderr": result.stderr}
        )

    @app.get("/healthz")
    async def healthz() -> dict:
        return {"status": "ok"}

    @app.get("/readyz")
    async def readyz() -> JSONResponse:
        checks = {"yt_dlp": False, "pot": False}
        with contextlib.suppress(Exception):
            import yt_dlp  # noqa: F401

            checks["yt_dlp"] = True
        checks["pot"] = await asyncio.to_thread(_ping_pot, settings.pot_base_url) is not None
        ok = all(checks.values())
        return JSONResponse({"ready": ok, "checks": checks}, status_code=200 if ok else 503)

    @app.get("/v1/version")
    async def version() -> dict:
        pot = await asyncio.to_thread(_ping_pot, settings.pot_base_url)
        return {
            "ytDlp": _pkg_version("yt-dlp"),
            "bgutilPlugin": _pkg_version("bgutil-ytdlp-pot-provider"),
            "ejs": _pkg_version("yt-dlp-ejs"),
            "deno": await asyncio.to_thread(_deno_version),
            "potServer": (pot or {}).get("version"),
        }

    @app.get("/metrics")
    async def metrics_endpoint() -> Response:
        return Response(generate_latest(metrics.REGISTRY), media_type=CONTENT_TYPE_LATEST)

    return app


def main() -> None:
    import uvicorn

    settings = Settings.from_env()
    setup_logging(settings.log_level)
    log.info("starting", extra={"port": settings.port, "maxConcurrency": settings.max_concurrency})
    uvicorn.run(
        create_app(settings),
        host="0.0.0.0",  # noqa: S104 - pod-internal service
        port=settings.port,
        log_config=None,
        access_log=False,
    )


if __name__ == "__main__":
    main()

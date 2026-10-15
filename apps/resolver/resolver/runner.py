"""Runs yt-dlp as a subprocess (argv list, never a shell)."""

from __future__ import annotations

import asyncio
import contextlib
import os
import signal
from dataclasses import dataclass

from .config import Settings

TIMEOUT_EXIT_CODE = 124


@dataclass(frozen=True)
class ExecResult:
    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool = False


def build_command(settings: Settings, argv: list[str]) -> list[str]:
    """Allowlisted argv plus server-enforced args. Cookie contents are never read."""
    enforced = [
        "--ignore-config",
        "--extractor-args",
        f"youtubepot-bgutilhttp:base_url={settings.pot_base_url}",
    ]
    if os.path.isfile(settings.cookies_path):
        enforced += ["--cookies", settings.cookies_path]
    return [*settings.ytdlp_command, *enforced, *argv]


def _kill_group(proc: asyncio.subprocess.Process) -> None:
    with contextlib.suppress(ProcessLookupError, PermissionError):
        os.killpg(proc.pid, signal.SIGKILL)
    with contextlib.suppress(ProcessLookupError):
        proc.kill()


async def run_ytdlp(
    settings: Settings, argv: list[str], budget_seconds: float | None = None
) -> ExecResult:
    timeout = settings.exec_timeout_seconds if budget_seconds is None else budget_seconds
    cmd = build_command(settings, argv)
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,  # own process group so deno etc. die with it
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except TimeoutError:
        _kill_group(proc)
        with contextlib.suppress(Exception):
            await asyncio.wait_for(proc.wait(), 5)
        return ExecResult(
            TIMEOUT_EXIT_CODE,
            "",
            f"resolver: yt-dlp timed out after {timeout:.0f}s and was killed\n",
            timed_out=True,
        )
    except asyncio.CancelledError:
        _kill_group(proc)
        raise
    return ExecResult(
        proc.returncode if proc.returncode is not None else 1,
        out.decode("utf-8", "replace"),
        err.decode("utf-8", "replace"),
    )
